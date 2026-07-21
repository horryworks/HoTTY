use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde_json::Value;
use tauri::{AppHandle, Manager, State};
use tokio::sync::{Mutex, RwLock};
use tokio_util::sync::CancellationToken;

use crate::services::ai::history::ChatImage;
use crate::services::ai::{AIService, AuthStatus, CommandVerdict, ModelInfo};
use crate::services::path_safety::{is_sensitive_path, is_unc_path};

/// Monotonic id per send, so deregistration only removes its OWN registry entry
/// (a newer send for the same session may have replaced it while it streamed).
static SEND_GEN: AtomicU64 = AtomicU64::new(0);

/// Managed state holding the AI service behind an async-aware read/write lock.
pub struct AIServiceState {
    /// The AI service behind an `RwLock`. Read-shaped operations (chat send,
    /// classify, list models/locations, clear history, auth status) take `.read()`
    /// and run CONCURRENTLY — a send from one tab no longer serializes every other
    /// AI operation behind one exclusive lock. Write operations (auth, logout,
    /// provider/region switch) take `.write()`; because those per-session mutations
    /// are now interior-mutable, `send_message` et al. need only `&self`.
    pub service: RwLock<AIService>,
    /// In-flight stream cancellation tokens, keyed by `session_id` (value carries
    /// the owning send's generation id). Kept in a SEPARATE (fast, non-async) mutex
    /// so `ai_chat_cancel` can interrupt a stream WITHOUT waiting on `service`.
    /// Also drained by `cancel_all_inflight` before a `.write()` so a rare state
    /// change never stalls behind a long-running read-held stream.
    pub cancels: StdMutex<HashMap<String, (u64, CancellationToken)>>,
}

/// Cancel every in-flight stream. Called before acquiring the service WRITE lock:
/// tokio's `RwLock` is write-preferring, so a queued writer blocks not only on the
/// active read-held stream(s) but also stalls all NEW reads (sends) until it
/// acquires. Writes are rare, user-initiated state changes (auth / logout /
/// provider or region switch), so cancelling active streams to let the change
/// take effect promptly — instead of hanging up to the stream backstop — is the
/// right trade-off. (Logout/provider-switch want streams stopped anyway.)
fn cancel_all_inflight(state: &AIServiceState) {
    let mut cancels = state.cancels.lock().unwrap();
    let n = cancels.len();
    for (_, (_, token)) in cancels.drain() {
        token.cancel();
    }
    if n > 0 {
        log::debug!(
            "[ai] cancel_all_inflight: cancelled {n} in-flight stream(s) before a write op"
        );
    }
}

/// Managed state: set of service-account key file paths approved via the
/// native file picker. Auth requests using `service_account` auth must
/// supply a path that has been picked through the dialog.
pub struct ApprovedServiceAccountKeys {
    inner: Arc<Mutex<HashSet<PathBuf>>>,
}

impl ApprovedServiceAccountKeys {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashSet::new())),
        }
    }
}

impl Default for ApprovedServiceAccountKeys {
    fn default() -> Self {
        Self::new()
    }
}

fn resolve_path(p: &str) -> Result<PathBuf, String> {
    Path::new(p)
        .canonicalize()
        .map_err(|e| format!("failed to resolve path: {e}"))
}

