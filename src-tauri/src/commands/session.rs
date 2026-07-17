use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, State, Window};
use tokio::sync::Mutex;

use crate::services::gcloud_iap::{GcloudIapConfig, GcloudIapSession};
use crate::services::local::{LocalConfig, LocalSession};
use crate::services::log_manager::LogManager;
use crate::services::serial::{SerialConfig, SerialSession};
use crate::services::session_service::{
    emit_session_error, PendingSizes, SessionError, SessionOwners, SessionService,
};
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
    GcloudIap,
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
            Self::GcloudIap => "gcloud-iap",
        }
    }
}

/// Metadata stored alongside each session for logging and display purposes.
#[derive(Clone)]
pub struct SessionMeta {
    pub protocol: ProtocolId,
    pub host: String,
}

/// One live session, wrapped in its own `Arc<Mutex<..>>`. Commands clone this
/// handle out of the map, release the map lock, and only THEN `.await` on the
/// session's `write`/`resize`/`disconnect`. Holding the map lock across those
/// awaits would let a single wedged connection (a peer that stopped reading, so
/// `write()` blocks on a full writer channel) stall *every* session command
/// process-wide — the app-freeze bug this indirection prevents.
pub type SharedSession = Arc<Mutex<Box<dyn SessionService>>>;
pub type SessionMap = Arc<Mutex<HashMap<String, (SharedSession, SessionMeta)>>>;

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
    window: Window,
    state: State<'_, SessionState>,
    log_manager: State<'_, LogManager>,
    owners: State<'_, SessionOwners>,
    pending: State<'_, PendingSizes>,
    session_id: String,
    protocol: String,
    config: Value,
    logging_enabled: bool,
    logging_path: String,
) -> Result<(), String> {
    log::info!("connect_session called: session_id={session_id} protocol={protocol}");

    let (mut service, meta): (Box<dyn SessionService>, SessionMeta) = match protocol.as_str() {
        "telnet" => {
            let cfg: TelnetConfig = serde_json::from_value(config).map_err(|e| {
                log::error!("invalid telnet config: {e}");
                format!("invalid telnet config: {e}")
            })?;
            log::info!(
                "building TelnetSession: host={} port={}",
                cfg.host,
                cfg.port
            );
            let meta = SessionMeta {
                protocol: ProtocolId::Telnet,
                host: cfg.host.clone(),
            };
            (Box::new(TelnetSession::new(cfg)), meta)
        }
        "ssh" => {
            let cfg: SshConfig = serde_json::from_value(config).map_err(|e| {
                log::error!("invalid ssh config: {e}");
                format!("invalid ssh config: {e}")
            })?;
            log::info!("building SshSession: host={} port={}", cfg.host, cfg.port);
            let meta = SessionMeta {
                protocol: ProtocolId::Ssh,
                host: cfg.host.clone(),
            };
            (Box::new(SshSession::new(cfg)), meta)
        }
        "serial" => {
            let cfg: SerialConfig = serde_json::from_value(config).map_err(|e| {
                log::error!("invalid serial config: {e}");
                format!("invalid serial config: {e}")
            })?;
            log::info!("building SerialSession: path={}", cfg.path);
            let meta = SessionMeta {
                protocol: ProtocolId::Serial,
                host: cfg.path.clone(),
            };
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
            let meta = SessionMeta {
                protocol: ProtocolId::Wsl,
                host: if dist.is_empty() {
                    "wsl".to_string()
                } else {
                    dist
                },
            };
            (Box::new(WslSession::new(cfg)), meta)
        }
        "cmd" => {
            let cfg: LocalConfig = serde_json::from_value(config).map_err(|e| {
                log::error!("invalid local config: {e}");
                format!("invalid local config: {e}")
            })?;
            log::info!("building LocalSession: type={}", cfg.shell_type);
            let meta = SessionMeta {
                protocol: ProtocolId::Cmd,
                host: cfg.shell_type.clone(),
            };
            (Box::new(LocalSession::new(cfg)), meta)
        }
        "powershell" => {
            let cfg: LocalConfig = serde_json::from_value(config).map_err(|e| {
                log::error!("invalid local config: {e}");
                format!("invalid local config: {e}")
            })?;
            log::info!("building LocalSession: type={}", cfg.shell_type);
            let meta = SessionMeta {
                protocol: ProtocolId::PowerShell,
                host: cfg.shell_type.clone(),
            };
            (Box::new(LocalSession::new(cfg)), meta)
        }
        "git-bash" => {
            let cfg: LocalConfig = serde_json::from_value(config).map_err(|e| {
                log::error!("invalid local config: {e}");
                format!("invalid local config: {e}")
            })?;
            log::info!("building LocalSession: type={}", cfg.shell_type);
            let meta = SessionMeta {
                protocol: ProtocolId::GitBash,
                host: cfg.shell_type.clone(),
            };
            (Box::new(LocalSession::new(cfg)), meta)
        }
        "gcloud-iap" => {
            let cfg: GcloudIapConfig = serde_json::from_value(config).map_err(|e| {
                log::error!("invalid gcloud-iap config: {e}");
                format!("invalid gcloud-iap config: {e}")
            })?;
            log::info!(
                "building GcloudIapSession: project={} zone={} instance={}",
                cfg.project,
                cfg.zone,
                cfg.instance
            );
            // '/' is illegal in Windows filenames; '-' keeps log filenames safe.
            let host_label = format!("{}-{}", cfg.project, cfg.instance);
            let meta = SessionMeta {
                protocol: ProtocolId::GcloudIap,
                host: host_label,
            };
            (Box::new(GcloudIapSession::new(cfg)), meta)
        }
        other => return Err(format!("unsupported protocol: {other}")),
    };

    // Register the owning window just before connecting (after config parse, so
    // parse/unsupported-protocol early returns above never leak an owner entry):
    // the read loop's first emits and any connect-failure error then target this
    // window, not all windows.
    owners.set(&session_id, window.label());

    let connect_result = service.connect(app.clone(), session_id.clone()).await;
    // The initial pty size (if the frontend reported one) has now been consumed
    // by the pty allocation inside connect(); drop the rendezvous entry either
    // way so it can't leak or be picked up by a later reconnect of the same id.
    pending.remove(&session_id);
    if let Err(e) = connect_result {
        log::error!("connect failed for {session_id}: {e}");
        emit_session_error(&app, &session_id, e.to_string());
        owners.remove(&session_id);
        return Err(e.to_string());
    }

    // Start session logging if enabled
    if logging_enabled && !logging_path.is_empty() {
        if let Err(e) = log_manager
            .start_logging(
                &session_id,
                Path::new(&logging_path),
                meta.protocol.as_str(),
                &meta.host,
            )
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
    map.insert(session_id, (Arc::new(Mutex::new(service)), meta));
    Ok(())
}

/// One live session as seen across ALL windows in the process (the enabler for
/// cross-window AI: a chat in one window can discover and link to a terminal
/// owned by another window). Display names / binding keys live in the renderer,
/// so the frontend enriches this with its per-window session registry.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub session_id: String,
    pub host: String,
    pub protocol: String,
    pub owner_label: Option<String>,
}

