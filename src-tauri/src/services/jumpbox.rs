//! SSH jumpbox (bastion) tunneling support.
//!
//! Establishes an SSH session to the jumpbox, then opens a `direct-tcpip`
//! channel forwarding to the real target host/port. The returned
//! [`JumpboxTunnel`] exposes the channel as a bidirectional async stream that
//! can be handed to `russh::client::connect_stream` (for SSH-over-SSH) or used
//! as a raw TCP replacement (for Telnet-over-SSH).
//!
//! The jumpbox SSH session must be kept alive for the lifetime of the
//! forwarded stream; dropping the `Handle` severs the tunnel.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use base64::Engine;
use russh::client::{self, Handle, Handler};
use russh::keys::ssh_key;
use russh::keys::{load_secret_key, HashAlg, PrivateKey, PrivateKeyWithHashAlg};
use russh::ChannelMsg;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{oneshot, Mutex};

use super::known_hosts::{
    check_known_host, default_known_hosts_path, upsert_known_host, HostKeyCheck,
};
use super::path_safety::is_unc_path;
use super::session_service::SessionError;
use super::ssh::{humanize_ssh_error, HostKeyDecision};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct JumpboxConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub private_key_path: Option<String>,
    #[serde(default)]
    pub private_key_passphrase: Option<String>,
}

impl std::fmt::Debug for JumpboxConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("JumpboxConfig")
            .field("host", &self.host)
            .field("port", &self.port)
            .field("username", &self.username)
            .field("password", &self.password.as_ref().map(|_| "<redacted>"))
            .field("private_key_path", &self.private_key_path)
            .field(
                "private_key_passphrase",
                &self.private_key_passphrase.as_ref().map(|_| "<redacted>"),
            )
            .finish()
    }
}

