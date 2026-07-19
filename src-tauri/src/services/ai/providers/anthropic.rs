use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use async_trait::async_trait;
use serde_json::Value;
use tauri::AppHandle;
use tokio_util::sync::CancellationToken;

use crate::services::ai::ai_provider::{
    emit_auth_result, emit_chat_response, AIProvider, AppHandleSink, AuthStatus, AuthType,
    ChatResponseData, ModelInfo,
};
use crate::services::ai::classifier::{
    anthropic_verdict_tool, build_user_prompt, parse_anthropic_tool_verdict, CommandVerdict,
    CLASSIFIER_SYSTEM_PROMPT,
};
use crate::services::ai::config_store::EncryptedConfigStore;
use crate::services::ai::errors::{describe_http_error, describe_transport_error};
use crate::services::ai::history::ChatHistoryStore;
use crate::services::ai::sse::run_anthropic_sse_stream;
use crate::services::ai::streaming::MAX_HISTORY_MESSAGES;
use crate::services::ai::validation::{is_valid_api_key, is_valid_model};

// ---------------------------------------------------------------------------
// Validation patterns
// ---------------------------------------------------------------------------

const CONFIG_FILE_NAME: &str = "anthropic_config.json";
const ANTHROPIC_VERSION: &str = "2023-06-01";
const MAX_TOKENS: u32 = 8192;

// ---------------------------------------------------------------------------
// Fallback models
// ---------------------------------------------------------------------------

fn fallback_models() -> Vec<ModelInfo> {
    vec![
        ModelInfo {
            name: "claude-opus-4-6".into(),
            display_name: "Claude Opus 4.6".into(),
        },
        ModelInfo {
            name: "claude-sonnet-4-6".into(),
            display_name: "Claude Sonnet 4.6".into(),
        },
        ModelInfo {
            name: "claude-haiku-4-5-20251001".into(),
            display_name: "Claude Haiku 4.5".into(),
        },
    ]
}

// ---------------------------------------------------------------------------
// AnthropicProvider
// ---------------------------------------------------------------------------

pub struct AnthropicProvider {
    api_key: Option<String>,
    history: ChatHistoryStore,
    cancel_tokens: Mutex<HashMap<String, CancellationToken>>,
    app_data_dir: PathBuf,
    http_client: reqwest::Client,
}

impl AnthropicProvider {
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self {
            api_key: None,
            history: ChatHistoryStore::new(MAX_HISTORY_MESSAGES),
            cancel_tokens: Mutex::new(HashMap::new()),
            app_data_dir,
            // connect_timeout fails fast on unreachable endpoints. No request
            // timeout — streaming responses (SSE) can run for minutes; the
            // frontend stream watchdog handles stalled streams.
            http_client: reqwest::Client::builder()
                .connect_timeout(std::time::Duration::from_secs(30))
                .build()
                .unwrap_or_else(|_| reqwest::Client::new()),
        }
    }

    fn store(&self) -> EncryptedConfigStore {
        EncryptedConfigStore::new(&self.app_data_dir, CONFIG_FILE_NAME, "anthropic")
    }

    fn save_config(&self) -> Result<(), String> {
        let key = self.api_key.as_deref().ok_or("No API key to save")?;
        self.store().save(key)
    }

    fn load_config(&self) -> Result<Option<String>, String> {
        match self.store().load()? {
            Some(api_key) if is_valid_api_key(&api_key) => Ok(Some(api_key)),
            _ => Ok(None),
        }
    }

    fn delete_config(&self) {
        self.store().delete();
    }
}

#[async_trait]
impl AIProvider for AnthropicProvider {
    fn id(&self) -> &str {
        "anthropic"
    }

    fn display_name(&self) -> &str {
        "Anthropic (Claude)"
    }

    fn auth_type(&self) -> AuthType {
        AuthType::ApiKey
    }

