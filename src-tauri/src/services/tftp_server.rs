//! Built-in TFTP server (RFC 1350 + option negotiation) for the File Server
//! feature. Lets network devices (e.g. Cisco) pull firmware over UDP (RRQ) and,
//! when write is enabled, push config/image backups (WRQ).
//!
//! Built on `async-tftp` with a custom [`JailedDirHandler`] that confines every
//! request to the served root (reusing [`crate::services::file_server`]'s path
//! jail) and emits per-transfer events to the frontend.

use std::fs::File;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};

use async_tftp::packet;
use async_tftp::server::{Handler, TftpServerBuilder};
use blocking::{unblock, Unblock};
use tauri::AppHandle;
use tokio_util::sync::CancellationToken;

use crate::services::file_server::{
    self, emit_error, emit_status, emit_transfer, resolve_in_root, FileServerState, JailError,
    ServerHandle, DIR_DOWNLOAD, DIR_UPLOAD,
};

const PROTO: &str = "tftp";

/// A TFTP handler that serves only files under `root`, with traversal/symlink
/// protection and optional write support.
struct JailedDirHandler {
    root: PathBuf, // canonical
    allow_write: bool,
    app: AppHandle,
    server_id: String,
}

fn map_jail_err(e: JailError) -> packet::Error {
    match e {
        JailError::NotFound => packet::Error::FileNotFound,
        JailError::Denied => packet::Error::PermissionDenied,
    }
}

impl Handler for JailedDirHandler {
    type Reader = Unblock<File>;
    type Writer = Unblock<File>;

    async fn read_req_open(
        &mut self,
        client: &SocketAddr,
        path: &Path,
    ) -> Result<(Self::Reader, Option<u64>), packet::Error> {
        let requested = path.to_string_lossy().to_string();
        let client_str = client.to_string();

        let resolved = resolve_in_root(&self.root, &requested, true).map_err(map_jail_err)?;
        if !resolved.is_file() {
            return Err(packet::Error::FileNotFound);
        }

        let open_path = resolved.clone();
        let (file, len) = unblock(move || {
            let f = File::open(&open_path)?;
            let len = f.metadata().ok().map(|m| m.len());
            Ok::<(File, Option<u64>), std::io::Error>((f, len))
        })
        .await
        .map_err(|_| packet::Error::FileNotFound)?;

        emit_transfer(
            &self.app,
            &self.server_id,
            PROTO,
            &client_str,
            &requested,
            DIR_DOWNLOAD,
            len,
        );
        Ok((Unblock::new(file), len))
    }

    async fn write_req_open(
        &mut self,
        client: &SocketAddr,
        path: &Path,
        size: Option<u64>,
    ) -> Result<Self::Writer, packet::Error> {
        if !self.allow_write {
            return Err(packet::Error::IllegalOperation);
        }
        let requested = path.to_string_lossy().to_string();
        let client_str = client.to_string();

        let resolved = resolve_in_root(&self.root, &requested, false).map_err(map_jail_err)?;

        let create_path = resolved.clone();
        let file = unblock(move || {
            let f = File::create(&create_path)?;
            if let Some(s) = size {
                let _ = f.set_len(s);
            }
            Ok::<File, std::io::Error>(f)
        })
        .await
        .map_err(|_| packet::Error::PermissionDenied)?;

        emit_transfer(
            &self.app,
            &self.server_id,
            PROTO,
            &client_str,
            &requested,
            DIR_UPLOAD,
            size,
        );
        Ok(Unblock::new(file))
    }
}

/// Start (or restart) the TFTP server for `server_id`. `root` must already be
/// canonicalized/validated by the caller. Binding happens synchronously so bind
/// failures are returned to the caller; the serve loop then runs in a task.
pub async fn start_tftp(
    app: AppHandle,
    state: &FileServerState,
    server_id: String,
    bind_addr: String,
    port: u16,
    root: PathBuf,
    allow_write: bool,
) -> Result<(), String> {
    {
        let mut map = state.tftp.lock().await;
        file_server::stop_handle(&mut map, &server_id).await;
    }

    let sock_addr: SocketAddr = format!("{bind_addr}:{port}")
        .parse()
        .map_err(|_| format!("Invalid bind address: {bind_addr}:{port}"))?;

    let handler = JailedDirHandler {
        root,
        allow_write,
        app: app.clone(),
        server_id: server_id.clone(),
    };

    let server = TftpServerBuilder::with_handler(handler)
        .bind(sock_addr)
        .build()
        .await
        .map_err(|e| format!("Failed to bind TFTP on {sock_addr}: {e}"))?;

    let cancel = CancellationToken::new();
    let cancel_child = cancel.clone();
    let app_task = app.clone();
    let sid = server_id.clone();

    let join = tokio::spawn(async move {
        emit_status(&app_task, &sid, PROTO, "running", None);
        tokio::select! {
            res = server.serve() => {
                if let Err(e) = res {
                    emit_error(&app_task, &sid, PROTO, &format!("TFTP server stopped: {e}"));
                }
            }
            _ = cancel_child.cancelled() => {}
        }
        emit_status(&app_task, &sid, PROTO, "stopped", None);
    });

    state
        .tftp
        .lock()
        .await
        .insert(server_id.clone(), ServerHandle { cancel, join });
    log::info!("file-server: TFTP listening on {sock_addr} (server {server_id})");
    Ok(())
}

/// Stop the TFTP server for `server_id` (no-op if not running).
pub async fn stop_tftp(state: &FileServerState, server_id: &str) {
    let mut map = state.tftp.lock().await;
    file_server::stop_handle(&mut map, server_id).await;
}
