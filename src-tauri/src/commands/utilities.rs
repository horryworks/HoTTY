use tauri::AppHandle;

// ---------------------------------------------------------------------------
// log_debug  — forward frontend debug messages to backend log
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn log_debug(level: String, category: String, message: String) {
    match level.to_lowercase().as_str() {
        "error" => log::error!("[{category}] {message}"),
        "warn" => log::warn!("[{category}] {message}"),
        "info" => log::info!("[{category}] {message}"),
        _ => log::debug!("[{category}] {message}"),
    }
}

// ---------------------------------------------------------------------------
// update_logging  — adjust the log level filter at runtime
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn update_logging(level: String) -> Result<(), String> {
    let filter = match level.to_lowercase().as_str() {
        "error" => log::LevelFilter::Error,
        "warn" => log::LevelFilter::Warn,
        "info" => log::LevelFilter::Info,
        "debug" => log::LevelFilter::Debug,
        "trace" => log::LevelFilter::Trace,
        other => return Err(format!("invalid log level: {other}")),
    };
    log::set_max_level(filter);
    log::info!("log level changed to {level}");
    Ok(())
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

#[tauri::command]
pub async fn select_folder(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let dir_path = app.dialog().file().blocking_pick_folder();

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
    fn update_logging_rejects_invalid_level() {
        let result = update_logging("potato".into());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("invalid log level"));
    }

    #[test]
    fn update_logging_accepts_valid_levels() {
        for level in &["error", "warn", "info", "debug", "trace"] {
            assert!(update_logging(level.to_string()).is_ok());
        }
    }
}
