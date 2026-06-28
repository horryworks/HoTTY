use tauri::State;

use crate::services::watch_buffer::WatchBufferState;

/// Enable/disable AI watch capture for a session. `limit` is the max buffer
/// size in bytes (from the `watchBufferLimit` setting; 0 = backend default).
#[tauri::command]
pub fn set_watching(
    state: State<WatchBufferState>,
    session_id: String,
    watching: bool,
    limit: usize,
) {
    state.set_watching(&session_id, watching, limit);
}

/// Peek a session's watch buffer WITHOUT clearing it (used by the auto-exec poll).
#[tauri::command]
pub fn get_watch_buffer(state: State<WatchBufferState>, session_id: String) -> String {
    state.get(&session_id)
}

/// Return and clear a session's watch buffer (read-once for the AI prompt).
#[tauri::command]
pub fn take_watch_buffer(state: State<WatchBufferState>, session_id: String) -> String {
    state.take(&session_id)
}

/// Clear a session's watch buffer without disabling watching (used on re-link).
#[tauri::command]
pub fn clear_watch_buffer(state: State<WatchBufferState>, session_id: String) {
    state.clear(&session_id);
}
