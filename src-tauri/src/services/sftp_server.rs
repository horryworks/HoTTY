//! Built-in SFTP server for the File Server feature. Runs an SSH server
//! (transport/auth/host-key via `russh`) exposing an SFTP-v3 subsystem
//! (`russh-sftp`) whose file operations are jailed to a served root directory.
//!
//! Auth is username + password (constant-time compare). The SSH host key is
//! auto-generated on first use and persisted DPAPI-encrypted under the app data
//! directory, so clients see a stable host key across restarts.

use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use rand::RngCore;
use russh::keys::ssh_key::private::{Ed25519Keypair, Ed25519PrivateKey, KeypairData, RsaKeypair};
use russh::keys::ssh_key::LineEnding;
use russh::keys::PrivateKey;
use russh::server::{Auth, Handler as RusshServerHandler, Msg, Session};
use russh::{Channel, ChannelId};
use russh_sftp::protocol::{
    Attrs, Data, File as SftpFile, FileAttributes, Handle as HandleReply, Name, OpenFlags, Status,
    StatusCode, Version,
};
use russh_sftp::server::Handler as SftpHandlerTrait;
use tauri::{AppHandle, Manager};
use tokio::net::TcpListener;
use tokio_util::sync::CancellationToken;
use zeroize::Zeroizing;

use crate::services::file_server::{
    self, clamp_for_display, ct_eq, emit_error, emit_status, emit_transfer, humanize_bind_error,
    humanize_file_error, jail_reason, resolve_in_root, resolve_in_root_creating, upload_error_msg,
    validate_root_dir, FileServerState, JailError, ServerHandle, DIR_DOWNLOAD, DIR_UPLOAD,
    REASON_UPLOADS_DISABLED,
};

const PROTO: &str = "sftp";

/// Cap on a single SFTP `read` length. The client controls the requested `len`
/// (a 32-bit field), so without a ceiling one request could force a multi-GiB
/// zeroed allocation and OOM the whole process — an authenticated but cheap DoS.
/// OpenSSH clamps a single read to 256 KiB for the same reason; larger reads are
/// split by the client across requests.
const MAX_SFTP_READ: usize = 256 * 1024;

/// How long a client has to complete the SSH handshake before its connection is
/// dropped. Bounds a half-open connection that stalls mid-handshake (e.g. a
/// scanner) so it can't pin a task past server stop.
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(30);

/// Clamp a client-requested read length to [`MAX_SFTP_READ`].
fn clamp_read_len(len: u32) -> usize {
    (len as usize).min(MAX_SFTP_READ)
}

// ---------------------------------------------------------------------------
// Host key (auto-generated, DPAPI-encrypted at rest)
// ---------------------------------------------------------------------------

fn host_key_path(app: &AppHandle, filename: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?;
    let _ = std::fs::create_dir_all(&dir);
    Ok(dir.join(filename))
}

/// Load a persisted host key from `filename`, or generate one via `generate`
/// and persist it (DPAPI-encrypted OpenSSH PEM). Persistence is best-effort;
/// on non-Windows the key simply isn't persisted across restarts.
fn load_or_create_key(
    app: &AppHandle,
    filename: &str,
    generate: impl FnOnce() -> Result<PrivateKey, String>,
) -> Result<PrivateKey, String> {
    let path = host_key_path(app, filename)?;

    if let Ok(enc) = std::fs::read_to_string(&path) {
        if let Ok(pem) = crate::services::dpapi::decrypt_string(&enc) {
            if let Ok(key) = PrivateKey::from_openssh(pem.as_bytes()) {
                return Ok(key);
            }
        }
        log::warn!("file-server: existing SFTP host key '{filename}' unreadable; regenerating");
    }

    let key = generate()?;

    if let Ok(pem) = key.to_openssh(LineEnding::LF) {
        match crate::services::dpapi::encrypt_string(&pem) {
            Ok(enc) => {
                if let Err(e) = std::fs::write(&path, enc) {
                    log::warn!("file-server: could not persist SFTP host key '{filename}': {e}");
                }
            }
            Err(e) => log::warn!("file-server: could not encrypt SFTP host key '{filename}': {e}"),
        }
    }
    Ok(key)
}

