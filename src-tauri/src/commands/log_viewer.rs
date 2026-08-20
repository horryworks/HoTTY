use serde::Serialize;
use std::path::Path;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use crate::services::log_manager::LogManager;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Maximum file size that can be read through the viewer (50 MB).
const MAX_READ_SIZE: u64 = 50 * 1024 * 1024;

/// Allowed file extensions for reading. `md` covers AI-chat transcripts and
/// `csv` the Ping Monitor logs.
///
/// `txt` / `log` / `tslog` / `csv` are rendered as inert text or table cells by
/// the viewer. `md` is the one exception: it is formatted, so that a chat
/// transcript reads there as it did in the AI Chat pane. That path is the same
/// one the pane itself uses — `marked` for the markup, then DOMPurify
/// (`utils/htmlUtils.ts`) to strip scripts, event handlers and the rest before
/// anything reaches the DOM — and the app's CSP (`tauri.conf.json`) bars remote
/// subresources, so a `.md` a third party dropped into the folder cannot phone
/// home either. Adding a new extension here does not by itself make it render
/// as markup; that is decided in `LogViewerPane`.
///
/// The directory allow-list in `LogManager` remains the real boundary on
/// *which* files can be read at all.
const ALLOWED_EXTENSIONS: &[&str] = &["txt", "log", "tslog", "md", "csv"];

/// Extensions surfaced in the viewer's file list. `.tslog` is readable but
/// stays out of the listing — it is the internal timestamp sidecar of a `.txt`.
const LISTED_EXTENSIONS: &[&str] = &["txt", "log", "md", "csv"];

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

/// Whether a file should appear in the viewer's file list.
fn is_listed_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| LISTED_EXTENSIONS.contains(&ext))
        .unwrap_or(false)
}

/// Get the real/canonical path, resolving symlinks.
fn resolve_real_path(path: &Path) -> Result<std::path::PathBuf, String> {
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

/// List log files (.txt, .log, .md) in a given folder.
///
/// The folder MUST already be user-approved (via `select_folder`'s file
/// picker dialog or `confirm_log_dir`'s yes/no prompt). A compromised
/// renderer cannot synthesise that approval, so it cannot point the log
/// viewer at arbitrary directories on the user's machine just by calling
/// this command. Files with `.tslog` extension are excluded from the
/// listing (they are internal).
#[tauri::command]
pub async fn list_log_files(
    log_manager: State<'_, LogManager>,
    folder_path: String,
) -> Result<ListLogFilesResult, String> {
    let folder = Path::new(&folder_path);

    if !folder.is_dir() {
        return Ok(ListLogFilesResult {
            files: None,
            error: Some("folder does not exist".into()),
        });
    }

    if !log_manager.is_dir_approved(folder).await {
        return Ok(ListLogFilesResult {
            files: None,
            error: Some("folder not approved: please use Browse to select".into()),
        });
    }

    let entries =
        std::fs::read_dir(folder).map_err(|e| format!("failed to read directory: {e}"))?;

    let mut files: Vec<LogFile> = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        // Only include .txt / .log / .md (not .tslog — those are internal)
        if !is_listed_extension(&path) {
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
            mtime: meta.modified().map(system_time_to_millis).unwrap_or(0),
            size: meta.len(),
        });
    }

    // Sort by modification time, newest first
    files.sort_by_key(|f| std::cmp::Reverse(f.mtime));

    Ok(ListLogFilesResult {
        files: Some(files),
        error: None,
    })
}

/// Read the contents of a log file.
///
/// Security:
/// - Only .txt, .log, .tslog, and .md extensions are allowed.
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
            error: Some(
                "invalid file type: only .txt, .log, .tslog, .md, and .csv files are allowed"
                    .into(),
            ),
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
    let meta =
        std::fs::metadata(&real_path).map_err(|e| format!("failed to read file metadata: {e}"))?;
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

    // Mitigate TOCTOU: re-canonicalize immediately before the read and ensure
    // the resolved path still matches and is still inside an allowed directory.
    let recheck_path = match resolve_real_path(path) {
        Ok(p) => p,
        Err(_) => {
            return Ok(ReadLogFileResult {
                content: None,
                error: Some("file not found".into()),
            });
        }
    };
    if recheck_path != real_path || !log_manager.is_path_allowed(&recheck_path).await {
        return Ok(ReadLogFileResult {
            content: None,
            error: Some("access denied: path changed during access".into()),
        });
    }

    // Read file contents using the re-canonicalized path (TOCTOU mitigation).
    let content =
        std::fs::read_to_string(&recheck_path).map_err(|e| format!("failed to read file: {e}"))?;

    Ok(ReadLogFileResult {
        content: Some(content),
        error: None,
    })
}

/// Show a native confirm dialog asking the user to approve `path` for
/// logging / log-file reading. The native dialog is what gives this
/// command teeth — a compromised renderer can call this command, but it
/// cannot fake a user click on the OS-level button.
///
/// Returns `true` if the user approved (or if the path was already
/// approved); `false` if they declined or cancelled.
#[tauri::command]
pub async fn confirm_log_dir(
    app: AppHandle,
    log_manager: State<'_, LogManager>,
    path: String,
) -> Result<bool, String> {
    let folder = Path::new(&path);

    if log_manager.is_dir_approved(folder).await {
        return Ok(true);
    }

    if !folder.is_dir() {
        return Err(format!("folder does not exist: {path}"));
    }

    let body = format!("Allow HoTTY to read and write log files in this folder?\n\n{path}");
    let approved = app
        .dialog()
        .message(body)
        .title("Approve log folder")
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancel)
        .blocking_show();

    if approved {
        log_manager.approve_dir(folder).await;
    }
    Ok(approved)
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
        assert!(is_allowed_extension(Path::new("chat.md")));
        assert!(is_allowed_extension(Path::new(
            "20260820120000-PING-MONITOR.csv"
        )));
        assert!(!is_allowed_extension(Path::new("file.exe")));
        assert!(!is_allowed_extension(Path::new("file.json")));
        assert!(!is_allowed_extension(Path::new("noext")));
    }

    #[test]
    fn is_listed_extension_works() {
        assert!(is_listed_extension(Path::new("file.txt")));
        assert!(is_listed_extension(Path::new("file.log")));
        assert!(is_listed_extension(Path::new(
            "20260727091402-AICHAT-router-a.md"
        )));
        // Ping Monitor writes these into the same folder as the session logs.
        assert!(is_listed_extension(Path::new(
            "20260820120000-PING-MONITOR.csv"
        )));
        // Readable but never listed — internal sidecar of a .txt session log.
        assert!(!is_listed_extension(Path::new("file.tslog")));
        assert!(!is_listed_extension(Path::new("file.exe")));
        assert!(!is_listed_extension(Path::new("noext")));
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
