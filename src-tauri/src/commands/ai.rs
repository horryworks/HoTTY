use serde_json::Value;
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;

use crate::services::ai::{AIService, AuthStatus, AuthType, ModelInfo, ProviderInfo};

/// Managed state holding the AI service behind an async-aware mutex.
pub struct AIServiceState {
    pub service: Mutex<AIService>,
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const MAX_MESSAGE_LENGTH: usize = 1_000_000;

fn validate_session_id(session_id: &str) -> Result<(), String> {
    if session_id.is_empty() {
        return Err("session_id must not be empty".into());
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
    credentials: Value,
) -> Result<bool, String> {
    let mut service = state.service.lock().await;
    service.authenticate(&app, credentials).await
}

#[tauri::command]
pub async fn ai_auth_auto(
    app: AppHandle,
    state: State<'_, AIServiceState>,
    credentials: Value,
) -> Result<bool, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {e}"))?;
    let mut service = state.service.lock().await;
    service.auto_auth(&app_data_dir, credentials).await
}

#[tauri::command]
pub async fn ai_auth_status(
    state: State<'_, AIServiceState>,
) -> Result<AuthStatus, String> {
    let service = state.service.lock().await;
    Ok(service.get_auth_status())
}

#[tauri::command]
pub async fn ai_auth_logout(
    state: State<'_, AIServiceState>,
) -> Result<(), String> {
    let mut service = state.service.lock().await;
    service.logout();
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

// ---------------------------------------------------------------------------
// Model & location commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn ai_list_models(
    state: State<'_, AIServiceState>,
) -> Result<Vec<ModelInfo>, String> {
    let service = state.service.lock().await;
    service.list_models().await
}

#[tauri::command]
pub async fn ai_list_locations(
    state: State<'_, AIServiceState>,
) -> Result<Vec<String>, String> {
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
pub async fn ai_list_providers(
    state: State<'_, AIServiceState>,
) -> Result<Vec<ProviderInfo>, String> {
    let service = state.service.lock().await;
    Ok(service.list_providers())
}

#[tauri::command]
pub async fn ai_get_auth_type(
    state: State<'_, AIServiceState>,
) -> Result<AuthType, String> {
    let service = state.service.lock().await;
    Ok(service.get_auth_type())
}

#[tauri::command]
pub async fn select_service_account_key_file(
    app: AppHandle,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let file = app
        .dialog()
        .file()
        .add_filter("JSON files", &["json"])
        .set_title("Select Service Account Key File")
        .blocking_pick_file();

    Ok(file.map(|f| f.to_string()))
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
}