/// Load or create the SFTP host keys: an ed25519 key for modern clients, plus
/// an RSA-3072 key for older SSH clients. Many network devices (e.g. Huawei
/// VRP) only accept `rsa-sha2-*`/`ecdsa` host keys and reject ed25519, so
/// without the RSA key their SFTP handshake fails at host-key negotiation.
/// russh presents both and the client selects whichever it supports.
///
/// This is blocking (RSA-3072 generation takes a few seconds the first time,
/// then loads from disk), so callers run it on a blocking thread.
fn load_or_create_host_keys(app: &AppHandle) -> Result<Vec<PrivateKey>, String> {
    let ed25519 = load_or_create_key(app, "sftp_host_key", || {
        // ed25519 from 32 OS-random bytes (rand 0.8 OsRng).
        let mut seed = [0u8; 32];
        let mut rng = rand::rngs::OsRng;
        rng.fill_bytes(&mut seed);
        let private = Ed25519PrivateKey::from_bytes(&seed);
        let keypair = Ed25519Keypair::from(private);
        PrivateKey::new(KeypairData::Ed25519(keypair), "hotty-sftp-host-key")
            .map_err(|e| format!("Failed to create ed25519 host key: {e}"))
    })?;

    let rsa = load_or_create_key(app, "sftp_host_key_rsa", || {
        // rand 0.10's ThreadRng matches ssh-key's rand_core major (our
        // top-level `rand` 0.8 does not, so its RNG wouldn't satisfy the
        // CryptoRng bound). It's a CSPRNG seeded from the OS; fine for keygen,
        // and we're on a blocking thread so the thread-local RNG is OK.
        let mut rng = rand_v010::rng();
        let keypair = RsaKeypair::random(&mut rng, 3072)
            .map_err(|e| format!("Failed to generate RSA host key: {e}"))?;
        PrivateKey::new(KeypairData::Rsa(keypair), "hotty-sftp-host-key-rsa")
            .map_err(|e| format!("Failed to create RSA host key: {e}"))
    })?;

    Ok(vec![ed25519, rsa])
}

// ---------------------------------------------------------------------------
// SSH connection handler
// ---------------------------------------------------------------------------

#[derive(Clone)]
struct ConnContext {
    root: PathBuf,
    allow_write: bool,
    app: AppHandle,
    server_id: String,
    username: Arc<String>,
    password: Arc<Zeroizing<String>>,
}

struct SshServerHandler {
    ctx: ConnContext,
    peer: String,
    channels: HashMap<ChannelId, Channel<Msg>>,
    authed: bool,
}

impl RusshServerHandler for SshServerHandler {
    type Error = russh::Error;

    async fn auth_password(&mut self, user: &str, password: &str) -> Result<Auth, Self::Error> {
        let ok = ct_eq(user.as_bytes(), self.ctx.username.as_bytes())
            & ct_eq(password.as_bytes(), self.ctx.password.as_bytes());
        if ok {
            self.authed = true;
            Ok(Auth::Accept)
        } else {
            // Surface it: the operator otherwise sees nothing but a client that
            // "can't connect". `user` is attacker-controlled, so clamp it; the
            // password never appears anywhere.
            let msg = format!(
                "SFTP login failed for user '{}' from {}",
                clamp_for_display(user, 64),
                self.peer
            );
            log::warn!("file-server: {msg}");
            emit_error(&self.ctx.app, &self.ctx.server_id, PROTO, &msg);
            Ok(Auth::reject())
        }
    }

    async fn channel_open_session(
        &mut self,
        channel: Channel<Msg>,
        _session: &mut Session,
    ) -> Result<bool, Self::Error> {
        self.channels.insert(channel.id(), channel);
        Ok(true)
    }

    async fn channel_eof(
        &mut self,
        channel: ChannelId,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        session.close(channel)?;
        Ok(())
    }

