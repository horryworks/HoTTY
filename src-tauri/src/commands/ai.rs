use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex, MutexGuard as StdMutexGuard, PoisonError};

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
    pub cancels: CancelRegistry,
    /// One queue per conversation. A send, a clear and the next send run in
    /// arrival order, so a superseded or cleared turn finishes writing history
    /// before the next one reads or writes it.
    pub gates: SessionGates,
}

impl AIServiceState {
    pub fn new(service: AIService) -> Self {
        Self {
            service: RwLock::new(service),
            cancels: StdMutex::new(HashMap::new()),
            gates: SessionGates::default(),
        }
    }
}

/// In-flight (or queued) send per session: `(send generation, its token)`.
pub type CancelRegistry = StdMutex<HashMap<String, (u64, CancellationToken)>>;

/// Per-conversation FIFO locks (`tokio::sync::Mutex` wakes waiters in order).
/// An entry lives only while someone holds or waits on it.
#[derive(Default)]
pub struct SessionGates {
    inner: StdMutex<HashMap<String, Arc<Mutex<()>>>>,
}

impl SessionGates {
    /// Take a place for `session_id`; `GateLease::lock` waits for its turn.
    pub fn lease(&self, session_id: &str) -> GateLease<'_> {
        let gate = self
            .map()
            .entry(session_id.to_string())
            .or_default()
            .clone();
        GateLease {
            gates: self,
            session_id: session_id.to_string(),
            gate,
        }
    }

    fn map(&self) -> StdMutexGuard<'_, HashMap<String, Arc<Mutex<()>>>> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

pub struct GateLease<'a> {
    gates: &'a SessionGates,
    session_id: String,
    gate: Arc<Mutex<()>>,
}

impl GateLease<'_> {
    /// Wait until every earlier send or clear on this conversation is done.
    pub async fn lock(&self) -> tokio::sync::MutexGuard<'_, ()> {
        self.gate.lock().await
    }
}

impl Drop for GateLease<'_> {
    fn drop(&mut self) {
        let mut map = self.gates.map();
        // Gates are cloned only under this lock, so the count is stable here:
        // the map's copy plus ours means nobody else holds or waits on it.
        if Arc::strong_count(&self.gate) == 2
            && map
                .get(&self.session_id)
                .is_some_and(|g| Arc::ptr_eq(g, &self.gate))
        {
            map.remove(&self.session_id);
        }
    }
}

/// Fire the token of the send running or queued for `session_id`. Returns
/// whether there was one.
fn cancel_session(cancels: &CancelRegistry, session_id: &str) -> bool {
    let token = cancels
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .get(session_id)
        .map(|(_, t)| t.clone());
    match token {
        Some(token) => {
            token.cancel();
            true
        }
        None => false,
    }
}

/// Run one chat send in its conversation's queue. `send` receives the token
/// that Stop, a superseding send, a clear and the backstop deadline fire.
async fn run_send<F, Fut>(
    cancels: &CancelRegistry,
    gates: &SessionGates,
    session_id: &str,
    send: F,
) -> Result<(), String>
where
    F: FnOnce(CancellationToken) -> Fut,
    Fut: Future<Output = Result<(), String>>,
{
    // Register before queueing so Stop reaches a send that is still waiting.
    let gen = SEND_GEN.fetch_add(1, Ordering::Relaxed);
    let cancel_token = CancellationToken::new();
    {
        let mut cancels = cancels.lock().unwrap_or_else(PoisonError::into_inner);
        // A superseding send for the same session cancels the previous stream.
        if let Some((_, prev)) = cancels.insert(session_id.to_string(), (gen, cancel_token.clone()))
        {
            prev.cancel();
        }
    }

    // Wait for the superseded send to close its turn; otherwise this question
    // lands in history before that answer does.
    let lease = gates.lease(session_id);
    let _turn = lease.lock().await;

    let result = if cancel_token.is_cancelled() {
        // Stopped, superseded or cleared while queued: never start. Starting
        // would write the question to history and open a billed request.
        Ok(())
    } else {
        // Backstop deadline guard: cancels the same token if the send outlives
        // the frontend watchdog (e.g. the UI crashed), so it unwinds gracefully
        // and releases its read lock instead of blocking writes
        // (auth/logout/switch), which — under tokio's write-preferring RwLock —
        // would then stall new sends. Started after the queue so waiting does
        // not count against it.
        let deadline_token = cancel_token.clone();
        let deadline_guard = tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(STREAM_DEADLINE_SECS)).await;
            log::warn!("[ai] stream exceeded backstop deadline; cancelling");
            deadline_token.cancel();
        });
        let result = send(cancel_token).await;
        deadline_guard.abort();
        result
    };

    // Deregister — but only if we're still the current entry (a newer send for the
    // same session may have replaced us while we streamed or waited).
    {
        let mut cancels = cancels.lock().unwrap_or_else(PoisonError::into_inner);
        if cancels.get(session_id).is_some_and(|(g, _)| *g == gen) {
            cancels.remove(session_id);
        }
    }
    result
}

