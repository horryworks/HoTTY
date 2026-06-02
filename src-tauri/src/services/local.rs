use async_trait::async_trait;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Deserialize;
use std::io::{Read as IoRead, Write as IoWrite};
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tokio::sync::{mpsc, Mutex};
use tokio::task::JoinHandle;

use super::path_safety::is_unc_path;
use super::session_service::{
    abort_all, emit_session_data, emit_session_error, emit_session_status, encoding_for,
    join_or_abort, SessionError, SessionService, DISCONNECT_DRAIN_MS,
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalConfig {
    /// Shell type: "cmd", "powershell", or "git-bash"
    pub shell_type: String,

    /// Explicit path to the shell executable (optional, overrides auto-detect)
    #[serde(default)]
    pub shell_path: Option<String>,

    #[serde(default = "default_encoding")]
    pub encoding: String,
}

fn default_encoding() -> String {
    "utf8".to_string()
}

impl LocalConfig {
    pub fn validate(&self) -> Result<(), SessionError> {
        match self.shell_type.as_str() {
            "cmd" | "powershell" | "git-bash" => Ok(()),
            other => Err(SessionError::InvalidConfig(format!(
                "unsupported shell type: {other}"
            ))),
        }
    }

    /// Resolve the shell executable path.
    pub fn resolve_shell_path(&self) -> Result<String, SessionError> {
        if let Some(ref explicit) = self.shell_path {
            if !explicit.is_empty() {
                // Reject UNC paths: spawning from a UNC path triggers SMB auth
                // and an NTLMv2 hash leak before the binary is fetched.
                if is_unc_path(explicit) {
                    return Err(SessionError::InvalidConfig(
                        "shell_path cannot be a UNC/network path".into(),
                    ));
                }
                return Ok(explicit.clone());
            }
        }
        match self.shell_type.as_str() {
            "cmd" => Ok(r"C:\Windows\System32\cmd.exe".to_string()),
            "powershell" => Ok("powershell.exe".to_string()),
            "git-bash" => {
                let candidates = [
                    r"C:\Program Files\Git\bin\bash.exe",
                    r"C:\Program Files (x86)\Git\bin\bash.exe",
                ];
                for c in &candidates {
                    if std::path::Path::new(c).exists() {
                        return Ok(c.to_string());
                    }
                }
                Err(SessionError::InvalidConfig(
                    "Git Bash not found. Install Git for Windows or specify shell_path.".into(),
                ))
            }
            other => Err(SessionError::InvalidConfig(format!(
                "unsupported shell type: {other}"
            ))),
        }
    }
}

// ---------------------------------------------------------------------------
// Environment variable sanitization
// ---------------------------------------------------------------------------

use super::sensitive_env::sanitized_env;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

enum WriterCmd {
    Bytes(Vec<u8>),
    Resize(u16, u16),
    Close,
}

pub struct LocalSession {
    config: LocalConfig,
    encoding: &'static encoding_rs::Encoding,
    writer_tx: Option<mpsc::Sender<WriterCmd>>,
    join: Vec<JoinHandle<()>>,
}

impl LocalSession {
    pub fn new(config: LocalConfig) -> Self {
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
impl SessionService for LocalSession {
    async fn connect(
        &mut self,
        app: AppHandle,
        session_id: String,
    ) -> Result<(), SessionError> {
        self.config.validate()?;
        let shell_path = self.config.resolve_shell_path()?;

        log::info!(
            "local: spawning {shell_path} (type={}, session {session_id})",
            self.config.shell_type
        );

        let pty_system = native_pty_system();
        let pty_pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| SessionError::ConnectionFailed(format!("failed to open PTY: {e}")))?;

        let mut cmd = CommandBuilder::new(&shell_path);

        // Git Bash: pass --login for proper profile sourcing
        if self.config.shell_type == "git-bash" {
            cmd.arg("--login");
        }

        // Set CWD to USERPROFILE
        if let Ok(home) = std::env::var("USERPROFILE") {
            cmd.cwd(home);
        }

        // Sanitized environment
        cmd.env_clear();
        for (k, v) in sanitized_env() {
            cmd.env(k, v);
        }
        cmd.env("TERM", "xterm-256color");

        let child = pty_pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| SessionError::ConnectionFailed(format!("failed to spawn shell: {e}")))?;

        // Drop the slave end — we communicate through the master
        drop(pty_pair.slave);

        let reader = pty_pair
            .master
            .try_clone_reader()
            .map_err(|e| SessionError::ConnectionFailed(format!("failed to clone PTY reader: {e}")))?;
        let writer = pty_pair
            .master
            .take_writer()
            .map_err(|e| SessionError::ConnectionFailed(format!("failed to take PTY writer: {e}")))?;

        // Keep master alive for resize
        let master = Arc::new(Mutex::new(pty_pair.master));

        let (tx, mut rx) = mpsc::channel::<WriterCmd>(64);
        self.writer_tx = Some(tx);

        emit_session_status(&app, &session_id, "connected");

        // --- Child watcher task ---
        // On Windows ConPTY, the master reader may not get EOF when the shell
        // exits unless we actively wait on the child process. Spawn a watcher
        // that blocks on child.wait() and emits disconnected when the shell
        // terminates (e.g. user types `exit`). This is the authoritative
        // source for session-end on Windows; the reader's Ok(0) path remains
        // as a fallback for platforms where EOF propagates correctly.
        let log_mgr: super::log_manager::LogManager =
            app.state::<super::log_manager::LogManager>().inner().clone();
        let app_w = app.clone();
        let sid_w = session_id.clone();
        let log_mgr_w = log_mgr.clone();
        let watcher_join = tokio::spawn(async move {
            let exit_result = tokio::task::spawn_blocking(move || {
                let mut child = child;
                child.wait()
            })
            .await;
            match exit_result {
                Ok(Ok(status)) => {
                    log::info!("local {sid_w}: shell exited: {status:?}")
                }
                Ok(Err(e)) => log::warn!("local {sid_w}: child.wait error: {e}"),
                Err(e) => log::warn!("local {sid_w}: child wait task error: {e}"),
            }
            log_mgr_w.stop_logging(&sid_w).await;
            emit_session_status(&app_w, &sid_w, "disconnected");
        });
        self.join.push(watcher_join);

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

        let reader_join = tokio::spawn(async move {
            log::info!("local reader task started for {sid}");
            let mut reader = reader;
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => {
                        log::info!("local {sid}: read returned 0 (shell exited)");
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
                        log::error!("local {sid}: read error: {e}");
                        log_mgr.stop_logging(&sid).await;
                        emit_session_error(&app_r, &sid, format!("read error: {e}"));
                        emit_session_status(&app_r, &sid, "disconnected");
                        break;
                    }
                }
            }
            // Keep master alive until reader exits
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
        join_or_abort(std::mem::take(&mut self.join), "Local", DISCONNECT_DRAIN_MS).await;
        Ok(())
    }
}

impl Drop for LocalSession {
    fn drop(&mut self) {
        if self.writer_tx.is_some() {
            log::warn!("LocalSession dropped without calling disconnect()");
            abort_all(std::mem::take(&mut self.join));
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
    fn config_validates_shell_types() {
        assert!(LocalConfig { shell_type: "cmd".into(), shell_path: None, encoding: "utf8".into() }.validate().is_ok());
        assert!(LocalConfig { shell_type: "powershell".into(), shell_path: None, encoding: "utf8".into() }.validate().is_ok());
        assert!(LocalConfig { shell_type: "git-bash".into(), shell_path: None, encoding: "utf8".into() }.validate().is_ok());
        assert!(LocalConfig { shell_type: "zsh".into(), shell_path: None, encoding: "utf8".into() }.validate().is_err());
    }

    #[test]
    fn resolve_cmd_path() {
        let cfg = LocalConfig { shell_type: "cmd".into(), shell_path: None, encoding: "utf8".into() };
        let path = cfg.resolve_shell_path().unwrap();
        assert!(path.contains("cmd.exe"));
    }

    #[test]
    fn resolve_explicit_path() {
        let cfg = LocalConfig {
            shell_type: "cmd".into(),
            shell_path: Some("/custom/shell".into()),
            encoding: "utf8".into(),
        };
        assert_eq!(cfg.resolve_shell_path().unwrap(), "/custom/shell");
    }

    #[test]
    fn resolve_rejects_unc_shell_path() {
        let cfg = LocalConfig {
            shell_type: "cmd".into(),
            shell_path: Some(r"\\attacker\share\evil.exe".into()),
            encoding: "utf8".into(),
        };
        assert!(cfg.resolve_shell_path().is_err());

        let cfg = LocalConfig {
            shell_type: "cmd".into(),
            shell_path: Some("//attacker/share/evil.exe".into()),
            encoding: "utf8".into(),
        };
        assert!(cfg.resolve_shell_path().is_err());
    }

    #[test]
    fn config_deserializes() {
        let json = r#"{"shellType":"cmd","encoding":"utf8"}"#;
        let cfg: LocalConfig = serde_json::from_str(json).unwrap();
        assert_eq!(cfg.shell_type, "cmd");
        assert!(cfg.shell_path.is_none());
    }
}