    async fn subsystem_request(
        &mut self,
        channel_id: ChannelId,
        name: &str,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        if name == "sftp" && self.authed {
            if let Some(channel) = self.channels.remove(&channel_id) {
                session.channel_success(channel_id)?;
                emit_status(
                    &self.ctx.app,
                    &self.ctx.server_id,
                    PROTO,
                    "client-connected",
                    Some(self.peer.clone()),
                );
                let sftp = SftpSession::new(self.ctx.clone(), self.peer.clone());
                // Drive the SFTP protocol on this channel until the client closes it.
                russh_sftp::server::run(channel.into_stream(), sftp).await;
            } else {
                session.channel_failure(channel_id)?;
            }
        } else {
            session.channel_failure(channel_id)?;
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// SFTP subsystem handler (file-backed, path-jailed)
// ---------------------------------------------------------------------------

struct OpenFile {
    file: std::fs::File,
    write: bool,
    /// Client-supplied name, kept for error reporting after open.
    name: String,
    /// One error event per handle — a failing large upload would otherwise emit
    /// one per chunk.
    error_reported: bool,
}

struct DirListing {
    files: Vec<SftpFile>,
    sent: bool,
}

struct SftpSession {
    ctx: ConnContext,
    peer: String,
    version: Option<u32>,
    files: HashMap<String, OpenFile>,
    dirs: HashMap<String, DirListing>,
    seq: u64,
}

impl SftpSession {
    fn new(ctx: ConnContext, peer: String) -> Self {
        Self {
            ctx,
            peer,
            version: None,
            files: HashMap::new(),
            dirs: HashMap::new(),
            seq: 0,
        }
    }

    fn next_handle(&mut self) -> String {
        self.seq += 1;
        format!("h{}", self.seq)
    }

    /// Surface a refused/failed upload in the pane. Takes `&self` so it can be
    /// called from `map_err` closures that sit alongside `&self.ctx` borrows.
    fn report_upload_error(&self, filename: &str, reason: &str) {
        let msg = upload_error_msg(PROTO, filename, &self.peer, reason);
        log::warn!("file-server: {msg}");
        emit_error(&self.ctx.app, &self.ctx.server_id, PROTO, &msg);
    }
}

fn ok_status(id: u32) -> Status {
    Status {
        id,
        status_code: StatusCode::Ok,
        error_message: "Ok".to_string(),
        language_tag: "en-US".to_string(),
    }
}

fn map_jail_status(e: JailError) -> StatusCode {
    match e {
        JailError::NotFound => StatusCode::NoSuchFile,
        JailError::Denied => StatusCode::PermissionDenied,
    }
}

/// Normalize a client path into a canonical virtual path under the server root
/// ("/..."), collapsing `.`/`..` lexically and never escaping above root.
fn normalize_virtual(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    let mut stack: Vec<&str> = Vec::new();
    for part in normalized.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                stack.pop();
            }
            other => stack.push(other),
        }
    }
    format!("/{}", stack.join("/"))
}

impl SftpHandlerTrait for SftpSession {
    type Error = StatusCode;

    fn unimplemented(&self) -> Self::Error {
        StatusCode::OpUnsupported
    }

    async fn init(
        &mut self,
        version: u32,
        _extensions: HashMap<String, String>,
    ) -> Result<Version, Self::Error> {
        if self.version.is_some() {
            return Err(StatusCode::ConnectionLost);
        }
        self.version = Some(version);
        Ok(Version::new())
    }

    async fn realpath(&mut self, id: u32, path: String) -> Result<Name, Self::Error> {
        Ok(Name {
            id,
            files: vec![SftpFile::dummy(normalize_virtual(&path))],
        })
    }

