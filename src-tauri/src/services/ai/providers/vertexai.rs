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
    build_user_prompt, gemini_response_schema, parse_verdict, CommandVerdict,
    CLASSIFIER_SYSTEM_PROMPT,
};
use crate::services::ai::config_store::EncryptedConfigStore;
use crate::services::ai::sse::{parse_sse_line, SseBuffer, SseLine};
use crate::services::ai::streaming::finalize_assistant_content;
use crate::services::path_safety::is_unc_path;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CREDENTIAL_FILE_MAX_SIZE: u64 = 10 * 1024; // 10 KB
const VALID_MODEL_PATTERN: &str = r"^[a-zA-Z0-9/._-]+$";
const VALID_PROJECT_PATTERN: &str = r"^[a-z][a-z0-9-]{4,28}[a-z0-9]$";
const VALID_LOCATION_PATTERN: &str = r"^(?:global|[a-z][a-z0-9-]+)$";
const CONFIG_FILE_NAME: &str = "vertexai_config.json";
const ANTHROPIC_VERSION_VERTEX: &str = "vertex-2023-10-16";
const MAX_TOKENS_ANTHROPIC: u32 = 8096;

const NON_TEXT_MODEL_KEYWORDS: &[&str] = &[
    "imagen",
    "imagegeneration",
    "imagetext",
    "veo",
    "chirp",
    "speech",
    "audio",
    "video",
    "lyria",
    "voice",
    "stable-diffusion",
    "flux",
    "text-to-speech",
    "translate",
    "virtual-try-on",
];

fn is_valid_model(model: &str) -> bool {
    Regex::new(VALID_MODEL_PATTERN)
        .map(|re| re.is_match(model))
        .unwrap_or(false)
}

fn is_valid_project(project: &str) -> bool {
    Regex::new(VALID_PROJECT_PATTERN)
        .map(|re| re.is_match(project))
        .unwrap_or(false)
}

fn is_valid_location(location: &str) -> bool {
    Regex::new(VALID_LOCATION_PATTERN)
        .map(|re| re.is_match(location))
        .unwrap_or(false)
}

/// Build the Vertex AI API base URL, handling the global endpoint correctly.
fn vertex_base_url(loc: &str, api_version: &str) -> String {
    let host = if loc == "global" {
        "aiplatform.googleapis.com".to_string()
    } else {
        format!("{loc}-aiplatform.googleapis.com")
    };
    format!("https://{host}/{api_version}")
}

/// Build a resource path prefix like `projects/{pid}/locations/{loc}`.
fn vertex_resource_prefix(project_id: &str, loc: &str) -> String {
    format!("projects/{project_id}/locations/{loc}")
}

/// Extract the first text part from a non-streaming `generateContent` response
/// body. Pulled out so the classification parsing path is unit-testable.
fn extract_candidate_text(data: &Value) -> Option<&str> {
    data.pointer("/candidates/0/content/parts/0/text")
        .and_then(|v| v.as_str())
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

// ---------------------------------------------------------------------------
// Token / Refresh / Config types
// ---------------------------------------------------------------------------

#[derive(Clone)]
struct TokenData {
    access_token: String,
    expires_at: u64, // millis since epoch
}

impl TokenData {
    fn is_expired(&self) -> bool {
        now_millis() >= self.expires_at
    }
}

#[derive(Clone)]
enum RefreshData {
    AuthorizedUser {
        client_id: String,
        client_secret: String,
        refresh_token: String,
    },
    ServiceAccount {
        client_email: String,
        private_key: String,
    },
}

#[derive(Clone)]
struct VertexConfig {
    project_id: String,
    location: String,
    auth_type: String, // "adc" or "service_account"
}

#[derive(Clone)]
struct ChatMessage {
    role: String,
    content: String,
}

// ---------------------------------------------------------------------------
// JWT creation for service accounts
// ---------------------------------------------------------------------------

fn create_jwt(client_email: &str, private_key: &str) -> Result<String, String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let claims = serde_json::json!({
        "iss": client_email,
        "scope": "https://www.googleapis.com/auth/cloud-platform",
        "aud": "https://oauth2.googleapis.com/token",
        "iat": now,
        "exp": now + 3600,
    });

    let header = jsonwebtoken::Header::new(jsonwebtoken::Algorithm::RS256);
    let key = jsonwebtoken::EncodingKey::from_rsa_pem(private_key.as_bytes())
        .map_err(|e| format!("Invalid private key: {e}"))?;

    jsonwebtoken::encode(&header, &claims, &key).map_err(|e| format!("JWT creation failed: {e}"))
}

// ---------------------------------------------------------------------------
// Error message formatting
// ---------------------------------------------------------------------------

