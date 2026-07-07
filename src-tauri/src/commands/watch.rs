use tauri::State;

use crate::services::watch_buffer::WatchBufferState;

/// Enable/disable AI watch capture for a session. `limit` is the max buffer
/// size in bytes (from the `watchBufferLimit` setting; 0 = backend default).
#[tauri::command]
pub fn set_watching(
    state: State<WatchBufferState>,
    window: tauri::WebviewWindow,
    session_id: String,
    watching: bool,
    limit: usize,
) {
    // Key the watch on the CALLING window so two windows watching the same
    // session are ref-counted (neither resets the other's buffer, and the entry
    // survives until the last one unwatches).
    state.set_watching(&session_id, window.label(), watching, limit);
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

#[cfg(test)]
mod tests {
    //! These commands are thin `#[tauri::command]` wrappers that forward to
    //! [`WatchBufferState`], keyed on the CALLING window's label. The buffer
    //! mechanics (ANSI stripping, front-trim at limit) are covered in
    //! `services::watch_buffer`; the `#[tauri::command]` entry points can't be
    //! invoked without a live Tauri `State`/`WebviewWindow`, so these tests pin
    //! the command-layer *contract* the frontend relies on — using the exact
    //! call shape the wrappers use (window label as the watcher key).
    use crate::services::watch_buffer::WatchBufferState;

    /// Mirror of `set_watching`'s single piece of logic: it forwards the calling
    /// window's label as the watcher key.
    fn set_watching(
        state: &WatchBufferState,
        window_label: &str,
        session_id: &str,
        watching: bool,
        limit: usize,
    ) {
        state.set_watching(session_id, window_label, watching, limit);
    }

    #[test]
    fn get_is_a_peek_and_take_is_read_once() {
        // Contract: `get_watch_buffer` must NOT clear (the auto-exec poll reads
        // it repeatedly to detect command completion), while `take_watch_buffer`
        // clears (read-once semantics for the AI prompt).
        let state = WatchBufferState::new();
        set_watching(&state, "main", "sid", true, 0);
        state.append("sid", "hello");

        assert_eq!(state.get("sid"), "hello"); // peek
        assert_eq!(state.get("sid"), "hello"); // still there after a peek
        assert_eq!(state.take("sid"), "hello"); // read-once
        assert_eq!(state.get("sid"), ""); // take cleared it
    }

    #[test]
    fn clear_buffer_keeps_watching() {
        // `clear_watch_buffer` resets the buffer WITHOUT disabling the watch, so
        // subsequent output is still captured (used on (re)link).
        let state = WatchBufferState::new();
        set_watching(&state, "main", "sid", true, 0);
        state.append("sid", "x");
        state.clear("sid");
        state.append("sid", "y");
        assert_eq!(state.take("sid"), "y");
    }

    #[test]
    fn watching_is_ref_counted_per_window() {
        // Because the command keys on `window.label()`, two windows watching the
        // same session are ref-counted: the entry survives until the LAST window
        // stops watching, and neither window's stop wipes the other's capture.
        let state = WatchBufferState::new();
        set_watching(&state, "main", "sid", true, 0);
        set_watching(&state, "win-1", "sid", true, 0);
        state.append("sid", "data");

        set_watching(&state, "main", "sid", false, 0); // one window stops
        state.append("sid", "more"); // still watched by win-1
        assert_eq!(state.get("sid"), "datamore");

        set_watching(&state, "win-1", "sid", false, 0); // last window stops
        state.append("sid", "gone"); // no longer watched -> dropped
        assert_eq!(state.take("sid"), "");
    }
}
