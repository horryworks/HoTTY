use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;
use tauri::{AppHandle, Emitter};
use tokio_util::sync::CancellationToken;

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AuthType {
    #[serde(rename = "oauth2")]
    OAuth2,
    ServiceAccount,
    ApiKey,
    Adc,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    pub authenticated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_info: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub name: String,
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsage {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_token_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub candidates_token_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_token_count: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatResponseData {
    pub session_id: String,
    pub response_type: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage_metadata: Option<TokenUsage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthResultPayload {
    /// Provider id that produced this result (e.g. "gemini"). Lets the frontend
    /// ignore a late result for a provider the user has since switched away from.
    pub provider: String,
    pub success: bool,
}

// ---------------------------------------------------------------------------
// AIProvider trait
// ---------------------------------------------------------------------------

#[async_trait]
pub trait AIProvider: Send + Sync {
    /// Unique provider identifier (e.g. "openai", "anthropic").
    fn id(&self) -> &str;

    /// Human-readable display name.
    fn display_name(&self) -> &str;

    /// Authentication mechanism used by this provider.
    fn auth_type(&self) -> AuthType;

    /// Start an interactive authentication flow.
    async fn authenticate(&mut self, app: &AppHandle, credentials: Value) -> Result<bool, String>;

    /// Attempt to restore a previous session from persisted credentials.
    async fn auto_auth(&mut self, app_data_dir: &Path, credentials: Value) -> Result<bool, String>;

    /// Return the current authentication status.
    fn get_auth_status(&self) -> AuthStatus;

    /// Clear all credentials and persisted state.
    fn logout(&mut self);

    /// Send a chat message and stream the response via `ai-chat-response` events.
    ///
    /// `cancel_token` is created and owned by the command layer and also held in a
    /// registry outside the service lock, so `ai_chat_cancel` can interrupt this
    /// stream WITHOUT waiting on the (stream-held) service mutex. Providers must
    /// select on `cancel_token.cancelled()` in their stream loop.
    async fn send_message(
        &mut self,
        app: &AppHandle,
        session_id: &str,
        message: &str,
        model: &str,
        system_instruction: Option<&str>,
        cancel_token: CancellationToken,
    ) -> Result<(), String>;

    /// One-shot, history-less command-safety classification.
    ///
    /// Sends the command (as untrusted data) to the provider with a neutral
    /// classifier system prompt and structured-JSON output, returning a parsed
    /// [`CommandVerdict`]. This MUST NOT touch the conversation history used by
    /// `send_message`. The default implementation returns an error so providers
    /// that don't implement it degrade gracefully (the frontend falls back to
    /// requiring manual execution).
    async fn classify_command(
        &mut self,
        _command: &str,
        _model: &str,
    ) -> Result<crate::services::ai::classifier::CommandVerdict, String> {
        Err("command classification is not supported by this provider".into())
    }

    /// Cancel an in-flight message for the given session.
    fn cancel_message(&mut self, session_id: &str);

    /// Clear the conversation history for the given session.
    fn clear_history(&mut self, session_id: &str);

    /// List available models for this provider.
    ///
    /// Takes `&mut self` so OAuth-token providers (Vertex AI, Gemini) can
    /// refresh an expired access token before listing — mirroring
    /// `send_message`. Without this, an expired/not-yet-refreshed token made
    /// `list_models` return an empty list, which the UI surfaced as a spurious
    /// "Failed to retrieve the AI model list" error until the app was restarted.
    async fn list_models(&mut self) -> Result<Vec<ModelInfo>, String>;

    /// Set the deployment location/region (Vertex AI). Default is a no-op.
    fn set_location(&mut self, _location: &str) {}

    /// List available locations/regions. Default returns an empty list.
    ///
    /// `&mut self` for the same token-refresh reason as [`list_models`].
    async fn list_locations(&mut self) -> Result<Vec<String>, String> {
        Ok(vec![])
    }
}

// ---------------------------------------------------------------------------
// Helper: emit chat response event
// ---------------------------------------------------------------------------

pub fn emit_chat_response(app: &AppHandle, data: ChatResponseData) {
    let _ = app.emit("ai-chat-response", data);
}

pub fn emit_auth_result(app: &AppHandle, provider: &str, success: bool) {
    let _ = app.emit(
        "ai-auth-result",
        AuthResultPayload {
            provider: provider.to_string(),
            success,
        },
    );
}

/// Broadcast an explicit logout to every window so all AI Chat panes and
/// Settings tabs drop their authenticated state. Distinct from
/// `ai-auth-result { success: false }`, which means "a sign-in attempt failed".
pub fn emit_auth_logout(app: &AppHandle) {
    let _ = app.emit("ai-auth-logout", ());
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_type_serializes_as_snake_case() {
        assert_eq!(
            serde_json::to_string(&AuthType::ApiKey).unwrap(),
            r#""api_key""#
        );
        assert_eq!(
            serde_json::to_string(&AuthType::OAuth2).unwrap(),
            r#""oauth2""#
        );
    }

    #[test]
    fn auth_status_serializes_camel_case() {
        let status = AuthStatus {
            authenticated: true,
            account_info: Some("user@example.com".into()),
        };
        let json = serde_json::to_value(&status).unwrap();
        assert_eq!(json["authenticated"], true);
        assert_eq!(json["accountInfo"], "user@example.com");
    }

    #[test]
    fn auth_status_omits_none_fields() {
        let status = AuthStatus {
            authenticated: false,
            account_info: None,
        };
        let json = serde_json::to_value(&status).unwrap();
        assert!(json.get("accountInfo").is_none());
    }

    #[test]
    fn auth_result_payload_carries_provider() {
        let payload = AuthResultPayload {
            provider: "gemini".into(),
            success: true,
        };
        let json = serde_json::to_value(&payload).unwrap();
        assert_eq!(json["provider"], "gemini");
        assert_eq!(json["success"], true);
    }

    #[test]
    fn model_info_serializes() {
        let info = ModelInfo {
            name: "gpt-4o".into(),
            display_name: "GPT-4o".into(),
        };
        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(json["name"], "gpt-4o");
        assert_eq!(json["displayName"], "GPT-4o");
    }

    #[test]
    fn chat_response_data_serializes() {
        let data = ChatResponseData {
            session_id: "s1".into(),
            response_type: "chunk".into(),
            content: "hello".into(),
            usage_metadata: None,
        };
        let json = serde_json::to_value(&data).unwrap();
        assert_eq!(json["sessionId"], "s1");
        assert_eq!(json["responseType"], "chunk");
        assert!(json.get("usageMetadata").is_none());
    }

    #[test]
    fn chat_response_data_with_usage() {
        let data = ChatResponseData {
            session_id: "s1".into(),
            response_type: "done".into(),
            content: "full response".into(),
            usage_metadata: Some(TokenUsage {
                prompt_token_count: Some(100),
                candidates_token_count: Some(200),
                total_token_count: Some(300),
            }),
        };
        let json = serde_json::to_value(&data).unwrap();
        let usage = &json["usageMetadata"];
        assert_eq!(usage["promptTokenCount"], 100);
        assert_eq!(usage["candidatesTokenCount"], 200);
        assert_eq!(usage["totalTokenCount"], 300);
    }
}