/// Clear a conversation: stop its send, then wait for that send to close its
/// turn so nothing it writes afterwards survives the clear.
async fn run_clear<F, Fut>(
    cancels: &CancelRegistry,
    gates: &SessionGates,
    session_id: &str,
    clear: F,
) where
    F: FnOnce() -> Fut,
    Fut: Future<Output = ()>,
{
    cancel_session(cancels, session_id);
    let lease = gates.lease(session_id);
    let _turn = lease.lock().await;
    clear().await;
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

    // The cancellation token is registered OUTSIDE the service lock, so
    // ai_chat_cancel (Stop / watchdog) can interrupt this stream without touching
    // the service lock. The stream itself holds only a READ lock, so sends from
    // other tabs/windows run in parallel; only the same conversation queues.
    // Lock order is always gate → service, and writers never take a gate.
    let ai = state.inner();
    let sid = session_id.as_str();
    let (app, message, model) = (&app, message.as_str(), model.as_str());
    let system_instruction = system_instruction.as_deref();
    run_send(&ai.cancels, &ai.gates, sid, |cancel_token| async move {
        let service = ai.service.read().await;
        service
            .send_message(
                app,
                sid,
                message,
                model,
                system_instruction,
                images,
                cancel_token,
            )
            .await
    })
    .await
}

#[tauri::command]
pub async fn ai_chat_cancel(
    state: State<'_, AIServiceState>,
    session_id: String,
) -> Result<(), String> {
    validate_session_id(&session_id)?;
    // Cancel WITHOUT taking the service lock (the stream holds it). The streaming
    // send selects on the token and unwinds, releasing the service lock.
    cancel_session(&state.cancels, &session_id);
    Ok(())
}

