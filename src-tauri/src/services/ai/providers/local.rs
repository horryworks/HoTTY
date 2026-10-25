//! A local or LAN AI server that speaks the OpenAI Chat Completions API —
//! Ollama, LM Studio, llama.cpp's `llama-server`, vLLM, llama-swap, … (ADR-AI-009).
//!
//! Differs from [`super::openai::OpenAIProvider`] in what the user controls:
//! the server address is theirs, the API key is optional, model ids are
//! free-form (`llama3.1:8b`), and a model may take minutes to load, so the
//! timeouts are long. The wire format and the stream reader are shared.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use async_trait::async_trait;
use serde_json::Value;
use tauri::AppHandle;
use tokio_util::sync::CancellationToken;
use zeroize::Zeroizing;

use crate::services::ai::ai_provider::{
    cancelled_response, emit_auth_failure, emit_auth_result, emit_chat_response, AIProvider,
    AppHandleSink, AuthFailureReason, AuthStatus, ChatResponseData, ChatResponseKind, ModelInfo,
};
use crate::services::ai::classifier::{
    build_user_prompt, openai_response_format, parse_verdict, CommandVerdict,
    CLASSIFIER_SYSTEM_PROMPT,
};
use crate::services::ai::config_store::EncryptedConfigStore;
use crate::services::ai::errors::{
    describe_local_http_error, describe_local_transport_error, describe_turn_failure,
};
use crate::services::ai::history::ChatHistoryStore;
use crate::services::ai::sse::run_openai_sse_stream;
use crate::services::ai::streaming::MAX_HISTORY_MESSAGES;
use crate::services::ai::streaming::{cancellable, resolve_turn, TurnResolution};
use crate::services::ai::validation::{is_valid_api_key, is_valid_local_model};
use crate::services::base_url::{is_loopback_base_url, normalize_base_url};

const PROVIDER_ID: &str = "local";

const CONFIG_FILE_NAME: &str = "local_ai_config.json";

/// Name used in error messages built by the shared helpers.
const SERVER_NAME: &str = "The AI server";

/// Above the frontend's hard cap for this provider (1800 s, `streamLimitsFor`
/// in `src/constants/aiProviders.ts`), so the UI wins while it is alive.
const STREAM_DEADLINE_SECS: u64 = 1860;

/// A classification needs the model loaded. A cold load can take minutes; a
/// timeout only means the user is asked, so this stays bounded.
const CLASSIFY_TIMEOUT_SECS: u64 = 60;

/// The address and optional key, sealed together so the key is only ever sent
/// to the server it was entered for (the NetBox pattern, `netbox/store.rs`).
///
/// No `#[derive(Debug)]`: it holds the key.
#[derive(serde::Serialize, serde::Deserialize)]
struct SealedConfig {
    base_url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    api_key: Option<String>,
}

/// A configured server. No `Debug`: it holds the key.
struct ServerConfig {
    base_url: String,
    api_key: Option<Zeroizing<String>>,
    http: reqwest::Client,
}

impl ServerConfig {
    fn new(base_url: String, api_key: Option<String>) -> Self {
        let http = build_http_client(&base_url);
        Self {
            base_url,
            api_key: api_key.map(Zeroizing::new),
            http,
        }
    }

    fn endpoint(&self, path: &str) -> String {
        format!("{}/v1/{path}", self.base_url)
    }

    fn get(&self, path: &str) -> reqwest::RequestBuilder {
        self.authorize(self.http.get(self.endpoint(path)))
    }

    fn post(&self, path: &str, body: &Value) -> reqwest::RequestBuilder {
        self.authorize(
            self.http
                .post(self.endpoint(path))
                .header("Content-Type", "application/json")
                .body(body.to_string()),
        )
    }

    fn authorize(&self, req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        match &self.api_key {
            Some(key) => req.header("Authorization", format!("Bearer {}", key.as_str())),
            None => req,
        }
    }
}

/// One client per configured server.
///
/// - No redirects: a server must not bounce a request carrying the key to
///   another origin.
/// - A server on this PC never goes through a system proxy — a corporate PAC
///   would otherwise swallow `localhost`. A LAN server follows the system
///   proxy settings (and their bypass list) like any other request.
/// - Only a connect timeout. A local model may take minutes to load before
///   the first byte; the stream is bounded by the frontend watchdog and
///   [`STREAM_DEADLINE_SECS`].
fn build_http_client(base_url: &str) -> reqwest::Client {
    let mut builder = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(std::time::Duration::from_secs(10))
        .user_agent(concat!("HoTTY/", env!("CARGO_PKG_VERSION")));
    if is_loopback_base_url(base_url) {
        builder = builder.no_proxy();
    }
    builder.build().unwrap_or_else(|e| {
        log::warn!("[local] Falling back to a default HTTP client: {e}");
        reqwest::Client::new()
    })
}

