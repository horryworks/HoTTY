//! Tauri commands for the Web Browser pane. Thin wrappers over
//! `services::web_browser`; all URL validation happens here / in the service.

use tauri::{AppHandle, State, Window};
use tauri_plugin_dialog::DialogExt;

use crate::services::web_browser::{self, BrowserRect, ClearDataOptions, WebBrowserState};

/// Defensive size cap for the bookmarks JSON file (import & export).
const MAX_BOOKMARKS_BYTES: u64 = 5 * 1024 * 1024;

/// Create the child webview for a pane and position it at `rect`. `url` is the
/// initial address; it is validated (http/https/about:blank only) before use.
#[tauri::command]
pub async fn web_browser_create(
    app: AppHandle,
    window: Window,
    state: State<'_, WebBrowserState>,
    pane_id: String,
    url: String,
    rect: BrowserRect,
    zoom: u32,
) -> Result<(), String> {
    let validated = web_browser::validate_browser_url(&url)?;
    let zoom = web_browser::clamp_zoom_percent(zoom);
    web_browser::create(
        &app,
        &state,
        window.label(),
        &pane_id,
        validated,
        &rect,
        zoom,
    )
}

/// Navigate the pane's webview to a new address (validated server-side).
#[tauri::command]
pub async fn web_browser_navigate(
    state: State<'_, WebBrowserState>,
    pane_id: String,
    url: String,
) -> Result<(), String> {
    let validated = web_browser::validate_browser_url(&url)?;
    web_browser::navigate(&state, &pane_id, validated)
}

/// Current committed URL of the pane's webview (used to restore the address bar
/// after a pane move). `None` if no webview exists for the pane.
#[tauri::command]
pub async fn web_browser_current_url(
    state: State<'_, WebBrowserState>,
    pane_id: String,
) -> Result<Option<String>, String> {
    web_browser::current_url(&state, &pane_id)
}

#[tauri::command]
pub async fn web_browser_back(
    state: State<'_, WebBrowserState>,
    pane_id: String,
) -> Result<(), String> {
    web_browser::go_back(&state, &pane_id)
}

#[tauri::command]
pub async fn web_browser_forward(
    state: State<'_, WebBrowserState>,
    pane_id: String,
) -> Result<(), String> {
    web_browser::go_forward(&state, &pane_id)
}

#[tauri::command]
pub async fn web_browser_reload(
    state: State<'_, WebBrowserState>,
    pane_id: String,
) -> Result<(), String> {
    web_browser::reload(&state, &pane_id)
}

#[tauri::command]
pub async fn web_browser_stop(
    state: State<'_, WebBrowserState>,
    pane_id: String,
) -> Result<(), String> {
    web_browser::stop(&state, &pane_id)
}

/// Reposition/resize the pane's webview to cover the reported rectangle.
#[tauri::command]
pub async fn web_browser_set_bounds(
    state: State<'_, WebBrowserState>,
    pane_id: String,
    rect: BrowserRect,
) -> Result<(), String> {
    web_browser::set_bounds(&state, &pane_id, &rect)
}

/// Show/hide the pane's webview (hidden while a modal covers it or the pane is
/// not mounted).
#[tauri::command]
pub async fn web_browser_set_visible(
    state: State<'_, WebBrowserState>,
    pane_id: String,
    visible: bool,
) -> Result<(), String> {
    web_browser::set_visible(&state, &pane_id, visible)
}

/// Destroy the pane's webview (called when the tab is closed).
#[tauri::command]
pub async fn web_browser_destroy(
    state: State<'_, WebBrowserState>,
    pane_id: String,
) -> Result<(), String> {
    web_browser::destroy(&state, &pane_id)
}

/// Set the pane's webview zoom level (percentage; clamped server-side to the
/// supported range).
#[tauri::command]
pub async fn web_browser_set_zoom(
    state: State<'_, WebBrowserState>,
    pane_id: String,
    zoom: u32,
) -> Result<(), String> {
    web_browser::set_zoom(&state, &pane_id, web_browser::clamp_zoom_percent(zoom))
}

/// Clear the selected categories of browsing data (cookies/site data, cache,
/// history, saved passwords, autofill) for the embedded browser. App settings
/// and bookmarks (localStorage in the shared profile) are never touched.
#[tauri::command]
pub async fn web_browser_clear_browsing_data(
    app: AppHandle,
    state: State<'_, WebBrowserState>,
    pane_id: String,
    options: ClearDataOptions,
) -> Result<(), String> {
    web_browser::clear_browsing_data(&app, &state, &pane_id, options)
}

/// Export the bookmark tree (`data`, a JSON array string) to a user-chosen file
/// via a native save dialog. Bookmarks hold no secrets, so this is plain JSON
/// (unlike the encrypted host-tree `.htree`). Returns `false` if cancelled.
#[tauri::command]
pub async fn web_browser_export_bookmarks(app: AppHandle, data: String) -> Result<bool, String> {
    // Validate it is a JSON array (the node shape is enforced client-side).
    let _: Vec<serde_json::Value> =
        serde_json::from_str(&data).map_err(|e| format!("invalid bookmarks JSON: {e}"))?;
    if data.len() as u64 > MAX_BOOKMARKS_BYTES {
        return Err("bookmarks data too large".to_string());
    }

    let file_path = app
        .dialog()
        .file()
        .add_filter("Bookmarks (JSON)", &["json"])
        .set_file_name("hotty-bookmarks.json")
        .blocking_save_file();
    let Some(path) = file_path else {
        return Ok(false); // user cancelled
    };

    let path_ref = path
        .as_path()
        .ok_or_else(|| "invalid export path".to_string())?;
    std::fs::write(path_ref, data.as_bytes()).map_err(|e| format!("failed to write file: {e}"))?;
    Ok(true)
}

/// Pick a bookmarks JSON file (native open dialog) and return its raw text, or
/// `None` if cancelled. The renderer validates the shape before importing.
#[tauri::command]
pub async fn web_browser_import_bookmarks(app: AppHandle) -> Result<Option<String>, String> {
    let file_path = app
        .dialog()
        .file()
        .add_filter("Bookmarks (JSON)", &["json"])
        .blocking_pick_file();
    let Some(path) = file_path else {
        return Ok(None); // user cancelled
    };

    let path_ref = path
        .as_path()
        .ok_or_else(|| "invalid import path".to_string())?;
    let meta = std::fs::metadata(path_ref).map_err(|e| format!("failed to read file: {e}"))?;
    if meta.len() > MAX_BOOKMARKS_BYTES {
        return Err("bookmarks file too large".to_string());
    }
    let content =
        std::fs::read_to_string(path_ref).map_err(|e| format!("failed to read file: {e}"))?;
    Ok(Some(content))
}
