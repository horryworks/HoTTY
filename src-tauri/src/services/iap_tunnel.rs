use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicU32, Ordering},
    Arc, RwLock,
};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use regex_lite::Regex;
use tauri::{AppHandle, Emitter};
use tokio::process::Command;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;

use super::sensitive_env::sanitized_env;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Default timeout for short-lived gcloud CLI commands (e.g. `describe`, `list`).
const GCLOUD_CMD_TIMEOUT_SECS: u64 = 15;

/// Timeout for the per-project `compute instances list` call used by GCP
/// Discovery. Larger than the default because it must round-trip the Compute
/// Engine API for every zone in the project, and because projects without
/// Compute Engine enabled don't return their "API is not enabled" error within
/// the default 15s window — we need to wait long enough for gcloud to surface
/// stderr so the mapper below can translate it into a friendly message.
const GCP_LIST_INSTANCES_TIMEOUT_SECS: u64 = 60;

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

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AccessState {
    Granted,
    Denied,
    Unknown,
}

/// Per-project IAM probe result for IAP/SSH login capability.
///
/// `iap_tunnel` (`iap.tunnelInstances.accessViaIAP`) is the gate for the IAP
/// tunnel itself — without it the connection cannot be established.
/// `os_login` (`compute.instances.osLogin`) is informational only: missing
/// OS Login does not necessarily mean SSH is impossible because the instance
/// may grant access via metadata SSH keys instead.
#[derive(Debug, Clone, Copy, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAccess {
    pub iap_tunnel: AccessState,
    pub os_login: AccessState,
}

impl ProjectAccess {
    pub fn unknown() -> Self {
        Self {
            iap_tunnel: AccessState::Unknown,
            os_login: AccessState::Unknown,
        }
    }
}

