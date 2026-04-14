use async_trait::async_trait;
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use russh::client::{self, Handle, Handler};
use russh::keys::ssh_key;
use russh::keys::{load_secret_key, HashAlg, PrivateKey, PrivateKeyWithHashAlg};
use russh::{ChannelMsg, Disconnect};
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio::task::JoinHandle;

use super::jumpbox::{establish_tunnel, JumpboxConfig, JumpboxHandler};
use super::known_hosts::{
    append_known_host, check_known_host, default_known_hosts_path, remove_known_host, HostKeyCheck,
};
use super::session_service::{
    emit_session_data, emit_session_status, encoding_for, SessionError, SessionService,
};

// --- Config ------------------------------------------------------------

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SshConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub private_key_path: Option<String>,
    #[serde(default)]
    pub private_key_passphrase: Option<String>,
    #[serde(default = "default_encoding")]
    pub encoding: String,
    #[serde(default)]
    pub keepalive_interval_secs: u32,
    #[serde(default)]
    pub jumpbox: Option<JumpboxConfig>,
}

fn default_encoding() -> String {
    "utf8".to_string()
}

const MAX_CREDENTIAL_LEN: usize = 1024;
const MAX_HOST_LEN: usize = 253;
const MAX_USERNAME_LEN: usize = 256;

impl SshConfig {
    fn validate(&self) -> Result<(), SessionError> {
        if self.host.trim().is_empty() {
            return Err(SessionError::InvalidConfig("host is empty".into()));
        }
        if self.host.len() > MAX_HOST_LEN {
            return Err(SessionError::InvalidConfig("host too long".into()));
        }
        if self.port == 0 {
            return Err(SessionError::InvalidConfig("port must be > 0".into()));
        }
        if self.username.trim().is_empty() {
            return Err(SessionError::InvalidConfig("username is empty".into()));
        }
        if self.username.len() > MAX_USERNAME_LEN {
            return Err(SessionError::InvalidConfig("username too long".into()));
        }
        if let Some(pw) = &self.password {
            if pw.len() > MAX_CREDENTIAL_LEN {
                return Err(SessionError::InvalidConfig("password too long".into()));
            }
        }
        if let Some(pp) = &self.private_key_passphrase {
            if pp.len() > MAX_CREDENTIAL_LEN {
                return Err(SessionError::InvalidConfig("passphrase too long".into()));
            }
        }
        Ok(())
    }
}

// --- Host-key prompt pending map ---------------------------------------

#[derive(Debug, Clone, Copy)]
pub struct HostKeyDecision {
    pub accept: bool,
    pub remember: bool,
}

type PendingMap = Mutex<HashMap<String, oneshot::Sender<HostKeyDecision>>>;

fn pending_map() -> &'static PendingMap {
    static MAP: OnceLock<PendingMap> = OnceLock::new();
    MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

pub async fn resolve_host_key_prompt(session_id: &str, decision: HostKeyDecision) -> bool {
    let mut map = pending_map().lock().await;
    if let Some(tx) = map.remove(session_id) {
        let _ = tx.send(decision);
        true
    } else {
        false
    }
}

/// Cancel any outstanding host-key prompt for this session id (including
/// jumpbox-suffixed variants). Sends a reject decision so the waiting SSH
/// handler unblocks cleanly and no sender entry is leaked.
pub async fn cancel_pending_host_key(session_id: &str) {
    let reject = HostKeyDecision {
        accept: false,
        remember: false,
    };
    let mut map = pending_map().lock().await;
    let keys: Vec<String> = map
        .keys()
        .filter(|k| k.as_str() == session_id || k.starts_with(&format!("{session_id}::")))
        .cloned()
        .collect();
    for k in keys {
        if let Some(tx) = map.remove(&k) {
            let _ = tx.send(reject);
        }
    }
}

/// Register an external pending host-key prompt. Used by the jumpbox handler
/// so that a `ssh_host_key_response` call with a jumpbox-suffixed session id
/// can be routed through this module's shared pending map.
pub async fn register_external_prompt(
    session_id: String,
    tx: oneshot::Sender<HostKeyDecision>,
) {
    pending_map().lock().await.insert(session_id, tx);
}

// --- Event payload for host-key prompt ---------------------------------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SshHostKeyPromptPayload {
    session_id: String,
    host: String,
    port: u16,
    key_type: String,
    fingerprint: String,
    kind: String,
}

// --- Handler ------------------------------------------------------------

