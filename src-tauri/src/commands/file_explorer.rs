use serde::Serialize;
use std::path::Path;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub is_directory: bool,
    pub size: u64,
    pub mtime: f64,
    pub is_hidden: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListDirectoryResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entries: Option<Vec<DirEntry>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GetDrivesResult {
    pub drives: Vec<String>,
    pub homedir: String,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Convert SystemTime to milliseconds since Unix epoch (as f64 for JS compat).
fn system_time_to_ms(time: std::time::SystemTime) -> f64 {
    time.duration_since(std::time::SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64()
        * 1000.0
}

/// Determine if a filename is hidden (starts with '.').
fn is_hidden_name(name: &str) -> bool {
    name.starts_with('.')
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// List directory contents.
///
/// Returns entries sorted: directories first, then files, both alphabetically
/// (case-insensitive).
#[tauri::command]
pub async fn file_explorer_list_directory(
    dir_path: String,
) -> Result<ListDirectoryResult, String> {
    if dir_path.trim().is_empty() {
        return Ok(ListDirectoryResult {
            entries: None,
            error: Some("invalid directory path".into()),
        });
    }

    let path = Path::new(&dir_path);

    // Resolve to canonical path to prevent traversal
    let resolved = match path.canonicalize() {
        Ok(p) => p,
        Err(e) => {
            return Ok(ListDirectoryResult {
                entries: None,
                error: Some(format!("failed to resolve path: {e}")),
            });
        }
    };

    if !resolved.is_dir() {
        return Ok(ListDirectoryResult {
            entries: None,
            error: Some("path is not a directory".into()),
        });
    }

    let read_dir = match std::fs::read_dir(&resolved) {
        Ok(rd) => rd,
        Err(e) => {
            let msg = match e.kind() {
                std::io::ErrorKind::PermissionDenied => "permission denied".to_string(),
                _ => format!("{e}"),
            };
            return Ok(ListDirectoryResult {
                entries: None,
                error: Some(msg),
            });
        }
    };

    let mut entries: Vec<DirEntry> = Vec::new();

    for entry in read_dir.flatten() {
        let name = match entry.file_name().into_string() {
            Ok(n) => n,
            Err(_) => continue, // skip non-UTF8 names
        };

        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };

        let is_dir = meta.is_dir();
        let size = if is_dir { 0 } else { meta.len() };
        let mtime = meta
            .modified()
            .map(system_time_to_ms)
            .unwrap_or(0.0);
        let is_hidden = is_hidden_name(&name);

        entries.push(DirEntry {
            name,
            is_directory: is_dir,
            size,
            mtime,
            is_hidden,
        });
    }

    // Sort: directories first, then files, both case-insensitive alphabetical
    entries.sort_by(|a, b| {
        match (a.is_directory, b.is_directory) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    Ok(ListDirectoryResult {
        entries: Some(entries),
        error: None,
    })
}

/// Get available drives and the user's home directory.
///
/// On Windows, enumerates drive letters A–Z. On other platforms, returns `["/"]`.
#[tauri::command]
pub async fn file_explorer_get_drives() -> Result<GetDrivesResult, String> {
    let homedir = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_default();

    #[cfg(windows)]
    {
        let mut drives: Vec<String> = Vec::new();
        for letter in b'A'..=b'Z' {
            let drive = format!("{}:\\", letter as char);
            if Path::new(&drive).exists() {
                drives.push(drive);
            }
        }
        Ok(GetDrivesResult { drives, homedir })
    }

    #[cfg(not(windows))]
    {
        Ok(GetDrivesResult {
            drives: vec!["/".to_string()],
            homedir,
        })
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dir_entry_serializes() {
        let entry = DirEntry {
            name: "test.txt".into(),
            is_directory: false,
            size: 1024,
            mtime: 1700000000000.0,
            is_hidden: false,
        };
        let json = serde_json::to_value(&entry).unwrap();
        assert_eq!(json["name"], "test.txt");
        assert_eq!(json["isDirectory"], false);
        assert_eq!(json["size"], 1024);
        assert_eq!(json["isHidden"], false);
    }

    #[test]
    fn list_result_skips_none_fields() {
        let result = ListDirectoryResult {
            entries: Some(vec![]),
            error: None,
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"entries\""));
        assert!(!json.contains("\"error\""));
    }

    #[test]
    fn list_result_error_skips_entries() {
        let result = ListDirectoryResult {
            entries: None,
            error: Some("bad".into()),
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(!json.contains("\"entries\""));
        assert!(json.contains("\"error\""));
    }

    #[test]
    fn system_time_to_ms_epoch() {
        let epoch = std::time::SystemTime::UNIX_EPOCH;
        assert_eq!(system_time_to_ms(epoch), 0.0);
    }

    #[test]
    fn is_hidden_name_works() {
        assert!(is_hidden_name(".gitignore"));
        assert!(is_hidden_name(".ssh"));
        assert!(!is_hidden_name("readme.txt"));
        assert!(!is_hidden_name("Makefile"));
    }

    #[test]
    fn get_drives_result_serializes() {
        let result = GetDrivesResult {
            drives: vec!["C:\\".into(), "D:\\".into()],
            homedir: "C:\\Users\\test".into(),
        };
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["drives"][0], "C:\\");
        assert_eq!(json["homedir"], "C:\\Users\\test");
    }

    #[tokio::test]
    async fn list_directory_empty_path() {
        let result = file_explorer_list_directory("".into()).await.unwrap();
        assert!(result.error.is_some());
        assert!(result.entries.is_none());
    }

    #[tokio::test]
    async fn list_directory_nonexistent() {
        let result =
            file_explorer_list_directory("/absolutely/does/not/exist".into())
                .await
                .unwrap();
        assert!(result.error.is_some());
    }

    #[tokio::test]
    async fn list_directory_temp() {
        let dir = std::env::temp_dir();
        let result = file_explorer_list_directory(dir.to_string_lossy().to_string())
            .await
            .unwrap();
        assert!(result.entries.is_some());
        assert!(result.error.is_none());
    }

    #[tokio::test]
    async fn list_directory_sorts_dirs_first() {
        let dir = std::env::temp_dir().join("hotty_test_fe_sort");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        // Create a file and a subdirectory
        std::fs::write(dir.join("aaa_file.txt"), "test").unwrap();
        std::fs::create_dir(dir.join("bbb_dir")).unwrap();

        let result = file_explorer_list_directory(dir.to_string_lossy().to_string())
            .await
            .unwrap();
        let entries = result.entries.unwrap();
        assert_eq!(entries.len(), 2);
        // Directory should come first even though it sorts after alphabetically
        assert!(entries[0].is_directory);
        assert_eq!(entries[0].name, "bbb_dir");
        assert!(!entries[1].is_directory);
        assert_eq!(entries[1].name, "aaa_file.txt");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn get_drives_returns_nonempty() {
        let result = file_explorer_get_drives().await.unwrap();
        assert!(!result.drives.is_empty());
        assert!(!result.homedir.is_empty());
    }
}
