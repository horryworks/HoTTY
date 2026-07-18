//! Tauri commands for the File Server feature (TFTP + SFTP servers) and the
//! Windows Firewall status/remediation surface. Thin wrappers that validate
//! input then delegate to the services in `crate::services`.

use tauri::{AppHandle, State};

use crate::services::file_server::{self, validate_root_dir, FileServerState, FirewallReport};
use crate::services::{sftp_server, tftp_server};

fn validate_port(port: u16) -> Result<(), String> {
    // `port` is a u16, so the only out-of-range value is 0.
    if port == 0 {
        return Err("Port must be between 1 and 65535".into());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// TFTP
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn file_server_tftp_start(
    app: AppHandle,
    state: State<'_, FileServerState>,
    server_id: String,
    bind_addr: String,
    port: u16,
    root_dir: String,
    allow_write: bool,
) -> Result<(), String> {
    validate_port(port)?;
    let root = validate_root_dir(&root_dir)?;
    tftp_server::start_tftp(app, &state, server_id, bind_addr, port, root, allow_write).await
}

#[tauri::command]
pub async fn file_server_tftp_stop(
    state: State<'_, FileServerState>,
    server_id: String,
) -> Result<(), String> {
    tftp_server::stop_tftp(&state, &server_id).await;
    Ok(())
}

// ---------------------------------------------------------------------------
// SFTP
// ---------------------------------------------------------------------------

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn file_server_sftp_start(
    app: AppHandle,
    state: State<'_, FileServerState>,
    server_id: String,
    bind_addr: String,
    port: u16,
    root_dir: String,
    username: String,
    password: String,
    allow_write: bool,
) -> Result<(), String> {
    validate_port(port)?;
    sftp_server::start_sftp(
        app,
        &state,
        server_id,
        bind_addr,
        port,
        root_dir,
        username,
        password,
        allow_write,
    )
    .await
}

#[tauri::command]
pub async fn file_server_sftp_stop(
    state: State<'_, FileServerState>,
    server_id: String,
) -> Result<(), String> {
    sftp_server::stop_sftp(&state, &server_id).await;
    Ok(())
}

// ---------------------------------------------------------------------------
// Windows Firewall
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn file_server_firewall_status(
    protocol: String,
    port: u16,
) -> Result<FirewallReport, String> {
    Ok(file_server::firewall_status(&protocol, port).await)
}

#[tauri::command]
pub async fn file_server_firewall_allow(protocol: String, port: u16) -> Result<(), String> {
    validate_port(port)?;
    file_server::firewall_allow(&protocol, port).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_port_rejects_zero() {
        assert!(validate_port(0).is_err());
    }

    #[test]
    fn validate_port_accepts_valid_ports() {
        assert!(validate_port(1).is_ok());
        assert!(validate_port(69).is_ok());
        assert!(validate_port(65535).is_ok());
    }
}
