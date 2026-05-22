use async_trait::async_trait;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use regex_lite::Regex;
use serde::Deserialize;
use std::io::{Read as IoRead, Write as IoWrite};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::net::TcpStream;
use tokio::process::{Child, Command as TokioCommand};
use tokio::sync::{mpsc, Mutex};
use tokio::task::JoinHandle;
use tokio::time::{timeout, MissedTickBehavior};

use super::iap_tunnel::{
    self, decide_preconnect_action, gcloud_program, is_valid_instance, is_valid_project,
    is_valid_zone, InstanceStatus, PreConnectAction, WaitEvent,
};
use super::session_service::{
    emit_session_data, emit_session_error, emit_session_status, encoding_for, SessionError,
    SessionService,
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GcloudIapConfig {
    pub project: String,
    pub zone: String,
    pub instance: String,

    #[serde(default = "default_encoding")]
    pub encoding: String,

    /// When the target VM is stopped, automatically issue `gcloud compute instances start`
    /// without prompting. When false (default), the backend emits an `iap-vm-start-prompt`
    /// event and waits for the user to approve or decline.
    #[serde(default)]
    pub auto_start: bool,
}

fn default_encoding() -> String {
    "utf8".to_string()
}

impl GcloudIapConfig {
    pub fn validate(&self) -> Result<(), SessionError> {
        if !is_valid_project(&self.project) {
            return Err(SessionError::InvalidConfig(format!(
                "invalid GCP project ID: {}",
                self.project
            )));
        }
        if !is_valid_zone(&self.zone) {
            return Err(SessionError::InvalidConfig(format!(
                "invalid GCP zone: {}",
                self.zone
            )));
        }
        if !is_valid_instance(&self.instance) {
            return Err(SessionError::InvalidConfig(format!(
                "invalid GCE instance name: {}",
                self.instance
            )));
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Constants for the IAP-tunnel + OpenSSH flow
// ---------------------------------------------------------------------------

/// SSH key file path under the user's home, mirroring what `gcloud compute ssh`
/// generates so we can reuse the same key gcloud already pushed to the
/// instance/OS Login during any prior interactive `gcloud compute ssh` run.
const GCLOUD_KEY_FILENAME: &str = "google_compute_engine";

/// How long to wait for `start-iap-tunnel` to print its "Listening on port"
/// line before giving up. The IAP backend handshake plus the "Testing if
/// tunnel connection works." probe can easily take 30s+ on slow networks, so
/// the budget needs headroom past gcloud's own internal timeouts.
const TUNNEL_READY_TIMEOUT: Duration = Duration::from_secs(60);

/// Stdout patterns gcloud uses when reporting that the tunnel is *actually
/// listening* on a local port. Used as a fast-path readiness signal — but
/// in practice gcloud's Python stderr is block-buffered when redirected to
/// a pipe, so this line often gets stuck in the buffer and never reaches
/// us. The TCP probe (see `pick_port_regex` / `can_tcp_connect_localhost`)
/// is the actual workhorse.
fn tunnel_port_regexes() -> &'static [Regex] {
    use std::sync::OnceLock;
    static RES: OnceLock<Vec<Regex>> = OnceLock::new();
    RES.get_or_init(|| {
        vec![
            // Modern: "Listening on port [12345]."
            Regex::new(r"Listening on port \[(\d+)\]").unwrap(),
            // Older: "Listening on 127.0.0.1:12345"
            Regex::new(r"Listening on (?:127\.0\.0\.1|localhost):(\d+)").unwrap(),
        ]
    })
}

/// Extracts the local port from gcloud's "Picking local unused port [N]." line.
/// This line *does* reach us reliably (it's part of a multi-line burst that
/// includes the NumPy warning, so the buffer flushes). The port number it
/// reveals is the one MakeSocket() is about to listen on a few ms later, so
/// once we see it we can directly TCP-probe the listener.
fn pick_port_regex() -> &'static Regex {
    use std::sync::OnceLock;
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"Picking local unused port \[(\d+)\]").unwrap())
}

/// Best-effort TCP connect to localhost:port with a short deadline. Returns
/// true iff the connection completes (kernel accepts SYN-ACK). Used to detect
/// when gcloud's IAP tunnel listener becomes available, independent of
/// gcloud's stderr buffering.
async fn can_tcp_connect_localhost(port: u16) -> bool {
    matches!(
        tokio::time::timeout(
            Duration::from_millis(500),
            TcpStream::connect(("127.0.0.1", port)),
        )
        .await,
        Ok(Ok(_))
    )
}

// ---------------------------------------------------------------------------
// Environment variable sanitization
//
// Mirrors local.rs's policy: drop variables whose names look credential-bearing
// before passing the environment to the child. PATH/USERPROFILE/APPDATA/
// LOCALAPPDATA are retained because gcloud reads its auth config from %APPDATA%
// and locates its bundled python via PATH.
// ---------------------------------------------------------------------------

const SENSITIVE_PATTERNS: &[&str] = &[
    "API_KEY",
    "SECRET",
    "TOKEN",
    "PASSWORD",
    "PASSWD",
    "CREDENTIAL",
    "PRIVATE_KEY",
    "ACCESS_KEY",
];

fn is_sensitive_env_var(name: &str) -> bool {
    let upper = name.to_ascii_uppercase();
    SENSITIVE_PATTERNS.iter().any(|pat| upper.contains(pat))
}

