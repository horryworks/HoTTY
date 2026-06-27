use async_trait::async_trait;
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use russh::client::{self, Handle, Handler};
use russh::keys::ssh_key;
use russh::keys::{load_secret_key, HashAlg, PrivateKey, PrivateKeyWithHashAlg};
use russh::{cipher, kex, mac, ChannelMsg, Disconnect, Preferred};
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

use crate::commands::ssh_algorithms::{load_algorithms_sync, SshAlgorithms};

use super::jumpbox::{establish_tunnel, JumpboxConfig, JumpboxHandler};
use super::known_hosts::{
    check_known_host, default_known_hosts_path, upsert_known_host, HostKeyCheck,
};
use super::path_safety::is_unc_path;
use super::session_service::{
    abort_all, emit_session_data, emit_session_status, encoding_for, join_or_abort, SessionError,
    SessionService, DISCONNECT_DRAIN_MS,
};

// --- Config ------------------------------------------------------------

#[derive(Deserialize, Clone)]
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
    #[serde(default = "default_connect_timeout_secs")]
    pub connect_timeout_secs: u32,
    #[serde(default)]
    pub jumpbox: Option<JumpboxConfig>,
}

impl std::fmt::Debug for SshConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SshConfig")
            .field("host", &self.host)
            .field("port", &self.port)
            .field("username", &self.username)
            .field("password", &self.password.as_ref().map(|_| "<redacted>"))
            .field("private_key_path", &self.private_key_path)
            .field(
                "private_key_passphrase",
                &self.private_key_passphrase.as_ref().map(|_| "<redacted>"),
            )
            .field("encoding", &self.encoding)
            .field("keepalive_interval_secs", &self.keepalive_interval_secs)
            .field("connect_timeout_secs", &self.connect_timeout_secs)
            .field("jumpbox", &self.jumpbox)
            .finish()
    }
}

fn default_encoding() -> String {
    "utf8".to_string()
}

fn default_connect_timeout_secs() -> u32 {
    5
}

const MAX_CREDENTIAL_LEN: usize = 1024;
const MAX_HOST_LEN: usize = 253;
const MAX_USERNAME_LEN: usize = 256;

impl SshConfig {
    fn validate(&self) -> Result<(), SessionError> {
        if self.host.trim().is_empty() {
            return Err(SessionError::InvalidConfig("Host is required".into()));
        }
        if self.host.len() > MAX_HOST_LEN {
            return Err(SessionError::InvalidConfig("Host is too long".into()));
        }
        if self.port == 0 {
            return Err(SessionError::InvalidConfig("Port must be 1-65535".into()));
        }
        if self.username.trim().is_empty() {
            return Err(SessionError::InvalidConfig("Username is required".into()));
        }
        if self.username.len() > MAX_USERNAME_LEN {
            return Err(SessionError::InvalidConfig("Username is too long".into()));
        }
        if let Some(pw) = &self.password {
            if pw.len() > MAX_CREDENTIAL_LEN {
                return Err(SessionError::InvalidConfig("Password is too long".into()));
            }
        }
        if let Some(pp) = &self.private_key_passphrase {
            if pp.len() > MAX_CREDENTIAL_LEN {
                return Err(SessionError::InvalidConfig("Passphrase is too long".into()));
            }
        }
        Ok(())
    }
}

// --- Algorithm preference mapping --------------------------------------

/// Map a KEX algorithm name (as used in SSH) to russh's `kex::Name` constant.
/// Returns `None` for names russh 0.60 does not implement.
fn map_kex_name(s: &str) -> Option<kex::Name> {
    match s {
        "curve25519-sha256" => Some(kex::CURVE25519),
        "curve25519-sha256@libssh.org" => Some(kex::CURVE25519_PRE_RFC_8731),
        "mlkem768x25519-sha256" => Some(kex::MLKEM768X25519_SHA256),
        "diffie-hellman-group-exchange-sha1" => Some(kex::DH_GEX_SHA1),
        "diffie-hellman-group-exchange-sha256" => Some(kex::DH_GEX_SHA256),
        "diffie-hellman-group1-sha1" => Some(kex::DH_G1_SHA1),
        "diffie-hellman-group14-sha1" => Some(kex::DH_G14_SHA1),
        "diffie-hellman-group14-sha256" => Some(kex::DH_G14_SHA256),
        "diffie-hellman-group15-sha512" => Some(kex::DH_G15_SHA512),
        "diffie-hellman-group16-sha512" => Some(kex::DH_G16_SHA512),
        "diffie-hellman-group17-sha512" => Some(kex::DH_G17_SHA512),
        "diffie-hellman-group18-sha512" => Some(kex::DH_G18_SHA512),
        "ecdh-sha2-nistp256" => Some(kex::ECDH_SHA2_NISTP256),
        "ecdh-sha2-nistp384" => Some(kex::ECDH_SHA2_NISTP384),
        "ecdh-sha2-nistp521" => Some(kex::ECDH_SHA2_NISTP521),
        _ => None,
    }
}

