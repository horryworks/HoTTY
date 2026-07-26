use async_trait::async_trait;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use regex_lite::Regex;
use serde::Deserialize;
use std::io::{Read as IoRead, Write as IoWrite};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::net::TcpStream;
use tokio::process::{Child, Command as TokioCommand};
use tokio::sync::{mpsc, Mutex};
use tokio::task::JoinHandle;
use tokio::time::{timeout, MissedTickBehavior};

use super::exe_finder::find_executable;
use super::iap_tunnel::{
    self, decide_preconnect_action, gcloud_program, is_valid_instance, is_valid_project,
    is_valid_zone, InstanceStatus, PreConnectAction, WaitEvent,
};
use super::session_service::{
    abort_all, emit_iap_connect_progress, emit_session_data, emit_session_error,
    emit_session_status, emit_to_owner, encoding_for, humanize_pty_error, humanize_read_error,
    humanize_spawn_error, join_or_abort, SessionError, SessionService, DISCONNECT_DRAIN_MS,
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

    /// Explicit SSH login name. When set (and non-empty) it wins over every
    /// auto-detection tier — the escape hatch for projects where neither
    /// `gcloud compute ssh --dry-run` nor the metadata/org-policy fallback
    /// picks the account the VM actually provisions.
    #[serde(default)]
    pub username: Option<String>,
}

fn default_encoding() -> String {
    "utf8".to_string()
}

/// Accept only POSIX-ish login names. The value ends up as an `ssh.exe` argv
/// element, so `@`, whitespace, control characters and shell metacharacters are
/// all rejected rather than escaped. Applied both to the user-supplied override
/// and to whatever we parse out of gcloud's `--dry-run` output, so a malformed
/// gcloud line cannot inject an argv element.
///
/// The first character may be an ASCII digit: corporate Windows machines log in
/// under an all-numeric AD id (e.g. `12345678`), and gcloud provisions the
/// metadata SSH user under exactly that name. Rejecting it made HoTTY throw away
/// gcloud's own `--dry-run` username and fall back to a wrong email-derived name,
/// causing `Permission denied (publickey)` (observed 2026-07-24). A leading `-`
/// is still rejected (it would read as an ssh flag) and the character *set*
/// (a-z 0-9 _ -) is unchanged, so argv-injection safety is unaffected.
pub(crate) fn is_valid_ssh_username(user: &str) -> bool {
    if user.is_empty() || user.len() > 32 {
        return false;
    }
    let mut chars = user.chars();
    let first = chars.next().unwrap_or('\0');
    if !(first.is_ascii_lowercase() || first.is_ascii_digit() || first == '_') {
        return false;
    }
    chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
}

impl GcloudIapConfig {
    /// The override login name, if the user supplied a non-blank one.
    /// Whitespace-only input is treated as "not set" so a stray space in the
    /// settings field doesn't silently disable auto-detection.
    pub fn username_override(&self) -> Option<&str> {
        self.username
            .as_deref()
            .map(str::trim)
            .filter(|u| !u.is_empty())
    }

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
        if let Some(user) = self.username_override() {
            if !is_valid_ssh_username(user) {
                return Err(SessionError::InvalidConfig(format!(
                    "invalid SSH username: {user}"
                )));
            }
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

/// Parse the first capture group of `re` against `line` as a u16 port. Returns
/// `None` if there's no match, no group 1, or it doesn't parse — replacing the
/// `c.get(1).unwrap().as_str().parse()` idiom that panicked if a regex were ever
/// edited to drop its capture group.
fn parse_port_capture(re: &Regex, line: &str) -> Option<u16> {
    re.captures(line)?.get(1)?.as_str().parse().ok()
}

/// Read-only context for the tunnel-readiness line processor.
struct TunnelReadyCtx<'a> {
    gcloud_pid: u32,
    phase_start: std::time::Instant,
    app: &'a AppHandle,
    session_id: &'a str,
    pick_re: &'a Regex,
    regexes: &'a [Regex],
}

enum LineOutcome {
    /// Keep waiting for readiness.
    Continue,
    /// The "Listening" banner revealed the port — the tunnel is ready.
    PortReady(u16),
}

/// Process one line from gcloud's stdout or stderr during tunnel startup:
/// log it, mirror it to the terminal, capture the picked port, and detect the
/// "Listening" banner. Extracted so the stdout and stderr `select!` arms share
/// one implementation (they had drifted; only their stream-close/error handling
/// legitimately differs).
fn process_tunnel_line(
    ctx: &TunnelReadyCtx,
    source: &str,
    line: &str,
    combined_log: &mut String,
    picked_port: &mut Option<u16>,
    picked_at: &mut Option<std::time::Instant>,
) -> LineOutcome {
    // Promoted to info: release builds filter out debug, but these lines are
    // the most useful diagnostics when an IAP connect fails.
    log::info!("gcloud-iap[{}] {source}: {line}", ctx.gcloud_pid);
    combined_log.push_str(line);
    combined_log.push('\n');
    if !line.trim().is_empty() {
        emit_session_data(ctx.app, ctx.session_id, format!("{line}\r\n"));
    }
    if picked_port.is_none() {
        if let Some(p) = parse_port_capture(ctx.pick_re, line) {
            *picked_port = Some(p);
            *picked_at = Some(std::time::Instant::now());
            log::info!(
                "gcloud-iap[{}]: picked_port={p} detected at +{:?}",
                ctx.gcloud_pid,
                ctx.phase_start.elapsed()
            );
        }
    }
    for re in ctx.regexes {
        if let Some(p) = parse_port_capture(re, line) {
            log::info!(
                "gcloud-iap[{}]: 'Listening' banner matched port={p} at +{:?}",
                ctx.gcloud_pid,
                ctx.phase_start.elapsed()
            );
            return LineOutcome::PortReady(p);
        }
    }
    LineOutcome::Continue
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

use super::sensitive_env::sanitized_env;

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
    let (well_known, exe) = (
        vec![
            PathBuf::from(r"C:\Windows\System32\OpenSSH\ssh.exe"),
            PathBuf::from(r"C:\Windows\Sysnative\OpenSSH\ssh.exe"),
        ],
        "ssh.exe",
    );
    #[cfg(not(target_os = "windows"))]
    let (well_known, exe) = (Vec::<PathBuf>::new(), "ssh");
    find_executable(well_known, exe)
}

fn find_ssh_keygen_path() -> Option<PathBuf> {
    // Note: previously this skipped the PATH scan on Windows (unlike
    // find_openssh_path), so a non-default OpenSSH install found ssh.exe but
    // not ssh-keygen.exe. Sharing find_executable fixes that asymmetry.
    #[cfg(target_os = "windows")]
    let (well_known, exe) = (
        vec![
            PathBuf::from(r"C:\Windows\System32\OpenSSH\ssh-keygen.exe"),
            PathBuf::from(r"C:\Windows\Sysnative\OpenSSH\ssh-keygen.exe"),
        ],
        "ssh-keygen.exe",
    );
    #[cfg(not(target_os = "windows"))]
    let (well_known, exe) = (Vec::<PathBuf>::new(), "ssh-keygen");
    find_executable(well_known, exe)
}

// ---------------------------------------------------------------------------
// gcloud command runners (long-lived & one-shot)
// ---------------------------------------------------------------------------

/// Build a `tokio::process::Command` for invoking gcloud with the given args.
///
/// On Windows the wrapper is `gcloud.cmd`. We do NOT wrap it in `cmd /C`
/// ourselves because cmd's rule "if there are 3+ `"` characters on the command
/// line, strip the outermost pair" breaks the path quoting whenever an arg
/// itself contains a `"` (the same hazard applies even with Rust's BatBadBut
/// escaping). The `run_gcloud_capture` guard now rejects such args at runtime
/// — callers must use `--format=json(projection)` and parse with serde_json
/// instead. Rust's standard library detects the `.cmd` extension and invokes
/// cmd.exe with BatBadBut-safe escaping (since Rust 1.77.2), so passing the
/// path directly to `Command::new` is both safer and simpler. The
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
    // Regression / injection guard: gcloud is shipped as `gcloud.cmd` and Rust's
    // std spawns .cmd files via cmd.exe. cmd.exe applies a "if there are 3+ `\"`
    // characters on the command line, strip the outermost pair" rule which
    // truncates the program path at the first space when args themselves contain
    // `\"` — see the 2026-05-22 IAP regression where
    // `--format=value(\"key:enable-oslogin\"...)` caused gcloud to fail with
    // "'C:\\…\\Google\\Cloud' is not recognized". Use `--format=json(projection)`
    // and parse with serde_json instead; the projection syntax avoids embedded
    // quotes entirely.
    //
    // Beyond `\"`, the other cmd.exe metacharacters (`% ^ & | < >` and newlines)
    // are the BatBadBut argument/command-injection class for `.cmd` batch files.
    // Every GCP identifier reaching this path is already regex-validated upstream
    // (is_valid_project/zone/instance) and the remaining args are app-constructed,
    // so this is defense-in-depth — but we reject them with an allowlist mindset
    // rather than trusting a single-character `\"` check that is easy to regress.
    const FORBIDDEN: &[char] = &['"', '%', '^', '&', '|', '<', '>', '\n', '\r'];
    if args
        .iter()
        .any(|a| a.chars().any(|c| FORBIDDEN.contains(&c)))
    {
        // Hard fail in every build profile. A `debug_assert!` would let release
        // builds run the mangled/injected invocation anyway — exactly what this
        // guard exists to prevent. Reject up front with an actionable message.
        // Callers must use --format=json(projection) and validated identifiers.
        log::error!(
            "gcloud-iap: run_gcloud_capture called with a cmd.exe metacharacter in args — refusing to spawn: {args:?}"
        );
        return Err(SessionError::InvalidConfig(
            "internal: gcloud arg contains a forbidden shell metacharacter (one of \" % ^ & | < >) — use --format=json(projection) and validated identifiers".into(),
        ));
    }

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
            SessionError::ConnectionFailed(humanize_spawn_error("gcloud", &e))
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

/// Build the args for `gcloud compute instances describe` that yield only
/// `metadata.items` as JSON. Extracted so unit tests can verify no `"`
/// characters leak into the arg vector (see the `run_gcloud_capture`
/// regression guard).
fn instance_oslogin_describe_args(project: &str, zone: &str, instance: &str) -> Vec<String> {
    vec![
        "compute".to_string(),
        "instances".to_string(),
        "describe".to_string(),
        instance.to_string(),
        format!("--zone={zone}"),
        format!("--project={project}"),
        "--format=json(metadata.items)".to_string(),
    ]
}

/// Build the args for `gcloud compute ssh --dry-run`, which prints the ssh
/// command line gcloud *would* run without executing it. This is gcloud's own
/// resolution of the login name and identity file — the authority we defer to
/// instead of reimplementing the OS-Login-vs-metadata decision ourselves.
///
/// `--tunnel-through-iap` is required so gcloud resolves without needing the VM
/// to have an external IP; the `ProxyCommand` it prints is discarded because we
/// run our own tunnel.
fn dry_run_ssh_args(project: &str, zone: &str, instance: &str) -> Vec<String> {
    vec![
        "compute".to_string(),
        "ssh".to_string(),
        instance.to_string(),
        format!("--zone={zone}"),
        format!("--project={project}"),
        "--tunnel-through-iap".to_string(),
        "--dry-run".to_string(),
        "--quiet".to_string(),
    ]
}

/// Build the args for reading the *effective* `compute.requireOsLogin` org
/// policy. An org can enforce OS Login fleet-wide without ever writing the
/// per-resource `enable-oslogin` metadata flag, so metadata alone cannot prove
/// OS Login is off — this is the signal that can.
fn require_oslogin_policy_args(project: &str) -> Vec<String> {
    vec![
        "resource-manager".to_string(),
        "org-policies".to_string(),
        "describe".to_string(),
        "constraints/compute.requireOsLogin".to_string(),
        format!("--project={project}"),
        "--effective".to_string(),
        "--format=json".to_string(),
    ]
}

/// Read `booleanPolicy.enforced` from an effective-org-policy JSON document.
///
/// `Some(true)`  — OS Login is enforced fleet-wide.
/// `Some(false)` — the policy exists but is not enforced. GCP renders an
///                 unenforced boolean policy as `{"booleanPolicy": {}}`, so an
///                 absent `enforced` key means *not* enforced, not "unknown".
/// `None`        — no answer (403 from a tenant without `orgpolicy.policy.get`,
///                 malformed output, …). The caller degrades to the local
///                 username rather than treating "unknown" as "enforced".
pub(crate) fn parse_require_oslogin_policy(json: &str) -> Option<bool> {
    let v: serde_json::Value = serde_json::from_str(json.trim()).ok()?;
    let boolean_policy = v.get("booleanPolicy")?;
    Some(
        boolean_policy
            .get("enforced")
            .and_then(|e| e.as_bool())
            .unwrap_or(false),
    )
}

/// Blank out double-quoted spans, preserving length and whitespace positions.
///
/// `gcloud compute ssh --dry-run` embeds a `ProxyCommand="…"` whose value holds
/// both spaces and (in some gcloud builds) an `@`. Masking it lets the caller
/// tokenize on whitespace and scan for `@` without the ProxyCommand's contents
/// masquerading as the `user@host` argument or as a flag.
fn mask_quoted_spans(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut in_quotes = false;
    for c in line.chars() {
        if c == '"' {
            in_quotes = !in_quotes;
            out.push(' ');
        } else if in_quotes {
            // Keep the character count stable so byte offsets still line up,
            // but make sure the masked text can never be read as a token.
            out.push('\u{0}');
        } else {
            out.push(c);
        }
    }
    out
}

/// Extract `(user, key_path)` from the ssh command line that
/// `gcloud compute ssh --dry-run` prints.
///
/// Returns `None` when no usable login name is present — the caller then falls
/// back to in-house detection. A missing `-i` is *not* fatal: the username is
/// the part that was getting this wrong, and the caller already knows the
/// conventional key path via `ensure_ssh_key()`.
pub(crate) fn parse_dry_run_ssh_command(stdout: &str) -> Option<(String, Option<PathBuf>)> {
    // gcloud may print warnings (NumPy advice, updater notices) before the
    // command, and on some builds prints the `start-iap-tunnel` ProxyCommand
    // subprocess on its OWN last line — so the ssh command is NOT reliably the
    // last non-empty line (this is what broke username detection on gcloud
    // 530.x). Scan every line, last-first (the real ssh command is near the
    // end), and take the first whose final token is a valid `user@host`.
    for line in stdout.lines().rev() {
        if line.trim().is_empty() {
            continue;
        }
        let masked = mask_quoted_spans(line);
        let tokens: Vec<&str> = masked.split_whitespace().collect();

        // `user@host` is the final positional argument of the ssh command line.
        let Some(last) = tokens.last() else { continue };
        let Some((user, _host)) = last.rsplit_once('@') else {
            continue;
        };
        if !is_valid_ssh_username(user) {
            continue;
        }

        // Found the ssh command line. `-i <path>` — read the identity file from
        // the *unmasked* line so a path containing spaces (which gcloud quotes)
        // survives. Fall back to the masked token when the value is unquoted.
        let key = extract_identity_file(line)
            .or_else(|| {
                tokens
                    .iter()
                    .position(|t| *t == "-i")
                    .and_then(|i| tokens.get(i + 1))
                    .map(|p| PathBuf::from(*p))
            })
            .filter(|p| {
                // On Windows gcloud emits a PuTTY/plink command line when PuTTY is
                // installed, pointing `-i` at the `.ppk` copy of the key. We always
                // spawn OpenSSH's ssh.exe, which cannot read PuTTY format and fails
                // with `Permission denied (publickey)`. Drop it so the caller keeps
                // the OpenSSH key (same material, no extension).
                let is_putty = p.extension().is_some_and(|e| e.eq_ignore_ascii_case("ppk"));
                if is_putty {
                    log::info!(
                        "gcloud-iap: ignoring PuTTY-format key {p:?} from --dry-run; \
                         ssh.exe needs the OpenSSH key"
                    );
                }
                !is_putty
            });

        return Some((user.to_string(), key));
    }
    None
}

/// Pull the value following `-i` out of a raw ssh command line, honoring a
/// quoted path (gcloud quotes any path containing spaces).
fn extract_identity_file(line: &str) -> Option<PathBuf> {
    let idx = line.find(" -i ")?;
    let rest = line[idx + 4..].trim_start();
    if let Some(stripped) = rest.strip_prefix('"') {
        let end = stripped.find('"')?;
        return Some(PathBuf::from(&stripped[..end]));
    }
    let end = rest.find(char::is_whitespace).unwrap_or(rest.len());
    let path = &rest[..end];
    if path.is_empty() {
        None
    } else {
        Some(PathBuf::from(path))
    }
}

/// How much of ssh's own output to retain for failure diagnosis. Authentication
/// failures are terse; this is generous enough to also catch a login banner
/// printed ahead of the error.
const SSH_TRANSCRIPT_CAPTURE_BYTES: usize = 2048;

/// Truncate `s` to at most `max` bytes without splitting a UTF-8 character.
/// `String::truncate` panics on a non-boundary index, and PTY reads split
/// multi-byte sequences routinely.
pub(crate) fn truncate_on_char_boundary(s: &mut String, max: usize) {
    if s.len() <= max {
        return;
    }
    let mut cut = max;
    while cut > 0 && !s.is_char_boundary(cut) {
        cut -= 1;
    }
    s.truncate(cut);
}

/// Reduce raw PTY output to the plain text a human needs to read a failure.
///
/// ssh under ConPTY opens with a screen-clear and cursor-positioning burst; left
/// intact it fills the capture budget with control codes and pads the log with
/// scores of blank lines, burying the one line that matters (as it did on the
/// first run of this diagnostic). Strips CSI/OSC escapes and collapses the
/// resulting whitespace.
pub(crate) fn sanitize_terminal_output(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut chars = raw.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '\u{1b}' {
            // Keep newlines; drop the other C0 controls (BEL, backspace, …).
            if c == '\n' || c == '\t' || !c.is_control() {
                out.push(c);
            }
            continue;
        }
        match chars.next() {
            // CSI — parameters/intermediates, then a final byte in @..~
            Some('[') => {
                for e in chars.by_ref() {
                    if ('\u{40}'..='\u{7e}').contains(&e) {
                        break;
                    }
                }
            }
            // OSC — runs until BEL or ST (ESC \)
            Some(']') => {
                while let Some(e) = chars.next() {
                    if e == '\u{7}' {
                        break;
                    }
                    if e == '\u{1b}' && chars.peek() == Some(&'\\') {
                        chars.next();
                        break;
                    }
                }
            }
            // Any other two-character escape is consumed whole.
            _ => {}
        }
    }
    // Collapse the blank-line runs the cleared screen leaves behind.
    out.lines()
        .map(str::trim_end)
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join(" | ")
}