/// Per-instance IAM probe result. Same semantics as `ProjectAccess` but
/// resolved at the resource level — used as a fallback when project-level
/// IAP access is denied so we don't hide instances that have resource-level
/// IAM grants.
#[derive(Debug, Clone, Copy, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceAccess {
    pub iap_tunnel: AccessState,
    pub os_login: AccessState,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GceInstance {
    pub name: String,
    pub status: String,
    /// Zone short name (e.g. "us-central1-a"). Always populated for entries
    /// produced by `list_instances` and `list_instances_across_zones`; the
    /// optionality preserves serialization compatibility for older payloads.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zone: Option<String>,
    /// Per-instance IAM probe result. Present only when refresh ran a
    /// resource-level fallback test (i.e. project-level IAP was denied).
    /// When absent, the project-level `ProjectAccess` should be consulted.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub access: Option<InstanceAccess>,
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

    // Inherit a sanitized environment, matching gcloud_iap::build_gcloud_command.
    // These auxiliary gcloud calls (IAM probe, instances list, status describe)
    // previously inherited the full parent environment, while the tunnel path
    // scrubbed credential-bearing vars — an inconsistent, security-relevant
    // divergence. Keep both gcloud surfaces on one env policy. sanitized_env()
    // preserves what gcloud needs (PATH, %APPDATA% for auth, its bundled python).
    cmd.env_clear();
    for (k, v) in sanitized_env() {
        cmd.env(k, v);
    }

    let started = Instant::now();
    let args_preview: String = args.join(" ").chars().take(160).collect();
    log::debug!("run_gcloud: begin args=`{args_preview}` timeout={timeout_secs}s");
    let result = tokio::time::timeout(Duration::from_secs(timeout_secs), cmd.output()).await;
    let elapsed = started.elapsed();

    let output = match result {
        Err(_) => {
            log::warn!(
                "run_gcloud: TIMED OUT after {elapsed:?} (timeout={timeout_secs}s) args=`{args_preview}`"
            );
            return Err("gcloud command timed out".to_string());
        }
        Ok(Err(e)) => {
            log::warn!("run_gcloud: spawn/io error after {elapsed:?}: {e}");
            return Err(format!("Failed to run gcloud: {e}"));
        }
        Ok(Ok(out)) => out,
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stderr_preview: String = stderr.chars().take(240).collect();
        log::warn!(
            "run_gcloud: non-zero exit ({:?}) after {elapsed:?} args=`{args_preview}` stderr=`{stderr_preview}`",
            output.status.code()
        );
        return Err(format!("gcloud error: {}", stderr.trim()));
    }

    log::debug!(
        "run_gcloud: ok after {elapsed:?} stdout_bytes={} args=`{args_preview}`",
        output.stdout.len()
    );
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

// ---------------------------------------------------------------------------
// IAM permission probes (used to filter the GCP pane to instances the user
// actually has IAP/SSH access to).
// ---------------------------------------------------------------------------

/// IAM permission required for the IAP tunnel itself.
pub(crate) const PERM_IAP_TUNNEL: &str = "iap.tunnelInstances.accessViaIAP";

/// IAM permission corresponding to OS Login (the modern SSH-via-OAuth path).
/// Missing this permission does NOT guarantee SSH is impossible — instances
/// running without OS Login still accept metadata-based SSH keys — so the UI
/// surfaces it as a warning rather than using it as a filter.
pub(crate) const PERM_OS_LOGIN: &str = "compute.instances.osLogin";

fn classify_permission(granted: &[String], wanted: &str) -> AccessState {
    if granted.iter().any(|p| p == wanted) {
        AccessState::Granted
    } else {
        AccessState::Denied
    }
}

/// Probe project-level IAM permissions relevant to IAP-tunneled SSH.
///
/// Calls `gcloud projects test-iam-permissions <project> --permissions=...`.
/// gcloud returns only the subset of permissions the caller actually holds,
/// so an empty/omitted entry maps to `Denied`. Any failure of the underlying
/// gcloud command (network blip, project deleted mid-list, …) is returned as
/// `Err` so the caller can mark the project as `Unknown` and default to
/// showing it in the UI rather than hiding accessible VMs.
pub async fn test_project_iam_permissions(project: &str) -> Result<ProjectAccess, String> {
    if !is_valid_project(project) {
        return Err(format!("invalid project: {project}"));
    }
    let permissions = format!("--permissions={PERM_IAP_TUNNEL},{PERM_OS_LOGIN}");
    let args = [
        "projects",
        "test-iam-permissions",
        project,
        permissions.as_str(),
        "--format=json",
        "--quiet",
    ];
    let output = run_gcloud(&args).await?;
    parse_test_iam_permissions(&output)
}

/// Parse the JSON returned by `*.testIamPermissions`. The response shape is
/// `{ "permissions": ["perm.a", "perm.b", ...] }` — permissions not granted
/// are simply omitted, and an empty / missing `permissions` field means none
/// were granted.
fn parse_test_iam_permissions(json_str: &str) -> Result<ProjectAccess, String> {
    let value: serde_json::Value = serde_json::from_str(json_str.trim())
        .map_err(|e| format!("failed to parse test-iam-permissions JSON: {e}"))?;
    let granted: Vec<String> = value
        .get("permissions")
        .and_then(|p| p.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    Ok(ProjectAccess {
        iap_tunnel: classify_permission(&granted, PERM_IAP_TUNNEL),
        os_login: classify_permission(&granted, PERM_OS_LOGIN),
    })
}

/// Probe instance-level IAM permissions via the Compute Engine REST API.
///
/// `gcloud` does not expose a CLI subcommand for compute-instance
/// `testIamPermissions`, so we shell out to `gcloud auth print-access-token`
/// for an OAuth bearer and post directly to the REST endpoint. Failure to
/// obtain a token or any HTTP-level error is returned as `Err` so the caller
/// can record `Unknown` and default to showing the instance.
pub async fn test_instance_iam_permissions(
    project: &str,
    zone: &str,
    instance: &str,
) -> Result<InstanceAccess, String> {
    if !is_valid_project(project) {
        return Err(format!("invalid project: {project}"));
    }
    if !is_valid_zone(zone) {
        return Err(format!("invalid zone: {zone}"));
    }
    if !is_valid_instance(instance) {
        return Err(format!("invalid instance: {instance}"));
    }

    let token = run_gcloud(&["auth", "print-access-token"]).await?;
    let token = token.trim();
    if token.is_empty() {
        return Err("gcloud returned an empty access token".to_string());
    }

    // URL components are all validated by the regexes above; no path traversal
    // or query-string injection is reachable here.
    let url = format!(
        "https://compute.googleapis.com/compute/v1/projects/{project}/zones/{zone}/instances/{instance}/testIamPermissions"
    );
    let body = serde_json::json!({
        "permissions": [PERM_IAP_TUNNEL, PERM_OS_LOGIN],
    });

    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .bearer_auth(token)
        .json(&body)
        .timeout(Duration::from_secs(GCLOUD_CMD_TIMEOUT_SECS))
        .send()
        .await
        .map_err(|e| format!("testIamPermissions request failed: {e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        let preview: String = text.chars().take(160).collect();
        return Err(format!(
            "testIamPermissions HTTP {status}: {preview}"
        ));
    }
    let payload = resp
        .text()
        .await
        .map_err(|e| format!("failed to read testIamPermissions response: {e}"))?;
    let parsed = parse_test_iam_permissions(&payload)?;
    Ok(InstanceAccess {
        iap_tunnel: parsed.iap_tunnel,
        os_login: parsed.os_login,
    })
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
                    Some(GceInstance {
                        name,
                        status,
                        zone: Some(zone.to_string()),
                        access: None,
                    })
                })
                .collect()
        }
        Err(e) => {
            log::warn!("Failed to list instances for {project}/{zone}: {e}");
            Vec::new()
        }
    }
}

