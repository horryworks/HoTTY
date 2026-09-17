use std::collections::HashMap;
use std::future::Future;
use std::path::Path;
use std::sync::{Arc, PoisonError};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, State, Window};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use crate::services::gcloud_iap::{drop_vm_start_prompt, GcloudIapConfig, GcloudIapSession};
use crate::services::local::{LocalConfig, LocalSession};
use crate::services::log_manager::LogManager;
use crate::services::serial::{SerialConfig, SerialSession};
use crate::services::session_service::{
    emit_session_error, PendingSizes, SessionError, SessionOwners, SessionService,
};
use crate::services::ssh::{
    cancel_pending_host_key, resolve_host_key_prompt, HostKeyDecision, SshConfig, SshSession,
};
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
    /// Sessions whose `connect_session` is still running.
    pub connecting: Arc<ConnectingRegistry>,
}

impl SessionState {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            connecting: Arc::new(ConnectingRegistry::default()),
        }
    }
}

/// Error returned by `connect_session` when the connect was abandoned because
/// its tab or window closed first. Nothing is emitted for it.
pub const CONNECT_CANCELLED: &str = "connect cancelled";

/// Sessions that are still connecting, each with the token that abandons it.
///
/// A session only enters `SessionState::sessions` once `connect()` returns, so
/// before this registry a tab or window closed mid-connect had nothing to stop:
/// `disconnect_session` found no session, and the connect went on to succeed
/// into a session with no owner — whose output then went to every window.
#[derive(Default)]
pub struct ConnectingRegistry {
    inner: std::sync::Mutex<HashMap<String, CancellationToken>>,
}

impl ConnectingRegistry {
    /// Mark `session_id` as connecting. Refuses an id that already is, so a
    /// cancel can never reach the wrong one of two attempts.
    pub fn register(self: &Arc<Self>, session_id: &str) -> Result<ConnectingGuard, String> {
        let mut map = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
        if map.contains_key(session_id) {
            return Err(format!("session {session_id} is already connecting"));
        }
        let token = CancellationToken::new();
        map.insert(session_id.to_string(), token.clone());
        Ok(ConnectingGuard {
            registry: Arc::clone(self),
            session_id: session_id.to_string(),
            token,
        })
    }

    /// Abandon the connect in flight for `session_id`. Returns whether there
    /// was one.
    pub fn cancel(&self, session_id: &str) -> bool {
        let map = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
        match map.get(session_id) {
            Some(token) => {
                token.cancel();
                true
            }
            None => false,
        }
    }
}

/// Keeps a session registered as connecting; dropping it unregisters.
pub struct ConnectingGuard {
    registry: Arc<ConnectingRegistry>,
    session_id: String,
    token: CancellationToken,
}

impl ConnectingGuard {
    pub fn token(&self) -> &CancellationToken {
        &self.token
    }
}

impl Drop for ConnectingGuard {
    fn drop(&mut self) {
        let mut map = self
            .registry
            .inner
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        map.remove(&self.session_id);
    }
}

/// Run `fut` unless `token` fires first (`None`). The future is dropped by the
/// time this returns, so the caller can use whatever it borrowed again — which
/// is why the teardown lives outside, not inside, the `select!`.
pub(crate) async fn connect_or_cancel<T>(
    token: &CancellationToken,
    fut: impl Future<Output = T>,
) -> Option<T> {
    tokio::select! {
        biased;
        _ = token.cancelled() => None,
        r = fut => Some(r),
    }
}

