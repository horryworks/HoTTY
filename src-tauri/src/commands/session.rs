use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use serde_json::Value;
use tauri::{AppHandle, State};
use tokio::sync::Mutex;

use crate::services::local::{LocalConfig, LocalSession};
use crate::services::log_manager::LogManager;
use crate::services::serial::{SerialConfig, SerialSession};
use crate::services::session_service::{emit_session_error, SessionError, SessionService};
use crate::services::ssh::{resolve_host_key_prompt, HostKeyDecision, SshConfig, SshSession};
use crate::services::telnet::{TelnetConfig, TelnetSession};
use crate::services::wsl::{WslConfig, WslSession};

/// Protocol identifier for session metadata.
#[derive(Clone, Copy, Debug)]
pub enum ProtocolId {
    Ssh,
    Telnet,
    Serial,
    Wsl,
    Cmd,
    PowerShell,
    GitBash,
}

impl ProtocolId {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ssh => "ssh",
            Self::Telnet => "telnet",
            Self::Serial => "serial",
            Self::Wsl => "wsl",
            Self::Cmd => "cmd",
            Self::PowerShell => "powershell",
            Self::GitBash => "git-bash",
        }
    }
}

/// Metadata stored alongside each session for logging and display purposes.
#[derive(Clone)]
pub struct SessionMeta {
    pub protocol: ProtocolId,
    pub host: String,
}

pub type SessionMap = Arc<Mutex<HashMap<String, (Box<dyn SessionService>, SessionMeta)>>>;

pub struct SessionState {
    pub sessions: SessionMap,
}