/// The model ids in a `/v1/models` body, sorted, unfiltered — whatever the
/// server serves is what the user can pick.
fn parse_model_list(data: &Value) -> Vec<ModelInfo> {
    let mut ids: Vec<String> = data
        .get("data")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m.get("id").and_then(Value::as_str))
                .filter(|id| is_valid_local_model(id))
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    ids.sort();
    ids.dedup();
    ids.into_iter()
        .map(|id| ModelInfo {
            display_name: id.clone(),
            name: id,
        })
        .collect()
}

/// Whether a 400 answer is a server refusing `stream_options` (older
/// llama.cpp and some proxies), which is worth one retry without it.
fn rejects_stream_options(body: &str) -> bool {
    body.contains("stream_options")
}

fn extract_message_content(data: &Value) -> Option<&str> {
    data.pointer("/choices/0/message/content")
        .and_then(Value::as_str)
}

fn chat_error(session_id: &str, content: String) -> ChatResponseData {
    ChatResponseData {
        session_id: session_id.to_string(),
        response_type: ChatResponseKind::Error,
        content,
        usage_metadata: None,
    }
}

// ---------------------------------------------------------------------------
// LocalProvider
// ---------------------------------------------------------------------------

pub struct LocalProvider {
    server: Option<ServerConfig>,
    history: ChatHistoryStore,
    cancel_tokens: Mutex<HashMap<String, CancellationToken>>,
    app_data_dir: PathBuf,
}

impl LocalProvider {
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self {
            server: None,
            history: ChatHistoryStore::new(MAX_HISTORY_MESSAGES),
            cancel_tokens: Mutex::new(HashMap::new()),
            app_data_dir,
        }
    }

    fn store(&self) -> EncryptedConfigStore {
        EncryptedConfigStore::new(&self.app_data_dir, CONFIG_FILE_NAME, PROVIDER_ID)
    }

    fn save_config(&self, base_url: &str, api_key: Option<&str>) -> Result<(), String> {
        let payload = Zeroizing::new(
            serde_json::to_string(&SealedConfig {
                base_url: base_url.to_string(),
                api_key: api_key.map(str::to_string),
            })
            .map_err(|e| e.to_string())?,
        );
        self.store().save(&payload)
    }

    /// The saved server, re-validated: a hand-edited file must not reach a
    /// request unchecked.
    fn load_config(&self) -> Result<Option<ServerConfig>, String> {
        let Some(raw) = self.store().load()? else {
            return Ok(None);
        };
        let raw = Zeroizing::new(raw);
        let Ok(sealed) = serde_json::from_str::<SealedConfig>(&raw) else {
            return Ok(None);
        };
        let Ok(base_url) = normalize_base_url(&sealed.base_url) else {
            return Ok(None);
        };
        let api_key = sealed.api_key.filter(|k| is_valid_api_key(k));
        Ok(Some(ServerConfig::new(base_url, api_key)))
    }

    fn forget_session(&self, session_id: &str) {
        self.cancel_tokens.lock().unwrap().remove(session_id);
    }

    /// Send the chat request; on a 400 that names `stream_options`, send once
    /// more without it. `None` means the user stopped it before an answer.
    async fn open_stream(
        &self,
        server: &ServerConfig,
        model: &str,
        messages: &[Value],
        cancel_token: &CancellationToken,
    ) -> Option<StreamStart> {
        let mut body = serde_json::json!({
            "model": model,
            "messages": messages,
            "stream": true,
            "stream_options": { "include_usage": true },
        });
        let mut retried = false;
        loop {
            let sent =
                cancellable(cancel_token, server.post("chat/completions", &body).send()).await?;
            let resp = match sent {
                Ok(resp) if resp.status().is_success() => return Some(StreamStart::Open(resp)),
                Ok(resp) => resp,
                Err(e) => return Some(StreamStart::Transport(e)),
            };
            let status = resp.status().as_u16();
            let text = cancellable(cancel_token, resp.text())
                .await?
                .unwrap_or_default();
            if status == 400 && !retried && rejects_stream_options(&text) {
                log::info!(
                    "[local] Server rejected stream_options; retrying without usage reporting"
                );
                if let Some(obj) = body.as_object_mut() {
                    obj.remove("stream_options");
                }
                retried = true;
                continue;
            }
            return Some(StreamStart::Http(status, text));
        }
    }
}

