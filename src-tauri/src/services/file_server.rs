//! Shared infrastructure for the built-in File Server feature (TFTP + SFTP).
//!
//! These servers let network devices (e.g. Cisco gear) pull/push firmware and
//! config images over the LAN. This module holds the cross-protocol pieces:
//! the [`FileServerState`] handle registry, the path-jail resolver shared by
//! both protocols, the frontend event payloads, and Windows Firewall
//! detection/remediation (inbound TFTP/SFTP is blocked by default, so we surface
//! that to the user rather than letting transfers silently fail).

use std::collections::HashMap;
use std::ffi::OsString;
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
    /// Label of the window that started this server, so it can be torn down when
    /// that window closes (mirrors `SessionOwners` for sessions). A File Server
    /// pane's servers normally stop on tab close; this covers closing the whole
    /// window with the pane still open, so the listener doesn't outlive it.
    pub window_label: String,
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

/// Stop every TFTP and SFTP server started by the window labelled `label`.
/// Called when that window is destroyed so a File Server pane closed together
/// with its window (rather than via its tab) does not leave a listener bound in
/// the shared process. No-op for windows that started no servers.
pub async fn stop_servers_for_window(
    tftp: &Arc<Mutex<HashMap<String, ServerHandle>>>,
    sftp: &Arc<Mutex<HashMap<String, ServerHandle>>>,
    label: &str,
) {
    for map in [tftp, sftp] {
        let mut guard = map.lock().await;
        let ids: Vec<String> = guard
            .iter()
            .filter(|(_, h)| h.window_label == label)
            .map(|(id, _)| id.clone())
            .collect();
        for id in ids {
            stop_handle(&mut guard, &id).await;
        }
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

/// Why the path jail turned a request down, in words the pane can show.
pub fn jail_reason(e: JailError) -> &'static str {
    match e {
        JailError::NotFound => "path not found in the served folder",
        JailError::Denied => "path denied (outside the served folder)",
    }
}

/// Sanitize a client-supplied path into a relative path built only from `Normal`
/// components: rejects empty/UNC input, `..` traversal, absolute roots and
/// Windows drive prefixes. An input of `/` yields an empty path (the root
/// itself), which callers handle.
fn sanitize_relative(requested: &str) -> Result<PathBuf, JailError> {
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
    Ok(clean)
}

/// Validate the final (non-canonicalized) component of a create target, whose
/// `final_path` parent is already canonicalized and jailed.
///
/// `File::create` / `OpenOptions::open` FOLLOW a final-component symlink or
/// reparse point — including a *dangling* one, where the open creates the target
/// at the link's destination. The parent is canonical but the final component is
/// not, so a planted symlink in the share (these servers can't create one
/// themselves) would let a write escape the jail. Inspect the link itself
/// (`symlink_metadata` does not follow): reject any symlink, and for a real
/// existing entry confirm its canonical path stays inside `root`.
fn check_final_component(final_path: &Path, root: &Path) -> Result<(), JailError> {
    if is_sensitive_path(final_path) {
        return Err(JailError::Denied);
    }
    match std::fs::symlink_metadata(final_path) {
        Ok(meta) if meta.file_type().is_symlink() => Err(JailError::Denied),
        Ok(_) => {
            let resolved = final_path.canonicalize().map_err(|_| JailError::Denied)?;
            if !resolved.starts_with(root) || is_sensitive_path(&resolved) {
                return Err(JailError::Denied);
            }
            Ok(())
        }
        Err(_) => Ok(()), // Does not exist yet — fine; the parent is already jailed.
    }
}

/// Resolve a client-supplied path against a canonical `root`, rejecting path
/// traversal (`..`), absolute/UNC/prefixed paths, symlink escapes, and
/// sensitive system locations. `root` MUST already be canonicalized.
///
/// - `must_exist = true` (reads): the target must exist; returns its canonical path.
/// - `must_exist = false` (creates): only the parent directory must exist; the
///   returned path is the parent's canonical path joined with the file name.
///   Use [`resolve_in_root_creating`] instead when missing parents should be
///   created rather than rejected.
///
/// The result is always guaranteed to live under `root`.
pub fn resolve_in_root(
    root: &Path,
    requested: &str,
    must_exist: bool,
) -> Result<PathBuf, JailError> {
    let clean = sanitize_relative(requested)?;
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
        check_final_component(&final_path, root)?;
        Ok(final_path)
    }
}