    async fn authenticate(&mut self, app: &AppHandle, credentials: Value) -> Result<bool, String> {
        let api_key = credentials
            .get("apiKey")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        if !is_valid_api_key(api_key) {
            log::warn!("[anthropic] Auth rejected: invalid API key format");
            emit_auth_result(app, self.id(), false);
            return Ok(false);
        }

        let response = self
            .http_client
            .get("https://api.anthropic.com/v1/models")
            .header("x-api-key", api_key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .timeout(std::time::Duration::from_secs(15))
            .send()
            .await
            .map_err(|e| format!("Anthropic auth request failed: {e}"))?;

        if !response.status().is_success() {
            log::warn!(
                "[anthropic] API key validation failed: {}",
                response.status()
            );
            emit_auth_result(app, self.id(), false);
            return Ok(false);
        }

        self.api_key = Some(api_key.to_string());
        if let Err(e) = self.save_config() {
            log::error!(
                "[anthropic] Failed to persist API key to {}: {e} — auth succeeded for this session but the key will not survive a restart",
                self.store().path().display()
            );
        }
        log::info!("[anthropic] Auth success");
        emit_auth_result(app, self.id(), true);
        Ok(true)
    }

    async fn auto_auth(
        &mut self,
        _app_data_dir: &Path,
        _credentials: Value,
    ) -> Result<bool, String> {
        match self.load_config()? {
            Some(key) => {
                self.api_key = Some(key);
                log::info!("[anthropic] Auto-auth success");
                Ok(true)
            }
            None => Ok(false),
        }
    }

    fn get_auth_status(&self) -> AuthStatus {
        AuthStatus {
            authenticated: self.api_key.is_some(),
            account_info: None,
        }
    }

    fn logout(&mut self) {
        log::info!("[anthropic] Logout");
        self.api_key = None;
        self.history.clear_all();
        for (_, token) in self.cancel_tokens.lock().unwrap().drain() {
            token.cancel();
        }
        self.delete_config();
    }

    async fn send_message(
        &self,
        app: &AppHandle,
        session_id: &str,
        message: &str,
        model: &str,
        system_instruction: Option<&str>,
        cancel_token: CancellationToken,
    ) -> Result<(), String> {
        if !is_valid_model(model) {
            emit_chat_response(
                app,
                ChatResponseData {
                    session_id: session_id.to_string(),
                    response_type: "error".into(),
                    content: "Invalid model name.".into(),
                    usage_metadata: None,
                },
            );
            return Ok(());
        }

        let api_key = match &self.api_key {
            Some(k) => k.clone(),
            None => {
                emit_chat_response(
                    app,
                    ChatResponseData {
                        session_id: session_id.to_string(),
                        response_type: "error".into(),
                        content: "Not authenticated. Please provide an Anthropic API key.".into(),
                        usage_metadata: None,
                    },
                );
                return Ok(());
            }
        };

        // Add user message to history
        self.history.push(session_id, "user", message);

        // Build request body (Anthropic format) from the current history snapshot
        let messages: Vec<serde_json::Value> = self
            .history
            .snapshot(session_id)
            .into_iter()
            .map(|msg| serde_json::json!({"role": msg.role, "content": msg.content}))
            .collect();

        let mut body = serde_json::json!({
            "model": model,
            "max_tokens": MAX_TOKENS,
            "messages": messages,
            "stream": true,
        });

        if let Some(sys) = system_instruction {
            body.as_object_mut()
                .unwrap()
                .insert("system".into(), serde_json::json!(sys));
        }

        // Use the command-supplied token (registered outside the service lock so
        // Stop can cancel mid-stream); keep a local copy for logout() to cancel.
        self.cancel_tokens
            .lock()
            .unwrap()
            .insert(session_id.to_string(), cancel_token.clone());

        let app_clone = app.clone();
        let sid = session_id.to_string();

        log::debug!("[anthropic] Sending message, model={model}");

        let response = match self
            .http_client
            .post("https://api.anthropic.com/v1/messages")
            .header("Content-Type", "application/json")
            .header("x-api-key", &api_key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .body(body.to_string())
            .send()
            .await
        {
            Ok(resp) => resp,
            Err(e) => {
                // Transport failure (DNS/TCP/TLS/timeout). Emit an error, roll back
                // the just-pushed user turn, and clean up — a bare `?` here left the
                // history with a dangling user message (Anthropic then 400s on the
                // next send because roles must alternate) and leaked the cancel token.
                log::error!("[anthropic] request failed: {e}");
                emit_chat_response(
                    &app_clone,
                    ChatResponseData {
                        session_id: sid.clone(),
                        response_type: "error".into(),
                        content: describe_transport_error("Anthropic"),
                        usage_metadata: None,
                    },
                );
                self.history.pop_trailing_user(&sid);
                self.cancel_tokens.lock().unwrap().remove(&sid);
                return Ok(());
            }
        };

        if !response.status().is_success() {
            let status = response.status().as_u16();
            let error_body = response
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".into());
            log::error!("[anthropic] API error {status}: {error_body}");
            emit_chat_response(
                &app_clone,
                ChatResponseData {
                    session_id: sid.clone(),
                    response_type: "error".into(),
                    content: describe_http_error("Anthropic", status, &error_body),
                    usage_metadata: None,
                },
            );
            // Drop the user message pushed before the request so the history
            // stays consistent for retry (mirror vertexai's pop-on-error).
            self.history.pop_trailing_user(&sid);
            self.cancel_tokens.lock().unwrap().remove(&sid);
            return Ok(());
        }

        match run_anthropic_sse_stream(
            response.bytes_stream(),
            &AppHandleSink(&app_clone),
            &sid,
            &cancel_token,
        )
        .await
        {
            Ok(outcome) => {
                // Normal completion or cancel: close out the assistant turn to
                // preserve the alternation Anthropic requires. Without this, a
                // cancelled turn would leave only the user message in history, and
                // the next request would send two consecutive user messages and be
                // rejected by the API.
                self.history.finalize_assistant(
                    &sid,
                    "assistant",
                    &outcome.full_response,
                    cancel_token.is_cancelled(),
                );
                if !cancel_token.is_cancelled() {
                    emit_chat_response(
                        &app_clone,
                        ChatResponseData {
                            session_id: sid.clone(),
                            response_type: "done".into(),
                            content: outcome.full_response,
                            usage_metadata: outcome.usage,
                        },
                    );
                }
            }
            Err(e) => {
                // Hard error mid-stream: emit the error and drop the user message
                // rather than commit a partial assistant turn. Committing a
                // truncated/empty assistant message would leave the history in a
                // state the API rejects (or resend a partial reply as context) on
                // the next send.
                log::error!("[anthropic] Stream error: {e}");
                emit_chat_response(
                    &app_clone,
                    ChatResponseData {
                        session_id: sid.clone(),
                        response_type: "error".into(),
                        content: describe_transport_error("Anthropic"),
                        usage_metadata: None,
                    },
                );
                self.history.pop_trailing_user(&sid);
            }
        }

        self.cancel_tokens.lock().unwrap().remove(&sid);
        Ok(())
    }

    async fn classify_command(&self, command: &str, model: &str) -> Result<CommandVerdict, String> {
        if !is_valid_model(model) {
            return Err("Invalid model name.".into());
        }
        let api_key = self.api_key.as_ref().ok_or("Not authenticated.")?.clone();

        // Force the model to emit the verdict through a single tool, which is
        // Anthropic's mechanism for guaranteed-structured output.
        let body = serde_json::json!({
            "model": model,
            "max_tokens": 256,
            "system": CLASSIFIER_SYSTEM_PROMPT,
            "messages": [{"role": "user", "content": build_user_prompt(command)}],
            "tools": [anthropic_verdict_tool()],
            "tool_choice": {"type": "tool", "name": "report_verdict"}
        });

        let response = self
            .http_client
            .post("https://api.anthropic.com/v1/messages")
            .header("Content-Type", "application/json")
            .header("x-api-key", &api_key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .timeout(std::time::Duration::from_secs(20))
            .body(body.to_string())
            .send()
            .await
            .map_err(|e| format!("Anthropic classification request failed: {e}"))?;

        if !response.status().is_success() {
            let status = response.status();
            log::warn!("[anthropic] classify_command failed: {status}");
            return Err(format!("classification request failed: {status}"));
        }

        let data: Value = response
            .json()
            .await
            .map_err(|e| format!("failed to read classification response: {e}"))?;

        parse_anthropic_tool_verdict(&data)
    }

    fn clear_history(&self, session_id: &str) {
        self.history.clear(session_id);
    }

    async fn list_models(&self) -> Result<Vec<ModelInfo>, String> {
        let api_key = match &self.api_key {
            Some(k) => k,
            None => return Ok(fallback_models()),
        };

        let response = self
            .http_client
            .get("https://api.anthropic.com/v1/models")
            .header("x-api-key", api_key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await;

        let response = match response {
            Ok(r) => r,
            Err(e) => {
                log::warn!("[anthropic] listModels error: {e}");
                return Ok(fallback_models());
            }
        };

        if !response.status().is_success() {
            log::warn!("[anthropic] listModels failed: {}", response.status());
            return Ok(fallback_models());
        }

        let data: Value = response
            .json()
            .await
            .unwrap_or_else(|_| serde_json::json!({}));

        let models: Vec<ModelInfo> = data
            .get("data")
            .and_then(|d| d.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|m| {
                        let id = m.get("id").and_then(|v| v.as_str())?;
                        let display = m.get("display_name").and_then(|v| v.as_str()).unwrap_or(id);
                        Some(ModelInfo {
                            name: id.to_string(),
                            display_name: display.to_string(),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        if models.is_empty() {
            Ok(fallback_models())
        } else {
            Ok(models)
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_api_keys() {
        assert!(is_valid_api_key("sk-ant-abc123"));
        assert!(is_valid_api_key("a"));
    }

    #[test]
    fn invalid_api_keys() {
        assert!(!is_valid_api_key(""));
        assert!(!is_valid_api_key("key with spaces"));
    }

    #[test]
    fn valid_models() {
        assert!(is_valid_model("claude-sonnet-4-6"));
        assert!(is_valid_model("claude-3.5-sonnet"));
    }

    #[test]
    fn invalid_models() {
        assert!(!is_valid_model(""));
        assert!(!is_valid_model("model with spaces"));
    }

    #[test]
    fn fallback_models_not_empty() {
        let models = fallback_models();
        assert!(!models.is_empty());
        assert!(models.iter().any(|m| m.name.contains("claude")));
    }
}
