//! Shared infrastructure for the built-in File Server feature (TFTP + SFTP).
//!
//! These servers let network devices (e.g. Cisco gear) pull/push firmware and
//! config images over the LAN. This module holds the cross-protocol pieces:
//! the [`FileServerState`] handle registry, the path-jail resolver shared by
//! both protocols, the frontend event payloads, and Windows Firewall
//! detection/remediation (inbound TFTP/SFTP is blocked by default, so we surface
//! that to the user rather than letting transfers silently fail).

use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use crate::services::path_safety::{is_sensitive_path, is_unc_path};

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

/// A running server task: a cancellation token plus its join handle.
pub struct ServerHandle {
    pub cancel: CancellationToken,
    pub join: tokio::task::JoinHandle<()>,
}

/// Shared Tauri state: running TFTP and SFTP servers keyed by `server_id`
/// (the owning pane's id). Each protocol is effectively a singleton per pane.
pub struct FileServerState {
    pub tftp: Arc<Mutex<HashMap<String, ServerHandle>>>,
    pub sftp: Arc<Mutex<HashMap<String, ServerHandle>>>,
}

impl FileServerState {
    pub fn new() -> Self {
        Self {
            tftp: Arc::new(Mutex::new(HashMap::new())),
            sftp: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl Default for FileServerState {
    fn default() -> Self {
        Self::new()
    }
}

/// Signal a running server to stop, then wait briefly for the task to wind down
/// before force-aborting. Used by both protocols on stop / restart.
pub async fn stop_handle(map: &mut HashMap<String, ServerHandle>, server_id: &str) {
    if let Some(handle) = map.remove(server_id) {
        handle.cancel.cancel();
        let abort = handle.join.abort_handle();
        if tokio::time::timeout(std::time::Duration::from_secs(2), handle.join)
            .await
            .is_err()
        {
            abort.abort();
        }
        log::info!("file-server: stopped {server_id}");
    }
}

// ---------------------------------------------------------------------------
// Path jail (shared by TFTP and SFTP)
// ---------------------------------------------------------------------------

/// Failure reason when resolving a client-supplied path inside the served root.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JailError {
    /// Traversal attempt, escape outside root, UNC, or sensitive location.
    Denied,
    /// Target (or its parent, for creates) does not exist.
    NotFound,
}

/// Resolve a client-supplied path against a canonical `root`, rejecting path
/// traversal (`..`), absolute/UNC/prefixed paths, symlink escapes, and
/// sensitive system locations. `root` MUST already be canonicalized.
///
/// - `must_exist = true` (reads): the target must exist; returns its canonical path.
/// - `must_exist = false` (creates): only the parent directory must exist; the
///   returned path is the parent's canonical path joined with the file name.
///
/// The result is always guaranteed to live under `root`.
pub fn resolve_in_root(root: &Path, requested: &str, must_exist: bool) -> Result<PathBuf, JailError> {
    if requested.is_empty() || is_unc_path(requested) {
        return Err(JailError::Denied);
    }

    // Normalize separators and strip any leading "/" (clients treat the served
    // root as "/"). Then accept ONLY normal components — reject `..`, absolute
    // roots and Windows drive prefixes.
    let normalized = requested.replace('\\', "/");
    let relative = normalized.trim_start_matches('/');

    let mut clean = PathBuf::new();
    for component in Path::new(relative).components() {
        match component {
            Component::Normal(part) => clean.push(part),
            Component::CurDir => {}
            // ParentDir, RootDir, Prefix are all rejected.
            _ => return Err(JailError::Denied),
        }
    }

    let candidate = root.join(&clean);

    if must_exist {
        let resolved = candidate.canonicalize().map_err(|_| JailError::NotFound)?;
        if !resolved.starts_with(root) || is_sensitive_path(&resolved) {
            return Err(JailError::Denied);
        }
        Ok(resolved)
    } else {
        let parent = candidate.parent().ok_or(JailError::Denied)?;
        let parent_resolved = parent.canonicalize().map_err(|_| JailError::NotFound)?;
        if !parent_resolved.starts_with(root) || is_sensitive_path(&parent_resolved) {
            return Err(JailError::Denied);
        }
        let file_name = candidate.file_name().ok_or(JailError::Denied)?;
        let final_path = parent_resolved.join(file_name);
        if is_sensitive_path(&final_path) {
            return Err(JailError::Denied);
        }
        Ok(final_path)
    }
}

/// Constant-time byte comparison for credential checks. The length is not
/// treated as secret (a length mismatch short-circuits), matching standard
/// practice for password/username comparison.
pub fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Validate a user-chosen root directory before binding a server to it.
/// Returns the canonical root or a human-readable error.
pub fn validate_root_dir(root: &str) -> Result<PathBuf, String> {
    if root.trim().is_empty() {
        return Err("Root directory is required".into());
    }
    if is_unc_path(root) {
        return Err("Network (UNC) paths are not allowed".into());
    }
    let resolved = Path::new(root)
        .canonicalize()
        .map_err(|e| format!("Invalid root directory: {e}"))?;
    if !resolved.is_dir() {
        return Err("Root path is not a directory".into());
    }
    if is_sensitive_path(&resolved) {
        return Err("That directory is protected and cannot be served".into());
    }
    Ok(resolved)
}

// ---------------------------------------------------------------------------
// Frontend events
// ---------------------------------------------------------------------------

/// Direction labels used in transfer events.
pub const DIR_DOWNLOAD: &str = "download"; // device reads FROM us (TFTP RRQ / SFTP get)
pub const DIR_UPLOAD: &str = "upload"; // device writes TO us (TFTP WRQ / SFTP put)

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileServerEvent {
    pub server_id: String,
    pub protocol: String, // "tftp" | "sftp"
    pub kind: String,     // "status" | "transfer" | "error"
    pub status: Option<String>,
    pub message: Option<String>,
    pub client: Option<String>,
    pub filename: Option<String>,
    pub direction: Option<String>,
    pub bytes: Option<u64>,
    pub timestamp: u64, // ms since Unix epoch
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn emit(app: &AppHandle, event: FileServerEvent) {
    let _ = app.emit("file-server-event", event);
}

pub fn emit_status(app: &AppHandle, server_id: &str, protocol: &str, status: &str, message: Option<String>) {
    emit(
        app,
        FileServerEvent {
            server_id: server_id.to_string(),
            protocol: protocol.to_string(),
            kind: "status".into(),
            status: Some(status.to_string()),
            message,
            client: None,
            filename: None,
            direction: None,
            bytes: None,
            timestamp: now_ms(),
        },
    );
}

#[allow(clippy::too_many_arguments)]
pub fn emit_transfer(
    app: &AppHandle,
    server_id: &str,
    protocol: &str,
    client: &str,
    filename: &str,
    direction: &str,
    bytes: Option<u64>,
) {
    emit(
        app,
        FileServerEvent {
            server_id: server_id.to_string(),
            protocol: protocol.to_string(),
            kind: "transfer".into(),
            status: None,
            message: None,
            client: Some(client.to_string()),
            filename: Some(filename.to_string()),
            direction: Some(direction.to_string()),
            bytes,
            timestamp: now_ms(),
        },
    );
}

pub fn emit_error(app: &AppHandle, server_id: &str, protocol: &str, message: &str) {
    emit(
        app,
        FileServerEvent {
            server_id: server_id.to_string(),
            protocol: protocol.to_string(),
            kind: "error".into(),
            status: None,
            message: Some(message.to_string()),
            client: None,
            filename: None,
            direction: None,
            bytes: None,
            timestamp: now_ms(),
        },
    );
}

// ---------------------------------------------------------------------------
// Windows Firewall awareness
// ---------------------------------------------------------------------------

/// Whether inbound connections to a server port are allowed by Windows Firewall.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FirewallStatus {
    /// Firewall is off, or an enabled inbound allow rule covers our program+port.
    Allowed,
    /// Firewall is on, default inbound is block, and no allow rule matches.
    Blocked,
    /// Could not determine (query failed).
    Unknown,
    /// Not a Windows host.
    NotApplicable,
}

/// PowerShell that reports firewall state as compact JSON. Reads the program
/// path / protocol / port from environment variables so nothing user- or
/// path-derived is interpolated into the script (no injection surface).
#[cfg(windows)]
const FIREWALL_DETECT_SCRIPT: &str = r#"
$ErrorActionPreference='SilentlyContinue'
try {
  $prof = Get-NetFirewallProfile
  $enabled = @($prof | Where-Object { $_.Enabled -eq $true })
  $fw = $enabled.Count -gt 0
  $block = (@($enabled | Where-Object { "$($_.DefaultInboundAction)" -ne 'Allow' }).Count -gt 0)
  $exe = $env:HOTTY_EXE
  $proto = $env:HOTTY_PROTO
  $port = $env:HOTTY_PORT
  $has = $false
  $af = Get-NetFirewallApplicationFilter | Where-Object { $_.Program -and ($_.Program -ieq $exe) }
  foreach ($f in $af) {
    $rules = $f | Get-NetFirewallRule | Where-Object { $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' -and $_.Enabled -eq 'True' }
    foreach ($rule in $rules) {
      $pf = $rule | Get-NetFirewallPortFilter
      if (("$($pf.Protocol)" -ieq $proto) -and (("$($pf.LocalPort)" -eq $port) -or ("$($pf.LocalPort)" -eq 'Any'))) { $has = $true }
    }
  }
  [pscustomobject]@{ ok=$true; firewall=$fw; block=$block; allow=$has } | ConvertTo-Json -Compress
} catch {
  [pscustomobject]@{ ok=$false } | ConvertTo-Json -Compress
}
"#;

/// Map the logical File Server protocol to the network protocol carried by the
/// Windows Firewall rule. TFTP runs over UDP, SFTP over TCP. Passing `"udp"` /
/// `"tcp"` directly is also accepted.
#[cfg(windows)]
fn net_proto(protocol: &str) -> &'static str {
    if protocol.eq_ignore_ascii_case("sftp") || protocol.eq_ignore_ascii_case("tcp") {
        "TCP"
    } else {
        "UDP"
    }
}

/// Detect whether inbound connections to `port` for `protocol` ("tftp"/"sftp")
/// are likely allowed by Windows Firewall.
///
/// `protocol` is the logical File Server protocol (`"tftp"`/`"sftp"`); it is
/// mapped to the network protocol (`UDP`/`TCP`) the firewall rule actually
/// carries via [`net_proto`] before matching.
#[cfg(windows)]
pub async fn firewall_status(protocol: &str, port: u16) -> FirewallStatus {
    use tokio::process::Command;

    let exe = match std::env::current_exe() {
        Ok(p) => p.to_string_lossy().to_string(),
        Err(_) => return FirewallStatus::Unknown,
    };
    let proto = net_proto(protocol);

    let output = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", FIREWALL_DETECT_SCRIPT])
        .env("HOTTY_EXE", &exe)
        .env("HOTTY_PROTO", proto)
        .env("HOTTY_PORT", port.to_string())
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .output()
        .await;

    let stdout = match output {
        Ok(out) if out.status.success() => String::from_utf8_lossy(&out.stdout).to_string(),
        _ => return FirewallStatus::Unknown,
    };

    let parsed: serde_json::Value = match serde_json::from_str(stdout.trim()) {
        Ok(v) => v,
        Err(_) => return FirewallStatus::Unknown,
    };

    if parsed.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        return FirewallStatus::Unknown;
    }
    let firewall_on = parsed.get("firewall").and_then(|v| v.as_bool()).unwrap_or(true);
    let default_block = parsed.get("block").and_then(|v| v.as_bool()).unwrap_or(true);
    let has_allow = parsed.get("allow").and_then(|v| v.as_bool()).unwrap_or(false);

    log::debug!(
        "file-server: firewall check exe={exe} proto={proto} port={port} -> \
         firewall_on={firewall_on} default_block={default_block} has_allow={has_allow}"
    );

    if !firewall_on || has_allow {
        FirewallStatus::Allowed
    } else if default_block {
        FirewallStatus::Blocked
    } else {
        FirewallStatus::Allowed
    }
}

#[cfg(not(windows))]
pub async fn firewall_status(_protocol: &str, _port: u16) -> FirewallStatus {
    FirewallStatus::NotApplicable
}

/// Add an inbound allow rule for this program (scoped to protocol+port) via an
/// elevated `New-NetFirewallRule`. Triggers a UAC prompt. The inner command is
/// passed as a base64 `-EncodedCommand` so no path quoting can break it.
#[cfg(windows)]
pub async fn firewall_allow(protocol: &str, port: u16) -> Result<(), String> {
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
    use tokio::process::Command;

    let exe = std::env::current_exe()
        .map_err(|e| format!("Cannot resolve program path: {e}"))?
        .to_string_lossy()
        .to_string();
    // Single-quote-escape for PowerShell literal strings.
    let exe_lit = exe.replace('\'', "''");
    let proto = net_proto(protocol);
    log::debug!("file-server: adding firewall rule program={exe} proto={proto} port={port}");

    let inner = format!(
        "New-NetFirewallRule -DisplayName 'HoTTY File Server ({proto} {port})' \
         -Direction Inbound -Action Allow -Program '{exe_lit}' -Protocol {proto} \
         -LocalPort {port} -Enabled True -Profile Any | Out-Null"
    );
    // PowerShell -EncodedCommand expects base64 of UTF-16LE.
    let utf16: Vec<u8> = inner.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
    let encoded = BASE64.encode(&utf16);

    let outer = format!(
        "Start-Process powershell -Verb RunAs -WindowStyle Hidden -Wait \
         -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','{encoded}'"
    );

    let output = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &outer])
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .output()
        .await
        .map_err(|e| format!("Failed to launch firewall command: {e}"))?;

    if output.status.success() {
        Ok(())
    } else {
        let err = String::from_utf8_lossy(&output.stderr);
        if err.contains("canceled") || err.contains("cancelled") {
            Err("Firewall change was cancelled".into())
        } else {
            Err(format!("Failed to add firewall rule: {}", err.trim()))
        }
    }
}