/// Like `resolve_in_root(_, _, false)` but *creates* missing parent directories
/// instead of failing with [`JailError::NotFound`], so a device can upload to
/// `backups/rtr1/startup.cfg` without the folders existing first.
///
/// Upload-only: callers MUST have already passed their `allow_write` gate.
///
/// Creation order is security-critical: directories are only created after the
/// deepest *existing* ancestor has been canonicalized and confirmed inside
/// `root`, so a junction/symlink planted in the share cannot redirect
/// `create_dir_all` out of the jail. The created parent is then re-canonicalized
/// and re-checked (closing the window where something raced us to that path),
/// and the final component goes through the same symlink guard as
/// [`resolve_in_root`].
pub fn resolve_in_root_creating(root: &Path, requested: &str) -> Result<PathBuf, JailError> {
    let clean = sanitize_relative(requested)?;
    let candidate = root.join(&clean);
    let file_name = candidate
        .file_name()
        .ok_or(JailError::Denied)?
        .to_os_string();
    let parent = candidate.parent().ok_or(JailError::Denied)?;

    // Walk up to the deepest existing ancestor, collecting the components that
    // need creating (innermost first). `clean` holds only `Normal` components,
    // so this terminates at `root` (which exists) at the latest.
    let mut to_create: Vec<OsString> = Vec::new();
    let mut existing = parent;
    while std::fs::symlink_metadata(existing).is_err() {
        let name = existing.file_name().ok_or(JailError::Denied)?;
        to_create.push(name.to_os_string());
        existing = existing.parent().ok_or(JailError::Denied)?;
    }

    let existing_canon = existing.canonicalize().map_err(|_| JailError::Denied)?;
    if !existing_canon.starts_with(root) || is_sensitive_path(&existing_canon) {
        return Err(JailError::Denied);
    }
    // The deepest thing that exists must be a directory to hang the rest off.
    // If it's a file, this upload path is nonsense (`a/f.bin` where `a` is a
    // file) — reject cleanly rather than letting the later create/open fail.
    if !existing_canon.is_dir() {
        return Err(JailError::Denied);
    }

    let parent_resolved = if to_create.is_empty() {
        existing_canon
    } else {
        let mut target = existing_canon;
        for name in to_create.iter().rev() {
            target.push(name);
        }
        if is_sensitive_path(&target) {
            return Err(JailError::Denied);
        }
        std::fs::create_dir_all(&target).map_err(|_| JailError::Denied)?;
        // Newly created components cannot themselves be symlinks, but re-verify
        // the resolved parent in case another actor raced us to the path.
        let resolved = target.canonicalize().map_err(|_| JailError::Denied)?;
        if !resolved.starts_with(root) || is_sensitive_path(&resolved) {
            return Err(JailError::Denied);
        }
        resolved
    };

    let final_path = parent_resolved.join(&file_name);
    check_final_component(&final_path, root)?;
    Ok(final_path)
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

pub fn emit_status(
    app: &AppHandle,
    server_id: &str,
    protocol: &str,
    status: &str,
    message: Option<String>,
) {
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

/// Clamp a network-supplied string (file name, user name) before it reaches a
/// log line or the error banner. Truncates on a char boundary.
pub fn clamp_for_display(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max).collect();
    out.push('…');
    out
}

/// Message for a rejected/failed upload. Both protocols format alike so the
/// pane's error banner reads consistently; `reason` completes the sentence.
pub fn upload_error_msg(protocol: &str, filename: &str, peer: &str, reason: &str) -> String {
    format!(
        "{} upload failed: '{}' from {} — {}",
        protocol.to_uppercase(),
        clamp_for_display(filename, 160),
        peer,
        reason
    )
}

/// Reason text for an upload blocked by the read-only default. Shared so both
/// protocols point the user at the same checkbox.
pub const REASON_UPLOADS_DISABLED: &str =
    "uploads are disabled. Stop the server, tick “Allow uploads (write)”, then start it again.";

// ---------------------------------------------------------------------------
// Error humanization (ADR-005: never surface a raw `os error NNNNN` to the user)
// ---------------------------------------------------------------------------

/// Turn a listener-bind failure into a short, human-readable string. Like the
/// session-layer `humanize_io_error`, this keeps the raw `os error NNNNN` /
/// `(WSAE…)` text out of the pane's error banner and toast.
///
/// `bind` is the `addr:port` we tried to bind (safe to show — the user typed it).
/// `err` is taken as `&dyn Display` because the two servers surface different
/// error types: SFTP a `std::io::Error` from `TcpListener::bind`, TFTP an
/// `async_tftp::Error` that wraps the UDP bind failure. Both render the OS text
/// (with the stable `os error N` code on Windows), so we match on that.
pub fn humanize_bind_error(bind: &str, err: &dyn std::fmt::Display) -> String {
    let lower = err.to_string().to_ascii_lowercase();
    // Port already taken (WSAEADDRINUSE 10048 / EADDRINUSE 98). The most common
    // real failure — another program, or our own server still winding down.
    if lower.contains("os error 10048")
        || lower.contains("os error 98")
        || lower.contains("address already in use")
        || lower.contains("only one usage of each socket address")
    {
        return format!(
            "Port {bind} is already in use — another program (or a still-closing server) holds it"
        );
    }
    // Access denied (WSAEACCES 10013 / EACCES 13) — a reserved/privileged port,
    // or a firewall/policy forbidding the bind.
    if lower.contains("os error 10013")
        || lower.contains("os error 13")
        || lower.contains("forbidden by its access permissions")
        || lower.contains("permission denied")
        || lower.contains("access is denied")
    {
        return format!(
            "Permission denied binding to {bind} — the port may be reserved or need elevation"
        );
    }
    // Address not assignable to this host (WSAEADDRNOTAVAIL 10049 / EADDRNOTAVAIL 99).
    if lower.contains("os error 10049")
        || lower.contains("os error 99")
        || lower.contains("cannot assign requested address")
        || lower.contains("not valid in its context")
    {
        return format!("Cannot bind to {bind} — that address isn't available on this machine");
    }
    format!("Could not start the server on {bind}")
}

/// Turn a file open/create/read/write failure into a short, human-readable
/// reason (used as the `reason` fragment of [`upload_error_msg`] and for
/// download opens). Same ADR-005 intent: no raw `os error NNNNN` in the UI.
pub fn humanize_file_error(err: &std::io::Error) -> String {
    use std::io::ErrorKind;
    match err.kind() {
        ErrorKind::PermissionDenied => "access denied".to_string(),
        ErrorKind::NotFound => "file or folder not found".to_string(),
        _ => {
            let lower = err.to_string().to_ascii_lowercase();
            // Disk full (ERROR_DISK_FULL 112 / ENOSPC 28).
            if lower.contains("os error 112")
                || lower.contains("os error 28")
                || lower.contains("no space left")
                || lower.contains("not enough space")
                || lower.contains("disk is full")
            {
                return "the disk is full".to_string();
            }
            if lower.contains("os error 5")
                || lower.contains("os error 13")
                || lower.contains("access is denied")
                || lower.contains("permission denied")
            {
                return "access denied".to_string();
            }
            "the file could not be written".to_string()
        }
    }
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

/// Why the status is what it is — picks the hint the pane shows next to it.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FirewallReason {
    /// An enabled inbound Block rule matches this program+protocol+port.
    /// Windows applies Block before Allow, so this wins over any allow rule.
    BlockRule,
    /// An allow rule matches the protocol+port but targets a *different*
    /// hotty.exe — typically a dev build's rule while the installed app runs
    /// (firewall rules are per-program, so it grants this app nothing).
    OtherExeRule,
    /// An allow rule exists for this program, but not for the network profile
    /// currently in use (e.g. scoped to Private while the network is Public).
    ProfileMismatch,
    /// Firewall is on, default inbound is block, and nothing matches.
    NoRule,
    /// Every Windows Firewall profile is disabled.
    FwOff,
    /// Windows Firewall is disabled but a third-party firewall is registered,
    /// so what actually happens to inbound traffic is out of our view.
    ThirdPartyFw,
    /// The detection query failed, timed out, or returned something unusable.
    QueryFailed,
}

/// A firewall verdict plus the context the UI needs to explain it.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FirewallReport {
    pub status: FirewallStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<FirewallReason>,
    /// Set with [`FirewallReason::OtherExeRule`]: the program that rule targets.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub other_exe_path: Option<String>,
}

