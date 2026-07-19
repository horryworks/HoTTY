use std::collections::HashMap;
use std::path::{Path, PathBuf};

use async_trait::async_trait;
use futures::StreamExt;
use serde_json::Value;
use tauri::AppHandle;
use tokio_util::sync::CancellationToken;

use crate::services::ai::ai_provider::{
    emit_auth_result, emit_chat_response, AIProvider, AuthStatus, AuthType, ChatResponseData,
    ModelInfo, TokenUsage,
};
use crate::services::ai::classifier::{
    build_user_prompt, parse_verdict, CommandVerdict, CLASSIFIER_SYSTEM_PROMPT,
};
use crate::services::ai::config_store::EncryptedConfigStore;
use crate::services::ai::sse::{parse_sse_line, SseBuffer, SseLine};
use crate::services::ai::errors::{describe_http_error, describe_transport_error};
use crate::services::ai::history::ChatHistoryStore;
use crate::services::ai::streaming::MAX_HISTORY_MESSAGES;
use crate::services::ai::validation::{is_valid_api_key, is_valid_model};

// ---------------------------------------------------------------------------
// Validation patterns
// ---------------------------------------------------------------------------

const CONFIG_FILE_NAME: &str = "anthropic_config.json";
const ANTHROPIC_VERSION: &str = "2023-06-01";
const MAX_TOKENS: u32 = 8192;

// ---------------------------------------------------------------------------
// Chat message type
// ---------------------------------------------------------------------------


/// Extract the forced-tool input object from a Messages API response. The
/// classifier forces `tool_choice` to `report_verdict`, so the verdict arrives
/// as the `input` of the first `tool_use` content block. Pulled out so the
/// parsing path is unit-testable.
fn extract_tool_input(data: &Value) -> Option<&Value> {
    data.get("content")?
        .as_array()?
        .iter()
        .find(|b| b.get("type").and_then(|v| v.as_str()) == Some("tool_use"))
        .and_then(|b| b.get("input"))
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
    history: ChatHistoryStore,
    cancel_tokens: HashMap<String, CancellationToken>,
    app_data_dir: PathBuf,
    http_client: reqwest::Client,
}

impl AnthropicProvider {
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self {
            api_key: None,
            history: ChatHistoryStore::new(MAX_HISTORY_MESSAGES),
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
                self.cancel_tokens.remove(&sid);
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
            self.cancel_tokens.remove(&sid);
            return Ok(());
        }

        let mut stream = response.bytes_stream();
        let mut sse_buf = SseBuffer::new();
        let mut full_response = String::new();
        let mut current_event = String::new();
        let mut input_tokens: u32 = 0;
        let mut output_tokens: u32 = 0;
        let mut stream_errored = false;

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
                                content: describe_transport_error("Anthropic"),
                                usage_metadata: None,
                            });
                            stream_errored = true;
                            break;
                        }
                        None => break,
                    }
                }
            }
        }

        if stream_errored {
            // Hard error mid-stream: drop the user message rather than commit a
            // partial assistant turn. Committing a truncated/empty assistant
            // message would leave the history in a state the API rejects (or
            // resend a partial reply as context) on the next send.
            self.history.pop_trailing_user(&sid);
        } else {
            // Normal completion or cancel: close out the assistant turn to
            // preserve the alternation Anthropic requires. Without this, a
            // cancelled turn would leave only the user message in history, and
            // the next request would send two consecutive user messages and be
            // rejected by the API.
            self.history
                .finalize_assistant(&sid, "assistant", &full_response, cancel_token.is_cancelled());
        }

        if !cancel_token.is_cancelled() && !stream_errored {
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

    async fn classify_command(
        &mut self,
        command: &str,
        model: &str,
    ) -> Result<CommandVerdict, String> {
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
            "tools": [{
                "name": "report_verdict",
                "description": "Report the command-safety verdict.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "modifiesState": {"type": "boolean"},
                        "confidence": {"type": "number"},
                        "reason": {"type": "string"}
                    },
                    "required": ["modifiesState", "confidence", "reason"]
                }
            }],
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

        let input =
            extract_tool_input(&data).ok_or("classification response had no tool output")?;
        parse_verdict(&input.to_string())
    }

    fn clear_history(&mut self, session_id: &str) {
        self.history.clear(session_id);
    }

    async fn list_models(&mut self) -> Result<Vec<ModelInfo>, String> {
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

    #[test]
    fn extract_and_parse_tool_verdict() {
        let body = serde_json::json!({
            "content": [{
                "type": "tool_use",
                "name": "report_verdict",
                "input": { "modifiesState": true, "confidence": 0.88, "reason": "enters config mode" }
            }]
        });
        let input = extract_tool_input(&body).unwrap();
        let verdict = parse_verdict(&input.to_string()).unwrap();
        assert!(verdict.modifies_state);
        assert_eq!(verdict.reason, "enters config mode");
    }

    #[test]
    fn extract_tool_input_skips_text_blocks() {
        let body = serde_json::json!({
            "content": [
                { "type": "text", "text": "thinking..." },
                { "type": "tool_use", "name": "report_verdict", "input": { "modifiesState": false, "confidence": 0.5, "reason": "x" } }
            ]
        });
        assert!(extract_tool_input(&body).is_some());
    }

    #[test]
    fn extract_tool_input_missing() {
        let body = serde_json::json!({ "content": [{ "type": "text", "text": "no tool" }] });
        assert!(extract_tool_input(&body).is_none());
    }
}