/// Validate that, for `service_account` auth, the `keyFilePath` was attested
/// through the native file picker and is not in a sensitive directory.
async fn validate_service_account_key(
    credentials: &Value,
    approved: &ApprovedServiceAccountKeys,
) -> Result<(), String> {
    let auth_type = credentials
        .get("authType")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if auth_type != "service_account" {
        return Ok(());
    }
    let key_file_path = credentials
        .get("keyFilePath")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if key_file_path.is_empty() {
        return Err("service account key file path is required".into());
    }
    // Reject UNC paths before canonicalize(): on Windows, canonicalize() on a
    // UNC path performs SMB resolution (NTLMv2 hash leak) before the approved-
    // set lookup can reject it.
    if is_unc_path(key_file_path) {
        return Err("service account key file path cannot be a UNC/network path".into());
    }
    let resolved = resolve_path(key_file_path)?;
    if is_sensitive_path(&resolved) {
        return Err("access to sensitive directories is not allowed".into());
    }
    let set = approved.inner.lock().await;
    if !set.contains(&resolved) {
        return Err("service account key file not approved via dialog".into());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const MAX_MESSAGE_LENGTH: usize = 1_000_000;
/// A single command to classify is bounded well below the chat message limit —
/// execute blocks are short. Keeps a hostile/runaway input from reaching the API.
const MAX_COMMAND_LENGTH: usize = 8_192;
/// Hard ceiling on a classification round-trip so a hung provider can't hold the
/// service lock (and block auto-exec) indefinitely.
const CLASSIFY_TIMEOUT_SECS: u64 = 12;

/// Backstop deadline for a whole chat stream. Defense-in-depth: the frontend
/// watchdog normally cancels a stalled stream at its ~600s hard cap, but if the
/// UI is gone (window crashed) that cancel never arrives and the stream would
/// hold the service lock forever. Set a bit above the frontend cap so the UI
/// wins under normal operation and this only fires when the UI can't.
const STREAM_DEADLINE_SECS: u64 = 660;

fn validate_session_id(session_id: &str) -> Result<(), String> {
    if session_id.is_empty() {
        return Err("session_id must not be empty".into());
    }
    Ok(())
}

fn validate_command(command: &str) -> Result<(), String> {
    if command.trim().is_empty() {
        return Err("command must not be empty".into());
    }
    if command.len() > MAX_COMMAND_LENGTH {
        return Err(format!(
            "command exceeds maximum length of {} characters",
            MAX_COMMAND_LENGTH
        ));
    }
    Ok(())
}

fn validate_message(message: &str) -> Result<(), String> {
    if message.is_empty() {
        return Err("message must not be empty".into());
    }
    if message.len() > MAX_MESSAGE_LENGTH {
        return Err(format!(
            "message exceeds maximum length of {} characters",
            MAX_MESSAGE_LENGTH
        ));
    }
    Ok(())
}

/// Max attached images per chat message.
const MAX_IMAGES_PER_MESSAGE: usize = 5;
/// Max decoded bytes per image (5 MiB) — the common denominator that stays under
/// every provider's per-image limit.
const MAX_IMAGE_BYTES: usize = 5 * 1024 * 1024;
/// MIME types every target provider (Gemini/Vertex/OpenAI/Anthropic) accepts.
const ALLOWED_IMAGE_MIME_TYPES: [&str; 4] = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/// Validate user-attached images before they enter history / a provider request.
/// Enforces the count cap, the MIME allow-list, base64 well-formedness, and the
/// per-image byte cap. The base64 is decoded ONLY to validate (well-formedness +
/// true size); the decoded bytes are discarded — the original base64 string is
/// forwarded to providers unchanged.
fn validate_images(images: &[ChatImage]) -> Result<(), String> {
    if images.len() > MAX_IMAGES_PER_MESSAGE {
        return Err(format!(
            "too many images: {} (maximum {})",
            images.len(),
            MAX_IMAGES_PER_MESSAGE
        ));
    }
    for img in images {
        let mime = img.mime_type.to_ascii_lowercase();
        if !ALLOWED_IMAGE_MIME_TYPES.contains(&mime.as_str()) {
            return Err(format!("unsupported image type: {}", img.mime_type));
        }
        let decoded = BASE64
            .decode(img.data_base64.as_bytes())
            .map_err(|_| "image data is not valid base64".to_string())?;
        if decoded.len() > MAX_IMAGE_BYTES {
            return Err(format!(
                "image exceeds maximum size of {} bytes",
                MAX_IMAGE_BYTES
            ));
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Authentication commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn ai_auth_start(
    app: AppHandle,
    state: State<'_, AIServiceState>,
    approved_keys: State<'_, ApprovedServiceAccountKeys>,
    credentials: Value,
) -> Result<bool, String> {
    validate_service_account_key(&credentials, &approved_keys).await?;
    cancel_all_inflight(&state);
    let mut service = state.service.write().await;
    service.authenticate(&app, credentials).await
}

#[tauri::command]
pub async fn ai_auth_auto(
    app: AppHandle,
    state: State<'_, AIServiceState>,
    credentials: Value,
) -> Result<bool, String> {
    // No key-file path attestation here: Vertex AI's `auto_auth` for
    // service-account loads `client_email` + `private_key` from the
    // DPAPI-encrypted on-disk config and never re-reads the user's key
    // file, so the renderer-supplied `keyFilePath` is unused on this path.
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {e}"))?;
    cancel_all_inflight(&state);
    let mut service = state.service.write().await;
    service.auto_auth(&app_data_dir, credentials).await
}

#[tauri::command]
pub async fn ai_auth_status(state: State<'_, AIServiceState>) -> Result<AuthStatus, String> {
    let service = state.service.read().await;
    Ok(service.get_auth_status())
}

#[tauri::command]
pub async fn ai_auth_logout(
    app: AppHandle,
    state: State<'_, AIServiceState>,
) -> Result<(), String> {
    cancel_all_inflight(&state);
    let mut service = state.service.write().await;
    service.logout();
    crate::services::ai::ai_provider::emit_auth_logout(&app);
    Ok(())
}

// ---------------------------------------------------------------------------
// Chat commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn ai_chat_send(
    app: AppHandle,
    state: State<'_, AIServiceState>,
    session_id: String,
    message: String,
    model: String,
    system_instruction: Option<String>,
    images: Option<Vec<ChatImage>>,
) -> Result<(), String> {
    validate_session_id(&session_id)?;
    let images = images.unwrap_or_default();
    // An image-only send (no text) is allowed; otherwise the text must be valid.
    if message.is_empty() && !images.is_empty() {
        // ok: image(s) present, empty message permitted
    } else {
        validate_message(&message)?;
    }
    validate_images(&images)?;

    // Register a cancellation token OUTSIDE the service lock before streaming, so
    // ai_chat_cancel (Stop / watchdog) can interrupt this stream without touching
    // the service lock. The stream itself holds only a READ lock, so concurrent
    // sends from other tabs/windows run in parallel rather than serializing.
    let gen = SEND_GEN.fetch_add(1, Ordering::Relaxed);
    let cancel_token = CancellationToken::new();
    {
        let mut cancels = state.cancels.lock().unwrap();
        // A superseding send for the same session cancels the previous stream.
        if let Some((_, prev)) = cancels.insert(session_id.clone(), (gen, cancel_token.clone())) {
            prev.cancel();
        }
    }

    // Backstop deadline guard: cancels the same token if the stream outlives the
    // frontend watchdog (e.g. the UI crashed), so send_message unwinds gracefully
    // and releases its read lock instead of blocking writes (auth/logout/switch),
    // which — under tokio's write-preferring RwLock — would then stall new sends.
    let deadline_token = cancel_token.clone();
    let deadline_guard = tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(STREAM_DEADLINE_SECS)).await;
        log::warn!("[ai] stream exceeded backstop deadline; cancelling");
        deadline_token.cancel();
    });

    let result = {
        let service = state.service.read().await;
        service
            .send_message(
                &app,
                &session_id,
                &message,
                &model,
                system_instruction.as_deref(),
                images,
                cancel_token,
            )
            .await
    };
    deadline_guard.abort();

    // Deregister — but only if we're still the current entry (a newer send for the
    // same session may have replaced us while we streamed).
    {
        let mut cancels = state.cancels.lock().unwrap();
        if cancels.get(&session_id).is_some_and(|(g, _)| *g == gen) {
            cancels.remove(&session_id);
        }
    }
    result
}

#[tauri::command]
pub async fn ai_chat_cancel(
    state: State<'_, AIServiceState>,
    session_id: String,
) -> Result<(), String> {
    validate_session_id(&session_id)?;
    // Cancel WITHOUT taking the service lock (the stream holds it). The streaming
    // send selects on the token and unwinds, releasing the service lock.
    let token = state
        .cancels
        .lock()
        .unwrap()
        .get(&session_id)
        .map(|(_, t)| t.clone());
    if let Some(token) = token {
        token.cancel();
    }
    Ok(())
}

#[tauri::command]
pub async fn ai_chat_clear(
    state: State<'_, AIServiceState>,
    session_id: String,
) -> Result<(), String> {
    validate_session_id(&session_id)?;
    // Read lock: clear_history is interior-mutable, so New Chat / tab close never
    // blocks (or is blocked by) an in-flight stream.
    let service = state.service.read().await;
    service.clear_history(&session_id);
    Ok(())
}

/// One-shot command-safety classification. History-less and non-streaming:
/// returns a structured verdict the frontend uses to decide auto-execution.
/// Bounded by `CLASSIFY_TIMEOUT_SECS` so a hung provider can't stall the gate.
#[tauri::command]
pub async fn ai_classify_command(
    state: State<'_, AIServiceState>,
    command: String,
    model: String,
) -> Result<CommandVerdict, String> {
    validate_command(&command)?;
    // Read lock: classification now runs CONCURRENTLY with in-flight streams
    // (both are read-shaped), so it no longer queues behind a send. The 12s
    // timeout still bounds a hung provider, and acquiring the lock inside it keeps
    // the guarantee even against a pending writer.
    match tokio::time::timeout(
        std::time::Duration::from_secs(CLASSIFY_TIMEOUT_SECS),
        async {
            let service = state.service.read().await;
            service.classify_command(&command, &model).await
        },
    )
    .await
    {
        Ok(result) => result,
        Err(_) => Err("classification timed out".into()),
    }
}

// ---------------------------------------------------------------------------
// Model & location commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn ai_list_models(state: State<'_, AIServiceState>) -> Result<Vec<ModelInfo>, String> {
    let service = state.service.read().await;
    service.list_models().await
}