#[cfg_attr(not(windows), allow(dead_code))]
impl FirewallReport {
    fn new(status: FirewallStatus, reason: FirewallReason) -> Self {
        Self {
            status,
            reason: Some(reason),
            other_exe_path: None,
        }
    }

    fn allowed() -> Self {
        Self {
            status: FirewallStatus::Allowed,
            reason: None,
            other_exe_path: None,
        }
    }

    /// Detection didn't produce a usable answer. The UI still offers "Allow
    /// through firewall" on this, so it's a nudge rather than a dead end.
    fn unknown() -> Self {
        Self::new(FirewallStatus::Unknown, FirewallReason::QueryFailed)
    }
}

/// PowerShell that reports firewall state as compact JSON. Reads the program
/// path / protocol / port from environment variables so nothing user- or
/// path-derived is interpolated into the script (no injection surface).
///
/// Only rules for a `hotty.exe` are relevant, and there are only a handful, so
/// we filter the application filters to those and pipe each to
/// `Get-NetFirewallPortFilter` individually. The bulk
/// `Get-NetFirewallPortFilter | join-by-InstanceID` approach is faster but
/// *silently drops rules created by `netsh`* (their port filters don't appear in
/// that enumeration) — which is exactly how our own `firewall_allow` adds them,
/// so it would never see the rule it just wrote. Per-filter piping does see
/// them. Rules whose filters can't be read unprivileged are skipped by
/// `SilentlyContinue` and simply don't match.
#[cfg(windows)]
const FIREWALL_DETECT_SCRIPT: &str = r#"
$ErrorActionPreference='SilentlyContinue'
function Test-PortMatch($lp, [int]$port) {
  foreach ($v in @($lp)) {
    $s = "$v"
    if ($s -eq 'Any') { return $true }
    if ($s -match '^\d+$') { if ([int]$s -eq $port) { return $true } }
    elseif ($s -match '^(\d+)-(\d+)$') {
      if (($port -ge [int]$Matches[1]) -and ($port -le [int]$Matches[2])) { return $true }
    }
  }
  return $false
}
function Test-ProfileMatch($ruleProfile, $active) {
  $p = "$ruleProfile"
  if (($p -eq 'Any') -or ($p -eq '0')) { return $true }
  foreach ($a in $active) { if ($p -match $a) { return $true } }
  return $false
}
try {
  $exe = $env:HOTTY_EXE
  $proto = $env:HOTTY_PROTO
  $port = [int]$env:HOTTY_PORT

  $profs = @(Get-NetFirewallProfile)
  if ($profs.Count -eq 0) { throw 'profile-query-failed' }
  $enabledProfs = @($profs | Where-Object { $_.Enabled -eq $true })
  $profilesOn = $enabledProfs.Count -gt 0

  # Categories of the networks actually connected right now. A rule scoped to a
  # profile we are not on grants nothing. DomainAuthenticated -> Domain.
  $active = @(Get-NetConnectionProfile | ForEach-Object {
    if ("$($_.NetworkCategory)" -like 'Domain*') { 'Domain' } else { "$($_.NetworkCategory)" }
  } | Sort-Object -Unique)
  if ($active.Count -eq 0) { $active = @('Domain','Private','Public') }

  $anyActiveBlock = $false
  foreach ($p in $enabledProfs) {
    if (($active -contains "$($p.Name)") -and ("$($p.DefaultInboundAction)" -ne 'Allow')) { $anyActiveBlock = $true }
  }

  # Only third-party firewalls register here; Windows' own does not.
  $thirdParty = (@(Get-CimInstance -Namespace root/SecurityCenter2 -ClassName FirewallProduct)).Count -gt 0

  $allow = $false; $allowAnyProfile = $false; $blockRule = $false; $otherExe = $null
  $af = @(Get-NetFirewallApplicationFilter | Where-Object { $_.Program -and ($_.Program -match '(?i)hotty\.exe$') })
  foreach ($f in $af) {
    $prog = "$($f.Program)"
    $isOurs = ($prog -ieq $exe)
    foreach ($r in @($f | Get-NetFirewallRule | Where-Object { $_.Direction -eq 'Inbound' -and $_.Enabled -eq 'True' })) {
      $pf = $r | Get-NetFirewallPortFilter
      if (-not $pf) { continue }
      if (-not (("$($pf.Protocol)" -ieq $proto) -or ("$($pf.Protocol)" -eq 'Any'))) { continue }
      if (-not (Test-PortMatch $pf.LocalPort $port)) { continue }
      $profOk = Test-ProfileMatch $r.Profile $active
      if ("$($r.Action)" -eq 'Block') {
        if ($isOurs -and $profOk) { $blockRule = $true }
      } elseif ("$($r.Action)" -eq 'Allow') {
        if ($isOurs) {
          $allowAnyProfile = $true
          if ($profOk) { $allow = $true }
        } elseif ((-not $otherExe) -and $profOk) {
          $otherExe = $prog
        }
      }
    }
  }

  [pscustomobject]@{
    ok=$true; profilesOn=$profilesOn; anyActiveBlock=$anyActiveBlock; thirdParty=$thirdParty;
    allow=$allow; allowAnyProfile=$allowAnyProfile; blockRule=$blockRule; otherExe=$otherExe
  } | ConvertTo-Json -Compress
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

/// Turn [`FIREWALL_DETECT_SCRIPT`]'s JSON into a verdict. Pure, so the precedence
/// below is unit-testable without touching a real firewall.
///
/// The order is load-bearing: Windows evaluates an inbound Block rule ahead of
/// any Allow rule, and a disabled Windows Firewall means nothing if a
/// third-party product took over. Missing fields default to the pessimistic
/// reading so a half-parsed response can't report a false "Allowed".
#[cfg_attr(not(windows), allow(dead_code))]
fn map_detect_json(v: &serde_json::Value) -> FirewallReport {
    let flag = |key: &str, default: bool| v.get(key).and_then(|x| x.as_bool()).unwrap_or(default);

    if !flag("ok", false) {
        return FirewallReport::unknown();
    }
    if !flag("profilesOn", true) {
        return if flag("thirdParty", false) {
            FirewallReport::new(FirewallStatus::Unknown, FirewallReason::ThirdPartyFw)
        } else {
            FirewallReport::new(FirewallStatus::Allowed, FirewallReason::FwOff)
        };
    }
    if flag("blockRule", false) {
        return FirewallReport::new(FirewallStatus::Blocked, FirewallReason::BlockRule);
    }
    if flag("allow", false) {
        return FirewallReport::allowed();
    }
    if !flag("anyActiveBlock", true) {
        // Default inbound action is Allow on every active profile.
        return FirewallReport::allowed();
    }
    if flag("allowAnyProfile", false) {
        return FirewallReport::new(FirewallStatus::Blocked, FirewallReason::ProfileMismatch);
    }
    if let Some(path) = v.get("otherExe").and_then(|x| x.as_str()) {
        if !path.is_empty() {
            let mut report =
                FirewallReport::new(FirewallStatus::Blocked, FirewallReason::OtherExeRule);
            report.other_exe_path = Some(path.to_string());
            return report;
        }
    }
    FirewallReport::new(FirewallStatus::Blocked, FirewallReason::NoRule)
}

/// How long to wait for the detect script. Enumerating every inbound rule takes
/// a few seconds cold; past this we report Unknown rather than hang the pane.
#[cfg(windows)]
const DETECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);

