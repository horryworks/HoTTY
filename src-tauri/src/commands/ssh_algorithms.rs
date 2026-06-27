use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct AlgorithmEntry {
    pub name: String,
    pub enabled: bool,
}

/// The full SSH algorithm configuration with four categories.
pub type SshAlgorithms = HashMap<String, Vec<AlgorithmEntry>>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_CATEGORIES: &[&str] = &["kex", "cipher", "serverHostKey", "hmac"];
const MAX_ENTRIES_PER_CATEGORY: usize = 100;
const MAX_ALGORITHM_NAME_LEN: usize = 100;
const MAX_FILE_SIZE: u64 = 100 * 1024; // 100 KB
const ALGORITHMS_FILENAME: &str = "ssh_algorithms.json";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Get the path for the user's SSH algorithms config (app config dir).
fn user_algorithms_path(app: &AppHandle) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("failed to resolve app config dir: {e}"))?;
    if !config_dir.exists() {
        std::fs::create_dir_all(&config_dir)
            .map_err(|e| format!("failed to create config dir: {e}"))?;
    }
    Ok(config_dir.join(ALGORITHMS_FILENAME))
}

/// Get the path for the bundled default SSH algorithms (resources).
fn bundled_algorithms_path(app: &AppHandle) -> Result<PathBuf, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("failed to resolve resource dir: {e}"))?;
    Ok(resource_dir.join("resources").join(ALGORITHMS_FILENAME))
}

/// Validate the structure of SSH algorithms data.
fn validate_algorithms(data: &SshAlgorithms) -> Result<(), String> {
    for (category, entries) in data {
        if !VALID_CATEGORIES.contains(&category.as_str()) {
            return Err(format!("invalid algorithm category: {category}"));
        }
        if entries.len() > MAX_ENTRIES_PER_CATEGORY {
            return Err(format!(
                "category '{category}' has too many entries (max {MAX_ENTRIES_PER_CATEGORY})"
            ));
        }
        for entry in entries {
            if entry.name.is_empty() || entry.name.len() > MAX_ALGORITHM_NAME_LEN {
                return Err(format!(
                    "algorithm name must be 1-{MAX_ALGORITHM_NAME_LEN} characters"
                ));
            }
        }
    }
    Ok(())
}

/// Merge the user's saved algorithm choices with the bundled defaults.
///
/// For each category present in `bundled`, returns entries in the bundled
/// order. Each entry's `enabled` flag is taken from `user` when the algorithm
/// name is present there, otherwise from `bundled`. Algorithms that exist in
/// `user` but not in `bundled` are appended at the end of their category, so
/// users can still toggle algorithms the bundled defaults don't ship.
///
/// This lets new algorithm names introduced in a release reach existing
/// installs (where the user's saved file would otherwise hide them) without
/// overwriting the user's enabled/disabled choices for names they already
/// configured.
pub fn merge_user_with_bundled(user: &SshAlgorithms, bundled: &SshAlgorithms) -> SshAlgorithms {
    use std::collections::HashSet;

    let mut merged: SshAlgorithms = HashMap::new();
    for (category, bundled_entries) in bundled {
        let empty: Vec<AlgorithmEntry> = Vec::new();
        let user_entries = user.get(category).unwrap_or(&empty);
        let user_enabled: HashMap<&str, bool> = user_entries
            .iter()
            .map(|e| (e.name.as_str(), e.enabled))
            .collect();

        let mut out: Vec<AlgorithmEntry> = Vec::with_capacity(bundled_entries.len());
        let mut seen: HashSet<&str> = HashSet::new();
        for be in bundled_entries {
            let enabled = user_enabled
                .get(be.name.as_str())
                .copied()
                .unwrap_or(be.enabled);
            out.push(AlgorithmEntry {
                name: be.name.clone(),
                enabled,
            });
            seen.insert(be.name.as_str());
        }
        for ue in user_entries {
            if !seen.contains(ue.name.as_str()) {
                out.push(ue.clone());
            }
        }
        merged.insert(category.clone(), out);
    }
    // Preserve any user-only category (defensive: should not happen given
    // VALID_CATEGORIES, but avoids data loss if the bundled file ever ships
    // without one).
    for (cat, entries) in user {
        merged.entry(cat.clone()).or_insert_with(|| entries.clone());
    }
    merged
}

