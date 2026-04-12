use std::collections::HashSet;
use std::path::PathBuf;

use regex_lite::Regex;
use tokio::process::Command;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Timeout for gcloud CLI commands (milliseconds).
const GCLOUD_CMD_TIMEOUT_SECS: u64 = 15;

/// Maximum number of projects returned by `list_projects`.
const MAX_PROJECTS: usize = 100;

// ---------------------------------------------------------------------------
// Validation regex patterns
// ---------------------------------------------------------------------------

/// GCP project ID: 6-30 chars, lowercase + digits + hyphens, starts with letter.
const RE_PROJECT: &str = r"^[a-z][a-z0-9\-]{4,28}[a-z0-9]$";

/// GCP zone: e.g. us-central1-a
const RE_ZONE: &str = r"^[a-z]+-[a-z]+[0-9]+-[a-z]$";

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

fn is_valid_project(project: &str) -> bool {
    use std::sync::OnceLock;
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(RE_PROJECT).unwrap()).is_match(project)
}

fn is_valid_zone(zone: &str) -> bool {
    use std::sync::OnceLock;
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(RE_ZONE).unwrap()).is_match(zone)
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

/// Return the gcloud program name and whether shell mode is needed.
fn gcloud_program() -> (String, bool) {
    if let Some(path) = find_gcloud_path() {
        (path.to_string_lossy().into_owned(), cfg!(target_os = "windows"))
    } else {
        // Fallback: rely on shell PATH resolution
        let name = if cfg!(target_os = "windows") {
            "gcloud.cmd".to_string()
        } else {
            "gcloud".to_string()
        };
        (name, cfg!(target_os = "windows"))
    }
}

// ---------------------------------------------------------------------------
// gcloud command runner
// ---------------------------------------------------------------------------

/// Run a gcloud command with the given arguments and return stdout.
async fn run_gcloud(args: &[&str]) -> Result<String, String> {
    let (program, use_shell) = gcloud_program();

    let mut cmd = Command::new(if use_shell { "cmd" } else { &program });

    if use_shell {
        // On Windows, run via cmd /C to handle .cmd files.
        // Each argument is quoted and inner quotes are escaped to prevent
        // shell interpretation of special characters.
        cmd.arg("/C");
        let mut full_cmd = format!("\"{}\"", program);
        for arg in args {
            let escaped = arg.replace('"', "\"\"");
            full_cmd.push(' ');
            full_cmd.push('"');
            full_cmd.push_str(&escaped);
            full_cmd.push('"');
        }
        cmd.arg(&full_cmd);
    } else {
        cmd.args(args);
    }

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let output = tokio::time::timeout(
        std::time::Duration::from_secs(GCLOUD_CMD_TIMEOUT_SECS),
        cmd.output(),
    )
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
    let zone_filter = format!("--filter=zone:({zone})");
    let args = [
        "compute",
        "instances",
        "list",
        "--format=json",
        &project_flag,
        &zone_filter,
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