/// Detect whether inbound connections to `port` for `protocol` ("tftp"/"sftp")
/// are allowed by Windows Firewall, and why.
///
/// `protocol` is the logical File Server protocol (`"tftp"`/`"sftp"`); it is
/// mapped to the network protocol (`UDP`/`TCP`) the firewall rule actually
/// carries via [`net_proto`] before matching. Rules are matched against *this*
/// executable — a rule for another hotty.exe (dev build vs installed app)
/// grants this process nothing, and is reported as such.
#[cfg(windows)]
pub async fn firewall_status(protocol: &str, port: u16) -> FirewallReport {
    use tokio::process::Command;

    let exe = match std::env::current_exe() {
        Ok(p) => p.to_string_lossy().to_string(),
        Err(_) => return FirewallReport::unknown(),
    };
    let proto = net_proto(protocol);

    let run = Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            FIREWALL_DETECT_SCRIPT,
        ])
        .env("HOTTY_EXE", &exe)
        .env("HOTTY_PROTO", proto)
        .env("HOTTY_PORT", port.to_string())
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .kill_on_drop(true)
        .output();

    let output = match tokio::time::timeout(DETECT_TIMEOUT, run).await {
        Ok(res) => res,
        Err(_) => {
            log::warn!("file-server: firewall check timed out for {proto} {port}");
            return FirewallReport::unknown();
        }
    };

    let stdout = match output {
        Ok(out) if out.status.success() => String::from_utf8_lossy(&out.stdout).to_string(),
        _ => return FirewallReport::unknown(),
    };

    let parsed: serde_json::Value = match serde_json::from_str(stdout.trim()) {
        Ok(v) => v,
        Err(_) => return FirewallReport::unknown(),
    };

    let report = map_detect_json(&parsed);
    log::debug!(
        "file-server: firewall check exe={exe} proto={proto} port={port} -> {report:?} (raw {parsed})"
    );
    report
}