impl JumpboxConfig {
    pub fn validate(&self) -> Result<(), SessionError> {
        if self.host.trim().is_empty() {
            return Err(SessionError::InvalidConfig(
                "Jumpbox host is required".into(),
            ));
        }
        if self.port == 0 {
            return Err(SessionError::InvalidConfig(
                "Jumpbox port must be 1-65535".into(),
            ));
        }
        if self.username.trim().is_empty() {
            return Err(SessionError::InvalidConfig(
                "Jumpbox username is required".into(),
            ));
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Host-key prompt payload (shares the `ssh-host-key-prompt` event)
// ---------------------------------------------------------------------------

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

/// Session id suffix used to distinguish jumpbox host-key prompts from the
/// primary session's prompt. The frontend modal keys off this id opaquely.
pub fn jumpbox_prompt_session_id(base: &str) -> String {
    format!("{base}::jumpbox")
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

pub struct JumpboxHandler {
    app: AppHandle,
    prompt_session_id: String,
    host: String,
    port: u16,
    known_hosts_path: PathBuf,
}

impl Handler for JumpboxHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        let key_type = server_public_key.algorithm().as_str().to_string();
        let key_bytes = server_public_key.to_bytes().map_err(|e| {
            log::error!("jumpbox: failed to serialize server public key: {e}");
            russh::Error::Disconnect
        })?;
        let key_base64 = base64::engine::general_purpose::STANDARD.encode(&key_bytes);
        let fingerprint = server_public_key
            .fingerprint(ssh_key::HashAlg::Sha256)
            .to_string();

        // Refuse the connection if the known_hosts file cannot be read (permission
        // denied, partial read, disk failure, etc.) rather than treating the host as
        // new — see ssh.rs for the full rationale. The same MITM concern applies to
        // the bastion path.
        let check = match check_known_host(
            &self.known_hosts_path,
            &self.host,
            self.port,
            &key_type,
            &key_base64,
        ) {
            Ok(c) => c,
            Err(e) => {
                log::error!(
                    "jumpbox: failed to read known_hosts at {:?}: {e} — refusing connection",
                    self.known_hosts_path
                );
                return Err(russh::Error::Disconnect);
            }
        };

        let kind = match check {
            HostKeyCheck::Match => return Ok(true),
            HostKeyCheck::New => "new",
            HostKeyCheck::Mismatch { .. } => "changed",
        };

        let (tx, rx) = oneshot::channel::<HostKeyDecision>();
        register_pending_jumpbox_prompt(&self.prompt_session_id, tx).await;

        let payload = SshHostKeyPromptPayload {
            session_id: self.prompt_session_id.clone(),
            host: self.host.clone(),
            port: self.port,
            key_type: key_type.clone(),
            fingerprint,
            kind: kind.to_string(),
        };
        let _ = self.app.emit("ssh-host-key-prompt", payload);

        let decision = match tokio::time::timeout(super::ssh::HOST_KEY_PROMPT_TIMEOUT, rx).await {
            Ok(Ok(d)) => d,
            Ok(Err(_)) => return Err(russh::Error::Disconnect),
            Err(_) => {
                log::warn!(
                    "jumpbox: host-key prompt timed out after {}s for session {}; disconnecting",
                    super::ssh::HOST_KEY_PROMPT_TIMEOUT.as_secs(),
                    self.prompt_session_id
                );
                jumpbox_pending_map()
                    .lock()
                    .await
                    .remove(&self.prompt_session_id);
                return Err(russh::Error::Disconnect);
            }
        };
        if !decision.accept {
            return Ok(false);
        }
        if decision.remember {
            // Atomic rewrite (drop superseded key + record new one in one pass)
            // so a concurrent connection never sees the host briefly absent.
            let _ = upsert_known_host(
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

// ---------------------------------------------------------------------------
// Pending-prompt map (shared with the primary SSH handler via
// `resolve_host_key_prompt`). We register the oneshot ourselves and delegate
// resolution back through the same `ssh_host_key_response` command.
// ---------------------------------------------------------------------------

use std::collections::HashMap;
use std::sync::OnceLock;

type PendingMap = Mutex<HashMap<String, oneshot::Sender<HostKeyDecision>>>;

fn jumpbox_pending_map() -> &'static PendingMap {
    static MAP: OnceLock<PendingMap> = OnceLock::new();
    MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

async fn register_pending_jumpbox_prompt(session_id: &str, tx: oneshot::Sender<HostKeyDecision>) {
    if jumpbox_pending_map()
        .lock()
        .await
        .insert(session_id.to_string(), tx)
        .is_some()
    {
        log::warn!(
            "jumpbox: replacing existing pending host-key prompt for session {session_id}; prior waiter cancelled"
        );
    }
    // Also register in the shared ssh module's map so `ssh_host_key_response`
    // can route by the same session id.
    register_with_ssh_map(session_id.to_string()).await;
}

/// Bridge: install a forwarding oneshot into the ssh.rs pending map so that
/// `resolve_host_key_prompt(session_id, decision)` also reaches our jumpbox
/// waiter. We achieve this by registering a shim sender in ssh.rs that, when
/// fired, relays to our jumpbox map.
async fn register_with_ssh_map(prompt_session_id: String) {
    let (shim_tx, shim_rx) = oneshot::channel::<HostKeyDecision>();
    // Register the shim in ssh.rs so `ssh_host_key_response` wakes it.
    super::ssh::register_external_prompt(prompt_session_id.clone(), shim_tx).await;
    // Fan it out to our jumpbox map.
    tokio::spawn(async move {
        if let Ok(decision) = shim_rx.await {
            if let Some(tx) = jumpbox_pending_map()
                .lock()
                .await
                .remove(&prompt_session_id)
            {
                let _ = tx.send(decision);
            }
        }
    });
}

// ---------------------------------------------------------------------------
// Auth (mirrors ssh.rs::try_authenticate but accepting JumpboxConfig)
// ---------------------------------------------------------------------------

/// Convert a private-key load error into a short message for the jumpbox path.
fn humanize_jumpbox_load_key(raw: &str) -> String {
    let lower = raw.to_ascii_lowercase();
    if lower.contains("bad decrypt")
        || lower.contains("incorrect passphrase")
        || lower.contains("decryption")
        || lower.contains("invalid passphrase")
    {
        return "Jumpbox: Wrong passphrase for private key".to_string();
    }
    format!("Jumpbox: Cannot read private key file: {}", raw.trim())
}

async fn authenticate_jumpbox(
    handle: &mut Handle<JumpboxHandler>,
    cfg: &JumpboxConfig,
) -> Result<(), SessionError> {
    if let Some(key_path) = &cfg.private_key_path {
        if is_unc_path(key_path) {
            return Err(SessionError::AuthFailed(
                "Jumpbox: Private key path cannot be a UNC/network path".to_string(),
            ));
        }
        let pk: PrivateKey = load_secret_key(key_path, cfg.private_key_passphrase.as_deref())
            .map_err(|e| SessionError::AuthFailed(humanize_jumpbox_load_key(&e.to_string())))?;
        let key_with_hash = PrivateKeyWithHashAlg::new(Arc::new(pk), Some(HashAlg::Sha256));
        let res = handle
            .authenticate_publickey(&cfg.username, key_with_hash)
            .await
            .map_err(|e| {
                log::error!("jumpbox: publickey auth failed: {e}");
                SessionError::AuthFailed("Jumpbox: Public key authentication failed".into())
            })?;
        if matches!(res, russh::client::AuthResult::Success) {
            return Ok(());
        }
    }
    if let Some(pw) = &cfg.password {
        let res = handle
            .authenticate_password(&cfg.username, pw.clone())
            .await
            .map_err(|e| {
                log::error!("jumpbox: password auth failed: {e}");
                SessionError::AuthFailed("Jumpbox: Password authentication failed".into())
            })?;
        if matches!(res, russh::client::AuthResult::Success) {
            return Ok(());
        }

        let mut kb = handle
            .authenticate_keyboard_interactive_start(&cfg.username, None)
            .await
            .map_err(|e| {
                log::error!("jumpbox: kbd-interactive start failed: {e}");
                SessionError::AuthFailed(
                    "Jumpbox: Keyboard-interactive authentication failed".into(),
                )
            })?;
        loop {
            match kb {
                russh::client::KeyboardInteractiveAuthResponse::Success => return Ok(()),
                russh::client::KeyboardInteractiveAuthResponse::Failure { .. } => break,
                russh::client::KeyboardInteractiveAuthResponse::InfoRequest { prompts, .. } => {
                    let responses: Vec<String> = prompts.iter().map(|_| pw.clone()).collect();
                    kb = handle
                        .authenticate_keyboard_interactive_respond(responses)
                        .await
                        .map_err(|e| {
                            log::error!("jumpbox: kbd-interactive resp failed: {e}");
                            SessionError::AuthFailed(
                                "Jumpbox: Keyboard-interactive authentication failed".into(),
                            )
                        })?;
                }
            }
        }
    }
    Err(SessionError::AuthFailed(
        "Jumpbox: Authentication failed".into(),
    ))
}

// ---------------------------------------------------------------------------
// Tunnel
// ---------------------------------------------------------------------------

/// A live jumpbox SSH session with an open `direct-tcpip` channel.
///
/// Holds the SSH `Handle` for the lifetime of the forwarded stream. Dropping
/// this struct closes the underlying SSH connection to the jumpbox.
pub struct JumpboxTunnel {
    pub handle: Arc<Handle<JumpboxHandler>>,
    pub channel: russh::Channel<russh::client::Msg>,
}

impl JumpboxTunnel {
    /// Consume the tunnel and return a bidirectional async stream over the
    /// forwarded channel plus the handle (kept alive alongside the stream).
    pub fn into_stream(
        self,
    ) -> (
        Arc<Handle<JumpboxHandler>>,
        russh::ChannelStream<russh::client::Msg>,
    ) {
        (self.handle, self.channel.into_stream())
    }

    pub async fn disconnect(self) {
        let _ = self
            .handle
            .disconnect(russh::Disconnect::ByApplication, "bye", "en")
            .await;
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

/// Establish an SSH session to the jumpbox and open a `direct-tcpip` channel
/// forwarded to `(target_host, target_port)`.
pub async fn establish_tunnel(
    app: AppHandle,
    session_id_base: &str,
    cfg: JumpboxConfig,
    target_host: &str,
    target_port: u16,
    connect_timeout_secs: u32,
) -> Result<JumpboxTunnel, SessionError> {
    cfg.validate()?;

    let known_hosts_path = resolve_known_hosts_path(&app);
    let prompt_session_id = jumpbox_prompt_session_id(session_id_base);

    let russh_config = Arc::new(client::Config {
        inactivity_timeout: Some(Duration::from_secs(3600)),
        preferred: super::ssh::load_preferred(&app)?,
        ..client::Config::default()
    });

    let handler = JumpboxHandler {
        app: app.clone(),
        prompt_session_id,
        host: cfg.host.clone(),
        port: cfg.port,
        known_hosts_path,
    };

    let addr = (cfg.host.as_str(), cfg.port);
    let connect_timeout = Duration::from_secs(connect_timeout_secs.max(1) as u64);
    let mut handle = tokio::time::timeout(
        connect_timeout,
        client::connect(russh_config, addr, handler),
    )
    .await
    .map_err(|_| {
        SessionError::ConnectionFailed(format!(
            "Jumpbox: Connection timed out ({connect_timeout_secs}s)"
        ))
    })?
    .map_err(|e| {
        let msg = humanize_ssh_error(&e.to_string());
        SessionError::ConnectionFailed(format!("Jumpbox: {msg}"))
    })?;

    authenticate_jumpbox(&mut handle, &cfg).await?;

    // Zeroize jumpbox credentials after use.
    {
        use zeroize::Zeroize;
        let mut cfg = cfg;
        if let Some(ref mut pw) = cfg.password {
            pw.zeroize();
        }
        if let Some(ref mut pp) = cfg.private_key_passphrase {
            pp.zeroize();
        }
    }

    let channel = handle
        .channel_open_direct_tcpip(target_host, target_port as u32, "127.0.0.1", 0)
        .await
        .map_err(|e| {
            log::error!("jumpbox: direct-tcpip to {target_host}:{target_port} failed: {e}");
            SessionError::ConnectionFailed("Jumpbox refused to forward to target host".into())
        })?;

    // Drain any initial control messages so we reach a data-ready state. We
    // don't await here; the caller will drive reads via the stream.
    let _ = ChannelMsg::Success; // silence unused warning in dead branches

    Ok(JumpboxTunnel {
        handle: Arc::new(handle),
        channel,
    })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_rejects_empty_host() {
        let cfg = JumpboxConfig {
            host: "".into(),
            port: 22,
            username: "user".into(),
            password: None,
            private_key_path: None,
            private_key_passphrase: None,
        };
        assert!(cfg.validate().is_err());
    }

    #[test]
    fn validate_rejects_zero_port() {
        let cfg = JumpboxConfig {
            host: "jump.example".into(),
            port: 0,
            username: "user".into(),
            password: None,
            private_key_path: None,
            private_key_passphrase: None,
        };
        assert!(cfg.validate().is_err());
    }

    #[test]
    fn validate_rejects_empty_username() {
        let cfg = JumpboxConfig {
            host: "jump.example".into(),
            port: 22,
            username: "".into(),
            password: None,
            private_key_path: None,
            private_key_passphrase: None,
        };
        assert!(cfg.validate().is_err());
    }

    #[test]
    fn validate_accepts_minimal_valid_config() {
        let cfg = JumpboxConfig {
            host: "jump.example".into(),
            port: 22,
            username: "user".into(),
            password: Some("pw".into()),
            private_key_path: None,
            private_key_passphrase: None,
        };
        assert!(cfg.validate().is_ok());
    }

    #[test]
    fn jumpbox_prompt_session_id_format() {
        assert_eq!(jumpbox_prompt_session_id("s1"), "s1::jumpbox");
    }

    #[test]
    fn debug_redacts_password_and_passphrase() {
        let cfg = JumpboxConfig {
            host: "jump.example".into(),
            port: 22,
            username: "user".into(),
            password: Some("hunter2".into()),
            private_key_path: Some("/k".into()),
            private_key_passphrase: Some("supersecret".into()),
        };
        let s = format!("{cfg:?}");
        assert!(!s.contains("hunter2"), "password leaked: {s}");
        assert!(!s.contains("supersecret"), "passphrase leaked: {s}");
        assert!(s.contains("redacted"));
    }
}
