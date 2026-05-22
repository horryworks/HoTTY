use std::collections::HashSet;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use regex_lite::Regex;
use tokio::process::Command;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Default timeout for short-lived gcloud CLI commands (e.g. `describe`, `list`).
const GCLOUD_CMD_TIMEOUT_SECS: u64 = 15;

/// Hard ceiling for the blocking `gcloud compute instances start` call.
const INSTANCE_START_TIMEOUT_SECS: u64 = 300;

/// Total budget for the post-start poll-to-RUNNING phase.
pub const WAIT_RUNNING_TIMEOUT_SECS: u64 = 240;

/// Polling cadence while waiting for the VM to reach RUNNING.
const STATUS_POLL_INTERVAL_SECS: u64 = 3;

/// After receiving an `Unknown(...)` status this many cycles in a row, give up.
const UNKNOWN_STATUS_TOLERANCE: u32 = 3;

/// Maximum number of projects returned by `list_projects`.
const MAX_PROJECTS: usize = 100;

// ---------------------------------------------------------------------------
// Validation regex patterns
// ---------------------------------------------------------------------------

/// GCP project ID: 6-30 chars, lowercase + digits + hyphens, starts with letter.
const RE_PROJECT: &str = r"^[a-z][a-z0-9\-]{4,28}[a-z0-9]$";

/// GCP zone: e.g. us-central1-a
const RE_ZONE: &str = r"^[a-z]+-[a-z]+[0-9]+-[a-z]$";

/// GCE instance name: lowercase letters/digits/hyphens, 1-63 chars, starts with letter.
const RE_INSTANCE: &str = r"^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$";

// ---------------------------------------------------------------------------
// Result types (returned to frontend via Tauri commands)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GcloudStatus {
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GcloudAuthStatus {
    pub authenticated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct GcpProject {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct GceInstance {
    pub name: String,
    pub status: String,
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

pub(crate) fn is_valid_project(project: &str) -> bool {
    use std::sync::OnceLock;
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(RE_PROJECT).unwrap()).is_match(project)
}

pub(crate) fn is_valid_zone(zone: &str) -> bool {
    use std::sync::OnceLock;
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(RE_ZONE).unwrap()).is_match(zone)
}

pub(crate) fn is_valid_instance(instance: &str) -> bool {
    use std::sync::OnceLock;
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(RE_INSTANCE).unwrap()).is_match(instance)
}

// ---------------------------------------------------------------------------
// gcloud executable discovery (Windows)
// ---------------------------------------------------------------------------

/// Attempt to find the gcloud CLI executable on Windows.
/// Returns `None` if not found — callers should fall back to bare `gcloud`.
fn find_gcloud_path() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        use std::env;

        let suffix = r"Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd";
        let env_dirs: [&str; 4] = ["LOCALAPPDATA", "APPDATA", "ProgramFiles", "ProgramFiles(x86)"];

        // Check well-known install locations
        for env_name in &env_dirs {
            if let Ok(dir) = env::var(env_name) {
                let candidate = PathBuf::from(dir).join(suffix);
                if candidate.exists() {
                    return Some(candidate);
                }
            }
        }

        // USERPROFILE\google-cloud-sdk\bin\gcloud.cmd
        if let Ok(home) = env::var("USERPROFILE") {
            let candidate = PathBuf::from(&home)
                .join("google-cloud-sdk")
                .join("bin")
                .join("gcloud.cmd");
            if candidate.exists() {
                return Some(candidate);
            }
        }

        // Search PATH
        if let Ok(path_var) = env::var("PATH") {
            for dir in path_var.split(';') {
                let candidate = PathBuf::from(dir).join("gcloud.cmd");
                if candidate.exists() {
                    return Some(candidate);
                }
            }
        }
    }

    None
}

/// Return the gcloud program name and whether to wrap the invocation in `cmd /C`.
///
/// `use_shell` is always `false`: on Windows the `.cmd` extension is detected by
/// the Rust standard library, which then spawns the script via `cmd.exe` with the
/// BatBadBut-safe argument escaping (since Rust 1.77.2). Wrapping it ourselves in
/// `cmd /C` reintroduces cmd's "strip outer quotes when 3+ `"` are present" rule,
/// which breaks any gcloud invocation whose `--format=value("...")` filter expression
/// embeds double quotes (see HoTTY.log around `is_oslogin_enabled` failing with
/// `'C:\...\Google\Cloud' is not recognized`).
pub(crate) fn gcloud_program() -> (String, bool) {
    if let Some(path) = find_gcloud_path() {
        (path.to_string_lossy().into_owned(), false)
    } else {
        // No full path: fall back to PATH lookup. Rust's Command still detects the
        // .cmd extension after PATH resolution and applies the same safe escaping.
        let name = if cfg!(target_os = "windows") {
            "gcloud.cmd".to_string()
        } else {
            "gcloud".to_string()
        };
        (name, false)
    }
}