#[cfg(not(windows))]
pub async fn firewall_status(_protocol: &str, _port: u16) -> FirewallReport {
    FirewallReport {
        status: FirewallStatus::NotApplicable,
        reason: None,
        other_exe_path: None,
    }
}

/// The `cmd /c` command line run elevated to add our inbound allow rule.
///
/// This deliberately uses `netsh advfirewall firewall` — the stock Windows
/// firewall CLI — rather than a base64-encoded elevated PowerShell that
/// enumerates and deletes rules with a regex. That earlier shape (obfuscated
/// elevated command + rule-deletion loop) is indistinguishable from malware to
/// Defender's behavior monitor, which quarantined the app over it. A plain
/// `netsh` add stays legible to AMSI and is the ordinary way to add a rule.
///
/// We first delete our own same-named rule so re-runs don't stack duplicates;
/// the `&` (not `&&`) means a missing rule to delete doesn't stop the add. Every
/// value is double-quoted — a Windows path can't contain a literal `"`, so the
/// quoting can't be broken, and any `&` inside a quoted value is literal to cmd.
/// `proto` is a `net_proto` literal, `port` a `u16`; only `exe` is external, and
/// it is validated quote-free by the caller.
#[cfg(windows)]
fn netsh_add_rule_cmdline(exe: &str, proto: &str, port: u16) -> String {
    let name = format!("HoTTY File Server ({proto} {port})");
    // Call netsh by full path so this doesn't depend on `%PATH%` (and so the
    // binary being run is unambiguous). `%SystemRoot%` is expanded by cmd.
    let netsh = r"%SystemRoot%\System32\netsh.exe";
    format!(
        "/c {netsh} advfirewall firewall delete rule name=\"{name}\" >nul 2>&1 & \
         {netsh} advfirewall firewall add rule name=\"{name}\" dir=in action=allow \
         program=\"{exe}\" protocol={proto} localport={port} enable=yes profile=any"
    )
}