fn sanitized_env() -> Vec<(String, String)> {
    std::env::vars()
        .filter(|(k, _)| !is_sensitive_env_var(k))
        .collect()
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

fn ssh_key_paths() -> Option<(PathBuf, PathBuf)> {
    let home = home_dir()?;
    let priv_path = home.join(".ssh").join(GCLOUD_KEY_FILENAME);
    let pub_path = home.join(".ssh").join(format!("{GCLOUD_KEY_FILENAME}.pub"));
    Some((priv_path, pub_path))
}

/// Locate the Windows OpenSSH client (`ssh.exe`). Prefers
/// `C:\Windows\System32\OpenSSH\ssh.exe` which Windows 10/11 ships by default.
/// Falls back to anything named `ssh.exe` (or `ssh` on Unix) found on PATH.
fn find_openssh_path() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let candidates: [&str; 2] = [
            r"C:\Windows\System32\OpenSSH\ssh.exe",
            r"C:\Windows\Sysnative\OpenSSH\ssh.exe",
        ];
        for c in &candidates {
            let p = PathBuf::from(c);
            if p.exists() {
                return Some(p);
            }
        }
        // Fallback: search PATH.
        if let Ok(path_var) = std::env::var("PATH") {
            for dir in path_var.split(';') {
                let p = PathBuf::from(dir).join("ssh.exe");
                if p.exists() {
                    return Some(p);
                }
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(path_var) = std::env::var("PATH") {
            for dir in path_var.split(':') {
                let p = PathBuf::from(dir).join("ssh");
                if p.exists() {
                    return Some(p);
                }
            }
        }
    }
    None
}

fn find_ssh_keygen_path() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let candidates: [&str; 2] = [
            r"C:\Windows\System32\OpenSSH\ssh-keygen.exe",
            r"C:\Windows\Sysnative\OpenSSH\ssh-keygen.exe",
        ];
        for c in &candidates {
            let p = PathBuf::from(c);
            if p.exists() {
                return Some(p);
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(path_var) = std::env::var("PATH") {
            for dir in path_var.split(':') {
                let p = PathBuf::from(dir).join("ssh-keygen");
                if p.exists() {
                    return Some(p);
                }
            }
        }
    }
    None
}

// ---------------------------------------------------------------------------
// gcloud command runners (long-lived & one-shot)
// ---------------------------------------------------------------------------

/// Build a `tokio::process::Command` for invoking gcloud with the given args.
///
/// On Windows the wrapper is `gcloud.cmd`. We do NOT wrap it in `cmd /C`
/// ourselves because cmd's rule "if there are 3+ `"` characters on the command
/// line, strip the outermost pair" breaks the path quoting whenever an arg
/// contains an embedded `"` (e.g. the `--format=value("...")` filter exprs in
/// `is_oslogin_enabled`). Rust's standard library detects the `.cmd` extension
/// and invokes cmd.exe with BatBadBut-safe escaping (since Rust 1.77.2), so
/// passing the path directly to `Command::new` is both safer and simpler. The
/// `_use_shell` flag returned by `gcloud_program()` is retained only for
/// signature compatibility.
fn build_gcloud_command(args: &[String]) -> TokioCommand {
    let (program, _use_shell) = gcloud_program();
    let mut cmd = TokioCommand::new(&program);
    cmd.args(args);
    #[cfg(target_os = "windows")]
    {
        // tokio::process::Command exposes creation_flags as an inherent method
        // on Windows; no CommandExt import needed.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    // Inherit a sanitized environment so gcloud can find its bundled python
    // and read %APPDATA%/gcloud for auth.
    cmd.env_clear();
    for (k, v) in sanitized_env() {
        cmd.env(k, v);
    }
    cmd
}

/// Run a short-lived gcloud invocation and collect its stdout.
///
/// Logs at info level so failures (and total elapsed time) of auxiliary gcloud
/// calls (OS Login lookup, metadata describe, …) are visible in release-mode
/// log files — these calls happen BEFORE the tunnel-startup phase, so when an
/// IAP connect hangs we need to know which of them is responsible.
async fn run_gcloud_capture(args: &[String], deadline: Duration) -> Result<String, SessionError> {
    let started = std::time::Instant::now();
    let pretty_args = args.join(" ");
    log::info!("gcloud-iap: run_gcloud_capture begin: gcloud {pretty_args}");

    let mut cmd = build_gcloud_command(args);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    let output = timeout(deadline, cmd.output())
        .await
        .map_err(|_| {
            log::error!(
                "gcloud-iap: run_gcloud_capture TIMED OUT after {:?}: gcloud {pretty_args}",
                started.elapsed()
            );
            SessionError::ConnectionFailed("gcloud command timed out".into())
        })?
        .map_err(|e| {
            log::error!(
                "gcloud-iap: run_gcloud_capture spawn failed after {:?}: {e} (args: gcloud {pretty_args})",
                started.elapsed()
            );
            SessionError::ConnectionFailed(format!("failed to run gcloud: {e}"))
        })?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::warn!(
            "gcloud-iap: run_gcloud_capture exited {} after {:?}: stderr={} (args: gcloud {pretty_args})",
            output.status,
            started.elapsed(),
            stderr.trim()
        );
        return Err(SessionError::ConnectionFailed(format!(
            "gcloud exited with {}: {}",
            output.status,
            stderr.trim()
        )));
    }
    log::info!(
        "gcloud-iap: run_gcloud_capture ok in {:?}: gcloud {pretty_args}",
        started.elapsed()
    );
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Read the `enable-oslogin` metadata flag from project or instance scope.
/// Returns `true` only when explicitly set to TRUE; missing or any other value
/// counts as not-enabled. Returns `Some(true)` / `Some(false)` when the
/// metadata read succeeds (TRUE / FALSE / empty respectively), and `None`
/// when *both* the instance and project describe calls fail (auth, network,
/// or insufficient `compute.instances.get` / `compute.projects.get`
/// permissions). Callers should treat `None` as "unknown" and still attempt
/// `resolve_oslogin_username()` — orgs using OS Login almost always grant
/// a POSIX profile to the active gcloud account, so resolving succeeds even
/// when metadata reads don't.
///
/// Per Google's resolution order, the **instance** metadata value (if any)
/// overrides the project metadata value. We honor that here.
async fn is_oslogin_enabled(project: &str, zone: &str, instance: &str) -> Option<bool> {
    // 1. Instance metadata (highest priority)
    let inst_args = vec![
        "compute".to_string(),
        "instances".to_string(),
        "describe".to_string(),
        instance.to_string(),
        format!("--zone={zone}"),
        format!("--project={project}"),
        "--format=value(metadata.items.filter(\"key:enable-oslogin\").extract(\"value\").flatten())"
            .to_string(),
    ];
    let inst_result = run_gcloud_capture(&inst_args, Duration::from_secs(10)).await;
    if let Ok(out) = &inst_result {
        let v = out.trim();
        if !v.is_empty() {
            return Some(v.eq_ignore_ascii_case("TRUE"));
        }
        // Empty stdout = no enable-oslogin key on the instance; fall through
        // to project metadata.
    }
    // 2. Project metadata (fallback)
    let proj_args = vec![
        "compute".to_string(),
        "project-info".to_string(),
        "describe".to_string(),
        format!("--project={project}"),
        "--format=value(commonInstanceMetadata.items.filter(\"key:enable-oslogin\").extract(\"value\").flatten())"
            .to_string(),
    ];
    match run_gcloud_capture(&proj_args, Duration::from_secs(10)).await {
        Ok(out) => Some(out.trim().eq_ignore_ascii_case("TRUE")),
        Err(_) => {
            // Both describes failed. If the instance describe also failed (not
            // just empty), we have no signal at all — return None.
            if inst_result.is_err() { None } else { Some(false) }
        }
    }
}

/// Look up the active gcloud account's OS Login POSIX username. Only meaningful
/// if `is_oslogin_enabled` already returned true. Returns None on any failure
/// (callers must fall back to the local Windows username).
async fn resolve_oslogin_username() -> Option<String> {
    let args = vec![
        "compute".to_string(),
        "os-login".to_string(),
        "describe-profile".to_string(),
        "--format=value(posixAccounts[0].username)".to_string(),
    ];
    match run_gcloud_capture(&args, Duration::from_secs(10)).await {
        Ok(out) => {
            let trimmed = out.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        }
        Err(_) => None,
    }
}

fn fallback_local_username() -> String {
    std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_else(|_| "user".to_string())
}

// ---------------------------------------------------------------------------
// SSH keypair management
// ---------------------------------------------------------------------------

/// Ensure `~/.ssh/google_compute_engine` exists. If not, generate one with
/// `ssh-keygen` (ed25519, no passphrase) so subsequent `ssh.exe` invocations
/// have something to authenticate with. The generated public key still needs
/// to be registered on the project/instance — we lean on `gcloud compute ssh`
/// elsewhere or `gcloud compute os-login ssh-keys add` to do that.
async fn ensure_ssh_key() -> Result<(PathBuf, bool), SessionError> {
    let (priv_path, pub_path) = ssh_key_paths()
        .ok_or_else(|| SessionError::ConnectionFailed("HOME / USERPROFILE not set".into()))?;
    if priv_path.exists() && pub_path.exists() {
        return Ok((priv_path, false));
    }
    let ssh_dir = priv_path
        .parent()
        .ok_or_else(|| SessionError::ConnectionFailed("invalid SSH key path".into()))?;
    if !ssh_dir.exists() {
        std::fs::create_dir_all(ssh_dir).map_err(|e| {
            SessionError::ConnectionFailed(format!("failed to create ~/.ssh: {e}"))
        })?;
    }
    let keygen = find_ssh_keygen_path().ok_or_else(|| {
        SessionError::ConnectionFailed(
            "ssh-keygen not found. Install Windows OpenSSH Client feature.".into(),
        )
    })?;
    let priv_str = priv_path
        .to_str()
        .ok_or_else(|| SessionError::ConnectionFailed("non-UTF8 path".into()))?;
    let mut cmd = TokioCommand::new(&keygen);
    cmd.args(["-t", "ed25519", "-N", "", "-f", priv_str, "-q"]);
    #[cfg(target_os = "windows")]
    {
        // tokio::process::Command exposes creation_flags as an inherent method
        // on Windows; no CommandExt import needed.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let output = timeout(Duration::from_secs(30), cmd.output())
        .await
        .map_err(|_| SessionError::ConnectionFailed("ssh-keygen timed out".into()))?
        .map_err(|e| SessionError::ConnectionFailed(format!("ssh-keygen spawn failed: {e}")))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(SessionError::ConnectionFailed(format!(
            "ssh-keygen failed: {}",
            stderr.trim()
        )));
    }
    Ok((priv_path, true))
}

/// On Windows, repair the NTFS ACL on the private key file so Windows OpenSSH
/// will accept it. The ACL gcloud (and ssh-keygen) leave behind often inherits
/// an `OWNER RIGHTS` ACE from the parent directory — which OpenSSH refuses
/// because it isn't in the (owner, BUILTIN\Administrators, NT AUTHORITY\SYSTEM)
/// whitelist. The user then sees:
///     Permissions for '...\google_compute_engine' are too open.
///     This private key will be ignored.
///
/// We use `icacls` to strip inheritance and explicitly grant only the current
/// user. SYSTEM/Administrators access is acceptable to OpenSSH and useful for
/// other tools, so we leave the path quiet about those — `icacls /inheritance:r`
/// removes inherited ACEs but our subsequent /grant:r only sets the user, so
/// the resulting ACL is `<user>:F` only. That is the most conservative form
/// and matches what `ssh-keygen` produces on Windows when run interactively.
///
/// Idempotent: re-running is safe even if the ACL is already correct.
#[cfg(target_os = "windows")]
async fn ensure_key_permissions(priv_path: &Path) -> Result<(), SessionError> {
    let path_str = priv_path
        .to_str()
        .ok_or_else(|| SessionError::ConnectionFailed("non-UTF8 key path".into()))?
        .to_string();
    let user = std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .map_err(|_| {
            SessionError::ConnectionFailed("USERNAME / USER env var not set".into())
        })?;

    // `icacls <path> /inheritance:r /grant:r "<user>:F"` removes inherited
    // permissions and replaces any existing ACE for <user> with a single
    // FullControl entry. Combined, the file ends up with only <user>:F.
    let mut cmd = TokioCommand::new(r"C:\Windows\System32\icacls.exe");
    cmd.arg(&path_str)
        .arg("/inheritance:r")
        .arg("/grant:r")
        .arg(format!("{user}:F"));
    cmd.stdout(Stdio::null());
    cmd.stderr(Stdio::piped());
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let output = timeout(Duration::from_secs(10), cmd.output())
        .await
        .map_err(|_| SessionError::ConnectionFailed("icacls timed out".into()))?
        .map_err(|e| SessionError::ConnectionFailed(format!("icacls spawn failed: {e}")))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(SessionError::ConnectionFailed(format!(
            "icacls failed: {}",
            stderr.trim()
        )));
    }
    log::info!("gcloud-iap: tightened ACL on {path_str} (user={user})");
    Ok(())
}

#[cfg(not(target_os = "windows"))]
async fn ensure_key_permissions(priv_path: &Path) -> Result<(), SessionError> {
    use std::os::unix::fs::PermissionsExt;
    let metadata = std::fs::metadata(priv_path)
        .map_err(|e| SessionError::ConnectionFailed(format!("stat key: {e}")))?;
    let mut perms = metadata.permissions();
    if perms.mode() & 0o077 != 0 {
        perms.set_mode(0o600);
        std::fs::set_permissions(priv_path, perms)
            .map_err(|e| SessionError::ConnectionFailed(format!("chmod key: {e}")))?;
        log::info!("gcloud-iap: chmod 600 on {priv_path:?}");
    }
    Ok(())
}

/// Push the public key to OS Login, idempotently. Best-effort — if OS Login is
/// not enabled on the project, this returns silently and the caller relies on
/// instance metadata having been populated by a prior `gcloud compute ssh`.
async fn push_key_to_oslogin(pub_path: &Path) -> Result<(), SessionError> {
    let pub_str = pub_path
        .to_str()
        .ok_or_else(|| SessionError::ConnectionFailed("non-UTF8 pubkey path".into()))?;
    let args = vec![
        "compute".to_string(),
        "os-login".to_string(),
        "ssh-keys".to_string(),
        "add".to_string(),
        format!("--key-file={pub_str}"),
    ];
    // Treat any failure as non-fatal: the user may not be on an OS-Login-enabled
    // project, in which case the existing instance-metadata SSH key (from a
    // prior `gcloud compute ssh` run) takes over.
    let _ = run_gcloud_capture(&args, Duration::from_secs(10)).await;
    Ok(())
}

// ---------------------------------------------------------------------------
// argv builders (pure for testability)
// ---------------------------------------------------------------------------

fn build_tunnel_argv(cfg: &GcloudIapConfig) -> Vec<String> {
    vec![
        "compute".into(),
        "start-iap-tunnel".into(),
        cfg.instance.clone(),
        "22".into(),
        format!("--zone={}", cfg.zone),
        format!("--project={}", cfg.project),
        "--local-host-port=localhost:0".into(),
        // Skip gcloud's "Testing if tunnel connection works." probe. It can
        // hang for many seconds (sometimes minutes) on slow or partially
        // misconfigured IAP backends, preventing the "Listening on port [N]."
        // banner we wait for. The tunnel itself works without the probe; any
        // real backend issue will surface as a clean ssh-handshake failure
        // instead of an opaque pre-connect timeout.
        "--iap-tunnel-disable-connection-check".into(),
        "--quiet".into(),
    ]
}

/// SSH client args. `-i` selects the key, `-o` flags disable host-key checking
/// (the IAP tunnel terminates on a fresh local port, so persistent host-key
/// caching is meaningless and would prompt the user every time).
fn build_ssh_argv(user: &str, port: u16, key_path: &str, instance: &str) -> Vec<String> {
    vec![
        "-i".into(),
        key_path.into(),
        "-p".into(),
        port.to_string(),
        "-o".into(),
        "StrictHostKeyChecking=no".into(),
        "-o".into(),
        "UserKnownHostsFile=NUL".into(),
        "-o".into(),
        "GlobalKnownHostsFile=NUL".into(),
        "-o".into(),
        "LogLevel=ERROR".into(),
        // Identify ourselves in audit logs as connecting to <instance> even though
        // we dial localhost via the tunnel.
        "-o".into(),
        format!("HostKeyAlias={instance}"),
        format!("{user}@localhost"),
    ]
}

// ---------------------------------------------------------------------------
// Long-lived IAP tunnel
// ---------------------------------------------------------------------------

/// A running `gcloud compute start-iap-tunnel` subprocess plus the local port
/// it ended up listening on. Kept inside the session so it survives until the
/// SSH side disconnects.
struct IapTunnel {
    child: Child,
    port: u16,
}

/// Spawn the IAP tunnel and parse stdout/stderr until we see the local port.
/// While we wait, each non-empty gcloud output line is also forwarded to the
/// session terminal so the user can see startup progress (gcloud's "Picking
/// local unused port", "Testing if tunnel connection works.", warnings, and
/// any errors) live instead of staring at a blank screen for up to a minute.
/// On success the child remains alive (the tunnel keeps the local TCP
/// listener open). The caller is responsible for killing the child when the
/// SSH session ends.
async fn start_iap_tunnel(
    cfg: &GcloudIapConfig,
    app: &AppHandle,
    session_id: &str,
) -> Result<IapTunnel, SessionError> {
    let phase_start = std::time::Instant::now();
    let args = build_tunnel_argv(cfg);
    log::info!(
        "gcloud-iap: start_iap_tunnel begin session={session_id} argv={args:?}"
    );

    let mut cmd = build_gcloud_command(&args);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.kill_on_drop(true);

    let mut child = cmd.spawn().map_err(|e| {
        log::error!("gcloud-iap: failed to spawn gcloud subprocess: {e}");
        SessionError::ConnectionFailed(format!("failed to spawn gcloud: {e}"))
    })?;

    let gcloud_pid = child.id().unwrap_or(0);
    log::info!(
        "gcloud-iap: gcloud start-iap-tunnel spawned pid={gcloud_pid} (timeout={}s)",
        TUNNEL_READY_TIMEOUT.as_secs()
    );

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| SessionError::ConnectionFailed("gcloud: no stdout pipe".into()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| SessionError::ConnectionFailed("gcloud: no stderr pipe".into()))?;

    // gcloud prints the listening-port banner on **stderr**, not stdout, in
    // current releases. Race both streams.
    let mut stdout_lines = BufReader::new(stdout).lines();
    let mut stderr_lines = BufReader::new(stderr).lines();

    let mut combined_log = String::new();
    let regexes = tunnel_port_regexes();
    let pick_re = pick_port_regex();
    let mut picked_port: Option<u16> = None;
    let mut picked_at: Option<std::time::Instant> = None;
    let mut probe_attempts: u32 = 0;

    let result: Result<u16, SessionError> = timeout(TUNNEL_READY_TIMEOUT, async {
        // Once we learn the port from "Picking local unused port [N].", probe
        // the local TCP listener every 250ms. gcloud's Python stderr is
        // block-buffered when piped, so the "Listening on port [N]." banner
        // (printed only milliseconds after Picking) routinely never reaches
        // us — the TCP probe is what actually detects readiness.
        let mut probe_interval = tokio::time::interval(Duration::from_millis(250));
        probe_interval.set_missed_tick_behavior(MissedTickBehavior::Skip);

        // Periodic "still waiting" heartbeat so we can see in the log how far
        // we got before a hang. Skip the first tick (interval fires immediately).
        let mut heartbeat = tokio::time::interval(Duration::from_secs(5));
        heartbeat.set_missed_tick_behavior(MissedTickBehavior::Skip);
        heartbeat.tick().await;

        loop {
            tokio::select! {
                line = stdout_lines.next_line() => {
                    match line {
                        Ok(Some(line)) => {
                            // Promoted to info: in release builds debug is filtered
                            // out, but these are the most useful diagnostic lines
                            // when an IAP connect fails.
                            log::info!("gcloud-iap[{gcloud_pid}] stdout: {line}");
                            combined_log.push_str(&line);
                            combined_log.push('\n');
                            if !line.trim().is_empty() {
                                emit_session_data(app, session_id, format!("{line}\r\n"));
                            }
                            if picked_port.is_none() {
                                if let Some(c) = pick_re.captures(&line) {
                                    if let Ok(p) = c.get(1).unwrap().as_str().parse::<u16>() {
                                        picked_port = Some(p);
                                        picked_at = Some(std::time::Instant::now());
                                        log::info!(
                                            "gcloud-iap[{gcloud_pid}]: picked_port={p} detected at +{:?}",
                                            phase_start.elapsed()
                                        );
                                    }
                                }
                            }
                            for re in regexes {
                                if let Some(c) = re.captures(&line) {
                                    if let Ok(p) = c.get(1).unwrap().as_str().parse::<u16>() {
                                        log::info!(
                                            "gcloud-iap[{gcloud_pid}]: 'Listening' banner matched port={p} at +{:?}",
                                            phase_start.elapsed()
                                        );
                                        return Ok::<u16, SessionError>(p);
                                    }
                                }
                            }
                        }
                        Ok(None) => {
                            log::error!(
                                "gcloud-iap[{gcloud_pid}]: gcloud stdout closed before producing a port (elapsed={:?}). Combined output follows:\n{combined_log}",
                                phase_start.elapsed()
                            );
                            return Err(SessionError::ConnectionFailed(format!(
                                "gcloud start-iap-tunnel exited before producing a port. Output:\n{combined_log}"
                            )));
                        }
                        Err(e) => {
                            log::error!("gcloud-iap[{gcloud_pid}]: stdout read error: {e}");
                            return Err(SessionError::ConnectionFailed(format!("gcloud stdout read error: {e}")));
                        }
                    }
                }
                line = stderr_lines.next_line() => {
                    match line {
                        Ok(Some(line)) => {
                            log::info!("gcloud-iap[{gcloud_pid}] stderr: {line}");
                            combined_log.push_str(&line);
                            combined_log.push('\n');
                            if !line.trim().is_empty() {
                                emit_session_data(app, session_id, format!("{line}\r\n"));
                            }
                            if picked_port.is_none() {
                                if let Some(c) = pick_re.captures(&line) {
                                    if let Ok(p) = c.get(1).unwrap().as_str().parse::<u16>() {
                                        picked_port = Some(p);
                                        picked_at = Some(std::time::Instant::now());
                                        log::info!(
                                            "gcloud-iap[{gcloud_pid}]: picked_port={p} detected at +{:?}",
                                            phase_start.elapsed()
                                        );
                                    }
                                }
                            }
                            for re in regexes {
                                if let Some(c) = re.captures(&line) {
                                    if let Ok(p) = c.get(1).unwrap().as_str().parse::<u16>() {
                                        log::info!(
                                            "gcloud-iap[{gcloud_pid}]: 'Listening' banner matched port={p} at +{:?}",
                                            phase_start.elapsed()
                                        );
                                        return Ok::<u16, SessionError>(p);
                                    }
                                }
                            }
                        }
                        Ok(None) => { /* stderr closed; keep looping for stdout */ }
                        Err(e) => {
                            log::error!("gcloud-iap[{gcloud_pid}]: stderr read error: {e}");
                            return Err(SessionError::ConnectionFailed(format!("gcloud stderr read error: {e}")));
                        }
                    }
                }
                _ = probe_interval.tick(), if picked_port.is_some() => {
                    if let Some(p) = picked_port {
                        probe_attempts += 1;
                        let probe_start = std::time::Instant::now();
                        let connected = can_tcp_connect_localhost(p).await;
                        let probe_dur = probe_start.elapsed();
                        if connected {
                            let since_pick = picked_at.map(|t| t.elapsed()).unwrap_or_default();
                            log::info!(
                                "gcloud-iap[{gcloud_pid}]: TCP probe #{probe_attempts} to 127.0.0.1:{p} OK in {probe_dur:?} (since pick={since_pick:?}, total={:?})",
                                phase_start.elapsed()
                            );
                            return Ok::<u16, SessionError>(p);
                        } else if probe_attempts == 1 || probe_attempts % 8 == 0 {
                            // Log first failure plus every ~2s of failures
                            // (8 × 250 ms tick = 2 s) so the log shows progress
                            // without a flood of identical lines.
                            log::info!(
                                "gcloud-iap[{gcloud_pid}]: TCP probe #{probe_attempts} to 127.0.0.1:{p} not yet listening (probe took {probe_dur:?}); retrying"
                            );
                        }
                    }
                }
                _ = heartbeat.tick() => {
                    log::info!(
                        "gcloud-iap[{gcloud_pid}]: still waiting for tunnel ready... elapsed={:?} picked_port={:?} probe_attempts={probe_attempts}",
                        phase_start.elapsed(), picked_port
                    );
                }
            }
        }
    })
    .await
    .unwrap_or_else(|_| {
        log::error!(
            "gcloud-iap[{gcloud_pid}]: tunnel readiness TIMED OUT after {:?} (picked_port={:?}, probe_attempts={probe_attempts}). Combined gcloud output follows:\n{combined_log}",
            TUNNEL_READY_TIMEOUT, picked_port
        );
        Err(SessionError::ConnectionFailed(format!(
            "gcloud start-iap-tunnel did not become ready within {}s. Output:\n{combined_log}",
            TUNNEL_READY_TIMEOUT.as_secs()
        )))
    });

    let port = result?;
    log::info!(
        "gcloud-iap[{gcloud_pid}]: tunnel ready on localhost:{port} (took {:?}, probe_attempts={probe_attempts})",
        phase_start.elapsed()
    );
    Ok(IapTunnel { child, port })
}

// ---------------------------------------------------------------------------
// VM-start approval prompt (session_id -> oneshot::Sender<bool>)
// ---------------------------------------------------------------------------

use std::collections::HashMap;
use std::sync::OnceLock;
use tokio::sync::oneshot;

type VmStartSender = oneshot::Sender<bool>;

fn vm_start_prompts() -> &'static std::sync::Mutex<HashMap<String, VmStartSender>> {
    static MAP: OnceLock<std::sync::Mutex<HashMap<String, VmStartSender>>> = OnceLock::new();
    MAP.get_or_init(|| std::sync::Mutex::new(HashMap::new()))
}

