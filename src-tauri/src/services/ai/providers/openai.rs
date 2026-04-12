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
const CONFIG_FILE_NAME: &str = "openai_config.json";

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
            name: "gpt-4o".into(),
            display_name: "GPT-4o".into(),
        },
        ModelInfo {
            name: "gpt-4o-mini".into(),
            display_name: "GPT-4o mini".into(),
        },
        ModelInfo {
            name: "gpt-4-turbo".into(),
            display_name: "GPT-4 Turbo".into(),
        },
        ModelInfo {
            name: "gpt-3.5-turbo".into(),
            display_name: "GPT-3.5 Turbo".into(),
        },
    ]
}

// ---------------------------------------------------------------------------
// OpenAIProvider
// ---------------------------------------------------------------------------

pub struct OpenAIProvider {
    api_key: Option<String>,
    chat_histories: HashMap<String, Vec<ChatMessage>>,
    cancel_tokens: HashMap<String, CancellationToken>,
    app_data_dir: PathBuf,
    http_client: reqwest::Client,
}

impl OpenAIProvider {
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self {
            api_key: None,
            chat_histories: HashMap::new(),
            cancel_tokens: HashMap::new(),
            app_data_dir,
            http_client: reqwest::Client::new(),
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
        log::debug!("[openai] Config saved");
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
impl AIProvider for OpenAIProvider {
    fn id(&self) -> &str {
        "openai"
    }

    fn display_name(&self) -> &str {
        "OpenAI"
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
            log::warn!("[openai] Auth rejected: invalid API key format");
            emit_auth_result(app, false);
            return Ok(false);
        }

        // Validate key against the models endpoint
        let response = self
            .http_client
            .get("https://api.openai.com/v1/models")
            .header("Authorization", format!("Bearer {api_key}"))
            .timeout(std::time::Duration::from_secs(15))
            .send()
            .await
            .map_err(|e| format!("OpenAI auth request failed: {e}"))?;

        if !response.status().is_success() {
            log::warn!(
                "[openai] API key validation failed: {}",
                response.status()
            );
            emit_auth_result(app, false);
            return Ok(false);
        }

        self.api_key = Some(api_key.to_string());
        if let Err(e) = self.save_config() {
            log::error!("[openai] Failed to save config: {e}");
        }
        log::info!("[openai] Auth success");
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
                log::info!("[openai] Auto-auth success");
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
        log::info!("[openai] Logout");
        self.api_key = None;
        self.chat_histories.clear();
        // Cancel any in-flight requests
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
                        content: "Not authenticated. Please provide an OpenAI API key.".into(),
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

        // Build messages array
        let mut messages: Vec<serde_json::Value> = Vec::new();
        if let Some(sys) = system_instruction {
            messages.push(serde_json::json!({"role": "system", "content": sys}));
        }
        for msg in history.iter() {
            messages.push(serde_json::json!({"role": &msg.role, "content": &msg.content}));
        }

        let cancel_token = CancellationToken::new();
        self.cancel_tokens
            .insert(session_id.to_string(), cancel_token.clone());

        let body = serde_json::json!({
            "model": model,
            "messages": messages,
            "stream": true,
            "stream_options": { "include_usage": true },
        });

        let app_clone = app.clone();
        let sid = session_id.to_string();

        log::debug!("[openai] Sending message, model={model}");

        let response = self
            .http_client
            .post("https://api.openai.com/v1/chat/completions")
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Bearer {api_key}"))
            .body(body.to_string())
            .send()
            .await
            .map_err(|e| format!("OpenAI request failed: {e}"))?;

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
                    content: "An error occurred while communicating with OpenAI. Please try again."
                        .into(),
                    usage_metadata: None,
                },
            );
            log::error!("[openai] {err_msg}");
            self.cancel_tokens.remove(&sid);
            return Ok(());
        }

        let mut stream = response.bytes_stream();
        let mut sse_buf = SseBuffer::new();
        let mut full_response = String::new();
        let mut last_usage: Option<TokenUsage> = None;

        loop {
            tokio::select! {
                _ = cancel_token.cancelled() => {
                    log::debug!("[openai] Message cancelled for session {sid}");
                    break;
                }
                chunk = stream.next() => {
                    match chunk {
                        Some(Ok(bytes)) => {
                            let lines = sse_buf.push(&bytes);
                            for line in lines {
                                if let SseLine::Data(data) = parse_sse_line(&line) {
                                    if data.is_empty() || data == "[DONE]" {
                                        continue;
                                    }
                                    if let Ok(parsed) = serde_json::from_str::<Value>(data) {
                                        // Extract content chunk
                                        if let Some(text) = parsed
                                            .pointer("/choices/0/delta/content")
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
                                        // Extract usage metadata
                                        if let Some(usage) = parsed.get("usage") {
                                            last_usage = Some(TokenUsage {
                                                prompt_token_count: usage.get("prompt_tokens").and_then(|v| v.as_u64()).map(|v| v as u32),
                                                candidates_token_count: usage.get("completion_tokens").and_then(|v| v.as_u64()).map(|v| v as u32),
                                                total_token_count: usage.get("total_tokens").and_then(|v| v.as_u64()).map(|v| v as u32),
                                            });
                                        }
                                    }
                                }
                            }
                        }
                        Some(Err(e)) => {
                            log::error!("[openai] Stream error: {e}");
                            emit_chat_response(&app_clone, ChatResponseData {
                                session_id: sid.clone(),
                                response_type: "error".into(),
                                content: "An error occurred while communicating with OpenAI. Please try again.".into(),
                                usage_metadata: None,
                            });
                            break;
                        }
                        None => break, // Stream ended
                    }
                }
            }
        }

        // If we got a response (not cancelled), send done event and update history
        if !cancel_token.is_cancelled() && !full_response.is_empty() {
            if let Some(history) = self.chat_histories.get_mut(&sid) {
                history.push(ChatMessage {
                    role: "assistant".into(),
                    content: full_response.clone(),
                });
            }
            emit_chat_response(
                &app_clone,
                ChatResponseData {
                    session_id: sid.clone(),
                    response_type: "done".into(),
                    content: full_response,
                    usage_metadata: last_usage,
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
            .get("https://api.openai.com/v1/models")
            .header("Authorization", format!("Bearer {api_key}"))
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await;

        let response = match response {
            Ok(r) => r,
            Err(e) => {
                log::warn!("[openai] listModels error: {e}");
                return Ok(fallback_models());
            }
        };

        if !response.status().is_success() {
            log::warn!("[openai] listModels failed: {}", response.status());
            return Ok(fallback_models());
        }

        let data: Value = response
            .json()
            .await
            .unwrap_or_else(|_| serde_json::json!({}));

        let chat_model_re = Regex::new(r"^(gpt-|o[0-9])").unwrap_or_else(|_| {
            // Fallback: accept anything (should never happen)
            Regex::new(r".*").unwrap()
        });

        let mut models: Vec<String> = data
            .get("data")
            .and_then(|d| d.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|m| m.get("id").and_then(|v| v.as_str()))
                    .filter(|id| chat_model_re.is_match(id))
                    .map(|id| id.to_string())
                    .collect()
            })
            .unwrap_or_default();

        if models.is_empty() {
            return Ok(fallback_models());
        }

        models.sort_by(|a, b| b.cmp(a));

        Ok(models
            .into_iter()
            .map(|id| {
                let display = id.replace("gpt-", "GPT-");
                ModelInfo {
                    name: id,
                    display_name: display,
                }
            })
            .collect())
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
        assert!(is_valid_api_key("sk-abc123def456"));
        assert!(is_valid_api_key("a"));
        assert!(is_valid_api_key(&"x".repeat(512)));
    }

    #[test]
    fn invalid_api_keys() {
        assert!(!is_valid_api_key(""));
        assert!(!is_valid_api_key(&"x".repeat(513)));
        assert!(!is_valid_api_key("key with spaces"));
        assert!(!is_valid_api_key("key\twith\ttabs"));
    }

    #[test]
    fn valid_models() {
        assert!(is_valid_model("gpt-4o"));
        assert!(is_valid_model("gpt-4o-mini"));
        assert!(is_valid_model("o3"));
        assert!(is_valid_model("gpt-4.1"));
    }

    #[test]
    fn invalid_models() {
        assert!(!is_valid_model(""));
        assert!(!is_valid_model("model with spaces"));
        assert!(!is_valid_model("-leading-dash"));
        assert!(!is_valid_model("trailing-dash-"));
    }

    #[test]
    fn fallback_models_not_empty() {
        let models = fallback_models();
        assert!(!models.is_empty());
        assert!(models.iter().any(|m| m.name == "gpt-4o"));
    }
}