/// Tear down a connect that was abandoned. `disconnect()` is safe on a
/// half-built service: it cancels the service's own token (stopping a
/// handshake parked at the host-key prompt) and joins whatever tasks exist.
async fn abandon_connect(
    service: &mut Box<dyn SessionService>,
    session_id: &str,
    owners: &SessionOwners,
) {
    let _ = service.disconnect().await;
    // Protocols that do not track a prompt themselves (Telnet via a jumpbox,
    // gcloud IAP) leave it to us.
    cancel_pending_host_key(session_id).await;
    drop_vm_start_prompt(session_id);
    owners.remove(session_id);
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

    // Registered for the whole attempt, so closing the tab or window can abandon
    // it; unregisters when this function returns, whatever the outcome.
    let connecting = state.connecting.register(&session_id)?;

    // Register the owning window just before connecting (after config parse, so
    // parse/unsupported-protocol early returns above never leak an owner entry):
    // the read loop's first emits and any connect-failure error then target this
    // window, not all windows.
    owners.set(&session_id, window.label());

    let outcome = connect_or_cancel(
        connecting.token(),
        service.connect(app.clone(), session_id.clone()),
    )
    .await;
    // The initial pty size (if the frontend reported one) has now been consumed
    // by the pty allocation inside connect(); drop the rendezvous entry either
    // way so it can't leak or be picked up by a later reconnect of the same id.
    pending.remove(&session_id);
    let Some(connect_result) = outcome else {
        log::info!("connect cancelled for {session_id}: its tab or window closed");
        abandon_connect(&mut service, &session_id, &owners).await;
        return Err(CONNECT_CANCELLED.to_string());
    };
    if let Err(e) = connect_result {
        // Failed on its own, but after the tab closed: nobody to tell.
        if connecting.token().is_cancelled() {
            owners.remove(&session_id);
            return Err(CONNECT_CANCELLED.to_string());
        }
        log::error!("connect failed for {session_id}: {e}");
        // Emit while the owner is still registered, so only its window gets it.
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

    // Build + connect runs outside the map lock so SSH handshakes don't
    // serialize all session opens. `register` above already refuses a second
    // concurrent connect for the same id; this check only catches an id that is
    // still live from an earlier connect.
    let mut map = state.sessions.lock().await;
    // Checked under the map lock: `disconnect_session` cancels BEFORE it takes
    // this lock, so either it sees the session inserted below, or we see its
    // cancel here. There is no gap in which both miss each other.
    if connecting.token().is_cancelled() {
        drop(map);
        log::info!("connect for {session_id} finished after its tab or window closed; dropping it");
        log_manager.stop_logging(&session_id).await;
        abandon_connect(&mut service, &session_id, &owners).await;
        return Err(CONNECT_CANCELLED.to_string());
    }
    log::info!("connect ok for {session_id}, storing in session map");
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

/// Id prefix of an AI worker session — a backend session with no tab and no
/// xterm in its owning window (ADR-016). Must stay in step with
/// `WORKER_SESSION_PREFIX` in `src/utils/paneTypes.ts`.
const WORKER_SESSION_PREFIX: &str = "h-";

/// Whether `id` names an AI worker session.
fn is_worker_session_id(id: &str) -> bool {
    id.starts_with(WORKER_SESSION_PREFIX)
}

/// Upper bound on one `adopt_sessions` call. The per-conversation worker cap is
/// 5 by default (`aiMaxWorkerSessionsPerTab`), so this is generous; it exists
/// only so a malformed call cannot hand us an unbounded list to walk.
const MAX_ADOPT_IDS: usize = 64;
/// `aiMaxWorkerSessionsPerTab` clamps to 10, so the guard must never be able to
/// bite a legitimate handover. Checked at compile time, next to the value it
/// guards, so raising the frontend cap without raising this fails the build.
const _: () = assert!(MAX_ADOPT_IDS > 10);

/// Transfer ownership of AI worker sessions to the calling window, and report
/// which ids were actually taken.
///
/// Called when a conversation moves between windows (AI Chat pop-out / pop-in):
/// without it the workers stay owned by the window the chat left, and closing
/// that window would disconnect terminals the conversation is still using
/// (`cleanup_window_sessions`, ADR-011).
///
/// Two guards keep this from becoming a way to steal terminals:
/// **only `h-` worker ids** are accepted — a user's real tab always belongs to
/// the window that renders it — and **only ids that exist** in the session map,
/// so a caller cannot plant owner entries for sessions that were never opened.
/// Anything else is skipped silently; the returned list is the truth about what
/// moved.
#[tauri::command]
pub async fn adopt_sessions(
    window: Window,
    state: State<'_, SessionState>,
    owners: State<'_, SessionOwners>,
    session_ids: Vec<String>,
) -> Result<Vec<String>, String> {
    if session_ids.len() > MAX_ADOPT_IDS {
        return Err(format!(
            "too many sessions to adopt at once (max {MAX_ADOPT_IDS})"
        ));
    }
    let label = window.label().to_string();
    let map = state.sessions.lock().await;
    let adopted: Vec<String> = session_ids
        .into_iter()
        .filter(|id| is_worker_session_id(id) && map.contains_key(id))
        .collect();
    for id in &adopted {
        owners.set(id, &label);
    }
    drop(map);
    if !adopted.is_empty() {
        log::info!("window {label} adopted {} worker session(s)", adopted.len());
    }
    Ok(adopted)
}

#[tauri::command]
pub async fn disconnect_session(
    state: State<'_, SessionState>,
    log_manager: State<'_, LogManager>,
    owners: State<'_, SessionOwners>,
    pending: State<'_, PendingSizes>,
    session_id: String,
) -> Result<(), String> {
    // First, before the map lock below — see the matching check in
    // `connect_session`. A tab closed while connecting has no session yet.
    let was_connecting = state.connecting.cancel(&session_id);
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
        // `connect_session` tears the half-open session down itself.
        None if was_connecting => Ok(()),
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
        // DIAGNOSTIC (Huawei VRP width-sync): a size that arrives before the
        // session is in the map is a pty-req candidate, not a live resize.
        log::info!(
            "session: term_resize id={session_id} {cols}x{rows} (recorded pre-connect for pty-req)"
        );
        return Ok(());
    };
    // DIAGNOSTIC (Huawei VRP width-sync): forwarded as a live window-change. On a
    // device that ignores window-change this has no effect on its wrap width, so a
    // value here that differs from the pty-size line above is the desync source.
    log::debug!("session: term_resize id={session_id} {cols}x{rows} (forwarded window-change)");
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
    fn connecting_registry_cancel_fires_the_token() {
        let reg = Arc::new(ConnectingRegistry::default());
        let guard = reg.register("s1").unwrap();
        assert!(!guard.token().is_cancelled());
        assert!(reg.cancel("s1"));
        assert!(guard.token().is_cancelled());
        assert!(!reg.cancel("unknown"), "an id that is not connecting");
    }

    #[test]
    fn connecting_registry_refuses_a_second_connect_for_the_same_id() {
        let reg = Arc::new(ConnectingRegistry::default());
        let first = reg.register("s1").unwrap();
        assert!(reg.register("s1").is_err());
        // Other ids are unaffected.
        let _other = reg.register("s2").unwrap();
        drop(first);
        assert!(reg.register("s1").is_ok(), "free again once the first ends");
    }

    #[test]
    fn connecting_guard_drop_unregisters() {
        let reg = Arc::new(ConnectingRegistry::default());
        let guard = reg.register("s1").unwrap();
        drop(guard);
        assert!(!reg.cancel("s1"));
        assert!(reg.inner.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn connect_or_cancel_stops_a_pending_connect() {
        let token = CancellationToken::new();
        let trigger = token.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            trigger.cancel();
        });
        let start = std::time::Instant::now();
        let r = connect_or_cancel(&token, std::future::pending::<()>()).await;
        assert!(r.is_none());
        assert!(start.elapsed() < std::time::Duration::from_secs(1));
    }

    #[tokio::test]
    async fn connect_or_cancel_returns_a_finished_connect() {
        let token = CancellationToken::new();
        assert_eq!(connect_or_cancel(&token, async { 7 }).await, Some(7));
    }

    #[tokio::test]
    async fn connect_or_cancel_does_not_start_an_already_cancelled_connect() {
        let token = CancellationToken::new();
        token.cancel();
        let polled = std::sync::atomic::AtomicBool::new(false);
        let r = connect_or_cancel(&token, async {
            polled.store(true, std::sync::atomic::Ordering::SeqCst);
        })
        .await;
        assert!(r.is_none());
        assert!(!polled.load(std::sync::atomic::Ordering::SeqCst));
    }

    #[tokio::test]
    async fn connect_or_cancel_releases_the_borrow_for_teardown() {
        // Mirrors connect_session: the connect borrows the service mutably, and
        // the cancel path must be able to borrow it again to disconnect.
        struct Svc {
            disconnected: bool,
        }
        impl Svc {
            async fn connect(&mut self) {
                std::future::pending::<()>().await;
            }
            async fn disconnect(&mut self) {
                self.disconnected = true;
            }
        }
        let mut svc = Svc {
            disconnected: false,
        };
        let token = CancellationToken::new();
        token.cancel();
        if connect_or_cancel(&token, svc.connect()).await.is_none() {
            svc.disconnect().await;
        }
        assert!(svc.disconnected);
    }

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
    fn only_worker_ids_are_adoptable() {
        // AI worker sessions carry the `h-` prefix (ADR-016) and are the ONLY
        // thing a conversation may take with it when it changes window.
        assert!(is_worker_session_id("h-abc123-x9f2k1"));
        assert!(is_worker_session_id("h-"));
        // A real tab belongs to the window that renders it.
        assert!(!is_worker_session_id("s-abc123-x9f2k1"));
        assert!(!is_worker_session_id("ai-abc123-x9f2k1"));
        assert!(!is_worker_session_id("0"));
        assert!(!is_worker_session_id(""));
        // Near-misses must not slip through.
        assert!(!is_worker_session_id("H-abc"));
        assert!(!is_worker_session_id(" h-abc"));
        assert!(!is_worker_session_id("xh-abc"));
    }

    #[test]
    fn worker_prefix_matches_the_frontend_constant() {
        // src/utils/paneTypes.ts: export const WORKER_SESSION_PREFIX = 'h-'
        assert_eq!(WORKER_SESSION_PREFIX, "h-");
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