#[tauri::command]
pub async fn ai_list_locations(state: State<'_, AIServiceState>) -> Result<Vec<String>, String> {
    let service = state.service.read().await;
    service.list_locations().await
}

// ---------------------------------------------------------------------------
// Provider & configuration commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn ai_set_provider(
    state: State<'_, AIServiceState>,
    provider_id: String,
) -> Result<(), String> {
    cancel_all_inflight(&state);
    let mut service = state.service.write().await;
    service.set_active_provider(&provider_id)
}

#[tauri::command]
pub async fn ai_set_location(
    state: State<'_, AIServiceState>,
    location: String,
) -> Result<(), String> {
    cancel_all_inflight(&state);
    let mut service = state.service.write().await;
    service.set_location(&location);
    Ok(())
}

#[tauri::command]
pub async fn select_service_account_key_file(
    app: AppHandle,
    approved_keys: State<'_, ApprovedServiceAccountKeys>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let file = app
        .dialog()
        .file()
        .add_filter("JSON files", &["json"])
        .set_title("Select Service Account Key File")
        .blocking_pick_file();

    match file {
        Some(p) => {
            let path_str = p.to_string();
            if let Ok(resolved) = resolve_path(&path_str) {
                let mut set = approved_keys.inner.lock().await;
                set.insert(resolved);
            }
            Ok(Some(path_str))
        }
        None => Ok(None),
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_session_id_empty() {
        assert!(validate_session_id("").is_err());
    }

    #[test]
    fn validate_session_id_valid() {
        assert!(validate_session_id("abc-123").is_ok());
    }

    #[test]
    fn validate_message_empty() {
        assert!(validate_message("").is_err());
    }

    #[test]
    fn validate_message_too_long() {
        let msg = "a".repeat(MAX_MESSAGE_LENGTH + 1);
        assert!(validate_message(&msg).is_err());
    }

    #[test]
    fn validate_message_valid() {
        assert!(validate_message("Hello, AI!").is_ok());
    }

    #[test]
    fn validate_message_at_limit() {
        let msg = "a".repeat(MAX_MESSAGE_LENGTH);
        assert!(validate_message(&msg).is_ok());
    }

    #[test]
    fn validate_command_empty() {
        assert!(validate_command("").is_err());
        assert!(validate_command("   ").is_err());
    }

    #[test]
    fn validate_command_valid() {
        assert!(validate_command("ls -la").is_ok());
    }

    #[test]
    fn validate_command_too_long() {
        let cmd = "a".repeat(MAX_COMMAND_LENGTH + 1);
        assert!(validate_command(&cmd).is_err());
    }

    #[test]
    fn validate_command_at_limit() {
        let cmd = "a".repeat(MAX_COMMAND_LENGTH);
        assert!(validate_command(&cmd).is_ok());
    }

    fn img(mime: &str, bytes: usize) -> ChatImage {
        ChatImage {
            mime_type: mime.to_string(),
            data_base64: BASE64.encode(vec![0u8; bytes]),
        }
    }

    #[test]
    fn validate_images_accepts_allowed_types() {
        for mime in ["image/png", "image/jpeg", "image/webp", "image/gif"] {
            assert!(
                validate_images(&[img(mime, 32)]).is_ok(),
                "{mime} should pass"
            );
        }
    }

    #[test]
    fn validate_images_accepts_mixed_case_mime() {
        assert!(validate_images(&[img("IMAGE/PNG", 16)]).is_ok());
    }

    #[test]
    fn validate_images_empty_is_ok() {
        assert!(validate_images(&[]).is_ok());
    }

    #[test]
    fn validate_images_rejects_unsupported_type() {
        assert!(validate_images(&[img("image/svg+xml", 16)]).is_err());
        assert!(validate_images(&[img("application/pdf", 16)]).is_err());
    }

    #[test]
    fn validate_images_rejects_over_size() {
        assert!(validate_images(&[img("image/png", MAX_IMAGE_BYTES + 1)]).is_err());
    }

    #[test]
    fn validate_images_accepts_at_size_limit() {
        assert!(validate_images(&[img("image/png", MAX_IMAGE_BYTES)]).is_ok());
    }

    #[test]
    fn validate_images_rejects_bad_base64() {
        let bad = ChatImage {
            mime_type: "image/png".to_string(),
            data_base64: "not valid base64!!!".to_string(),
        };
        assert!(validate_images(&[bad]).is_err());
    }

    #[test]
    fn validate_images_rejects_over_count() {
        let imgs: Vec<ChatImage> = (0..MAX_IMAGES_PER_MESSAGE + 1)
            .map(|_| img("image/png", 8))
            .collect();
        assert!(validate_images(&imgs).is_err());
    }

    #[test]
    fn validate_images_accepts_at_count_limit() {
        let imgs: Vec<ChatImage> = (0..MAX_IMAGES_PER_MESSAGE)
            .map(|_| img("image/png", 8))
            .collect();
        assert!(validate_images(&imgs).is_ok());
    }

    #[tokio::test]
    async fn validate_service_account_key_skips_non_service_account() {
        let approved = ApprovedServiceAccountKeys::new();
        let creds = serde_json::json!({"authType": "adc"});
        assert!(validate_service_account_key(&creds, &approved)
            .await
            .is_ok());
    }

    #[tokio::test]
    async fn validate_service_account_key_rejects_missing_path() {
        let approved = ApprovedServiceAccountKeys::new();
        let creds = serde_json::json!({"authType": "service_account"});
        assert!(validate_service_account_key(&creds, &approved)
            .await
            .is_err());
    }

    #[tokio::test]
    async fn validate_service_account_key_rejects_unapproved_path() {
        let approved = ApprovedServiceAccountKeys::new();
        let dir = std::env::temp_dir().join("hotty_ai_unapproved_test");
        let _ = std::fs::create_dir_all(&dir);
        let key_file = dir.join("key.json");
        std::fs::write(&key_file, "{}").unwrap();

        let creds = serde_json::json!({
            "authType": "service_account",
            "keyFilePath": key_file.to_string_lossy(),
        });
        let err = validate_service_account_key(&creds, &approved)
            .await
            .unwrap_err();
        assert!(err.contains("not approved"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn validate_service_account_key_accepts_approved_path() {
        let approved = ApprovedServiceAccountKeys::new();
        let dir = std::env::temp_dir().join("hotty_ai_approved_test");
        let _ = std::fs::create_dir_all(&dir);
        let key_file = dir.join("key.json");
        std::fs::write(&key_file, "{}").unwrap();

        let resolved = resolve_path(&key_file.to_string_lossy()).unwrap();
        approved.inner.lock().await.insert(resolved);

        let creds = serde_json::json!({
            "authType": "service_account",
            "keyFilePath": key_file.to_string_lossy(),
        });
        assert!(validate_service_account_key(&creds, &approved)
            .await
            .is_ok());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn validate_service_account_key_rejects_unc_path() {
        let approved = ApprovedServiceAccountKeys::new();
        let creds = serde_json::json!({
            "authType": "service_account",
            "keyFilePath": r"\\attacker\share\key.json",
        });
        let err = validate_service_account_key(&creds, &approved)
            .await
            .unwrap_err();
        assert!(err.contains("UNC"));

        let creds = serde_json::json!({
            "authType": "service_account",
            "keyFilePath": "//attacker/share/key.json",
        });
        let err = validate_service_account_key(&creds, &approved)
            .await
            .unwrap_err();
        assert!(err.contains("UNC"));
    }
}
