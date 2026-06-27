//! Tauri commands for the Web Browser pane. Thin wrappers over
//! `services::web_browser`; all URL validation happens here / in the service.

use tauri::{AppHandle, State};

use crate::services::web_browser::{self, BrowserRect, WebBrowserState};

/// Create the child webview for a pane and position it at `rect`. `url` is the
/// initial address; it is validated (http/https/about:blank only) before use.
#[tauri::command]
pub async fn web_browser_create(
    app: AppHandle,
    state: State<'_, WebBrowserState>,
    pane_id: String,
    url: String,
    rect: BrowserRect,
) -> Result<(), String> {
    let validated = web_browser::validate_browser_url(&url)?;
    web_browser::create(&app, &state, &pane_id, validated, &rect)
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
