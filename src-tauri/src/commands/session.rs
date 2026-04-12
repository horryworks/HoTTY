use std::collections::HashMap;
use std::sync::Arc;

use serde_json::Value;
use tauri::{AppHandle, State};
use tokio::sync::Mutex;

use crate::services::session_service::{emit_session_error, SessionError, SessionService};
use crate::services::ssh::{resolve_host_key_prompt, HostKeyDecision, SshConfig, SshSession};
use crate::services::telnet::{TelnetConfig, TelnetSession};

pub type SessionMap = Arc<Mutex<HashMap<String, Box<dyn SessionService>>>>;

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
pub async fn connect_session(
    app: AppHandle,
    state: State<'_, SessionState>,
    session_id: String,
    protocol: String,
    config: Value,
) -> Result<(), String> {
    log::info!(
        "connect_session called: session_id={session_id} protocol={protocol}"
    );

    // Prevent duplicate session ids
    {
        let map = state.sessions.lock().await;
        if map.contains_key(&session_id) {
            return Err(format!("session {session_id} already exists"));
        }
    }

    let mut service: Box<dyn SessionService> = match protocol.as_str() {
        "telnet" => {
            let cfg: TelnetConfig = serde_json::from_value(config).map_err(|e| {
                log::error!("invalid telnet config: {e}");
                format!("invalid telnet config: {e}")
            })?;
            log::info!("building TelnetSession: host={} port={}", cfg.host, cfg.port);
            Box::new(TelnetSession::new(cfg))
        }
        "ssh" => {
            let cfg: SshConfig = serde_json::from_value(config).map_err(|e| {
                log::error!("invalid ssh config: {e}");
                format!("invalid ssh config: {e}")
            })?;
            log::info!("building SshSession: host={} port={}", cfg.host, cfg.port);
            Box::new(SshSession::new(cfg))
        }
        other => return Err(format!("unsupported protocol: {other}")),
    };

    if let Err(e) = service.connect(app.clone(), session_id.clone()).await {
        log::error!("connect failed for {session_id}: {e}");
        emit_session_error(&app, &session_id, e.to_string());
        return Err(e.to_string());
    }

    log::info!("connect ok for {session_id}, storing in session map");
    let mut map = state.sessions.lock().await;
    map.insert(session_id, service);
    Ok(())
}

#[tauri::command]
pub async fn disconnect_session(
    state: State<'_, SessionState>,
    session_id: String,
) -> Result<(), String> {
    let mut map = state.sessions.lock().await;
    match map.remove(&session_id) {
        Some(mut s) => s.disconnect().await.map_err(|e| e.to_string()),
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
    let s = map
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
    let s = map
        .get_mut(&session_id)
        .ok_or_else(|| SessionError::NotFound.to_string())?;
    s.resize(cols, rows).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_session_encoding(
    state: State<'_, SessionState>,
    session_id: String,
    encoding: String,
) -> Result<(), String> {
    let mut map = state.sessions.lock().await;
    let s = map
        .get_mut(&session_id)
        .ok_or_else(|| SessionError::NotFound.to_string())?;
    s.set_encoding(&encoding);
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
