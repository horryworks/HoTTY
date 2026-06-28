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
    use super::{BrowserRect, WebBrowserState};
    use tauri::{AppHandle, Url};

    const MSG: &str = "embedded web browser is not enabled in this build";

    pub fn create(
        _app: &AppHandle,
        _state: &WebBrowserState,
        _parent_label: &str,
        _pane_id: &str,
        _url: Url,
        _rect: &BrowserRect,
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
}

/// Real implementations — compiled only with `embedded-webview`.
#[cfg(feature = "embedded-webview")]
mod enabled {
    use super::{
        is_allowed_navigation, label_for_pane, off_screen_rect, rect_to_physical, BrowserRect,
        WebBrowserState,
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
    ) -> Result<(), String> {
        // Reuse path: keep the loaded page across pane moves / remounts.
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
            })
            // The browsed page must not receive HoTTY's OS file-drop events.
            .disable_drag_drop_handler();

        let webview = window
            .add_child(builder, pos, size)
            .map_err(|e| format!("failed to create webview: {e}"))?;

        enable_password_autosave(&webview);
        install_input_and_history_handlers(app, pane_id, &webview);

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

    /// Bridge WebView2 input + history events to the renderer (Windows only):
    /// - `AcceleratorKeyPressed` → `web-browser-accel`, so shortcuts (Ctrl+L,
    ///   F5/Ctrl+R, Alt+←/→) work even while the page itself has keyboard focus
    ///   (DOM key handling in the renderer only fires when the HTML chrome does).
    /// - `HistoryChanged` → `web-browser-history-state`, so the back/forward
    ///   buttons reflect `CanGoBack`/`CanGoForward`.
    ///
    /// Best-effort: registration failures are ignored (the browser still works,
    /// just without these niceties). Handlers are kept alive by WebView2.
    fn install_input_and_history_handlers(app: &AppHandle, pane_id: &str, webview: &tauri::Webview) {
        #[cfg(windows)]
        {
            use webview2_com::Microsoft::Web::WebView2::Win32::{
                ICoreWebView2, ICoreWebView2AcceleratorKeyPressedEventArgs,
                ICoreWebView2Controller, COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN,
                COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN,
            };
            use webview2_com::{AcceleratorKeyPressedEventHandler, HistoryChangedEventHandler};
            use windows::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, VK_CONTROL, VK_MENU};

            let app_accel = app.clone();
            let pane_accel = pane_id.to_string();
            let app_hist = app.clone();
            let pane_hist = pane_id.to_string();

            // SAFETY: COM calls on the WebView2 controller/core. `with_webview`
            // runs this on the main thread and the controller exists because
            // `add_child` returned successfully. Each `add_*` keeps its handler
            // alive internally; registration errors are ignored (best-effort).
            let _ = webview.with_webview(move |pw| {
                let controller: ICoreWebView2Controller = pw.controller();

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
            let _ = (app, pane_id, webview);
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
}
