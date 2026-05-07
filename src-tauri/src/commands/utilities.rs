use std::path::Path;

use tauri::{AppHandle, State};

use crate::services::log_manager::LogManager;

// ---------------------------------------------------------------------------
// log_debug  — forward frontend debug messages to backend log
// ---------------------------------------------------------------------------

/// Maximum length of a frontend-supplied log message. Defense-in-depth
/// alongside the frontend redaction in `src/utils/redaction.ts` — caps the
/// blast radius of any caller that accidentally forwards large blobs (API
/// response bodies, stack dumps, etc.) into the persisted debug log.
const MAX_LOG_MESSAGE_BYTES: usize = 4096;

fn truncate_for_log(message: String) -> String {
    if message.len() <= MAX_LOG_MESSAGE_BYTES {
        return message;
    }
    // Truncate on a UTF-8 char boundary to avoid emitting invalid bytes.
    let mut end = MAX_LOG_MESSAGE_BYTES;
    while end > 0 && !message.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}...<truncated>", &message[..end])
}

#[tauri::command]
pub fn log_debug(level: String, category: String, message: String) {
    let message = truncate_for_log(message);
    match level.to_lowercase().as_str() {
        "error" => log::error!("[{category}] {message}"),
        "warn" => log::warn!("[{category}] {message}"),
        "info" => log::info!("[{category}] {message}"),
        _ => log::debug!("[{category}] {message}"),
    }
}

// ---------------------------------------------------------------------------
// select_image  — open a file dialog to select an image file
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn select_image(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let file_path = app
        .dialog()
        .file()
        .add_filter("Images", &["png", "jpg", "jpeg", "gif", "bmp", "webp", "ico", "svg"])
        .blocking_pick_file();

    Ok(file_path.map(|p| p.to_string()))
}

// ---------------------------------------------------------------------------
// select_folder  — open a file dialog to select a directory
// ---------------------------------------------------------------------------

/// Pick a directory via the native file dialog.
///
/// The picked directory is registered with `LogManager::approve_dir` because
/// the only caller in this app today is the logging-folder picker. Approving
/// here ties the allow-list grant directly to the user's OS-level click —
/// a compromised renderer cannot grow the approval set without the user
/// physically picking a folder.
#[tauri::command]
pub async fn select_folder(
    app: AppHandle,
    log_manager: State<'_, LogManager>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let dir_path = app.dialog().file().blocking_pick_folder();

    if let Some(p) = &dir_path {
        let s = p.to_string();
        log_manager.approve_dir(Path::new(&s)).await;
    }

    Ok(dir_path.map(|p| p.to_string()))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn log_debug_does_not_panic() {
        // Just ensure it doesn't panic for all levels
        log_debug("debug".into(), "test".into(), "test message".into());
        log_debug("info".into(), "test".into(), "test message".into());
        log_debug("warn".into(), "test".into(), "test message".into());
        log_debug("error".into(), "test".into(), "test message".into());
        log_debug("unknown".into(), "test".into(), "test message".into());
    }

    #[test]
    fn truncate_for_log_passes_short_messages_through() {
        let s = "hello".to_string();
        assert_eq!(truncate_for_log(s.clone()), s);
    }

    #[test]
    fn truncate_for_log_caps_long_messages() {
        let long = "a".repeat(MAX_LOG_MESSAGE_BYTES + 100);
        let out = truncate_for_log(long);
        assert!(out.ends_with("...<truncated>"));
        assert_eq!(out.len(), MAX_LOG_MESSAGE_BYTES + "...<truncated>".len());
    }

    #[test]
    fn truncate_for_log_preserves_utf8_boundaries() {
        // Build a string just over the cap that ends in a multibyte char.
        let mut s = "a".repeat(MAX_LOG_MESSAGE_BYTES - 1);
        s.push('日'); // 3 bytes in UTF-8 — pushes total over the cap
        s.push('本');
        let out = truncate_for_log(s);
        // Result must still be valid UTF-8 and contain the truncation marker.
        assert!(out.ends_with("...<truncated>"));
        assert!(std::str::from_utf8(out.as_bytes()).is_ok());
    }

    #[test]
    fn log_debug_does_not_panic_on_oversized_message() {
        let big = "x".repeat(MAX_LOG_MESSAGE_BYTES * 2);
        log_debug("info".into(), "test".into(), big);
    }
}