fn format_user_error_message(err_msg: &str, model: &str) -> String {
    let short_model = model.rsplit('/').next().unwrap_or(model);

    // Region not supported
    if let Ok(re) = Regex::new(r"(?i)not servable in region") {
        if re.is_match(err_msg) {
            let region = Regex::new(r"region\s+(\S+)")
                .ok()
                .and_then(|re| re.captures(err_msg))
                .and_then(|c| c.get(1))
                .map(|m| m.as_str().trim_end_matches('.'))
                .unwrap_or("the current region");
            return format!(
                "\"{short_model}\" is not available in region \"{region}\". \
                 Try switching to a supported region (e.g. us-east5, europe-west1) in AI settings."
            );
        }
    }

    // Model not found or not enabled
    if let Ok(re) = Regex::new(r"(?i)not found|does not have access") {
        if re.is_match(err_msg) {
            return format!(
                "\"{short_model}\" is not enabled in your GCP project. \
                 Please enable the model in the Google Cloud Console (Vertex AI > Model Garden) and try again."
            );
        }
    }

    // Permission denied
    if let Ok(re) = Regex::new(r"(?i)permission denied|forbidden") {
        if re.is_match(err_msg) {
            return format!(
                "Permission denied for \"{short_model}\". \
                 Check that your GCP account has access to this model."
            );
        }
    }

    // Quota exceeded
    if let Ok(re) = Regex::new(r"(?i)quota|rate limit|resource exhausted") {
        if re.is_match(err_msg) {
            return format!(
                "Quota exceeded for \"{short_model}\". Your GCP project may need a quota increase for this model."
            );
        }
    }

    // Generic with status code
    if let Ok(re) = Regex::new(r"API error (\d+)") {
        if let Some(caps) = re.captures(err_msg) {
            if let Some(code) = caps.get(1) {
                return format!(
                    "\"{short_model}\" returned error {}. \
                     Please check your Vertex AI configuration and try again.",
                    code.as_str()
                );
            }
        }
    }

    "An error occurred while communicating with Vertex AI. Please try again.".to_string()
}

// ---------------------------------------------------------------------------
// VertexAIProvider
// ---------------------------------------------------------------------------

pub struct VertexAIProvider {
    token_data: Option<TokenData>,
    refresh_data: Option<RefreshData>,
    config: Option<VertexConfig>,
    chat_histories: HashMap<String, Vec<ChatMessage>>,
    cancel_tokens: HashMap<String, CancellationToken>,
    app_data_dir: PathBuf,
    http_client: reqwest::Client,
}

impl VertexAIProvider {
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self {
            token_data: None,
            refresh_data: None,
            config: None,
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
        EncryptedConfigStore::new(&self.app_data_dir, CONFIG_FILE_NAME, "vertexai")
    }

    fn get_adc_path() -> PathBuf {
        let appdata = std::env::var("APPDATA").unwrap_or_else(|_| {
            let home = std::env::var("USERPROFILE").unwrap_or_default();
            format!("{home}\\AppData\\Roaming")
        });
        PathBuf::from(appdata)
            .join("gcloud")
            .join("application_default_credentials.json")
    }

    fn save_config(&self) -> Result<(), String> {
        let config = self.config.as_ref().ok_or("No config to save")?;
        let refresh = self.refresh_data.as_ref().ok_or("No refresh data to save")?;

        let refresh_json = match refresh {
            RefreshData::AuthorizedUser {
                client_id,
                client_secret,
                refresh_token,
            } => serde_json::json!({
                "type": "authorized_user",
                "client_id": client_id,
                "client_secret": client_secret,
                "refresh_token": refresh_token,
            }),
            RefreshData::ServiceAccount {
                client_email,
                private_key,
            } => serde_json::json!({
                "type": "service_account",
                "client_email": client_email,
                "private_key": private_key,
            }),
        };

        let payload = serde_json::json!({
            "config": {
                "projectId": config.project_id,
                "location": config.location,
                "authType": config.auth_type,
            },
            "refreshData": refresh_json,
        });

        self.store().save(&payload.to_string())
    }