/// How opening a chat stream ended.
enum StreamStart {
    Open(reqwest::Response),
    Http(u16, String),
    Transport(reqwest::Error),
}

#[async_trait]
impl AIProvider for LocalProvider {
    fn id(&self) -> &str {
        PROVIDER_ID
    }

    async fn authenticate(&mut self, app: &AppHandle, credentials: Value) -> Result<bool, String> {
        let raw_url = credentials
            .get("baseUrl")
            .and_then(Value::as_str)
            .unwrap_or("");
        let Ok(base_url) = normalize_base_url(raw_url) else {
            log::warn!("[local] Auth rejected: invalid server URL");
            emit_auth_failure(app, self.id(), AuthFailureReason::BadUrl);
            return Ok(false);
        };
        let api_key = credentials
            .get("apiKey")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|k| !k.is_empty());
        if api_key.is_some_and(|k| !is_valid_api_key(k)) {
            log::warn!("[local] Auth rejected: invalid API key format");
            emit_auth_failure(app, self.id(), AuthFailureReason::NeedsKey);
            return Ok(false);
        }

        let server = ServerConfig::new(base_url.clone(), api_key.map(str::to_string));
        let response = server
            .get("models")
            .timeout(std::time::Duration::from_secs(15))
            .send()
            .await;
        let response = match response {
            Ok(r) => r,
            Err(e) => {
                log::warn!("[local] Server unreachable at {base_url}: {e}");
                emit_auth_failure(app, self.id(), AuthFailureReason::Unreachable);
                return Ok(false);
            }
        };
        let status = response.status();
        if matches!(status.as_u16(), 401 | 403) {
            log::warn!("[local] Server at {base_url} refused the key: {status}");
            emit_auth_failure(app, self.id(), AuthFailureReason::NeedsKey);
            return Ok(false);
        }
        // An answer that is not a model list is not an OpenAI-compatible API
        // (a web UI's port, a NetBox, …): refuse it now rather than at the
        // first chat.
        let looks_compatible = status.is_success()
            && response
                .json::<Value>()
                .await
                .is_ok_and(|v| v.get("data").is_some_and(Value::is_array));
        if !looks_compatible {
            log::warn!(
                "[local] {base_url} did not answer like an OpenAI-compatible API ({status})"
            );
            emit_auth_failure(app, self.id(), AuthFailureReason::NotCompatible);
            return Ok(false);
        }

