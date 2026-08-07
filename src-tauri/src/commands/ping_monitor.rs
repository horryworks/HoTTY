use std::path::Path;

use tauri::{AppHandle, State};

use crate::services::log_manager::LogManager;
use crate::services::ping_monitor::{PingMonitorState, StartMonitorConfig};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Whether CSV logging is even a candidate before the (async) directory-approval
/// check runs. Returns `false` when logging is disabled or no path was supplied,
/// so the approval round-trip is skipped entirely. Pulled out of
/// `ping_monitor_start` so this security-relevant gate is unit-testable without
/// a `LogManager`. A `true` result still only permits logging if the directory
/// is subsequently confirmed user-approved.
fn logging_requested(logging_enabled: bool, logging_path: &str) -> bool {
    logging_enabled && !logging_path.is_empty()
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Start a ping monitor for a session.
///
/// CSV logging is only enabled if the supplied `logging_path` has been
/// user-approved via `LogManager` (native dialog round-trip). This matches
/// `update_session_logging`'s gating — a compromised renderer cannot have the
/// monitor write files to an arbitrary directory just by setting
/// `logging_enabled=true`. The monitor still runs without CSV logging in that
/// case; only the file-write side is suppressed.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn ping_monitor_start(
    app: AppHandle,
    state: State<'_, PingMonitorState>,
    log_manager: State<'_, LogManager>,
    session_id: String,
    targets: Vec<String>,
    interval_ms: u64,
    logging_enabled: bool,
    logging_path: String,
) -> Result<(), String> {
    let effective_logging_enabled = if logging_requested(logging_enabled, &logging_path) {
        let approved = log_manager.is_dir_approved(Path::new(&logging_path)).await;
        if !approved {
            log::warn!(
                "ping-monitor: refusing CSV logging for session {session_id} — \
                 directory not user-approved: {logging_path}"
            );
        }
        approved
    } else {
        false
    };

    let mut monitors = state.monitors.lock().await;
    crate::services::ping_monitor::start_monitor(
        app,
        &mut monitors,
        StartMonitorConfig {
            session_id,
            targets,
            interval_ms,
            logging_enabled: effective_logging_enabled,
            logging_path,
        },
    )
    .await;
    Ok(())
}

/// Stop a ping monitor for a session.
#[tauri::command]
pub async fn ping_monitor_stop(
    state: State<'_, PingMonitorState>,
    session_id: String,
) -> Result<(), String> {
    let mut monitors = state.monitors.lock().await;
    crate::services::ping_monitor::stop_monitor(&mut monitors, &session_id).await;
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
//
// The commands themselves need `AppHandle` + managed `LogManager`/`PingMonitorState`
// and a Tauri runtime, so only the AppHandle-free `logging_requested` gate is
// unit-tested here. The monitor engine and target validation are covered in
// `services::ping_monitor`.
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn logging_requested_needs_both_flag_and_path() {
        assert!(logging_requested(true, "C:/logs"));
    }

    #[test]
    fn logging_requested_false_when_disabled() {
        // Disabled always skips the approval round-trip, even with a path.
        assert!(!logging_requested(false, "C:/logs"));
    }

    #[test]
    fn logging_requested_false_when_path_empty() {
        // Enabled but no path → nothing to approve, so logging is not a candidate.
        assert!(!logging_requested(true, ""));
    }

    #[test]
    fn logging_requested_false_when_both_absent() {
        assert!(!logging_requested(false, ""));
    }
}
