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
use russh::keys::ssh_key::private::{Ed25519Keypair, Ed25519PrivateKey, KeypairData};
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
    self, ct_eq, emit_error, emit_status, emit_transfer, resolve_in_root, validate_root_dir,
    FileServerState, JailError, ServerHandle, DIR_DOWNLOAD, DIR_UPLOAD,
};

const PROTO: &str = "sftp";

// ---------------------------------------------------------------------------
// Host key (auto-generated, DPAPI-encrypted at rest)
// ---------------------------------------------------------------------------

fn host_key_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?;
    let _ = std::fs::create_dir_all(&dir);
    Ok(dir.join("sftp_host_key"))
}

/// Load the persisted SFTP host key, or generate + persist a new ed25519 key.
fn load_or_create_host_key(app: &AppHandle) -> Result<PrivateKey, String> {
    let path = host_key_path(app)?;

    if let Ok(enc) = std::fs::read_to_string(&path) {
        if let Ok(pem) = crate::services::dpapi::decrypt_string(&enc) {
            if let Ok(key) = PrivateKey::from_openssh(pem.as_bytes()) {
                return Ok(key);
            }
        }
        log::warn!("file-server: existing SFTP host key unreadable; regenerating");
    }

    // Generate ed25519 from 32 OS-random bytes (rand 0.8 OsRng).
    let mut seed = [0u8; 32];
    let mut rng = rand::rngs::OsRng;
    rng.fill_bytes(&mut seed);
    let private = Ed25519PrivateKey::from_bytes(&seed);
    let keypair = Ed25519Keypair::from(private);
    let key = PrivateKey::new(KeypairData::Ed25519(keypair), "hotty-sftp-host-key")
        .map_err(|e| format!("Failed to create host key: {e}"))?;

    // Persist DPAPI-encrypted (best-effort; non-Windows simply won't persist).
    if let Ok(pem) = key.to_openssh(LineEnding::LF) {
        match crate::services::dpapi::encrypt_string(&pem) {
            Ok(enc) => {
                if let Err(e) = std::fs::write(&path, enc) {
                    log::warn!("file-server: could not persist SFTP host key: {e}");
                }
            }
            Err(e) => log::warn!("file-server: could not encrypt SFTP host key: {e}"),
        }
    }
    Ok(key)
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
            log::warn!(
                "file-server: SFTP auth rejected for user '{user}' from {}",
                self.peer
            );
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
            return Err(StatusCode::PermissionDenied);
        }

        let creating = pflags.contains(OpenFlags::CREATE);
        let resolved =
            resolve_in_root(&self.ctx.root, &filename, !creating).map_err(map_jail_status)?;

        let opts: std::fs::OpenOptions = pflags.into();
        let file = opts
            .open(&resolved)
            .map_err(|_| StatusCode::PermissionDenied)?;

        let direction = if wants_write {
            DIR_UPLOAD
        } else {
            DIR_DOWNLOAD
        };
        let size = file.metadata().ok().map(|m| m.len());
        emit_transfer(
            &self.ctx.app,
            &self.ctx.server_id,
            PROTO,
            &self.peer,
            &filename,
            direction,
            size,
        );

        let handle = self.next_handle();
        self.files.insert(
            handle.clone(),
            OpenFile {
                file,
                write: wants_write,
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
        let mut buf = vec![0u8; len as usize];
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
        if !self.ctx.allow_write {
            return Err(StatusCode::PermissionDenied);
        }
        let entry = self.files.get_mut(&handle).ok_or(StatusCode::Failure)?;
        if !entry.write {
            return Err(StatusCode::PermissionDenied);
        }
        entry
            .file
            .seek(SeekFrom::Start(offset))
            .map_err(|_| StatusCode::Failure)?;
        entry
            .file
            .write_all(&data)
            .map_err(|_| StatusCode::Failure)?;
        Ok(ok_status(id))
    }

    async fn close(&mut self, id: u32, handle: String) -> Result<Status, Self::Error> {
        self.files.remove(&handle);
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

    let host_key = load_or_create_host_key(&app)?;
    let config = Arc::new(russh::server::Config {
        auth_rejection_time: Duration::from_secs(2),
        auth_rejection_time_initial: Some(Duration::from_secs(0)),
        keys: vec![host_key],
        ..Default::default()
    });

    let listener = TcpListener::bind(format!("{bind_addr}:{port}"))
        .await
        .map_err(|e| format!("Failed to bind SFTP on {bind_addr}:{port}: {e}"))?;

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
                            emit_error(&app_task, &sid, PROTO, &format!("SFTP accept failed: {e}"));
                            break;
                        }
                    };
                    let _ = stream.set_nodelay(true);
                    let handler = SshServerHandler {
                        ctx: ctx.clone(),
                        peer: peer.to_string(),
                        channels: HashMap::new(),
                        authed: false,
                    };
                    let cfg = config.clone();
                    let conn_cancel = cancel_child.child_token();
                    tokio::spawn(async move {
                        if let Ok(session) = russh::server::run_stream(cfg, stream, handler).await {
                            tokio::select! {
                                _ = session => {}
                                _ = conn_cancel.cancelled() => {}
                            }
                        }
                    });
                }
            }
        }
        emit_status(&app_task, &sid, PROTO, "stopped", None);
    });

    state
        .sftp
        .lock()
        .await
        .insert(server_id.clone(), ServerHandle { cancel, join });
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
