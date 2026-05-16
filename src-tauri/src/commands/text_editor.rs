use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tokio::sync::Mutex;

use crate::services::path_safety::is_sensitive_path;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Maximum file size for reading/dropping (50 MB).
const MAX_FILE_SIZE: u64 = 50 * 1024 * 1024;

/// Allowed encodings for read/write operations.
const ALLOWED_ENCODINGS: &[&str] = &["utf-8", "utf8", "shift_jis", "euc-jp"];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReadFileResult {
    pub content: String,
    pub line_ending: String,
}

/// Managed state: set of file paths approved via dialog or drag-and-drop.
pub struct ApprovedEditorPaths {
    inner: Arc<Mutex<HashSet<PathBuf>>>,
}

impl ApprovedEditorPaths {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashSet::new())),
        }
    }
}

impl Default for ApprovedEditorPaths {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Resolve and canonicalize a path. On Windows, strips the `\\?\` prefix.
fn resolve_path(p: &str) -> Result<PathBuf, String> {
    let path = Path::new(p);
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("failed to resolve path: {e}"))?;
    Ok(canonical)
}

/// Validate that the encoding string is in the allowed list.
/// Returns the validated encoding or defaults to "utf-8".
fn validated_encoding(enc: &str) -> &str {
    let lower = enc.to_ascii_lowercase();
    for &allowed in ALLOWED_ENCODINGS {
        if lower == allowed.to_ascii_lowercase() {
            return allowed;
        }
    }
    "utf-8"
}

/// Decode file bytes using the specified encoding.
fn decode_bytes(bytes: &[u8], encoding: &str) -> String {
    let enc = crate::services::session_service::encoding_for(encoding);
    let (decoded, _, _) = enc.decode(bytes);
    decoded.into_owned()
}

/// Encode a string to bytes using the specified encoding.
fn encode_string(content: &str, encoding: &str) -> Vec<u8> {
    let enc = crate::services::session_service::encoding_for(encoding);
    let (encoded, _, _) = enc.encode(content);
    encoded.into_owned()
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Open a file dialog to select a text file for editing.
/// Returns the selected file path or null if cancelled.
#[tauri::command]
pub async fn text_editor_open_file(
    app: AppHandle,
    paths: State<'_, ApprovedEditorPaths>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let file_path = app
        .dialog()
        .file()
        .add_filter(
            "Text Files",
            &[
                "txt", "log", "md", "json", "xml", "yaml", "yml", "csv", "ini",
                "conf", "cfg", "sh", "bat", "ps1", "py", "js", "ts", "html", "css",
            ],
        )
        .add_filter("All Files", &["*"])
        .blocking_pick_file();

    match file_path {
        Some(p) => {
            let path_str = p.to_string();
            if let Ok(resolved) = resolve_path(&path_str) {
                let mut set = paths.inner.lock().await;
                set.insert(resolved);
            }
            Ok(Some(path_str))
        }
        None => Ok(None),
    }
}

/// Open a save dialog for the text editor.
/// Returns the selected file path or null if cancelled.
#[tauri::command]
pub async fn text_editor_save_file(
    app: AppHandle,
    paths: State<'_, ApprovedEditorPaths>,
    default_path: Option<String>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let mut builder = app
        .dialog()
        .file()
        .add_filter(
            "Text Files",
            &["txt", "log", "md", "json", "xml", "yaml", "yml", "csv"],
        )
        .add_filter("All Files", &["*"]);

    if let Some(ref dp) = default_path {
        builder = builder.set_file_name(dp);
    }

    let file_path = builder.blocking_save_file();

    match file_path {
        Some(p) => {
            let path_str = p.to_string();
            if let Ok(resolved) = resolve_path(&path_str) {
                let mut set = paths.inner.lock().await;
                set.insert(resolved);
            }
            Ok(Some(path_str))
        }
        None => Ok(None),
    }
}

/// Read a file that was previously approved via dialog or drag-and-drop.
#[tauri::command]
pub async fn text_editor_read_file(
    paths: State<'_, ApprovedEditorPaths>,
    file_path: String,
    encoding: String,
) -> Result<ReadFileResult, String> {
    let resolved = resolve_path(&file_path)?;

    // Security: only allow approved paths
    {
        let set = paths.inner.lock().await;
        if !set.contains(&resolved) {
            return Err("file path not approved via dialog".into());
        }
    }

    // Re-validate sensitive paths at read time (guards against symlink swaps
    // after a dialog-approved path was inserted).
    if is_sensitive_path(&resolved) {
        return Err("access to sensitive directories is not allowed".into());
    }

    let meta = std::fs::metadata(&resolved)
        .map_err(|e| format!("failed to stat file: {e}"))?;
    if meta.len() > MAX_FILE_SIZE {
        return Err("file is too large (max 50MB)".into());
    }

    let bytes =
        std::fs::read(&resolved).map_err(|e| format!("failed to read file: {e}"))?;

    let valid_enc = validated_encoding(&encoding);
    let content = decode_bytes(&bytes, valid_enc);
    let line_ending = if content.contains("\r\n") {
        "CRLF"
    } else {
        "LF"
    };

    Ok(ReadFileResult {
        content,
        line_ending: line_ending.to_string(),
    })
}

/// Write content to a file that was previously approved via dialog or drag-and-drop.
#[tauri::command]
pub async fn text_editor_write_file(
    paths: State<'_, ApprovedEditorPaths>,
    file_path: String,
    content: String,
    encoding: String,
) -> Result<bool, String> {
    let resolved = resolve_path(&file_path)?;

    // Security: only allow approved paths
    {
        let set = paths.inner.lock().await;
        if !set.contains(&resolved) {
            return Err("file path not approved via dialog".into());
        }
    }

    // Re-validate sensitive paths at write time (guards against symlink swaps).
    if is_sensitive_path(&resolved) {
        return Err("access to sensitive directories is not allowed".into());
    }

    let valid_enc = validated_encoding(&encoding);
    let bytes = encode_string(&content, valid_enc);

    std::fs::write(&resolved, bytes)
        .map_err(|e| format!("failed to write file: {e}"))?;

    Ok(true)
}

/// Approve a file path from drag-and-drop.
///
/// The renderer can call this command with any path, so we cannot trust the
/// "drag-and-drop" framing on its own — Tauri-level native drag-and-drop is
/// disabled by `tauri.conf.json` (`dragDropEnabled: false`), and the
/// webview-level drop event the caller may attribute is fully attacker-
/// controllable. A native OK/Cancel confirm dialog is required for paths the
/// user has not already approved this session; once approved, the path is
/// cached so re-opening the same file in this session does not re-prompt.
///
/// Validates before showing the dialog:
/// - Path is non-empty and not a symlink at the raw (pre-canonical) path
/// - Resolves and is a regular file under 50 MB
/// - Not in a sensitive directory
#[tauri::command]
pub async fn text_editor_approve_dropped_file(
    app: AppHandle,
    paths: State<'_, ApprovedEditorPaths>,
    file_path: String,
) -> Result<bool, String> {
    if file_path.trim().is_empty() {
        return Err("invalid file path".into());
    }

    // Refuse to approve a symlink directly: the user may have been tricked
    // into dropping a link that points elsewhere. resolve_path() follows the
    // link, so this check uses symlink_metadata on the *requested* path
    // before it is canonicalized.
    let raw_path = Path::new(&file_path);
    if let Ok(raw_meta) = std::fs::symlink_metadata(raw_path) {
        if raw_meta.file_type().is_symlink() {
            return Err("symbolic links cannot be approved directly".into());
        }
    }

    let resolved = resolve_path(&file_path)?;

    let meta = std::fs::metadata(&resolved)
        .map_err(|e| format!("failed to stat file: {e}"))?;

    if !meta.is_file() {
        return Err("path is not a regular file".into());
    }

    if meta.len() > MAX_FILE_SIZE {
        return Err("file is too large (max 50MB)".into());
    }

    if is_sensitive_path(&resolved) {
        return Err("access to sensitive directories is not allowed".into());
    }

    // Fast path: already approved this session — don't re-prompt.
    {
        let set = paths.inner.lock().await;
        if set.contains(&resolved) {
            return Ok(true);
        }
    }

    // Native confirm dialog — gives this command teeth a compromised renderer
    // cannot synthesise, since the OS-level click cannot be faked from the
    // webview.
    let body = format!("Allow HoTTY to open this file?\n\n{file_path}");
    let approved = app
        .dialog()
        .message(body)
        .title("Approve file open")
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancel)
        .blocking_show();

    if !approved {
        return Ok(false);
    }

    let mut set = paths.inner.lock().await;
    set.insert(resolved);
    Ok(true)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn validated_encoding_returns_known() {
        assert_eq!(validated_encoding("utf-8"), "utf-8");
        assert_eq!(validated_encoding("UTF-8"), "utf-8");
        assert_eq!(validated_encoding("shift_jis"), "shift_jis");
        assert_eq!(validated_encoding("euc-jp"), "euc-jp");
    }

    #[test]
    fn validated_encoding_defaults_unknown() {
        assert_eq!(validated_encoding("potato"), "utf-8");
        assert_eq!(validated_encoding(""), "utf-8");
    }

    #[test]
    fn decode_bytes_utf8() {
        let bytes = b"Hello World";
        let result = decode_bytes(bytes, "utf-8");
        assert_eq!(result, "Hello World");
    }

    #[test]
    fn encode_string_utf8() {
        let encoded = encode_string("Hello", "utf-8");
        assert_eq!(encoded, b"Hello");
    }

    #[test]
    fn read_file_result_serializes() {
        let r = ReadFileResult {
            content: "hello".into(),
            line_ending: "LF".into(),
        };
        let json = serde_json::to_value(&r).unwrap();
        assert_eq!(json["content"], "hello");
        assert_eq!(json["lineEnding"], "LF");
    }

    #[test]
    fn resolve_path_rejects_nonexistent() {
        let result = resolve_path("/absolutely/does/not/exist/file.txt");
        assert!(result.is_err());
    }

    #[test]
    fn resolve_path_works_for_existing() {
        let dir = std::env::temp_dir().join("hotty_test_resolve");
        let _ = fs::create_dir_all(&dir);
        let file = dir.join("test.txt");
        fs::write(&file, "test").unwrap();

        let result = resolve_path(file.to_str().unwrap());
        assert!(result.is_ok());

        let _ = fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn approved_paths_lifecycle() {
        let paths = ApprovedEditorPaths::new();
        let test_path = PathBuf::from("/test/file.txt");

        {
            let set = paths.inner.lock().await;
            assert!(!set.contains(&test_path));
        }

        {
            let mut set = paths.inner.lock().await;
            set.insert(test_path.clone());
        }

        {
            let set = paths.inner.lock().await;
            assert!(set.contains(&test_path));
        }
    }

}