impl SessionState {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl Default for SessionState {
    fn default() -> Self {
        Self::new()
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn connect_session(
    app: AppHandle,
    state: State<'_, SessionState>,
    log_manager: State<'_, LogManager>,
    session_id: String,
    protocol: String,
    config: Value,
    logging_enabled: bool,
    logging_path: String,
) -> Result<(), String> {
    log::info!(
        "connect_session called: session_id={session_id} protocol={protocol}"
    );

    let (mut service, meta): (Box<dyn SessionService>, SessionMeta) = match protocol.as_str() {
        "telnet" => {
            let cfg: TelnetConfig = serde_json::from_value(config).map_err(|e| {
                log::error!("invalid telnet config: {e}");
                format!("invalid telnet config: {e}")
            })?;
            log::info!("building TelnetSession: host={} port={}", cfg.host, cfg.port);
            let meta = SessionMeta { protocol: ProtocolId::Telnet, host: cfg.host.clone() };
            (Box::new(TelnetSession::new(cfg)), meta)
        }
        "ssh" => {
            let cfg: SshConfig = serde_json::from_value(config).map_err(|e| {
                log::error!("invalid ssh config: {e}");
                format!("invalid ssh config: {e}")
            })?;
            log::info!("building SshSession: host={} port={}", cfg.host, cfg.port);
            let meta = SessionMeta { protocol: ProtocolId::Ssh, host: cfg.host.clone() };
            (Box::new(SshSession::new(cfg)), meta)
        }
        "serial" => {
            let cfg: SerialConfig = serde_json::from_value(config).map_err(|e| {
                log::error!("invalid serial config: {e}");
                format!("invalid serial config: {e}")
            })?;
            log::info!("building SerialSession: path={}", cfg.path);
            let meta = SessionMeta { protocol: ProtocolId::Serial, host: cfg.path.clone() };
            (Box::new(SerialSession::new(cfg)), meta)
        }
        "wsl" => {
            let cfg: WslConfig = serde_json::from_value(config).map_err(|e| {
                log::error!("invalid wsl config: {e}");
                format!("invalid wsl config: {e}")
            })?;
            let dist = cfg.distribution.clone().unwrap_or_default();
            log::info!(
                "building WslSession: distribution={}",
                if dist.is_empty() { "(default)" } else { &dist }
            );
            let meta = SessionMeta { protocol: ProtocolId::Wsl, host: if dist.is_empty() { "wsl".to_string() } else { dist } };
            (Box::new(WslSession::new(cfg)), meta)
        }
        "cmd" => {
            let cfg: LocalConfig = serde_json::from_value(config).map_err(|e| {
                log::error!("invalid local config: {e}");
                format!("invalid local config: {e}")
            })?;
            log::info!("building LocalSession: type={}", cfg.shell_type);
            let meta = SessionMeta { protocol: ProtocolId::Cmd, host: cfg.shell_type.clone() };
            (Box::new(LocalSession::new(cfg)), meta)
        }
        "powershell" => {
            let cfg: LocalConfig = serde_json::from_value(config).map_err(|e| {
                log::error!("invalid local config: {e}");
                format!("invalid local config: {e}")
            })?;
            log::info!("building LocalSession: type={}", cfg.shell_type);
            let meta = SessionMeta { protocol: ProtocolId::PowerShell, host: cfg.shell_type.clone() };
            (Box::new(LocalSession::new(cfg)), meta)
        }
        "git-bash" => {
            let cfg: LocalConfig = serde_json::from_value(config).map_err(|e| {
                log::error!("invalid local config: {e}");
                format!("invalid local config: {e}")
            })?;
            log::info!("building LocalSession: type={}", cfg.shell_type);
            let meta = SessionMeta { protocol: ProtocolId::GitBash, host: cfg.shell_type.clone() };
            (Box::new(LocalSession::new(cfg)), meta)
        }
        other => return Err(format!("unsupported protocol: {other}")),
    };

    if let Err(e) = service.connect(app.clone(), session_id.clone()).await {
        log::error!("connect failed for {session_id}: {e}");
        emit_session_error(&app, &session_id, e.to_string());
        return Err(e.to_string());
    }

    // Start session logging if enabled
    if logging_enabled && !logging_path.is_empty() {
        if let Err(e) = log_manager
            .start_logging(&session_id, Path::new(&logging_path), meta.protocol.as_str(), &meta.host)
            .await
        {
            log::warn!("failed to start logging for {session_id}: {e}");
        }
    }

    log::info!("connect ok for {session_id}, storing in session map");
    // Single lock acquisition: build + connect runs outside the lock so SSH
    // handshakes don't serialize all session opens. The cost is that two
    // concurrent calls for the same session_id may both connect; the loser
    // disconnects its own service and returns Err. Acceptable since the
    // frontend never reuses a session_id.
    let mut map = state.sessions.lock().await;
    if map.contains_key(&session_id) {
        drop(map);
        let _ = service.disconnect().await;
        return Err(format!("session {session_id} already exists"));
    }
    map.insert(session_id, (service, meta));
    Ok(())
}

#[tauri::command]
pub async fn disconnect_session(
    state: State<'_, SessionState>,
    log_manager: State<'_, LogManager>,
    session_id: String,
) -> Result<(), String> {
    log_manager.stop_logging(&session_id).await;
    let mut map = state.sessions.lock().await;
    match map.remove(&session_id) {
        Some((mut s, _meta)) => s.disconnect().await.map_err(|e| e.to_string()),
        None => Err(SessionError::NotFound.to_string()),
    }
}

#[tauri::command]
pub async fn send_input(
    state: State<'_, SessionState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let mut map = state.sessions.lock().await;
    let (s, _meta) = map
        .get_mut(&session_id)
        .ok_or_else(|| SessionError::NotFound.to_string())?;
    s.write(data.as_bytes()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn term_resize(
    state: State<'_, SessionState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let mut map = state.sessions.lock().await;
    let (s, _meta) = map
        .get_mut(&session_id)
        .ok_or_else(|| SessionError::NotFound.to_string())?;
    s.resize(cols, rows).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_session_logging(
    state: State<'_, SessionState>,
    log_manager: State<'_, LogManager>,
    logging_enabled: bool,
    logging_path: String,
) -> Result<(), String> {
    let map = state.sessions.lock().await;
    for (session_id, (_service, meta)) in map.iter() {
        if logging_enabled && !logging_path.is_empty() {
            if let Err(e) = log_manager
                .start_logging(session_id, Path::new(&logging_path), meta.protocol.as_str(), &meta.host)
                .await
            {
                log::warn!("failed to start logging for {session_id}: {e}");
            }
        } else {
            log_manager.stop_logging(session_id).await;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn ssh_host_key_response(
    session_id: String,
    accept: bool,
    remember: bool,
) -> Result<(), String> {
    let delivered =
        resolve_host_key_prompt(&session_id, HostKeyDecision { accept, remember }).await;
    if !delivered {
        return Err(format!(
            "no pending host-key prompt for session {session_id}"
        ));
    }
    Ok(())
}