fn map_cipher_name(s: &str) -> Option<cipher::Name> {
    match s {
        "3des-cbc" => Some(cipher::TRIPLE_DES_CBC),
        "aes128-ctr" => Some(cipher::AES_128_CTR),
        "aes192-ctr" => Some(cipher::AES_192_CTR),
        "aes256-ctr" => Some(cipher::AES_256_CTR),
        "aes128-cbc" => Some(cipher::AES_128_CBC),
        "aes192-cbc" => Some(cipher::AES_192_CBC),
        "aes256-cbc" => Some(cipher::AES_256_CBC),
        "aes128-gcm@openssh.com" | "aes128-gcm" => Some(cipher::AES_128_GCM),
        "aes256-gcm@openssh.com" | "aes256-gcm" => Some(cipher::AES_256_GCM),
        "chacha20-poly1305@openssh.com" => Some(cipher::CHACHA20_POLY1305),
        _ => None,
    }
}

fn map_mac_name(s: &str) -> Option<mac::Name> {
    match s {
        "hmac-sha1" => Some(mac::HMAC_SHA1),
        "hmac-sha2-256" => Some(mac::HMAC_SHA256),
        "hmac-sha2-512" => Some(mac::HMAC_SHA512),
        "hmac-sha1-etm@openssh.com" => Some(mac::HMAC_SHA1_ETM),
        "hmac-sha2-256-etm@openssh.com" => Some(mac::HMAC_SHA256_ETM),
        "hmac-sha2-512-etm@openssh.com" => Some(mac::HMAC_SHA512_ETM),
        _ => None,
    }
}

fn map_host_key_algo(s: &str) -> Option<ssh_key::Algorithm> {
    use ssh_key::EcdsaCurve;
    match s {
        "ssh-ed25519" => Some(ssh_key::Algorithm::Ed25519),
        "ecdsa-sha2-nistp256" => Some(ssh_key::Algorithm::Ecdsa {
            curve: EcdsaCurve::NistP256,
        }),
        "ecdsa-sha2-nistp384" => Some(ssh_key::Algorithm::Ecdsa {
            curve: EcdsaCurve::NistP384,
        }),
        "ecdsa-sha2-nistp521" => Some(ssh_key::Algorithm::Ecdsa {
            curve: EcdsaCurve::NistP521,
        }),
        "rsa-sha2-512" => Some(ssh_key::Algorithm::Rsa {
            hash: Some(HashAlg::Sha512),
        }),
        "rsa-sha2-256" => Some(ssh_key::Algorithm::Rsa {
            hash: Some(HashAlg::Sha256),
        }),
        "ssh-rsa" => Some(ssh_key::Algorithm::Rsa { hash: None }),
        "ssh-dss" => Some(ssh_key::Algorithm::Dsa),
        _ => None,
    }
}

/// Collect enabled entries for `category` from the user config, mapping each name
/// via `mapper`. Unknown names are logged and skipped. Returns `Err` if the
/// category exists but no enabled entry could be mapped (configuration mistake
/// that would otherwise silently fall back to the library default).
///
/// Returns `Ok(None)` if the category is absent from the config — caller should
/// fall back to the library default for that category.
fn collect_category<T>(
    algorithms: &SshAlgorithms,
    category: &str,
    mapper: impl Fn(&str) -> Option<T>,
) -> Result<Option<Vec<T>>, String> {
    let Some(entries) = algorithms.get(category) else {
        return Ok(None);
    };

    let mut mapped = Vec::with_capacity(entries.len());
    let mut enabled_any = false;
    for entry in entries {
        if !entry.enabled {
            continue;
        }
        enabled_any = true;
        match mapper(&entry.name) {
            Some(v) => mapped.push(v),
            None => log::warn!(
                "ssh: unsupported {category} algorithm '{}' in config — skipping",
                entry.name
            ),
        }
    }

    if !enabled_any {
        return Err(format!(
            "ssh: no algorithms enabled in category '{category}' — enable at least one in Settings"
        ));
    }
    if mapped.is_empty() {
        return Err(format!(
            "ssh: every enabled '{category}' algorithm is unsupported by the SSH library — \
             enable at least one supported algorithm in Settings"
        ));
    }
    Ok(Some(mapped))
}

/// Load the user's SSH algorithm config and build a `russh::Preferred` from it.
/// Falls back to library defaults if the config file is absent or unreadable.
/// Returns `Err(SessionError::InvalidConfig)` if the config is structurally valid
/// but has an unusable category (every entry disabled, or every enabled entry
/// unsupported by russh).
pub(crate) fn load_preferred(app: &AppHandle) -> Result<Preferred, SessionError> {
    match load_algorithms_sync(app) {
        Ok(Some(algos)) => build_preferred(&algos).map_err(SessionError::InvalidConfig),
        Ok(None) => Ok(Preferred::DEFAULT),
        Err(e) => {
            log::warn!("ssh: failed to load ssh_algorithms config ({e}); using library defaults");
            Ok(Preferred::DEFAULT)
        }
    }
}