        if let Err(e) = self.save_config(&base_url, api_key) {
            log::error!(
                "[local] Failed to persist server config to {}: {e} — connected for this session only",
                self.store().path().display()
            );
        }
        self.server = Some(server);
        log::info!("[local] Connected to {base_url}");
        emit_auth_result(app, self.id(), true);
        Ok(true)
    }

    async fn auto_auth(
        &mut self,
        _app_data_dir: &Path,
        _credentials: Value,
    ) -> Result<bool, String> {
        // No network check: the server may simply not be up yet, and the model
        // list request that follows reports that with a retry banner.
        match self.load_config()? {
            Some(server) => {
                log::info!("[local] Restored server {}", server.base_url);
                self.server = Some(server);
                Ok(true)
            }
            None => Ok(false),
        }
    }

    fn get_auth_status(&self) -> AuthStatus {
        AuthStatus {
            authenticated: self.server.is_some(),
            // Not a secret: the frontend shows it and uses it for the consent
            // check (a server on this PC needs none).
            account_info: self.server.as_ref().map(|s| s.base_url.clone()),
        }
    }

    fn logout(&mut self) {
        log::info!("[local] Logout");
        self.server = None;
        self.history.clear_all();
        for (_, token) in self.cancel_tokens.lock().unwrap().drain() {
            token.cancel();
        }
        self.store().delete();
    }

    async fn send_message(
        &self,
        app: &AppHandle,
        session_id: &str,
        message: &str,
        model: &str,
        system_instruction: Option<&str>,
        images: Vec<crate::services::ai::history::ChatImage>,
        cancel_token: CancellationToken,
    ) -> Result<(), String> {
        if !is_valid_local_model(model) {
            emit_chat_response(app, chat_error(session_id, "Invalid model name.".into()));
            return Ok(());
        }
        let Some(server) = &self.server else {
            emit_chat_response(
                app,
                chat_error(
                    session_id,
                    "No AI server is set. Enter its address in Settings → AI.".into(),
                ),
            );
            return Ok(());
        };

        self.history.push_user(session_id, message, images);

        // Same message shape as OpenAI; a text-only model ignores or rejects
        // image parts, and that rejection is reported like any 400.
        let mut messages: Vec<Value> = Vec::new();
        if let Some(sys) = system_instruction {
            messages.push(serde_json::json!({"role": "system", "content": sys}));
        }
        for msg in self.history.snapshot(session_id) {
            if msg.images.is_empty() {
                messages.push(serde_json::json!({"role": msg.role, "content": msg.content}));
            } else {
                let mut content: Vec<Value> = Vec::new();
                if !msg.content.is_empty() {
                    content.push(serde_json::json!({"type": "text", "text": msg.content}));
                }
                for img in &msg.images {
                    content.push(serde_json::json!({
                        "type": "image_url",
                        "image_url": {
                            "url": format!("data:{};base64,{}", img.mime_type, img.data_base64)
                        }
                    }));
                }
                messages.push(serde_json::json!({"role": msg.role, "content": content}));
            }
        }

        self.cancel_tokens
            .lock()
            .unwrap()
            .insert(session_id.to_string(), cancel_token.clone());
        let sid = session_id.to_string();
        log::debug!("[local] Sending message, model={model}");

        let Some(sent) = self
            .open_stream(server, model, &messages, &cancel_token)
            .await
        else {
            self.history.close_cancelled_turn(&sid, "assistant", "");
            emit_chat_response(app, cancelled_response(&sid, ""));
            self.forget_session(&sid);
            return Ok(());
        };
        let response = match sent {
            StreamStart::Open(resp) => resp,
            StreamStart::Transport(e) => {
                log::error!("[local] request failed: {e}");
                emit_chat_response(
                    app,
                    chat_error(&sid, describe_local_transport_error(&server.base_url)),
                );
                self.history.pop_trailing_user(&sid);
                self.forget_session(&sid);
                return Ok(());
            }
            StreamStart::Http(status, error_body) => {
                log::error!("[local] API error {status}: {error_body}");
                emit_chat_response(
                    app,
                    chat_error(
                        &sid,
                        describe_local_http_error(&server.base_url, status, &error_body),
                    ),
                );
                self.history.pop_trailing_user(&sid);
                self.forget_session(&sid);
                return Ok(());
            }
        };

        match run_openai_sse_stream(
            response.bytes_stream(),
            &AppHandleSink(app),
            &sid,
            &cancel_token,
        )
        .await
        {
            Ok(outcome) => match resolve_turn(outcome, cancel_token.is_cancelled()) {
                TurnResolution::Done { content, usage } => {
                    self.history
                        .finalize_assistant(&sid, "assistant", &content, false);
                    emit_chat_response(
                        app,
                        ChatResponseData {
                            session_id: sid.clone(),
                            response_type: ChatResponseKind::Done,
                            content,
                            usage_metadata: usage,
                        },
                    );
                }
                TurnResolution::Cancelled { partial } => {
                    self.history
                        .close_cancelled_turn(&sid, "assistant", &partial);
                    emit_chat_response(app, cancelled_response(&sid, &partial));
                }
                TurnResolution::Failed(failure) => {
                    log::warn!("[local] Turn failed: {failure:?}");
                    emit_chat_response(
                        app,
                        chat_error(&sid, describe_turn_failure(SERVER_NAME, &failure)),
                    );
                    self.history.pop_trailing_user(&sid);
                }
            },
            Err(e) => {
                if !cancel_token.is_cancelled() {
                    log::error!("[local] Stream error: {e}");
                    emit_chat_response(
                        app,
                        chat_error(&sid, describe_local_transport_error(&server.base_url)),
                    );
                }
                self.history.pop_trailing_user(&sid);
            }
        }

        self.forget_session(&sid);
        Ok(())
    }

    async fn classify_command(&self, command: &str, model: &str) -> Result<CommandVerdict, String> {
        if !is_valid_local_model(model) {
            return Err("Invalid model name.".into());
        }
        let server = self.server.as_ref().ok_or("Not connected.")?;
        // A server without structured output answers 400 here; the frontend
        // then asks the user, which is the safe side.
        let body = serde_json::json!({
            "model": model,
            "messages": [
                {"role": "system", "content": CLASSIFIER_SYSTEM_PROMPT},
                {"role": "user", "content": build_user_prompt(command)},
            ],
            "stream": false,
            "temperature": 0,
            "response_format": openai_response_format(),
        });
        let response = server
            .post("chat/completions", &body)
            .timeout(std::time::Duration::from_secs(CLASSIFY_TIMEOUT_SECS))
            .send()
            .await
            .map_err(|e| format!("classification request failed: {e}"))?;
        if !response.status().is_success() {
            let status = response.status();
            log::warn!("[local] classify_command failed: {status}");
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

    fn clear_history(&self, session_id: &str) {
        self.history.clear(session_id);
    }

    async fn list_models(&self) -> Result<Vec<ModelInfo>, String> {
        let server = self.server.as_ref().ok_or("No AI server is set")?;
        let response = server
            .get("models")
            .timeout(std::time::Duration::from_secs(15))
            .send()
            .await
            .map_err(|e| {
                log::warn!("[local] listModels error: {e}");
                describe_local_transport_error(&server.base_url)
            })?;
        if !response.status().is_success() {
            let status = response.status().as_u16();
            log::warn!("[local] listModels failed: {status}");
            return Err(describe_local_http_error(&server.base_url, status, ""));
        }
        let data: Value = response
            .json()
            .await
            .map_err(|e| format!("could not read the model list: {e}"))?;
        // An empty list stays empty — there is no sensible default model for a
        // server the user runs; the pane reports "no models" instead.
        Ok(parse_model_list(&data))
    }

    fn stream_deadline_secs(&self) -> u64 {
        STREAM_DEADLINE_SECS
    }

    fn classify_timeout_secs(&self) -> u64 {
        CLASSIFY_TIMEOUT_SECS
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_list_is_unfiltered_sorted_and_deduplicated() {
        let body = serde_json::json!({
            "object": "list",
            "data": [
                {"id": "qwen2.5-coder:7b"},
                {"id": "llama3.1:8b"},
                {"id": "meta-llama/Llama-3.1-8B-Instruct"},
                {"id": "llama3.1:8b"},
                {"id": "bad id with spaces"},
                {"name": "no id"},
            ]
        });
        let names: Vec<String> = parse_model_list(&body)
            .into_iter()
            .map(|m| m.name)
            .collect();
        assert_eq!(
            names,
            vec![
                "llama3.1:8b",
                "meta-llama/Llama-3.1-8B-Instruct",
                "qwen2.5-coder:7b"
            ]
        );
    }

    #[test]
    fn empty_model_list_stays_empty() {
        assert!(parse_model_list(&serde_json::json!({"data": []})).is_empty());
        assert!(parse_model_list(&serde_json::json!({})).is_empty());
    }

    #[test]
    fn endpoint_is_built_from_the_normalized_base() {
        let server = ServerConfig::new("http://127.0.0.1:11434".into(), None);
        assert_eq!(
            server.endpoint("models"),
            "http://127.0.0.1:11434/v1/models"
        );
    }

    #[test]
    fn detects_a_stream_options_refusal() {
        assert!(rejects_stream_options(
            r#"{"error":{"message":"Unrecognized request argument: stream_options"}}"#
        ));
        assert!(!rejects_stream_options(
            r#"{"error":{"message":"model not found"}}"#
        ));
    }

    #[test]
    fn sealed_config_omits_an_absent_key() {
        let json = serde_json::to_string(&SealedConfig {
            base_url: "http://localhost:11434".into(),
            api_key: None,
        })
        .unwrap();
        assert!(!json.contains("api_key"), "{json}");
        let back: SealedConfig = serde_json::from_str(&json).unwrap();
        assert!(back.api_key.is_none());
    }

    #[test]
    fn saved_config_round_trips_and_is_revalidated() {
        let dir = std::env::temp_dir().join(format!("hotty-local-ai-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let provider = LocalProvider::new(dir.clone());
        provider
            .save_config("http://192.0.2.10:8080", Some("sk-test"))
            .unwrap();
        let server = provider.load_config().unwrap().expect("config should load");
        assert_eq!(server.base_url, "http://192.0.2.10:8080");
        assert_eq!(
            server.api_key.as_deref().map(String::as_str),
            Some("sk-test")
        );

        // A hand-edited file with a bad URL is treated as "not configured".
        provider.save_config("ftp://nope", None).unwrap();
        assert!(provider.load_config().unwrap().is_none());

        provider.store().delete();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn local_timeouts_are_longer_than_the_defaults() {
        use crate::services::ai::ai_provider::{
            DEFAULT_CLASSIFY_TIMEOUT_SECS, DEFAULT_STREAM_DEADLINE_SECS,
        };
        let p = LocalProvider::new(std::env::temp_dir());
        assert!(p.stream_deadline_secs() > DEFAULT_STREAM_DEADLINE_SECS);
        assert!(p.classify_timeout_secs() > DEFAULT_CLASSIFY_TIMEOUT_SECS);
    }
}
