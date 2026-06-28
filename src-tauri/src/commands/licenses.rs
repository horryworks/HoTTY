//! Third-party license attribution.
//!
//! Serves the build-time-generated `resources/third-party-licenses.json`
//! (produced by `scripts/generate-third-party-licenses.mjs`) to the frontend
//! About screen. Reproducing the bundled MIT/BSD/Apache notices satisfies their
//! attribution terms. The full license texts live in the bundled resource — not
//! the JS bundle — so they are loaded on demand here.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;

/// One bundled third-party dependency.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LicenseEntry {
    pub name: String,
    pub version: String,
    /// "npm" | "rust"
    pub ecosystem: String,
    /// SPDX expression or best-effort license name.
    pub license: String,
    #[serde(default)]
    pub repository: Option<String>,
    #[serde(default)]
    pub license_text: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct LicenseCounts {
    pub npm: usize,
    pub rust: usize,
    pub total: usize,
}

/// The attribution manifest returned to the frontend.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ThirdPartyLicenses {
    #[serde(default)]
    pub generated_at: Option<String>,
    #[serde(default)]
    pub counts: Option<LicenseCounts>,
    #[serde(default)]
    pub packages: Vec<LicenseEntry>,
}

/// 32 MB ceiling — the manifest embeds license texts for the full dependency
/// graph, but should never approach this.
const MAX_LICENSE_FILE_SIZE: u64 = 32 * 1024 * 1024;

/// Resolve the bundled resources directory.
fn resources_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("failed to resolve resource dir: {e}"))?;
    Ok(resource_dir.join("resources"))
}

/// Read the bundled third-party license manifest. Returns an empty manifest when
/// the file is absent (e.g. a dev run where `licenses:generate` has not run) so
/// the UI shows its empty state rather than an error.
#[tauri::command]
pub fn get_third_party_licenses(app: AppHandle) -> Result<ThirdPartyLicenses, String> {
    let path = resources_dir(&app)?.join("third-party-licenses.json");
    if !path.exists() {
        return Ok(ThirdPartyLicenses::default());
    }
    let meta = std::fs::metadata(&path)
        .map_err(|e| format!("cannot read license manifest: {e}"))?;
    if meta.len() > MAX_LICENSE_FILE_SIZE {
        return Err("license manifest exceeds max size".into());
    }
    let contents = std::fs::read_to_string(&path)
        .map_err(|e| format!("failed to read license manifest: {e}"))?;
    serde_json::from_str(&contents)
        .map_err(|e| format!("failed to parse license manifest: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_well_formed_manifest() {
        let json = r#"{
            "generatedAt": "2026-06-29T00:00:00.000Z",
            "counts": { "npm": 1, "rust": 1, "total": 2 },
            "packages": [
                { "name": "react", "version": "19.2.4", "ecosystem": "npm", "license": "MIT", "repository": "https://github.com/facebook/react", "licenseText": "MIT License..." },
                { "name": "serde", "version": "1.0.0", "ecosystem": "rust", "license": "MIT OR Apache-2.0" }
            ]
        }"#;
        let parsed: ThirdPartyLicenses = serde_json::from_str(json).expect("valid manifest parses");
        assert_eq!(parsed.packages.len(), 2);
        assert_eq!(parsed.counts.as_ref().unwrap().total, 2);
        let react = &parsed.packages[0];
        assert_eq!(react.name, "react");
        assert_eq!(react.ecosystem, "npm");
        assert!(react.license_text.is_some());
        // Missing optional fields default to None.
        assert!(parsed.packages[1].repository.is_none());
        assert!(parsed.packages[1].license_text.is_none());
    }

    #[test]
    fn empty_manifest_is_default() {
        let m = ThirdPartyLicenses::default();
        assert!(m.packages.is_empty());
        assert!(m.generated_at.is_none());
    }
}