/// Build a `russh::Preferred` from the user's algorithm configuration.
/// Categories absent from the config use russh's defaults.
/// Returns `Err` if any present category has no usable algorithm.
fn build_preferred(algorithms: &SshAlgorithms) -> Result<Preferred, String> {
    let default = Preferred::DEFAULT;

    let kex = match collect_category(algorithms, "kex", map_kex_name)? {
        Some(mut v) => {
            // Always preserve russh's ext-info / strict-kex pseudo-KEX names so
            // the SSH protocol extension negotiation continues to work.
            v.extend([
                kex::EXTENSION_SUPPORT_AS_CLIENT,
                kex::EXTENSION_SUPPORT_AS_SERVER,
                kex::EXTENSION_OPENSSH_STRICT_KEX_AS_CLIENT,
                kex::EXTENSION_OPENSSH_STRICT_KEX_AS_SERVER,
            ]);
            Cow::Owned(v)
        }
        None => default.kex.clone(),
    };

    let cipher = match collect_category(algorithms, "cipher", map_cipher_name)? {
        Some(v) => Cow::Owned(v),
        None => default.cipher.clone(),
    };

    let mac = match collect_category(algorithms, "hmac", map_mac_name)? {
        Some(v) => Cow::Owned(v),
        None => default.mac.clone(),
    };

    let key = match collect_category(algorithms, "serverHostKey", map_host_key_algo)? {
        Some(v) => Cow::Owned(v),
        None => default.key.clone(),
    };

    Ok(Preferred {
        kex,
        cipher,
        mac,
        key,
        compression: default.compression,
    })
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

/// Maximum time a host-key prompt may stay pending before the SSH handler
/// gives up and disconnects. Prevents indefinite hangs when the user closes
/// the modal without responding.
pub(crate) const HOST_KEY_PROMPT_TIMEOUT: Duration = Duration::from_secs(300);

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
///
/// If a prompt is already pending for the same id, the previous sender is
/// dropped (waking its waiter with a RecvError). This shouldn't happen in
/// normal flow — log a warning to surface the bug.
pub async fn register_external_prompt(session_id: String, tx: oneshot::Sender<HostKeyDecision>) {
    let mut map = pending_map().lock().await;
    if map.insert(session_id.clone(), tx).is_some() {
        log::warn!(
            "ssh: replacing existing pending host-key prompt for session {session_id}; prior waiter cancelled"
        );
    }
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

        // check_known_host returns Ok(New) when the file does not exist (first-time
        // user). Any actual I/O error (permission denied, partial read, disk failure)
        // surfaces as Err — refuse the connection rather than silently re-prompting
        // for a host that may already be on record. Otherwise an attacker who can
        // corrupt or chmod-zero the file could force the user back into a "new host"
        // prompt and trick them into accepting an attacker-controlled key.
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
                    "ssh: failed to read known_hosts at {:?}: {e} — refusing connection",
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
        {
            let mut map = pending_map().lock().await;
            if map.insert(self.session_id.clone(), tx).is_some() {
                log::warn!(
                    "ssh: replacing existing pending host-key prompt for session {}; prior waiter cancelled",
                    self.session_id
                );
            }
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

        let decision = match tokio::time::timeout(HOST_KEY_PROMPT_TIMEOUT, rx).await {
            Ok(Ok(d)) => d,
            Ok(Err(_)) => return Err(russh::Error::Disconnect),
            Err(_) => {
                log::warn!(
                    "ssh: host-key prompt timed out after {}s for session {}; disconnecting",
                    HOST_KEY_PROMPT_TIMEOUT.as_secs(),
                    self.session_id
                );
                pending_map().lock().await.remove(&self.session_id);
                return Err(russh::Error::Disconnect);
            }
        };
        if !decision.accept {
            return Ok(false);
        }
        if decision.remember {
            // Single atomic rewrite: drops any superseded key and records the new
            // one in one pass, so a concurrent connection never sees the host as
            // briefly absent (which would trigger a spurious re-prompt).
            if let Err(e) = upsert_known_host(
                &self.known_hosts_path,
                &self.host,
                self.port,
                &key_type,
                &key_base64,
            ) {
                log::warn!(
                    "ssh: failed to update known_hosts entry for {}:{}: {e} — the new key will not be remembered",
                    self.host,
                    self.port
                );
                let _ = self.app.emit(
                    "ssh-known-hosts-warning",
                    format!(
                        "Could not save host key for {}:{} to known_hosts: {e}",
                        self.host, self.port
                    ),
                );
            }
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
    /// Cancelled by disconnect() to stop the reader task deterministically,
    /// rather than leaving it parked in rd.wait() until the drain abort.
    cancel: CancellationToken,
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
            cancel: CancellationToken::new(),
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

/// Convert a `russh::Error` Display string into a short, human-friendly message
/// for the toast. Detects common SSH handshake-layer failure modes plus the
/// inner `IO error: ...` wrapping that russh applies to underlying transport
/// failures so they can be routed back through [`humanize_io_error`] semantics.
pub(crate) fn humanize_ssh_error(raw: &str) -> String {
    let trimmed = raw.trim();
    let lower = trimmed.to_ascii_lowercase();

    // russh wraps transport-layer io::Errors as "IO error: <inner>". Map the
    // most common inner messages so the user sees the same labels as a direct
    // TCP failure (see humanize_io_error in session_service.rs).
    if lower.contains("connection refused") {
        return "Connection refused".to_string();
    }
    if lower.contains("failed to lookup address")
        || lower.contains("no such host")
        || lower.contains("name or service not known")
    {
        return "Host not found".to_string();
    }
    if lower.contains("unreachable network") {
        return "Network unreachable".to_string();
    }
    if lower.contains("unreachable host") {
        return "Host unreachable".to_string();
    }

    // No common algorithm — russh exposes separate variants for kex/cipher/mac/
    // host-key but the Display strings all contain "no common"+the category.
    if lower.contains("no common") {
        let category = if lower.contains("kex") {
            "kex"
        } else if lower.contains("cipher") {
            "cipher"
        } else if lower.contains("mac") {
            "MAC"
        } else if lower.contains("key") {
            "host key"
        } else {
            "algorithm"
        };
        return format!("No common {category} algorithm with server");
    }

    // Server sent a Disconnect packet. Strip the russh prefix if any and
    // surface whatever reason the server provided.
    if lower.contains("disconnect") {
        // russh Disconnect Display is typically "Disconnect: <code> <reason>".
        let reason = trimmed
            .split_once(':')
            .map(|(_, r)| r.trim())
            .filter(|s| !s.is_empty())
            .unwrap_or(trimmed);
        return format!("Server closed connection: {reason}");
    }

    // Generic russh handshake fallback: keep it short, no `russh::Error::` prefix.
    let stripped = trimmed
        .strip_prefix("IO error: ")
        .or_else(|| trimmed.strip_prefix("Error: "))
        .unwrap_or(trimmed);
    format!("SSH handshake failed: {stripped}")
}

/// Variant of [`humanize_ssh_error`] for the SSH-over-jumpbox path. Re-labels
/// the generic SSH-handshake messages so the user can tell which hop failed.
fn humanize_ssh_handshake_via_jumpbox(raw: &str) -> String {
    let humanized = humanize_ssh_error(raw);
    if let Some(rest) = humanized.strip_prefix("SSH handshake failed: ") {
        format!("Target SSH handshake failed via jumpbox: {rest}")
    } else {
        // Already a specific label (timeout, "No common kex algorithm", etc.);
        // prefix it so the user knows the failure is at the target hop.
        format!("Target via jumpbox: {humanized}")
    }
}

/// Convert a russh auth-call error into a short message scoped to the auth
/// stage that produced it. `stage` is one of "publickey" / "password" /
/// "keyboard-interactive".
fn humanize_auth_error(stage: &str, raw: &str) -> String {
    let lower = raw.to_ascii_lowercase();
    // load_secret_key wrong-passphrase failures surface as a decryption error.
    if stage == "load-key"
        && (lower.contains("bad decrypt")
            || lower.contains("incorrect passphrase")
            || lower.contains("decryption")
            || lower.contains("invalid passphrase"))
    {
        return "Wrong passphrase for private key".to_string();
    }
    if stage == "load-key" {
        return format!("Cannot read private key file: {}", raw.trim());
    }
    match stage {
        "publickey" => "Public key authentication failed".to_string(),
        "password" => "Password authentication failed".to_string(),
        "keyboard-interactive" => "Keyboard-interactive authentication failed".to_string(),
        _ => "Authentication failed".to_string(),
    }
}

async fn try_authenticate(
    handle: &mut Handle<SshHandler>,
    cfg: &SshConfig,
) -> Result<(), SessionError> {
    // 1. Public key (if path provided)
    if let Some(key_path) = &cfg.private_key_path {
        // Reject UNC paths to prevent an attacker-controlled key path from
        // triggering SMB auth (NTLMv2 hash relay on Windows).
        if is_unc_path(key_path) {
            return Err(SessionError::AuthFailed(
                "Private key path cannot be a UNC/network path".to_string(),
            ));
        }
        let pk: PrivateKey = load_secret_key(key_path, cfg.private_key_passphrase.as_deref())
            .map_err(|e| {
                SessionError::AuthFailed(humanize_auth_error("load-key", &e.to_string()))
            })?;
        let key_with_hash = PrivateKeyWithHashAlg::new(Arc::new(pk), Some(HashAlg::Sha256));
        let res = handle
            .authenticate_publickey(&cfg.username, key_with_hash)
            .await
            .map_err(|e| {
                SessionError::AuthFailed(humanize_auth_error("publickey", &e.to_string()))
            })?;
        if matches!(res, russh::client::AuthResult::Success) {
            return Ok(());
        }
    }
    // 2. Password
    if let Some(pw) = &cfg.password {
        let res = handle
            .authenticate_password(&cfg.username, pw.clone())
            .await
            .map_err(|e| {
                SessionError::AuthFailed(humanize_auth_error("password", &e.to_string()))
            })?;
        if matches!(res, russh::client::AuthResult::Success) {
            return Ok(());
        }

        // 3. Keyboard-interactive — single-round using password as response.
        let mut kb = handle
            .authenticate_keyboard_interactive_start(&cfg.username, None)
            .await
            .map_err(|e| {
                SessionError::AuthFailed(humanize_auth_error(
                    "keyboard-interactive",
                    &e.to_string(),
                ))
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
                            SessionError::AuthFailed(humanize_auth_error(
                                "keyboard-interactive",
                                &e.to_string(),
                            ))
                        })?;
                }
            }
        }
    }
    Err(SessionError::AuthFailed("Authentication failed".into()))
}

use tauri::Manager;

/// Map the user-configured keepalive interval (seconds) to russh's
/// `client::Config::keepalive_interval`. A value of `0` disables keepalive
/// (`None`); any positive value enables russh's native `keepalive@openssh.com`
/// global-request pings (analogous to OpenSSH's `ServerAliveInterval`).
fn keepalive_interval(secs: u32) -> Option<Duration> {
    (secs > 0).then(|| Duration::from_secs(secs as u64))
}

#[async_trait]
impl SessionService for SshSession {
    async fn connect(&mut self, app: AppHandle, session_id: String) -> Result<(), SessionError> {
        self.config.validate()?;

        let known_hosts_path = resolve_known_hosts_path(&app);

        let preferred = load_preferred(&app)?;

        let config = Arc::new(client::Config {
            inactivity_timeout: Some(Duration::from_secs(3600)),
            // Native SSH keepalive: russh sends keepalive@openssh.com global
            // requests every interval and drops the connection after
            // keepalive_max go unanswered. This replaces the old hand-rolled task
            // that only ticked a timer and never sent anything, so idle sessions
            // were dropped by NAT/firewalls despite the keepalive setting being on.
            // keepalive_max is set explicitly (rather than relying on russh's
            // default) so a half-open/dead peer is detected deterministically —
            // ~keepalive_interval * keepalive_max seconds after it goes silent —
            // which is what surfaces the `disconnected` status that lets the UI
            // (and AI Chat watch links) react instead of hanging on a zombie.
            keepalive_interval: keepalive_interval(self.config.keepalive_interval_secs),
            keepalive_max: 3,
            preferred,
            ..client::Config::default()
        });

        let handler = SshHandler {
            app: app.clone(),
            session_id: session_id.clone(),
            host: self.config.host.clone(),
            port: self.config.port,
            known_hosts_path,
        };

        let connect_timeout = Duration::from_secs(self.config.connect_timeout_secs.max(1) as u64);

        let mut handle = if let Some(jumpbox_cfg) = self.config.jumpbox.take() {
            log::info!(
                "ssh: tunneling through jumpbox {}:{} to {}:{}",
                jumpbox_cfg.host,
                jumpbox_cfg.port,
                self.config.host,
                self.config.port
            );
            let tunnel = establish_tunnel(
                app.clone(),
                &session_id,
                jumpbox_cfg,
                &self.config.host,
                self.config.port,
                self.config.connect_timeout_secs,
            )
            .await?;
            let (jumpbox_handle, stream) = tunnel.into_stream();
            self.jumpbox_handle = Some(jumpbox_handle);
            let timeout_secs = self.config.connect_timeout_secs;
            tokio::time::timeout(
                connect_timeout,
                client::connect_stream(config, stream, handler),
            )
            .await
            .map_err(|_| {
                SessionError::ConnectionFailed(format!(
                    "Target connection timed out via jumpbox ({timeout_secs}s)"
                ))
            })?
            .map_err(|e| {
                SessionError::ConnectionFailed(humanize_ssh_handshake_via_jumpbox(&e.to_string()))
            })?
        } else {
            let addr = (self.config.host.as_str(), self.config.port);
            let timeout_secs = self.config.connect_timeout_secs;
            tokio::time::timeout(connect_timeout, client::connect(config, addr, handler))
                .await
                .map_err(|_| {
                    SessionError::ConnectionFailed(format!(
                        "Connection timed out ({timeout_secs}s)"
                    ))
                })?
                .map_err(|e| SessionError::ConnectionFailed(humanize_ssh_error(&e.to_string())))?
        };

        let auth_result = try_authenticate(&mut handle, &self.config).await;

        // Zeroize credentials immediately after the auth attempt — whether it
        // succeeded or failed — so plaintext secrets do not linger in memory.
        use zeroize::Zeroize;
        if let Some(ref mut pw) = self.config.password {
            pw.zeroize();
        }
        self.config.password = None;
        if let Some(ref mut pp) = self.config.private_key_passphrase {
            pp.zeroize();
        }
        self.config.private_key_passphrase = None;

        auth_result?;

        let channel = handle.channel_open_session().await.map_err(|e| {
            log::error!("ssh: channel_open_session failed: {e}");
            SessionError::Protocol("Failed to open SSH channel".into())
        })?;

        channel
            .request_pty(true, "xterm-256color", 80, 24, 0, 0, &[])
            .await
            .map_err(|e| {
                log::error!("ssh: request_pty failed: {e}");
                SessionError::Protocol("Failed to allocate PTY".into())
            })?;
        channel.request_shell(true).await.map_err(|e| {
            log::error!("ssh: request_shell failed: {e}");
            SessionError::Protocol("Failed to start remote shell".into())
        })?;

        emit_session_status(&app, &session_id, "connected");

        let (read_half, write_half) = channel.split();
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

        // Reader task. read_half has a single owner (this task), so it's moved
        // in directly — no Arc<Mutex> needed. select! on the cancel token so
        // disconnect() stops the reader immediately instead of leaving it parked
        // in rd.wait() until the 1.5s drain abort. CancellationToken is
        // level-triggered, so there's no lost-wakeup race if cancel fires while
        // we're mid-iteration processing a data chunk.
        let encoding = self.encoding;
        let app_r = app.clone();
        let sid_r = session_id.clone();
        let reader_cancel = self.cancel.clone();
        let log_mgr: super::log_manager::LogManager = app
            .state::<super::log_manager::LogManager>()
            .inner()
            .clone();
        let reader_join = tokio::spawn(async move {
            let mut rd = read_half;
            loop {
                tokio::select! {
                    _ = reader_cancel.cancelled() => {
                        // disconnect() initiated teardown: stop cleanly without a
                        // redundant 'disconnected' emit (the close was user-driven
                        // and the frontend already drove the pane removal).
                        log_mgr.stop_logging(&sid_r).await;
                        break;
                    }
                    msg = rd.wait() => {
                        match msg {
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
                }
            }
        });
        self.join.push(reader_join);

        self.session_id = Some(session_id.clone());

        // Keepalive is handled natively by russh via `keepalive_interval` in the
        // client config above — no manual task needed.

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
        // Stop the reader task deterministically. Level-triggered, so there is
        // no lost-wakeup race even if the reader is mid-iteration.
        self.cancel.cancel();
        if let Some(tx) = self.writer_tx.take() {
            let _ = tx.send(WriterCmd::Close).await;
        }
        if let Some(h) = self.handle.take() {
            let _ = h.disconnect(Disconnect::ByApplication, "bye", "en").await;
        }
        if let Some(jh) = self.jumpbox_handle.take() {
            let _ = jh.disconnect(Disconnect::ByApplication, "bye", "en").await;
        }
        join_or_abort(std::mem::take(&mut self.join), "SSH", DISCONNECT_DRAIN_MS).await;
        Ok(())
    }
}

impl Drop for SshSession {
    fn drop(&mut self) {
        if self.writer_tx.is_some() {
            log::warn!("SshSession dropped without calling disconnect()");
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
    use crate::commands::ssh_algorithms::AlgorithmEntry;

    fn entry(name: &str, enabled: bool) -> AlgorithmEntry {
        AlgorithmEntry {
            name: name.into(),
            enabled,
        }
    }

    fn algos(map: &[(&str, Vec<AlgorithmEntry>)]) -> SshAlgorithms {
        let mut h = HashMap::new();
        for (k, v) in map {
            h.insert((*k).to_string(), v.clone());
        }
        h
    }

    #[test]
    fn keepalive_interval_maps_config_to_russh() {
        // 0 disables keepalive; any positive value enables russh's native pings.
        assert_eq!(keepalive_interval(0), None);
        assert_eq!(keepalive_interval(30), Some(Duration::from_secs(30)));
        assert_eq!(keepalive_interval(1), Some(Duration::from_secs(1)));
    }

    #[test]
    fn map_kex_supports_legacy_sha1() {
        // The whole point of the user-configurable list: russh DEFAULT excludes
        // these, but russh 0.60 implements them — we must be able to opt in.
        assert_eq!(
            map_kex_name("diffie-hellman-group1-sha1"),
            Some(kex::DH_G1_SHA1)
        );
        assert_eq!(
            map_kex_name("diffie-hellman-group14-sha1"),
            Some(kex::DH_G14_SHA1)
        );
        assert_eq!(
            map_kex_name("diffie-hellman-group-exchange-sha1"),
            Some(kex::DH_GEX_SHA1)
        );
    }

    #[test]
    fn map_kex_returns_none_for_unknown() {
        assert_eq!(map_kex_name("totally-fake-algo"), None);
    }

    #[test]
    fn map_cipher_aliases_gcm_short_name() {
        assert_eq!(map_cipher_name("aes128-gcm"), Some(cipher::AES_128_GCM));
        assert_eq!(
            map_cipher_name("aes128-gcm@openssh.com"),
            Some(cipher::AES_128_GCM)
        );
    }

    #[test]
    fn map_host_key_supports_dss_and_rsa_variants() {
        assert_eq!(map_host_key_algo("ssh-dss"), Some(ssh_key::Algorithm::Dsa));
        assert_eq!(
            map_host_key_algo("ssh-rsa"),
            Some(ssh_key::Algorithm::Rsa { hash: None })
        );
        assert_eq!(
            map_host_key_algo("rsa-sha2-256"),
            Some(ssh_key::Algorithm::Rsa {
                hash: Some(HashAlg::Sha256)
            })
        );
    }

    #[test]
    fn build_preferred_includes_only_enabled_kex() {
        let a = algos(&[(
            "kex",
            vec![
                entry("curve25519-sha256", true),
                entry("diffie-hellman-group14-sha1", true),
                entry("diffie-hellman-group-exchange-sha256", false),
            ],
        )]);
        let p = build_preferred(&a).expect("should build");
        assert!(p.kex.contains(&kex::CURVE25519));
        assert!(p.kex.contains(&kex::DH_G14_SHA1));
        assert!(!p.kex.contains(&kex::DH_GEX_SHA256));
    }

    #[test]
    fn build_preferred_appends_ext_info_pseudo_kex() {
        let a = algos(&[("kex", vec![entry("curve25519-sha256", true)])]);
        let p = build_preferred(&a).expect("should build");
        // Pseudo-KEX names that drive SSH protocol extension negotiation must
        // remain present — losing them would break ext-info handshakes.
        assert!(p.kex.contains(&kex::EXTENSION_SUPPORT_AS_CLIENT));
        assert!(p.kex.contains(&kex::EXTENSION_OPENSSH_STRICT_KEX_AS_CLIENT));
    }

    #[test]
    fn build_preferred_skips_unknown_names() {
        let a = algos(&[(
            "kex",
            vec![
                entry("curve25519-sha256", true),
                entry("not-a-real-algo", true),
            ],
        )]);
        let p = build_preferred(&a).expect("should build");
        assert!(p.kex.contains(&kex::CURVE25519));
        // Unknown names produce a warning and are silently dropped — verified by
        // the only mapped name being the one we recognise.
        let mapped_count = p
            .kex
            .iter()
            .filter(|n| **n == kex::CURVE25519 || **n == kex::DH_G14_SHA1)
            .count();
        assert_eq!(mapped_count, 1);
    }

    #[test]
    fn build_preferred_errors_on_all_disabled_category() {
        let a = algos(&[(
            "kex",
            vec![
                entry("curve25519-sha256", false),
                entry("diffie-hellman-group14-sha256", false),
            ],
        )]);
        let err = build_preferred(&a).expect_err("must reject");
        assert!(err.contains("kex"), "unexpected error: {err}");
    }

    #[test]
    fn build_preferred_errors_when_all_enabled_are_unsupported() {
        let a = algos(&[(
            "cipher",
            vec![entry("arcfour256", true), entry("blowfish-cbc", true)],
        )]);
        let err = build_preferred(&a).expect_err("must reject");
        assert!(err.contains("cipher"), "unexpected error: {err}");
    }

    #[test]
    fn build_preferred_falls_back_to_default_for_missing_category() {
        let a = algos(&[("kex", vec![entry("curve25519-sha256", true)])]);
        // No cipher / hmac / serverHostKey entries at all -> use russh defaults.
        let p = build_preferred(&a).expect("should build");
        let default = Preferred::DEFAULT;
        assert_eq!(p.cipher.as_ref().len(), default.cipher.as_ref().len());
        assert_eq!(p.mac.as_ref().len(), default.mac.as_ref().len());
        assert_eq!(p.key.as_ref().len(), default.key.as_ref().len());
    }

    #[test]
    fn build_preferred_handles_full_config_with_legacy_only() {
        // Reproduces the Catalyst 3650 scenario: only SHA-1 KEX, only CBC ciphers,
        // only hmac-sha1, only ssh-dss / ssh-rsa host keys enabled.
        let a = algos(&[
            (
                "kex",
                vec![
                    entry("diffie-hellman-group-exchange-sha1", true),
                    entry("diffie-hellman-group14-sha1", true),
                    entry("diffie-hellman-group1-sha1", true),
                ],
            ),
            (
                "cipher",
                vec![entry("aes256-cbc", true), entry("3des-cbc", true)],
            ),
            ("hmac", vec![entry("hmac-sha1", true)]),
            (
                "serverHostKey",
                vec![entry("ssh-rsa", true), entry("ssh-dss", true)],
            ),
        ]);
        let p = build_preferred(&a).expect("should build legacy preferred");
        assert!(p.kex.contains(&kex::DH_G14_SHA1));
        assert!(p.cipher.contains(&cipher::AES_256_CBC));
        assert!(p.cipher.contains(&cipher::TRIPLE_DES_CBC));
        assert!(p.mac.contains(&mac::HMAC_SHA1));
        assert!(p.key.contains(&ssh_key::Algorithm::Dsa));
    }

    #[test]
    fn debug_redacts_password_and_passphrase() {
        let cfg = SshConfig {
            host: "h".into(),
            port: 22,
            username: "u".into(),
            password: Some("hunter2".into()),
            private_key_path: Some("/k".into()),
            private_key_passphrase: Some("supersecret".into()),
            encoding: "utf8".into(),
            keepalive_interval_secs: 0,
            connect_timeout_secs: 5,
            jumpbox: None,
        };
        let s = format!("{cfg:?}");
        assert!(!s.contains("hunter2"), "password leaked: {s}");
        assert!(!s.contains("supersecret"), "passphrase leaked: {s}");
        assert!(s.contains("redacted"));
    }

    // -- humanize_ssh_error tests --

    #[test]
    fn humanize_ssh_error_connection_refused_through_russh() {
        // russh wraps an inner io::Error as "IO error: Connection refused..."
        let raw = "IO error: Connection refused (os error 10061)";
        assert_eq!(humanize_ssh_error(raw), "Connection refused");
    }

    #[test]
    fn humanize_ssh_error_dns_lookup_failure() {
        let raw = "IO error: failed to lookup address information: ...";
        assert_eq!(humanize_ssh_error(raw), "Host not found");
    }

    #[test]
    fn humanize_ssh_error_no_common_kex() {
        let raw = "no common kex algorithms";
        assert_eq!(
            humanize_ssh_error(raw),
            "No common kex algorithm with server"
        );
    }

    #[test]
    fn humanize_ssh_error_no_common_cipher() {
        let raw = "no common cipher";
        assert_eq!(
            humanize_ssh_error(raw),
            "No common cipher algorithm with server"
        );
    }

    #[test]
    fn humanize_ssh_error_no_common_host_key() {
        let raw = "no common host key algorithm";
        assert_eq!(
            humanize_ssh_error(raw),
            "No common host key algorithm with server"
        );
    }

    #[test]
    fn humanize_ssh_error_disconnect() {
        let raw = "Disconnect: 11 service not available";
        assert_eq!(
            humanize_ssh_error(raw),
            "Server closed connection: 11 service not available"
        );
    }

    #[test]
    fn humanize_ssh_error_unknown_fallback() {
        let raw = "Strange unmapped russh state";
        assert_eq!(
            humanize_ssh_error(raw),
            "SSH handshake failed: Strange unmapped russh state"
        );
    }

    #[test]
    fn humanize_ssh_error_strips_io_prefix_in_fallback() {
        let raw = "IO error: something obscure";
        assert_eq!(
            humanize_ssh_error(raw),
            "SSH handshake failed: something obscure"
        );
    }

    // -- humanize_auth_error tests --

    #[test]
    fn humanize_auth_error_password_method() {
        assert_eq!(
            humanize_auth_error("password", "Disconnect: ServiceNotAvailable"),
            "Password authentication failed"
        );
    }

    #[test]
    fn humanize_auth_error_publickey_method() {
        assert_eq!(
            humanize_auth_error("publickey", "some russh error"),
            "Public key authentication failed"
        );
    }

    #[test]
    fn humanize_auth_error_kbi_method() {
        assert_eq!(
            humanize_auth_error("keyboard-interactive", "x"),
            "Keyboard-interactive authentication failed"
        );
    }

    #[test]
    fn humanize_auth_error_bad_passphrase() {
        assert_eq!(
            humanize_auth_error("load-key", "bad decrypt: invalid passphrase"),
            "Wrong passphrase for private key"
        );
    }

    #[test]
    fn humanize_auth_error_unreadable_key() {
        assert_eq!(
            humanize_auth_error("load-key", "No such file or directory"),
            "Cannot read private key file: No such file or directory"
        );
    }

    // -- humanize_ssh_handshake_via_jumpbox tests --

    #[test]
    fn jumpbox_handshake_wraps_generic_handshake_failure() {
        let raw = "IO error: something obscure";
        // humanize_ssh_error returns "SSH handshake failed: something obscure"
        // which the jumpbox wrapper rewrites to identify the failing hop.
        assert_eq!(
            humanize_ssh_handshake_via_jumpbox(raw),
            "Target SSH handshake failed via jumpbox: something obscure"
        );
    }

    #[test]
    fn jumpbox_handshake_preserves_specific_label() {
        let raw = "IO error: Connection refused (os error 10061)";
        assert_eq!(
            humanize_ssh_handshake_via_jumpbox(raw),
            "Target via jumpbox: Connection refused"
        );
    }
}
