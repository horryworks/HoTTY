//! Web Browser pane backend.
//!
//! Embeds a native child webview (WebView2 on Windows) over a pane's rectangle
//! using Tauri's multiwebview support (`Window::add_child`, behind tauri's
//! `unstable` feature). The renderer reports the pane body's rectangle in
//! physical pixels and the backend positions the child webview to cover it.
//!
//! ## `embedded-webview` feature gate
//! ALL functions that call a `Webview` method (create / navigate / bounds /
//! visibility / destroy) live in the `enabled` submodule, compiled only when the
//! non-default `embedded-webview` feature is on. When it is off, the `disabled`
//! submodule provides same-signature stubs that return an error.
//!
//! Why: linking tauri's webview window-geometry code makes the bare `cargo test`
//! harness binary fail to LOAD on Windows with 0xC0000139
//! (STATUS_ENTRYPOINT_NOT_FOUND) — the test exe lacks the application manifest
//! `tauri-build` embeds in the real app binary (which resolves the comctl32 v6
//! imports that code pulls in). Keeping every `Webview`-touching call behind the
//! feature lets `cargo test` / `check` / `clippy` run unmodified, while the
//! shipped app enables it (`tauri build --features embedded-webview`).
//!
//! The pure helpers (URL validation, label, rectangle math) stay un-gated and
//! are unit-tested. The `unstable` API may break across tauri minor/patch
//! releases — the crate is pinned; re-verify `add_child` on every bump.
//!
//! ## Security
//! The browsed page is a sandboxed island: it is a separate webview with the
//! remote page's own origin, gets NO `initialization_script`, NO `withGlobalTauri`
//! and NO capabilities, so it cannot reach HoTTY's Tauri IPC. Navigation is
//! restricted to http/https/about via `on_navigation` + `validate_browser_url`.

#[cfg(feature = "embedded-webview")]
use std::collections::HashMap;
#[cfg(feature = "embedded-webview")]
use std::sync::Mutex;

use serde::Deserialize;
use tauri::{PhysicalPosition, PhysicalSize, Url};

/// Rectangle reported by the renderer, in **physical pixels** relative to the
/// window's client area (`getBoundingClientRect() * devicePixelRatio`).
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Which categories of browsing data the user chose to clear (see
/// `clear_browsing_data`). Each maps to one or more WebView2 data kinds.
///
/// `local_storage` is deliberately NOT an option: the embedded browser shares
/// its WebView2 profile with HoTTY's own UI window, whose settings/bookmarks
/// live in `localStorage`, and WebView2 can only clear a data kind profile-wide
/// (no per-origin scope). So `LOCAL_STORAGE` is never cleared, protecting app data.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearDataOptions {
    /// Cookies + other site storage (IndexedDB, service workers, WebSQL, file
    /// systems, CacheStorage) — but NOT localStorage. Logs the user out of sites.
    pub cookies_and_site_data: bool,
    /// Cached images and files (HTTP disk cache).
    pub cache: bool,
    /// Browsing + download history.
    pub history: bool,
    /// Passwords saved by WebView2's autosave.
    pub passwords: bool,
    /// General autofill form data.
    pub autofill: bool,
}

/// Shared state: maps `paneId` → the child webview embedded for it.
///
/// The `tauri::Webview` map is gated behind `embedded-webview`: merely
/// *referencing* that type in always-compiled code links its Drop/method glue,
/// which statically imports comctl32-v6 entrypoints the manifest-less `cargo
/// test` harness can't resolve (load-time 0xC0000139). With the feature off the
/// state is an empty marker — see the module docs.
#[derive(Default)]
pub struct WebBrowserState {
    #[cfg(feature = "embedded-webview")]
    webviews: Mutex<HashMap<String, tauri::Webview>>,
    /// Last on-screen rectangle reported for each pane. A hidden webview is
    /// "parked" off-screen (see `set_visible`), so we keep its real bounds here
    /// to restore them when it is shown again.
    #[cfg(feature = "embedded-webview")]
    last_bounds: Mutex<HashMap<String, BrowserRect>>,
    /// Set once the background cookie-persistence sweeper has been spawned, so
    /// exactly one runs for the whole app lifetime. It is started lazily on the
    /// first `create` — see `maybe_start_cookie_sweeper`.
    #[cfg(feature = "embedded-webview")]
    sweeper_started: std::sync::atomic::AtomicBool,
}

impl WebBrowserState {
    pub fn new() -> Self {
        Self::default()
    }
}

// ---------------------------------------------------------------------------
// Pure helpers (always compiled, unit-tested)
// ---------------------------------------------------------------------------

/// Deterministic, unique webview label for a pane. The pane id already begins
/// with the `wb-` prefix, so the label is e.g. `wb-child-wb-lq2x3a-9f8e`.
pub fn label_for_pane(pane_id: &str) -> String {
    format!("wb-child-{pane_id}")
}

/// Validate a user-entered address. Only `http`/`https` are accepted as
/// top-level navigations; `about:blank` is allowed as the empty page. Everything
/// else (`file:`, `javascript:`, `data:`, `blob:`, …) is rejected.
pub fn validate_browser_url(input: &str) -> Result<Url, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("empty URL".to_string());
    }
    if trimmed.eq_ignore_ascii_case("about:blank") {
        return Url::parse("about:blank").map_err(|e| e.to_string());
    }
    let url = Url::parse(trimmed).map_err(|e| format!("invalid URL: {e}"))?;
    match url.scheme() {
        "http" | "https" => Ok(url),
        other => Err(format!("scheme not allowed: {other}")),
    }
}

/// Per-navigation guard used by `create`: allow only http/https plus the
/// `about:` internal scheme (WebView2 error/blank pages). Returning `false`
/// cancels the navigation, so a redirect or in-page link cannot escape the
/// scheme allowlist.
// Used by `enabled::create` and by unit tests; allow dead_code in plain
// non-test builds where the feature is off.
#[cfg_attr(not(feature = "embedded-webview"), allow(dead_code))]
fn is_allowed_navigation(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https" | "about")
}