struct SshHandler {
    app: AppHandle,
    session_id: String,
    host: String,
    port: u16,
    known_hosts_path: PathBuf,
}

impl Handler for SshHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        let key_type = server_public_key.algorithm().as_str().to_string();
        let key_bytes = server_public_key.to_bytes().map_err(|e| {
            log::error!("ssh: failed to serialize server public key: {e}");
            russh::Error::Disconnect
        })?;
        let key_base64 = base64::engine::general_purpose::STANDARD.encode(&key_bytes);
        let fingerprint = server_public_key
            .fingerprint(ssh_key::HashAlg::Sha256)
            .to_string();

        let check = check_known_host(
            &self.known_hosts_path,
            &self.host,
            self.port,
            &key_type,
            &key_base64,
        )
        .unwrap_or(HostKeyCheck::New);

        let kind = match check {
            HostKeyCheck::Match => return Ok(true),
            HostKeyCheck::New => "new",
            HostKeyCheck::Mismatch { .. } => "changed",
        };

        let (tx, rx) = oneshot::channel::<HostKeyDecision>();
        {
            let mut map = pending_map().lock().await;
            map.insert(self.session_id.clone(), tx);
        }

        let payload = SshHostKeyPromptPayload {
            session_id: self.session_id.clone(),
            host: self.host.clone(),
            port: self.port,
            key_type: key_type.clone(),
            fingerprint,
            kind: kind.to_string(),
        };
        let _ = self.app.emit("ssh-host-key-prompt", payload);

        let decision = rx.await.map_err(|_| russh::Error::Disconnect)?;
        if !decision.accept {
            return Ok(false);
        }
        if decision.remember {
            if matches!(check, HostKeyCheck::Mismatch { .. }) {
                let _ = remove_known_host(&self.known_hosts_path, &self.host, self.port, &key_type);
            }
            let _ = append_known_host(
                &self.known_hosts_path,
                &self.host,
                self.port,
                &key_type,
                &key_base64,
            );
        }
        Ok(true)
    }
}

// --- Session wrapper ---------------------------------------------------

pub struct SshSession {
    config: SshConfig,
    encoding: &'static encoding_rs::Encoding,
    handle: Option<Arc<Handle<SshHandler>>>,
    /// Kept alive for the lifetime of the target session when tunneling via a
    /// jumpbox; dropping this closes the underlying SSH bastion connection.
    jumpbox_handle: Option<Arc<Handle<JumpboxHandler>>>,
    writer_tx: Option<mpsc::Sender<WriterCmd>>,
    join: Vec<JoinHandle<()>>,
    shutdown: Option<Arc<tokio::sync::Notify>>,
    session_id: Option<String>,
}

enum WriterCmd {
    Bytes(Vec<u8>),
    Resize(u16, u16),
    Close,
}

impl SshSession {
    pub fn new(config: SshConfig) -> Self {
        let encoding = encoding_for(&config.encoding);
        Self {
            config,
            encoding,
            handle: None,
            jumpbox_handle: None,
            writer_tx: None,
            join: Vec::new(),
            shutdown: None,
            session_id: None,
        }
    }
}

fn resolve_known_hosts_path(app: &AppHandle) -> PathBuf {
    let base = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| std::env::temp_dir());
    let _ = std::fs::create_dir_all(&base);
    default_known_hosts_path(&base)
}

async fn try_authenticate(
    handle: &mut Handle<SshHandler>,
    cfg: &SshConfig,
) -> Result<(), SessionError> {
    // 1. Public key (if path provided)
    if let Some(key_path) = &cfg.private_key_path {
        let pk: PrivateKey = load_secret_key(key_path, cfg.private_key_passphrase.as_deref())
            .map_err(|e| SessionError::AuthFailed(format!("load key failed: {e}")))?;
        let key_with_hash = PrivateKeyWithHashAlg::new(Arc::new(pk), Some(HashAlg::Sha256));
        let res = handle
            .authenticate_publickey(&cfg.username, key_with_hash)
            .await
            .map_err(|e| SessionError::AuthFailed(format!("publickey: {e}")))?;
        if matches!(res, russh::client::AuthResult::Success) {
            return Ok(());
        }
    }
    // 2. Password
    if let Some(pw) = &cfg.password {
        let res = handle
            .authenticate_password(&cfg.username, pw.clone())
            .await
            .map_err(|e| SessionError::AuthFailed(format!("password: {e}")))?;
        if matches!(res, russh::client::AuthResult::Success) {
            return Ok(());
        }

        // 3. Keyboard-interactive — single-round using password as response.
        let mut kb = handle
            .authenticate_keyboard_interactive_start(&cfg.username, None)
            .await
            .map_err(|e| SessionError::AuthFailed(format!("kbd-interactive start: {e}")))?;
        loop {
            match kb {
                russh::client::KeyboardInteractiveAuthResponse::Success => return Ok(()),
                russh::client::KeyboardInteractiveAuthResponse::Failure { .. } => break,
                russh::client::KeyboardInteractiveAuthResponse::InfoRequest { prompts, .. } => {
                    let responses: Vec<String> =
                        prompts.iter().map(|_| pw.clone()).collect();
                    kb = handle
                        .authenticate_keyboard_interactive_respond(responses)
                        .await
                        .map_err(|e| {
                            SessionError::AuthFailed(format!("kbd-interactive resp: {e}"))
                        })?;
                }
            }
        }
    }
    Err(SessionError::AuthFailed(
        "all authentication methods failed".into(),
    ))
}

