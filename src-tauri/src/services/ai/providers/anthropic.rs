use std::collections::HashMap;
use std::path::{Path, PathBuf};

use async_trait::async_trait;
use futures::StreamExt;
use regex_lite::Regex;
use serde_json::Value;
use tauri::AppHandle;
use tokio_util::sync::CancellationToken;

use crate::services::ai::ai_provider::{
    emit_auth_result, emit_chat_response, AIProvider, AuthStatus, AuthType, ChatResponseData,
    ModelInfo, TokenUsage,
};
use crate::services::ai::sse::{parse_sse_line, SseBuffer, SseLine};
use crate::services::dpapi;

// ---------------------------------------------------------------------------
// Validation patterns
// ---------------------------------------------------------------------------

const VALID_API_KEY_PATTERN: &str = r"^[\x21-\x7E]{1,512}$";
const VALID_MODEL_PATTERN: &str = r"^[a-zA-Z0-9]+([._-][a-zA-Z0-9]+)*$";
const CONFIG_FILE_NAME: &str = "anthropic_config.json";
const ANTHROPIC_VERSION: &str = "2023-06-01";
const MAX_TOKENS: u32 = 8192;

fn is_valid_api_key(key: &str) -> bool {
    Regex::new(VALID_API_KEY_PATTERN)
        .map(|re| re.is_match(key))
        .unwrap_or(false)
}

fn is_valid_model(model: &str) -> bool {
    Regex::new(VALID_MODEL_PATTERN)
        .map(|re| re.is_match(model))
        .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// Chat message type
// ---------------------------------------------------------------------------

#[derive(Clone)]
struct ChatMessage {
    role: String,
    content: String,
}

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
    chat_histories: HashMap<String, Vec<ChatMessage>>,
    cancel_tokens: HashMap<String, CancellationToken>,
    app_data_dir: PathBuf,
    http_client: reqwest::Client,
}

