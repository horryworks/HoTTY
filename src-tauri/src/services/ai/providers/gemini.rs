use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use async_trait::async_trait;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD as BASE64URL, Engine};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::AppHandle;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_util::sync::CancellationToken;

use crate::services::ai::ai_provider::{
    emit_auth_result, emit_chat_response, AIProvider, AppHandleSink, AuthStatus, AuthType,
    ChatResponseData, ModelInfo,
};
use crate::services::ai::classifier::{
    build_user_prompt, extract_gemini_text, gemini_response_schema, parse_verdict, CommandVerdict,
    CLASSIFIER_SYSTEM_PROMPT,
};
use crate::services::ai::config_store::EncryptedConfigStore;
use crate::services::ai::errors::{describe_http_error, describe_transport_error};
use crate::services::ai::history::ChatHistoryStore;
use crate::services::ai::sse::run_google_sse_stream;
use crate::services::ai::streaming::MAX_HISTORY_MESSAGES;
use crate::services::ai::validation::{is_valid_api_key, is_valid_model};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONFIG_FILE_NAME: &str = "gemini_token.json";
const NON_TEXT_MODEL_KEYWORDS: &[&str] =
    &["tts", "image", "robotics", "computer-use", "nano-banana"];

// Model-name and credential shape checks are the shared `validation` helpers:
// the Gemini model pattern is the generic simple-model rule, and an OAuth
// client id/secret is validated with the same printable-ASCII shape as an API
// key (`is_valid_api_key`).

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

/// Minimal `application/x-www-form-urlencoded` value decoder for the OAuth callback
/// query string (avoids pulling in the `url` crate). Decodes `%XX` escapes and `+`
/// as space — Google's authorization code arrives with `%2F` for its `/`.
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hi = (bytes[i + 1] as char).to_digit(16);
                let lo = (bytes[i + 2] as char).to_digit(16);
                if let (Some(hi), Some(lo)) = (hi, lo) {
                    out.push((hi * 16 + lo) as u8);
                    i += 3;
                    continue;
                }
                out.push(b'%');
                i += 1;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

// ---------------------------------------------------------------------------
// GeminiProvider
// ---------------------------------------------------------------------------

pub struct GeminiProvider {
    token_data: Mutex<Option<TokenData>>,
    client_id: Option<String>,
    client_secret: Option<String>,
    history: ChatHistoryStore,
    cancel_tokens: Mutex<HashMap<String, CancellationToken>>,
    app_data_dir: PathBuf,
    http_client: reqwest::Client,
}

/// Outcome of an OAuth access-token refresh. Distinguishes a DEFINITIVE failure
/// (the refresh token is dead — `invalid_grant`) from a TRANSIENT one (network
/// down, timeout, 5xx). Only a definitive failure should destroy the persisted
/// credentials; a transient failure must keep them so a later launch can retry.
#[derive(Debug, PartialEq, Eq)]
enum TokenRefresh {
    Ok,
    Transient,
    Invalid,
}

