use tauri::{AppHandle, State};

use crate::services::ping_monitor::{PingMonitorState, StartMonitorConfig};

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Start a ping monitor for a session.
#[tauri::command]
pub async fn ping_monitor_start(
    app: AppHandle,
    state: State<'_, PingMonitorState>,
    session_id: String,
    targets: Vec<String>,
    interval_ms: u64,
    logging_enabled: bool,
    logging_path: String,
) -> Result<(), String> {
    let mut monitors = state.monitors.lock().await;
    crate::services::ping_monitor::start_monitor(
        app,
        &mut monitors,
        StartMonitorConfig {
            session_id,
            targets,
            interval_ms,
            logging_enabled,
            logging_path,
        },
    );
    Ok(())
}

/// Stop a ping monitor for a session.
#[tauri::command]
pub async fn ping_monitor_stop(
    state: State<'_, PingMonitorState>,
    session_id: String,
) -> Result<(), String> {
    let mut monitors = state.monitors.lock().await;
    crate::services::ping_monitor::stop_monitor(&mut monitors, &session_id);
    Ok(())
}

/// Update the target list for a running ping monitor.
#[tauri::command]
pub async fn ping_monitor_update_targets(
    state: State<'_, PingMonitorState>,
    session_id: String,
    targets: Vec<String>,
) -> Result<(), String> {
    let monitors = state.monitors.lock().await;
    crate::services::ping_monitor::update_targets(&monitors, &session_id, targets).await;
    Ok(())
}

/// Update the ping interval for a running ping monitor.
#[tauri::command]
pub async fn ping_monitor_update_interval(
    state: State<'_, PingMonitorState>,
    session_id: String,
    interval_ms: u64,
) -> Result<(), String> {
    let monitors = state.monitors.lock().await;
    crate::services::ping_monitor::update_interval(&monitors, &session_id, interval_ms).await;
    Ok(())
}