use tauri::Manager;

#[async_trait]
impl SessionService for SshSession {
    async fn connect(
        &mut self,
        app: AppHandle,
        session_id: String,
    ) -> Result<(), SessionError> {
        self.config.validate()?;

        let known_hosts_path = resolve_known_hosts_path(&app);

        let config = Arc::new(client::Config {
            inactivity_timeout: Some(Duration::from_secs(3600)),
            ..client::Config::default()
        });

        let handler = SshHandler {
            app: app.clone(),
            session_id: session_id.clone(),
            host: self.config.host.clone(),
            port: self.config.port,
            known_hosts_path,
        };

        let mut handle = if let Some(jumpbox_cfg) = self.config.jumpbox.take() {
            log::info!(
                "ssh: tunneling through jumpbox {}:{} to {}:{}",
                jumpbox_cfg.host, jumpbox_cfg.port, self.config.host, self.config.port
            );
            let tunnel = establish_tunnel(
                app.clone(),
                &session_id,
                jumpbox_cfg,
                &self.config.host,
                self.config.port,
            )
            .await?;
            let (jumpbox_handle, stream) = tunnel.into_stream();
            self.jumpbox_handle = Some(jumpbox_handle);
            client::connect_stream(config, stream, handler)
                .await
                .map_err(|e| SessionError::ConnectionFailed(format!("ssh-over-jumpbox: {e}")))?
        } else {
            let addr = (self.config.host.as_str(), self.config.port);
            client::connect(config, addr, handler)
                .await
                .map_err(|e| SessionError::ConnectionFailed(format!("{e}")))?
        };

        try_authenticate(&mut handle, &self.config).await?;

        // Zeroize credentials after successful authentication
        use zeroize::Zeroize;
        if let Some(ref mut pw) = self.config.password {
            pw.zeroize();
        }
        self.config.password = None;
        if let Some(ref mut pp) = self.config.private_key_passphrase {
            pp.zeroize();
        }
        self.config.private_key_passphrase = None;

        let channel = handle
            .channel_open_session()
            .await
            .map_err(|e| SessionError::Protocol(format!("channel: {e}")))?;

        channel
            .request_pty(true, "xterm-256color", 80, 24, 0, 0, &[])
            .await
            .map_err(|e| SessionError::Protocol(format!("request_pty: {e}")))?;
        channel
            .request_shell(true)
            .await
            .map_err(|e| SessionError::Protocol(format!("request_shell: {e}")))?;

        emit_session_status(&app, &session_id, "connected");

        let (read_half, write_half) = channel.split();
        let read_half = Arc::new(Mutex::new(read_half));
        let write_half = Arc::new(write_half);

        let (tx, mut rx) = mpsc::channel::<WriterCmd>(64);
        self.writer_tx = Some(tx.clone());

        // Writer task
        let writer_half = write_half.clone();
        let writer_join = tokio::spawn(async move {
            while let Some(cmd) = rx.recv().await {
                match cmd {
                    WriterCmd::Bytes(b) => {
                        if writer_half.data(&b[..]).await.is_err() {
                            break;
                        }
                    }
                    WriterCmd::Resize(cols, rows) => {
                        let _ = writer_half
                            .window_change(cols as u32, rows as u32, 0, 0)
                            .await;
                    }
                    WriterCmd::Close => {
                        let _ = writer_half.close().await;
                        break;
                    }
                }
            }
        });
        self.join.push(writer_join);

        // Reader task
        let encoding = self.encoding;
        let app_r = app.clone();
        let sid_r = session_id.clone();
        let read_half_r = read_half.clone();
        let log_mgr: super::log_manager::LogManager = app.state::<super::log_manager::LogManager>().inner().clone();
        let reader_join = tokio::spawn(async move {
            loop {
                let mut rd = read_half_r.lock().await;
                match rd.wait().await {
                    Some(ChannelMsg::Data { data }) => {
                        let (decoded, _, _) = encoding.decode(&data);
                        let text = decoded.into_owned();
                        emit_session_data(&app_r, &sid_r, text.clone());
                        log_mgr.write(&sid_r, &text).await;
                    }
                    Some(ChannelMsg::ExtendedData { data, .. }) => {
                        let (decoded, _, _) = encoding.decode(&data);
                        let text = decoded.into_owned();
                        emit_session_data(&app_r, &sid_r, text.clone());
                        log_mgr.write(&sid_r, &text).await;
                    }
                    Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) => {
                        log_mgr.stop_logging(&sid_r).await;
                        emit_session_status(&app_r, &sid_r, "disconnected");
                        break;
                    }
                    Some(_) => {}
                    None => {
                        log_mgr.stop_logging(&sid_r).await;
                        emit_session_status(&app_r, &sid_r, "disconnected");
                        break;
                    }
                }
            }
        });
        self.join.push(reader_join);

