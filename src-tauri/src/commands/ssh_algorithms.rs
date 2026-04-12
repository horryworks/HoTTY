use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone)]
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

/// Read and parse an algorithms JSON file.
fn read_algorithms_file(path: &std::path::Path) -> Result<SshAlgorithms, String> {
    let meta = std::fs::metadata(path)
        .map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    if meta.len() > MAX_FILE_SIZE {
        return Err(format!(
            "algorithms file {} exceeds max size",
            path.display()
        ));
    }
    let contents = std::fs::read_to_string(path)
        .map_err(|e| format!("failed to read {}: {e}", path.display()))?;
    serde_json::from_str(&contents)
        .map_err(|e| format!("failed to parse {}: {e}", path.display()))
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Load SSH algorithms configuration.
/// Reads from user config dir first; if not present, copies from bundled resources.
#[tauri::command]
pub async fn get_ssh_algorithms(app: AppHandle) -> Result<SshAlgorithms, String> {
    let user_path = user_algorithms_path(&app)?;

    // If user config exists, use it
    if user_path.exists() {
        return read_algorithms_file(&user_path);
    }

    // Otherwise, load from bundled resources and copy to user config
    let bundled_path = bundled_algorithms_path(&app)?;
    if bundled_path.exists() {
        let algorithms = read_algorithms_file(&bundled_path)?;
        // Copy to user config for future modifications
        if let Ok(json) = serde_json::to_string_pretty(&algorithms) {
            if let Err(e) = std::fs::write(&user_path, &json) {
                log::warn!(
                    "could not copy default algorithms to user config: {e}"
                );
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
    std::fs::write(&user_path, json)
        .map_err(|e| format!("failed to write algorithms: {e}"))?;

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