/// Convert a renderer rectangle to physical position/size, clamping width and
/// height to at least 1px (a zero-size webview is invalid) and coordinates to
/// non-negative integers.
// Used by `enabled` (feature-gated) and unit tests; allow dead_code in plain
// non-test builds where the feature is off.
#[cfg_attr(not(feature = "embedded-webview"), allow(dead_code))]
fn rect_to_physical(rect: &BrowserRect) -> (PhysicalPosition<i32>, PhysicalSize<u32>) {
    let x = rect.x.round().max(0.0) as i32;
    let y = rect.y.round().max(0.0) as i32;
    let w = (rect.width.round().max(1.0)) as u32;
    let h = (rect.height.round().max(1.0)) as u32;
    (PhysicalPosition::new(x, y), PhysicalSize::new(w, h))
}

/// Physical position/size used to "park" a hidden webview far off-screen.
///
/// `Webview::hide()` is unreliable for child webviews on some WebView2 builds —
/// the OS-composited child window can keep painting over HTML modals. Moving it
/// far beyond any real monitor (1×1 at a large negative coordinate) guarantees it
/// is not visible regardless, so dialogs like New Connection always sit in front.
/// The real bounds are restored from `WebBrowserState::last_bounds` on show.
// Used by `enabled` (feature-gated) and unit tests; allow dead_code in plain
// non-test builds where the feature is off.
#[cfg_attr(not(feature = "embedded-webview"), allow(dead_code))]
fn off_screen_rect() -> (PhysicalPosition<i32>, PhysicalSize<u32>) {
    (PhysicalPosition::new(-32000, -32000), PhysicalSize::new(1, 1))
}

/// Supported zoom range (percent) for the embedded browser. Mirrors the UI
/// stepper's `ZOOM_STEPS` bounds so backend and frontend agree on the limits.
pub const MIN_ZOOM_PERCENT: u32 = 25;
pub const MAX_ZOOM_PERCENT: u32 = 500;

/// Clamp a requested zoom percentage into the supported range.
pub fn clamp_zoom_percent(percent: u32) -> u32 {
    percent.clamp(MIN_ZOOM_PERCENT, MAX_ZOOM_PERCENT)
}

/// Convert a (clamped) zoom percentage to a WebView2 zoom factor (1.0 == 100%).
// Used by `enabled` (feature-gated) and unit tests; allow dead_code in plain
// non-test builds where the feature is off.
#[cfg_attr(not(feature = "embedded-webview"), allow(dead_code))]
fn zoom_percent_to_factor(percent: u32) -> f64 {
    clamp_zoom_percent(percent) as f64 / 100.0
}

/// Convert a WebView2 zoom factor back to a rounded, clamped percentage (used
/// when echoing WebView2's own zoom changes — Ctrl+wheel, Ctrl+± — back to the
/// renderer). A non-finite or out-of-range factor collapses to the nearest bound.
#[cfg_attr(not(feature = "embedded-webview"), allow(dead_code))]
fn zoom_factor_to_percent(factor: f64) -> u32 {
    if !factor.is_finite() || factor <= 0.0 {
        return MIN_ZOOM_PERCENT;
    }
    clamp_zoom_percent((factor * 100.0).round() as u32)
}

// ---------------------------------------------------------------------------
// Public API — real implementations (feature on) or stubs (feature off)
// ---------------------------------------------------------------------------

#[cfg(feature = "embedded-webview")]
pub use enabled::*;

#[cfg(not(feature = "embedded-webview"))]
pub use disabled::*;

/// Stubs used when `embedded-webview` is off (e.g. `cargo test`): no webview is
/// ever created, so every op reports the feature is unavailable.
#[cfg(not(feature = "embedded-webview"))]
mod disabled {
    use super::{BrowserRect, ClearDataOptions, WebBrowserState};
    use tauri::{AppHandle, Url};

    const MSG: &str = "embedded web browser is not enabled in this build";

    pub fn create(
        _app: &AppHandle,
        _state: &WebBrowserState,
        _parent_label: &str,
        _pane_id: &str,
        _url: Url,
        _rect: &BrowserRect,
        _initial_zoom_percent: u32,
    ) -> Result<(), String> {
        Err(MSG.to_string())
    }
    pub fn navigate(_state: &WebBrowserState, _pane_id: &str, _url: Url) -> Result<(), String> {
        Err(MSG.to_string())
    }
    pub fn current_url(_state: &WebBrowserState, _pane_id: &str) -> Result<Option<String>, String> {
        Ok(None)
    }
    pub fn go_back(_state: &WebBrowserState, _pane_id: &str) -> Result<(), String> {
        Err(MSG.to_string())
    }
    pub fn go_forward(_state: &WebBrowserState, _pane_id: &str) -> Result<(), String> {
        Err(MSG.to_string())
    }
    pub fn reload(_state: &WebBrowserState, _pane_id: &str) -> Result<(), String> {
        Err(MSG.to_string())
    }
    pub fn stop(_state: &WebBrowserState, _pane_id: &str) -> Result<(), String> {
        Err(MSG.to_string())
    }
    pub fn set_bounds(
        _state: &WebBrowserState,
        _pane_id: &str,
        _rect: &BrowserRect,
    ) -> Result<(), String> {
        Err(MSG.to_string())
    }
    pub fn set_visible(
        _state: &WebBrowserState,
        _pane_id: &str,
        _visible: bool,
    ) -> Result<(), String> {
        Err(MSG.to_string())
    }
    pub fn destroy(_state: &WebBrowserState, _pane_id: &str) -> Result<(), String> {
        Err(MSG.to_string())
    }
    pub fn set_zoom(_state: &WebBrowserState, _pane_id: &str, _zoom: u32) -> Result<(), String> {
        Err(MSG.to_string())
    }
    pub fn clear_browsing_data(
        _app: &AppHandle,
        _state: &WebBrowserState,
        _pane_id: &str,
        _opts: ClearDataOptions,
    ) -> Result<(), String> {
        Err(MSG.to_string())
    }
}