#[cfg(not(windows))]
pub async fn firewall_allow(_protocol: &str, _port: u16) -> Result<(), String> {
    Err("Firewall management is only available on Windows".into())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_root(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("hotty_fs_test_{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir.canonicalize().unwrap()
    }

    #[test]
    fn resolves_simple_file() {
        let root = temp_root("simple");
        fs::write(root.join("firmware.bin"), b"x").unwrap();
        let p = resolve_in_root(&root, "firmware.bin", true).unwrap();
        assert!(p.starts_with(&root));
        assert!(p.ends_with("firmware.bin"));
    }

    #[test]
    fn resolves_leading_slash() {
        let root = temp_root("slash");
        fs::write(root.join("img"), b"x").unwrap();
        assert!(resolve_in_root(&root, "/img", true).is_ok());
    }

    #[test]
    fn rejects_parent_traversal() {
        let root = temp_root("traverse");
        assert_eq!(resolve_in_root(&root, "../secret", true), Err(JailError::Denied));
        assert_eq!(resolve_in_root(&root, "a/../../b", true), Err(JailError::Denied));
        assert_eq!(resolve_in_root(&root, "/../x", true), Err(JailError::Denied));
    }

    #[cfg(windows)]
    #[test]
    fn rejects_windows_absolute_and_unc() {
        let root = temp_root("winabs");
        assert_eq!(resolve_in_root(&root, r"C:\Windows\System32\cmd.exe", true), Err(JailError::Denied));
        assert_eq!(resolve_in_root(&root, r"\\server\share\x", true), Err(JailError::Denied));
    }

    #[test]
    fn rejects_empty() {
        let root = temp_root("empty");
        assert_eq!(resolve_in_root(&root, "", true), Err(JailError::Denied));
    }

    #[test]
    fn missing_file_is_not_found() {
        let root = temp_root("missing");
        assert_eq!(resolve_in_root(&root, "nope.bin", true), Err(JailError::NotFound));
    }

    #[test]
    fn create_resolves_within_root() {
        let root = temp_root("create");
        let p = resolve_in_root(&root, "upload.bin", false).unwrap();
        assert!(p.starts_with(&root));
        assert!(p.ends_with("upload.bin"));
    }

    #[test]
    fn validate_root_rejects_empty() {
        assert!(validate_root_dir("").is_err());
    }

    #[test]
    fn validate_root_accepts_dir() {
        // Use a non-canonical (non-verbatim) path, as the folder picker would
        // supply — `validate_root_dir` canonicalizes internally.
        let dir = std::env::temp_dir().join("hotty_fs_test_validate_ok");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        assert!(validate_root_dir(dir.to_str().unwrap()).is_ok());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn event_serializes_camel_case() {
        let ev = FileServerEvent {
            server_id: "fs-1".into(),
            protocol: "tftp".into(),
            kind: "transfer".into(),
            status: None,
            message: None,
            client: Some("10.0.0.1:5000".into()),
            filename: Some("ios.bin".into()),
            direction: Some(DIR_DOWNLOAD.into()),
            bytes: Some(1024),
            timestamp: 1,
        };
        let json = serde_json::to_value(&ev).unwrap();
        assert_eq!(json["serverId"], "fs-1");
        assert_eq!(json["direction"], "download");
    }

    #[test]
    fn firewall_status_serializes_camel_case() {
        assert_eq!(serde_json::to_value(FirewallStatus::Blocked).unwrap(), "blocked");
        assert_eq!(serde_json::to_value(FirewallStatus::NotApplicable).unwrap(), "notApplicable");
    }

    #[cfg(windows)]
    #[test]
    fn net_proto_maps_logical_protocols() {
        // The firewall rule carries UDP/TCP, not the logical "tftp"/"sftp" name —
        // this mapping is what makes detection + remediation agree.
        assert_eq!(net_proto("tftp"), "UDP");
        assert_eq!(net_proto("sftp"), "TCP");
        assert_eq!(net_proto("udp"), "UDP");
        assert_eq!(net_proto("tcp"), "TCP");
    }
}
