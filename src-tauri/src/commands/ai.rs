use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::Value;
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;

use crate::services::ai::{AIService, AuthStatus, CommandVerdict, ModelInfo};
use crate::services::path_safety::{is_sensitive_path, is_unc_path};

/// Managed state holding the AI service behind an async-aware mutex.
pub struct AIServiceState {
    pub service: Mutex<AIService>,
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
    let mut service = state.service.lock().await;
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
    let mut service = state.service.lock().await;
    service.auto_auth(&app_data_dir, credentials).await
}

#[tauri::command]
pub async fn ai_auth_status(state: State<'_, AIServiceState>) -> Result<AuthStatus, String> {
    let service = state.service.lock().await;
    Ok(service.get_auth_status())
}

#[tauri::command]
pub async fn ai_auth_logout(
    app: AppHandle,
    state: State<'_, AIServiceState>,
) -> Result<(), String> {
    let mut service = state.service.lock().await;
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
) -> Result<(), String> {
    validate_session_id(&session_id)?;
    validate_message(&message)?;

    let mut service = state.service.lock().await;
    service
        .send_message(
            &app,
            &session_id,
            &message,
            &model,
            system_instruction.as_deref(),
        )
        .await
}

#[tauri::command]
pub async fn ai_chat_cancel(
    state: State<'_, AIServiceState>,
    session_id: String,
) -> Result<(), String> {
    validate_session_id(&session_id)?;
    let mut service = state.service.lock().await;
    service.cancel_message(&session_id);
    Ok(())
}

#[tauri::command]
pub async fn ai_chat_clear(
    state: State<'_, AIServiceState>,
    session_id: String,
) -> Result<(), String> {
    validate_session_id(&session_id)?;
    let mut service = state.service.lock().await;
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
    let mut service = state.service.lock().await;
    match tokio::time::timeout(
        std::time::Duration::from_secs(CLASSIFY_TIMEOUT_SECS),
        service.classify_command(&command, &model),
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
    let service = state.service.lock().await;
    service.list_models().await
}

#[tauri::command]
pub async fn ai_list_locations(state: State<'_, AIServiceState>) -> Result<Vec<String>, String> {
    let service = state.service.lock().await;
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
    let mut service = state.service.lock().await;
    service.set_active_provider(&provider_id)
}

#[tauri::command]
pub async fn ai_set_location(
    state: State<'_, AIServiceState>,
    location: String,
) -> Result<(), String> {
    let mut service = state.service.lock().await;
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