    fn load_config(&mut self) -> Result<bool, String> {
        let store = self.store();
        let path = store.path();
        if !path.exists() {
            return Ok(false);
        }

        // Size guard before decrypting: a credential file this large is almost
        // certainly corrupt/hostile. Kept here (not in the shared store) because
        // it's specific to the structured Vertex config.
        let meta = std::fs::metadata(path).map_err(|e| format!("Failed to stat config: {e}"))?;
        if meta.len() > CREDENTIAL_FILE_MAX_SIZE {
            log::warn!("[vertexai] Config file exceeds size limit");
            return Ok(false);
        }

        let decrypted = match store.load()? {
            Some(d) => d,
            None => return Ok(false),
        };

        let raw: Value =
            serde_json::from_str(&decrypted).map_err(|e| format!("Invalid config JSON: {e}"))?;

        // Parse config
        let cfg = raw.get("config").ok_or("Missing config key")?;
        let project_id = cfg
            .get("projectId")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let location = cfg
            .get("location")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let auth_type = cfg
            .get("authType")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        if project_id.is_empty() || location.is_empty() {
            return Ok(false);
        }

        // Parse refresh data
        let rd = raw.get("refreshData").ok_or("Missing refreshData key")?;
        let rd_type = rd.get("type").and_then(|v| v.as_str()).unwrap_or("");

        let refresh_data = match rd_type {
            "authorized_user" => {
                let client_id = rd
                    .get("client_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let client_secret = rd
                    .get("client_secret")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let refresh_token = rd
                    .get("refresh_token")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if client_id.is_empty() || client_secret.is_empty() || refresh_token.is_empty() {
                    return Ok(false);
                }
                RefreshData::AuthorizedUser {
                    client_id,
                    client_secret,
                    refresh_token,
                }
            }
            "service_account" => {
                let client_email = rd
                    .get("client_email")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let private_key = rd
                    .get("private_key")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if client_email.is_empty() || private_key.is_empty() {
                    return Ok(false);
                }
                RefreshData::ServiceAccount {
                    client_email,
                    private_key,
                }
            }
            _ => return Ok(false),
        };

        self.config = Some(VertexConfig {
            project_id,
            location,
            auth_type,
        });
        self.refresh_data = Some(refresh_data);
        Ok(true)
    }

    fn delete_config(&self) {
        self.store().delete();
    }

    async fn refresh_token(&mut self) -> Option<String> {
        let refresh_data = self.refresh_data.as_ref()?;

        let result = match refresh_data {
            RefreshData::AuthorizedUser {
                client_id,
                client_secret,
                refresh_token,
            } => {
                let params = [
                    ("client_id", client_id.as_str()),
                    ("client_secret", client_secret.as_str()),
                    ("refresh_token", refresh_token.as_str()),
                    ("grant_type", "refresh_token"),
                ];
                self.http_client
                    .post("https://oauth2.googleapis.com/token")
                    .form(&params)
                    .timeout(std::time::Duration::from_secs(15))
                    .send()
                    .await
            }
            RefreshData::ServiceAccount {
                client_email,
                private_key,
            } => {
                let jwt = match create_jwt(client_email, private_key) {
                    Ok(j) => j,
                    Err(e) => {
                        log::error!("[vertexai] JWT creation failed: {e}");
                        return None;
                    }
                };
                let params = [
                    (
                        "grant_type",
                        "urn:ietf:params:oauth:grant-type:jwt-bearer",
                    ),
                    ("assertion", &jwt),
                ];
                self.http_client
                    .post("https://oauth2.googleapis.com/token")
                    .form(&params)
                    .timeout(std::time::Duration::from_secs(15))
                    .send()
                    .await
            }
        };

        match result {
            Ok(resp) if resp.status().is_success() => {
                if let Ok(data) = resp.json::<Value>().await {
                    let access_token = data
                        .get("access_token")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let expires_in = data.get("expires_in").and_then(|v| v.as_u64()).unwrap_or(0);

                    self.token_data = Some(TokenData {
                        access_token: access_token.clone(),
                        expires_at: now_millis() + expires_in.saturating_sub(60) * 1000,
                    });
                    return Some(access_token);
                }
                None
            }
            Ok(resp) => {
                log::warn!("[vertexai] Token refresh failed: {}", resp.status());
                None
            }
            Err(e) => {
                log::warn!("[vertexai] Token refresh error: {e}");
                None
            }
        }
    }

    async fn get_valid_token(&mut self) -> Option<String> {
        if let Some(td) = &self.token_data {
            if !td.is_expired() {
                return Some(td.access_token.clone());
            }
        }
        self.refresh_token().await
    }

    /// Stream a Google-format (Gemini) API call.
    #[allow(clippy::too_many_arguments)]
    async fn call_google_api(
        &self,
        app: &AppHandle,
        sid: &str,
        model_path: &str,
        history: &[ChatMessage],
        system_instruction: Option<&str>,
        token: &str,
        cancel_token: &CancellationToken,
    ) -> Result<(String, Option<TokenUsage>), String> {
        let config = self.config.as_ref().unwrap();
        let url = format!(
            "{}/{}/{}:streamGenerateContent?alt=sse",
            vertex_base_url(&config.location, "v1beta1"),
            vertex_resource_prefix(&config.project_id, &config.location),
            model_path,
        );

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

        log::debug!("[vertexai] Sending message (Google), url={url}");

        let response = self
            .http_client
            .post(&url)
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Bearer {token}"))
            .body(body.to_string())
            .send()
            .await
            .map_err(|e| format!("Vertex AI request failed: {e}"))?;

        if !response.status().is_success() {
            // Capture the status BEFORE consuming the body with .text() — once
            // the response is consumed the status is gone, so this must be read
            // first or the user-facing error would show a placeholder code.
            let status = response.status().as_u16();
            let error_body = response
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".into());
            return Err(format!("API error {status}: {error_body}"));
        }

        self.stream_google_response(app, sid, response, cancel_token)
            .await
    }

    async fn stream_google_response(
        &self,
        app: &AppHandle,
        sid: &str,
        response: reqwest::Response,
        cancel_token: &CancellationToken,
    ) -> Result<(String, Option<TokenUsage>), String> {
        let mut stream = response.bytes_stream();
        let mut sse_buf = SseBuffer::new();
        let mut full_response = String::new();
        let mut last_usage: Option<TokenUsage> = None;

        loop {
            tokio::select! {
                _ = cancel_token.cancelled() => break,
                chunk = stream.next() => {
                    match chunk {
                        Some(Ok(bytes)) => {
                            let lines = sse_buf.push(&bytes);
                            for line in lines {
                                if let SseLine::Data(data) = parse_sse_line(&line) {
                                    if data.is_empty() { continue; }
                                    if let Ok(parsed) = serde_json::from_str::<Value>(data) {
                                        if let Some(text) = parsed
                                            .pointer("/candidates/0/content/parts/0/text")
                                            .and_then(|v| v.as_str())
                                        {
                                            if !text.is_empty() {
                                                full_response.push_str(text);
                                                emit_chat_response(app, ChatResponseData {
                                                    session_id: sid.to_string(),
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
                        Some(Err(e)) => return Err(format!("Stream error: {e}")),
                        None => break,
                    }
                }
            }
        }

        Ok((full_response, last_usage))
    }

    /// Stream an Anthropic-format API call via Vertex AI streamRawPredict.
    #[allow(clippy::too_many_arguments)]
    async fn call_anthropic_api(
        &self,
        app: &AppHandle,
        sid: &str,
        model_path: &str,
        history: &[ChatMessage],
        system_instruction: Option<&str>,
        token: &str,
        cancel_token: &CancellationToken,
    ) -> Result<(String, Option<TokenUsage>), String> {
        let config = self.config.as_ref().unwrap();
        let url = format!(
            "{}/{}/{}:streamRawPredict",
            vertex_base_url(&config.location, "v1"),
            vertex_resource_prefix(&config.project_id, &config.location),
            model_path,
        );

        // Anthropic uses 'assistant' instead of 'model' for the AI role
        let messages: Vec<Value> = history
            .iter()
            .map(|msg| {
                let role = if msg.role == "model" {
                    "assistant"
                } else {
                    &msg.role
                };
                serde_json::json!({"role": role, "content": &msg.content})
            })
            .collect();

        let mut body = serde_json::json!({
            "anthropic_version": ANTHROPIC_VERSION_VERTEX,
            "messages": messages,
            "max_tokens": MAX_TOKENS_ANTHROPIC,
            "stream": true,
        });
        if let Some(sys) = system_instruction {
            body.as_object_mut()
                .unwrap()
                .insert("system".into(), serde_json::json!(sys));
        }

        log::debug!("[vertexai] Sending message (Anthropic), url={url}");

        let response = self
            .http_client
            .post(&url)
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Bearer {token}"))
            .header("X-Goog-User-Project", &config.project_id)
            .body(body.to_string())
            .send()
            .await
            .map_err(|e| format!("Vertex AI request failed: {e}"))?;

        if !response.status().is_success() {
            // Capture the status BEFORE consuming the body with .text().
            let status = response.status().as_u16();
            let error_body = response
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".into());
            return Err(format!("API error {status}: {error_body}"));
        }

        self.stream_anthropic_response(app, sid, response, cancel_token)
            .await
    }

    async fn stream_anthropic_response(
        &self,
        app: &AppHandle,
        sid: &str,
        response: reqwest::Response,
        cancel_token: &CancellationToken,
    ) -> Result<(String, Option<TokenUsage>), String> {
        let mut stream = response.bytes_stream();
        let mut sse_buf = SseBuffer::new();
        let mut full_response = String::new();
        let mut current_event = String::new();
        let mut input_tokens: u32 = 0;
        let mut output_tokens: u32 = 0;

        loop {
            tokio::select! {
                _ = cancel_token.cancelled() => break,
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
                                        if data.is_empty() { continue; }
                                        if let Ok(parsed) = serde_json::from_str::<Value>(data) {
                                            match current_event.as_str() {
                                                "content_block_delta" => {
                                                    if let Some(text) = parsed
                                                        .pointer("/delta/text")
                                                        .and_then(|v| v.as_str())
                                                    {
                                                        if !text.is_empty() {
                                                            full_response.push_str(text);
                                                            emit_chat_response(app, ChatResponseData {
                                                                session_id: sid.to_string(),
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
                        Some(Err(e)) => return Err(format!("Stream error: {e}")),
                        None => break,
                    }
                }
            }
        }

        let usage = TokenUsage {
            prompt_token_count: Some(input_tokens),
            candidates_token_count: Some(output_tokens),
            total_token_count: Some(input_tokens + output_tokens),
        };

        Ok((full_response, Some(usage)))
    }
}

#[async_trait]
impl AIProvider for VertexAIProvider {
    fn id(&self) -> &str {
        "vertexai"
    }

    fn display_name(&self) -> &str {
        "Google Cloud Vertex AI"
    }

    fn auth_type(&self) -> AuthType {
        AuthType::Adc
    }

    async fn authenticate(
        &mut self,
        app: &AppHandle,
        credentials: Value,
    ) -> Result<bool, String> {
        let project_id = credentials
            .get("projectId")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let location = credentials
            .get("location")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let auth_type = credentials
            .get("authType")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let key_file_path = credentials
            .get("keyFilePath")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        if !is_valid_project(project_id) {
            log::warn!("[vertexai] Auth rejected: invalid project ID");
            emit_auth_result(app, false);
            return Ok(false);
        }
        if !is_valid_location(location) {
            log::warn!("[vertexai] Auth rejected: invalid location");
            emit_auth_result(app, false);
            return Ok(false);
        }

        let refresh_data = match auth_type {
            "adc" => {
                let adc_path = Self::get_adc_path();
                if !adc_path.exists() {
                    log::warn!("[vertexai] ADC file not found: {}", adc_path.display());
                    emit_auth_result(app, false);
                    return Ok(false);
                }
                let meta = std::fs::metadata(&adc_path)
                    .map_err(|e| format!("Failed to stat ADC file: {e}"))?;
                if meta.len() > CREDENTIAL_FILE_MAX_SIZE {
                    log::warn!("[vertexai] ADC file exceeds size limit");
                    emit_auth_result(app, false);
                    return Ok(false);
                }
                let content = std::fs::read_to_string(&adc_path)
                    .map_err(|e| format!("Failed to read ADC file: {e}"))?;
                let adc: Value = serde_json::from_str(&content)
                    .map_err(|e| format!("Invalid ADC JSON: {e}"))?;

                let cred_type = adc.get("type").and_then(|v| v.as_str()).unwrap_or("");
                match cred_type {
                    "authorized_user" => {
                        let client_id = adc
                            .get("client_id")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let client_secret = adc
                            .get("client_secret")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let refresh_token = adc
                            .get("refresh_token")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        if client_id.is_empty()
                            || client_secret.is_empty()
                            || refresh_token.is_empty()
                        {
                            emit_auth_result(app, false);
                            return Ok(false);
                        }
                        RefreshData::AuthorizedUser {
                            client_id,
                            client_secret,
                            refresh_token,
                        }
                    }
                    "service_account" => {
                        let client_email = adc
                            .get("client_email")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let private_key = adc
                            .get("private_key")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        if client_email.is_empty() || private_key.is_empty() {
                            emit_auth_result(app, false);
                            return Ok(false);
                        }
                        RefreshData::ServiceAccount {
                            client_email,
                            private_key,
                        }
                    }
                    _ => {
                        log::warn!("[vertexai] Unsupported ADC credential type: {cred_type}");
                        emit_auth_result(app, false);
                        return Ok(false);
                    }
                }
            }
            "service_account" => {
                if key_file_path.is_empty() {
                    emit_auth_result(app, false);
                    return Ok(false);
                }
                if is_unc_path(key_file_path) {
                    log::warn!("[vertexai] Rejected UNC service account key path");
                    emit_auth_result(app, false);
                    return Ok(false);
                }
                let resolved = PathBuf::from(key_file_path);
                if !resolved.exists() {
                    log::warn!("[vertexai] Service account key file not found");
                    emit_auth_result(app, false);
                    return Ok(false);
                }
                let meta = std::fs::metadata(&resolved)
                    .map_err(|e| format!("Failed to stat key file: {e}"))?;
                if meta.len() > CREDENTIAL_FILE_MAX_SIZE {
                    log::warn!("[vertexai] Service account key file exceeds size limit");
                    emit_auth_result(app, false);
                    return Ok(false);
                }
                let content = std::fs::read_to_string(&resolved)
                    .map_err(|e| format!("Failed to read key file: {e}"))?;
                let sa: Value = serde_json::from_str(&content)
                    .map_err(|e| format!("Invalid key file JSON: {e}"))?;

                let client_email = sa
                    .get("client_email")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let private_key = sa
                    .get("private_key")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if client_email.is_empty() || private_key.is_empty() {
                    log::warn!("[vertexai] Invalid service account key file");
                    emit_auth_result(app, false);
                    return Ok(false);
                }
                RefreshData::ServiceAccount {
                    client_email,
                    private_key,
                }
            }
            _ => {
                emit_auth_result(app, false);
                return Ok(false);
            }
        };

        self.refresh_data = Some(refresh_data);
        self.config = Some(VertexConfig {
            project_id: project_id.to_string(),
            location: location.to_string(),
            auth_type: auth_type.to_string(),
        });

        // Test token refresh
        let token = self.refresh_token().await;
        if token.is_none() {
            self.config = None;
            self.refresh_data = None;
            log::warn!("[vertexai] Failed to obtain access token");
            emit_auth_result(app, false);
            return Ok(false);
        }

        if let Err(e) = self.save_config() {
            log::error!(
                "[vertexai] Failed to persist config to {}: {e} — auth succeeded for this session but won't survive a restart",
                self.store().path().display()
            );
        }
        log::info!(
            "[vertexai] Auth success, project={project_id}, location={location}"
        );
        emit_auth_result(app, true);
        Ok(true)
    }

    async fn auto_auth(
        &mut self,
        _app_data_dir: &Path,
        credentials: Value,
    ) -> Result<bool, String> {
        let project_id = credentials
            .get("projectId")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let location = credentials
            .get("location")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        if !self.load_config()? {
            return Ok(false);
        }

        // Verify saved config matches what was passed
        let saved_config = self.config.as_ref().unwrap();
        if saved_config.project_id != project_id || saved_config.location != location {
            self.config = None;
            self.refresh_data = None;
            return Ok(false);
        }

        match self.refresh_token().await {
            Some(_) => {
                log::info!("[vertexai] Auto-auth success");
                Ok(true)
            }
            None => {
                self.config = None;
                self.refresh_data = None;
                Ok(false)
            }
        }
    }

    fn get_auth_status(&self) -> AuthStatus {
        let authenticated = self
            .token_data
            .as_ref()
            .map(|td| !td.is_expired())
            .unwrap_or(false);
        AuthStatus {
            authenticated,
            account_info: None,
        }
    }

    fn logout(&mut self) {
        log::info!("[vertexai] Logout");
        self.token_data = None;
        self.refresh_data = None;
        self.config = None;
        self.chat_histories.clear();
        for (_, token) in self.cancel_tokens.drain() {
            token.cancel();
        }
        self.delete_config();
    }

    fn set_location(&mut self, location: &str) {
        if let Some(config) = &mut self.config {
            if is_valid_location(location) {
                config.location = location.to_string();
                log::debug!("[vertexai] Location changed to {location}");
            }
        }
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

        if self.config.is_none() {
            emit_chat_response(
                app,
                ChatResponseData {
                    session_id: session_id.to_string(),
                    response_type: "error".into(),
                    content: "Not authenticated. Please connect to Vertex AI.".into(),
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
                        content: "Authentication expired. Please reconnect to Vertex AI.".into(),
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

        let cancel_token = CancellationToken::new();
        self.cancel_tokens
            .insert(session_id.to_string(), cancel_token.clone());

        // Route based on publisher
        let model_path = if model.starts_with("publishers/") {
            model.to_string()
        } else {
            format!("publishers/google/models/{model}")
        };
        let publisher = model_path.split('/').nth(1).unwrap_or("google");

        let sid = session_id.to_string();
        let history_snapshot: Vec<ChatMessage> = history.clone();

        let result = if publisher == "anthropic" {
            self.call_anthropic_api(
                app,
                &sid,
                &model_path,
                &history_snapshot,
                system_instruction,
                &token,
                &cancel_token,
            )
            .await
        } else {
            self.call_google_api(
                app,
                &sid,
                &model_path,
                &history_snapshot,
                system_instruction,
                &token,
                &cancel_token,
            )
            .await
        };

        match result {
            Ok((full_response, usage_metadata)) => {
                // Always close out the assistant turn so user/model alternation
                // stays consistent for the next request, even on cancel.
                if let Some(history) = self.chat_histories.get_mut(&sid) {
                    let content =
                        finalize_assistant_content(&full_response, cancel_token.is_cancelled());
                    history.push(ChatMessage {
                        role: "model".into(),
                        content,
                    });
                }
                if !cancel_token.is_cancelled() {
                    emit_chat_response(
                        app,
                        ChatResponseData {
                            session_id: sid.clone(),
                            response_type: "done".into(),
                            content: full_response,
                            usage_metadata,
                        },
                    );
                }
            }
            Err(err_msg) => {
                if !cancel_token.is_cancelled() {
                    log::error!("[vertexai] Chat error: {err_msg}");
                    emit_chat_response(
                        app,
                        ChatResponseData {
                            session_id: sid.clone(),
                            response_type: "error".into(),
                            content: format_user_error_message(&err_msg, model),
                            usage_metadata: None,
                        },
                    );
                }
                // On error, also pop the user message that was pushed before
                // the request so the history stays consistent for retry.
                if let Some(history) = self.chat_histories.get_mut(&sid) {
                    if matches!(history.last(), Some(m) if m.role == "user") {
                        history.pop();
                    }
                }
            }
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
        if self.config.is_none() {
            return Err("Not authenticated.".into());
        }
        let token = self
            .get_valid_token()
            .await
            .ok_or("Authentication expired.")?;

        let model_path = if model.starts_with("publishers/") {
            model.to_string()
        } else {
            format!("publishers/google/models/{model}")
        };
        let publisher = model_path.split('/').nth(1).unwrap_or("google");
        // Only the Google (Gemini) generateContent shape supports the structured
        // responseSchema used here. For Anthropic-on-Vertex models, degrade
        // gracefully — the frontend falls back to manual execution.
        if publisher != "google" {
            return Err(
                "classification is only supported for Google-published Vertex models".into(),
            );
        }

        let config = self.config.as_ref().unwrap();
        let url = format!(
            "{}/{}/{}:generateContent",
            vertex_base_url(&config.location, "v1beta1"),
            vertex_resource_prefix(&config.project_id, &config.location),
            model_path,
        );

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

        let response = self
            .http_client
            .post(&url)
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Bearer {token}"))
            .timeout(std::time::Duration::from_secs(20))
            .body(body.to_string())
            .send()
            .await
            .map_err(|e| format!("Vertex AI classification request failed: {e}"))?;

        if !response.status().is_success() {
            let status = response.status();
            log::warn!("[vertexai] classify_command failed: {status}");
            return Err(format!("classification request failed: {status}"));
        }

        let data: Value = response
            .json()
            .await
            .map_err(|e| format!("failed to read classification response: {e}"))?;

        let content =
            extract_candidate_text(&data).ok_or("classification response had no content")?;
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

    async fn list_locations(&self) -> Result<Vec<String>, String> {
        let config = match &self.config {
            Some(c) => c,
            None => return Ok(vec![]),
        };

        // We need a valid token but list_locations takes &self, not &mut self.
        // Use the current token if available.
        let token = match &self.token_data {
            Some(td) if !td.is_expired() => td.access_token.clone(),
            _ => return Ok(vec![]),
        };

        let url = format!(
            "{}/projects/{}/locations",
            vertex_base_url(&config.location, "v1"),
            config.project_id,
        );

        let response = self
            .http_client
            .get(&url)
            .header("Authorization", format!("Bearer {token}"))
            .header("X-Goog-User-Project", &config.project_id)
            .timeout(std::time::Duration::from_secs(15))
            .send()
            .await;

        let response = match response {
            Ok(r) if r.status().is_success() => r,
            Ok(r) => {
                log::warn!("[vertexai] Failed to fetch locations: {}", r.status());
                return Ok(vec![]);
            }
            Err(e) => {
                log::warn!("[vertexai] listLocations error: {e}");
                return Ok(vec![]);
            }
        };

        let data: Value = response
            .json()
            .await
            .unwrap_or_else(|_| serde_json::json!({}));

        let mut locations: Vec<String> = data
            .get("locations")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|l| l.get("locationId").and_then(|v| v.as_str()))
                    .map(|s| s.to_string())
                    .collect()
            })
            .unwrap_or_default();

        locations.sort();
        Ok(locations)
    }

    async fn list_models(&self) -> Result<Vec<ModelInfo>, String> {
        let config = match &self.config {
            Some(c) => c,
            None => return Ok(vec![]),
        };

        let token = match &self.token_data {
            Some(td) if !td.is_expired() => td.access_token.clone(),
            _ => return Ok(vec![]),
        };

        let publishers = ["google", "anthropic", "meta", "mistral-ai", "cohere"];
        let catalog_region = "us-central1";
        let catalog_base = format!("https://{catalog_region}-aiplatform.googleapis.com/v1beta1");

        log::debug!(
            "[vertexai] Fetching models from {} publishers, catalog={catalog_region}, target={}",
            publishers.len(),
            config.location,
        );

        // Fetch models from all publishers in parallel
        let mut handles = Vec::new();
        for publisher in &publishers {
            let url = format!("{catalog_base}/publishers/{publisher}/models");
            let client = self.http_client.clone();
            let token = token.clone();
            let project_id = config.project_id.clone();
            let pub_name = publisher.to_string();

            handles.push(tokio::spawn(async move {
                let response = client
                    .get(&url)
                    .header("Authorization", format!("Bearer {token}"))
                    .header("X-Goog-User-Project", &project_id)
                    .timeout(std::time::Duration::from_secs(15))
                    .send()
                    .await;

                let response = match response {
                    Ok(r) if r.status().is_success() => r,
                    _ => return (pub_name, vec![]),
                };

                let data: Value = response
                    .json()
                    .await
                    .unwrap_or_else(|_| serde_json::json!({}));

                let models: Vec<(String, String)> = data
                    .get("publisherModels")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter(|m| {
                                m.get("supportedActions")
                                    .and_then(|a| a.get("openGenerationAiStudio"))
                                    .is_some()
                            })
                            .filter(|m| {
                                let short = m
                                    .get("name")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                                    .rsplit('/')
                                    .next()
                                    .unwrap_or("")
                                    .to_lowercase();
                                !NON_TEXT_MODEL_KEYWORDS.iter().any(|kw| short.contains(kw))
                            })
                            .filter_map(|m| {
                                let name = m.get("name").and_then(|v| v.as_str())?.to_string();
                                let display = m
                                    .get("displayName")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                                    .to_string();
                                Some((name, display))
                            })
                            .collect()
                    })
                    .unwrap_or_default();

                (pub_name, models)
            }));
        }

        let mut all_models: Vec<ModelInfo> = Vec::new();
        for handle in handles {
            if let Ok((pub_name, models)) = handle.await {
                let pub_prefix = {
                    let mut chars = pub_name.chars();
                    match chars.next() {
                        Some(c) => format!("{}{}", c.to_uppercase(), chars.as_str()),
                        None => pub_name.clone(),
                    }
                };
                for (name, display) in models {
                    let short_name = name.rsplit('/').next().unwrap_or(&name);
                    let display_name = if display.is_empty() {
                        format!("{short_name} ({pub_prefix})")
                    } else {
                        format!("{display} ({pub_prefix})")
                    };
                    all_models.push(ModelInfo {
                        name,
                        display_name,
                    });
                }
            }
        }

        if all_models.is_empty() {
            log::warn!("[vertexai] No models found from any publisher");
            return Ok(vec![]);
        }

        // Verify model accessibility in the target region
        let location = &config.location;
        let project_id = &config.project_id;

        let google_models: Vec<ModelInfo> = all_models
            .iter()
            .filter(|m| m.name.starts_with("publishers/google/"))
            .cloned()
            .collect();
        let anthropic_models: Vec<ModelInfo> = all_models
            .iter()
            .filter(|m| m.name.starts_with("publishers/anthropic/"))
            .cloned()
            .collect();
        let other_models: Vec<ModelInfo> = all_models
            .iter()
            .filter(|m| {
                !m.name.starts_with("publishers/google/")
                    && !m.name.starts_with("publishers/anthropic/")
            })
            .cloned()
            .collect();

        // Verify Google models with countTokens
        let mut google_verified = Vec::new();
        {
            let mut handles = Vec::new();
            for m in &google_models {
                let url = format!(
                    "{}/{}/{}:countTokens",
                    vertex_base_url(location, "v1beta1"),
                    vertex_resource_prefix(project_id, location),
                    m.name,
                );
                let client = self.http_client.clone();
                let token = token.clone();
                let project_id = project_id.clone();
                let model_info = m.clone();

                handles.push(tokio::spawn(async move {
                    let body =
                        serde_json::json!({"contents": [{"role": "user", "parts": [{"text": "x"}]}]});
                    let resp = client
                        .post(&url)
                        .header("Content-Type", "application/json")
                        .header("Authorization", format!("Bearer {token}"))
                        .header("X-Goog-User-Project", &project_id)
                        .body(body.to_string())
                        .timeout(std::time::Duration::from_secs(20))
                        .send()
                        .await;

                    match resp {
                        Ok(r) if r.status().is_success() => Some(model_info),
                        Ok(r) if r.status().as_u16() == 429 => {
                            Some(ModelInfo {
                                name: model_info.name,
                                display_name: format!("{} [Quota limit]", model_info.display_name),
                            })
                        }
                        _ => None,
                    }
                }));
            }
            for handle in handles {
                if let Ok(Some(m)) = handle.await {
                    google_verified.push(m);
                }
            }
        }

        // Verify Anthropic models with streamRawPredict (empty messages -> 422 = accessible)
        let mut anthropic_verified = Vec::new();
        {
            let mut handles = Vec::new();
            for m in &anthropic_models {
                let url = format!(
                    "{}/{}/{}:streamRawPredict",
                    vertex_base_url(location, "v1"),
                    vertex_resource_prefix(project_id, location),
                    m.name,
                );
                let client = self.http_client.clone();
                let token = token.clone();
                let project_id = project_id.clone();
                let model_info = m.clone();

                handles.push(tokio::spawn(async move {
                    let body = serde_json::json!({
                        "anthropic_version": ANTHROPIC_VERSION_VERTEX,
                        "messages": [],
                        "max_tokens": 1,
                    });
                    let resp = client
                        .post(&url)
                        .header("Content-Type", "application/json")
                        .header("Authorization", format!("Bearer {token}"))
                        .header("X-Goog-User-Project", &project_id)
                        .body(body.to_string())
                        .timeout(std::time::Duration::from_secs(20))
                        .send()
                        .await;

                    match resp {
                        Ok(r) if r.status().is_success() || r.status().as_u16() == 422 => {
                            Some(model_info)
                        }
                        Ok(r) if r.status().as_u16() == 429 => {
                            Some(ModelInfo {
                                name: model_info.name,
                                display_name: format!("{} [Quota limit]", model_info.display_name),
                            })
                        }
                        Ok(r) => {
                            let status = r.status().as_u16();
                            let body = r.text().await.unwrap_or_default();
                            if status == 404
                                || Regex::new(r"(?i)not servable in region")
                                    .map(|re| re.is_match(&body))
                                    .unwrap_or(false)
                            {
                                None
                            } else {
                                // Other errors (e.g. validation) mean model IS accessible
                                Some(model_info)
                            }
                        }
                        Err(_) => None,
                    }
                }));
            }
            for handle in handles {
                if let Ok(Some(m)) = handle.await {
                    anthropic_verified.push(m);
                }
            }
        }

        let mut verified: Vec<ModelInfo> = Vec::new();
        verified.extend(google_verified);
        verified.extend(anthropic_verified);
        verified.extend(other_models);

        if verified.is_empty() {
            log::warn!("[vertexai] No accessible models found for this project");
            return Ok(vec![]);
        }

        // Sort: Google first, then alphabetically by display_name
        verified.sort_by(|a, b| {
            let a_google = a.name.contains("publishers/google");
            let b_google = b.name.contains("publishers/google");
            match (a_google, b_google) {
                (true, false) => std::cmp::Ordering::Less,
                (false, true) => std::cmp::Ordering::Greater,
                _ => a.display_name.cmp(&b.display_name),
            }
        });

        log::debug!(
            "[vertexai] listModels: {} models verified in region \"{}\"",
            verified.len(),
            location,
        );
        Ok(verified)
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_projects() {
        assert!(is_valid_project("my-project-123"));
        assert!(is_valid_project("abcdef"));
    }

    #[test]
    fn invalid_projects() {
        assert!(!is_valid_project(""));
        assert!(!is_valid_project("ab")); // too short
        assert!(!is_valid_project("MY-PROJECT")); // uppercase
        assert!(!is_valid_project("-starts-with-dash"));
        assert!(!is_valid_project("ends-with-dash-"));
    }

    #[test]
    fn valid_locations() {
        assert!(is_valid_location("us-central1"));
        assert!(is_valid_location("global"));
        assert!(is_valid_location("europe-west1"));
    }

    #[test]
    fn invalid_locations() {
        assert!(!is_valid_location(""));
        assert!(!is_valid_location("US-CENTRAL1"));
        assert!(!is_valid_location("us central1"));
    }

    #[test]
    fn valid_models() {
        assert!(is_valid_model("gemini-2.0-flash-001"));
        assert!(is_valid_model("publishers/google/models/gemini-2.0-flash"));
        assert!(is_valid_model("publishers/anthropic/models/claude-sonnet-4-6"));
    }

    #[test]
    fn invalid_models() {
        assert!(!is_valid_model(""));
        assert!(!is_valid_model("model with spaces"));
    }

    #[test]
    fn vertex_base_url_global() {
        assert_eq!(
            vertex_base_url("global", "v1"),
            "https://aiplatform.googleapis.com/v1"
        );
    }

    #[test]
    fn vertex_base_url_region() {
        assert_eq!(
            vertex_base_url("us-central1", "v1beta1"),
            "https://us-central1-aiplatform.googleapis.com/v1beta1"
        );
    }

    #[test]
    fn vertex_resource_prefix_format() {
        assert_eq!(
            vertex_resource_prefix("my-project", "us-central1"),
            "projects/my-project/locations/us-central1"
        );
    }

    #[test]
    fn extract_and_parse_classification_response() {
        let body = serde_json::json!({
            "candidates": [{
                "content": {
                    "parts": [{
                        "text": "{\"modifiesState\": true, \"confidence\": 0.9, \"reason\": \"writes config\"}"
                    }]
                }
            }]
        });
        let content = extract_candidate_text(&body).unwrap();
        let verdict = parse_verdict(content).unwrap();
        assert!(verdict.modifies_state);
        assert_eq!(verdict.reason, "writes config");
    }

    #[test]
    fn extract_candidate_text_missing() {
        let body = serde_json::json!({ "candidates": [] });
        assert!(extract_candidate_text(&body).is_none());
    }

    #[test]
    fn error_message_region_not_supported() {
        let msg =
            format_user_error_message("Model not servable in region us-west1.", "gemini-2.0-flash");
        assert!(msg.contains("not available in region"));
        assert!(msg.contains("us-west1"));
    }

    #[test]
    fn error_message_not_found() {
        let msg =
            format_user_error_message("Model not found in project", "publishers/google/models/x");
        assert!(msg.contains("not enabled"));
    }

    #[test]
    fn error_message_permission_denied() {
        let msg = format_user_error_message("Permission denied for resource", "gemini-2.0-flash");
        assert!(msg.contains("Permission denied"));
    }

    #[test]
    fn error_message_quota() {
        let msg = format_user_error_message("Resource exhausted", "gemini-2.0-flash");
        assert!(msg.contains("Quota exceeded"));
    }

    #[test]
    fn error_message_generic() {
        let msg = format_user_error_message("Something went wrong", "gemini-2.0-flash");
        assert!(msg.contains("An error occurred"));
    }

    #[test]
    fn error_message_surfaces_real_status_code() {
        // Regression guard for the "API error 0" bug: call_google_api /
        // call_anthropic_api now embed the real HTTP status (e.g. 503) before
        // consuming the body, so the generic branch must echo that code back —
        // never a hardcoded placeholder.
        let msg = format_user_error_message(
            "API error 503: backend temporarily unavailable",
            "publishers/google/models/gemini-2.0-flash",
        );
        assert!(msg.contains("503"), "expected real status in: {msg}");
        assert!(!msg.contains("error 0"), "must not show placeholder status: {msg}");
    }

    #[test]
    fn non_text_model_filtering() {
        assert!(NON_TEXT_MODEL_KEYWORDS
            .iter()
            .any(|kw| "imagen-3.0-generate".contains(kw)));
        assert!(!NON_TEXT_MODEL_KEYWORDS
            .iter()
            .any(|kw| "gemini-2.0-flash".contains(kw)));
    }
}