/// Real implementations — compiled only with `embedded-webview`.
#[cfg(feature = "embedded-webview")]
mod enabled {
    use super::{
        is_allowed_navigation, label_for_pane, off_screen_rect, rect_to_physical, BrowserRect,
        ClearDataOptions, WebBrowserState,
    };

    use serde::Serialize;
    use tauri::webview::{PageLoadEvent, WebviewBuilder};
    use tauri::{AppHandle, Emitter, Manager, Position, Rect, Size, Url, WebviewUrl};

    /// Navigation state pushed to the renderer so the address bar tracks
    /// redirects and in-page link navigations.
    #[derive(Debug, Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct NavStatePayload {
        pane_id: String,
        url: String,
        loading: bool,
    }

    /// Back/forward availability pushed to the renderer on WebView2
    /// `HistoryChanged`, so the nav buttons enable/disable correctly.
    #[cfg(windows)]
    #[derive(Debug, Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct HistoryStatePayload {
        pane_id: String,
        can_go_back: bool,
        can_go_forward: bool,
    }

    /// A browser action triggered by an accelerator key pressed while the native
    /// webview (the page) had focus, pushed so the renderer runs the shortcut.
    #[cfg(windows)]
    #[derive(Debug, Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct AccelPayload {
        pane_id: String,
        action: String,
    }

    /// Zoom level (percent) pushed to the renderer whenever the webview's zoom
    /// changes — via our own `set_zoom`, or WebView2's built-in Ctrl+± / Ctrl+wheel
    /// — so the toolbar's `%` display and the per-pane zoom store stay in sync.
    #[cfg(windows)]
    #[derive(Debug, Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct ZoomStatePayload {
        pane_id: String,
        zoom: u32,
    }

    fn physical_bounds(rect: &BrowserRect) -> Rect {
        let (pos, size) = rect_to_physical(rect);
        Rect {
            position: Position::Physical(pos),
            size: Size::Physical(size),
        }
    }

    /// Off-screen "parking" rectangle for a hidden webview (see `off_screen_rect`).
    /// Keeps the webview's real `size_hint` so the page is not resized/reflowed —
    /// only its position moves far off-screen. Falls back to 1×1 if size unknown.
    fn off_screen_bounds(size_hint: Option<BrowserRect>) -> Rect {
        let (off_pos, fallback_size) = off_screen_rect();
        let size = match size_hint {
            Some(rect) => rect_to_physical(&rect).1,
            None => fallback_size,
        };
        Rect {
            position: Position::Physical(off_pos),
            size: Size::Physical(size),
        }
    }

    /// Remember a pane's last on-screen rectangle so `set_visible(true)` can
    /// restore it after the webview was parked off-screen while hidden.
    fn remember_bounds(state: &WebBrowserState, pane_id: &str, rect: &BrowserRect) {
        if let Ok(mut map) = state.last_bounds.lock() {
            map.insert(pane_id.to_string(), *rect);
        }
    }

    /// The last on-screen rectangle remembered for a pane, if any.
    fn remembered_bounds(state: &WebBrowserState, pane_id: &str) -> Option<BrowserRect> {
        state.last_bounds.lock().ok()?.get(pane_id).copied()
    }

    /// Clone the webview handle for a pane out of the map (cheap Arc clone)
    /// without holding the lock across the subsequent webview call.
    fn take_handle(state: &WebBrowserState, pane_id: &str) -> Option<tauri::Webview> {
        state.webviews.lock().ok()?.get(pane_id).cloned()
    }

    /// Run a small JS snippet in the pane's webview (history/reload/stop).
    fn eval(state: &WebBrowserState, pane_id: &str, script: &str) -> Result<(), String> {
        let webview =
            take_handle(state, pane_id).ok_or_else(|| "no webview for pane".to_string())?;
        webview.eval(script).map_err(|e| e.to_string())
    }

    /// Create the child webview for a pane, or — if one already exists for this
    /// pane id — reuse it. Reuse is what makes a page survive a pane move: the
    /// component unmounts/remounts (calling this again), and instead of
    /// recreating we just reposition the existing webview to the new rect and
    /// show it, preserving the loaded page and history.
    pub fn create(
        app: &AppHandle,
        state: &WebBrowserState,
        parent_label: &str,
        pane_id: &str,
        url: Url,
        rect: &BrowserRect,
        initial_zoom_percent: u32,
    ) -> Result<(), String> {
        // Reuse path: keep the loaded page across pane moves / remounts. The
        // webview keeps the zoom it already had, so `initial_zoom_percent` (which
        // the renderer derived from that same remembered value) is ignored here.
        if let Some(existing) = take_handle(state, pane_id) {
            remember_bounds(state, pane_id, rect);
            existing
                .set_bounds(physical_bounds(rect))
                .map_err(|e| e.to_string())?;
            existing.show().map_err(|e| e.to_string())?;
            return Ok(());
        }

        // Attach the child webview to the window that hosts this pane (not a
        // hardcoded "main"), so the Web Browser pane works in any window.
        let window = app
            .get_window(parent_label)
            .ok_or_else(|| format!("window '{parent_label}' not found"))?;

        let label = label_for_pane(pane_id);
        let (pos, size) = rect_to_physical(rect);

        let app_for_load = app.clone();
        let pane_for_load = pane_id.to_string();

        let builder = WebviewBuilder::new(label, WebviewUrl::External(url))
            .on_navigation(is_allowed_navigation)
            .on_page_load(move |webview, payload| {
                let loading = matches!(payload.event(), PageLoadEvent::Started);
                let url = webview.url().map(|u| u.to_string()).unwrap_or_default();
                let _ = app_for_load.emit(
                    "web-browser-nav-state",
                    NavStatePayload {
                        pane_id: pane_for_load.clone(),
                        url,
                        loading,
                    },
                );
                // Fast path: when a navigation commits, persist any session
                // cookies it set (e.g. a dashboard login) so they survive an app
                // restart. A SPA may set its auth cookie via XHR slightly after
                // load, so the periodic sweeper is the real guarantee — this just
                // captures the common case promptly.
                if matches!(payload.event(), PageLoadEvent::Finished) {
                    persist_session_cookies(&webview);
                }
            })
            // Enable native page zoom by Ctrl+wheel and Ctrl+±/0. Tauri defaults
            // this to false (so the app UI can't be zoomed); the Web Browser pane
            // is a real browser, so it must be on. Changes flow back to the toolbar
            // `%` via the ZoomFactorChanged handler installed below.
            .zoom_hotkeys_enabled(true)
            // The browsed page must not receive HoTTY's OS file-drop events.
            .disable_drag_drop_handler();

        let webview = window
            .add_child(builder, pos, size)
            .map_err(|e| format!("failed to create webview: {e}"))?;

        enable_password_autosave(&webview);
        install_input_and_history_handlers(app, pane_id, &webview, initial_zoom_percent);

        // Store the handle. If the lock is poisoned (a thread panicked holding
        // it), close the just-created webview instead of leaking an orphan that
        // nothing in the map can reach — mirrors `destroy`'s poison handling.
        match state.webviews.lock() {
            Ok(mut map) => {
                map.insert(pane_id.to_string(), webview);
            }
            Err(_) => {
                let _ = webview.close();
                return Err("state lock poisoned".to_string());
            }
        }
        remember_bounds(state, pane_id, rect);
        // Start the background session-cookie persister (once per app run) now
        // that there is at least one browser webview to sweep.
        maybe_start_cookie_sweeper(app, state);
        log::info!("web-browser: created child webview for pane {pane_id}");
        Ok(())
    }

    /// Enable WebView2's built-in password manager (autosave + autofill) on a
    /// freshly created child webview. Both are off/limited by default on Windows.
    /// Best-effort — the browser still works if this fails. Passwords are stored
    /// in WebView2's own encrypted store inside HoTTY's profile (separate from
    /// the system's Edge/Chrome password manager).
    fn enable_password_autosave(webview: &tauri::Webview) {
        #[cfg(windows)]
        {
            use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings4;
            use windows_core::Interface;
            let _ = webview.with_webview(|pw| {
                let controller = pw.controller();
                // SAFETY: COM calls on the WebView2 controller. `with_webview`
                // runs this on the main thread, and the controller exists because
                // `add_child` returned successfully. All results are ignored —
                // password autosave is a best-effort convenience.
                unsafe {
                    if let Ok(core) = controller.CoreWebView2() {
                        if let Ok(settings) = core.Settings() {
                            if let Ok(s4) = settings.cast::<ICoreWebView2Settings4>() {
                                let _ = s4.SetIsPasswordAutosaveEnabled(true);
                                let _ = s4.SetIsGeneralAutofillEnabled(true);
                            }
                        }
                    }
                }
            });
        }
        #[cfg(not(windows))]
        {
            let _ = webview;
        }
    }

    /// Convert the embedded browser's **session cookies** (those with no expiry,
    /// which WebView2 drops when the browser process exits) into **persistent**
    /// cookies, so a login whose auth is a session cookie — e.g. the Meraki
    /// dashboard — survives an app restart.
    ///
    /// WebView2 does not persist session cookies across environment restarts
    /// (WebView2Feedback #1167), and `--restore-last-session` is unreliable, so we
    /// re-stamp each session cookie with a future expiry and write it back through
    /// the cookie manager, which flushes it to the on-disk Cookies store. The
    /// server never learns how the client stored the cookie, so this is
    /// transparent; real session validity still rests with the server's own
    /// timeout. Best-effort and Windows-only (a no-op elsewhere).
    fn persist_session_cookies(webview: &tauri::Webview) {
        #[cfg(windows)]
        {
            use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_2;
            use webview2_com::GetCookiesCompletedHandler;
            use windows_core::Interface;

            // Expiry stamped onto session cookies: now + 30 days, as seconds since
            // the Unix epoch (the unit WebView2's SetExpires expects).
            let expires =
                match std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH) {
                    Ok(since_epoch) => since_epoch.as_secs_f64() + 30.0 * 24.0 * 60.0 * 60.0,
                    Err(_) => return,
                };

            // SAFETY: COM calls on the WebView2 core, dispatched onto the webview
            // thread by `with_webview`. Every result is ignored — persisting
            // cookies is a best-effort convenience and must never break browsing.
            let _ = webview.with_webview(move |pw| {
                let controller = pw.controller();
                unsafe {
                    if let Ok(core) = controller.CoreWebView2() {
                        if let Ok(core2) = core.cast::<ICoreWebView2_2>() {
                            if let Ok(manager) = core2.CookieManager() {
                                let manager_for_handler = manager.clone();
                                let handler = GetCookiesCompletedHandler::create(Box::new(
                                    move |_hr, list| {
                                        let Some(list) = list else { return Ok(()) };
                                        let mut count: u32 = 0;
                                        if list.Count(&mut count).is_err() {
                                            return Ok(());
                                        }
                                        for i in 0..count {
                                            let Ok(cookie) = list.GetValueAtIndex(i) else {
                                                continue;
                                            };
                                            let mut is_session = Default::default();
                                            if cookie.IsSession(&mut is_session).is_ok()
                                                && is_session.as_bool()
                                                && cookie.SetExpires(expires).is_ok()
                                            {
                                                let _ =
                                                    manager_for_handler.AddOrUpdateCookie(&cookie);
                                            }
                                        }
                                        Ok(())
                                    },
                                ));
                                // Null URI → enumerate cookies for all hosts.
                                let _ = manager.GetCookies(windows_core::PCWSTR::null(), &handler);
                            }
                        }
                    }
                }
            });
        }
        #[cfg(not(windows))]
        {
            let _ = webview;
        }
    }

    /// Spawn — exactly once per app run — a background task that periodically
    /// converts every live browser webview's session cookies to persistent ones
    /// (see `persist_session_cookies`). This is the reliable guarantee behind the
    /// `on_page_load` fast path: a SPA that sets its auth cookie via a late XHR is
    /// still captured within one sweep interval.
    fn maybe_start_cookie_sweeper(app: &AppHandle, state: &WebBrowserState) {
        use std::sync::atomic::Ordering;
        // Win the race to be the single sweeper; later calls become no-ops.
        if state.sweeper_started.swap(true, Ordering::SeqCst) {
            return;
        }
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let mut ticker = tokio::time::interval(std::time::Duration::from_secs(20));
            loop {
                ticker.tick().await;
                let state = app.state::<WebBrowserState>();
                // Clone handles out under the lock, then release it before any COM
                // work (cookie persistence dispatches onto the webview thread).
                let webviews: Vec<tauri::Webview> = match state.webviews.lock() {
                    Ok(map) => map.values().cloned().collect(),
                    Err(_) => continue,
                };
                for webview in webviews {
                    persist_session_cookies(&webview);
                }
            }
        });
    }

    /// Clear the selected categories of browsing data for the embedded browser.
    ///
    /// WebView2 clears by data *kind* across the whole profile (no per-origin
    /// scope). The profile is shared with HoTTY's own UI window, so we build the
    /// kinds mask to deliberately EXCLUDE `LOCAL_STORAGE` — that holds the app's
    /// settings/bookmarks. Best-effort and Windows-only. When cookies/site data
    /// are cleared we reload open browser tabs so the change shows as logged-out.
    pub fn clear_browsing_data(
        app: &AppHandle,
        state: &WebBrowserState,
        pane_id: &str,
        opts: ClearDataOptions,
    ) -> Result<(), String> {
        let webview =
            take_handle(state, pane_id).ok_or_else(|| "no webview for pane".to_string())?;
        #[cfg(windows)]
        {
            use webview2_com::Microsoft::Web::WebView2::Win32::{
                ICoreWebView2Profile2, ICoreWebView2_13, COREWEBVIEW2_BROWSING_DATA_KINDS,
                COREWEBVIEW2_BROWSING_DATA_KINDS_BROWSING_HISTORY,
                COREWEBVIEW2_BROWSING_DATA_KINDS_CACHE_STORAGE,
                COREWEBVIEW2_BROWSING_DATA_KINDS_COOKIES,
                COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE,
                COREWEBVIEW2_BROWSING_DATA_KINDS_DOWNLOAD_HISTORY,
                COREWEBVIEW2_BROWSING_DATA_KINDS_FILE_SYSTEMS,
                COREWEBVIEW2_BROWSING_DATA_KINDS_GENERAL_AUTOFILL,
                COREWEBVIEW2_BROWSING_DATA_KINDS_INDEXED_DB,
                COREWEBVIEW2_BROWSING_DATA_KINDS_PASSWORD_AUTOSAVE,
                COREWEBVIEW2_BROWSING_DATA_KINDS_SERVICE_WORKERS,
                COREWEBVIEW2_BROWSING_DATA_KINDS_WEB_SQL,
            };
            use webview2_com::ClearBrowsingDataCompletedHandler;
            use windows_core::Interface;

            // Build the bitmask from the user's selection. LOCAL_STORAGE is never
            // included — it holds the app's own data in the shared profile.
            let mut mask: i32 = 0;
            if opts.cookies_and_site_data {
                mask |= COREWEBVIEW2_BROWSING_DATA_KINDS_COOKIES.0
                    | COREWEBVIEW2_BROWSING_DATA_KINDS_INDEXED_DB.0
                    | COREWEBVIEW2_BROWSING_DATA_KINDS_SERVICE_WORKERS.0
                    | COREWEBVIEW2_BROWSING_DATA_KINDS_WEB_SQL.0
                    | COREWEBVIEW2_BROWSING_DATA_KINDS_FILE_SYSTEMS.0
                    | COREWEBVIEW2_BROWSING_DATA_KINDS_CACHE_STORAGE.0;
            }
            if opts.cache {
                mask |= COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE.0;
            }
            if opts.history {
                mask |= COREWEBVIEW2_BROWSING_DATA_KINDS_BROWSING_HISTORY.0
                    | COREWEBVIEW2_BROWSING_DATA_KINDS_DOWNLOAD_HISTORY.0;
            }
            if opts.passwords {
                mask |= COREWEBVIEW2_BROWSING_DATA_KINDS_PASSWORD_AUTOSAVE.0;
            }
            if opts.autofill {
                mask |= COREWEBVIEW2_BROWSING_DATA_KINDS_GENERAL_AUTOFILL.0;
            }
            if mask == 0 {
                return Ok(()); // nothing selected
            }

            let reload_after = opts.cookies_and_site_data;
            let app_for_reload = app.clone();

            // SAFETY: COM calls on the WebView2 core/profile, dispatched onto the
            // webview thread by `with_webview`. Every result is ignored — a failed
            // clear must not break browsing. On completion we reload open tabs so a
            // cookie clear is reflected as a logged-out page.
            let _ = webview.with_webview(move |pw| {
                let controller = pw.controller();
                unsafe {
                    if let Ok(core) = controller.CoreWebView2() {
                        if let Ok(core13) = core.cast::<ICoreWebView2_13>() {
                            if let Ok(profile) = core13.Profile() {
                                if let Ok(profile2) = profile.cast::<ICoreWebView2Profile2>() {
                                    let handler = ClearBrowsingDataCompletedHandler::create(
                                        Box::new(move |_hr| {
                                            if reload_after {
                                                if let Some(state) =
                                                    app_for_reload.try_state::<WebBrowserState>()
                                                {
                                                    let handles: Vec<tauri::Webview> =
                                                        match state.webviews.lock() {
                                                            Ok(map) => {
                                                                map.values().cloned().collect()
                                                            }
                                                            Err(_) => Vec::new(),
                                                        };
                                                    for wv in handles {
                                                        let _ = wv.reload();
                                                    }
                                                }
                                            }
                                            Ok(())
                                        }),
                                    );
                                    let _ = profile2.ClearBrowsingData(
                                        COREWEBVIEW2_BROWSING_DATA_KINDS(mask),
                                        &handler,
                                    );
                                }
                            }
                        }
                    }
                }
            });
            Ok(())
        }
        #[cfg(not(windows))]
        {
            let _ = (app, opts, webview);
            Ok(())
        }
    }

    /// Apply the initial zoom and bridge WebView2 input + history + zoom events to
    /// the renderer (Windows only):
    /// - Applies `initial_zoom_percent` to the fresh webview (flash-free — done
    ///   before it is stored/shown).
    /// - `AcceleratorKeyPressed` → `web-browser-accel`, so shortcuts (Ctrl+L,
    ///   F5/Ctrl+R, Alt+←/→) work even while the page itself has keyboard focus
    ///   (DOM key handling in the renderer only fires when the HTML chrome does).
    /// - `HistoryChanged` → `web-browser-history-state`, so the back/forward
    ///   buttons reflect `CanGoBack`/`CanGoForward`.
    /// - `ZoomFactorChanged` → `web-browser-zoom-state`, so the toolbar `%` and the
    ///   per-pane zoom store follow WebView2's built-in Ctrl+± / Ctrl+wheel zoom.
    ///
    /// Best-effort: registration failures are ignored (the browser still works,
    /// just without these niceties). Handlers are kept alive by WebView2.
    fn install_input_and_history_handlers(
        app: &AppHandle,
        pane_id: &str,
        webview: &tauri::Webview,
        initial_zoom_percent: u32,
    ) {
        #[cfg(windows)]
        {
            use webview2_com::Microsoft::Web::WebView2::Win32::{
                ICoreWebView2, ICoreWebView2AcceleratorKeyPressedEventArgs,
                ICoreWebView2Controller, COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN,
                COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN,
            };
            use webview2_com::{
                AcceleratorKeyPressedEventHandler, HistoryChangedEventHandler,
                ZoomFactorChangedEventHandler,
            };
            use windows::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, VK_CONTROL, VK_MENU};

            let app_accel = app.clone();
            let pane_accel = pane_id.to_string();
            let app_hist = app.clone();
            let pane_hist = pane_id.to_string();
            let app_zoom = app.clone();
            let pane_zoom = pane_id.to_string();

            // SAFETY: COM calls on the WebView2 controller/core. `with_webview`
            // runs this on the main thread and the controller exists because
            // `add_child` returned successfully. Each `add_*` keeps its handler
            // alive internally; registration errors are ignored (best-effort).
            let _ = webview.with_webview(move |pw| {
                let controller: ICoreWebView2Controller = pw.controller();

                // --- Initial zoom (before the pane is shown → no visible jump) ---
                unsafe {
                    let _ = controller.SetZoomFactor(super::zoom_percent_to_factor(
                        initial_zoom_percent,
                    ));
                }

                // --- AcceleratorKeyPressed → web-browser-accel ---
                let accel_handler = AcceleratorKeyPressedEventHandler::create(Box::new(
                    move |_sender: Option<ICoreWebView2Controller>,
                          args: Option<ICoreWebView2AcceleratorKeyPressedEventArgs>| {
                        let Some(args) = args else {
                            return Ok(());
                        };
                        // WebView2's COM getters write through out-params and
                        // return Result<()>.
                        unsafe {
                            let mut kind = COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN;
                            args.KeyEventKind(&mut kind)?;
                            // Only act on key-down (ignore key-up / the paired event).
                            if kind != COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN
                                && kind != COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN
                            {
                                return Ok(());
                            }
                            let mut vk: u32 = 0;
                            args.VirtualKey(&mut vk)?;
                            let ctrl = (GetKeyState(VK_CONTROL.0 as i32) as u16 & 0x8000) != 0;
                            let alt = (GetKeyState(VK_MENU.0 as i32) as u16 & 0x8000) != 0;
                            // Virtual-key codes: F5=0x74, R=0x52, L=0x4C,
                            // Left=0x25, Right=0x27.
                            let action = match vk {
                                0x74 => Some("reload"),
                                0x52 if ctrl => Some("reload"),
                                0x4C if ctrl => Some("focus-address"),
                                0x25 if alt => Some("back"),
                                0x27 if alt => Some("forward"),
                                _ => None,
                            };
                            if let Some(action) = action {
                                // Suppress WebView2's own default for this key.
                                let _ = args.SetHandled(true);
                                let _ = app_accel.emit(
                                    "web-browser-accel",
                                    AccelPayload {
                                        pane_id: pane_accel.clone(),
                                        action: action.to_string(),
                                    },
                                );
                            }
                        }
                        Ok(())
                    },
                ));
                // Token type is inferred from the signature (avoids naming a type
                // that differs across the windows/webview2-com crate versions).
                let mut accel_token = Default::default();
                let _ =
                    unsafe { controller.add_AcceleratorKeyPressed(&accel_handler, &mut accel_token) };

                // --- ZoomFactorChanged → web-browser-zoom-state ---
                // Re-read the factor from the controller (the event carries no
                // args) and forward the rounded percentage, so any zoom change —
                // ours or WebView2's built-in Ctrl+± / Ctrl+wheel — reaches the UI.
                let controller_for_zoom: ICoreWebView2Controller = controller.clone();
                let zoom_handler = ZoomFactorChangedEventHandler::create(Box::new(
                    move |_sender, _args| {
                        unsafe {
                            let mut factor: f64 = 1.0;
                            if controller_for_zoom.ZoomFactor(&mut factor).is_ok() {
                                let _ = app_zoom.emit(
                                    "web-browser-zoom-state",
                                    ZoomStatePayload {
                                        pane_id: pane_zoom.clone(),
                                        zoom: super::zoom_factor_to_percent(factor),
                                    },
                                );
                            }
                        }
                        Ok(())
                    },
                ));
                let mut zoom_token = Default::default();
                let _ = unsafe {
                    controller.add_ZoomFactorChanged(&zoom_handler, &mut zoom_token)
                };

                // --- HistoryChanged → web-browser-history-state ---
                if let Ok(core) = unsafe { controller.CoreWebView2() } {
                    let core_for_emit: ICoreWebView2 = core.clone();
                    let hist_handler = HistoryChangedEventHandler::create(Box::new(
                        move |_sender, _args| {
                            // COM getters write through out-params; best-effort.
                            unsafe {
                                let mut back = Default::default();
                                let _ = core_for_emit.CanGoBack(&mut back);
                                let mut fwd = Default::default();
                                let _ = core_for_emit.CanGoForward(&mut fwd);
                                let _ = app_hist.emit(
                                    "web-browser-history-state",
                                    HistoryStatePayload {
                                        pane_id: pane_hist.clone(),
                                        can_go_back: back.as_bool(),
                                        can_go_forward: fwd.as_bool(),
                                    },
                                );
                            }
                            Ok(())
                        },
                    ));
                    let mut hist_token = Default::default();
                    let _ = unsafe { core.add_HistoryChanged(&hist_handler, &mut hist_token) };
                }
            });
        }
        #[cfg(not(windows))]
        {
            let _ = (app, pane_id, webview, initial_zoom_percent);
        }
    }

    /// Set the pane's webview zoom to `zoom` percent (clamped to the supported
    /// range). Windows-only; a no-op elsewhere. The change echoes back to the
    /// renderer through the `ZoomFactorChanged` handler, so callers do not need to
    /// optimistically update anything themselves for correctness.
    pub fn set_zoom(state: &WebBrowserState, pane_id: &str, zoom: u32) -> Result<(), String> {
        let webview =
            take_handle(state, pane_id).ok_or_else(|| "no webview for pane".to_string())?;
        #[cfg(windows)]
        {
            let factor = super::zoom_percent_to_factor(zoom);
            // SAFETY: COM call on the WebView2 controller, dispatched onto the
            // webview thread by `with_webview`. The result is ignored — a failed
            // zoom must not break browsing.
            let _ = webview.with_webview(move |pw| {
                let controller = pw.controller();
                unsafe {
                    let _ = controller.SetZoomFactor(factor);
                }
            });
            Ok(())
        }
        #[cfg(not(windows))]
        {
            let _ = (webview, zoom);
            Ok(())
        }
    }

    /// Navigate an existing pane's webview to a new (already validated) URL.
    pub fn navigate(state: &WebBrowserState, pane_id: &str, url: Url) -> Result<(), String> {
        let webview =
            take_handle(state, pane_id).ok_or_else(|| "no webview for pane".to_string())?;
        webview.navigate(url).map_err(|e| e.to_string())
    }

    /// Current committed URL of the pane's webview, if one exists. A freshly
    /// remounted pane (after a move) queries this to restore its address bar,
    /// since merely repositioning the webview fires no page-load event.
    pub fn current_url(state: &WebBrowserState, pane_id: &str) -> Result<Option<String>, String> {
        match take_handle(state, pane_id) {
            Some(webview) => Ok(webview.url().ok().map(|u| u.to_string())),
            None => Ok(None),
        }
    }

    pub fn go_back(state: &WebBrowserState, pane_id: &str) -> Result<(), String> {
        eval(state, pane_id, "history.back()")
    }

    pub fn go_forward(state: &WebBrowserState, pane_id: &str) -> Result<(), String> {
        eval(state, pane_id, "history.forward()")
    }

    pub fn reload(state: &WebBrowserState, pane_id: &str) -> Result<(), String> {
        eval(state, pane_id, "location.reload()")
    }

    pub fn stop(state: &WebBrowserState, pane_id: &str) -> Result<(), String> {
        eval(state, pane_id, "window.stop()")
    }

    /// Reposition/resize the pane's webview to cover the reported rectangle.
    pub fn set_bounds(
        state: &WebBrowserState,
        pane_id: &str,
        rect: &BrowserRect,
    ) -> Result<(), String> {
        let webview =
            take_handle(state, pane_id).ok_or_else(|| "no webview for pane".to_string())?;
        remember_bounds(state, pane_id, rect);
        webview
            .set_bounds(physical_bounds(rect))
            .map_err(|e| e.to_string())
    }

    /// Show or hide the pane's webview (used when a modal/dropdown covers it, the
    /// pane unmounts, or the window is minimized).
    ///
    /// Hiding does NOT rely on `Webview::hide()` alone: that call is unreliable for
    /// child webviews on some WebView2 builds (the OS-composited window keeps
    /// painting over HTML modals such as the New Connection dialog). So we also
    /// park the webview far off-screen, guaranteeing it cannot cover a modal. On
    /// show we restore the last on-screen bounds and call `show()`.
    pub fn set_visible(
        state: &WebBrowserState,
        pane_id: &str,
        visible: bool,
    ) -> Result<(), String> {
        let webview = match take_handle(state, pane_id) {
            Some(w) => w,
            None => {
                log::warn!("web-browser: set_visible pane={pane_id} visible={visible} — no webview");
                return Err("no webview for pane".to_string());
            }
        };
        if visible {
            // Restore the real rectangle (the webview was parked off-screen while
            // hidden), then show. The renderer also re-reports bounds on show, so
            // this is belt-and-suspenders against a vanishing webview.
            if let Some(rect) = remembered_bounds(state, pane_id) {
                let _ = webview.set_bounds(physical_bounds(&rect));
            }
            webview.show().map_err(|e| e.to_string())
        } else {
            // Best-effort hide, then park off-screen so it cannot paint over a modal.
            // Keep the real size (no page reflow) — only move it out of view.
            let _ = webview.hide();
            let size_hint = remembered_bounds(state, pane_id);
            webview
                .set_bounds(off_screen_bounds(size_hint))
                .map_err(|e| e.to_string())
        }
    }

    /// Destroy the pane's webview and drop it from the map.
    pub fn destroy(state: &WebBrowserState, pane_id: &str) -> Result<(), String> {
        let webview = {
            let mut map = state
                .webviews
                .lock()
                .map_err(|_| "state lock poisoned".to_string())?;
            map.remove(pane_id)
        };
        if let Ok(mut map) = state.last_bounds.lock() {
            map.remove(pane_id);
        }
        if let Some(webview) = webview {
            let _ = webview.close();
            log::info!("web-browser: destroyed child webview for pane {pane_id}");
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn label_is_deterministic_and_prefixed() {
        assert_eq!(label_for_pane("wb-abc123"), "wb-child-wb-abc123");
        assert_eq!(label_for_pane("wb-abc123"), label_for_pane("wb-abc123"));
        assert_ne!(label_for_pane("wb-a"), label_for_pane("wb-b"));
    }

    #[test]
    fn accepts_http_and_https() {
        assert!(validate_browser_url("http://192.168.1.1").is_ok());
        assert!(validate_browser_url("https://example.com/path?q=1").is_ok());
        assert!(validate_browser_url("  https://example.com  ").is_ok());
    }

    #[test]
    fn allows_about_blank_only() {
        assert!(validate_browser_url("about:blank").is_ok());
        assert!(validate_browser_url("ABOUT:BLANK").is_ok());
        assert!(validate_browser_url("about:config").is_err());
    }

    #[test]
    fn rejects_dangerous_and_malformed() {
        assert!(validate_browser_url("file:///C:/Windows").is_err());
        assert!(validate_browser_url("javascript:alert(1)").is_err());
        assert!(validate_browser_url("data:text/html,<h1>x</h1>").is_err());
        assert!(validate_browser_url("blob:abc").is_err());
        assert!(validate_browser_url("example.com").is_err()); // no scheme
        assert!(validate_browser_url("").is_err());
        assert!(validate_browser_url("   ").is_err());
    }

    #[test]
    fn off_screen_rect_is_far_off_and_valid_size() {
        let (pos, size) = off_screen_rect();
        // Far beyond any real monitor (so a hidden webview can't paint over modals)…
        assert!(pos.x <= -10000 && pos.y <= -10000);
        // …yet a valid, non-zero size (a zero-size webview is invalid).
        assert!(size.width >= 1 && size.height >= 1);
    }

    #[test]
    fn navigation_guard_scheme_allowlist() {
        assert!(is_allowed_navigation(&Url::parse("http://a.test").unwrap()));
        assert!(is_allowed_navigation(&Url::parse("https://a.test").unwrap()));
        assert!(is_allowed_navigation(&Url::parse("about:blank").unwrap()));
        assert!(!is_allowed_navigation(
            &Url::parse("file:///etc/passwd").unwrap()
        ));
        assert!(!is_allowed_navigation(
            &Url::parse("javascript:alert(1)").unwrap()
        ));
    }

    #[test]
    fn rect_clamps_to_minimum_and_nonnegative() {
        let (pos, size) = rect_to_physical(&BrowserRect {
            x: -5.0,
            y: -1.0,
            width: 0.0,
            height: 0.4,
        });
        assert_eq!(pos, PhysicalPosition::new(0, 0));
        assert_eq!(size, PhysicalSize::new(1, 1));
    }

    #[test]
    fn rect_rounds_to_physical() {
        let (pos, size) = rect_to_physical(&BrowserRect {
            x: 10.6,
            y: 20.4,
            width: 800.5,
            height: 600.2,
        });
        assert_eq!(pos, PhysicalPosition::new(11, 20));
        assert_eq!(size, PhysicalSize::new(801, 600));
    }

    #[cfg(feature = "embedded-webview")]
    #[test]
    fn state_default_is_empty() {
        let state = WebBrowserState::new();
        assert!(state.webviews.lock().unwrap().is_empty());
    }

    #[test]
    fn zoom_percent_clamps_to_range() {
        assert_eq!(clamp_zoom_percent(0), MIN_ZOOM_PERCENT);
        assert_eq!(clamp_zoom_percent(10), MIN_ZOOM_PERCENT);
        assert_eq!(clamp_zoom_percent(25), 25);
        assert_eq!(clamp_zoom_percent(100), 100);
        assert_eq!(clamp_zoom_percent(500), 500);
        assert_eq!(clamp_zoom_percent(9999), MAX_ZOOM_PERCENT);
    }

    #[test]
    fn zoom_percent_factor_round_trip() {
        assert_eq!(zoom_percent_to_factor(100), 1.0);
        assert_eq!(zoom_percent_to_factor(50), 0.5);
        assert_eq!(zoom_percent_to_factor(200), 2.0);
        // Out-of-range percentages clamp before conversion.
        assert_eq!(zoom_percent_to_factor(10), 0.25);
        assert_eq!(zoom_percent_to_factor(1000), 5.0);

        assert_eq!(zoom_factor_to_percent(1.0), 100);
        assert_eq!(zoom_factor_to_percent(0.5), 50);
        assert_eq!(zoom_factor_to_percent(1.259), 126); // rounds up
        assert_eq!(zoom_factor_to_percent(1.251), 125); // rounds down
        // Degenerate factors collapse to the minimum rather than panicking.
        assert_eq!(zoom_factor_to_percent(0.0), MIN_ZOOM_PERCENT);
        assert_eq!(zoom_factor_to_percent(-1.0), MIN_ZOOM_PERCENT);
        assert_eq!(zoom_factor_to_percent(f64::NAN), MIN_ZOOM_PERCENT);
        assert_eq!(zoom_factor_to_percent(1000.0), MAX_ZOOM_PERCENT);
    }
}