/// Turn a raw ssh failure into a plain-language explanation, when we recognize
/// the cause. Returns `None` for anything unrecognized so the terminal output
/// (which the user already sees) stays the sole account of it.
pub(crate) fn explain_ssh_failure(output: &str, user: &str) -> Option<String> {
    if output.contains("Permission denied (publickey") {
        return Some(format!(
            "SSH rejected the login name '{user}'. HoTTY tried to register this \
             machine's key with the VM automatically; if it still fails, the VM is \
             likely provisioned under a different account, or you lack permission to \
             update its metadata. Set the SSH user explicitly in New Connection → GCP, \
             or run `gcloud compute ssh <instance> --tunnel-through-iap` once."
        ));
    }
    if output.contains("Too many authentication failures") {
        return Some(format!(
            "SSH refused the connection for '{user}' after too many key attempts. \
             An ssh-agent is likely offering unrelated keys first."
        ));
    }
    None
}

/// Build the args for `gcloud compute project-info describe` that yield only
/// `commonInstanceMetadata.items` as JSON.
fn project_oslogin_describe_args(project: &str) -> Vec<String> {
    vec![
        "compute".to_string(),
        "project-info".to_string(),
        "describe".to_string(),
        format!("--project={project}"),
        "--format=json(commonInstanceMetadata.items)".to_string(),
    ]
}

/// Walk `json[container]["items"]` looking for an object whose `key` field
/// equals `item_key`, and return its `value` string. Returns `None` if any
/// step in the path is missing — including when the key simply isn't set.
///
/// This replaces the legacy `--format=value(...filter("key:X")...)` projection
/// which embeds `"` in the argument and is unsafe when gcloud.cmd is invoked
/// via cmd.exe (see `run_gcloud_capture`'s doc).
fn extract_metadata_value(json: &str, container_key: &str, item_key: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(json.trim()).ok()?;
    let items = v.get(container_key)?.get("items")?.as_array()?;
    for item in items {
        if item.get("key").and_then(|k| k.as_str()) == Some(item_key) {
            return item
                .get("value")
                .and_then(|val| val.as_str())
                .map(String::from);
        }
    }
    None
}