fn register_vm_start_prompt(session_id: &str) -> oneshot::Receiver<bool> {
    let (tx, rx) = oneshot::channel::<bool>();
    let mut map = vm_start_prompts().lock().expect("vm_start_prompts poisoned");
    // If a stale entry exists (previous attempt timed out), drop it — the
    // sender goes out of scope and the old receiver will see Err(RecvError).
    map.insert(session_id.to_string(), tx);
    rx
}

fn drop_vm_start_prompt(session_id: &str) {
    if let Ok(mut map) = vm_start_prompts().lock() {
        map.remove(session_id);
    }
}

/// Deliver the user's answer to a pending VM-start prompt. Returns `Err` if
/// there is no pending prompt for the session (e.g. the wait already timed
/// out or the user clicked twice).
pub fn respond_vm_start(session_id: &str, approved: bool) -> Result<(), String> {
    let sender = {
        let mut map = vm_start_prompts().lock().expect("vm_start_prompts poisoned");
        map.remove(session_id)
    };
    match sender {
        Some(tx) => tx
            .send(approved)
            .map_err(|_| "VM-start prompt receiver already dropped".to_string()),
        None => Err("No pending VM-start prompt for this session".to_string()),
    }
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct IapVmStartPromptPayload {
    session_id: String,
    project: String,
    zone: String,
    instance: String,
    current_status: String,
}

/// Safety timeout on the awaiting side: even though the user controls when
/// they click, we don't want to block a session forever (e.g. if HoTTY's
/// frontend dropped the event).
const VM_START_PROMPT_TIMEOUT_SECS: u64 = 300;

/// Run the pre-flight: query instance status, optionally prompt the user,
/// optionally start the VM, and wait for RUNNING. Returns on success or with
/// a descriptive error suitable for `SessionError::ConnectionFailed`.
async fn ensure_vm_running(
    app: &AppHandle,
    session_id: &str,
    config: &GcloudIapConfig,
) -> Result<(), String> {
    emit_session_data(app, session_id, "Checking VM status...\r\n".to_string());
    let status = match iap_tunnel::get_instance_status(
        &config.project,
        &config.zone,
        &config.instance,
    )
    .await
    {
        Ok(s) => s,
        Err(e) => {
            log::warn!(
                "gcloud-iap: get_instance_status failed (auto_start={}): {e}",
                config.auto_start,
            );
            if config.auto_start {
                // Auto-start was requested but we cannot determine current status;
                // refusing to act blindly is safer than firing an unconditional `start`.
                return Err(format!(
                    "Failed to query VM status (required for auto-start): {e}\n\
                     Grant 'compute.instances.get' on this instance, or uncheck \
                     'Auto-start VM if stopped' to skip the pre-flight."
                ));
            }
            // Graceful fallback: the IAP tunnel itself only needs the IAP tunnel
            // accessor permission, not compute.instances.get. Preserve pre-feature
            // behavior for users whose IAM role doesn't include `describe`.
            emit_session_data(
                app,
                session_id,
                format!(
                    "Could not query VM status — skipping pre-flight ({e}).\r\n\
                     Proceeding with IAP tunnel; if the VM is stopped, gcloud will report it shortly.\r\n"
                ),
            );
            return Ok(());
        }
    };
    log::info!(
        "gcloud-iap: pre-flight describe status={} auto_start={} (session={session_id})",
        status.as_str(),
        config.auto_start,
    );

    match decide_preconnect_action(&status, config.auto_start) {
        PreConnectAction::Proceed => {
            emit_session_data(
                app,
                session_id,
                "VM is RUNNING. Starting IAP tunnel...\r\n".to_string(),
            );
            Ok(())
        }
        PreConnectAction::Wait => {
            emit_session_data(
                app,
                session_id,
                format!(
                    "VM status: {} — waiting for RUNNING...\r\n",
                    status.as_str()
                ),
            );
            run_wait_loop(app, session_id, config).await
        }
        PreConnectAction::Start => {
            emit_session_data(
                app,
                session_id,
                format!(
                    "VM is {}. Auto-start enabled — starting VM...\r\n",
                    status.as_str()
                ),
            );
            start_and_wait(app, session_id, config).await
        }
        PreConnectAction::AskUser { current } => {
            emit_session_data(
                app,
                session_id,
                format!(
                    "VM is {current}. Waiting for user approval to start...\r\n"
                ),
            );
            let rx = register_vm_start_prompt(session_id);
            let payload = IapVmStartPromptPayload {
                session_id: session_id.to_string(),
                project: config.project.clone(),
                zone: config.zone.clone(),
                instance: config.instance.clone(),
                current_status: current.clone(),
            };
            if let Err(e) = app.emit("iap-vm-start-prompt", payload) {
                drop_vm_start_prompt(session_id);
                return Err(format!("Failed to emit VM-start prompt: {e}"));
            }
            let approved = match timeout(
                Duration::from_secs(VM_START_PROMPT_TIMEOUT_SECS),
                rx,
            )
            .await
            {
                Ok(Ok(v)) => v,
                Ok(Err(_)) => {
                    drop_vm_start_prompt(session_id);
                    return Err("VM-start prompt was dismissed without an answer".to_string());
                }
                Err(_) => {
                    drop_vm_start_prompt(session_id);
                    return Err(format!(
                        "Timed out waiting for user approval to start VM ({VM_START_PROMPT_TIMEOUT_SECS}s)"
                    ));
                }
            };
            if !approved {
                return Err(format!(
                    "VM '{}' is {current}. Start was declined.",
                    config.instance
                ));
            }
            emit_session_data(
                app,
                session_id,
                "User approved — starting VM...\r\n".to_string(),
            );
            start_and_wait(app, session_id, config).await
        }
        PreConnectAction::ErrUnknown(s) => Err(format!("Unknown VM status: {s}")),
    }
}

async fn start_and_wait(
    app: &AppHandle,
    session_id: &str,
    config: &GcloudIapConfig,
) -> Result<(), String> {
    iap_tunnel::start_instance(&config.project, &config.zone, &config.instance).await?;
    emit_session_data(
        app,
        session_id,
        "VM start initiated. Waiting for RUNNING state...\r\n".to_string(),
    );
    run_wait_loop(app, session_id, config).await
}

async fn run_wait_loop(
    app: &AppHandle,
    session_id: &str,
    config: &GcloudIapConfig,
) -> Result<(), String> {
    let app_cb = app.clone();
    let sid_cb = session_id.to_string();
    iap_tunnel::wait_for_status_running(
        &config.project,
        &config.zone,
        &config.instance,
        move |event| match event {
            WaitEvent::Polling { status, elapsed } => {
                if matches!(status, InstanceStatus::Running) {
                    return;
                }
                emit_session_data(
                    &app_cb,
                    &sid_cb,
                    format!(
                        "VM status: {} — waiting for RUNNING... (elapsed: {}s)\r\n",
                        status.as_str(),
                        elapsed.as_secs()
                    ),
                );
            }
            WaitEvent::Running { total } => {
                emit_session_data(
                    &app_cb,
                    &sid_cb,
                    format!(
                        "VM is RUNNING after {}s. Starting IAP tunnel...\r\n",
                        total.as_secs()
                    ),
                );
            }
        },
    )
    .await
    .map(|_| ())
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

enum WriterCmd {
    Bytes(Vec<u8>),
    Resize(u16, u16),
    Close,
}

pub struct GcloudIapSession {
    config: GcloudIapConfig,
    encoding: &'static encoding_rs::Encoding,
    writer_tx: Option<mpsc::Sender<WriterCmd>>,
    join: Vec<JoinHandle<()>>,
    /// Live `gcloud compute start-iap-tunnel` subprocess. Held for the
    /// lifetime of the SSH session; killed on disconnect.
    tunnel_child: Option<Child>,
}

impl GcloudIapSession {
    pub fn new(config: GcloudIapConfig) -> Self {
        let encoding = encoding_for(&config.encoding);
        Self {
            config,
            encoding,
            writer_tx: None,
            join: Vec::new(),
            tunnel_child: None,
        }
    }
}

#[async_trait]
impl SessionService for GcloudIapSession {
    async fn connect(
        &mut self,
        app: AppHandle,
        session_id: String,
    ) -> Result<(), SessionError> {
        self.config.validate()?;

        let connect_start = std::time::Instant::now();
        log::info!(
            "gcloud-iap: connect() begin project={} zone={} instance={} encoding={} session={session_id}",
            self.config.project,
            self.config.zone,
            self.config.instance,
            self.config.encoding,
        );
        // Surface the gcloud resolver result + the relevant env-var presence
        // up front so log readers can see which gcloud HoTTY actually invokes
        // and whether the env passed to it has the bits gcloud's bundled
        // Python needs (PATH, APPDATA for ~/.config/gcloud equivalent, etc.).
        {
            let (program, use_shell) = gcloud_program();
            let env_present = |k: &str| std::env::var_os(k).is_some();
            log::info!(
                "gcloud-iap: gcloud program={program:?} use_shell={use_shell} env(PATH={}, APPDATA={}, LOCALAPPDATA={}, USERPROFILE={}, CLOUDSDK_CONFIG={}, CLOUDSDK_PYTHON={})",
                env_present("PATH"),
                env_present("APPDATA"),
                env_present("LOCALAPPDATA"),
                env_present("USERPROFILE"),
                env_present("CLOUDSDK_CONFIG"),
                env_present("CLOUDSDK_PYTHON"),
            );
        }

        // --- Locate the OpenSSH client ---
        let ssh_exe = find_openssh_path().ok_or_else(|| {
            log::error!("gcloud-iap: Windows OpenSSH client (ssh.exe) not found on this system");
            SessionError::ConnectionFailed(
                "Windows OpenSSH client (ssh.exe) not found. Enable it via \
                 Settings → Apps → Optional Features → OpenSSH Client."
                    .into(),
            )
        })?;
        log::info!("gcloud-iap: openssh client resolved to {ssh_exe:?}");

        // --- Ensure SSH key exists; generate if missing ---
        let key_phase = std::time::Instant::now();
        let (priv_key_path, generated) = ensure_ssh_key().await?;
        log::info!(
            "gcloud-iap: ssh key path={priv_key_path:?} generated={generated} (resolved in {:?})",
            key_phase.elapsed()
        );
        if generated {
            log::info!(
                "gcloud-iap: pushing freshly generated public key to OS Login (best-effort)"
            );
            let pub_path = priv_key_path.with_extension("pub");
            // Best-effort, errors logged but non-fatal: the project may not
            // have OS Login enabled, in which case the user must run
            // `gcloud compute ssh ... --tunnel-through-iap` once outside HoTTY
            // to populate instance-metadata SSH keys.
            if let Err(e) = push_key_to_oslogin(&pub_path).await {
                log::warn!("gcloud-iap: push_key_to_oslogin failed (non-fatal): {e}");
            }
        }
        // Repair NTFS ACL — Windows OpenSSH rejects keys whose ACL contains
        // entries outside (owner, SYSTEM, Administrators). gcloud's generated
        // keys often inherit an `OWNER RIGHTS` ACE that triggers this.
        let acl_phase = std::time::Instant::now();
        if let Err(e) = ensure_key_permissions(&priv_key_path).await {
            log::warn!("gcloud-iap: ensure_key_permissions failed (non-fatal): {e}");
        } else {
            log::info!(
                "gcloud-iap: ensure_key_permissions ok in {:?}",
                acl_phase.elapsed()
            );
        }
        let priv_key_str = priv_key_path
            .to_str()
            .ok_or_else(|| SessionError::ConnectionFailed("non-UTF8 key path".into()))?
            .to_string();

        // --- Resolve SSH username ---
        // Mirror `gcloud compute ssh`'s logic: only use the OS Login POSIX
        // username when OS Login is explicitly enabled on the project or
        // instance. Otherwise fall back to the local Windows username — which
        // is what `gcloud compute ssh` does on legacy-metadata projects and is
        // the user under whose name the existing instance-metadata SSH key was
        // registered.
        let user_phase = std::time::Instant::now();
        let oslogin_state = is_oslogin_enabled(
            &self.config.project,
            &self.config.zone,
            &self.config.instance,
        )
        .await;
        let user = match oslogin_state {
            Some(true) => {
                log::info!(
                    "gcloud-iap: OS Login is ENABLED (detected in {:?}); resolving POSIX username",
                    user_phase.elapsed()
                );
                match resolve_oslogin_username().await {
                    Some(u) => {
                        log::info!("gcloud-iap: OS Login POSIX username='{u}'");
                        u
                    }
                    None => {
                        let u = fallback_local_username();
                        log::warn!(
                            "gcloud-iap: OS Login enabled but profile lookup failed; falling back to '{u}'"
                        );
                        u
                    }
                }
            }
            None => {
                // Defense-in-depth: metadata describes failed entirely (could be
                // auth, permissions, or transient gcloud error). Don't assume
                // OS Login is disabled — try the POSIX lookup; if the account
                // has a profile, that's a much better username than the local
                // Windows one.
                log::warn!(
                    "gcloud-iap: OS Login metadata describe FAILED (detected in {:?}); attempting POSIX username lookup as a defensive fallback",
                    user_phase.elapsed()
                );
                match resolve_oslogin_username().await {
                    Some(u) => {
                        log::info!(
                            "gcloud-iap: POSIX profile found despite metadata describe failure — using OS Login username '{u}'"
                        );
                        u
                    }
                    None => {
                        let u = fallback_local_username();
                        log::warn!(
                            "gcloud-iap: no POSIX profile either; falling back to local username '{u}' (SSH may fail if this user is not on the VM)"
                        );
                        u
                    }
                }
            }
            Some(false) => {
                let u = fallback_local_username();
                log::info!(
                    "gcloud-iap: OS Login DISABLED on project/instance (detected in {:?}); using local username '{u}'",
                    user_phase.elapsed()
                );
                u
            }
        };

        // --- Pre-flight: ensure the VM is RUNNING (start or wait if needed) ---
        if let Err(e) = ensure_vm_running(&app, &session_id, &self.config).await {
            drop_vm_start_prompt(&session_id);
            log::warn!("gcloud-iap: ensure_vm_running failed: {e}");
            return Err(SessionError::ConnectionFailed(e));
        }

        // --- Start the IAP tunnel ---
        log::info!(
            "gcloud-iap: invoking start_iap_tunnel (pre-tunnel elapsed={:?})",
            connect_start.elapsed()
        );
        let tunnel = start_iap_tunnel(&self.config, &app, &session_id).await?;
        let port = tunnel.port;
        self.tunnel_child = Some(tunnel.child);
        emit_session_data(
            &app,
            &session_id,
            format!("IAP tunnel ready on 127.0.0.1:{port}. Connecting via ssh...\r\n"),
        );

        // --- Build the ssh.exe command for the PTY ---
        let argv = build_ssh_argv(&user, port, &priv_key_str, &self.config.instance);
        log::info!(
            "gcloud-iap: ssh.exe argv={argv:?} (ssh_exe={ssh_exe:?})"
        );

        let pty_system = native_pty_system();
        let pty_pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| SessionError::ConnectionFailed(format!("failed to open PTY: {e}")))?;

        let mut cmd = CommandBuilder::new(&ssh_exe);
        for a in &argv {
            cmd.arg(a);
        }
        if let Some(home) = home_dir() {
            cmd.cwd(home);
        }
        cmd.env_clear();
        for (k, v) in sanitized_env() {
            cmd.env(k, v);
        }
        cmd.env("TERM", "xterm-256color");

        let child = pty_pair.slave.spawn_command(cmd).map_err(|e| {
            log::error!("gcloud-iap: failed to spawn ssh.exe via PTY: {e}");
            SessionError::ConnectionFailed(format!("failed to spawn ssh: {e}"))
        })?;
        let ssh_pid = child.process_id().unwrap_or(0);
        log::info!(
            "gcloud-iap: ssh.exe spawned pid={ssh_pid} via tunnel localhost:{port} (total connect elapsed={:?})",
            connect_start.elapsed()
        );

        // Drop the slave end — we communicate through the master
        drop(pty_pair.slave);

        let reader = pty_pair
            .master
            .try_clone_reader()
            .map_err(|e| SessionError::ConnectionFailed(format!("failed to clone PTY reader: {e}")))?;
        let writer = pty_pair
            .master
            .take_writer()
            .map_err(|e| SessionError::ConnectionFailed(format!("failed to take PTY writer: {e}")))?;

        // Keep master alive for resize
        let master = Arc::new(Mutex::new(pty_pair.master));

        let (tx, mut rx) = mpsc::channel::<WriterCmd>(64);
        self.writer_tx = Some(tx);

        emit_session_status(&app, &session_id, "connected");

        // --- Child watcher task ---
        // On Windows ConPTY, the master reader may not get EOF when the child
        // exits unless we actively wait. Spawn a watcher that blocks on
        // child.wait() and emits disconnected once ssh terminates.
        let log_mgr: super::log_manager::LogManager =
            app.state::<super::log_manager::LogManager>().inner().clone();
        let app_w = app.clone();
        let sid_w = session_id.clone();
        let log_mgr_w = log_mgr.clone();
        let watcher_join = tokio::spawn(async move {
            let exit_result = tokio::task::spawn_blocking(move || {
                let mut child = child;
                child.wait()
            })
            .await;
            match exit_result {
                Ok(Ok(status)) => {
                    log::info!(
                        "gcloud-iap[ssh pid={ssh_pid}] {sid_w}: ssh exited: {status:?}"
                    )
                }
                Ok(Err(e)) => log::warn!(
                    "gcloud-iap[ssh pid={ssh_pid}] {sid_w}: child.wait error: {e}"
                ),
                Err(e) => log::warn!(
                    "gcloud-iap[ssh pid={ssh_pid}] {sid_w}: child wait task error: {e}"
                ),
            }
            log_mgr_w.stop_logging(&sid_w).await;
            emit_session_status(&app_w, &sid_w, "disconnected");
        });
        self.join.push(watcher_join);

        // --- Writer task ---
        let master_for_resize = master.clone();
        let writer_join = tokio::spawn(async move {
            let mut writer = writer;
            while let Some(cmd) = rx.recv().await {
                match cmd {
                    WriterCmd::Bytes(b) => {
                        if writer.write_all(&b).is_err() {
                            break;
                        }
                        let _ = writer.flush();
                    }
                    WriterCmd::Resize(cols, rows) => {
                        let m = master_for_resize.lock().await;
                        let _ = m.resize(PtySize {
                            rows,
                            cols,
                            pixel_width: 0,
                            pixel_height: 0,
                        });
                    }
                    WriterCmd::Close => break,
                }
            }
        });
        self.join.push(writer_join);

        // --- Reader task ---
        let encoding = self.encoding;
        let app_r = app.clone();
        let sid = session_id.clone();

        let reader_join = tokio::spawn(async move {
            log::info!(
                "gcloud-iap[ssh pid={ssh_pid}] reader task started for {sid}"
            );
            let mut reader = reader;
            let mut buf = [0u8; 4096];
            let mut total_bytes: u64 = 0;
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => {
                        log::info!(
                            "gcloud-iap[ssh pid={ssh_pid}] {sid}: PTY read returned 0 (ssh exited); total_bytes={total_bytes}"
                        );
                        log_mgr.stop_logging(&sid).await;
                        emit_session_status(&app_r, &sid, "disconnected");
                        break;
                    }
                    Ok(n) => {
                        total_bytes = total_bytes.saturating_add(n as u64);
                        let (decoded, _enc, _had_errors) = encoding.decode(&buf[..n]);
                        let text = decoded.into_owned();
                        emit_session_data(&app_r, &sid, text.clone());
                        log_mgr.write(&sid, &text).await;
                    }
                    Err(e) => {
                        log::error!(
                            "gcloud-iap[ssh pid={ssh_pid}] {sid}: PTY read error after {total_bytes} bytes: {e}"
                        );
                        log_mgr.stop_logging(&sid).await;
                        emit_session_error(&app_r, &sid, format!("read error: {e}"));
                        emit_session_status(&app_r, &sid, "disconnected");
                        break;
                    }
                }
            }
            drop(master);
        });
        self.join.push(reader_join);

        Ok(())
    }

    async fn write(&mut self, data: &[u8]) -> Result<(), SessionError> {
        if let Some(ref tx) = self.writer_tx {
            let text = String::from_utf8_lossy(data);
            let (encoded, _enc, _had_errors) = self.encoding.encode(&text);
            tx.send(WriterCmd::Bytes(encoded.into_owned()))
                .await
                .map_err(|_| SessionError::Other("writer channel closed".into()))?;
        }
        Ok(())
    }

    async fn resize(&mut self, cols: u16, rows: u16) -> Result<(), SessionError> {
        if let Some(ref tx) = self.writer_tx {
            let _ = tx.send(WriterCmd::Resize(cols, rows)).await;
        }
        Ok(())
    }

    fn set_encoding(&mut self, encoding: &str) {
        self.encoding = encoding_for(encoding);
    }

    async fn disconnect(&mut self) -> Result<(), SessionError> {
        if let Some(tx) = self.writer_tx.take() {
            let _ = tx.send(WriterCmd::Close).await;
        }
        for jh in self.join.drain(..) {
            let abort_handle = jh.abort_handle();
            if tokio::time::timeout(Duration::from_millis(1500), jh).await.is_err() {
                log::warn!("gcloud-iap task did not finish within 1.5s, aborting");
                abort_handle.abort();
            }
        }
        // Tear down the tunnel after the SSH child is gone so the local TCP
        // listener stays valid until the ssh client closes its end.
        if let Some(mut child) = self.tunnel_child.take() {
            log::info!("gcloud-iap: killing tunnel subprocess");
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
        Ok(())
    }
}

