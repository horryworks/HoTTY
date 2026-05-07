use std::collections::HashMap;
use std::path::{Path, PathBuf};

use async_trait::async_trait;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD as BASE64URL, Engine};
use futures::StreamExt;
use regex_lite::Regex;
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::AppHandle;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_util::sync::CancellationToken;

use crate::services::ai::ai_provider::{
    emit_auth_result, emit_chat_response, AIProvider, AuthStatus, AuthType, ChatResponseData,
    ModelInfo, TokenUsage,
};
use crate::services::ai::sse::{parse_sse_line, SseBuffer, SseLine};
use crate::services::dpapi;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_MODEL_PATTERN: &str = r"^[a-zA-Z0-9]+([._-][a-zA-Z0-9]+)*$";
const CRED_PATTERN: &str = r"^[\x21-\x7E]{1,512}$";
const CONFIG_FILE_NAME: &str = "gemini_token.json";
const NON_TEXT_MODEL_KEYWORDS: &[&str] = &[
    "tts", "image", "robotics", "computer-use", "nano-banana",
];

fn is_valid_model(model: &str) -> bool {
    Regex::new(VALID_MODEL_PATTERN)
        .map(|re| re.is_match(model))
        .unwrap_or(false)
}

fn is_valid_credential(cred: &str) -> bool {
    Regex::new(CRED_PATTERN)
        .map(|re| re.is_match(cred))
        .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// Token data
// ---------------------------------------------------------------------------

#[derive(Clone)]
struct TokenData {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: u64,
    obtained_at: u64, // millis since epoch
}

impl TokenData {
    fn is_expired(&self) -> bool {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        let elapsed = now.saturating_sub(self.obtained_at);
        elapsed >= self.expires_in.saturating_sub(60) * 1000
    }
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
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
// GeminiProvider
// ---------------------------------------------------------------------------

pub struct GeminiProvider {
    token_data: Option<TokenData>,
    client_id: Option<String>,
    client_secret: Option<String>,
    chat_histories: HashMap<String, Vec<ChatMessage>>,
    cancel_tokens: HashMap<String, CancellationToken>,
    app_data_dir: PathBuf,
    http_client: reqwest::Client,
}

impl GeminiProvider {
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self {
            token_data: None,
            client_id: None,
            client_secret: None,
            chat_histories: HashMap::new(),
            cancel_tokens: HashMap::new(),
            app_data_dir,
            http_client: reqwest::Client::builder()
                .connect_timeout(std::time::Duration::from_secs(30))
                .build()
                .unwrap_or_else(|_| reqwest::Client::new()),
        }
    }

    fn config_path(&self) -> PathBuf {
        self.app_data_dir.join(CONFIG_FILE_NAME)
    }

    fn save_token(&self) -> Result<(), String> {
        let token_data = self
            .token_data
            .as_ref()
            .ok_or("No token data to save")?;
        let refresh_token = token_data
            .refresh_token
            .as_deref()
            .ok_or("No refresh token")?;

        let payload = serde_json::json!({
            "refresh_token": refresh_token,
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "obtained_at": token_data.obtained_at,
        });

        let encrypted = dpapi::encrypt_string(&payload.to_string())?;
        std::fs::write(self.config_path(), &encrypted)
            .map_err(|e| format!("Failed to save token: {e}"))?;
        log::debug!("[gemini] Token saved");
        Ok(())
    }

    fn load_token(&mut self) -> Result<bool, String> {
        let path = self.config_path();
        if !path.exists() {
            return Ok(false);
        }

        let encrypted =
            std::fs::read_to_string(&path).map_err(|e| format!("Failed to read token: {e}"))?;
        let decrypted = dpapi::decrypt_string(&encrypted)?;
        if decrypted.is_empty() {
            return Ok(false);
        }

        let raw: Value =
            serde_json::from_str(&decrypted).map_err(|e| format!("Invalid token JSON: {e}"))?;

        let refresh_token = raw
            .get("refresh_token")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let client_id = raw
            .get("client_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let client_secret = raw
            .get("client_secret")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let obtained_at = raw
            .get("obtained_at")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);

        if refresh_token.is_empty() || client_id.is_empty() || client_secret.is_empty() {
            return Ok(false);
        }

        self.client_id = Some(client_id);
        self.client_secret = Some(client_secret);
        self.token_data = Some(TokenData {
            access_token: String::new(),
            refresh_token: Some(refresh_token),
            expires_in: 0,
            obtained_at,
        });

        Ok(true)
    }

    async fn refresh_access_token(&mut self) -> bool {
        let refresh_token = match self.token_data.as_ref().and_then(|t| t.refresh_token.as_ref()) {
            Some(rt) => rt.clone(),
            None => return false,
        };
        let client_id = match &self.client_id {
            Some(id) => id.clone(),
            None => return false,
        };
        let client_secret = match &self.client_secret {
            Some(s) => s.clone(),
            None => return false,
        };

        let params = [
            ("client_id", client_id.as_str()),
            ("client_secret", client_secret.as_str()),
            ("refresh_token", refresh_token.as_str()),
            ("grant_type", "refresh_token"),
        ];

        let response = self
            .http_client
            .post("https://oauth2.googleapis.com/token")
            .form(&params)
            .timeout(std::time::Duration::from_secs(15))
            .send()
            .await;

        match response {
            Ok(resp) if resp.status().is_success() => {
                if let Ok(data) = resp.json::<Value>().await {
                    let access_token = data
                        .get("access_token")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let expires_in = data.get("expires_in").and_then(|v| v.as_u64()).unwrap_or(0);

                    if let Some(td) = &mut self.token_data {
                        td.access_token = access_token;
                        td.expires_in = expires_in;
                        td.obtained_at = now_millis();
                    }
                    let _ = self.save_token();
                    return true;
                }
                false
            }
            _ => false,
        }
    }

    async fn get_valid_token(&mut self) -> Option<String> {
        let td = self.token_data.as_ref()?;
        if td.is_expired() && !self.refresh_access_token().await {
            return None;
        }
        self.token_data.as_ref().map(|t| t.access_token.clone())
    }

    fn delete_config(&self) {
        let path = self.config_path();
        if path.exists() {
            let _ = std::fs::remove_file(&path);
        }
    }
}

#[async_trait]
impl AIProvider for GeminiProvider {
    fn id(&self) -> &str {
        "gemini"
    }

    fn display_name(&self) -> &str {
        "Google AI Studio (Gemini)"
    }

    fn auth_type(&self) -> AuthType {
        AuthType::OAuth2
    }

    async fn authenticate(
        &mut self,
        app: &AppHandle,
        credentials: Value,
    ) -> Result<bool, String> {
        let client_id = credentials
            .get("clientId")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let client_secret = credentials
            .get("clientSecret")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        if !is_valid_credential(client_id) || !is_valid_credential(client_secret) {
            log::warn!("[gemini] Auth rejected: invalid credential format");
            emit_auth_result(app, false);
            return Ok(false);
        }

        self.client_id = Some(client_id.to_string());
        self.client_secret = Some(client_secret.to_string());

        // Generate PKCE
        let code_verifier = BASE64URL.encode(rand::random::<[u8; 32]>());
        let code_challenge = BASE64URL.encode(Sha256::digest(code_verifier.as_bytes()));
        let oauth_state = hex::encode(rand::random::<[u8; 16]>());

        // Bind a TCP listener on an ephemeral port
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| format!("Failed to bind callback server: {e}"))?;
        let port = listener
            .local_addr()
            .map_err(|e| format!("Failed to get listener address: {e}"))?
            .port();

        let redirect_uri = format!("http://localhost:{port}/callback");
        let scope = "https://www.googleapis.com/auth/generative-language.retriever";

        let auth_url = format!(
            "https://accounts.google.com/o/oauth2/v2/auth\
             ?client_id={client_id}\
             &redirect_uri={redirect_uri}\
             &response_type=code\
             &scope={scope}\
             &code_challenge={code_challenge}\
             &code_challenge_method=S256\
             &access_type=offline\
             &prompt=consent\
             &state={oauth_state}"
        );

        // Open the auth URL in the system browser
        use tauri_plugin_opener::OpenerExt;
        app.opener()
            .open_url(&auth_url, None::<&str>)
            .map_err(|e| format!("Failed to open browser: {e}"))?;

        log::debug!("[gemini] OAuth server listening on port {port}");

        let app_clone = app.clone();
        let http_client = self.http_client.clone();
        let client_id_owned = client_id.to_string();
        let client_secret_owned = client_secret.to_string();

        // Wait for callback with 5-minute timeout
        let result = tokio::time::timeout(std::time::Duration::from_secs(300), async {
            let (mut stream, _addr) = listener
                .accept()
                .await
                .map_err(|e| format!("Failed to accept connection: {e}"))?;

            // Read the HTTP request
            let mut buf = vec![0u8; 4096];
            let n = stream
                .read(&mut buf)
                .await
                .map_err(|e| format!("Failed to read request: {e}"))?;
            let request = String::from_utf8_lossy(&buf[..n]);

            // Parse the request line to get the path
            let first_line = request.lines().next().unwrap_or("");
            let path = first_line.split_whitespace().nth(1).unwrap_or("");

            // Parse query parameters from the callback URL
            let query_start = path.find('?').map(|i| i + 1).unwrap_or(path.len());
            let query_str = &path[query_start..];
            let params: HashMap<String, String> = query_str
                .split('&')
                .filter_map(|pair| {
                    let mut parts = pair.splitn(2, '=');
                    let key = parts.next()?.to_string();
                    let value = parts.next().unwrap_or("").to_string();
                    Some((key, value))
                })
                .collect();

            let received_state = params.get("state").cloned().unwrap_or_default();
            let code = params.get("code").cloned().unwrap_or_default();
            let error = params.get("error").cloned().unwrap_or_default();

            // CSRF protection: validate state
            if received_state != oauth_state {
                log::warn!("[gemini] Auth CSRF validation failed");
                let response = "HTTP/1.1 400 Bad Request\r\nContent-Type: text/html\r\n\r\n<html><body><h1>Invalid State</h1><p>Security validation failed.</p></body></html>";
                let _ = stream.write_all(response.as_bytes()).await;
                return Err("CSRF validation failed".to_string());
            }

            if !error.is_empty() {
                log::warn!("[gemini] Auth callback error: {error}");
                let response = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n<html><body><h1>Authentication Error</h1><p>You may close this window.</p></body></html>";
                let _ = stream.write_all(response.as_bytes()).await;
                return Err(format!("OAuth error: {error}"));
            }

            if code.is_empty() {
                let response = "HTTP/1.1 400 Bad Request\r\nContent-Type: text/html\r\n\r\n<html><body><h1>Missing Code</h1></body></html>";
                let _ = stream.write_all(response.as_bytes()).await;
                return Err("No authorization code received".to_string());
            }

            // Exchange code for token
            let token_params = [
                ("code", code.as_str()),
                ("client_id", client_id_owned.as_str()),
                ("client_secret", client_secret_owned.as_str()),
                ("redirect_uri", redirect_uri.as_str()),
                ("grant_type", "authorization_code"),
                ("code_verifier", code_verifier.as_str()),
            ];

            let token_response = http_client
                .post("https://oauth2.googleapis.com/token")
                .form(&token_params)
                .timeout(std::time::Duration::from_secs(30))
                .send()
                .await
                .map_err(|e| format!("Token exchange request failed: {e}"))?;

            if !token_response.status().is_success() {
                let status = token_response.status();
                let response = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n<html><body><h1>Token Exchange Error</h1><p>You may close this window and try again.</p></body></html>";
                let _ = stream.write_all(response.as_bytes()).await;
                return Err(format!("Token exchange failed: {status}"));
            }

            let data: Value = token_response
                .json()
                .await
                .map_err(|e| format!("Failed to parse token response: {e}"))?;

            let token_data = TokenData {
                access_token: data
                    .get("access_token")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                refresh_token: data
                    .get("refresh_token")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                expires_in: data.get("expires_in").and_then(|v| v.as_u64()).unwrap_or(0),
                obtained_at: now_millis(),
            };

            let response_html = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n<html><body style=\"background:#1e1e1e;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0\"><div style=\"text-align:center\"><h1 style=\"color:#4ade80\">Authentication Successful</h1><p>You can return to HoTTY. You may close this window.</p></div></body></html>";
            let _ = stream.write_all(response_html.as_bytes()).await;

            Ok(token_data)
        })
        .await;

        match result {
            Ok(Ok(token_data)) => {
                self.token_data = Some(token_data);
                if let Err(e) = self.save_token() {
                    log::error!("[gemini] Failed to save token: {e}");
                }
                log::info!("[gemini] Auth success");
                emit_auth_result(&app_clone, true);
                Ok(true)
            }
            Ok(Err(e)) => {
                log::error!("[gemini] Auth error: {e}");
                emit_auth_result(&app_clone, false);
                Ok(false)
            }
            Err(_) => {
                log::warn!("[gemini] Auth timeout (5 minutes)");
                emit_auth_result(&app_clone, false);
                Ok(false)
            }
        }
    }

    async fn auto_auth(
        &mut self,
        _app_data_dir: &Path,
        credentials: Value,
    ) -> Result<bool, String> {
        let client_id = credentials
            .get("clientId")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let client_secret = credentials
            .get("clientSecret")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        if !self.load_token()? {
            return Ok(false);
        }

        // Validate stored credentials match what was passed
        let stored_id = self.client_id.as_deref().unwrap_or("");
        let stored_secret = self.client_secret.as_deref().unwrap_or("");
        if stored_id != client_id || stored_secret != client_secret {
            log::warn!("[gemini] Auto-auth failed: credentials mismatch");
            self.logout();
            return Ok(false);
        }

        // Try to refresh the access token
        if self.refresh_access_token().await {
            log::info!("[gemini] Auto-auth success");
            Ok(true)
        } else {
            self.logout();
            Ok(false)
        }
    }

    fn get_auth_status(&self) -> AuthStatus {
        AuthStatus {
            authenticated: self.token_data.is_some(),
            account_info: None,
        }
    }

    fn logout(&mut self) {
        log::info!("[gemini] Logout");
        self.token_data = None;
        self.client_id = None;
        self.client_secret = None;
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

        let token = match self.get_valid_token().await {
            Some(t) => t,
            None => {
                emit_chat_response(
                    app,
                    ChatResponseData {
                        session_id: session_id.to_string(),
                        response_type: "error".into(),
                        content: "Authentication expired. Please sign in again.".into(),
                        usage_metadata: None,
                    },
                );
                return Ok(());
            }
        };

        let history = self
            .chat_histories
            .entry(session_id.to_string())
            .or_default();
        history.push(ChatMessage {
            role: "user".into(),
            content: message.to_string(),
        });

        // Build Gemini request body
        let contents: Vec<Value> = history
            .iter()
            .map(|msg| {
                serde_json::json!({
                    "role": &msg.role,
                    "parts": [{"text": &msg.content}]
                })
            })
            .collect();

        let mut body = serde_json::json!({ "contents": contents });
        if let Some(sys) = system_instruction {
            body.as_object_mut().unwrap().insert(
                "system_instruction".into(),
                serde_json::json!({"parts": [{"text": sys}]}),
            );
        }

        let cancel_token = CancellationToken::new();
        self.cancel_tokens
            .insert(session_id.to_string(), cancel_token.clone());

        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse"
        );
        let app_clone = app.clone();
        let sid = session_id.to_string();

        log::debug!("[gemini] Sending message, model={model}, system_instruction={system_instruction:?}");

        let response = self
            .http_client
            .post(&url)
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Bearer {token}"))
            .body(body.to_string())
            .send()
            .await
            .map_err(|e| format!("Gemini request failed: {e}"))?;

        if !response.status().is_success() {
            let error_body = response
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".into());
            log::error!("[gemini] API error: {error_body}");
            emit_chat_response(
                &app_clone,
                ChatResponseData {
                    session_id: sid.clone(),
                    response_type: "error".into(),
                    content: "An error occurred while communicating with Gemini. Please try again."
                        .into(),
                    usage_metadata: None,
                },
            );
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
                    log::debug!("[gemini] Message cancelled for session {sid}");
                    break;
                }
                chunk = stream.next() => {
                    match chunk {
                        Some(Ok(bytes)) => {
                            let lines = sse_buf.push(&bytes);
                            for line in lines {
                                if let SseLine::Data(data) = parse_sse_line(&line) {
                                    if data.is_empty() {
                                        continue;
                                    }
                                    if let Ok(parsed) = serde_json::from_str::<Value>(data) {
                                        if let Some(text) = parsed
                                            .pointer("/candidates/0/content/parts/0/text")
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
                                        if let Some(usage) = parsed.get("usageMetadata") {
                                            last_usage = Some(TokenUsage {
                                                prompt_token_count: usage.get("promptTokenCount").and_then(|v| v.as_u64()).map(|v| v as u32),
                                                candidates_token_count: usage.get("candidatesTokenCount").and_then(|v| v.as_u64()).map(|v| v as u32),
                                                total_token_count: usage.get("totalTokenCount").and_then(|v| v.as_u64()).map(|v| v as u32),
                                            });
                                        }
                                    }
                                }
                            }
                        }
                        Some(Err(e)) => {
                            log::error!("[gemini] Stream error: {e}");
                            emit_chat_response(&app_clone, ChatResponseData {
                                session_id: sid.clone(),
                                response_type: "error".into(),
                                content: "An error occurred while communicating with Gemini. Please try again.".into(),
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
        // cancel — so the user/assistant alternation stays consistent for the
        // next request.
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
                role: "model".into(),
                content,
            });
        }

        if !cancel_token.is_cancelled() {
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
        let token = match self
            .token_data
            .as_ref()
            .filter(|t| !t.is_expired())
            .map(|t| t.access_token.clone())
        {
            Some(t) if !t.is_empty() => t,
            _ => return Ok(vec![]),
        };

        let response = self
            .http_client
            .get("https://generativelanguage.googleapis.com/v1beta/models")
            .header("Authorization", format!("Bearer {token}"))
            .timeout(std::time::Duration::from_secs(15))
            .send()
            .await;

        let response = match response {
            Ok(r) if r.status().is_success() => r,
            _ => return Ok(vec![]),
        };

        let data: Value = response
            .json()
            .await
            .unwrap_or_else(|_| serde_json::json!({}));

        let models: Vec<ModelInfo> = data
            .get("models")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter(|m| {
                        m.get("supportedGenerationMethods")
                            .and_then(|v| v.as_array())
                            .map(|methods| {
                                methods
                                    .iter()
                                    .any(|m| m.as_str() == Some("generateContent"))
                            })
                            .unwrap_or(false)
                    })
                    .filter(|m| {
                        let short_name = m
                            .get("name")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .rsplit('/')
                            .next()
                            .unwrap_or("")
                            .to_lowercase();
                        !NON_TEXT_MODEL_KEYWORDS
                            .iter()
                            .any(|kw| short_name.contains(kw))
                    })
                    .filter_map(|m| {
                        let name = m.get("name").and_then(|v| v.as_str())?;
                        let display_name = m
                            .get("displayName")
                            .and_then(|v| v.as_str())
                            .unwrap_or(name);
                        Some(ModelInfo {
                            name: name.replace("models/", ""),
                            display_name: display_name.to_string(),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(models)
    }
}

// We need hex encoding for the oauth state parameter
mod hex {
    pub fn encode(bytes: [u8; 16]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_credentials() {
        assert!(is_valid_credential("abc123.apps.googleusercontent.com"));
        assert!(is_valid_credential("GOCSPX-abc123"));
    }

    #[test]
    fn invalid_credentials() {
        assert!(!is_valid_credential(""));
        assert!(!is_valid_credential("has spaces"));
    }

    #[test]
    fn valid_models() {
        assert!(is_valid_model("gemini-2.0-flash"));
        assert!(is_valid_model("gemini-1.5-pro"));
    }

    #[test]
    fn token_expiry() {
        let td = TokenData {
            access_token: "test".into(),
            refresh_token: None,
            expires_in: 3600,
            obtained_at: now_millis(),
        };
        assert!(!td.is_expired());

        let expired_td = TokenData {
            access_token: "test".into(),
            refresh_token: None,
            expires_in: 0,
            obtained_at: 0,
        };
        assert!(expired_td.is_expired());
    }

    #[test]
    fn hex_encode() {
        let bytes = [0u8; 16];
        assert_eq!(hex::encode(bytes), "00000000000000000000000000000000");
    }

    #[test]
    fn non_text_model_filtering() {
        let keywords = NON_TEXT_MODEL_KEYWORDS;
        assert!(keywords.iter().any(|kw| "gemini-tts-model".contains(kw)));
        assert!(!keywords.iter().any(|kw| "gemini-2.0-flash".contains(kw)));
    }

    #[test]
    fn pkce_challenge_generation() {
        let verifier = BASE64URL.encode(rand::random::<[u8; 32]>());
        let challenge = BASE64URL.encode(Sha256::digest(verifier.as_bytes()));
        assert!(!verifier.is_empty());
        assert!(!challenge.is_empty());
        assert_ne!(verifier, challenge);
    }
}
