use async_trait::async_trait;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Deserialize;
use std::io::{Read as IoRead, Write as IoWrite};
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tokio::sync::{mpsc, Mutex};
use tokio::task::JoinHandle;

use super::session_service::{
    emit_session_data, emit_session_error, emit_session_status, encoding_for, SessionError,
    SessionService,
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WslConfig {
    /// WSL distribution name (e.g. "Ubuntu"). Empty = default distribution.
    #[serde(default)]
    pub distribution: Option<String>,

    #[serde(default = "default_encoding")]
    pub encoding: String,
}

fn default_encoding() -> String {
    "utf8".to_string()
}

impl WslConfig {
    pub fn validate(&self) -> Result<(), SessionError> {
        if let Some(ref distro) = self.distribution {
            if !distro.is_empty() {
                // Defense-in-depth: reject shell metacharacters explicitly
                // before regex validation. portable_pty passes argv as an
                // array (no shell interpretation), but this guards against
                // future changes and any platform-specific quoting quirks.
                const BLOCKED_CHARS: &[char] = &[
                    '$', '`', '!', '(', ')', ';', '&', '|', '>', '<',
                    '\n', '\r', '\t', ' ', '"', '\'', '\\',
                ];
                if distro.chars().any(|c| BLOCKED_CHARS.contains(&c)) {
                    return Err(SessionError::InvalidConfig(format!(
                        "invalid WSL distribution name: {distro}"
                    )));
                }

                use std::sync::OnceLock;
                static RE: OnceLock<regex_lite::Regex> = OnceLock::new();
                let re = RE.get_or_init(|| {
                    regex_lite::Regex::new(r"^[a-zA-Z0-9_][a-zA-Z0-9_.\-]{0,62}$").unwrap()
                });
                if !re.is_match(distro) {
                    return Err(SessionError::InvalidConfig(format!(
                        "invalid WSL distribution name: {distro}"
                    )));
                }
            }
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Environment variable sanitization (shared logic with local.rs)
// ---------------------------------------------------------------------------

const SENSITIVE_PATTERNS: &[&str] = &[
    "API_KEY",
    "SECRET",
    "TOKEN",
    "PASSWORD",
    "PASSWD",
    "CREDENTIAL",
    "PRIVATE_KEY",
    "ACCESS_KEY",
];

fn is_sensitive_env_var(name: &str) -> bool {
    let upper = name.to_ascii_uppercase();
    SENSITIVE_PATTERNS.iter().any(|pat| upper.contains(pat))
}

fn sanitized_env() -> Vec<(String, String)> {
    std::env::vars()
        .filter(|(k, _)| !is_sensitive_env_var(k))
        .collect()
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

enum WriterCmd {
    Bytes(Vec<u8>),
    Resize(u16, u16),
    Close,
}

pub struct WslSession {
    config: WslConfig,
    encoding: &'static encoding_rs::Encoding,
    writer_tx: Option<mpsc::Sender<WriterCmd>>,
    join: Vec<JoinHandle<()>>,
}

impl WslSession {
    pub fn new(config: WslConfig) -> Self {
        let encoding = encoding_for(&config.encoding);
        Self {
            config,
            encoding,
            writer_tx: None,
            join: Vec::new(),
        }
    }
}

#[async_trait]
impl SessionService for WslSession {
    async fn connect(
        &mut self,
        app: AppHandle,
        session_id: String,
    ) -> Result<(), SessionError> {
        self.config.validate()?;

        let distro_desc = self
            .config
            .distribution
            .as_deref()
            .filter(|d| !d.is_empty())
            .unwrap_or("(default)");
        log::info!("wsl: spawning distribution={distro_desc} (session {session_id})");

        let pty_system = native_pty_system();
        let pty_pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| SessionError::ConnectionFailed(format!("failed to open PTY: {e}")))?;

        let mut cmd = CommandBuilder::new("wsl.exe");

        // If a specific distribution is requested, pass -d
        if let Some(ref distro) = self.config.distribution {
            if !distro.is_empty() {
                cmd.args(["-d", distro]);
            }
        }

        // Sanitized environment
        cmd.env_clear();
        for (k, v) in sanitized_env() {
            cmd.env(k, v);
        }
        cmd.env("TERM", "xterm-256color");

        let _child = pty_pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| SessionError::ConnectionFailed(format!("failed to spawn wsl.exe: {e}")))?;

        drop(pty_pair.slave);

        let reader = pty_pair
            .master
            .try_clone_reader()
            .map_err(|e| SessionError::ConnectionFailed(format!("failed to clone PTY reader: {e}")))?;
        let writer = pty_pair
            .master
            .take_writer()
            .map_err(|e| SessionError::ConnectionFailed(format!("failed to take PTY writer: {e}")))?;

        let master = Arc::new(Mutex::new(pty_pair.master));

        let (tx, mut rx) = mpsc::channel::<WriterCmd>(64);
        self.writer_tx = Some(tx);

        emit_session_status(&app, &session_id, "connected");

        // --- Writer task ---
        let master_for_resize = master.clone();
        let writer_join = tokio::spawn(async move {
            let mut writer = writer;
            while let Some(cmd) = rx.recv().await {
                match cmd {
                    WriterCmd::Bytes(b) => {
                        if writer.write_all(&b).is_err() {
                            break;
                        }
                        let _ = writer.flush();
                    }
                    WriterCmd::Resize(cols, rows) => {
                        let m = master_for_resize.lock().await;
                        let _ = m.resize(PtySize {
                            rows,
                            cols,
                            pixel_width: 0,
                            pixel_height: 0,
                        });
                    }
                    WriterCmd::Close => break,
                }
            }
        });
        self.join.push(writer_join);

        // --- Reader task ---
        let encoding = self.encoding;
        let app_r = app.clone();
        let sid = session_id.clone();
        let log_mgr: super::log_manager::LogManager = app.state::<super::log_manager::LogManager>().inner().clone();

        let reader_join = tokio::spawn(async move {
            log::info!("wsl reader task started for {sid}");
            let mut reader = reader;
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => {
                        log::info!("wsl {sid}: read returned 0 (shell exited)");
                        log_mgr.stop_logging(&sid).await;
                        emit_session_status(&app_r, &sid, "disconnected");
                        break;
                    }
                    Ok(n) => {
                        let (decoded, _enc, _had_errors) = encoding.decode(&buf[..n]);
                        let text = decoded.into_owned();
                        emit_session_data(&app_r, &sid, text.clone());
                        log_mgr.write(&sid, &text).await;
                    }
                    Err(e) => {
                        log::error!("wsl {sid}: read error: {e}");
                        log_mgr.stop_logging(&sid).await;
                        emit_session_error(&app_r, &sid, format!("read error: {e}"));
                        emit_session_status(&app_r, &sid, "disconnected");
                        break;
                    }
                }
            }
            drop(master);
        });
        self.join.push(reader_join);

        Ok(())
    }

    async fn write(&mut self, data: &[u8]) -> Result<(), SessionError> {
        if let Some(ref tx) = self.writer_tx {
            let text = String::from_utf8_lossy(data);
            let (encoded, _enc, _had_errors) = self.encoding.encode(&text);
            tx.send(WriterCmd::Bytes(encoded.into_owned()))
                .await
                .map_err(|_| SessionError::Other("writer channel closed".into()))?;
        }
        Ok(())
    }

    async fn resize(&mut self, cols: u16, rows: u16) -> Result<(), SessionError> {
        if let Some(ref tx) = self.writer_tx {
            let _ = tx.send(WriterCmd::Resize(cols, rows)).await;
        }
        Ok(())
    }

    fn set_encoding(&mut self, encoding: &str) {
        self.encoding = encoding_for(encoding);
    }

    async fn disconnect(&mut self) -> Result<(), SessionError> {
        if let Some(tx) = self.writer_tx.take() {
            let _ = tx.send(WriterCmd::Close).await;
        }
        for jh in self.join.drain(..) {
            if tokio::time::timeout(std::time::Duration::from_millis(200), jh).await.is_err() {
                log::debug!("WSL task did not finish in time, aborting");
            }
        }
        Ok(())
    }
}

impl Drop for WslSession {
    fn drop(&mut self) {
        if self.writer_tx.is_some() {
            log::warn!("WslSession dropped without calling disconnect()");
            for jh in self.join.drain(..) {
                jh.abort();
            }
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
    fn config_validates_distribution_names() {
        // Valid names
        let valid = WslConfig { distribution: Some("Ubuntu".into()), encoding: "utf8".into() };
        assert!(valid.validate().is_ok());

        let valid2 = WslConfig { distribution: Some("Ubuntu-22.04".into()), encoding: "utf8".into() };
        assert!(valid2.validate().is_ok());

        // Empty = default, should be ok
        let empty = WslConfig { distribution: Some(String::new()), encoding: "utf8".into() };
        assert!(empty.validate().is_ok());

        // None = default
        let none = WslConfig { distribution: None, encoding: "utf8".into() };
        assert!(none.validate().is_ok());

        // Invalid: starts with dot
        let invalid = WslConfig { distribution: Some(".bad".into()), encoding: "utf8".into() };
        assert!(invalid.validate().is_err());

        // Invalid: contains space
        let invalid2 = WslConfig { distribution: Some("has space".into()), encoding: "utf8".into() };
        assert!(invalid2.validate().is_err());
    }

    #[test]
    fn config_deserializes() {
        let json = r#"{"distribution":"Ubuntu","encoding":"utf8"}"#;
        let cfg: WslConfig = serde_json::from_str(json).unwrap();
        assert_eq!(cfg.distribution.as_deref(), Some("Ubuntu"));
    }

    #[test]
    fn config_deserializes_minimal() {
        let json = r#"{}"#;
        let cfg: WslConfig = serde_json::from_str(json).unwrap();
        assert!(cfg.distribution.is_none());
        assert_eq!(cfg.encoding, "utf8");
    }

    #[test]
    fn sensitive_env_detection() {
        assert!(is_sensitive_env_var("AWS_SECRET_ACCESS_KEY"));
        assert!(is_sensitive_env_var("GITHUB_TOKEN"));
        assert!(!is_sensitive_env_var("PATH"));
    }
}