impl AnthropicProvider {
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self {
            api_key: None,
            chat_histories: HashMap::new(),
            cancel_tokens: HashMap::new(),
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

    fn config_path(&self) -> PathBuf {
        self.app_data_dir.join(CONFIG_FILE_NAME)
    }

    fn save_config(&self) -> Result<(), String> {
        let key = self.api_key.as_deref().ok_or("No API key to save")?;
        let encrypted = dpapi::encrypt_string(key)?;
        std::fs::write(self.config_path(), &encrypted)
            .map_err(|e| format!("Failed to save config: {e}"))?;
        log::debug!("[anthropic] Config saved");
        Ok(())
    }

    fn load_config(&self) -> Result<Option<String>, String> {
        let path = self.config_path();
        if !path.exists() {
            return Ok(None);
        }
        let encrypted = std::fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read config: {e}"))?;
        let api_key = dpapi::decrypt_string(&encrypted)?;
        if api_key.is_empty() || !is_valid_api_key(&api_key) {
            return Ok(None);
        }
        Ok(Some(api_key))
    }

    fn delete_config(&self) {
        let path = self.config_path();
        if path.exists() {
            let _ = std::fs::remove_file(&path);
        }
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

    async fn authenticate(
        &mut self,
        app: &AppHandle,
        credentials: Value,
    ) -> Result<bool, String> {
        let api_key = credentials
            .get("apiKey")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        if !is_valid_api_key(api_key) {
            log::warn!("[anthropic] Auth rejected: invalid API key format");
            emit_auth_result(app, false);
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
            emit_auth_result(app, false);
            return Ok(false);
        }

        self.api_key = Some(api_key.to_string());
        if let Err(e) = self.save_config() {
            log::error!(
                "[anthropic] Failed to persist API key to {}: {e} — auth succeeded for this session but the key will not survive a restart",
                self.config_path().display()
            );
        }
        log::info!("[anthropic] Auth success");
        emit_auth_result(app, true);
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
        self.chat_histories.clear();
        for (_, token) in self.cancel_tokens.drain() {
            token.cancel();
        }
        self.delete_config();
    }

    async fn send_message(
        &mut self,
        app: &AppHandle,
        session_id: &str,
        message: &str,
        model: &str,
        system_instruction: Option<&str>,
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
        let history = self
            .chat_histories
            .entry(session_id.to_string())
            .or_default();
        history.push(ChatMessage {
            role: "user".into(),
            content: message.to_string(),
        });

        // Build request body (Anthropic format)
        let messages: Vec<serde_json::Value> = history
            .iter()
            .map(|msg| serde_json::json!({"role": &msg.role, "content": &msg.content}))
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

        let cancel_token = CancellationToken::new();
        self.cancel_tokens
            .insert(session_id.to_string(), cancel_token.clone());

        let app_clone = app.clone();
        let sid = session_id.to_string();

        log::debug!("[anthropic] Sending message, model={model}");

        let response = self
            .http_client
            .post("https://api.anthropic.com/v1/messages")
            .header("Content-Type", "application/json")
            .header("x-api-key", &api_key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .body(body.to_string())
            .send()
            .await
            .map_err(|e| format!("Anthropic request failed: {e}"))?;

        if !response.status().is_success() {
            let error_body = response
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".into());
            let err_msg = format!("API error: {error_body}");
            emit_chat_response(
                &app_clone,
                ChatResponseData {
                    session_id: sid.clone(),
                    response_type: "error".into(),
                    content:
                        "An error occurred while communicating with Anthropic. Please try again."
                            .into(),
                    usage_metadata: None,
                },
            );
            log::error!("[anthropic] {err_msg}");
            self.cancel_tokens.remove(&sid);
            return Ok(());
        }

        let mut stream = response.bytes_stream();
        let mut sse_buf = SseBuffer::new();
        let mut full_response = String::new();
        let mut current_event = String::new();
        let mut input_tokens: u32 = 0;
        let mut output_tokens: u32 = 0;

        loop {
            tokio::select! {
                _ = cancel_token.cancelled() => {
                    log::debug!("[anthropic] Message cancelled for session {sid}");
                    break;
                }
                chunk = stream.next() => {
                    match chunk {
                        Some(Ok(bytes)) => {
                            let lines = sse_buf.push(&bytes);
                            for line in lines {
                                match parse_sse_line(&line) {
                                    SseLine::Event(event) => {
                                        current_event = event.to_string();
                                    }
                                    SseLine::Data(data) => {
                                        if data.is_empty() {
                                            continue;
                                        }
                                        if let Ok(parsed) = serde_json::from_str::<Value>(data) {
                                            match current_event.as_str() {
                                                "content_block_delta" => {
                                                    if let Some(text) = parsed
                                                        .pointer("/delta/text")
                                                        .and_then(|v| v.as_str())
                                                    {
                                                        if !text.is_empty() {
                                                            full_response.push_str(text);
                                                            emit_chat_response(&app_clone, ChatResponseData {
                                                                session_id: sid.clone(),
                                                                response_type: "chunk".into(),
                                                                content: text.to_string(),
                                                                usage_metadata: None,
                                                            });
                                                        }
                                                    }
                                                }
                                                "message_start" => {
                                                    if let Some(tokens) = parsed
                                                        .pointer("/message/usage/input_tokens")
                                                        .and_then(|v| v.as_u64())
                                                    {
                                                        input_tokens = tokens as u32;
                                                    }
                                                }
                                                "message_delta" => {
                                                    if let Some(tokens) = parsed
                                                        .pointer("/usage/output_tokens")
                                                        .and_then(|v| v.as_u64())
                                                    {
                                                        output_tokens = tokens as u32;
                                                    }
                                                }
                                                _ => {}
                                            }
                                        }
                                    }
                                    _ => {}
                                }
                            }
                        }
                        Some(Err(e)) => {
                            log::error!("[anthropic] Stream error: {e}");
                            emit_chat_response(&app_clone, ChatResponseData {
                                session_id: sid.clone(),
                                response_type: "error".into(),
                                content: "An error occurred while communicating with Anthropic. Please try again.".into(),
                                usage_metadata: None,
                            });
                            break;
                        }
                        None => break,
                    }
                }
            }
        }

        // Always close out the assistant turn in chat_histories — even on
        // cancel — to preserve the user/assistant alternation Anthropic
        // requires. Without this, a cancelled turn would leave only the user
        // message in history, and the next request would send two consecutive
        // user messages and be rejected by the API.
        if let Some(history) = self.chat_histories.get_mut(&sid) {
            let content = if cancel_token.is_cancelled() {
                if full_response.is_empty() {
                    "[cancelled before response]".to_string()
                } else {
                    format!("{full_response}\n\n[cancelled by user]")
                }
            } else {
                full_response.clone()
            };
            history.push(ChatMessage {
                role: "assistant".into(),
                content,
            });
        }

        if !cancel_token.is_cancelled() {
            let usage_metadata = TokenUsage {
                prompt_token_count: Some(input_tokens),
                candidates_token_count: Some(output_tokens),
                total_token_count: Some(input_tokens + output_tokens),
            };

            emit_chat_response(
                &app_clone,
                ChatResponseData {
                    session_id: sid.clone(),
                    response_type: "done".into(),
                    content: full_response,
                    usage_metadata: Some(usage_metadata),
                },
            );
        }

        self.cancel_tokens.remove(&sid);
        Ok(())
    }

    fn cancel_message(&mut self, session_id: &str) {
        if let Some(token) = self.cancel_tokens.remove(session_id) {
            token.cancel();
        }
    }

    fn clear_history(&mut self, session_id: &str) {
        self.chat_histories.remove(session_id);
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
                        let display = m
                            .get("display_name")
                            .and_then(|v| v.as_str())
                            .unwrap_or(id);
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