impl GeminiProvider {
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self {
            token_data: Mutex::new(None),
            client_id: None,
            client_secret: None,
            history: ChatHistoryStore::new(MAX_HISTORY_MESSAGES),
            cancel_tokens: Mutex::new(HashMap::new()),
            app_data_dir,
            http_client: reqwest::Client::builder()
                .connect_timeout(std::time::Duration::from_secs(30))
                .build()
                .unwrap_or_else(|_| reqwest::Client::new()),
        }
    }

    fn store(&self) -> EncryptedConfigStore {
        EncryptedConfigStore::new(&self.app_data_dir, CONFIG_FILE_NAME, "gemini")
    }

    fn save_token(&self) -> Result<(), String> {
        // Copy out under the lock; the guard drops before any I/O.
        let (refresh_token, obtained_at) = {
            let guard = self.token_data.lock().unwrap();
            let token_data = guard.as_ref().ok_or("No token data to save")?;
            let refresh_token = token_data
                .refresh_token
                .as_deref()
                .ok_or("No refresh token")?
                .to_string();
            (refresh_token, token_data.obtained_at)
        };

        let payload = serde_json::json!({
            "refresh_token": refresh_token,
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "obtained_at": obtained_at,
        });

        self.store().save(&payload.to_string())
    }

    fn load_token(&mut self) -> Result<bool, String> {
        let decrypted = match self.store().load()? {
            Some(d) => d,
            None => return Ok(false),
        };

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
        let obtained_at = raw.get("obtained_at").and_then(|v| v.as_u64()).unwrap_or(0);

        if refresh_token.is_empty() || client_id.is_empty() || client_secret.is_empty() {
            return Ok(false);
        }

        self.client_id = Some(client_id);
        self.client_secret = Some(client_secret);
        *self.token_data.lock().unwrap() = Some(TokenData {
            access_token: String::new(),
            refresh_token: Some(refresh_token),
            expires_in: 0,
            obtained_at,
        });

        Ok(true)
    }

    async fn refresh_access_token(&self) -> TokenRefresh {
        // Missing local material is a definitive failure (nothing to retry with).
        // Copy the refresh token out under the lock; the guard drops before the
        // HTTP await (a std MutexGuard held across .await would not compile).
        let refresh_token = match self
            .token_data
            .lock()
            .unwrap()
            .as_ref()
            .and_then(|t| t.refresh_token.clone())
        {
            Some(rt) => rt,
            None => return TokenRefresh::Invalid,
        };
        let client_id = match &self.client_id {
            Some(id) => id.clone(),
            None => return TokenRefresh::Invalid,
        };
        let client_secret = match &self.client_secret {
            Some(s) => s.clone(),
            None => return TokenRefresh::Invalid,
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
                    // A 200 with no access_token is a malformed response — treat as
                    // transient (don't destroy the refresh token over it).
                    if access_token.is_empty() {
                        log::warn!("[gemini] Token refresh: 200 but no access_token");
                        return TokenRefresh::Transient;
                    }
                    let expires_in = data.get("expires_in").and_then(|v| v.as_u64()).unwrap_or(0);

                    {
                        let mut guard = self.token_data.lock().unwrap();
                        if let Some(td) = guard.as_mut() {
                            td.access_token = access_token;
                            td.expires_in = expires_in;
                            td.obtained_at = now_millis();
                        }
                    } // drop the guard before save_token re-locks
                    let _ = self.save_token();
                    return TokenRefresh::Ok;
                }
                TokenRefresh::Transient
            }
            // 4xx (invalid_grant / revoked) = the refresh token is dead.
            Ok(resp) if resp.status().is_client_error() => {
                log::warn!("[gemini] Token refresh rejected: {}", resp.status());
                TokenRefresh::Invalid
            }
            // 5xx or a network/timeout error = transient; keep credentials.
            Ok(resp) => {
                log::warn!(
                    "[gemini] Token refresh transient failure: {}",
                    resp.status()
                );
                TokenRefresh::Transient
            }
            Err(e) => {
                log::warn!("[gemini] Token refresh network error: {e}");
                TokenRefresh::Transient
            }
        }
    }

    async fn get_valid_token(&self) -> Option<String> {
        // Read expiry under the lock, drop the guard before the refresh await.
        let expired = {
            let guard = self.token_data.lock().unwrap();
            guard.as_ref()?.is_expired()
        };
        if expired && self.refresh_access_token().await != TokenRefresh::Ok {
            return None;
        }
        self.token_data
            .lock()
            .unwrap()
            .as_ref()
            .map(|t| t.access_token.clone())
    }

    fn delete_config(&self) {
        self.store().delete();
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

    async fn authenticate(&mut self, app: &AppHandle, credentials: Value) -> Result<bool, String> {
        let client_id = credentials
            .get("clientId")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let client_secret = credentials
            .get("clientSecret")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        if !is_valid_api_key(client_id) || !is_valid_api_key(client_secret) {
            log::warn!("[gemini] Auth rejected: invalid credential format");
            emit_auth_result(app, self.id(), false);
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
          // Accept in a LOOP: browsers open speculative preconnections and probe
          // /favicon.ico, and any of those could be the first accepted connection.
          // Ignore stray/mismatched requests and keep waiting for the real callback
          // (or the 5-minute timeout) instead of letting one probe abort the sign-in.
          loop {
            let (mut stream, _addr) = listener
                .accept()
                .await
                .map_err(|e| format!("Failed to accept connection: {e}"))?;

            // Read the HTTP request
            let mut buf = vec![0u8; 4096];
            let n = match stream.read(&mut buf).await {
                Ok(n) if n > 0 => n,
                _ => continue, // empty/failed read (e.g. a bare preconnect) — keep waiting
            };
            let request = String::from_utf8_lossy(&buf[..n]);

            // Parse the request line to get the path
            let first_line = request.lines().next().unwrap_or("");
            let path = first_line.split_whitespace().nth(1).unwrap_or("");

            // Parse query parameters from the callback URL. Values are form-encoded,
            // so percent-decode them — Google's authorization code contains `%2F`
            // (a `/`); using the raw value fails the token exchange with invalid_grant.
            let query_start = path.find('?').map(|i| i + 1).unwrap_or(path.len());
            let query_str = &path[query_start..];
            let params: HashMap<String, String> = query_str
                .split('&')
                .filter_map(|pair| {
                    let mut parts = pair.splitn(2, '=');
                    let key = parts.next()?.to_string();
                    let value = percent_decode(parts.next().unwrap_or(""));
                    Some((key, value))
                })
                .collect();

            let received_state = params.get("state").cloned().unwrap_or_default();
            let code = params.get("code").cloned().unwrap_or_default();
            let error = params.get("error").cloned().unwrap_or_default();

            // A request carrying none of our OAuth params (favicon probe, preconnect)
            // is not the callback — answer 204 and keep waiting.
            if received_state.is_empty() && code.is_empty() && error.is_empty() {
                let _ = stream.write_all(b"HTTP/1.1 204 No Content\r\n\r\n").await;
                continue;
            }

            // CSRF: a request whose state doesn't match the one we generated isn't
            // our callback (stray tab / hostile probe) — keep waiting, don't abort.
            if received_state != oauth_state {
                log::warn!("[gemini] Ignoring callback with mismatched state");
                let _ = stream.write_all(b"HTTP/1.1 400 Bad Request\r\n\r\n").await;
                continue;
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

            return Ok(token_data);
          } // loop
        })
        .await;

        match result {
            Ok(Ok(token_data)) => {
                *self.token_data.lock().unwrap() = Some(token_data);
                if let Err(e) = self.save_token() {
                    log::error!("[gemini] Failed to save token: {e}");
                }
                log::info!("[gemini] Auth success");
                emit_auth_result(&app_clone, self.id(), true);
                Ok(true)
            }
            Ok(Err(e)) => {
                log::error!("[gemini] Auth error: {e}");
                emit_auth_result(&app_clone, self.id(), false);
                Ok(false)
            }
            Err(_) => {
                log::warn!("[gemini] Auth timeout (5 minutes)");
                emit_auth_result(&app_clone, self.id(), false);
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

        // Try to refresh the access token.
        match self.refresh_access_token().await {
            TokenRefresh::Ok => {
                log::info!("[gemini] Auto-auth success");
                Ok(true)
            }
            TokenRefresh::Transient => {
                // Network/timeout/5xx — KEEP the persisted refresh token so a later
                // launch (once connectivity returns) can silently re-auth. Only the
                // in-memory access token is stale; get_valid_token retries on demand.
                log::warn!("[gemini] Auto-auth deferred: transient token refresh failure (credentials kept)");
                Ok(false)
            }
            TokenRefresh::Invalid => {
                // The refresh token is dead (revoked / invalid_grant) — clear it.
                self.logout();
                Ok(false)
            }
        }
    }

    fn get_auth_status(&self) -> AuthStatus {
        AuthStatus {
            authenticated: self.token_data.lock().unwrap().is_some(),
            account_info: None,
        }
    }

    fn logout(&mut self) {
        log::info!("[gemini] Logout");
        *self.token_data.lock().unwrap() = None;
        self.client_id = None;
        self.client_secret = None;
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

        self.history.push(session_id, "user", message);

        // Build Gemini request body from the current history snapshot
        let contents: Vec<Value> = self
            .history
            .snapshot(session_id)
            .into_iter()
            .map(|msg| {
                serde_json::json!({
                    "role": msg.role,
                    "parts": [{"text": msg.content}]
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

        // Use the command-supplied token (also registered outside the service
        // lock so Stop can cancel mid-stream) and keep a local copy so logout()
        // can cancel every in-flight stream.
        self.cancel_tokens
            .lock()
            .unwrap()
            .insert(session_id.to_string(), cancel_token.clone());

        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse"
        );
        let app_clone = app.clone();
        let sid = session_id.to_string();

        log::debug!(
            "[gemini] Sending message, model={model}, system_instruction={system_instruction:?}"
        );

        let response = match self
            .http_client
            .post(&url)
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Bearer {token}"))
            .body(body.to_string())
            .send()
            .await
        {
            Ok(resp) => resp,
            Err(e) => {
                // Transport failure — emit an error and roll back the pushed user
                // turn / cancel token, instead of a bare `?` that leaks both.
                log::error!("[gemini] request failed: {e}");
                emit_chat_response(
                    &app_clone,
                    ChatResponseData {
                        session_id: sid.clone(),
                        response_type: "error".into(),
                        content: describe_transport_error("Gemini"),
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
            log::error!("[gemini] API error {status}: {error_body}");
            emit_chat_response(
                &app_clone,
                ChatResponseData {
                    session_id: sid.clone(),
                    response_type: "error".into(),
                    content: describe_http_error("Gemini", status, &error_body),
                    usage_metadata: None,
                },
            );
            // Drop the user message pushed before the request so the history
            // stays consistent for retry (mirror vertexai's pop-on-error).
            self.history.pop_trailing_user(&sid);
            self.cancel_tokens.lock().unwrap().remove(&sid);
            return Ok(());
        }

        match run_google_sse_stream(
            response.bytes_stream(),
            &AppHandleSink(&app_clone),
            &sid,
            &cancel_token,
        )
        .await
        {
            Ok(outcome) => {
                // Normal completion or cancel: close out the assistant turn so the
                // user/assistant alternation stays consistent for the next request.
                self.history.finalize_assistant(
                    &sid,
                    "model",
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
                // pushed before the request rather than committing a partial
                // assistant turn — that would corrupt the alternation and resend a
                // truncated reply as context on the next request.
                log::error!("[gemini] Stream error: {e}");
                emit_chat_response(
                    &app_clone,
                    ChatResponseData {
                        session_id: sid.clone(),
                        response_type: "error".into(),
                        content: describe_transport_error("Gemini"),
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
        let token = self
            .get_valid_token()
            .await
            .ok_or("Authentication expired.")?;

        let body = serde_json::json!({
            "contents": [{
                "role": "user",
                "parts": [{"text": build_user_prompt(command)}]
            }],
            "system_instruction": {"parts": [{"text": CLASSIFIER_SYSTEM_PROMPT}]},
            "generationConfig": {
                "temperature": 0,
                "response_mime_type": "application/json",
                "response_schema": gemini_response_schema(),
            }
        });

        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        );

        let response = self
            .http_client
            .post(&url)
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Bearer {token}"))
            .timeout(std::time::Duration::from_secs(20))
            .body(body.to_string())
            .send()
            .await
            .map_err(|e| format!("Gemini classification request failed: {e}"))?;

        if !response.status().is_success() {
            let status = response.status();
            log::warn!("[gemini] classify_command failed: {status}");
            return Err(format!("classification request failed: {status}"));
        }

        let data: Value = response
            .json()
            .await
            .map_err(|e| format!("failed to read classification response: {e}"))?;

        let content = extract_gemini_text(&data).ok_or("classification response had no content")?;
        parse_verdict(content)
    }

    fn clear_history(&self, session_id: &str) {
        self.history.clear(session_id);
    }

    async fn list_models(&self) -> Result<Vec<ModelInfo>, String> {
        // Refresh an expired access token first (mirrors send_message). Reading
        // the cached token without refreshing made an expired token look like
        // "no models", surfacing as a spurious model-list error until restart.
        // A genuine failure (token refresh failed, transport error, non-2xx) returns
        // Err so the frontend's retry+banner engages instead of masking it as "no
        // models". A successful-but-empty response stays Ok (the frontend treats an
        // empty list as retry-worthy too).
        let token = match self.get_valid_token().await {
            Some(t) if !t.is_empty() => t,
            _ => return Err("Gemini access token unavailable — sign in again".to_string()),
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
            Ok(r) => {
                return Err(format!(
                    "Gemini model list request failed: HTTP {}",
                    r.status()
                ))
            }
            Err(e) => return Err(format!("Gemini model list request failed: {e}")),
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
        assert!(is_valid_api_key("abc123.apps.googleusercontent.com"));
        assert!(is_valid_api_key("GOCSPX-abc123"));
    }

    #[test]
    fn invalid_credentials() {
        assert!(!is_valid_api_key(""));
        assert!(!is_valid_api_key("has spaces"));
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
    fn percent_decode_handles_oauth_code() {
        // Google's authorization code arrives with %2F for its '/'.
        assert_eq!(percent_decode("4%2F0AeanS0abc-_xyz"), "4/0AeanS0abc-_xyz");
        assert_eq!(percent_decode("a+b"), "a b");
        assert_eq!(percent_decode("plain"), "plain");
        // A malformed trailing escape is left as-is rather than dropped.
        assert_eq!(percent_decode("bad%"), "bad%");
        assert_eq!(percent_decode("hex%zz"), "hex%zz");
    }

    #[test]
    fn pkce_challenge_generation() {
        let verifier = BASE64URL.encode(rand::random::<[u8; 32]>());
        let challenge = BASE64URL.encode(Sha256::digest(verifier.as_bytes()));
        assert!(!verifier.is_empty());
        assert!(!challenge.is_empty());
        assert_ne!(verifier, challenge);
    }

    #[test]
    fn extract_and_parse_classification_response() {
        let body = serde_json::json!({
            "candidates": [{
                "content": {
                    "parts": [{
                        "text": "{\"modifiesState\": false, \"confidence\": 0.92, \"reason\": \"read-only show command\"}"
                    }]
                }
            }]
        });
        let content = extract_gemini_text(&body).unwrap();
        let verdict = parse_verdict(content).unwrap();
        assert!(!verdict.modifies_state);
        assert_eq!(verdict.reason, "read-only show command");
    }
}