/// List every live session across all windows (id, host, protocol, owning
/// window). `send_input` and the watch buffer are keyed by global session id, so
/// linking an AI chat to any returned session works regardless of window.
#[tauri::command]
pub async fn list_all_sessions(
    state: State<'_, SessionState>,
    owners: State<'_, SessionOwners>,
) -> Result<Vec<SessionInfo>, String> {
    let map = state.sessions.lock().await;
    let infos = map
        .iter()
        .map(|(id, (_service, meta))| SessionInfo {
            session_id: id.clone(),
            host: meta.host.clone(),
            protocol: meta.protocol.as_str().to_string(),
            owner_label: owners.get(id),
        })
        .collect();
    Ok(infos)
}

#[tauri::command]
pub async fn disconnect_session(
    state: State<'_, SessionState>,
    log_manager: State<'_, LogManager>,
    owners: State<'_, SessionOwners>,
    pending: State<'_, PendingSizes>,
    session_id: String,
) -> Result<(), String> {
    log_manager.stop_logging(&session_id).await;
    owners.remove(&session_id);
    pending.remove(&session_id);
    // Remove from the map under the lock, then release the map lock BEFORE
    // awaiting disconnect() — a slow teardown drain must not block every other
    // session command for its duration.
    let shared = {
        let mut map = state.sessions.lock().await;
        map.remove(&session_id)
    };
    match shared {
        Some((s, _meta)) => {
            let mut s = s.lock().await;
            s.disconnect().await.map_err(|e| e.to_string())
        }
        None => Err(SessionError::NotFound.to_string()),
    }
}