/// Add an inbound allow rule for this program (scoped to protocol+port) by
/// elevating `netsh` once (one UAC prompt). Re-runs replace our own same-named
/// rule rather than stacking duplicates.
///
/// Unlike the previous implementation this touches only the rule named
/// `HoTTY File Server (<proto> <port>)` and does no cross-rule cleanup, so a
/// stale rule for another HoTTY build (dev vs installed) is left in place — it
/// is harmless, and the detection surfaces it as `otherExeRule` instead.
#[cfg(windows)]
pub async fn firewall_allow(protocol: &str, port: u16) -> Result<(), String> {
    use tokio::process::Command;

    let exe = std::env::current_exe()
        .map_err(|e| format!("Cannot resolve program path: {e}"))?
        .to_string_lossy()
        .to_string();
    // The command line quotes the path with `"`; a Windows path can't contain
    // one, but guard anyway so a surprising path can't break out of the quotes.
    if exe.contains('"') {
        return Err("Program path contains an unsupported character".into());
    }
    let proto = net_proto(protocol);
    log::debug!("file-server: adding firewall rule program={exe} proto={proto} port={port}");

    // Elevate cmd (which runs netsh) via Start-Process -Verb RunAs. PowerShell
    // is only the launcher here; the elevated child is cmd/netsh, and the whole
    // command line is a single-quoted PowerShell literal (escape any `'`).
    let cmdline = netsh_add_rule_cmdline(&exe, proto, port);
    let cmdline_ps = cmdline.replace('\'', "''");
    let outer = format!(
        "Start-Process cmd -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList '{cmdline_ps}'"
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
        assert_eq!(
            resolve_in_root(&root, "../secret", true),
            Err(JailError::Denied)
        );
        assert_eq!(
            resolve_in_root(&root, "a/../../b", true),
            Err(JailError::Denied)
        );
        assert_eq!(
            resolve_in_root(&root, "/../x", true),
            Err(JailError::Denied)
        );
    }

    #[cfg(windows)]
    #[test]
    fn rejects_windows_absolute_and_unc() {
        let root = temp_root("winabs");
        assert_eq!(
            resolve_in_root(&root, r"C:\Windows\System32\cmd.exe", true),
            Err(JailError::Denied)
        );
        assert_eq!(
            resolve_in_root(&root, r"\\server\share\x", true),
            Err(JailError::Denied)
        );
    }

    #[test]
    fn rejects_empty() {
        let root = temp_root("empty");
        assert_eq!(resolve_in_root(&root, "", true), Err(JailError::Denied));
    }

    #[test]
    fn missing_file_is_not_found() {
        let root = temp_root("missing");
        assert_eq!(
            resolve_in_root(&root, "nope.bin", true),
            Err(JailError::NotFound)
        );
    }

    #[test]
    fn create_resolves_within_root() {
        let root = temp_root("create");
        let p = resolve_in_root(&root, "upload.bin", false).unwrap();
        assert!(p.starts_with(&root));
        assert!(p.ends_with("upload.bin"));
    }

    #[test]
    fn create_without_parent_is_not_found() {
        // The behavior `resolve_in_root_creating` exists to relax: a device
        // uploading to a subdirectory that doesn't exist yet.
        let root = temp_root("create_no_parent");
        assert_eq!(
            resolve_in_root(&root, "configs/rtr1.cfg", false),
            Err(JailError::NotFound)
        );
    }

    // -- resolve_in_root_creating -----------------------------------------

    #[test]
    fn creating_makes_single_missing_dir() {
        let root = temp_root("creating_single");
        let p = resolve_in_root_creating(&root, "configs/rtr1.cfg").unwrap();
        assert!(p.starts_with(&root));
        assert!(p.ends_with("rtr1.cfg"));
        assert!(root.join("configs").is_dir());
        assert!(!p.exists(), "only the parent is created, not the file");
    }

    #[test]
    fn creating_makes_nested_dirs() {
        let root = temp_root("creating_nested");
        let p = resolve_in_root_creating(&root, "a/b/c/f.bin").unwrap();
        assert!(p.starts_with(&root));
        assert!(root.join("a").join("b").join("c").is_dir());
    }

    #[test]
    fn creating_accepts_backslash_paths() {
        // TFTP clients on network gear commonly send Windows-style separators.
        let root = temp_root("creating_backslash");
        let p = resolve_in_root_creating(&root, r"backups\site1\startup.cfg").unwrap();
        assert!(p.starts_with(&root));
        assert!(root.join("backups").join("site1").is_dir());
    }

    #[test]
    fn creating_matches_resolve_in_root_when_parent_exists() {
        let root = temp_root("creating_existing");
        let expected = resolve_in_root(&root, "upload.bin", false).unwrap();
        let actual = resolve_in_root_creating(&root, "upload.bin").unwrap();
        assert_eq!(expected, actual);
    }

    #[test]
    fn creating_rejects_traversal_and_empty() {
        let root = temp_root("creating_traverse");
        for bad in ["../secret", "a/../../b", "", "/"] {
            assert_eq!(
                resolve_in_root_creating(&root, bad),
                Err(JailError::Denied),
                "should reject {bad:?}"
            );
        }
        assert!(!root.parent().unwrap().join("secret").exists());
    }

    #[test]
    fn creating_rejects_when_parent_is_a_file() {
        let root = temp_root("creating_parent_file");
        fs::write(root.join("notadir"), b"x").unwrap();
        assert_eq!(
            resolve_in_root_creating(&root, "notadir/f.bin"),
            Err(JailError::Denied)
        );
    }

    #[cfg(windows)]
    #[test]
    fn creating_rejects_junction_escape() {
        // A junction planted inside the share must not let create_dir_all (or
        // the subsequent write) land outside the served root. Junctions need no
        // admin rights, unlike symlinks — hence `mklink /J`.
        let root = temp_root("creating_junction");
        let outside = temp_root("creating_junction_outside");
        let link = root.join("jump");
        let status = std::process::Command::new("cmd")
            .args(["/c", "mklink", "/J"])
            .arg(&link)
            .arg(&outside)
            .status();
        match status {
            Ok(s) if s.success() => {}
            _ => {
                eprintln!("skipping: could not create a junction");
                return;
            }
        }
        assert_eq!(
            resolve_in_root_creating(&root, "jump/sub/f.bin"),
            Err(JailError::Denied)
        );
        assert!(
            !outside.join("sub").exists(),
            "nothing may be created outside the root"
        );
        // A direct write through the junction is refused too.
        assert_eq!(
            resolve_in_root_creating(&root, "jump/f.bin"),
            Err(JailError::Denied)
        );
    }

    // -- display helpers ---------------------------------------------------

    #[test]
    fn clamp_for_display_truncates_on_char_boundary() {
        assert_eq!(clamp_for_display("short", 10), "short");
        assert_eq!(clamp_for_display("abcdef", 3), "abc…");
        // Multi-byte input must not panic or split a char.
        assert_eq!(clamp_for_display("日本語テスト", 3), "日本語…");
    }

    #[test]
    fn upload_error_msg_names_file_peer_and_reason() {
        let msg = upload_error_msg("tftp", "rtr1.cfg", "10.0.0.5:5000", REASON_UPLOADS_DISABLED);
        assert!(msg.starts_with("TFTP upload failed: 'rtr1.cfg' from 10.0.0.5:5000"));
        assert!(msg.contains("Allow uploads"));
    }

    // -- error humanization (ADR-005) --------------------------------------

    #[test]
    fn humanize_bind_error_labels_common_causes() {
        // Windows (WSAE* with a stable os-error code) and POSIX phrasings both
        // reduce to the same short label — no raw "os error NNNNN" leaks out.
        let in_use = std::io::Error::new(
            std::io::ErrorKind::AddrInUse,
            "Only one usage of each socket address (protocol/network address/port) is normally permitted. (os error 10048)",
        );
        let msg = humanize_bind_error("0.0.0.0:69", &in_use);
        assert!(msg.contains("already in use"), "got: {msg}");
        assert!(!msg.contains("os error"), "raw OS code leaked: {msg}");
        assert!(msg.contains("0.0.0.0:69"));

        let denied = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "os error 10013");
        assert!(humanize_bind_error("0.0.0.0:69", &denied).contains("Permission denied"));

        let notavail = std::io::Error::new(std::io::ErrorKind::AddrNotAvailable, "os error 10049");
        assert!(humanize_bind_error("10.9.9.9:69", &notavail).contains("isn't available"));
    }

    #[test]
    fn humanize_bind_error_falls_back_without_raw_text() {
        let weird = std::io::Error::other("something inscrutable (os error 424242)");
        let msg = humanize_bind_error("0.0.0.0:2222", &weird);
        assert!(!msg.contains("os error"), "raw OS code leaked: {msg}");
        assert!(msg.contains("0.0.0.0:2222"));
    }

    #[tokio::test]
    async fn stop_servers_for_window_stops_only_that_windows_servers() {
        let tftp = Arc::new(Mutex::new(HashMap::new()));
        let sftp = Arc::new(Mutex::new(HashMap::new()));
        // A ServerHandle whose task simply parks until cancelled — so stop_handle's
        // cancel → join completes immediately (no 2s timeout).
        let mk = |label: &str| {
            let cancel = CancellationToken::new();
            let child = cancel.clone();
            let join = tokio::spawn(async move { child.cancelled().await });
            ServerHandle {
                cancel,
                join,
                window_label: label.to_string(),
            }
        };
        tftp.lock()
            .await
            .insert("win-a::1".to_string(), mk("win-a"));
        tftp.lock()
            .await
            .insert("win-b::1".to_string(), mk("win-b"));
        sftp.lock()
            .await
            .insert("win-a::2".to_string(), mk("win-a"));

        stop_servers_for_window(&tftp, &sftp, "win-a").await;

        // Only win-a's servers were stopped; win-b's is untouched.
        assert!(!tftp.lock().await.contains_key("win-a::1"));
        assert!(tftp.lock().await.contains_key("win-b::1"));
        assert!(!sftp.lock().await.contains_key("win-a::2"));
    }

    #[test]
    fn humanize_file_error_maps_kinds_and_hides_raw() {
        assert_eq!(
            humanize_file_error(&std::io::Error::from(std::io::ErrorKind::PermissionDenied)),
            "access denied"
        );
        assert_eq!(
            humanize_file_error(&std::io::Error::from(std::io::ErrorKind::NotFound)),
            "file or folder not found"
        );
        let full = std::io::Error::other("There is not enough space on the disk. (os error 112)");
        assert_eq!(humanize_file_error(&full), "the disk is full");
        let other = std::io::Error::other("gremlins (os error 999)");
        let msg = humanize_file_error(&other);
        assert!(!msg.contains("os error"), "raw OS code leaked: {msg}");
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
        assert_eq!(
            serde_json::to_value(FirewallStatus::Blocked).unwrap(),
            "blocked"
        );
        assert_eq!(
            serde_json::to_value(FirewallStatus::NotApplicable).unwrap(),
            "notApplicable"
        );
    }

    // -- firewall detection mapping ----------------------------------------

    /// A detect payload where everything is fine, so each test can flip exactly
    /// the one field it is about.
    fn detect(overrides: serde_json::Value) -> serde_json::Value {
        let mut base = serde_json::json!({
            "ok": true,
            "profilesOn": true,
            "anyActiveBlock": true,
            "thirdParty": false,
            "allow": false,
            "allowAnyProfile": false,
            "blockRule": false,
            "otherExe": null,
        });
        for (k, v) in overrides.as_object().unwrap() {
            base[k] = v.clone();
        }
        base
    }

    #[test]
    fn detect_query_failure_is_unknown() {
        let r = map_detect_json(&serde_json::json!({"ok": false}));
        assert_eq!(r.status, FirewallStatus::Unknown);
        assert_eq!(r.reason, Some(FirewallReason::QueryFailed));
    }

    #[test]
    fn detect_missing_fields_never_report_allowed() {
        // A half-parsed response must not read as "Allowed" — the pessimistic
        // defaults make it Blocked/NoRule instead.
        let r = map_detect_json(&serde_json::json!({"ok": true}));
        assert_eq!(r.status, FirewallStatus::Blocked);
        assert_eq!(r.reason, Some(FirewallReason::NoRule));
    }

    #[test]
    fn detect_allow_rule_is_allowed() {
        let r = map_detect_json(&detect(serde_json::json!({"allow": true})));
        assert_eq!(r.status, FirewallStatus::Allowed);
        assert_eq!(r.reason, None);
    }

    #[test]
    fn detect_block_rule_beats_allow_rule() {
        // Windows evaluates inbound Block ahead of Allow; the mapping must too.
        let r = map_detect_json(&detect(
            serde_json::json!({"allow": true, "blockRule": true}),
        ));
        assert_eq!(r.status, FirewallStatus::Blocked);
        assert_eq!(r.reason, Some(FirewallReason::BlockRule));
    }

    #[test]
    fn detect_firewall_off_is_allowed() {
        let r = map_detect_json(&detect(serde_json::json!({"profilesOn": false})));
        assert_eq!(r.status, FirewallStatus::Allowed);
        assert_eq!(r.reason, Some(FirewallReason::FwOff));
    }

    #[test]
    fn detect_third_party_firewall_is_unknown_not_allowed() {
        // Windows FW disabled *because another product took over* tells us
        // nothing about inbound traffic — the old code called this Allowed.
        let r = map_detect_json(&detect(
            serde_json::json!({"profilesOn": false, "thirdParty": true}),
        ));
        assert_eq!(r.status, FirewallStatus::Unknown);
        assert_eq!(r.reason, Some(FirewallReason::ThirdPartyFw));
    }

    #[test]
    fn detect_default_inbound_allow_is_allowed() {
        let r = map_detect_json(&detect(serde_json::json!({"anyActiveBlock": false})));
        assert_eq!(r.status, FirewallStatus::Allowed);
        assert_eq!(r.reason, None);
    }

    #[test]
    fn detect_profile_mismatch_is_blocked() {
        let r = map_detect_json(&detect(serde_json::json!({"allowAnyProfile": true})));
        assert_eq!(r.status, FirewallStatus::Blocked);
        assert_eq!(r.reason, Some(FirewallReason::ProfileMismatch));
    }

    #[test]
    fn detect_other_exe_rule_reports_the_path() {
        // The dev-build-vs-installed trap: a rule exists for the port, but for
        // another hotty.exe, so this process gets nothing from it.
        let r = map_detect_json(&detect(serde_json::json!({
            "otherExe": r"C:\dev\HoTTY\src-tauri\target\debug\hotty.exe"
        })));
        assert_eq!(r.status, FirewallStatus::Blocked);
        assert_eq!(r.reason, Some(FirewallReason::OtherExeRule));
        assert_eq!(
            r.other_exe_path.as_deref(),
            Some(r"C:\dev\HoTTY\src-tauri\target\debug\hotty.exe")
        );
    }

    #[test]
    fn detect_our_own_allow_rule_wins_over_other_exe() {
        let r = map_detect_json(&detect(serde_json::json!({
            "allow": true,
            "otherExe": r"C:\dev\hotty.exe"
        })));
        assert_eq!(r.status, FirewallStatus::Allowed);
    }

    #[test]
    fn detect_no_rule_is_blocked() {
        let r = map_detect_json(&detect(serde_json::json!({})));
        assert_eq!(r.status, FirewallStatus::Blocked);
        assert_eq!(r.reason, Some(FirewallReason::NoRule));
    }

    #[test]
    fn firewall_report_serializes_camel_case() {
        let mut report = FirewallReport::new(FirewallStatus::Blocked, FirewallReason::OtherExeRule);
        report.other_exe_path = Some(r"C:\dev\hotty.exe".into());
        let json = serde_json::to_value(&report).unwrap();
        assert_eq!(json["status"], "blocked");
        assert_eq!(json["reason"], "otherExeRule");
        assert_eq!(json["otherExePath"], r"C:\dev\hotty.exe");
    }

    #[test]
    fn firewall_report_omits_empty_optionals() {
        let json = serde_json::to_value(FirewallReport::allowed()).unwrap();
        assert_eq!(json["status"], "allowed");
        assert!(json.get("reason").is_none());
        assert!(json.get("otherExePath").is_none());
    }

    #[cfg(windows)]
    #[test]
    fn netsh_cmdline_deletes_then_adds_named_rule() {
        let line = netsh_add_rule_cmdline(r"C:\Program Files\HoTTY\hotty.exe", "UDP", 69);
        // cmd /c, delete-before-add on a single `&` chain (not `&&`).
        assert!(line
            .starts_with(r"/c %SystemRoot%\System32\netsh.exe advfirewall firewall delete rule"));
        assert!(line.contains(r#"name="HoTTY File Server (UDP 69)""#));
        assert!(line.contains(r" & %SystemRoot%\System32\netsh.exe advfirewall firewall add rule"));
        assert!(line.contains(r#"program="C:\Program Files\HoTTY\hotty.exe""#));
        assert!(line.contains("protocol=UDP"));
        assert!(line.contains("localport=69"));
        assert!(line.contains("action=allow"));
        assert!(line.contains("profile=any"));
        // No base64 / PowerShell rule-enumeration — the shape Defender flagged.
        assert!(!line.contains("EncodedCommand"));
        assert!(!line.to_lowercase().contains("remove-netfirewallrule"));
    }

    #[cfg(windows)]
    #[test]
    fn netsh_cmdline_uses_tcp_for_sftp_port() {
        let line = netsh_add_rule_cmdline(r"C:\a\hotty.exe", "TCP", 2222);
        assert!(line.contains(r#"name="HoTTY File Server (TCP 2222)""#));
        assert!(line.contains("protocol=TCP"));
        assert!(line.contains("localport=2222"));
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