    async fn opendir(&mut self, id: u32, path: String) -> Result<HandleReply, Self::Error> {
        let resolved = resolve_in_root(&self.ctx.root, &path, true).map_err(map_jail_status)?;
        if !resolved.is_dir() {
            return Err(StatusCode::NoSuchFile);
        }
        let read_dir = std::fs::read_dir(&resolved).map_err(|_| StatusCode::Failure)?;
        let mut files = Vec::new();
        for entry in read_dir.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let attrs = match entry.metadata() {
                Ok(md) => FileAttributes::from(&md),
                Err(_) => FileAttributes::default(),
            };
            files.push(SftpFile::new(name, attrs));
        }
        let handle = self.next_handle();
        self.dirs
            .insert(handle.clone(), DirListing { files, sent: false });
        Ok(HandleReply { id, handle })
    }

    async fn readdir(&mut self, id: u32, handle: String) -> Result<Name, Self::Error> {
        let listing = self.dirs.get_mut(&handle).ok_or(StatusCode::Failure)?;
        if listing.sent {
            return Err(StatusCode::Eof);
        }
        listing.sent = true;
        Ok(Name {
            id,
            files: listing.files.clone(),
        })
    }

    async fn open(
        &mut self,
        id: u32,
        filename: String,
        pflags: OpenFlags,
        _attrs: FileAttributes,
    ) -> Result<HandleReply, Self::Error> {
        let wants_write = pflags.contains(OpenFlags::WRITE)
            || pflags.contains(OpenFlags::APPEND)
            || pflags.contains(OpenFlags::CREATE)
            || pflags.contains(OpenFlags::TRUNCATE);
        if wants_write && !self.ctx.allow_write {
            self.report_upload_error(&filename, REASON_UPLOADS_DISABLED);
            return Err(StatusCode::PermissionDenied);
        }

        // Uploads may create missing parent directories (jail-safely); reads
        // must resolve to something that already exists.
        let creating = pflags.contains(OpenFlags::CREATE);
        let resolved = if creating {
            resolve_in_root_creating(&self.ctx.root, &filename)
        } else {
            resolve_in_root(&self.ctx.root, &filename, true)
        }
        .map_err(|e| {
            // Reads are not reported: clients probe for absent files routinely,
            // and that noise would bury the uploads that actually failed.
            if wants_write {
                self.report_upload_error(&filename, jail_reason(e));
            }
            map_jail_status(e)
        })?;

        let opts: std::fs::OpenOptions = pflags.into();
        let file = opts.open(&resolved).map_err(|e| {
            if wants_write {
                self.report_upload_error(&filename, &humanize_file_error(&e));
            }
            StatusCode::PermissionDenied
        })?;

        // Downloads log here with the file's real size. Uploads log on close
        // instead: at open the file is empty (created/truncated), so its size
        // would always be 0 — the real byte count is only known once writing
        // finishes.
        if !wants_write {
            let size = file.metadata().ok().map(|m| m.len());
            emit_transfer(
                &self.ctx.app,
                &self.ctx.server_id,
                PROTO,
                &self.peer,
                &filename,
                DIR_DOWNLOAD,
                size,
            );
        }

        let handle = self.next_handle();
        self.files.insert(
            handle.clone(),
            OpenFile {
                file,
                write: wants_write,
                name: filename,
                error_reported: false,
            },
        );
        Ok(HandleReply { id, handle })
    }

    async fn read(
        &mut self,
        id: u32,
        handle: String,
        offset: u64,
        len: u32,
    ) -> Result<Data, Self::Error> {
        let entry = self.files.get_mut(&handle).ok_or(StatusCode::Failure)?;
        entry
            .file
            .seek(SeekFrom::Start(offset))
            .map_err(|_| StatusCode::Failure)?;
        let mut buf = vec![0u8; clamp_read_len(len)];
        let n = entry.file.read(&mut buf).map_err(|_| StatusCode::Failure)?;
        if n == 0 {
            return Err(StatusCode::Eof);
        }
        buf.truncate(n);
        Ok(Data { id, data: buf })
    }

    async fn write(
        &mut self,
        id: u32,
        handle: String,
        offset: u64,
        data: Vec<u8>,
    ) -> Result<Status, Self::Error> {
        let allow_write = self.ctx.allow_write;
        let entry = self.files.get_mut(&handle).ok_or(StatusCode::Failure)?;

        let failure = if !allow_write || !entry.write {
            Some((
                StatusCode::PermissionDenied,
                REASON_UPLOADS_DISABLED.to_string(),
            ))
        } else if let Err(e) = entry.file.seek(SeekFrom::Start(offset)) {
            Some((StatusCode::Failure, humanize_file_error(&e)))
        } else if let Err(e) = entry.file.write_all(&data) {
            Some((StatusCode::Failure, humanize_file_error(&e)))
        } else {
            None
        };

        let Some((code, reason)) = failure else {
            return Ok(ok_status(id));
        };
        // Report the first failure on this handle only; the client will usually
        // keep pushing chunks that all fail the same way.
        let report = if entry.error_reported {
            None
        } else {
            entry.error_reported = true;
            Some(entry.name.clone())
        };
        if let Some(name) = report {
            self.report_upload_error(&name, &reason);
        }
        Err(code)
    }

    async fn close(&mut self, id: u32, handle: String) -> Result<Status, Self::Error> {
        // An upload's final size is known only now — emit its transfer here with
        // the real byte count (open-time it was an empty file).
        if let Some(entry) = self.files.remove(&handle) {
            if entry.write {
                let size = entry.file.metadata().ok().map(|m| m.len());
                emit_transfer(
                    &self.ctx.app,
                    &self.ctx.server_id,
                    PROTO,
                    &self.peer,
                    &entry.name,
                    DIR_UPLOAD,
                    size,
                );
            }
        }
        self.dirs.remove(&handle);
        Ok(ok_status(id))
    }

    async fn stat(&mut self, id: u32, path: String) -> Result<Attrs, Self::Error> {
        let resolved = resolve_in_root(&self.ctx.root, &path, true).map_err(map_jail_status)?;
        let md = std::fs::metadata(&resolved).map_err(|_| StatusCode::NoSuchFile)?;
        Ok(Attrs {
            id,
            attrs: FileAttributes::from(&md),
        })
    }

    async fn lstat(&mut self, id: u32, path: String) -> Result<Attrs, Self::Error> {
        self.stat(id, path).await
    }

    async fn fstat(&mut self, id: u32, handle: String) -> Result<Attrs, Self::Error> {
        let entry = self.files.get(&handle).ok_or(StatusCode::Failure)?;
        let md = entry.file.metadata().map_err(|_| StatusCode::Failure)?;
        Ok(Attrs {
            id,
            attrs: FileAttributes::from(&md),
        })
    }

    async fn setstat(
        &mut self,
        id: u32,
        _path: String,
        _attrs: FileAttributes,
    ) -> Result<Status, Self::Error> {
        // Accept (no-op) so clients that chmod/utime after upload don't fail.
        Ok(ok_status(id))
    }

    async fn fsetstat(
        &mut self,
        id: u32,
        _handle: String,
        _attrs: FileAttributes,
    ) -> Result<Status, Self::Error> {
        Ok(ok_status(id))
    }

    async fn remove(&mut self, id: u32, filename: String) -> Result<Status, Self::Error> {
        if !self.ctx.allow_write {
            return Err(StatusCode::PermissionDenied);
        }
        let resolved = resolve_in_root(&self.ctx.root, &filename, true).map_err(map_jail_status)?;
        std::fs::remove_file(&resolved).map_err(|_| StatusCode::Failure)?;
        Ok(ok_status(id))
    }

    async fn mkdir(
        &mut self,
        id: u32,
        path: String,
        _attrs: FileAttributes,
    ) -> Result<Status, Self::Error> {
        if !self.ctx.allow_write {
            return Err(StatusCode::PermissionDenied);
        }
        let resolved = resolve_in_root(&self.ctx.root, &path, false).map_err(map_jail_status)?;
        std::fs::create_dir(&resolved).map_err(|_| StatusCode::Failure)?;
        Ok(ok_status(id))
    }

    async fn rmdir(&mut self, id: u32, path: String) -> Result<Status, Self::Error> {
        if !self.ctx.allow_write {
            return Err(StatusCode::PermissionDenied);
        }
        let resolved = resolve_in_root(&self.ctx.root, &path, true).map_err(map_jail_status)?;
        std::fs::remove_dir(&resolved).map_err(|_| StatusCode::Failure)?;
        Ok(ok_status(id))
    }

    async fn rename(
        &mut self,
        id: u32,
        oldpath: String,
        newpath: String,
    ) -> Result<Status, Self::Error> {
        if !self.ctx.allow_write {
            return Err(StatusCode::PermissionDenied);
        }
        let old = resolve_in_root(&self.ctx.root, &oldpath, true).map_err(map_jail_status)?;
        let new = resolve_in_root(&self.ctx.root, &newpath, false).map_err(map_jail_status)?;
        std::fs::rename(&old, &new).map_err(|_| StatusCode::Failure)?;
        Ok(ok_status(id))
    }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/// Start (or restart) the SFTP server for `server_id`. `root_dir` is validated