/// List all compute instances across all zones for a given project in a single
/// gcloud call. Each returned `GceInstance` carries its zone in `zone`.
/// Returns `Err(message)` only when the gcloud command itself fails (permission
/// denied, project not found, etc.) so that the caller can surface a per-project
/// error in the UI rather than silently dropping data.
pub async fn list_instances_across_zones(project: &str) -> Result<Vec<GceInstance>, String> {
    if !is_valid_project(project) {
        return Err(format!("invalid project: {project}"));
    }
    let project_flag = format!("--project={project}");
    // `--quiet` prevents gcloud from emitting the interactive "Do you want to
    // enable the API?" prompt when Compute Engine API is disabled. Without it
    // gcloud may stall on a stdin read against a closed pipe instead of
    // failing fast with the real error message.
    let args = [
        "compute",
        "instances",
        "list",
        "--format=json",
        &project_flag,
        "--sort-by=zone,name",
        "--quiet",
    ];
    let started = Instant::now();
    log::info!(
        "gcp-cache: list_instances_across_zones begin project={project} (timeout={GCP_LIST_INSTANCES_TIMEOUT_SECS}s)"
    );
    let output = match run_gcloud_with_timeout(&args, GCP_LIST_INSTANCES_TIMEOUT_SECS).await {
        Ok(out) => {
            log::info!(
                "gcp-cache: list_instances_across_zones ok project={project} elapsed={:?} bytes={}",
                started.elapsed(),
                out.len()
            );
            out
        }
        Err(e) => {
            // Truncate the raw error so the log line stays readable; the
            // mapped error keeps the actionable bits.
            let preview: String = e.chars().take(240).collect();
            log::warn!(
                "gcp-cache: list_instances_across_zones FAILED project={project} elapsed={:?} err={preview}",
                started.elapsed()
            );
            return Err(map_list_instances_error(&e, project));
        }
    };
    let entries: Vec<serde_json::Value> = serde_json::from_str(&output)
        .map_err(|e| format!("failed to parse gcloud instances list JSON: {e}"))?;
    let instances = entries
        .iter()
        .filter_map(|e| {
            let name = e.get("name")?.as_str()?.to_string();
            let status = e
                .get("status")
                .and_then(|s| s.as_str())
                .unwrap_or("UNKNOWN")
                .to_string();
            let zone_raw = e.get("zone").and_then(|z| z.as_str()).unwrap_or("");
            // Zone field may be a full URL like
            //   "https://www.googleapis.com/compute/v1/projects/X/zones/us-central1-a"
            // or just "us-central1-a". Take the last path component.
            let zone_name = zone_raw.rsplit('/').next().unwrap_or(zone_raw).to_string();
            let zone = if zone_name.is_empty() {
                None
            } else {
                Some(zone_name)
            };
            Some(GceInstance {
                name,
                status,
                zone,
                access: None,
            })
        })
        .collect();
    Ok(instances)
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

/// Translate gcloud stderr for `instances list` (used by GCP Discovery) into a
/// more actionable message when we recognise a known failure pattern; otherwise
/// pass the original string through.
///
/// Targets two common failure modes the user will hit during Discovery:
///   * Compute Engine API not enabled on the project (the typical case for
///     "Default Gemini Project" / Vertex / AI-Studio-managed projects that
///     never opted in to Compute Engine).
///   * Missing `compute.instances.list` IAM permission.
pub(crate) fn map_list_instances_error(raw: &str, project: &str) -> String {
    let lower = raw.to_ascii_lowercase();

    // Compute Engine API not enabled. Examples from gcloud stderr:
    //   "Compute Engine API has not been used in project NNN before or it is disabled"
    //   "compute.googleapis.com is not enabled"
    let api_not_enabled = lower.contains("compute engine api has not been used")
        || lower.contains("compute engine api is not enabled")
        || (lower.contains("compute.googleapis.com")
            && (lower.contains("not enabled") || lower.contains("has not been used")));
    if api_not_enabled {
        return "Compute Engine API is not enabled.".to_string();
    }

    // Missing list permission (the granular one is more useful than a generic
    // PERMISSION_DENIED bucket).
    let missing_list_perm = lower.contains("required 'compute.instances.list' permission")
        || lower.contains("required \"compute.instances.list\" permission")
        || lower.contains("does not have compute.instances.list")
        || lower.contains("compute.instances.list permission");
    if missing_list_perm {
        return format!(
            "Permission denied: this account does not have \
             `compute.instances.list` on project '{project}'."
        );
    }

    // Generic permission denied that isn't list-specific.
    if lower.contains("permission_denied") || lower.contains("permission denied") {
        return format!(
            "Permission denied while listing instances on project '{project}': {}",
            raw.trim()
        );
    }

    // Fall-through: surface the raw gcloud error so the user has *something*
    // to act on even when we don't recognise the pattern.
    raw.trim().to_string()
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

/// Stop a running GCE instance via blocking `gcloud compute instances stop`.
pub async fn stop_instance(project: &str, zone: &str, instance: &str) -> Result<(), String> {
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
        "stop",
        instance,
        &project_flag,
        &zone_flag,
    ];
    run_gcloud_with_timeout(&args, INSTANCE_START_TIMEOUT_SECS).await?;
    Ok(())
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
// GCP cache (used by the "GCP" sidebar tab — lazy refresh on first open)
// ---------------------------------------------------------------------------

/// Maximum concurrent `gcloud compute instances list` calls during refresh.
/// Bounded to be polite to the GCP API and to keep the UI progress events
/// at a comprehensible pace.
const GCP_REFRESH_MAX_CONCURRENCY: usize = 5;

/// Maximum concurrent per-instance `testIamPermissions` REST calls within a
/// single project's refresh task (only invoked as a fallback when project-
/// level IAP access is denied). Kept small to avoid swamping the Compute API.
const GCP_REFRESH_PER_INSTANCE_CONCURRENCY: usize = 3;

#[derive(Debug, Default, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GcloudCacheSnapshot {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gcloud: Option<GcloudStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth: Option<GcloudAuthStatus>,
    pub projects: Vec<GcpProject>,
    pub instances_by_project: HashMap<String, Vec<GceInstance>>,
    pub project_errors: HashMap<String, String>,
    /// Per-project IAM probe result. Projects missing from this map have not
    /// been probed yet (treated by the frontend as `Unknown` → show by default).
    pub project_access: HashMap<String, ProjectAccess>,
    /// Milliseconds since the Unix epoch when the cache was last fully refreshed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_refreshed_ms: Option<u64>,
    pub refresh_in_progress: bool,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct GcpRefreshProgressEvent {
    /// One of: "gcloud", "auth", "projects", "instances", "done"
    stage: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    current_project: Option<String>,
    done: u32,
    total: u32,
}

pub struct GcloudCacheState {
    inner: RwLock<GcloudCacheSnapshot>,
}

impl Default for GcloudCacheState {
    fn default() -> Self {
        Self::new()
    }
}

impl GcloudCacheState {
    pub fn new() -> Self {
        Self {
            inner: RwLock::new(GcloudCacheSnapshot::default()),
        }
    }

    pub fn snapshot(&self) -> GcloudCacheSnapshot {
        self.inner
            .read()
            .map(|g| g.clone())
            .unwrap_or_default()
    }

    /// Begin a refresh; returns `false` if another refresh is already in flight.
    fn begin_refresh(&self) -> bool {
        match self.inner.write() {
            Ok(mut g) => {
                if g.refresh_in_progress {
                    false
                } else {
                    g.refresh_in_progress = true;
                    true
                }
            }
            Err(_) => false,
        }
    }

    fn write_partial<F: FnOnce(&mut GcloudCacheSnapshot)>(&self, f: F) {
        if let Ok(mut g) = self.inner.write() {
            f(&mut g);
        }
    }

    /// Run a full refresh: gcloud check → auth check → projects → instances per
    /// project (bounded concurrency). Emits `gcp-refresh-progress` events along
    /// the way and a `gcp-cache-updated` event on completion. Safe to call
    /// concurrently — overlapping calls become no-ops.
    pub async fn refresh_all(self: &Arc<Self>, app: AppHandle) {
        if !self.begin_refresh() {
            log::info!("gcp-cache: refresh already in progress, skipping new request");
            return;
        }
        let refresh_started = Instant::now();
        log::info!("gcp-cache: refresh begin");

        emit_progress(&app, "gcloud", None, 0, 0);
        let gcloud = check_gcloud().await;
        log::info!(
            "gcp-cache: check_gcloud done (available={}, version={:?})",
            gcloud.available,
            gcloud.version
        );
        self.write_partial(|s| s.gcloud = Some(gcloud.clone()));

        emit_progress(&app, "auth", None, 0, 0);
        let auth = check_auth().await;
        log::info!(
            "gcp-cache: check_auth done (authenticated={}, account={:?})",
            auth.authenticated,
            auth.account
        );
        self.write_partial(|s| s.auth = Some(auth.clone()));

        // Skip projects/instances when gcloud unavailable or unauthenticated.
        if !gcloud.available || !auth.authenticated {
            self.write_partial(|s| {
                s.projects.clear();
                s.instances_by_project.clear();
                s.project_errors.clear();
                s.project_access.clear();
                s.last_refreshed_ms = now_ms();
                s.refresh_in_progress = false;
            });
            emit_progress(&app, "done", None, 0, 0);
            let _ = app.emit("gcp-cache-updated", ());
            return;
        }

        emit_progress(&app, "projects", None, 0, 0);
        let projects = list_projects().await;
        let total = projects.len() as u32;
        log::info!(
            "gcp-cache: list_projects done — {} projects: {}",
            projects.len(),
            projects
                .iter()
                .map(|p| p.id.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        );
        self.write_partial(|s| {
            s.projects = projects.clone();
            s.instances_by_project.clear();
            s.project_errors.clear();
            s.project_access.clear();
        });

        // Fan out per-project work with bounded concurrency. Each task probes
        // project-level IAM permissions, lists instances, and (if the
        // project-level IAP check was denied) probes per-instance permissions
        // as a fallback to catch resource-level IAM bindings.
        let sem = Arc::new(Semaphore::new(GCP_REFRESH_MAX_CONCURRENCY));
        let done_counter = Arc::new(AtomicU32::new(0));
        let mut set: JoinSet<(
            String,
            ProjectAccess,
            Result<Vec<GceInstance>, String>,
        )> = JoinSet::new();

        for p in &projects {
            let pid = p.id.clone();
            let sem = Arc::clone(&sem);
            let counter = Arc::clone(&done_counter);
            let app_for_progress = app.clone();
            let total_for_progress = total;
            set.spawn(async move {
                let _permit = match sem.acquire().await {
                    Ok(p) => p,
                    Err(_) => {
                        return (
                            pid,
                            ProjectAccess::unknown(),
                            Err("semaphore closed".to_string()),
                        );
                    }
                };

                let proj_access = match test_project_iam_permissions(&pid).await {
                    Ok(a) => a,
                    Err(e) => {
                        log::warn!(
                            "gcp-cache: test_project_iam_permissions failed project={pid} err={e}"
                        );
                        ProjectAccess::unknown()
                    }
                };
                log::debug!(
                    "gcp-cache: project_access[{pid}] iap={:?} osLogin={:?}",
                    proj_access.iap_tunnel,
                    proj_access.os_login
                );

                let list_result = list_instances_across_zones(&pid).await;
                let mut instances = match list_result {
                    Ok(v) => v,
                    Err(e) => {
                        let done = counter.fetch_add(1, Ordering::SeqCst) + 1;
                        emit_progress(
                            &app_for_progress,
                            "instances",
                            Some(pid.clone()),
                            done,
                            total_for_progress,
                        );
                        return (pid, proj_access, Err(e));
                    }
                };

                match proj_access.iap_tunnel {
                    AccessState::Granted => {
                        // Inherit project-level grant to every instance — saves
                        // N resource-level probes that would all return Granted.
                        for inst in &mut instances {
                            inst.access = Some(InstanceAccess {
                                iap_tunnel: AccessState::Granted,
                                os_login: proj_access.os_login,
                            });
                        }
                    }
                    AccessState::Denied if !instances.is_empty() => {
                        // Fallback: probe each instance directly via the
                        // Compute REST API to detect resource-level IAP grants
                        // that wouldn't show up at the project level.
                        let inner_sem = Arc::new(Semaphore::new(
                            GCP_REFRESH_PER_INSTANCE_CONCURRENCY,
                        ));
                        let mut inner_set: JoinSet<(usize, Option<InstanceAccess>)> =
                            JoinSet::new();
                        for (idx, inst) in instances.iter().enumerate() {
                            let zone = match inst.zone.clone() {
                                Some(z) => z,
                                None => continue,
                            };
                            let name = inst.name.clone();
                            let proj = pid.clone();
                            let inner_sem = Arc::clone(&inner_sem);
                            inner_set.spawn(async move {
                                let _p = match inner_sem.acquire().await {
                                    Ok(p) => p,
                                    Err(_) => return (idx, None),
                                };
                                match test_instance_iam_permissions(&proj, &zone, &name).await {
                                    Ok(a) => (idx, Some(a)),
                                    Err(e) => {
                                        log::debug!(
                                            "gcp-cache: instance probe failed {proj}/{zone}/{name}: {e}"
                                        );
                                        (idx, None)
                                    }
                                }
                            });
                        }
                        while let Some(j) = inner_set.join_next().await {
                            if let Ok((idx, Some(access))) = j {
                                if let Some(inst) = instances.get_mut(idx) {
                                    inst.access = Some(access);
                                }
                            }
                        }
                    }
                    _ => {
                        // Denied with no instances, or Unknown: don't annotate
                        // — frontend treats absent `access` as Unknown → show.
                    }
                }

                let done = counter.fetch_add(1, Ordering::SeqCst) + 1;
                emit_progress(
                    &app_for_progress,
                    "instances",
                    Some(pid.clone()),
                    done,
                    total_for_progress,
                );
                (pid, proj_access, Ok(instances))
            });
        }

        while let Some(joined) = set.join_next().await {
            match joined {
                Ok((pid, proj_access, Ok(list))) => {
                    self.write_partial(|s| {
                        s.project_access.insert(pid.clone(), proj_access);
                        s.instances_by_project.insert(pid, list);
                    });
                }
                Ok((pid, proj_access, Err(e))) => {
                    self.write_partial(|s| {
                        s.project_access.insert(pid.clone(), proj_access);
                        s.project_errors.insert(pid, e);
                    });
                }
                Err(join_err) => {
                    log::warn!("gcp-cache: instances list task panicked: {join_err}");
                }
            }
        }

        self.write_partial(|s| {
            s.last_refreshed_ms = now_ms();
            s.refresh_in_progress = false;
        });
        let snap = self.snapshot();
        log::info!(
            "gcp-cache: refresh done elapsed={:?} projects={} with_instances={} errors={} probed={}",
            refresh_started.elapsed(),
            snap.projects.len(),
            snap.instances_by_project.len(),
            snap.project_errors.len(),
            snap.project_access.len()
        );
        for (pid, msg) in &snap.project_errors {
            let preview: String = msg.chars().take(240).collect();
            log::warn!("gcp-cache: project_errors[{pid}] = {preview}");
        }
        emit_progress(&app, "done", None, total, total);
        let _ = app.emit("gcp-cache-updated", ());
    }
}

fn now_ms() -> Option<u64> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as u64)
}

fn emit_progress(
    app: &AppHandle,
    stage: &'static str,
    current_project: Option<String>,
    done: u32,
    total: u32,
) {
    let _ = app.emit(
        "gcp-refresh-progress",
        GcpRefreshProgressEvent {
            stage,
            current_project,
            done,
            total,
        },
    );
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

    // -- map_list_instances_error tests --

    #[test]
    fn map_list_instances_error_detects_api_not_enabled() {
        let raw = "gcloud error: ERROR: (gcloud.compute.instances.list) HTTPError 403: \
                   Compute Engine API has not been used in project 1234567890 before \
                   or it is disabled. Enable it by visiting ...";
        let msg = map_list_instances_error(raw, "my-project");
        assert_eq!(msg, "Compute Engine API is not enabled.");
    }

    #[test]
    fn map_list_instances_error_detects_api_disabled_alt_phrasing() {
        let raw = "ERROR: compute.googleapis.com is not enabled";
        let msg = map_list_instances_error(raw, "p-x");
        assert!(msg.contains("Compute Engine API is not enabled"));
    }

    #[test]
    fn map_list_instances_error_detects_missing_list_permission() {
        let raw = "ERROR: (gcloud.compute.instances.list) Required \
                   'compute.instances.list' permission for 'projects/foo'";
        let msg = map_list_instances_error(raw, "foo");
        assert!(msg.contains("Permission denied"));
        assert!(msg.contains("compute.instances.list"));
        assert!(msg.contains("foo"));
    }

    #[test]
    fn map_list_instances_error_generic_permission_denied_falls_through() {
        let raw = "ERROR: PERMISSION_DENIED: weird upstream error";
        let msg = map_list_instances_error(raw, "p");
        assert!(msg.contains("Permission denied while listing instances"));
        // Underlying message is preserved.
        assert!(msg.contains("weird upstream error"));
    }

    #[test]
    fn map_list_instances_error_unknown_passes_through() {
        let raw = "gcloud command timed out";
        let msg = map_list_instances_error(raw, "p");
        assert_eq!(msg, "gcloud command timed out");
    }

    #[test]
    fn gce_instance_serialize_with_zone() {
        let instance = GceInstance {
            name: "vm-web-01".to_string(),
            status: "RUNNING".to_string(),
            zone: Some("us-central1-a".to_string()),
            access: None,
        };
        let json = serde_json::to_value(&instance).unwrap();
        assert_eq!(json["name"], "vm-web-01");
        assert_eq!(json["status"], "RUNNING");
        assert_eq!(json["zone"], "us-central1-a");
        // access is omitted when None
        assert!(json.get("access").is_none());
    }

    #[test]
    fn gce_instance_serialize_zone_omitted_when_none() {
        let instance = GceInstance {
            name: "vm-x".to_string(),
            status: "RUNNING".to_string(),
            zone: None,
            access: None,
        };
        let json = serde_json::to_value(&instance).unwrap();
        assert!(json.get("zone").is_none());
    }

    // -- GcloudCacheState tests --

    #[test]
    fn cache_default_state_is_empty() {
        let cache = GcloudCacheState::new();
        let snap = cache.snapshot();
        assert!(snap.gcloud.is_none());
        assert!(snap.auth.is_none());
        assert!(snap.projects.is_empty());
        assert!(snap.instances_by_project.is_empty());
        assert!(snap.project_errors.is_empty());
        assert!(snap.project_access.is_empty());
        assert!(snap.last_refreshed_ms.is_none());
        assert!(!snap.refresh_in_progress);
    }

    #[test]
    fn cache_begin_refresh_is_single_writer() {
        let cache = GcloudCacheState::new();
        assert!(cache.begin_refresh(), "first call should succeed");
        assert!(
            !cache.begin_refresh(),
            "second call while in progress should fail"
        );
        // Clear the flag and verify a new refresh can begin.
        cache.write_partial(|s| s.refresh_in_progress = false);
        assert!(
            cache.begin_refresh(),
            "after clearing the flag a new refresh can start"
        );
    }

    #[test]
    fn cache_snapshot_clones_independent_data() {
        let cache = GcloudCacheState::new();
        cache.write_partial(|s| {
            s.projects = vec![GcpProject {
                id: "p1".to_string(),
                name: "P1".to_string(),
            }];
            s.project_errors
                .insert("p2".to_string(), "permission denied".to_string());
        });
        let snap1 = cache.snapshot();
        cache.write_partial(|s| s.projects.clear());
        let snap2 = cache.snapshot();
        assert_eq!(snap1.projects.len(), 1, "first snapshot retains its data");
        assert!(snap2.projects.is_empty());
        assert_eq!(
            snap1.project_errors.get("p2").map(|s| s.as_str()),
            Some("permission denied")
        );
    }

    #[test]
    fn cache_snapshot_serialize_camel_case() {
        let snap = GcloudCacheSnapshot {
            last_refreshed_ms: Some(1_700_000_000_000),
            refresh_in_progress: true,
            ..Default::default()
        };
        let json = serde_json::to_value(&snap).unwrap();
        assert_eq!(json["lastRefreshedMs"], 1_700_000_000_000_u64);
        assert_eq!(json["refreshInProgress"], true);
        // HashMap fields are always present (even when empty) to make the
        // frontend's life simpler.
        assert!(json.get("instancesByProject").is_some());
        assert!(json.get("projectErrors").is_some());
        assert!(json.get("projectAccess").is_some());
    }

    // -- IAM permission probe tests --

    #[test]
    fn parse_test_iam_permissions_grants_both() {
        let json = r#"{
            "permissions": ["iap.tunnelInstances.accessViaIAP", "compute.instances.osLogin"]
        }"#;
        let access = parse_test_iam_permissions(json).unwrap();
        assert_eq!(access.iap_tunnel, AccessState::Granted);
        assert_eq!(access.os_login, AccessState::Granted);
    }

    #[test]
    fn parse_test_iam_permissions_grants_only_iap() {
        let json = r#"{
            "permissions": ["iap.tunnelInstances.accessViaIAP"]
        }"#;
        let access = parse_test_iam_permissions(json).unwrap();
        assert_eq!(access.iap_tunnel, AccessState::Granted);
        assert_eq!(access.os_login, AccessState::Denied);
    }

    #[test]
    fn parse_test_iam_permissions_grants_nothing() {
        // gcloud returns an empty object (no `permissions` key) when none of
        // the requested permissions are held.
        let access = parse_test_iam_permissions("{}").unwrap();
        assert_eq!(access.iap_tunnel, AccessState::Denied);
        assert_eq!(access.os_login, AccessState::Denied);
    }

    #[test]
    fn parse_test_iam_permissions_empty_permissions_array() {
        let access = parse_test_iam_permissions(r#"{"permissions": []}"#).unwrap();
        assert_eq!(access.iap_tunnel, AccessState::Denied);
        assert_eq!(access.os_login, AccessState::Denied);
    }

    #[test]
    fn parse_test_iam_permissions_ignores_extra_permissions() {
        let json = r#"{
            "permissions": [
                "compute.instances.osLogin",
                "compute.instances.list",
                "unrelated.permission"
            ]
        }"#;
        let access = parse_test_iam_permissions(json).unwrap();
        assert_eq!(access.iap_tunnel, AccessState::Denied);
        assert_eq!(access.os_login, AccessState::Granted);
    }

    #[test]
    fn parse_test_iam_permissions_bad_json_errors() {
        assert!(parse_test_iam_permissions("not json").is_err());
    }

    #[test]
    fn project_access_unknown_helper() {
        let pa = ProjectAccess::unknown();
        assert_eq!(pa.iap_tunnel, AccessState::Unknown);
        assert_eq!(pa.os_login, AccessState::Unknown);
    }

    #[test]
    fn project_access_serializes_camel_case() {
        let pa = ProjectAccess {
            iap_tunnel: AccessState::Granted,
            os_login: AccessState::Denied,
        };
        let json = serde_json::to_value(pa).unwrap();
        assert_eq!(json["iapTunnel"], "granted");
        assert_eq!(json["osLogin"], "denied");
    }

    #[test]
    fn instance_access_serializes_camel_case() {
        let ia = InstanceAccess {
            iap_tunnel: AccessState::Granted,
            os_login: AccessState::Unknown,
        };
        let json = serde_json::to_value(ia).unwrap();
        assert_eq!(json["iapTunnel"], "granted");
        assert_eq!(json["osLogin"], "unknown");
    }

    #[test]
    fn gce_instance_serialize_with_access() {
        let inst = GceInstance {
            name: "vm-x".to_string(),
            status: "RUNNING".to_string(),
            zone: Some("us-central1-a".to_string()),
            access: Some(InstanceAccess {
                iap_tunnel: AccessState::Granted,
                os_login: AccessState::Denied,
            }),
        };
        let json = serde_json::to_value(&inst).unwrap();
        assert_eq!(json["access"]["iapTunnel"], "granted");
        assert_eq!(json["access"]["osLogin"], "denied");
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
                Some(GceInstance {
                    name,
                    status,
                    zone: None,
                    access: None,
                })
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
