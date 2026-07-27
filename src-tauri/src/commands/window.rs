use std::sync::atomic::{AtomicU64, Ordering};

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// Monotonic counter for minting unique secondary-window labels.
///
/// Labels are `win-1`, `win-2`, … — never `main`, which is reserved for the
/// initial window defined statically in `tauri.conf.json`. Managed as Tauri app
/// state so all "New Window" requests (and second-launch callbacks) share one
/// counter within the single process.
pub struct WindowCounterState {
    next: AtomicU64,
}

impl Default for WindowCounterState {
    fn default() -> Self {
        Self::new()
    }
}

impl WindowCounterState {
    pub fn new() -> Self {
        Self {
            next: AtomicU64::new(1),
        }
    }

    /// Mint the next unique window label (`win-1`, `win-2`, …).
    fn next_label(&self) -> String {
        let n = self.next.fetch_add(1, Ordering::Relaxed);
        format!("win-{n}")
    }
}

/// Default geometry for new windows, mirroring `tauri.conf.json`'s
/// `app.windows[0]` (the initial "main" window).
const WINDOW_WIDTH: f64 = 800.0;
const WINDOW_HEIGHT: f64 = 600.0;

/// Create a new top-level application window inside the current process and
/// return its label.
///
/// Shared by the "New Window" command and the single-instance callback: a second
/// EXE launch opens a window here instead of starting a second process.
pub fn create_app_window(app: &AppHandle) -> Result<String, String> {
    let label = app.state::<WindowCounterState>().next_label();
    let version = app.package_info().version.to_string();

    WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title(format!("HoTTY v{version}"))
        .inner_size(WINDOW_WIDTH, WINDOW_HEIGHT)
        .resizable(true)
        // Match `dragDropEnabled: false` from tauri.conf.json so the webview
        // receives HTML5 drag/drop events (used by tab reordering and pane
        // assignment).
        .disable_drag_drop_handler()
        .build()
        .map_err(|e| e.to_string())?;

    Ok(label)
}

/// Open a new HoTTY window in the current process; returns the new window label.
#[tauri::command]
pub async fn create_window(app: AppHandle) -> Result<String, String> {
    create_app_window(&app)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_are_unique_prefixed_and_never_main() {
        let counter = WindowCounterState::new();
        let a = counter.next_label();
        let b = counter.next_label();
        let c = counter.next_label();
        assert_eq!(a, "win-1");
        assert_eq!(b, "win-2");
        assert_eq!(c, "win-3");
        assert!(a.starts_with("win-"));
        assert_ne!(a, "main");
        assert_ne!(a, b);
        assert_ne!(b, c);
    }
}