/// and canonicalized here. Binding is synchronous so bind failures return to the
/// caller; the accept loop then runs in a task.
#[allow(clippy::too_many_arguments)]
pub async fn start_sftp(
    app: AppHandle,
    state: &FileServerState,
    server_id: String,
    bind_addr: String,
    port: u16,
    root_dir: String,
    username: String,
    password: String,
    allow_write: bool,
    window_label: String,
) -> Result<(), String> {
    if username.trim().is_empty() {
        return Err("SFTP username is required".into());
    }
    if password.is_empty() {
        return Err("SFTP password is required".into());
    }
    let root = validate_root_dir(&root_dir)?;

    {
        let mut map = state.sftp.lock().await;
        file_server::stop_handle(&mut map, &server_id).await;
    }

    // RSA-3072 generation (first run only) is CPU-bound and takes a few
    // seconds, so build the host keys on a blocking thread rather than stalling
    // the async runtime.
    let app_for_keys = app.clone();
    let host_keys = tokio::task::spawn_blocking(move || load_or_create_host_keys(&app_for_keys))
        .await
        .map_err(|e| format!("SFTP host key task failed: {e}"))??;
    let config = Arc::new(russh::server::Config {
        auth_rejection_time: Duration::from_secs(2),
        auth_rejection_time_initial: Some(Duration::from_secs(0)),
        keys: host_keys,
        ..Default::default()
    });

    let listener = TcpListener::bind(format!("{bind_addr}:{port}"))
        .await
        .map_err(|e| humanize_bind_error(&format!("{bind_addr}:{port}"), &e))?;

    let ctx = ConnContext {
        root,
        allow_write,
        app: app.clone(),
        server_id: server_id.clone(),
        username: Arc::new(username),
        password: Arc::new(Zeroizing::new(password)),
    };

    let cancel = CancellationToken::new();
    let cancel_child = cancel.clone();
    let app_task = app.clone();
    let sid = server_id.clone();

    let join = tokio::spawn(async move {
        emit_status(&app_task, &sid, PROTO, "running", None);
        loop {
            tokio::select! {
                _ = cancel_child.cancelled() => break,
                accepted = listener.accept() => {
                    let (stream, peer) = match accepted {
                        Ok(v) => v,
                        Err(e) => {
                            // Rare and not user-actionable — log the raw cause for
                            // diagnosis but show a plain message (ADR-005).
                            log::warn!("file-server: SFTP accept failed: {e}");
                            emit_error(&app_task, &sid, PROTO, "The SFTP server stopped accepting connections");
                            break;
                        }
                    };
                    let _ = stream.set_nodelay(true);
                    let peer_str = peer.to_string();
                    let handler = SshServerHandler {
                        ctx: ctx.clone(),
                        peer: peer_str.clone(),
                        channels: HashMap::new(),
                        authed: false,
                    };
                    let cfg = config.clone();
                    let conn_cancel = cancel_child.child_token();
                    tokio::spawn(async move {
                        // Race the handshake against (a) a bounded timeout and (b)
                        // server stop, so a client that stalls mid-handshake — or a
                        // stop issued while the handshake is in flight — can't pin
                        // this task open (russh's own run_stream has no cancel arm).
                        let handshake =
                            tokio::time::timeout(HANDSHAKE_TIMEOUT, russh::server::run_stream(cfg, stream, handler));
                        tokio::select! {
                            _ = conn_cancel.cancelled() => {}
                            res = handshake => match res {
                                // A failed handshake (e.g. no common host-key/kex/
                                // cipher with an old client) used to be swallowed
                                // silently; log it so mismatches are diagnosable.
                                Err(_) => log::warn!(
                                    "file-server: SFTP handshake from {peer_str} timed out"
                                ),
                                Ok(Err(e)) => log::warn!(
                                    "file-server: SFTP handshake failed from {peer_str}: {e}"
                                ),
                                Ok(Ok(session)) => {
                                    tokio::select! {
                                        _ = session => {}
                                        _ = conn_cancel.cancelled() => {}
                                    }
                                }
                            }
                        }
                    });
                }
            }
        }
        emit_status(&app_task, &sid, PROTO, "stopped", None);
    });

    state.sftp.lock().await.insert(
        server_id.clone(),
        ServerHandle {
            cancel,
            join,
            window_label,
        },
    );
    log::info!("file-server: SFTP listening on {bind_addr}:{port} (server {server_id})");
    Ok(())
}

