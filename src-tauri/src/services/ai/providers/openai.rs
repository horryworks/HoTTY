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
use crate::services::ai::classifier::{
    build_user_prompt, openai_response_format, parse_verdict, CommandVerdict,
    CLASSIFIER_SYSTEM_PROMPT,
};
use crate::services::ai::config_store::EncryptedConfigStore;
use crate::services::ai::sse::{parse_sse_line, SseBuffer, SseLine};
use crate::services::ai::streaming::finalize_assistant_content;
use crate::services::ai::validation::{is_valid_api_key, is_valid_model};

// ---------------------------------------------------------------------------
// Validation patterns
// ---------------------------------------------------------------------------

const CONFIG_FILE_NAME: &str = "openai_config.json";

// ---------------------------------------------------------------------------
// Chat message type
// ---------------------------------------------------------------------------

#[derive(Clone)]
struct ChatMessage {
    role: String,
    content: String,
}

/// Drop a trailing `user` message from a chat history. Called on hard errors
/// (HTTP failure or mid-stream error) so the user/assistant alternation that
/// OpenAI's chat-completions API requires stays consistent for the next
/// request — otherwise the failed turn's user message would linger and the
/// retry would send two consecutive user messages.
fn pop_trailing_user(history: Option<&mut Vec<ChatMessage>>) {
    if let Some(h) = history {
        if matches!(h.last(), Some(m) if m.role == "user") {
            h.pop();
        }
    }
}

/// Extract the assistant message content from a non-streaming chat-completions
/// response body. Pulled out so the classification parsing path is unit-testable.
fn extract_message_content(data: &Value) -> Option<&str> {
    data.pointer("/choices/0/message/content")
        .and_then(|v| v.as_str())
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
            http_client: reqwest::Client::builder()
                .connect_timeout(std::time::Duration::from_secs(30))
                .build()
                .unwrap_or_else(|_| reqwest::Client::new()),
        }
    }

    fn store(&self) -> EncryptedConfigStore {
        EncryptedConfigStore::new(&self.app_data_dir, CONFIG_FILE_NAME, "openai")
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
            log::error!(
                "[openai] Failed to persist API key to {}: {e} — auth succeeded for this session but the key will not survive a restart",
                self.store().path().display()
            );
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
            // Drop the user message pushed before the request so the history
            // stays consistent for retry (mirror vertexai's pop-on-error).
            pop_trailing_user(self.chat_histories.get_mut(&sid));
            self.cancel_tokens.remove(&sid);
            return Ok(());
        }

        let mut stream = response.bytes_stream();
        let mut sse_buf = SseBuffer::new();
        let mut full_response = String::new();
        let mut last_usage: Option<TokenUsage> = None;
        let mut stream_errored = false;

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
                            stream_errored = true;
                            break;
                        }
                        None => break, // Stream ended
                    }
                }
            }
        }

        if stream_errored {
            // Hard error mid-stream: drop the user message rather than commit a
            // partial assistant turn — a truncated/empty assistant message would
            // break OpenAI's strict user/assistant alternation on the next send.
            pop_trailing_user(self.chat_histories.get_mut(&sid));
        } else if let Some(history) = self.chat_histories.get_mut(&sid) {
            // Normal completion or cancel: close out the assistant turn to
            // preserve the alternation OpenAI's chat completions API expects.
            let content = finalize_assistant_content(&full_response, cancel_token.is_cancelled());
            history.push(ChatMessage {
                role: "assistant".into(),
                content,
            });
        }

        if !cancel_token.is_cancelled() && !stream_errored {
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

    async fn classify_command(
        &mut self,
        command: &str,
        model: &str,
    ) -> Result<CommandVerdict, String> {
        if !is_valid_model(model) {
            return Err("Invalid model name.".into());
        }
        let api_key = self
            .api_key
            .as_ref()
            .ok_or("Not authenticated.")?
            .clone();

        // Note: `temperature` is intentionally omitted — some reasoning models
        // (o-series) reject a non-default temperature. The json_schema response
        // format keeps the output well-formed without it.
        let body = serde_json::json!({
            "model": model,
            "messages": [
                {"role": "system", "content": CLASSIFIER_SYSTEM_PROMPT},
                {"role": "user", "content": build_user_prompt(command)},
            ],
            "stream": false,
            "response_format": openai_response_format(),
        });

        let response = self
            .http_client
            .post("https://api.openai.com/v1/chat/completions")
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Bearer {api_key}"))
            .timeout(std::time::Duration::from_secs(20))
            .body(body.to_string())
            .send()
            .await
            .map_err(|e| format!("OpenAI classification request failed: {e}"))?;

        if !response.status().is_success() {
            let status = response.status();
            log::warn!("[openai] classify_command failed: {status}");
            return Err(format!("classification request failed: {status}"));
        }

        let data: Value = response
            .json()
            .await
            .map_err(|e| format!("failed to read classification response: {e}"))?;

        let content =
            extract_message_content(&data).ok_or("classification response had no content")?;
        parse_verdict(content)
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
    fn pop_trailing_user_drops_only_trailing_user() {
        let mut h = vec![
            ChatMessage { role: "user".into(), content: "q1".into() },
            ChatMessage { role: "assistant".into(), content: "a1".into() },
            ChatMessage { role: "user".into(), content: "q2".into() },
        ];
        pop_trailing_user(Some(&mut h));
        assert_eq!(h.len(), 2);
        assert_eq!(h.last().unwrap().role, "assistant");
        // Trailing assistant must NOT be popped.
        pop_trailing_user(Some(&mut h));
        assert_eq!(h.len(), 2);
        let mut empty: Vec<ChatMessage> = Vec::new();
        pop_trailing_user(Some(&mut empty));
        assert!(empty.is_empty());
        pop_trailing_user(None);
    }

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

    #[test]
    fn extract_and_parse_classification_response() {
        let body = serde_json::json!({
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": "{\"modifiesState\": true, \"confidence\": 0.95, \"reason\": \"installs a package\"}"
                }
            }]
        });
        let content = extract_message_content(&body).unwrap();
        let verdict = parse_verdict(content).unwrap();
        assert!(verdict.modifies_state);
        assert_eq!(verdict.reason, "installs a package");
    }

    #[test]
    fn extract_message_content_missing() {
        let body = serde_json::json!({ "choices": [] });
        assert!(extract_message_content(&body).is_none());
    }
}