#[tauri::command]
pub async fn send_input(
    state: State<'_, SessionState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    // Clone the per-session handle out under the map lock, then drop the map lock
    // before awaiting write(): if this session's peer stopped reading, write()
    // can block on a full writer channel — holding the map lock across it would
    // freeze send_input/resize/disconnect for ALL sessions, not just this one.
    let shared = {
        let map = state.sessions.lock().await;
        map.get(&session_id).map(|(s, _)| s.clone())
    };
    let shared = shared.ok_or_else(|| SessionError::NotFound.to_string())?;
    let mut s = shared.lock().await;
    s.write(data.as_bytes()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn term_resize(
    state: State<'_, SessionState>,
    pending: State<'_, PendingSizes>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    // Always record the latest size first: while a session is still connecting
    // it isn't in the map yet, and the SSH connect path reads this to size the
    // INITIAL pty-req (devices like Huawei VRP honor only that, ignoring later
    // window-change). The frontend only reports once it has a real measurement,
    // so this is never the xterm placeholder width.
    pending.set(&session_id, cols, rows);
    let shared = {
        let map = state.sessions.lock().await;
        map.get(&session_id).map(|(s, _)| s.clone())
    };
    // Not connected yet: the size is captured above for the initial pty-req, so
    // a missing session here is expected mid-connect, not an error to surface.
    let Some(shared) = shared else {
        return Ok(());
    };
    let mut s = shared.lock().await;
    s.resize(cols, rows).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_session_logging(
    state: State<'_, SessionState>,
    log_manager: State<'_, LogManager>,
    logging_enabled: bool,
    logging_path: String,
) -> Result<(), String> {
    // Snapshot the (id, protocol, host) triples under the lock, then release it
    // before the per-session log_manager awaits — don't hold the session map
    // lock across file I/O.
    let snapshot: Vec<(String, &'static str, String)> = {
        let map = state.sessions.lock().await;
        map.iter()
            .map(|(id, (_s, meta))| (id.clone(), meta.protocol.as_str(), meta.host.clone()))
            .collect()
    };
    for (session_id, protocol, host) in snapshot {
        if logging_enabled && !logging_path.is_empty() {
            if let Err(e) = log_manager
                .start_logging(&session_id, Path::new(&logging_path), protocol, &host)
                .await
            {
                log::warn!("failed to start logging for {session_id}: {e}");
            }
        } else {
            log_manager.stop_logging(&session_id).await;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protocol_id_as_str_covers_all_variants() {
        assert_eq!(ProtocolId::Ssh.as_str(), "ssh");
        assert_eq!(ProtocolId::Telnet.as_str(), "telnet");
        assert_eq!(ProtocolId::Serial.as_str(), "serial");
        assert_eq!(ProtocolId::Wsl.as_str(), "wsl");
        assert_eq!(ProtocolId::Cmd.as_str(), "cmd");
        assert_eq!(ProtocolId::PowerShell.as_str(), "powershell");
        assert_eq!(ProtocolId::GitBash.as_str(), "git-bash");
        assert_eq!(ProtocolId::GcloudIap.as_str(), "gcloud-iap");
    }

    #[test]
    fn session_info_serializes_camel_case() {
        let info = SessionInfo {
            session_id: "s1".to_string(),
            host: "example.com".to_string(),
            protocol: "ssh".to_string(),
            owner_label: Some("main".to_string()),
        };
        let json: serde_json::Value = serde_json::to_value(&info).unwrap();
        assert_eq!(json["sessionId"], "s1");
        assert_eq!(json["host"], "example.com");
        assert_eq!(json["protocol"], "ssh");
        assert_eq!(json["ownerLabel"], "main");
        // The snake_case field names must NOT leak onto the wire.
        assert!(json.get("session_id").is_none());
        assert!(json.get("owner_label").is_none());
    }

    #[test]
    fn session_info_owner_label_none_serializes_null() {
        let info = SessionInfo {
            session_id: "s2".to_string(),
            host: "h".to_string(),
            protocol: "telnet".to_string(),
            owner_label: None,
        };
        let json: serde_json::Value = serde_json::to_value(&info).unwrap();
        assert!(json["ownerLabel"].is_null());
    }

    #[test]
    fn session_state_default_is_empty() {
        let state = SessionState::default();
        let map = state.sessions.blocking_lock();
        assert!(map.is_empty());
    }
}