/// Read the `enable-oslogin` metadata flag from project or instance scope.
/// Returns `true` only when explicitly set to TRUE; missing or any other value
/// counts as not-enabled. Returns `Some(true)` / `Some(false)` when the
/// metadata read succeeds (TRUE / FALSE / empty respectively), and `None`
/// when *both* the instance and project describe calls fail (auth, network,
/// or insufficient `compute.instances.get` / `compute.projects.get`
/// permissions).
///
/// **Important:** the per-resource flag does NOT capture org-level OS Login
/// enforcement (`constraints/compute.requireOsLogin`), so a `Some(false)` return
/// does not by itself prove OS Login is off. Resolve that with
/// `org_policy_requires_oslogin()`.
///
/// What callers must NOT do is treat the existence of an OS Login POSIX profile
/// as evidence that OS Login is on. Google auto-creates a profile for
/// essentially every account — including accounts whose only registered key
/// belongs to an unrelated machine — so that test answers "OS Login" almost
/// always. Doing exactly that is what broke IAP login in v2.0.3-beta4
/// (`e7a36216`): the VM provisions users from metadata `ssh-keys` only, the
/// POSIX name has no account there, and ssh exits 255 with
/// `Permission denied (publickey)`.
///
/// Per Google's resolution order, the **instance** metadata value (if any)
/// overrides the project metadata value. We honor that here.
async fn is_oslogin_enabled(project: &str, zone: &str, instance: &str) -> Option<bool> {
    // 1. Instance metadata (highest priority)
    let inst_args = instance_oslogin_describe_args(project, zone, instance);
    let inst_result = run_gcloud_capture(&inst_args, Duration::from_secs(10)).await;
    if let Ok(out) = &inst_result {
        // Debug-log the raw JSON so misclassifications (e.g. org-level
        // enforcement vs. per-resource flag) can be diagnosed from logs.
        // The projection limits this to `metadata.items`, so output is small.
        log::debug!(
            "gcloud-iap: instance describe JSON (metadata.items) = {}",
            out.trim()
        );
        let val = extract_metadata_value(out, "metadata", "enable-oslogin");
        log::debug!("gcloud-iap: instance enable-oslogin extracted = {val:?}");
        if let Some(val) = val {
            return Some(val.eq_ignore_ascii_case("TRUE"));
        }
        // Key absent on the instance; fall through to project metadata.
    }
    // 2. Project metadata (fallback)
    let proj_args = project_oslogin_describe_args(project);
    match run_gcloud_capture(&proj_args, Duration::from_secs(10)).await {
        Ok(out) => {
            log::debug!(
                "gcloud-iap: project-info describe JSON (commonInstanceMetadata.items) = {}",
                out.trim()
            );
            let val = extract_metadata_value(&out, "commonInstanceMetadata", "enable-oslogin");
            log::debug!("gcloud-iap: project enable-oslogin extracted = {val:?}");
            // Key found → TRUE/FALSE; key absent → treat as not-enabled at
            // the metadata layer (the caller still probes POSIX profile to
            // catch org-level enforcement).
            Some(val.map(|v| v.eq_ignore_ascii_case("TRUE")).unwrap_or(false))
        }
        Err(_) => {
            // Both describes failed. If the instance describe also failed (not
            // just empty), we have no signal at all — return None.
            if inst_result.is_err() {
                None
            } else {
                Some(false)
            }
        }
    }
}

