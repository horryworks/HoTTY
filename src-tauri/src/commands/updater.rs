use serde::{Deserialize, Serialize};

// GitHub releases endpoint.
const RELEASES_URL: &str =
    "https://api.github.com/repos/horryworks/HoTTY/releases/latest";

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    name: Option<String>,
    html_url: String,
    prerelease: bool,
    body: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current_version: String,
    pub latest_version: String,
    pub release_name: String,
    pub release_url: String,
    pub prerelease: bool,
    pub notes: String,
    pub is_newer: bool,
}

/// Strip a leading `v` / `V` from a tag like `v2.0.1` → `2.0.1`.
fn strip_v_prefix(tag: &str) -> &str {
    tag.strip_prefix('v').or_else(|| tag.strip_prefix('V')).unwrap_or(tag)
}

/// Parse a version string into `(major, minor, patch, prerelease_tag)`.
/// Pre-release (anything after `-`) is returned as the tail string; absent pre-release = `""`.
/// Unparseable components default to 0 so a malformed input is treated as the lowest version.
fn parse_version(v: &str) -> (u32, u32, u32, String) {
    let v = strip_v_prefix(v.trim());
    let (core, pre) = match v.split_once('-') {
        Some((c, p)) => (c, p.to_string()),
        None => (v, String::new()),
    };
    let mut parts = core.split('.');
    let major = parts.next().and_then(|s| s.parse::<u32>().ok()).unwrap_or(0);
    let minor = parts.next().and_then(|s| s.parse::<u32>().ok()).unwrap_or(0);
    let patch = parts.next().and_then(|s| s.parse::<u32>().ok()).unwrap_or(0);
    (major, minor, patch, pre)
}

/// Return true iff `latest` is strictly newer than `current` using semver-ish comparison.
/// A release with no pre-release suffix ranks higher than the same core with a pre-release.
fn is_strictly_newer(current: &str, latest: &str) -> bool {
    let (ca, cb, cc, cpre) = parse_version(current);
    let (la, lb, lc, lpre) = parse_version(latest);
    match (la, lb, lc).cmp(&(ca, cb, cc)) {
        std::cmp::Ordering::Greater => true,
        std::cmp::Ordering::Less => false,
        std::cmp::Ordering::Equal => match (cpre.is_empty(), lpre.is_empty()) {
            (false, true) => true,      // current is pre, latest is stable → newer
            (true, false) => false,     // current is stable, latest is pre → not newer
            (true, true) => false,      // identical stable
            (false, false) => lpre > cpre, // string compare is stable-enough for our beta tags
        },
    }
}

#[tauri::command]
pub async fn check_for_updates(app: tauri::AppHandle) -> Result<Option<UpdateInfo>, String> {
    let current = app.package_info().version.to_string();

    let client = reqwest::Client::builder()
        .user_agent(format!("HoTTY/{current}"))
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("http client: {e}"))?;

    let resp = client
        .get(RELEASES_URL)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("github returned status {}", resp.status()));
    }

    let release: GithubRelease = resp
        .json()
        .await
        .map_err(|e| format!("parse release json: {e}"))?;

    let latest_version = strip_v_prefix(&release.tag_name).to_string();
    let is_newer = is_strictly_newer(&current, &latest_version);

    if !is_newer {
        return Ok(None);
    }

    Ok(Some(UpdateInfo {
        current_version: current,
        latest_version,
        release_name: release.name.unwrap_or_else(|| release.tag_name.clone()),
        release_url: release.html_url,
        prerelease: release.prerelease,
        notes: release.body.unwrap_or_default(),
        is_newer,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_v_prefix_trims_leading_v() {
        assert_eq!(strip_v_prefix("v1.2.3"), "1.2.3");
        assert_eq!(strip_v_prefix("V1.2.3"), "1.2.3");
        assert_eq!(strip_v_prefix("1.2.3"), "1.2.3");
    }

    #[test]
    fn parse_version_splits_core_and_pre() {
        assert_eq!(parse_version("2.0.0"), (2, 0, 0, String::new()));
        assert_eq!(parse_version("v2.0.1-beta3"), (2, 0, 1, "beta3".into()));
        assert_eq!(parse_version("garbage"), (0, 0, 0, String::new()));
    }

    #[test]
    fn newer_when_core_is_higher() {
        assert!(is_strictly_newer("2.0.0", "2.0.1"));
        assert!(is_strictly_newer("2.0.0", "2.1.0"));
        assert!(is_strictly_newer("2.0.0", "3.0.0"));
        assert!(!is_strictly_newer("2.0.1", "2.0.0"));
    }

    #[test]
    fn stable_is_newer_than_its_own_prerelease() {
        assert!(is_strictly_newer("2.0.0-beta3", "2.0.0"));
        assert!(!is_strictly_newer("2.0.0", "2.0.0-beta3"));
    }

    #[test]
    fn same_version_is_not_newer() {
        assert!(!is_strictly_newer("2.0.0", "2.0.0"));
        assert!(!is_strictly_newer("2.0.0-beta3", "2.0.0-beta3"));
    }

    #[test]
    fn later_prerelease_tag_is_newer() {
        assert!(is_strictly_newer("2.0.0-beta3", "2.0.0-beta4"));
        assert!(!is_strictly_newer("2.0.0-beta4", "2.0.0-beta3"));
    }
}