        let shutdown = Arc::new(tokio::sync::Notify::new());
        self.shutdown = Some(shutdown.clone());
        self.session_id = Some(session_id.clone());

        // Keepalive task: periodic zero-length window change as a no-op ping.
        // russh has no public send_keepalive so we emit a 0-size window change.
        if self.config.keepalive_interval_secs > 0 {
            let interval = Duration::from_secs(self.config.keepalive_interval_secs as u64);
            let ka_writer = write_half.clone();
            let ka_shutdown = shutdown.clone();
            let ka_join = tokio::spawn(async move {
                let mut ticker = tokio::time::interval(interval);
                ticker.tick().await;
                loop {
                    tokio::select! {
                        _ = ticker.tick() => {
                            if ka_writer.writable_packet_size().await == 0 {
                                continue;
                            }
                        }
                        _ = ka_shutdown.notified() => break,
                    }
                }
            });
            self.join.push(ka_join);
        }

        self.handle = Some(Arc::new(handle));
        Ok(())
    }

    async fn write(&mut self, data: &[u8]) -> Result<(), SessionError> {
        let tx = self
            .writer_tx
            .as_ref()
            .ok_or_else(|| SessionError::Other("session not connected".into()))?;
        let as_str = String::from_utf8_lossy(data);
        let (encoded, _, _) = self.encoding.encode(&as_str);
        tx.send(WriterCmd::Bytes(encoded.into_owned()))
            .await
            .map_err(|e| SessionError::Other(format!("writer channel closed: {e}")))
    }

    async fn resize(&mut self, cols: u16, rows: u16) -> Result<(), SessionError> {
        if let Some(tx) = &self.writer_tx {
            let _ = tx.send(WriterCmd::Resize(cols, rows)).await;
        }
        Ok(())
    }

    fn set_encoding(&mut self, encoding: &str) {
        self.encoding = encoding_for(encoding);
        self.config.encoding = encoding.to_string();
    }

    async fn disconnect(&mut self) -> Result<(), SessionError> {
        if let Some(sid) = self.session_id.take() {
            cancel_pending_host_key(&sid).await;
        }
        if let Some(sd) = self.shutdown.take() {
            sd.notify_waiters();
        }
        if let Some(tx) = self.writer_tx.take() {
            let _ = tx.send(WriterCmd::Close).await;
        }
        if let Some(h) = self.handle.take() {
            let _ = h
                .disconnect(Disconnect::ByApplication, "bye", "en")
                .await;
        }
        if let Some(jh) = self.jumpbox_handle.take() {
            let _ = jh
                .disconnect(Disconnect::ByApplication, "bye", "en")
                .await;
        }
        for h in self.join.drain(..) {
            // Give each task a brief window to finish before forcing abort
            if tokio::time::timeout(std::time::Duration::from_millis(200), h).await.is_err() {
                log::debug!("SSH task did not finish in time, aborting");
            }
        }
        Ok(())
    }
}

impl Drop for SshSession {
    fn drop(&mut self) {
        if self.writer_tx.is_some() {
            log::warn!("SshSession dropped without calling disconnect()");
            for h in self.join.drain(..) {
                h.abort();
            }
        }
    }
}