#[tauri::command]
pub async fn ai_chat_clear(
    state: State<'_, AIServiceState>,
    session_id: String,
) -> Result<(), String> {
    validate_session_id(&session_id)?;
    // New Chat, tab close and pane close all discard the conversation, so its
    // in-flight send is stopped too (it would otherwise stream, and bill, to the
    // end). Queued behind that send: a clear that ran first would be undone by
    // the turn the send writes as it closes.
    let ai = state.inner();
    let sid = session_id.as_str();
    run_clear(&ai.cancels, &ai.gates, sid, || async move {
        // Read lock: clear_history is interior-mutable.
        let service = ai.service.read().await;
        service.clear_history(sid);
    })
    .await;
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
    use crate::services::ai::history::ChatHistoryStore;
    use futures::poll;
    use std::pin::pin;
    use std::sync::atomic::AtomicBool;

    fn gate_count(gates: &SessionGates) -> usize {
        gates.map().len()
    }

    fn contents(store: &ChatHistoryStore, sid: &str) -> Vec<String> {
        store.snapshot(sid).into_iter().map(|m| m.content).collect()
    }

    #[tokio::test]
    async fn a_second_turn_on_the_same_conversation_waits_for_the_first() {
        let gates = SessionGates::default();
        let first = gates.lease("s");
        let held = first.lock().await;

        let second = gates.lease("s");
        let mut waiting = pin!(second.lock());
        assert!(poll!(waiting.as_mut()).is_pending());

        drop(held);
        let _turn = waiting.await;
    }

    #[tokio::test]
    async fn different_conversations_do_not_wait_for_each_other() {
        let gates = SessionGates::default();
        let a = gates.lease("a");
        let _held = a.lock().await;
        let b = gates.lease("b");
        let mut other = pin!(b.lock());
        assert!(poll!(other.as_mut()).is_ready());
    }

    #[tokio::test]
    async fn a_gate_is_forgotten_once_nobody_holds_or_waits_on_it() {
        let gates = SessionGates::default();
        let first = gates.lease("s");
        let held = first.lock().await;
        let second = gates.lease("s");

        drop(held);
        drop(first);
        // The waiter still needs the same gate.
        assert_eq!(gate_count(&gates), 1);
        drop(second.lock().await);
        drop(second);
        assert_eq!(gate_count(&gates), 0);
    }

    #[tokio::test]
    async fn queued_turns_run_in_arrival_order() {
        let gates = SessionGates::default();
        let order = StdMutex::new(Vec::new());
        let turn = |n: u32| {
            let gates = &gates;
            let order = &order;
            async move {
                let lease = gates.lease("s");
                let _t = lease.lock().await;
                order.lock().unwrap().push(n);
                tokio::task::yield_now().await;
            }
        };
        let mut first = pin!(turn(1));
        let mut second = pin!(turn(2));
        let mut third = pin!(turn(3));
        // Queue them 1, 2, 3 before any finishes.
        assert!(poll!(first.as_mut()).is_pending());
        assert!(poll!(second.as_mut()).is_pending());
        assert!(poll!(third.as_mut()).is_pending());
        tokio::join!(third, second, first);
        assert_eq!(*order.lock().unwrap(), vec![1, 2, 3]);
        assert_eq!(gate_count(&gates), 0);
    }

    #[tokio::test]
    async fn a_waiter_that_gives_up_leaves_no_gate_behind() {
        let gates = SessionGates::default();
        let first = gates.lease("s");
        let held = first.lock().await;
        {
            let quitter = gates.lease("s");
            let mut waiting = pin!(quitter.lock());
            assert!(poll!(waiting.as_mut()).is_pending());
        }
        drop(held);
        drop(first);
        assert_eq!(gate_count(&gates), 0);
    }

    #[test]
    fn cancel_session_fires_only_a_registered_token() {
        let cancels: CancelRegistry = StdMutex::new(HashMap::new());
        let token = CancellationToken::new();
        cancels
            .lock()
            .unwrap()
            .insert("s".into(), (1, token.clone()));
        assert!(!cancel_session(&cancels, "other"));
        assert!(!token.is_cancelled());
        assert!(cancel_session(&cancels, "s"));
        assert!(token.is_cancelled());
    }

    #[tokio::test]
    async fn a_superseding_send_writes_after_the_stopped_turn_closes() {
        let (cancels, gates) = (StdMutex::new(HashMap::new()), SessionGates::default());
        let store = &ChatHistoryStore::new(0);

        let mut old = pin!(run_send(&cancels, &gates, "s", |token| async move {
            store.push("s", "user", "U1");
            token.cancelled().await;
            store.finalize_assistant("s", "assistant", "p", true);
            Ok(())
        }));
        assert!(poll!(old.as_mut()).is_pending());

        let mut new = pin!(run_send(&cancels, &gates, "s", |_| async move {
            store.push("s", "user", "U2");
            store.finalize_assistant("s", "assistant", "A2", false);
            Ok(())
        }));
        assert!(poll!(new.as_mut()).is_pending());

        let (a, b) = tokio::join!(old, new);
        assert_eq!((a, b), (Ok(()), Ok(())));
        assert_eq!(
            contents(store, "s"),
            vec!["U1", "p\n\n[cancelled by user]", "U2", "A2"]
        );
        assert!(cancels.lock().unwrap().is_empty());
        assert_eq!(gate_count(&gates), 0);
    }

    #[tokio::test]
    async fn a_clear_lands_between_the_stopped_turn_and_the_next_send() {
        let (cancels, gates) = (StdMutex::new(HashMap::new()), SessionGates::default());
        let store = &ChatHistoryStore::new(0);

        let mut old = pin!(run_send(&cancels, &gates, "s", |token| async move {
            store.push("s", "user", "U_old");
            token.cancelled().await;
            store.finalize_assistant("s", "assistant", "", true);
            Ok(())
        }));
        assert!(poll!(old.as_mut()).is_pending());

        let mut clear = pin!(run_clear(&cancels, &gates, "s", || async move {
            store.clear("s");
        }));
        assert!(poll!(clear.as_mut()).is_pending());

        let mut new = pin!(run_send(&cancels, &gates, "s", |_| async move {
            store.push("s", "user", "U_new");
            store.finalize_assistant("s", "assistant", "A_new", false);
            Ok(())
        }));
        assert!(poll!(new.as_mut()).is_pending());

        let _ = tokio::join!(old, clear, new);
        assert_eq!(contents(store, "s"), vec!["U_new", "A_new"]);
    }

    #[tokio::test]
    async fn a_send_stopped_while_queued_never_starts() {
        let (cancels, gates) = (StdMutex::new(HashMap::new()), SessionGates::default());
        let store = &ChatHistoryStore::new(0);
        let started = &AtomicBool::new(false);

        let mut old = pin!(run_send(&cancels, &gates, "s", |token| async move {
            store.push("s", "user", "U1");
            token.cancelled().await;
            store.finalize_assistant("s", "assistant", "", true);
            Ok(())
        }));
        assert!(poll!(old.as_mut()).is_pending());

        let mut queued = pin!(run_send(&cancels, &gates, "s", |_| async move {
            started.store(true, Ordering::SeqCst);
            store.push("s", "user", "U2");
            Ok(())
        }));
        assert!(poll!(queued.as_mut()).is_pending());

        // New Chat while the second send is still waiting: it stops that one.
        let mut clear = pin!(run_clear(&cancels, &gates, "s", || async move {
            store.clear("s");
        }));
        assert!(poll!(clear.as_mut()).is_pending());

        let _ = tokio::join!(old, queued, clear);
        assert!(!started.load(Ordering::SeqCst));
        assert!(contents(store, "s").is_empty());
        assert!(cancels.lock().unwrap().is_empty());
    }

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
