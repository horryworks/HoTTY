use serde::Serialize;
use std::path::Path;
use tauri::State;

use crate::services::log_manager::LogManager;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Maximum file size that can be read through the viewer (50 MB).
const MAX_READ_SIZE: u64 = 50 * 1024 * 1024;

/// Allowed file extensions for reading.
const ALLOWED_EXTENSIONS: &[&str] = &["txt", "log", "tslog"];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Clone)]
pub struct LogFile {
    /// Filename only (no directory path).
    pub name: String,
    /// Absolute file path.
    pub path: String,
    /// Modification time in milliseconds since Unix epoch.
    pub mtime: u64,
    /// File size in bytes.
    pub size: u64,
}

#[derive(Debug, Serialize)]
pub struct ListLogFilesResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files: Option<Vec<LogFile>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ReadLogFileResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Validate that a file extension is in the allowed list.
fn is_allowed_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ALLOWED_EXTENSIONS.contains(&ext))
        .unwrap_or(false)
}

/// Get the real/canonical path, resolving symlinks.
fn resolve_real_path(path: &Path) -> Result<std::path::PathBuf, String> {
    // On Windows, canonicalize adds the \\?\ prefix; we normalize it away
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("failed to resolve path: {e}"))?;
    Ok(canonical)
}

/// Convert SystemTime to milliseconds since Unix epoch.
fn system_time_to_millis(time: std::time::SystemTime) -> u64 {
    time.duration_since(std::time::SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// List log files (.txt, .log) in a given folder.
///
/// Security: The folder must be registered in the LogManager's allowed directories.
/// Files with `.tslog` extension are excluded from the listing (they are internal).
#[tauri::command]
pub async fn list_log_files(
    log_manager: State<'_, LogManager>,
    folder_path: String,
) -> Result<ListLogFilesResult, String> {
    let folder = Path::new(&folder_path);

    // Validate the folder is allowed
    if !log_manager.is_path_allowed(folder).await {
        return Ok(ListLogFilesResult {
            files: None,
            error: Some("access denied: folder is not registered for logging".into()),
        });
    }

    if !folder.is_dir() {
        return Ok(ListLogFilesResult {
            files: None,
            error: Some("folder does not exist".into()),
        });
    }

    let entries = std::fs::read_dir(folder)
        .map_err(|e| format!("failed to read directory: {e}"))?;

    let mut files: Vec<LogFile> = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        // Only include .txt and .log files (not .tslog — those are internal)
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or_default();
        if ext != "txt" && ext != "log" {
            continue;
        }

        let meta = match std::fs::metadata(&path) {
            Ok(m) => m,
            Err(_) => continue,
        };

        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default()
            .to_string();

        files.push(LogFile {
            name,
            path: path.to_string_lossy().to_string(),
            mtime: meta
                .modified()
                .map(system_time_to_millis)
                .unwrap_or(0),
            size: meta.len(),
        });
    }

    // Sort by modification time, newest first
    files.sort_by(|a, b| b.mtime.cmp(&a.mtime));

    Ok(ListLogFilesResult {
        files: Some(files),
        error: None,
    })
}

/// Read the contents of a log file.
///
/// Security:
/// - Only .txt, .log, and .tslog extensions are allowed.
/// - The file's real path (after resolving symlinks) must be within an allowed directory.
/// - Maximum file size is 50 MB.
#[tauri::command]
pub async fn read_log_file(
    log_manager: State<'_, LogManager>,
    file_path: String,
) -> Result<ReadLogFileResult, String> {
    let path = Path::new(&file_path);

    // Check extension
    if !is_allowed_extension(path) {
        return Ok(ReadLogFileResult {
            content: None,
            error: Some("invalid file type: only .txt, .log, and .tslog files are allowed".into()),
        });
    }

    // Resolve real path (follows symlinks)
    let real_path = match resolve_real_path(path) {
        Ok(p) => p,
        Err(_) => {
            return Ok(ReadLogFileResult {
                content: None,
                error: Some("file not found".into()),
            });
        }
    };

    // Security: check the real path is within an allowed directory
    if !log_manager.is_path_allowed(&real_path).await {
        return Ok(ReadLogFileResult {
            content: None,
            error: Some("access denied: file is outside allowed directories".into()),
        });
    }

    // Check file size
    let meta = std::fs::metadata(&real_path)
        .map_err(|e| format!("failed to read file metadata: {e}"))?;
    if meta.len() > MAX_READ_SIZE {
        return Ok(ReadLogFileResult {
            content: None,
            error: Some(format!(
                "file too large: {} bytes (max {} bytes)",
                meta.len(),
                MAX_READ_SIZE
            )),
        });
    }

    // Read file contents
    let content = std::fs::read_to_string(&real_path).map_err(|e| {
        format!("failed to read file: {e}")
    })?;

    Ok(ReadLogFileResult {
        content: Some(content),
        error: None,
    })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_allowed_extension_works() {
        assert!(is_allowed_extension(Path::new("file.txt")));
        assert!(is_allowed_extension(Path::new("file.log")));
        assert!(is_allowed_extension(Path::new("file.tslog")));
        assert!(!is_allowed_extension(Path::new("file.exe")));
        assert!(!is_allowed_extension(Path::new("file.json")));
        assert!(!is_allowed_extension(Path::new("noext")));
    }

    #[test]
    fn system_time_to_millis_works() {
        let epoch = std::time::SystemTime::UNIX_EPOCH;
        assert_eq!(system_time_to_millis(epoch), 0);

        let later = epoch + std::time::Duration::from_secs(1000);
        assert_eq!(system_time_to_millis(later), 1_000_000);
    }

    #[test]
    fn log_file_serializes() {
        let file = LogFile {
            name: "test.txt".into(),
            path: "/logs/test.txt".into(),
            mtime: 1700000000000,
            size: 1024,
        };
        let json = serde_json::to_string(&file).unwrap();
        assert!(json.contains("\"name\":\"test.txt\""));
        assert!(json.contains("\"size\":1024"));
    }

    #[test]
    fn list_result_skips_none_fields() {
        let result = ListLogFilesResult {
            files: Some(vec![]),
            error: None,
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"files\""));
        assert!(!json.contains("\"error\""));
    }

    #[test]
    fn read_result_skips_none_fields() {
        let result = ReadLogFileResult {
            content: Some("hello".into()),
            error: None,
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"content\""));
        assert!(!json.contains("\"error\""));

        let err_result = ReadLogFileResult {
            content: None,
            error: Some("bad".into()),
        };
        let json = serde_json::to_string(&err_result).unwrap();
        assert!(!json.contains("\"content\""));
        assert!(json.contains("\"error\""));
    }
}