/// Look up the active gcloud account's OS Login POSIX username **for the target
/// project**. Only call this once OS Login has actually been established as
/// enabled — a profile exists for practically every account, so its presence
/// proves nothing on its own (see `is_oslogin_enabled`'s doc).
///
/// The `--project` scoping matters: without it gcloud answers for whatever the
/// active default project happens to be, which is routinely a different project
/// than the one being connected to.
async fn resolve_oslogin_username(project: &str) -> Option<String> {
    let args = vec![
        "compute".to_string(),
        "os-login".to_string(),
        "describe-profile".to_string(),
        format!("--project={project}"),
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

/// Is OS Login enforced fleet-wide by org policy? `None` when we can't tell —
/// typically a 403 from a tenant that doesn't grant `orgpolicy.policy.get`.
async fn org_policy_requires_oslogin(project: &str) -> Option<bool> {
    let args = require_oslogin_policy_args(project);
    let out = run_gcloud_capture(&args, Duration::from_secs(10))
        .await
        .ok()?;
    let parsed = parse_require_oslogin_policy(&out);
    log::debug!("gcloud-iap: requireOsLogin effective policy = {parsed:?}");
    parsed
}

fn fallback_local_username() -> String {
    std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_else(|_| "user".to_string())
}

/// The active gcloud account email (e.g. `alice.smith@example.com`). Cheap
/// — reads local gcloud config, no network. `None` if unset/unreadable.
async fn active_account_email() -> Option<String> {
    let args = vec![
        "config".to_string(),
        "get-value".to_string(),
        "account".to_string(),
    ];
    let out = run_gcloud_capture(&args, Duration::from_secs(10))
        .await
        .ok()?;
    let email = out.trim();
    if email.is_empty() || email.eq_ignore_ascii_case("(unset)") {
        None
    } else {
        Some(email.to_string())
    }
}

/// Derive a POSIX-ish login name from a gcloud account email the way a metadata
/// SSH setup is typically named: the local-part, lowercased, with any character
/// outside `[a-z0-9_-]` replaced by `_` (e.g. `Alice.Smith@example.com` →
/// `alice_smith`). `None` when the result isn't a valid ssh username
/// (e.g. an empty local-part). A Tier-3 fallback only: when gcloud's `--dry-run`
/// gives a username it is used verbatim instead (see `resolve_ssh_identity`),
/// which is what the VM's metadata SSH key is actually provisioned under.
fn username_from_email(email: &str) -> Option<String> {
    let local = email.split('@').next()?.to_ascii_lowercase();
    let mut name: String = local
        .chars()
        .map(|c| {
            if c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();
    name.truncate(32);
    if is_valid_ssh_username(&name) {
        Some(name)
    } else {
        None
    }
}

/// The ssh identity for one connection, plus which tier produced it. `source` is
/// logged next to any ssh failure so a bug report says how the name was chosen
/// without needing to reproduce the resolution.
struct SshIdentity {
    user: String,
    key_path: PathBuf,
    source: &'static str,
}

/// Decide the SSH login name and identity file, in three tiers.
///
/// 1. **Override** — an explicit username from the connection config wins and
///    skips every gcloud call.
/// 2. **Delegate** — ask `gcloud compute ssh --dry-run` what it would do. This
///    is the authority on *which account and key to use*: it resolves OS Login
///    vs. metadata and org policy for us, and replaces the three describes tier
///    3 makes. Verified 2026-07-24: `--dry-run` is strictly read-only — unlike a
///    real `gcloud compute ssh` it does **not** register the public key with OS
///    Login or write it into project metadata. So on a machine whose key was
///    never registered, this tier returns a correct username with a key the VM
///    won't accept; `explain_ssh_failure` tells the user to run
///    `gcloud compute ssh` once. Do not assume delegation covers enrollment.
/// 3. **In-house** — only when the dry run fails or can't be parsed. Metadata
///    (instance, then project), then effective org policy, then the local
///    username. Deliberately does *not* consult the OS Login POSIX profile
///    unless one of those established OS Login is on.
///
/// Never fails: the worst case is the local username, which is what a
/// metadata-based project wants anyway.
async fn resolve_ssh_identity(config: &GcloudIapConfig, default_key: PathBuf) -> SshIdentity {
    let phase = std::time::Instant::now();

    // Tier 1 — explicit override. Already validated by `GcloudIapConfig::validate`.
    if let Some(user) = config.username_override() {
        log::info!("gcloud-iap: using explicit SSH username '{user}' from connection config");
        return SshIdentity {
            user: user.to_string(),
            key_path: default_key,
            source: "override",
        };
    }

    // Tier 2 — delegate to gcloud.
    let dry_args = dry_run_ssh_args(&config.project, &config.zone, &config.instance);
    match run_gcloud_capture(&dry_args, Duration::from_secs(45)).await {
        Ok(out) => match parse_dry_run_ssh_command(&out) {
            // gcloud's default login is digit-leading (e.g. an all-numeric
            // corporate AD id like `12345678`). The VM guest agent provisions
            // metadata-SSH accounts with `useradd`, which rejects digit-leading
            // names, so such a user can never be created and ssh is always
            // refused — confirmed 2026-07-24: `gcloud compute ssh` itself fails
            // as `12345678` but works as the email-derived `alice_smith`.
            // Ignore it and fall through to Tier 3, which prefers the
            // email-derived, letter-leading name the guest agent CAN provision.
            Some((user, _)) if user.starts_with(|c: char| c.is_ascii_digit()) => {
                log::info!(
                    "gcloud-iap: dry-run username '{user}' is digit-leading and not a \
                     provisionable Linux account; falling back to an email-derived name"
                );
            }
            Some((user, key)) => {
                let key_path = key.unwrap_or(default_key);
                log::info!(
                    "gcloud-iap: resolved via `gcloud compute ssh --dry-run` in {:?}: user='{user}' key={key_path:?}",
                    phase.elapsed()
                );
                return SshIdentity {
                    user,
                    key_path,
                    source: "dry-run",
                };
            }
            None => log::warn!(
                "gcloud-iap: could not parse `gcloud compute ssh --dry-run` output; \
                 falling back to metadata detection. Output was: {}",
                out.trim()
            ),
        },
        Err(e) => log::warn!(
            "gcloud-iap: `gcloud compute ssh --dry-run` failed ({e}); \
             falling back to metadata detection"
        ),
    }

    // Tier 3 — in-house detection.
    let enabled = match is_oslogin_enabled(&config.project, &config.zone, &config.instance).await {
        Some(explicit) => {
            log::info!("gcloud-iap: enable-oslogin metadata says {explicit}");
            explicit
        }
        None => {
            log::warn!("gcloud-iap: enable-oslogin metadata unreadable; checking org policy");
            false
        }
    };
    // Metadata that doesn't say TRUE still can't rule OS Login out — an org can
    // enforce it fleet-wide without writing the per-resource flag. Ask the
    // effective policy; an unreadable policy means "not enforced" rather than a
    // guess, because guessing here is exactly what broke v2.0.3-beta4.
    let enabled = enabled || org_policy_requires_oslogin(&config.project).await == Some(true);

    if enabled {
        // Register the key on every connect, not just when we generated it —
        // OS Login only accepts keys present in the account's profile, and the
        // key usually predates this connection.
        let pub_path = default_key.with_extension("pub");
        if let Err(e) = push_key_to_oslogin(&pub_path).await {
            log::warn!("gcloud-iap: push_key_to_oslogin failed (non-fatal): {e}");
        }
        if let Some(user) = resolve_oslogin_username(&config.project).await {
            log::info!(
                "gcloud-iap: OS Login is on; using POSIX username '{user}' (resolved in {:?})",
                phase.elapsed()
            );
            return SshIdentity {
                user,
                key_path: default_key,
                source: "oslogin",
            };
        }
        log::warn!("gcloud-iap: OS Login is on but the POSIX profile lookup failed");
    }

    // OS Login off. Prefer a name derived from the gcloud ACCOUNT email over the
    // raw local OS login: on a corporate PC the OS login is an opaque AD id (e.g.
    // `12345678`) that is a poor Linux account and rarely what metadata SSH is
    // provisioned under, whereas the email-derived form is. Because `connect()`
    // enrolls the key under whatever name we return here, either is self-consistent.
    if let Some(email) = active_account_email().await {
        if let Some(user) = username_from_email(&email) {
            log::info!(
                "gcloud-iap: OS Login is off; using account-derived username '{user}' (from {email}, resolved in {:?})",
                phase.elapsed()
            );
            return SshIdentity {
                user,
                key_path: default_key,
                source: "email",
            };
        }
    }

    let user = fallback_local_username();
    log::info!(
        "gcloud-iap: OS Login is off; using local username '{user}' (resolved in {:?})",
        phase.elapsed()
    );
    SshIdentity {
        user,
        key_path: default_key,
        source: "local",
    }
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
        std::fs::create_dir_all(ssh_dir)
            .map_err(|e| SessionError::ConnectionFailed(format!("failed to create ~/.ssh: {e}")))?;
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
        .map_err(|e| SessionError::ConnectionFailed(humanize_spawn_error("ssh-keygen", &e)))?;
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
        .map_err(|_| SessionError::ConnectionFailed("USERNAME / USER env var not set".into()))?;

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
        .map_err(|e| SessionError::ConnectionFailed(humanize_spawn_error("icacls", &e)))?;
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

/// The base64 body (second field) of an OpenSSH public-key line — the stable,
/// unique part used to test whether a key is already in `ssh-keys` metadata.
fn ssh_pubkey_body(pubkey: &str) -> Option<&str> {
    pubkey.split_whitespace().nth(1)
}

/// Current Unix time in seconds, or `None` if the clock is before the epoch.
fn now_unix_secs() -> Option<i64> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_secs() as i64)
}

/// Days since the Unix epoch for a proleptic-Gregorian civil date
/// (Howard Hinnant's `days_from_civil`; no leap-table, valid for any year).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = (if y >= 0 { y } else { y - 399 }) / 400;
    let yoe = y - era * 400; // [0, 399]
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1; // [0, 365]
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy; // [0, 146096]
    era * 146_097 + doe - 719_468
}

/// Parse the `YYYY-MM-DDThh:mm:ss` prefix of an RFC3339 timestamp to a Unix
/// epoch. Any trailing timezone is treated as UTC — gcloud emits `+0000`.
/// Dependency-free (no chrono/time in the tree) and unit-tested.
fn rfc3339_utc_to_epoch(s: &str) -> Option<i64> {
    if s.len() < 19 {
        return None;
    }
    let num = |a: usize, z: usize| -> Option<i64> { s.get(a..z)?.parse().ok() };
    let (y, mo, d) = (num(0, 4)?, num(5, 7)?, num(8, 10)?);
    let (h, mi, sec) = (num(11, 13)?, num(14, 16)?, num(17, 19)?);
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) || h > 23 || mi > 59 || sec > 60 {
        return None;
    }
    Some(days_from_civil(y, mo, d) * 86_400 + h * 3_600 + mi * 60 + sec)
}

/// Pull `expireOn` out of a metadata ssh-key line's `google-ssh {…}` trailer and
/// parse it to a Unix epoch. `None` when there is no `expireOn` (a persistent
/// key that never expires).
fn parse_expire_on_epoch(line: &str) -> Option<i64> {
    let idx = line.find("\"expireOn\"")?;
    let after_colon = line[idx..].split_once(':')?.1.trim_start();
    let inner = after_colon.strip_prefix('"')?;
    let end = inner.find('"')?;
    rfc3339_utc_to_epoch(&inner[..end])
}

/// True if this ssh-key line's `expireOn` is at or before `now_epoch`. Lines
/// without an `expireOn` are persistent and never expire.
fn ssh_key_entry_expired_at(line: &str, now_epoch: i64) -> bool {
    parse_expire_on_epoch(line).is_some_and(|exp| exp <= now_epoch)
}

/// Does the `ssh-keys` metadata value bind `key_body` to `user` in an entry that
/// is still valid at `now_epoch`? Requires a line `user:<type> <key_body>…` whose
/// optional `expireOn` is in the future. A body match under a *different*
/// username, or an expired entry, does NOT count — the guest agent has no live
/// authorized_key for us then, so the caller must (re-)enroll. Pure, for tests.
fn ssh_keys_have_live_entry(value: &str, user: &str, key_body: &str, now_epoch: i64) -> bool {
    let prefix = format!("{user}:");
    value.lines().any(|line| {
        let line = line.trim();
        line.starts_with(&prefix)
            && line.contains(key_body)
            && !ssh_key_entry_expired_at(line, now_epoch)
    })
}

/// Is a **live** (non-expired) key for `user` with body `key_body` already in the
/// instance- or project-level `ssh-keys` metadata? Best-effort: a describe error
/// → `false` so the caller enrolls. Fixes the 2026-07-24 IAP failures where a
/// body-only check skipped enrollment while the only key present was expired and
/// bound to a different user.
async fn metadata_has_ssh_key(config: &GcloudIapConfig, user: &str, key_body: &str) -> bool {
    // Clock failure → treat every entry as expired so we enroll rather than trust
    // a key we can't date-check.
    let now = now_unix_secs().unwrap_or(i64::MAX);
    let inst_args = instance_oslogin_describe_args(&config.project, &config.zone, &config.instance);
    if let Ok(out) = run_gcloud_capture(&inst_args, Duration::from_secs(10)).await {
        if extract_metadata_value(&out, "metadata", "ssh-keys")
            .is_some_and(|v| ssh_keys_have_live_entry(&v, user, key_body, now))
        {
            return true;
        }
    }
    let proj_args = project_oslogin_describe_args(&config.project);
    if let Ok(out) = run_gcloud_capture(&proj_args, Duration::from_secs(10)).await {
        if extract_metadata_value(&out, "commonInstanceMetadata", "ssh-keys")
            .is_some_and(|v| ssh_keys_have_live_entry(&v, user, key_body, now))
        {
            return true;
        }
    }
    false
}

/// Build the args for the metadata-enrollment `gcloud compute ssh`. Passing
/// `{user}@{instance}` makes gcloud register the key under the SAME name HoTTY
/// will connect as (connect-user == enrolled-user); `--command=true` makes it a
/// no-op login. Extracted (pure) for the metacharacter-safety unit test.
fn enroll_ssh_args(user: &str, project: &str, zone: &str, instance: &str) -> Vec<String> {
    vec![
        "compute".to_string(),
        "ssh".to_string(),
        format!("{user}@{instance}"),
        format!("--zone={zone}"),
        format!("--project={project}"),
        "--tunnel-through-iap".to_string(),
        "--command=true".to_string(),
        "--quiet".to_string(),
    ]
}

/// Register this machine's SSH public key in the VM/project metadata by
/// delegating to a real `gcloud compute ssh …@… --command=true`. gcloud does the
/// correct read-modify-write of `ssh-keys` (preserving other users' keys and
/// honoring `block-project-ssh-keys` + IAM) — reimplementing that here would risk
/// clobbering shared metadata. Best-effort: a failure (e.g. no setMetadata
/// permission) is logged; the caller's own ssh then tries and `explain_ssh_failure`
/// guides the user if it still fails.
async fn enroll_metadata_ssh_key(config: &GcloudIapConfig, user: &str) {
    let args = enroll_ssh_args(user, &config.project, &config.zone, &config.instance);
    // Generous deadline: this opens its own IAP tunnel, so it is much slower than
    // the read-only describes.
    match run_gcloud_capture(&args, Duration::from_secs(90)).await {
        Ok(_) => log::info!(
            "gcloud-iap: metadata ssh-key enrollment via `gcloud compute ssh` succeeded for '{user}'"
        ),
        Err(e) => {
            log::warn!("gcloud-iap: metadata ssh-key enrollment failed (non-fatal): {e}")
        }
    }
}

/// For OS-Login-off VMs, ensure a **live** public key for `user` is in the VM
/// metadata before we ssh — gcloud only auto-registers metadata keys during a
/// real `gcloud compute ssh`, and HoTTY runs its own ssh, so a fresh (or
/// expired) machine otherwise hits `Permission denied (publickey)`. Skips only
/// when a non-expired key bound to `user` is already present; a body match under
/// a different username, or an expired entry, still triggers (re-)enrollment.
async fn ensure_metadata_key_enrolled(
    app: &AppHandle,
    session_id: &str,
    config: &GcloudIapConfig,
    user: &str,
    priv_key_path: &Path,
) {
    let pub_path = priv_key_path.with_extension("pub");
    let pubkey = match std::fs::read_to_string(&pub_path) {
        Ok(s) => s,
        Err(e) => {
            log::warn!("gcloud-iap: cannot read pubkey {pub_path:?} for enrollment check: {e}");
            return;
        }
    };
    let Some(key_body) = ssh_pubkey_body(&pubkey) else {
        log::warn!("gcloud-iap: pubkey {pub_path:?} has no base64 body; skipping enrollment");
        return;
    };
    if metadata_has_ssh_key(config, user, key_body).await {
        log::info!(
            "gcloud-iap: a live ssh key for '{user}' is already in VM metadata; skipping enrollment"
        );
        return;
    }
    log::info!(
        "gcloud-iap: no live ssh key for '{user}' in VM metadata — registering (first time or expired)"
    );
    emit_iap_connect_progress(app, session_id, "enrolling");
    enroll_metadata_ssh_key(config, user).await;
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

/// The `known_hosts` file `ssh.exe` is pointed at for IAP sessions — the same
/// app-scoped file the native SSH protocol path uses, so a host key recorded by
/// either route is seen by both.
fn iap_known_hosts_path(app: &AppHandle) -> PathBuf {
    let base = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| std::env::temp_dir());
    let _ = std::fs::create_dir_all(&base);
    super::known_hosts::default_known_hosts_path(&base)
}

/// SSH client args. `-i` selects the key; the `-o` flags configure host-key
/// verification.
///
/// The tunnel terminates on a fresh `127.0.0.1:<ephemeral>` port every connect,
/// so verification is keyed on the instance name via `HostKeyAlias` rather than
/// on the dialed address — that is what makes a persistent record possible at
/// all, and it is why the port churn is *not* a reason to skip checking (the
/// previous `StrictHostKeyChecking=no` here contradicted the project rule
/// "never disable known_hosts verification"). `CheckHostIP=no` is required for
/// the same reason: without it ssh would also pin `127.0.0.1`, and the next
/// tunnel to a *different* VM would look like a host-key mismatch.
///
/// `accept-new` is trust-on-first-use: record silently on first connect, and
/// refuse loudly if the key later changes. `LogLevel=ERROR` hides the routine
/// "Permanently added" notice while still surfacing a mismatch.
fn build_ssh_argv(
    user: &str,
    port: u16,
    key_path: &str,
    instance: &str,
    known_hosts: &Path,
) -> Vec<String> {
    // OpenSSH splits an unquoted UserKnownHostsFile value on whitespace into
    // several filenames; the app config dir can contain spaces, so quote it.
    let known_hosts = format!("UserKnownHostsFile=\"{}\"", known_hosts.display());
    vec![
        "-i".into(),
        key_path.into(),
        "-p".into(),
        port.to_string(),
        "-o".into(),
        "StrictHostKeyChecking=accept-new".into(),
        "-o".into(),
        known_hosts,
        "-o".into(),
        "GlobalKnownHostsFile=NUL".into(),
        "-o".into(),
        "CheckHostIP=no".into(),
        "-o".into(),
        "LogLevel=ERROR".into(),
        // Pin the host key to <instance> rather than the ephemeral tunnel
        // address; also identifies the target in audit logs.
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
    log::info!("gcloud-iap: start_iap_tunnel begin session={session_id} argv={args:?}");

    let mut cmd = build_gcloud_command(&args);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.kill_on_drop(true);

    let mut child = cmd.spawn().map_err(|e| {
        log::error!("gcloud-iap: failed to spawn gcloud subprocess: {e}");
        SessionError::ConnectionFailed(humanize_spawn_error("gcloud", &e))
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

    let ctx = TunnelReadyCtx {
        gcloud_pid,
        phase_start,
        app,
        session_id,
        pick_re,
        regexes,
    };

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
                            if let LineOutcome::PortReady(p) = process_tunnel_line(
                                &ctx,
                                "stdout",
                                &line,
                                &mut combined_log,
                                &mut picked_port,
                                &mut picked_at,
                            ) {
                                return Ok::<u16, SessionError>(p);
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
                            if let LineOutcome::PortReady(p) = process_tunnel_line(
                                &ctx,
                                "stderr",
                                &line,
                                &mut combined_log,
                                &mut picked_port,
                                &mut picked_at,
                            ) {
                                return Ok::<u16, SessionError>(p);
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
    let mut map = vm_start_prompts()
        .lock()
        .expect("vm_start_prompts poisoned");
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
        let mut map = vm_start_prompts()
            .lock()
            .expect("vm_start_prompts poisoned");
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
    record_status_in_gcp_cache(app, config, status.as_str());

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
                format!("VM is {current}. Waiting for user approval to start...\r\n"),
            );
            let rx = register_vm_start_prompt(session_id);
            let payload = IapVmStartPromptPayload {
                session_id: session_id.to_string(),
                project: config.project.clone(),
                zone: config.zone.clone(),
                instance: config.instance.clone(),
                current_status: current.clone(),
            };
            // Target the owning window only. A broadcast would pop a blocking
            // approval modal in every window for a session they don't own — and
            // a foreign window answering it would resolve (or wrongly decline)
            // this connection. If delivery fails, the prompt-timeout below still
            // cleans up.
            emit_to_owner(app, session_id, "iap-vm-start-prompt", payload);
            let approved = match timeout(Duration::from_secs(VM_START_PROMPT_TIMEOUT_SECS), rx)
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

/// Mirror a status observed by the connect pre-flight into the shared GCP
/// discovery cache, so the GCP pane doesn't keep showing TERMINATED for a VM
/// this connection just booted. Best-effort: the cache is absent in tests and
/// a VM that was never discovered simply isn't in it.
fn record_status_in_gcp_cache(app: &AppHandle, config: &GcloudIapConfig, status: &str) {
    if let Some(cache) = app.try_state::<Arc<iap_tunnel::GcloudCacheState>>() {
        cache.record_instance_status(&config.project, &config.zone, &config.instance, status);
    }
}

async fn run_wait_loop(
    app: &AppHandle,
    session_id: &str,
    config: &GcloudIapConfig,
) -> Result<(), String> {
    let app_cb = app.clone();
    let sid_cb = session_id.to_string();
    let config_cb = config.clone();
    iap_tunnel::wait_for_status_running(
        &config.project,
        &config.zone,
        &config.instance,
        move |event| match event {
            WaitEvent::Polling { status, elapsed } => {
                record_status_in_gcp_cache(&app_cb, &config_cb, status.as_str());
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
                record_status_in_gcp_cache(&app_cb, &config_cb, InstanceStatus::Running.as_str());
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
    async fn connect(&mut self, app: AppHandle, session_id: String) -> Result<(), SessionError> {
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
        // NOTE: key registration is NOT done here. It belongs to whichever
        // resolution tier concludes OS Login is in play — gating it on
        // `generated` (as this did until v2.0.13) meant any machine with a
        // pre-existing ~/.ssh/google_compute_engine never registered its key at
        // all. See `resolve_ssh_identity`.
        //
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
        // --- Resolve the SSH identity (login name + identity file) ---
        emit_iap_connect_progress(&app, &session_id, "resolving");
        let identity = resolve_ssh_identity(&self.config, priv_key_path).await;
        let user = identity.user;
        let source = identity.source;
        let key_path = identity.key_path;
        let priv_key_str = key_path
            .to_str()
            .ok_or_else(|| SessionError::ConnectionFailed("non-UTF8 key path".into()))?
            .to_string();

        // For OS-Login-off VMs, ensure this machine's public key is in the VM
        // metadata before we ssh — gcloud only auto-registers it during a real
        // `gcloud compute ssh`, so a fresh machine otherwise always hits
        // `Permission denied (publickey)`. Skipped when OS Login is on (the key
        // was already pushed to the account profile during resolution).
        if source != "oslogin" {
            ensure_metadata_key_enrolled(&app, &session_id, &self.config, &user, &key_path).await;
        }

        // --- Pre-flight: ensure the VM is RUNNING (start or wait if needed) ---
        if let Err(e) = ensure_vm_running(&app, &session_id, &self.config).await {
            drop_vm_start_prompt(&session_id);
            log::warn!("gcloud-iap: ensure_vm_running failed: {e}");
            return Err(SessionError::ConnectionFailed(e));
        }

        // --- Start the IAP tunnel ---
        emit_iap_connect_progress(&app, &session_id, "tunnel");
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

        emit_iap_connect_progress(&app, &session_id, "authenticating");

        // --- Build the ssh.exe command for the PTY ---
        let argv = build_ssh_argv(
            &user,
            port,
            &priv_key_str,
            &self.config.instance,
            &iap_known_hosts_path(&app),
        );
        log::info!("gcloud-iap: ssh.exe argv={argv:?} (ssh_exe={ssh_exe:?})");

        // Human name for the ssh binary, reused in all PTY/spawn error messages.
        let ssh_program = ssh_exe.display().to_string();

        let pty_system = native_pty_system();
        let pty_pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| SessionError::ConnectionFailed(humanize_pty_error(&ssh_program, &e)))?;

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
            SessionError::ConnectionFailed(humanize_spawn_error(&ssh_program, &e))
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
            .map_err(|e| SessionError::ConnectionFailed(humanize_pty_error(&ssh_program, &e)))?;
        let writer = pty_pair
            .master
            .take_writer()
            .map_err(|e| SessionError::ConnectionFailed(humanize_pty_error(&ssh_program, &e)))?;

        // Keep master alive for resize
        let master = Arc::new(Mutex::new(pty_pair.master));

        let (tx, mut rx) = mpsc::channel::<WriterCmd>(64);
        self.writer_tx = Some(tx);

        emit_session_status(&app, &session_id, "connected");

        // Head of ssh's own output, shared with the watcher task. Without this
        // an authentication failure leaves nothing in HoTTY.log but a byte
        // count — the reason diagnosing the v2.0.3-beta4 username regression
        // required querying GCP by hand.
        let transcript = Arc::new(std::sync::Mutex::new(String::new()));

        // --- Child watcher task ---
        // On Windows ConPTY, the master reader may not get EOF when the child
        // exits unless we actively wait. Spawn a watcher that blocks on
        // child.wait() and emits disconnected once ssh terminates.
        let log_mgr: super::log_manager::LogManager = app
            .state::<super::log_manager::LogManager>()
            .inner()
            .clone();
        let app_w = app.clone();
        let sid_w = session_id.clone();
        let log_mgr_w = log_mgr.clone();
        let transcript_w = transcript.clone();
        let user_w = user.clone();
        let source_w = identity.source;
        let watcher_join = tokio::spawn(async move {
            let exit_result = tokio::task::spawn_blocking(move || {
                let mut child = child;
                child.wait()
            })
            .await;
            match exit_result {
                Ok(Ok(status)) if status.success() => {
                    log::info!("gcloud-iap[ssh pid={ssh_pid}] {sid_w}: ssh exited: {status:?}")
                }
                Ok(Ok(status)) => {
                    // Non-zero exit: report *why*, not just that it happened.
                    let output = transcript_w.lock().map(|t| t.clone()).unwrap_or_default();
                    log::warn!(
                        "gcloud-iap[ssh pid={ssh_pid}] {sid_w}: ssh exited: {status:?} \
                         (user='{user_w}' resolved via {source_w}). ssh said: {output}"
                    );
                    if let Some(hint) = explain_ssh_failure(&output, &user_w) {
                        emit_session_error(&app_w, &sid_w, hint);
                    }
                }
                Ok(Err(e)) => {
                    log::warn!("gcloud-iap[ssh pid={ssh_pid}] {sid_w}: child.wait error: {e}")
                }
                Err(e) => {
                    log::warn!("gcloud-iap[ssh pid={ssh_pid}] {sid_w}: child wait task error: {e}")
                }
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
            log::info!("gcloud-iap[ssh pid={ssh_pid}] reader task started for {sid}");
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
                        // Retain only the head, and only the readable part of
                        // it — an authentication failure says everything it has
                        // to say in the first few lines, and an interactive
                        // session must not be buffered wholesale. Sanitizing
                        // before the cap matters: ssh's opening screen-clear
                        // burst would otherwise consume the whole budget in
                        // control codes and bury the actual error.
                        if let Ok(mut t) = transcript.lock() {
                            if t.len() < SSH_TRANSCRIPT_CAPTURE_BYTES {
                                let clean = sanitize_terminal_output(&text);
                                if !clean.is_empty() {
                                    if !t.is_empty() {
                                        t.push_str(" | ");
                                    }
                                    t.push_str(&clean);
                                    truncate_on_char_boundary(&mut t, SSH_TRANSCRIPT_CAPTURE_BYTES);
                                }
                            }
                        }
                        emit_session_data(&app_r, &sid, text.clone());
                        log_mgr.write(&sid, &text).await;
                    }
                    Err(e) => {
                        log::error!(
                            "gcloud-iap[ssh pid={ssh_pid}] {sid}: PTY read error after {total_bytes} bytes: {e}"
                        );
                        log_mgr.stop_logging(&sid).await;
                        emit_session_error(&app_r, &sid, humanize_read_error(&e));
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
        join_or_abort(
            std::mem::take(&mut self.join),
            "gcloud-iap",
            DISCONNECT_DRAIN_MS,
        )
        .await;
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
            abort_all(std::mem::take(&mut self.join));
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
            username: None,
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
        assert!(cfg("my-project-123", "us-central1-a", "")
            .validate()
            .is_err());
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
        let argv = build_ssh_argv(
            "alice",
            12345,
            r"C:\Users\alice\.ssh\google_compute_engine",
            "vm-01",
            Path::new(r"C:\cfg\known_hosts"),
        );
        assert!(argv.contains(&"-i".to_string()));
        assert!(argv.contains(&r"C:\Users\alice\.ssh\google_compute_engine".to_string()));
        assert!(argv.contains(&"-p".to_string()));
        assert!(argv.contains(&"12345".to_string()));
        assert!(argv.contains(&"HostKeyAlias=vm-01".to_string()));
        // The user@host element must be the final positional.
        assert_eq!(argv.last().unwrap(), "alice@localhost");
    }

    /// Host-key verification must stay ON for IAP sessions: `.claude/rules/security.md`
    /// forbids disabling known_hosts checking, and `HostKeyAlias` already makes a
    /// persistent record work despite the ephemeral tunnel port.
    #[test]
    fn build_ssh_argv_verifies_host_key_against_app_known_hosts() {
        let argv = build_ssh_argv(
            "alice",
            12345,
            r"C:\Users\alice\.ssh\google_compute_engine",
            "vm-01",
            Path::new(r"C:\cfg\known_hosts"),
        );
        // Never disabled, in any form.
        assert!(!argv.iter().any(|a| a.contains("StrictHostKeyChecking=no")));
        assert!(!argv.iter().any(|a| a == "UserKnownHostsFile=NUL"));
        assert!(argv.contains(&"StrictHostKeyChecking=accept-new".to_string()));
        // Pinned by instance, not by the ephemeral 127.0.0.1:<port> we dial.
        assert!(argv.contains(&"HostKeyAlias=vm-01".to_string()));
        assert!(argv.contains(&"CheckHostIP=no".to_string()));
        assert!(argv.contains(&r#"UserKnownHostsFile="C:\cfg\known_hosts""#.to_string()));
    }

    /// OpenSSH splits an unquoted `UserKnownHostsFile` on whitespace, so a config
    /// dir containing a space must survive as a single filename.
    #[test]
    fn build_ssh_argv_quotes_known_hosts_path_with_spaces() {
        let argv = build_ssh_argv(
            "alice",
            12345,
            "k",
            "vm-01",
            Path::new(r"C:\Users\Alice Smith\cfg\known_hosts"),
        );
        assert!(argv
            .contains(&r#"UserKnownHostsFile="C:\Users\Alice Smith\cfg\known_hosts""#.to_string()));
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

    // --- SSH username override -------------------------------------------

    /// A valid config carrying the given username override.
    fn cfg_with_user(user: Option<&str>) -> GcloudIapConfig {
        GcloudIapConfig {
            username: user.map(String::from),
            ..cfg("my-project-123", "us-central1-a", "vm-01")
        }
    }

    #[test]
    fn config_username_absent_by_default() {
        let json = r#"{"project":"my-project-123","zone":"us-central1-a","instance":"vm-01"}"#;
        let cfg: GcloudIapConfig = serde_json::from_str(json).unwrap();
        assert_eq!(cfg.username, None);
        assert_eq!(cfg.username_override(), None);
    }

    #[test]
    fn config_username_round_trips_and_trims() {
        let json =
            r#"{"project":"p-1","zone":"us-central1-a","instance":"vm-01","username":"  alice  "}"#;
        let cfg: GcloudIapConfig = serde_json::from_str(json).unwrap();
        assert_eq!(cfg.username_override(), Some("alice"));
    }

    #[test]
    fn config_blank_username_means_auto_detect() {
        // A settings field the user cleared (or typed only spaces into) must not
        // disable auto-detection — it should behave exactly like "unset".
        for blank in ["", "   ", "\t"] {
            assert_eq!(cfg_with_user(Some(blank)).username_override(), None);
        }
    }

    #[test]
    fn config_validate_accepts_posix_username() {
        // `12345678` / `1alice`: digit-leading corporate AD logins are valid — the
        // account gcloud itself uses and the VM's metadata SSH key is bound to.
        for ok in [
            "alice",
            "alice_example_com",
            "_svc",
            "a",
            "user-1",
            "12345678",
            "1alice",
        ] {
            assert!(
                cfg_with_user(Some(ok)).validate().is_ok(),
                "expected '{ok}' to validate"
            );
        }
    }

    #[test]
    fn config_validate_rejects_argv_injection_shapes() {
        // Each of these could alter the ssh.exe argv or the user@host token.
        let bad = [
            "a@b",                                      // second @ would confuse user@host parsing
            "bad user",                                 // whitespace splits the argument
            "x\ny",                                     // newline
            "-oProxyCommand",                           // leading dash reads as a flag
            "Horry",                                    // uppercase is not a POSIX login name
            "us$er",                                    // shell metacharacter
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", // 40 chars, over the cap
        ];
        for b in bad {
            assert!(
                cfg_with_user(Some(b)).validate().is_err(),
                "expected '{b}' to be rejected"
            );
        }
    }

    #[test]
    fn is_valid_ssh_username_boundary_lengths() {
        assert!(is_valid_ssh_username(&"a".repeat(32)));
        assert!(!is_valid_ssh_username(&"a".repeat(33)));
        assert!(!is_valid_ssh_username(""));
    }

    #[test]
    fn is_valid_ssh_username_accepts_digit_leading_ad_id() {
        // The 2026-07-24 IAP regression: a corporate all-numeric AD login must be
        // accepted so gcloud's own `--dry-run` username survives validation.
        assert!(is_valid_ssh_username("12345678"));
        assert!(is_valid_ssh_username("1a-b_c"));
        assert!(is_valid_ssh_username("0"));
        // A leading hyphen would read as an ssh flag — still rejected.
        assert!(!is_valid_ssh_username("-danger"));
        // An uppercase first char is still not a POSIX-ish login.
        assert!(!is_valid_ssh_username("Horry"));
        // The character set is unchanged: metacharacters stay rejected.
        assert!(!is_valid_ssh_username("1;rm"));
    }

    // --- gcloud --dry-run delegation --------------------------------------

    /// The shape gcloud actually prints on Windows for an IAP target: an
    /// absolute ssh.exe path, a quoted ProxyCommand full of spaces, and
    /// `user@host` last.
    const WINDOWS_DRY_RUN: &str = concat!(
        r#"C:\Windows\System32\OpenSSH\ssh.exe -t -i C:\Users\alice\.ssh\google_compute_engine "#,
        r#"-o CheckHostIP=no -o HostKeyAlias=compute.123456789 -o IdentitiesOnly=yes "#,
        r#"-o StrictHostKeyChecking=no "#,
        r#"-o ProxyCommand="C:\Program Files\Python\python.exe -S C:\SDK\gcloud.py compute start-iap-tunnel vm-01 %p --listen-on-stdin" "#,
        r#"alice@compute.123456789"#
    );

    #[test]
    fn parse_dry_run_extracts_user_and_key_from_windows_output() {
        let (user, key) = parse_dry_run_ssh_command(WINDOWS_DRY_RUN).unwrap();
        assert_eq!(user, "alice");
        assert_eq!(
            key.unwrap(),
            PathBuf::from(r"C:\Users\alice\.ssh\google_compute_engine")
        );
    }

    #[test]
    fn parse_dry_run_ignores_at_sign_inside_proxy_command() {
        // Regression guard: a ProxyCommand containing an `@` must not be
        // mistaken for the user@host token, which would yield a garbage login
        // name and reintroduce the exact class of bug this replaces.
        let line = concat!(
            r#"ssh -i /home/h/.ssh/google_compute_engine "#,
            r#"-o ProxyCommand="/usr/bin/curl user@example.com" "#,
            r#"alice@compute.42"#
        );
        let (user, _) = parse_dry_run_ssh_command(line).unwrap();
        assert_eq!(user, "alice");
    }

    #[test]
    fn parse_dry_run_handles_unix_style_output() {
        let line = "/usr/bin/ssh -t -i /home/h/.ssh/google_compute_engine -o StrictHostKeyChecking=no h_example_com@compute.7";
        let (user, key) = parse_dry_run_ssh_command(line).unwrap();
        assert_eq!(user, "h_example_com");
        assert_eq!(
            key.unwrap(),
            PathBuf::from("/home/h/.ssh/google_compute_engine")
        );
    }

    #[test]
    fn parse_dry_run_handles_quoted_key_path_with_spaces() {
        let line =
            r#"ssh.exe -i "C:\Users\my name\.ssh\google_compute_engine" -o X=y alice@compute.1"#;
        let (user, key) = parse_dry_run_ssh_command(line).unwrap();
        assert_eq!(user, "alice");
        assert_eq!(
            key.unwrap(),
            PathBuf::from(r"C:\Users\my name\.ssh\google_compute_engine")
        );
    }

    #[test]
    fn parse_dry_run_skips_leading_warning_lines() {
        let out = "WARNING: consider installing NumPy.\n\nssh -i /k/id alice@compute.1\n";
        let (user, _) = parse_dry_run_ssh_command(out).unwrap();
        assert_eq!(user, "alice");
    }

    #[test]
    fn parse_dry_run_drops_putty_format_key() {
        // Regression, observed 2026-07-24: with PuTTY installed, gcloud emits a
        // plink command line pointing -i at the .ppk copy. ssh.exe cannot read
        // PuTTY format, so adopting it yields `Permission denied (publickey)`
        // even though the username is correct. The caller must keep the OpenSSH
        // key instead.
        let line =
            r#"plink.exe -i C:\Users\alice\.ssh\google_compute_engine.ppk -P 22 alice@compute.1"#;
        let (user, key) = parse_dry_run_ssh_command(line).unwrap();
        assert_eq!(user, "alice");
        assert_eq!(key, None, "PuTTY key must not be adopted");
    }

    #[test]
    fn parse_dry_run_drops_putty_key_regardless_of_case() {
        let line = r#"plink.exe -i "C:\k\google_compute_engine.PPK" alice@compute.1"#;
        assert_eq!(parse_dry_run_ssh_command(line).unwrap().1, None);
    }

    #[test]
    fn parse_dry_run_extracts_numeric_user_from_real_putty_line() {
        // Real shape observed 2026-07-24 on a corporate PC: gcloud with PuTTY
        // installed prints ONE putty.exe command whose quoted `-proxycmd` holds
        // the start-iap-tunnel call and whose final token is `<ad-id>@compute.<n>`.
        // The login is all-numeric (`12345678`) and the key is the `.ppk` copy —
        // the parser must recover the username (previously rejected as digit-
        // leading, which caused the wrong email-derived fallback) and drop the
        // PuTTY key so the OpenSSH key is used.
        let line = concat!(
            r#""C:\SDK\bin\sdk\putty.exe" -t -i C:\Users\12345678\.ssh\google_compute_engine.ppk "#,
            r#"-proxycmd ""C:\SDK\python.exe" "-S" "C:\SDK\gcloud.py" compute start-iap-tunnel "dev-vm-01" "%port" --listen-on-stdin --project=p --zone=z --verbosity=warning" "#,
            r#"12345678@compute.1234567890"#
        );
        let (user, key) = parse_dry_run_ssh_command(line).unwrap();
        assert_eq!(user, "12345678");
        assert_eq!(key, None, "PuTTY .ppk key must not be adopted");
    }

    #[test]
    fn parse_dry_run_keeps_openssh_key_without_extension() {
        // The counterpart to the .ppk case: an extensionless OpenSSH key is
        // exactly what we want to adopt.
        let line = r#"ssh.exe -i C:\Users\alice\.ssh\google_compute_engine alice@compute.1"#;
        let (_, key) = parse_dry_run_ssh_command(line).unwrap();
        assert_eq!(
            key.unwrap(),
            PathBuf::from(r"C:\Users\alice\.ssh\google_compute_engine")
        );
    }

    #[test]
    fn parse_dry_run_without_identity_file_still_yields_user() {
        // A missing -i is survivable: the caller already knows the conventional
        // key path. A missing username is not.
        let (user, key) = parse_dry_run_ssh_command("ssh -o X=y alice@compute.1").unwrap();
        assert_eq!(user, "alice");
        assert_eq!(key, None);
    }

    #[test]
    fn parse_dry_run_rejects_unusable_output() {
        for junk in [
            "",                                 // nothing at all
            "   \n  \n",                        // whitespace only
            "ERROR: (gcloud.compute.ssh) ...",  // an error, not a command
            "ssh -i /k/id compute.1",           // no user@host
            "ssh -i /k/id Horry@compute.1",     // not a POSIX login name
            "ssh -i /k/id -oProxy@x@compute.1", // reads as a flag, not a login
        ] {
            assert!(
                parse_dry_run_ssh_command(junk).is_none(),
                "expected None for {junk:?}"
            );
        }
    }

    #[test]
    fn parse_dry_run_scans_past_a_trailing_start_iap_tunnel_line() {
        // Regression, gcloud 530.x on Windows: `--dry-run` printed the real ssh
        // command AND, on its OWN last line, the `start-iap-tunnel` ProxyCommand
        // subprocess (no trailing `user@host`). The old last-line-only parser
        // returned None and fell back to the wrong local username; the scan must
        // reach past that line to the ssh command.
        let out = concat!(
            "ssh.exe -t -i C:\\Users\\me\\.ssh\\google_compute_engine ",
            "-o StrictHostKeyChecking=no alice@compute.123456789\n",
            "\"C:\\g\\python.exe\" \"-S\" \"C:\\g\\gcloud.py\" compute start-iap-tunnel dev-vm-01 22 --listen-on-stdin\n"
        );
        let (user, key) = parse_dry_run_ssh_command(out).unwrap();
        assert_eq!(user, "alice");
        assert_eq!(
            key.unwrap(),
            PathBuf::from(r"C:\Users\me\.ssh\google_compute_engine")
        );
    }

    #[test]
    fn username_from_email_derives_posix_local_part() {
        assert_eq!(
            username_from_email("alice.smith@example.com").as_deref(),
            Some("alice_smith")
        );
        // Case-folded and sanitized.
        assert_eq!(
            username_from_email("Alice.Smith@EXAMPLE.com").as_deref(),
            Some("alice_smith")
        );
        // Already-clean local part passes through.
        assert_eq!(
            username_from_email("alice@example.com").as_deref(),
            Some("alice")
        );
    }

    #[test]
    fn username_from_email_handles_digit_leading_and_empty_local_parts() {
        // A digit-leading local part is now valid (corporate all-numeric AD ids).
        assert_eq!(
            username_from_email("1alice@example.com").as_deref(),
            Some("1alice")
        );
        // An empty local part still yields nothing to log in as.
        assert_eq!(username_from_email("@example.com"), None);
    }

    #[test]
    fn ssh_pubkey_body_returns_base64_field() {
        let pk = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI comment@host\n";
        assert_eq!(ssh_pubkey_body(pk), Some("AAAAC3NzaC1lZDI1NTE5AAAAI"));
        assert_eq!(ssh_pubkey_body(""), None);
    }

    #[test]
    fn rfc3339_utc_to_epoch_matches_known_instants() {
        assert_eq!(rfc3339_utc_to_epoch("1970-01-01T00:00:00"), Some(0));
        assert_eq!(
            rfc3339_utc_to_epoch("2000-01-01T00:00:00"),
            Some(946_684_800)
        );
        // gcloud's shape; the trailing `+0000` is ignored (already UTC).
        assert_eq!(
            rfc3339_utc_to_epoch("2026-07-15T05:50:14+0000"),
            Some(1_784_094_614)
        );
        // Malformed / too short → None (caller then treats the key as persistent).
        assert_eq!(rfc3339_utc_to_epoch("2026-07-15"), None);
        assert_eq!(rfc3339_utc_to_epoch("not-a-timestamp-at-all"), None);
    }

    #[test]
    fn parse_expire_on_epoch_reads_google_ssh_trailer() {
        let line = r#"alice_smith:ssh-rsa AAAAB3Nza google-ssh {"userName":"alice@example.com","expireOn":"2026-07-15T05:50:14+0000"}"#;
        assert_eq!(parse_expire_on_epoch(line), Some(1_784_094_614));
        // A persistent key (no google-ssh trailer) has no expiry.
        assert_eq!(
            parse_expire_on_epoch("alice:ssh-rsa AAAAB3Nza persistent"),
            None
        );
    }

    #[test]
    fn ssh_keys_live_entry_requires_matching_user_and_unexpired() {
        // The exact shape observed 2026-07-24: two `alice_smith` keys,
        // both expiring 2026-07-15, and NO key for gcloud's digit login.
        let value = concat!(
            "alice_smith:ecdsa-sha2-nistp256 ECDSABODY google-ssh {\"expireOn\":\"2026-07-15T05:50:14+0000\"}\n",
            "alice_smith:ssh-rsa RSABODY google-ssh {\"expireOn\":\"2026-07-15T05:50:20+0000\"}"
        );
        let before = 1_784_000_000; // ~2026-07-14, keys still valid
        let after = 1_784_500_000; // ~2026-07-19, keys expired

        // Right user + not yet expired → live (skip enrollment).
        assert!(ssh_keys_have_live_entry(
            value,
            "alice_smith",
            "RSABODY",
            before
        ));
        // Right user but expired → NOT live (must re-enroll) — the actual bug.
        assert!(!ssh_keys_have_live_entry(
            value,
            "alice_smith",
            "RSABODY",
            after
        ));
        // Body present but under the WRONG user (gcloud's `12345678`) → not live.
        assert!(!ssh_keys_have_live_entry(
            value, "12345678", "RSABODY", before
        ));
        // Body absent → not live.
        assert!(!ssh_keys_have_live_entry(
            value,
            "alice_smith",
            "NOSUCHBODY",
            before
        ));
    }

    #[test]
    fn ssh_keys_persistent_entry_never_expires() {
        // A manually-added key with no `google-ssh {expireOn}` trailer is live
        // no matter how far in the future we check.
        let value = "alice:ssh-rsa PERSISTBODY manual-key";
        assert!(ssh_keys_have_live_entry(
            value,
            "alice",
            "PERSISTBODY",
            i64::MAX - 1
        ));
    }

    #[test]
    fn enroll_ssh_args_register_under_connect_user_through_iap() {
        let args = enroll_ssh_args("alice_smith", "proj-1", "us-central1-a", "dev-vm-01");
        assert_eq!(args[0], "compute");
        assert_eq!(args[1], "ssh");
        // Registered under the SAME name HoTTY connects as.
        assert_eq!(args[2], "alice_smith@dev-vm-01");
        assert!(args.contains(&"--zone=us-central1-a".to_string()));
        assert!(args.contains(&"--project=proj-1".to_string()));
        assert!(args.contains(&"--tunnel-through-iap".to_string()));
        assert!(args.contains(&"--command=true".to_string()));
        assert!(args.contains(&"--quiet".to_string()));
        // Must survive run_gcloud_capture's cmd.exe metacharacter guard.
        const FORBIDDEN: &[char] = &['"', '%', '^', '&', '|', '<', '>', '\n', '\r'];
        for a in &args {
            assert!(
                !a.chars().any(|c| FORBIDDEN.contains(&c)),
                "forbidden character in arg {a:?}"
            );
        }
    }

    #[test]
    fn dry_run_args_carry_no_cmd_exe_metacharacters() {
        // Guards the 2026-05-22 class of regression: a `"` (or other cmd.exe
        // metacharacter) in an arg makes gcloud.cmd fail with an opaque
        // "'C:\...\Google\Cloud' is not recognized".
        const FORBIDDEN: &[char] = &['"', '%', '^', '&', '|', '<', '>', '\n', '\r'];
        for args in [
            dry_run_ssh_args("my-project-123", "us-central1-a", "vm-01"),
            require_oslogin_policy_args("my-project-123"),
        ] {
            for a in &args {
                assert!(
                    !a.chars().any(|c| FORBIDDEN.contains(&c)),
                    "forbidden character in arg {a:?}"
                );
            }
        }
    }

    #[test]
    fn dry_run_args_target_the_requested_vm_through_iap() {
        let args = dry_run_ssh_args("proj-1", "us-central1-a", "vm-01");
        assert_eq!(args[0], "compute");
        assert_eq!(args[1], "ssh");
        assert_eq!(args[2], "vm-01");
        assert!(args.contains(&"--zone=us-central1-a".to_string()));
        assert!(args.contains(&"--project=proj-1".to_string()));
        // Without this gcloud demands an external IP the VM may not have.
        assert!(args.contains(&"--tunnel-through-iap".to_string()));
        assert!(args.contains(&"--dry-run".to_string()));
        // --quiet keeps it from blocking on a key-generation prompt.
        assert!(args.contains(&"--quiet".to_string()));
    }

    // --- org policy fallback ----------------------------------------------

    #[test]
    fn require_oslogin_policy_unenforced_renders_as_empty_boolean_policy() {
        // This is the shape GCP actually returns for a project with no
        // enforcement — an empty object, NOT a missing booleanPolicy.
        let json = r#"{"booleanPolicy":{},"constraint":"constraints/compute.requireOsLogin"}"#;
        assert_eq!(parse_require_oslogin_policy(json), Some(false));
    }

    #[test]
    fn require_oslogin_policy_enforced() {
        let json = r#"{"booleanPolicy":{"enforced":true},"constraint":"constraints/compute.requireOsLogin"}"#;
        assert_eq!(parse_require_oslogin_policy(json), Some(true));
    }

    #[test]
    fn require_oslogin_policy_explicit_false() {
        let json = r#"{"booleanPolicy":{"enforced":false}}"#;
        assert_eq!(parse_require_oslogin_policy(json), Some(false));
    }

    #[test]
    fn require_oslogin_policy_unknown_is_none_not_false() {
        // A 403 or garbage must stay distinguishable from "not enforced" so the
        // caller can log it rather than silently deciding.
        for junk in [
            "",
            "not-json",
            r#"{"constraint":"constraints/compute.requireOsLogin"}"#,
            r#"{"listPolicy":{}}"#,
        ] {
            assert_eq!(
                parse_require_oslogin_policy(junk),
                None,
                "expected None for {junk:?}"
            );
        }
    }

    // --- ssh failure diagnosis --------------------------------------------

    #[test]
    fn explain_ssh_failure_names_the_rejected_user() {
        let out = "alice_example_com@localhost: Permission denied (publickey).";
        let msg = explain_ssh_failure(out, "alice_example_com").unwrap();
        assert!(msg.contains("alice_example_com"));
        assert!(
            msg.contains("SSH user"),
            "should point at the override: {msg}"
        );
    }

    #[test]
    fn explain_ssh_failure_covers_agent_key_exhaustion() {
        let out = "Received disconnect from 127.0.0.1: Too many authentication failures";
        assert!(explain_ssh_failure(out, "alice").is_some());
    }

    #[test]
    fn explain_ssh_failure_stays_quiet_on_unrelated_output() {
        // An ordinary logout or a server-side error already speaks for itself in
        // the terminal; a second, guessed explanation would only mislead.
        for out in [
            "logout\r\nConnection to localhost closed.",
            "",
            "bash: x: not found",
        ] {
            assert_eq!(explain_ssh_failure(out, "alice"), None);
        }
    }

    // --- transcript capture -----------------------------------------------

    #[test]
    fn truncate_on_char_boundary_never_splits_utf8() {
        // PTY reads split multi-byte sequences routinely; String::truncate would
        // panic on a non-boundary index.
        let mut s = "日本語テキスト".to_string();
        truncate_on_char_boundary(&mut s, 7);
        assert_eq!(s, "日本"); // 6 bytes — cut back from the middle of 語
        assert!(s.is_char_boundary(s.len()));
    }

    #[test]
    fn truncate_on_char_boundary_leaves_short_strings_alone() {
        let mut s = "ok".to_string();
        truncate_on_char_boundary(&mut s, 2048);
        assert_eq!(s, "ok");
    }

    #[test]
    fn sanitize_terminal_output_recovers_the_error_from_conpty_noise() {
        // Verbatim shape of what ssh emits under ConPTY: a screen-clear burst,
        // an OSC title, dozens of erase-line sequences, then the real message.
        // The first run of this diagnostic logged 70 blank lines and truncated
        // the error away — this is the regression guard for that.
        let raw = "\u{1b}[?9001h\u{1b}[?25l\u{1b}[2J\u{1b}[H\u{1b}]0;C:\\Windows\\ssh.exe\u{7}\
                   \n\n\n\u{1b}[K\n\u{1b}[K\n\u{1b}[K\n\
                   alice@localhost: Permission denied (publickey).\r\n";
        let clean = sanitize_terminal_output(raw);
        assert_eq!(clean, "alice@localhost: Permission denied (publickey).");
        assert!(!clean.contains('\u{1b}'));
    }

    #[test]
    fn sanitize_terminal_output_keeps_multiple_lines_readable() {
        let raw = "line one\r\n\u{1b}[Kline two\r\n";
        assert_eq!(sanitize_terminal_output(raw), "line one | line two");
    }

    #[test]
    fn sanitize_terminal_output_handles_empty_and_pure_escape_input() {
        assert_eq!(sanitize_terminal_output(""), "");
        assert_eq!(sanitize_terminal_output("\u{1b}[2J\u{1b}[H"), "");
    }

    #[test]
    fn sanitized_output_still_matches_the_failure_explainer() {
        // The two halves have to agree: explain_ssh_failure runs on the
        // sanitized text, so stripping must not break its pattern.
        let raw = "\u{1b}[2J\u{1b}[Kalice@localhost: Permission denied (publickey).\r\n";
        let clean = sanitize_terminal_output(raw);
        assert!(explain_ssh_failure(&clean, "alice").is_some());
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

    // -- OS Login metadata describe (regression: cmd.exe quote-stripping) --

    /// `cmd.exe` mangles the program path when args contain `"`, so the OS
    /// Login describes MUST use `--format=json(projection)` rather than
    /// `--format=value("filter")`. Guards both describe arg builders.
    #[test]
    fn oslogin_describe_args_have_no_embedded_quotes() {
        let inst = instance_oslogin_describe_args("my-project-123", "us-central1-a", "vm-01");
        for a in &inst {
            assert!(
                !a.contains('"'),
                "instance describe arg contains `\"` — cmd.exe will break gcloud.cmd's path: {a}"
            );
        }
        let proj = project_oslogin_describe_args("my-project-123");
        for a in &proj {
            assert!(
                !a.contains('"'),
                "project describe arg contains `\"` — cmd.exe will break gcloud.cmd's path: {a}"
            );
        }
    }

    #[tokio::test]
    async fn run_gcloud_capture_rejects_quoted_args() {
        // The `"`-in-args guard must hard-fail in every build profile (not just
        // debug_assert), returning before any gcloud spawn so the test passes
        // without gcloud installed.
        let args = vec![
            "compute".to_string(),
            "instances".to_string(),
            "describe".to_string(),
            "--format=value(\"metadata\")".to_string(),
        ];
        let res = run_gcloud_capture(&args, Duration::from_secs(5)).await;
        assert!(
            matches!(res, Err(SessionError::InvalidConfig(_))),
            "expected InvalidConfig rejection, got {res:?}"
        );
    }

    #[tokio::test]
    async fn run_gcloud_capture_rejects_cmd_metacharacters() {
        // BatBadBut-class cmd.exe metacharacters must all be rejected before any
        // spawn, so the test passes without gcloud installed. Each char is tested
        // independently to prove the guard is not just a `"`-only denylist.
        for bad in ['%', '^', '&', '|', '<', '>', '\n', '\r'] {
            let args = vec![
                "compute".to_string(),
                "instances".to_string(),
                "list".to_string(),
                format!("--filter=name{bad}evil"),
            ];
            let res = run_gcloud_capture(&args, Duration::from_secs(5)).await;
            assert!(
                matches!(res, Err(SessionError::InvalidConfig(_))),
                "expected InvalidConfig rejection for metacharacter {bad:?}, got {res:?}"
            );
        }
    }

    #[test]
    fn instance_describe_args_layout() {
        let args = instance_oslogin_describe_args("p", "z", "i");
        assert_eq!(args[0], "compute");
        assert_eq!(args[1], "instances");
        assert_eq!(args[2], "describe");
        assert_eq!(args[3], "i");
        assert!(args.contains(&"--zone=z".to_string()));
        assert!(args.contains(&"--project=p".to_string()));
        assert!(args.contains(&"--format=json(metadata.items)".to_string()));
    }

    #[test]
    fn project_describe_args_layout() {
        let args = project_oslogin_describe_args("p");
        assert_eq!(args[0], "compute");
        assert_eq!(args[1], "project-info");
        assert_eq!(args[2], "describe");
        assert!(args.contains(&"--project=p".to_string()));
        assert!(args.contains(&"--format=json(commonInstanceMetadata.items)".to_string()));
    }

    #[test]
    fn extract_metadata_value_finds_enable_oslogin_true() {
        let json = r#"{"metadata":{"items":[{"key":"enable-oslogin","value":"TRUE"}]}}"#;
        assert_eq!(
            extract_metadata_value(json, "metadata", "enable-oslogin"),
            Some("TRUE".to_string())
        );
    }

    #[test]
    fn extract_metadata_value_finds_enable_oslogin_false() {
        let json = r#"{"metadata":{"items":[{"key":"enable-oslogin","value":"FALSE"}]}}"#;
        assert_eq!(
            extract_metadata_value(json, "metadata", "enable-oslogin"),
            Some("FALSE".to_string())
        );
    }

    #[test]
    fn extract_metadata_value_picks_right_key_among_many() {
        let json = r#"{
            "metadata": {
                "items": [
                    {"key": "ssh-keys", "value": "user:key"},
                    {"key": "enable-oslogin", "value": "TRUE"},
                    {"key": "block-project-ssh-keys", "value": "false"}
                ]
            }
        }"#;
        assert_eq!(
            extract_metadata_value(json, "metadata", "enable-oslogin"),
            Some("TRUE".to_string())
        );
    }

    #[test]
    fn extract_metadata_value_handles_project_info_container() {
        let json =
            r#"{"commonInstanceMetadata":{"items":[{"key":"enable-oslogin","value":"TRUE"}]}}"#;
        assert_eq!(
            extract_metadata_value(json, "commonInstanceMetadata", "enable-oslogin"),
            Some("TRUE".to_string())
        );
    }

    #[test]
    fn extract_metadata_value_returns_none_when_key_absent() {
        let json = r#"{"metadata":{"items":[{"key":"ssh-keys","value":"user:key"}]}}"#;
        assert_eq!(
            extract_metadata_value(json, "metadata", "enable-oslogin"),
            None
        );
    }

    #[test]
    fn extract_metadata_value_returns_none_for_empty_items() {
        let json = r#"{"metadata":{"items":[]}}"#;
        assert_eq!(
            extract_metadata_value(json, "metadata", "enable-oslogin"),
            None
        );
    }

    #[test]
    fn extract_metadata_value_returns_none_for_missing_container() {
        // gcloud emits `{}` when the projected field doesn't exist on the resource.
        let json = "{}";
        assert_eq!(
            extract_metadata_value(json, "metadata", "enable-oslogin"),
            None
        );
    }

    #[test]
    fn extract_metadata_value_returns_none_for_missing_items_array() {
        let json = r#"{"metadata":{}}"#;
        assert_eq!(
            extract_metadata_value(json, "metadata", "enable-oslogin"),
            None
        );
    }

    #[test]
    fn extract_metadata_value_returns_none_for_invalid_json() {
        assert_eq!(
            extract_metadata_value("", "metadata", "enable-oslogin"),
            None
        );
        assert_eq!(
            extract_metadata_value("not-json", "metadata", "enable-oslogin"),
            None
        );
    }

    #[test]
    fn extract_metadata_value_tolerates_surrounding_whitespace() {
        let json =
            "  \n{\"metadata\":{\"items\":[{\"key\":\"enable-oslogin\",\"value\":\"TRUE\"}]}}\n  ";
        assert_eq!(
            extract_metadata_value(json, "metadata", "enable-oslogin"),
            Some("TRUE".to_string())
        );
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
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
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