/// Read and parse an algorithms JSON file.
fn read_algorithms_file(path: &std::path::Path) -> Result<SshAlgorithms, String> {
    let meta =
        std::fs::metadata(path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    if meta.len() > MAX_FILE_SIZE {
        return Err(format!(
            "algorithms file {} exceeds max size",
            path.display()
        ));
    }
    let contents = std::fs::read_to_string(path)
        .map_err(|e| format!("failed to read {}: {e}", path.display()))?;
    serde_json::from_str(&contents).map_err(|e| format!("failed to parse {}: {e}", path.display()))
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Synchronous loader for use outside of Tauri commands (e.g. SSH service).
/// Reads the user's saved config and merges in any algorithms newly added in
/// the bundled defaults so that an upgraded install still sees recently
/// shipped algorithm names. Returns Ok(None) if neither file exists.
pub fn load_algorithms_sync(app: &AppHandle) -> Result<Option<SshAlgorithms>, String> {
    let user_path = user_algorithms_path(app)?;
    let bundled_path = bundled_algorithms_path(app)?;
    let bundled = if bundled_path.exists() {
        Some(read_algorithms_file(&bundled_path)?)
    } else {
        None
    };

    if user_path.exists() {
        let user = read_algorithms_file(&user_path)?;
        let merged = match &bundled {
            Some(b) => merge_user_with_bundled(&user, b),
            None => user,
        };
        return Ok(Some(merged));
    }

    Ok(bundled)
}

/// Load SSH algorithms configuration.
/// Reads from user config dir first and merges in any newly-bundled defaults
/// so upgrades pick up new algorithms. Persists the merged result back to the
/// user config so subsequent reads are stable. Falls back to bundled-only when
/// the user config is missing (first run).
#[tauri::command]
pub async fn get_ssh_algorithms(app: AppHandle) -> Result<SshAlgorithms, String> {
    let user_path = user_algorithms_path(&app)?;
    let bundled_path = bundled_algorithms_path(&app)?;
    let bundled = if bundled_path.exists() {
        Some(read_algorithms_file(&bundled_path)?)
    } else {
        None
    };

    if user_path.exists() {
        let user = read_algorithms_file(&user_path)?;
        let merged = match &bundled {
            Some(b) => merge_user_with_bundled(&user, b),
            None => user.clone(),
        };
        // Persist the merged result if it differs from what was on disk so
        // newly added bundled entries are visible in the user file.
        if merged != user {
            if let Ok(json) = serde_json::to_string_pretty(&merged) {
                if let Err(e) = std::fs::write(&user_path, &json) {
                    log::warn!("could not persist merged algorithms to user config: {e}");
                }
            }
        }
        return Ok(merged);
    }

    if let Some(algorithms) = bundled {
        if let Ok(json) = serde_json::to_string_pretty(&algorithms) {
            if let Err(e) = std::fs::write(&user_path, &json) {
                log::warn!("could not copy default algorithms to user config: {e}");
            }
        }
        return Ok(algorithms);
    }

    Err("SSH algorithms configuration not found".into())
}

/// Save SSH algorithms configuration to user config dir.
#[tauri::command]
pub async fn save_ssh_algorithms(
    app: AppHandle,
    algorithms: SshAlgorithms,
) -> Result<bool, String> {
    validate_algorithms(&algorithms)?;

    let user_path = user_algorithms_path(&app)?;
    let json = serde_json::to_string_pretty(&algorithms)
        .map_err(|e| format!("failed to serialize algorithms: {e}"))?;
    std::fs::write(&user_path, json).map_err(|e| format!("failed to write algorithms: {e}"))?;

    log::info!("saved SSH algorithms to {}", user_path.display());
    Ok(true)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_algorithms() -> SshAlgorithms {
        let mut map = HashMap::new();
        map.insert(
            "kex".into(),
            vec![AlgorithmEntry {
                name: "curve25519-sha256".into(),
                enabled: true,
            }],
        );
        map.insert(
            "cipher".into(),
            vec![AlgorithmEntry {
                name: "aes256-ctr".into(),
                enabled: true,
            }],
        );
        map.insert(
            "serverHostKey".into(),
            vec![AlgorithmEntry {
                name: "ssh-ed25519".into(),
                enabled: true,
            }],
        );
        map.insert(
            "hmac".into(),
            vec![AlgorithmEntry {
                name: "hmac-sha2-256".into(),
                enabled: true,
            }],
        );
        map
    }

    #[test]
    fn validate_algorithms_valid() {
        let data = sample_algorithms();
        assert!(validate_algorithms(&data).is_ok());
    }

    #[test]
    fn validate_algorithms_invalid_category() {
        let mut data = HashMap::new();
        data.insert(
            "invalid_cat".into(),
            vec![AlgorithmEntry {
                name: "test".into(),
                enabled: true,
            }],
        );
        assert!(validate_algorithms(&data).is_err());
    }

    #[test]
    fn validate_algorithms_too_many_entries() {
        let mut data = HashMap::new();
        let entries: Vec<AlgorithmEntry> = (0..101)
            .map(|i| AlgorithmEntry {
                name: format!("alg-{i}"),
                enabled: true,
            })
            .collect();
        data.insert("kex".into(), entries);
        assert!(validate_algorithms(&data).is_err());
    }

    #[test]
    fn validate_algorithms_empty_name() {
        let mut data = HashMap::new();
        data.insert(
            "kex".into(),
            vec![AlgorithmEntry {
                name: String::new(),
                enabled: true,
            }],
        );
        assert!(validate_algorithms(&data).is_err());
    }

    #[test]
    fn validate_algorithms_name_too_long() {
        let mut data = HashMap::new();
        data.insert(
            "cipher".into(),
            vec![AlgorithmEntry {
                name: "x".repeat(101),
                enabled: true,
            }],
        );
        assert!(validate_algorithms(&data).is_err());
    }

    #[test]
    fn algorithm_entry_serializes() {
        let entry = AlgorithmEntry {
            name: "aes256-ctr".into(),
            enabled: true,
        };
        let json = serde_json::to_string(&entry).unwrap();
        assert!(json.contains("aes256-ctr"));
        assert!(json.contains("true"));
    }

    #[test]
    fn algorithm_entry_deserializes() {
        let json = r#"{"name":"hmac-sha2-256","enabled":false}"#;
        let entry: AlgorithmEntry = serde_json::from_str(json).unwrap();
        assert_eq!(entry.name, "hmac-sha2-256");
        assert!(!entry.enabled);
    }

    #[test]
    fn full_algorithms_deserialize() {
        let json = r#"{
            "kex": [{"name": "curve25519-sha256", "enabled": true}],
            "cipher": [{"name": "aes256-ctr", "enabled": true}],
            "serverHostKey": [{"name": "ssh-ed25519", "enabled": true}],
            "hmac": [{"name": "hmac-sha2-256", "enabled": false}]
        }"#;
        let algs: SshAlgorithms = serde_json::from_str(json).unwrap();
        assert_eq!(algs.len(), 4);
        assert!(algs["kex"][0].enabled);
        assert!(!algs["hmac"][0].enabled);
    }
}