// ---------------------------------------------------------------------------
// gcloud command runner
// ---------------------------------------------------------------------------

/// Run a gcloud command with the default timeout. Convenience wrapper.
async fn run_gcloud(args: &[&str]) -> Result<String, String> {
    run_gcloud_with_timeout(args, GCLOUD_CMD_TIMEOUT_SECS).await
}

/// Run a gcloud command with a caller-supplied timeout (seconds) and return stdout.
/// On non-zero exit, returns `Err` with the trimmed stderr.
async fn run_gcloud_with_timeout(args: &[&str], timeout_secs: u64) -> Result<String, String> {
    let (program, _use_shell) = gcloud_program();

    // Invoke the .cmd file directly. Rust's Command detects the .cmd extension on
    // Windows and spawns it via cmd.exe with BatBadBut-safe escaping; doing the
    // `cmd /C` wrapping ourselves would re-introduce cmd's brittle quote-stripping
    // rules (see gcloud_program() doc comment).
    let mut cmd = Command::new(&program);
    cmd.args(args);

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let output = tokio::time::timeout(Duration::from_secs(timeout_secs), cmd.output())
        .await
        .map_err(|_| "gcloud command timed out".to_string())?
        .map_err(|e| format!("Failed to run gcloud: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("gcloud error: {}", stderr.trim()));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

// ---------------------------------------------------------------------------
// Public API — called from commands/iap_tunnel.rs
// ---------------------------------------------------------------------------

/// Check if gcloud CLI is available and return version info.
pub async fn check_gcloud() -> GcloudStatus {
    match run_gcloud(&["--version"]).await {
        Ok(output) => {
            let version = {
                use std::sync::OnceLock;
                static RE: OnceLock<Regex> = OnceLock::new();
                let re = RE.get_or_init(|| Regex::new(r"Google Cloud SDK\s+([\d.]+)").unwrap());
                re.captures(&output)
                    .and_then(|c| c.get(1).map(|m| m.as_str().to_string()))
            };
            GcloudStatus {
                available: true,
                version,
            }
        }
        Err(_) => GcloudStatus {
            available: false,
            version: None,
        },
    }
}

/// Check if gcloud is authenticated and return the active account.
pub async fn check_auth() -> GcloudAuthStatus {
    match run_gcloud(&["auth", "list", "--format=json"]).await {
        Ok(output) => {
            // Parse JSON array of account objects
            if let Ok(accounts) = serde_json::from_str::<Vec<serde_json::Value>>(&output) {
                for account in &accounts {
                    if account.get("status").and_then(|s| s.as_str()) == Some("ACTIVE") {
                        let email = account
                            .get("account")
                            .and_then(|a| a.as_str())
                            .map(|s| s.to_string());
                        return GcloudAuthStatus {
                            authenticated: true,
                            account: email,
                        };
                    }
                }
            }
            GcloudAuthStatus {
                authenticated: false,
                account: None,
            }
        }
        Err(_) => GcloudAuthStatus {
            authenticated: false,
            account: None,
        },
    }
}

/// List GCP projects accessible to the authenticated user.
pub async fn list_projects() -> Vec<GcpProject> {
    let args = [
        "projects",
        "list",
        "--format=json",
        "--limit=100",
        "--sort-by=projectId",
    ];
    match run_gcloud(&args).await {
        Ok(output) => {
            let entries: Vec<serde_json::Value> =
                serde_json::from_str(&output).unwrap_or_default();
            entries
                .iter()
                .filter_map(|e| {
                    let id = e.get("projectId")?.as_str()?.to_string();
                    let name = e
                        .get("name")
                        .and_then(|n| n.as_str())
                        .unwrap_or(id.as_str())
                        .to_string();
                    Some(GcpProject { id, name })
                })
                .take(MAX_PROJECTS)
                .collect()
        }
        Err(e) => {
            log::warn!("Failed to list GCP projects: {e}");
            Vec::new()
        }
    }
}

/// List zones that have compute instances for a given project.
pub async fn list_zones(project: &str) -> Vec<String> {
    if !is_valid_project(project) {
        log::warn!("Invalid project ID for zone listing: {project}");
        return Vec::new();
    }

    let project_flag = format!("--project={project}");
    let args = [
        "compute",
        "instances",
        "list",
        "--format=json(zone)",
        &project_flag,
    ];
    match run_gcloud(&args).await {
        Ok(output) => {
            let entries: Vec<serde_json::Value> =
                serde_json::from_str(&output).unwrap_or_default();
            let mut zones = HashSet::new();
            for entry in &entries {
                if let Some(zone_str) = entry.get("zone").and_then(|z| z.as_str()) {
                    // May be a full URL like "projects/.../zones/us-central1-a"
                    let zone_name = zone_str.rsplit('/').next().unwrap_or(zone_str);
                    zones.insert(zone_name.to_string());
                }
            }
            let mut sorted: Vec<String> = zones.into_iter().collect();
            sorted.sort();
            sorted
        }
        Err(e) => {
            log::warn!("Failed to list zones for project {project}: {e}");
            Vec::new()
        }
    }
}

/// List compute instances in a given project and zone.
pub async fn list_instances(project: &str, zone: &str) -> Vec<GceInstance> {
    if !is_valid_project(project) {
        log::warn!("Invalid project ID for instance listing: {project}");
        return Vec::new();
    }
    if !is_valid_zone(zone) {
        log::warn!("Invalid zone for instance listing: {zone}");
        return Vec::new();
    }

    let project_flag = format!("--project={project}");
    // Use the native `--zones=` flag instead of a `--filter=` expression so the
    // zone string is consumed as a scoped allowlist rather than interpreted as
    // gcloud filter syntax. The zone is already validated against RE_ZONE.
    let zones_flag = format!("--zones={zone}");
    let args = [
        "compute",
        "instances",
        "list",
        "--format=json",
        &project_flag,
        &zones_flag,
        "--sort-by=name",
    ];
    match run_gcloud(&args).await {
        Ok(output) => {
            let entries: Vec<serde_json::Value> =
                serde_json::from_str(&output).unwrap_or_default();
            entries
                .iter()
                .filter_map(|e| {
                    let name = e.get("name")?.as_str()?.to_string();
                    let status = e
                        .get("status")
                        .and_then(|s| s.as_str())
                        .unwrap_or("UNKNOWN")
                        .to_string();
                    Some(GceInstance { name, status })
                })
                .collect()
        }
        Err(e) => {
            log::warn!("Failed to list instances for {project}/{zone}: {e}");
            Vec::new()
        }
    }
}

// ---------------------------------------------------------------------------
// VM instance status (for auto-start pre-flight)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InstanceStatus {
    Provisioning,
    Staging,
    Running,
    Stopping,
    Suspending,
    Suspended,
    Repairing,
    Terminated,
    Unknown(String),
}

impl InstanceStatus {
    pub fn from_gcloud_str(raw: &str) -> Self {
        let trimmed = raw.trim();
        match trimmed {
            "PROVISIONING" => Self::Provisioning,
            "STAGING" => Self::Staging,
            "RUNNING" => Self::Running,
            "STOPPING" => Self::Stopping,
            "SUSPENDING" => Self::Suspending,
            "SUSPENDED" => Self::Suspended,
            "REPAIRING" => Self::Repairing,
            "TERMINATED" | "STOPPED" => Self::Terminated,
            other => Self::Unknown(other.to_string()),
        }
    }

    pub fn as_str(&self) -> &str {
        match self {
            Self::Provisioning => "PROVISIONING",
            Self::Staging => "STAGING",
            Self::Running => "RUNNING",
            Self::Stopping => "STOPPING",
            Self::Suspending => "SUSPENDING",
            Self::Suspended => "SUSPENDED",
            Self::Repairing => "REPAIRING",
            Self::Terminated => "TERMINATED",
            Self::Unknown(s) => s.as_str(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum WaitAction {
    Done,
    Continue,
    Fail(String),
}

pub(crate) fn classify_wait_status(status: &InstanceStatus) -> WaitAction {
    match status {
        InstanceStatus::Running => WaitAction::Done,
        InstanceStatus::Provisioning
        | InstanceStatus::Staging
        | InstanceStatus::Repairing
        | InstanceStatus::Stopping
        | InstanceStatus::Suspending => WaitAction::Continue,
        InstanceStatus::Terminated => WaitAction::Fail(
            "VM returned to TERMINATED after start was issued; check GCE quotas and the instance's last-stop reason.".to_string(),
        ),
        InstanceStatus::Suspended => WaitAction::Fail(
            "VM transitioned to SUSPENDED while waiting for RUNNING.".to_string(),
        ),
        InstanceStatus::Unknown(_) => WaitAction::Continue,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PreConnectAction {
    Proceed,
    Start,
    Wait,
    AskUser { current: String },
    ErrUnknown(String),
}

pub fn decide_preconnect_action(status: &InstanceStatus, auto_start: bool) -> PreConnectAction {
    match status {
        InstanceStatus::Running => PreConnectAction::Proceed,
        InstanceStatus::Terminated | InstanceStatus::Suspended => {
            if auto_start {
                PreConnectAction::Start
            } else {
                PreConnectAction::AskUser {
                    current: status.as_str().to_string(),
                }
            }
        }
        InstanceStatus::Provisioning
        | InstanceStatus::Staging
        | InstanceStatus::Repairing
        | InstanceStatus::Stopping
        | InstanceStatus::Suspending => PreConnectAction::Wait,
        InstanceStatus::Unknown(s) => PreConnectAction::ErrUnknown(s.clone()),
    }
}

#[derive(Debug, Clone)]
pub enum WaitEvent {
    Polling {
        status: InstanceStatus,
        elapsed: Duration,
    },
    Running {
        total: Duration,
    },
}

/// Query the current status of a GCE instance via `gcloud compute instances describe`.
pub async fn get_instance_status(
    project: &str,
    zone: &str,
    instance: &str,
) -> Result<InstanceStatus, String> {
    if !is_valid_project(project) {
        return Err("invalid project".to_string());
    }
    if !is_valid_zone(zone) {
        return Err("invalid zone".to_string());
    }
    if !is_valid_instance(instance) {
        return Err("invalid instance".to_string());
    }

    let project_flag = format!("--project={project}");
    let zone_flag = format!("--zone={zone}");
    let args = [
        "compute",
        "instances",
        "describe",
        instance,
        &project_flag,
        &zone_flag,
        "--format=value(status)",
    ];
    let raw = run_gcloud(&args).await?;
    Ok(InstanceStatus::from_gcloud_str(&raw))
}

/// Translate gcloud stderr for `instances start` into a more actionable message when
/// we recognise a known failure pattern; otherwise pass the original string through.
fn map_start_error(stderr: &str) -> String {
    let lower = stderr.to_ascii_lowercase();
    if lower.contains("permission_denied")
        || lower.contains("required 'compute.instances.start' permission")
        || lower.contains("does not have compute.instances.start")
    {
        return "Permission denied: your gcloud account lacks 'compute.instances.start' on this instance. Grant the Compute Instance Admin role and retry.".to_string();
    }
    stderr.to_string()
}

/// Start a (stopped) GCE instance via blocking `gcloud compute instances start`.
pub async fn start_instance(project: &str, zone: &str, instance: &str) -> Result<(), String> {
    if !is_valid_project(project) {
        return Err("invalid project".to_string());
    }
    if !is_valid_zone(zone) {
        return Err("invalid zone".to_string());
    }
    if !is_valid_instance(instance) {
        return Err("invalid instance".to_string());
    }

    let project_flag = format!("--project={project}");
    let zone_flag = format!("--zone={zone}");
    let args = [
        "compute",
        "instances",
        "start",
        instance,
        &project_flag,
        &zone_flag,
    ];
    match run_gcloud_with_timeout(&args, INSTANCE_START_TIMEOUT_SECS).await {
        Ok(_) => Ok(()),
        Err(e) => Err(map_start_error(&e)),
    }
}

/// Poll `describe` until the VM reaches RUNNING (or fails / times out). Invokes
/// `on_event` once per poll cycle with the observed status, and once more with
/// `WaitEvent::Running` on success. UI-agnostic by design.
pub async fn wait_for_status_running<F>(
    project: &str,
    zone: &str,
    instance: &str,
    mut on_event: F,
) -> Result<Duration, String>
where
    F: FnMut(WaitEvent) + Send,
{
    let start = Instant::now();
    let deadline = start + Duration::from_secs(WAIT_RUNNING_TIMEOUT_SECS);
    let interval = Duration::from_secs(STATUS_POLL_INTERVAL_SECS);
    let mut unknown_streak: u32 = 0;
    let mut last_status_str = String::from("UNKNOWN");

    loop {
        let status = match get_instance_status(project, zone, instance).await {
            Ok(s) => s,
            Err(e) => {
                log::warn!("wait_for_status_running: describe failed: {e}");
                // Treat transient describe failures as a poll cycle; deadline check will bail.
                if Instant::now() >= deadline {
                    return Err(format!(
                        "VM did not reach RUNNING within {WAIT_RUNNING_TIMEOUT_SECS}s (last status: {last_status_str}). Check the GCE console for boot issues."
                    ));
                }
                tokio::time::sleep(interval).await;
                continue;
            }
        };
        let elapsed = start.elapsed();
        last_status_str = status.as_str().to_string();

        on_event(WaitEvent::Polling {
            status: status.clone(),
            elapsed,
        });

        match classify_wait_status(&status) {
            WaitAction::Done => {
                on_event(WaitEvent::Running { total: elapsed });
                return Ok(elapsed);
            }
            WaitAction::Fail(msg) => return Err(msg),
            WaitAction::Continue => {
                if matches!(status, InstanceStatus::Unknown(_)) {
                    unknown_streak += 1;
                    if unknown_streak >= UNKNOWN_STATUS_TOLERANCE {
                        return Err(format!("Unknown VM status: {}", status.as_str()));
                    }
                } else {
                    unknown_streak = 0;
                }
            }
        }

        if Instant::now() >= deadline {
            return Err(format!(
                "VM did not reach RUNNING within {WAIT_RUNNING_TIMEOUT_SECS}s (last status: {last_status_str}). Check the GCE console for boot issues."
            ));
        }
        tokio::time::sleep(interval).await;
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // -- Validation tests --

    #[test]
    fn valid_project_ids() {
        assert!(is_valid_project("my-project-123"));
        assert!(is_valid_project("a12345"));
        assert!(is_valid_project("project-name-here0"));
    }

    #[test]
    fn invalid_project_ids() {
        // Too short
        assert!(!is_valid_project("ab"));
        // Starts with digit
        assert!(!is_valid_project("1project"));
        // Uppercase
        assert!(!is_valid_project("My-Project"));
        // Ends with hyphen
        assert!(!is_valid_project("my-project-"));
        // Empty
        assert!(!is_valid_project(""));
        // Special chars
        assert!(!is_valid_project("my_project"));
    }

    #[test]
    fn valid_zones() {
        assert!(is_valid_zone("us-central1-a"));
        assert!(is_valid_zone("asia-northeast1-b"));
        assert!(is_valid_zone("europe-west4-c"));
    }

    #[test]
    fn invalid_zones() {
        assert!(!is_valid_zone(""));
        assert!(!is_valid_zone("us-central1"));
        assert!(!is_valid_zone("US-CENTRAL1-A"));
        assert!(!is_valid_zone("us_central1_a"));
    }

    #[test]
    fn valid_instance_names() {
        assert!(is_valid_instance("vm-01"));
        assert!(is_valid_instance("web"));
        assert!(is_valid_instance("a"));
        assert!(is_valid_instance("instance-20260512-103057"));
        assert!(is_valid_instance("vm-with-many-hyphens-and-digits-123"));
    }

    #[test]
    fn invalid_instance_names() {
        // Empty
        assert!(!is_valid_instance(""));
        // Starts with digit
        assert!(!is_valid_instance("1vm"));
        // Starts with hyphen
        assert!(!is_valid_instance("-vm"));
        // Ends with hyphen
        assert!(!is_valid_instance("vm-"));
        // Uppercase
        assert!(!is_valid_instance("VM"));
        // Underscore
        assert!(!is_valid_instance("my_vm"));
        // Too long (>63 chars)
        let long = "a".repeat(64);
        assert!(!is_valid_instance(&long));
        // Shell metacharacters
        assert!(!is_valid_instance("vm;ls"));
        assert!(!is_valid_instance("vm$(whoami)"));
        assert!(!is_valid_instance("vm\nrm"));
        assert!(!is_valid_instance("vm 01"));
    }

    // -- Serialization tests --

    #[test]
    fn gcloud_status_serialize() {
        let status = GcloudStatus {
            available: true,
            version: Some("456.0.0".to_string()),
        };
        let json = serde_json::to_value(&status).unwrap();
        assert_eq!(json["available"], true);
        assert_eq!(json["version"], "456.0.0");
    }

    #[test]
    fn gcloud_status_serialize_unavailable() {
        let status = GcloudStatus {
            available: false,
            version: None,
        };
        let json = serde_json::to_value(&status).unwrap();
        assert_eq!(json["available"], false);
        // version field should be omitted
        assert!(json.get("version").is_none());
    }

    #[test]
    fn gcloud_auth_status_serialize() {
        let auth = GcloudAuthStatus {
            authenticated: true,
            account: Some("user@example.com".to_string()),
        };
        let json = serde_json::to_value(&auth).unwrap();
        assert_eq!(json["authenticated"], true);
        assert_eq!(json["account"], "user@example.com");
    }

    #[test]
    fn gcloud_auth_status_serialize_unauthenticated() {
        let auth = GcloudAuthStatus {
            authenticated: false,
            account: None,
        };
        let json = serde_json::to_value(&auth).unwrap();
        assert_eq!(json["authenticated"], false);
        assert!(json.get("account").is_none());
    }

    #[test]
    fn gcp_project_serialize() {
        let project = GcpProject {
            id: "my-project-123".to_string(),
            name: "My Project".to_string(),
        };
        let json = serde_json::to_value(&project).unwrap();
        assert_eq!(json["id"], "my-project-123");
        assert_eq!(json["name"], "My Project");
    }

    #[test]
    fn gce_instance_serialize() {
        let instance = GceInstance {
            name: "vm-web-01".to_string(),
            status: "RUNNING".to_string(),
        };
        let json = serde_json::to_value(&instance).unwrap();
        assert_eq!(json["name"], "vm-web-01");
        assert_eq!(json["status"], "RUNNING");
    }

    // -- gcloud program discovery --

    #[test]
    fn gcloud_program_returns_tuple() {
        let (prog, _shell) = gcloud_program();
        assert!(!prog.is_empty());
    }

    /// Regression guard: gcloud_program must report `use_shell = false` so that
    /// callers do NOT wrap the invocation in `cmd /C`. The wrapper was the
    /// source of the "'C:\…\Google\Cloud' is not recognized" failure when
    /// `--format=value("...")` filter expressions were passed — see the
    /// gcloud_program() doc comment.
    #[test]
    fn gcloud_program_never_uses_manual_cmd_shell() {
        let (_prog, use_shell) = gcloud_program();
        assert!(
            !use_shell,
            "gcloud_program returned use_shell=true; this re-enables cmd /C wrapping which mis-parses args containing embedded quotes"
        );
    }

    // -- Zone extraction from URL --

    #[test]
    fn zone_extraction_from_url() {
        let url = "projects/my-project/zones/us-central1-a";
        let zone = url.rsplit('/').next().unwrap_or(url);
        assert_eq!(zone, "us-central1-a");
    }

    #[test]
    fn zone_extraction_plain() {
        let plain = "asia-northeast1-b";
        let zone = plain.rsplit('/').next().unwrap_or(plain);
        assert_eq!(zone, "asia-northeast1-b");
    }

    // -- Version regex --

    #[test]
    fn version_regex_extraction() {
        let output = "Google Cloud SDK 456.0.0\nbq 2.0.100\ncore 2024.01.01\n";
        let re = Regex::new(r"Google Cloud SDK\s+([\d.]+)").unwrap();
        let version = re
            .captures(output)
            .and_then(|c| c.get(1).map(|m| m.as_str().to_string()));
        assert_eq!(version, Some("456.0.0".to_string()));
    }

    #[test]
    fn version_regex_no_match() {
        let output = "some random output";
        let re = Regex::new(r"Google Cloud SDK\s+([\d.]+)").unwrap();
        let version = re
            .captures(output)
            .and_then(|c| c.get(1).map(|m| m.as_str().to_string()));
        assert!(version.is_none());
    }

    // -- JSON parsing --

    #[test]
    fn parse_auth_list_json() {
        let json_str = r#"[
            {"account": "inactive@example.com", "status": ""},
            {"account": "active@example.com", "status": "ACTIVE"}
        ]"#;
        let accounts: Vec<serde_json::Value> = serde_json::from_str(json_str).unwrap();
        let active = accounts.iter().find(|a| {
            a.get("status").and_then(|s| s.as_str()) == Some("ACTIVE")
        });
        assert!(active.is_some());
        assert_eq!(
            active.unwrap().get("account").unwrap().as_str().unwrap(),
            "active@example.com"
        );
    }

    #[test]
    fn parse_projects_json() {
        let json_str = r#"[
            {"projectId": "proj-a", "name": "Project A"},
            {"projectId": "proj-b"}
        ]"#;
        let entries: Vec<serde_json::Value> = serde_json::from_str(json_str).unwrap();
        let projects: Vec<GcpProject> = entries
            .iter()
            .filter_map(|e| {
                let id = e.get("projectId")?.as_str()?.to_string();
                let name = e
                    .get("name")
                    .and_then(|n| n.as_str())
                    .unwrap_or(id.as_str())
                    .to_string();
                Some(GcpProject { id, name })
            })
            .collect();
        assert_eq!(projects.len(), 2);
        assert_eq!(projects[0].name, "Project A");
        assert_eq!(projects[1].name, "proj-b"); // fallback to projectId
    }

    #[test]
    fn parse_instances_json() {
        let json_str = r#"[
            {"name": "vm-01", "status": "RUNNING"},
            {"name": "vm-02"},
            {"notAName": true}
        ]"#;
        let entries: Vec<serde_json::Value> = serde_json::from_str(json_str).unwrap();
        let instances: Vec<GceInstance> = entries
            .iter()
            .filter_map(|e| {
                let name = e.get("name")?.as_str()?.to_string();
                let status = e
                    .get("status")
                    .and_then(|s| s.as_str())
                    .unwrap_or("UNKNOWN")
                    .to_string();
                Some(GceInstance { name, status })
            })
            .collect();
        assert_eq!(instances.len(), 2);
        assert_eq!(instances[0].status, "RUNNING");
        assert_eq!(instances[1].status, "UNKNOWN");
    }

    // -- InstanceStatus parsing --

    #[test]
    fn status_from_known_strings() {
        assert_eq!(InstanceStatus::from_gcloud_str("RUNNING"), InstanceStatus::Running);
        assert_eq!(InstanceStatus::from_gcloud_str("TERMINATED"), InstanceStatus::Terminated);
        assert_eq!(InstanceStatus::from_gcloud_str("STOPPED"), InstanceStatus::Terminated);
        assert_eq!(InstanceStatus::from_gcloud_str("STAGING"), InstanceStatus::Staging);
        assert_eq!(InstanceStatus::from_gcloud_str("PROVISIONING"), InstanceStatus::Provisioning);
        assert_eq!(InstanceStatus::from_gcloud_str("STOPPING"), InstanceStatus::Stopping);
        assert_eq!(InstanceStatus::from_gcloud_str("SUSPENDED"), InstanceStatus::Suspended);
        assert_eq!(InstanceStatus::from_gcloud_str("SUSPENDING"), InstanceStatus::Suspending);
        assert_eq!(InstanceStatus::from_gcloud_str("REPAIRING"), InstanceStatus::Repairing);
    }

    #[test]
    fn status_trims_whitespace_and_newline() {
        assert_eq!(InstanceStatus::from_gcloud_str("RUNNING\n"), InstanceStatus::Running);
        assert_eq!(InstanceStatus::from_gcloud_str("  TERMINATED  "), InstanceStatus::Terminated);
    }

    #[test]
    fn status_unknown_string_fallback() {
        match InstanceStatus::from_gcloud_str("FOO_BAR") {
            InstanceStatus::Unknown(s) => assert_eq!(s, "FOO_BAR"),
            other => panic!("expected Unknown, got {other:?}"),
        }
    }

    #[test]
    fn status_as_str_round_trip() {
        assert_eq!(InstanceStatus::Running.as_str(), "RUNNING");
        assert_eq!(InstanceStatus::Terminated.as_str(), "TERMINATED");
        assert_eq!(InstanceStatus::Unknown("Q".to_string()).as_str(), "Q");
    }

    // -- classify_wait_status --

    #[test]
    fn classify_running_is_done() {
        assert_eq!(classify_wait_status(&InstanceStatus::Running), WaitAction::Done);
    }

    #[test]
    fn classify_transitional_continues() {
        for s in [
            InstanceStatus::Provisioning,
            InstanceStatus::Staging,
            InstanceStatus::Repairing,
            InstanceStatus::Stopping,
            InstanceStatus::Suspending,
        ] {
            assert_eq!(classify_wait_status(&s), WaitAction::Continue, "{s:?}");
        }
    }

    #[test]
    fn classify_terminated_fails() {
        match classify_wait_status(&InstanceStatus::Terminated) {
            WaitAction::Fail(_) => {}
            other => panic!("expected Fail, got {other:?}"),
        }
        match classify_wait_status(&InstanceStatus::Suspended) {
            WaitAction::Fail(_) => {}
            other => panic!("expected Fail, got {other:?}"),
        }
    }

    #[test]
    fn classify_unknown_continues_initially() {
        assert_eq!(
            classify_wait_status(&InstanceStatus::Unknown("X".to_string())),
            WaitAction::Continue
        );
    }

    // -- decide_preconnect_action --

    #[test]
    fn preconnect_running_proceeds() {
        assert_eq!(
            decide_preconnect_action(&InstanceStatus::Running, true),
            PreConnectAction::Proceed
        );
        assert_eq!(
            decide_preconnect_action(&InstanceStatus::Running, false),
            PreConnectAction::Proceed
        );
    }

    #[test]
    fn preconnect_stopped_with_autostart() {
        assert_eq!(
            decide_preconnect_action(&InstanceStatus::Terminated, true),
            PreConnectAction::Start
        );
        assert_eq!(
            decide_preconnect_action(&InstanceStatus::Suspended, true),
            PreConnectAction::Start
        );
    }

    #[test]
    fn preconnect_stopped_without_autostart_asks_user() {
        match decide_preconnect_action(&InstanceStatus::Terminated, false) {
            PreConnectAction::AskUser { current } => assert_eq!(current, "TERMINATED"),
            other => panic!("expected AskUser, got {other:?}"),
        }
        match decide_preconnect_action(&InstanceStatus::Suspended, false) {
            PreConnectAction::AskUser { current } => assert_eq!(current, "SUSPENDED"),
            other => panic!("expected AskUser, got {other:?}"),
        }
    }

    #[test]
    fn preconnect_transitional_waits() {
        for s in [
            InstanceStatus::Provisioning,
            InstanceStatus::Staging,
            InstanceStatus::Repairing,
            InstanceStatus::Stopping,
            InstanceStatus::Suspending,
        ] {
            assert_eq!(decide_preconnect_action(&s, true), PreConnectAction::Wait, "{s:?} true");
            assert_eq!(decide_preconnect_action(&s, false), PreConnectAction::Wait, "{s:?} false");
        }
    }

    #[test]
    fn preconnect_unknown_errors() {
        match decide_preconnect_action(&InstanceStatus::Unknown("XYZ".to_string()), true) {
            PreConnectAction::ErrUnknown(s) => assert_eq!(s, "XYZ"),
            other => panic!("expected ErrUnknown, got {other:?}"),
        }
    }

    // -- map_start_error --

    #[test]
    fn map_start_error_recognises_permission_denied() {
        let raw = "ERROR: (gcloud.compute.instances.start) Some error: PERMISSION_DENIED";
        let mapped = map_start_error(raw);
        assert!(mapped.contains("Permission denied"));
        assert!(mapped.contains("Compute Instance Admin"));
    }

    #[test]
    fn map_start_error_passes_through_unknown() {
        let raw = "ERROR: weird unrelated message";
        assert_eq!(map_start_error(raw), raw);
    }

    #[test]
    fn parse_zones_json_with_dedup() {
        let json_str = r#"[
            {"zone": "projects/p/zones/us-central1-a"},
            {"zone": "projects/p/zones/us-central1-a"},
            {"zone": "us-east1-b"}
        ]"#;
        let entries: Vec<serde_json::Value> = serde_json::from_str(json_str).unwrap();
        let mut zones = HashSet::new();
        for entry in &entries {
            if let Some(zone_str) = entry.get("zone").and_then(|z| z.as_str()) {
                let zone_name = zone_str.rsplit('/').next().unwrap_or(zone_str);
                zones.insert(zone_name.to_string());
            }
        }
        assert_eq!(zones.len(), 2);
        assert!(zones.contains("us-central1-a"));
        assert!(zones.contains("us-east1-b"));
    }
}
