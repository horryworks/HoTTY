use tauri::{AppHandle, Emitter};

#[derive(Clone, serde::Serialize)]
struct SharedStoreChange {
    channel: String,
    payload: String,
    origin: String,
}

/// Broadcast a shared-store change to every window (including the sender — the
/// frontend ignores events whose `origin` matches its own window label).
///
/// Keeps shared frontend state (settings, web bookmarks, host tree) consistent
/// across windows in the single process: each window mirrors the change into its
/// own in-memory copy instead of silently clobbering it on the next persist.
#[tauri::command]
pub fn broadcast_shared_change(
    app: AppHandle,
    channel: String,
    payload: String,
    origin: String,
) -> Result<(), String> {
    app.emit(
        "shared-store-changed",
        SharedStoreChange {
            channel,
            payload,
            origin,
        },
    )
    .map_err(|e| e.to_string())
}