impl Drop for GcloudIapSession {
    fn drop(&mut self) {
        if self.writer_tx.is_some() {
            log::warn!("GcloudIapSession dropped without calling disconnect()");
            for jh in self.join.drain(..) {
                jh.abort();
            }
        }
        if self.tunnel_child.is_some() {
            // `kill_on_drop(true)` on the Child handles SIGKILL automatically.
            // No async work allowed in Drop; we just rely on that flag.
            log::warn!("GcloudIapSession dropped with live tunnel child; relying on kill_on_drop");
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(project: &str, zone: &str, instance: &str) -> GcloudIapConfig {
        GcloudIapConfig {
            project: project.into(),
            zone: zone.into(),
            instance: instance.into(),
            encoding: "utf8".into(),
            auto_start: false,
        }
    }

    #[test]
    fn validate_accepts_happy_path() {
        let c = cfg("my-project-123", "us-central1-a", "instance-01");
        assert!(c.validate().is_ok());
    }

    #[test]
    fn validate_rejects_bad_project() {
        let c = cfg("My-Project", "us-central1-a", "instance-01");
        assert!(matches!(c.validate(), Err(SessionError::InvalidConfig(_))));
    }

    #[test]
    fn validate_rejects_bad_zone() {
        let c = cfg("my-project-123", "US-CENTRAL1-A", "instance-01");
        assert!(matches!(c.validate(), Err(SessionError::InvalidConfig(_))));
    }

    #[test]
    fn validate_rejects_bad_instance() {
        let c = cfg("my-project-123", "us-central1-a", "Instance_01");
        assert!(matches!(c.validate(), Err(SessionError::InvalidConfig(_))));
    }

    #[test]
    fn validate_rejects_injection_in_project() {
        let c = cfg("p;ls", "us-central1-a", "vm-01");
        assert!(matches!(c.validate(), Err(SessionError::InvalidConfig(_))));
    }

    #[test]
    fn validate_rejects_injection_in_zone() {
        let c = cfg("my-project-123", "us-central1-a\nrm", "vm-01");
        assert!(matches!(c.validate(), Err(SessionError::InvalidConfig(_))));
    }

    #[test]
    fn validate_rejects_injection_in_instance() {
        let c = cfg("my-project-123", "us-central1-a", "vm$(whoami)");
        assert!(matches!(c.validate(), Err(SessionError::InvalidConfig(_))));
    }

    #[test]
    fn validate_rejects_empty_fields() {
        assert!(cfg("", "us-central1-a", "vm-01").validate().is_err());
        assert!(cfg("my-project-123", "", "vm-01").validate().is_err());
        assert!(cfg("my-project-123", "us-central1-a", "").validate().is_err());
    }

    #[test]
    fn build_tunnel_argv_layout() {
        let c = cfg("my-project-123", "us-central1-a", "vm-01");
        let argv = build_tunnel_argv(&c);
        assert_eq!(
            argv,
            vec![
                "compute".to_string(),
                "start-iap-tunnel".to_string(),
                "vm-01".to_string(),
                "22".to_string(),
                "--zone=us-central1-a".to_string(),
                "--project=my-project-123".to_string(),
                "--local-host-port=localhost:0".to_string(),
                "--iap-tunnel-disable-connection-check".to_string(),
                "--quiet".to_string(),
            ]
        );
    }

    /// Regression guard: `--iap-tunnel-disable-connection-check` must remain
    /// in the argv. Without it, gcloud's "Testing if tunnel connection works."
    /// probe can block our readiness wait indefinitely on slow/partially
    /// misconfigured IAP backends.
    #[test]
    fn build_tunnel_argv_disables_connection_check() {
        let c = cfg("my-project-123", "us-central1-a", "vm-01");
        let argv = build_tunnel_argv(&c);
        assert!(
            argv.contains(&"--iap-tunnel-disable-connection-check".to_string()),
            "argv missing --iap-tunnel-disable-connection-check: {argv:?}"
        );
    }

    #[test]
    fn build_ssh_argv_layout() {
        let argv = build_ssh_argv("alice", 12345, r"C:\Users\alice\.ssh\google_compute_engine", "vm-01");
        assert!(argv.contains(&"-i".to_string()));
        assert!(argv.contains(&r"C:\Users\alice\.ssh\google_compute_engine".to_string()));
        assert!(argv.contains(&"-p".to_string()));
        assert!(argv.contains(&"12345".to_string()));
        assert!(argv.contains(&"StrictHostKeyChecking=no".to_string()));
        assert!(argv.contains(&"HostKeyAlias=vm-01".to_string()));
        // The user@host element must be the final positional.
        assert_eq!(argv.last().unwrap(), "alice@localhost");
    }

    #[test]
    fn config_deserializes_from_camel_case_json() {
        let json = r#"{"project":"my-project-123","zone":"us-central1-a","instance":"vm-01","encoding":"utf8"}"#;
        let cfg: GcloudIapConfig = serde_json::from_str(json).unwrap();
        assert_eq!(cfg.project, "my-project-123");
        assert_eq!(cfg.zone, "us-central1-a");
        assert_eq!(cfg.instance, "vm-01");
        assert_eq!(cfg.encoding, "utf8");
        assert!(cfg.validate().is_ok());
    }

    #[test]
    fn config_deserializes_with_default_encoding() {
        let json = r#"{"project":"my-project-123","zone":"us-central1-a","instance":"vm-01"}"#;
        let cfg: GcloudIapConfig = serde_json::from_str(json).unwrap();
        assert_eq!(cfg.encoding, "utf8");
    }

    #[test]
    fn config_auto_start_defaults_false() {
        // Backward-compat: hosts saved before this feature have no `autoStart` field.
        let json = r#"{"project":"my-project-123","zone":"us-central1-a","instance":"vm-01","encoding":"utf8"}"#;
        let cfg: GcloudIapConfig = serde_json::from_str(json).unwrap();
        assert!(!cfg.auto_start);
    }

    #[test]
    fn config_auto_start_round_trip_true() {
        let json = r#"{"project":"my-project-123","zone":"us-central1-a","instance":"vm-01","encoding":"utf8","autoStart":true}"#;
        let cfg: GcloudIapConfig = serde_json::from_str(json).unwrap();
        assert!(cfg.auto_start);
    }

    #[test]
    fn config_auto_start_explicit_false() {
        let json = r#"{"project":"my-project-123","zone":"us-central1-a","instance":"vm-01","encoding":"utf8","autoStart":false}"#;
        let cfg: GcloudIapConfig = serde_json::from_str(json).unwrap();
        assert!(!cfg.auto_start);
    }

    #[test]
    fn respond_vm_start_without_pending_errors() {
        let res = respond_vm_start("nonexistent-session-xyz", true);
        assert!(res.is_err());
    }

    #[tokio::test]
    async fn respond_vm_start_delivers_to_pending() {
        let sid = "test-session-respond-delivers";
        let rx = register_vm_start_prompt(sid);
        respond_vm_start(sid, true).expect("send should succeed");
        assert!(rx.await.unwrap());
    }

    #[test]
    fn sensitive_env_detection() {
        assert!(is_sensitive_env_var("AWS_SECRET_ACCESS_KEY"));
        assert!(is_sensitive_env_var("MY_API_KEY"));
        assert!(is_sensitive_env_var("DB_PASSWORD"));
        assert!(!is_sensitive_env_var("PATH"));
        assert!(!is_sensitive_env_var("APPDATA"));
        assert!(!is_sensitive_env_var("LOCALAPPDATA"));
        assert!(!is_sensitive_env_var("USERPROFILE"));
    }

    #[test]
    fn tunnel_port_regex_matches_known_banners() {
        let regexes = tunnel_port_regexes();
        let cases = &[
            ("Listening on port [54321].", 54321),
            ("Listening on 127.0.0.1:8765", 8765),
        ];
        for (input, expected) in cases {
            let mut found = None;
            for re in regexes {
                if let Some(c) = re.captures(input) {
                    if let Ok(p) = c.get(1).unwrap().as_str().parse::<u16>() {
                        found = Some(p);
                        break;
                    }
                }
            }
            assert_eq!(found, Some(*expected), "no regex matched: {input}");
        }
    }

    /// "Picking local unused port [N]." fires before the listener is up, so
    /// it must NOT be treated as a readiness signal. Regression guard for the
    /// bug where matching this line caused ssh to dial an unbound port and
    /// exit 255 (Connection refused).
    #[test]
    fn tunnel_port_regex_ignores_picking_banner() {
        let regexes = tunnel_port_regexes();
        let picking = "Picking local unused port [12345].";
        for re in regexes {
            assert!(
                re.captures(picking).is_none(),
                "regex {re:?} unexpectedly matched the 'Picking' banner"
            );
        }
    }

    /// `pick_port_regex` is the separate regex used to learn the port number
    /// (for the TCP-probe path). It MUST match the "Picking …" line that
    /// `tunnel_port_regexes` ignores.
    #[test]
    fn pick_port_regex_extracts_port_from_picking_line() {
        let re = pick_port_regex();
        let cases = &[
            ("Picking local unused port [12345].", 12345u16),
            ("Picking local unused port [65535]", 65535),
            ("Picking local unused port [1024].", 1024),
        ];
        for (input, expected) in cases {
            let cap = re
                .captures(input)
                .unwrap_or_else(|| panic!("pick_port_regex did not match: {input}"));
            let port: u16 = cap.get(1).unwrap().as_str().parse().unwrap();
            assert_eq!(port, *expected, "input: {input}");
        }
    }

    #[test]
    fn pick_port_regex_rejects_listening_lines() {
        let re = pick_port_regex();
        // The "Listening" lines are handled by `tunnel_port_regexes`; this
        // one only fires for "Picking ...".
        assert!(re.captures("Listening on port [12345].").is_none());
        assert!(re.captures("Listening on 127.0.0.1:12345").is_none());
    }

    /// `can_tcp_connect_localhost` must return true when a listener is bound
    /// on the target port, and false when nothing is listening. This is the
    /// core of the bufferless readiness detection path.
    #[tokio::test]
    async fn tcp_probe_detects_listener_state() {
        // Bind to an ephemeral port and detect it.
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        assert!(
            can_tcp_connect_localhost(port).await,
            "probe should succeed while listener is bound on {port}"
        );

        // Drop the listener; subsequent probe should fail (the OS releases
        // the port). We can't guarantee TIME_WAIT-style edge cases, so we
        // only assert that an unbound high port fails — pick one we never
        // bound to.
        drop(listener);
        assert!(
            !can_tcp_connect_localhost(1).await,
            "probe to a port unlikely to be listening (1) should fail"
        );
    }

    #[test]
    fn tunnel_port_regex_rejects_garbage() {
        let regexes = tunnel_port_regexes();
        let garbage = "This line has no port info at all";
        for re in regexes {
            assert!(re.captures(garbage).is_none());
        }
    }

    #[test]
    fn fallback_username_is_nonempty() {
        // We can't easily mock the env, but the function must always return
        // something usable.
        assert!(!fallback_local_username().is_empty());
    }
}