/// Stop the SFTP server for `server_id` (no-op if not running).
pub async fn stop_sftp(state: &FileServerState, server_id: &str) {
    let mut map = state.sftp.lock().await;
    file_server::stop_handle(&mut map, server_id).await;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rsa_host_key_generates_and_roundtrips() {
        // Smoke test the RSA host-key path added for old SSH clients (e.g.
        // Huawei VRP, which rejects ed25519 host keys). 2048 bits keeps the
        // test fast; production uses 3072.
        let mut rng = rand_v010::rng();
        let keypair = RsaKeypair::random(&mut rng, 2048).expect("RSA keygen");
        let key = PrivateKey::new(KeypairData::Rsa(keypair), "test-rsa").expect("wrap RSA keypair");
        assert!(
            matches!(key.algorithm(), russh::keys::ssh_key::Algorithm::Rsa { .. }),
            "host key should be RSA"
        );
        let pem = key
            .to_openssh(LineEnding::LF)
            .expect("serialize to openssh");
        assert!(
            PrivateKey::from_openssh(pem.as_bytes()).is_ok(),
            "RSA host key should round-trip through OpenSSH PEM"
        );
    }

    #[test]
    fn read_len_is_capped_to_max() {
        // A client controls `len` directly; a huge value must not translate into
        // a huge allocation. Small reads pass through unchanged.
        assert_eq!(clamp_read_len(0), 0);
        assert_eq!(clamp_read_len(4096), 4096);
        assert_eq!(clamp_read_len(MAX_SFTP_READ as u32), MAX_SFTP_READ);
        assert_eq!(clamp_read_len(MAX_SFTP_READ as u32 + 1), MAX_SFTP_READ);
        assert_eq!(clamp_read_len(u32::MAX), MAX_SFTP_READ);
    }

    #[test]
    fn normalize_virtual_root() {
        assert_eq!(normalize_virtual("."), "/");
        assert_eq!(normalize_virtual("/"), "/");
        assert_eq!(normalize_virtual(""), "/");
    }

    #[test]
    fn normalize_virtual_paths() {
        assert_eq!(normalize_virtual("/firmware/ios.bin"), "/firmware/ios.bin");
        assert_eq!(normalize_virtual("foo/./bar"), "/foo/bar");
    }

    #[test]
    fn normalize_virtual_cannot_escape() {
        assert_eq!(normalize_virtual("/../../etc/passwd"), "/etc/passwd");
        assert_eq!(normalize_virtual(".."), "/");
        assert_eq!(normalize_virtual("/a/../../b"), "/b");
    }
}
