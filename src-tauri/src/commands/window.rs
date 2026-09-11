use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder, Window,
};

/// Monotonic counter for minting unique secondary-window labels.
///
/// Labels are `win-1`, `win-2`, … — never `main`, which is reserved for the
/// initial window defined statically in `tauri.conf.json`. AI Chat windows take
/// `win-ai-1`, `win-ai-2`, … from the SAME counter, so no two windows can ever
/// collide. Managed as Tauri app state so all "New Window" requests (and
/// second-launch callbacks) share one counter within the single process.
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

    /// Mint the next unique AI-Chat window label (`win-ai-1`, `win-ai-2`, …).
    ///
    /// Shares the counter with [`next_label`](Self::next_label), so a `win-ai-N`
    /// and a `win-N` never carry the same `N` and the two families can never
    /// produce the same string.
    fn next_ai_label(&self) -> String {
        let n = self.next.fetch_add(1, Ordering::Relaxed);
        format!("{AI_WINDOW_PREFIX}{n}")
    }
}

/// Label prefix identifying a window that hosts ONLY an AI Chat pane (no tab
/// bar, no grid, no sidebar). The frontend branches on this via
/// `IS_AI_CHAT_WINDOW` in `src/utils/windowLabel.ts`.
///
/// It deliberately starts with `win-` so it is still matched by the
/// `"windows": ["main", "win-*"]` glob in `capabilities/default.json`. A label
/// outside that glob gets ZERO permissions and fails silently at runtime.
pub const AI_WINDOW_PREFIX: &str = "win-ai-";

/// Default geometry for new windows, mirroring `tauri.conf.json`'s
/// `app.windows[0]` (the initial "main" window).
const WINDOW_WIDTH: f64 = 800.0;
const WINDOW_HEIGHT: f64 = 600.0;

/// Default geometry for an AI Chat window: a tall, narrow chat column rather
/// than a second full terminal window.
const AI_WINDOW_WIDTH: i32 = 460;
const AI_WINDOW_HEIGHT: i32 = 760;

/// Horizontal gap left between the parent window and a freshly opened AI Chat
/// window, so the two do not sit flush against each other.
const AI_WINDOW_GAP: i32 = 12;

/// Smallest usable AI Chat window. Below this the composer and the header pill
/// row stop fitting; a restored-from-settings size is clamped up to it.
const AI_WINDOW_MIN_WIDTH: i32 = 320;
const AI_WINDOW_MIN_HEIGHT: i32 = 380;

/// Vertical margin kept between a window's top edge and the bottom of its
/// monitor, so a restored position can never bury the title bar off-screen
/// where the user cannot grab it.
const OFFSCREEN_MARGIN: i32 = 48;

/// A window rectangle in PHYSICAL pixels.
///
/// Physical throughout: monitor geometry is reported in physical pixels, and
/// `set_position`/`set_size` accept physical, so staying in one unit avoids
/// scale-factor bugs on mixed-DPI multi-monitor setups. `x`/`y` are the OUTER
/// position (what `outerPosition()` reports) and `width`/`height` are the INNER
/// size (what `innerSize()` reports) — the same pair the frontend saves.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct WindowRect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

/// Fit `want` onto one of `monitors`, so a rectangle restored from settings can
/// never land on a display that is no longer attached.
///
/// Picks the monitor `want` overlaps most; with no overlap at all (the classic
/// "saved on the second screen, then unplugged it" case) it falls back to the
/// first monitor and centers there. The size is clamped to the monitor and to
/// the usable minimum, then the position is pulled back inside, leaving
/// [`OFFSCREEN_MARGIN`] of the window reachable at the bottom edge.
///
/// With no monitors reported (headless / probe failure) `want` is returned
/// unchanged — refusing to guess beats moving the window somewhere arbitrary.
pub fn fit_rect_to_monitors(want: WindowRect, monitors: &[WindowRect]) -> WindowRect {
    let Some(first) = monitors.first().copied() else {
        return want;
    };

    let target = monitors
        .iter()
        .copied()
        .max_by_key(|m| overlap_area(&want, m))
        .filter(|m| overlap_area(&want, m) > 0)
        .unwrap_or(first);

    let width = want
        .width
        .clamp(AI_WINDOW_MIN_WIDTH.min(target.width), target.width);
    let height = want
        .height
        .clamp(AI_WINDOW_MIN_HEIGHT.min(target.height), target.height);

    // No overlap with any monitor: the saved screen is gone. Center on the
    // fallback rather than pinning to a corner.
    let (x, y) = if overlap_area(&want, &target) == 0 {
        (
            target.x + (target.width - width) / 2,
            target.y + (target.height - height) / 2,
        )
    } else {
        (
            want.x.clamp(target.x, target.x + target.width - width),
            want.y.clamp(
                target.y,
                (target.y + target.height - OFFSCREEN_MARGIN).max(target.y),
            ),
        )
    };

    WindowRect {
        x,
        y,
        width,
        height,
    }
}

/// Area of the intersection of two rectangles; `0` when they do not overlap.
fn overlap_area(a: &WindowRect, b: &WindowRect) -> i64 {
    let w = (a.x + a.width).min(b.x + b.width) - a.x.max(b.x);
    let h = (a.y + a.height).min(b.y + b.height) - a.y.max(b.y);
    if w <= 0 || h <= 0 {
        return 0;
    }
    i64::from(w) * i64::from(h)
}

/// Every attached monitor as a physical-pixel rectangle.
fn monitor_rects(app: &AppHandle) -> Vec<WindowRect> {
    app.available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| {
            let pos = m.position();
            let size = m.size();
            WindowRect {
                x: pos.x,
                y: pos.y,
                width: size.width as i32,
                height: size.height as i32,
            }
        })
        .collect()
}

/// Where to put a new AI Chat window when the user has no saved bounds: just to
/// the right of the window that asked for it, at the default chat-column size.
fn rect_beside(parent: &Window) -> WindowRect {
    let (px, py, pw) = match (parent.outer_position(), parent.outer_size()) {
        (Ok(pos), Ok(size)) => (pos.x, pos.y, size.width as i32),
        _ => (0, 0, 0),
    };
    WindowRect {
        x: px + pw + AI_WINDOW_GAP,
        y: py,
        width: AI_WINDOW_WIDTH,
        height: AI_WINDOW_HEIGHT,
    }
}

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

/// Open a window that hosts only an AI Chat pane, and return its label.
///
/// `bounds` is the user's remembered geometry (physical pixels); pass `None` to
/// place the window beside the caller at the default size. Either way the
/// rectangle goes through [`fit_rect_to_monitors`] first, so a position saved on
/// a display that has since been unplugged still opens somewhere reachable.
///
/// Geometry is applied AFTER the build (via `set_size`/`set_position`) rather
/// than through the builder, because the builder takes logical pixels while
/// monitors and the frontend's saved values are physical.
#[tauri::command]
pub async fn create_ai_chat_window(
    app: AppHandle,
    window: Window,
    bounds: Option<WindowRect>,
) -> Result<String, String> {
    let label = app.state::<WindowCounterState>().next_ai_label();
    let want = bounds.unwrap_or_else(|| rect_beside(&window));
    let rect = fit_rect_to_monitors(want, &monitor_rects(&app));

    let built = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
        .title("HoTTY AI Chat")
        .inner_size(f64::from(rect.width), f64::from(rect.height))
        .resizable(true)
        // Same reason as `create_app_window`: keep HTML5 drag/drop working.
        .disable_drag_drop_handler()
        .build()
        .map_err(|e| e.to_string())?;

    // Physical geometry, applied post-build. A failure here is not fatal — the
    // window is already up at the builder's (logical) size, which is close
    // enough to be usable — so log and carry on rather than tearing it down.
    if let Err(e) = built.set_size(PhysicalSize::new(rect.width, rect.height)) {
        log::warn!("could not size AI chat window {label}: {e}");
    }
    if let Err(e) = built.set_position(PhysicalPosition::new(rect.x, rect.y)) {
        log::warn!("could not position AI chat window {label}: {e}");
    }

    Ok(label)
}

/// Labels of every window currently open in this process.
///
/// Used by an AI Chat window to find a normal window to hand a conversation
/// (or a session that needs a real tab) back to.
#[tauri::command]
pub async fn list_window_labels(app: AppHandle) -> Result<Vec<String>, String> {
    let mut labels: Vec<String> = app.webview_windows().into_keys().collect();
    labels.sort();
    Ok(labels)
}

/// Keep this window above every other application, or stop doing so.
#[tauri::command]
pub async fn set_window_always_on_top(window: Window, on_top: bool) -> Result<(), String> {
    window.set_always_on_top(on_top).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: i32, y: i32, width: i32, height: i32) -> WindowRect {
        WindowRect {
            x,
            y,
            width,
            height,
        }
    }

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

    #[test]
    fn ai_labels_share_the_counter_so_they_never_collide() {
        let counter = WindowCounterState::new();
        let plain = counter.next_label();
        let ai = counter.next_ai_label();
        let plain2 = counter.next_label();
        assert_eq!(plain, "win-1");
        assert_eq!(ai, "win-ai-2");
        assert_eq!(plain2, "win-3");
        assert_ne!(plain, ai);
    }

    #[test]
    fn ai_label_matches_the_capability_glob() {
        // capabilities/default.json scopes permissions to ["main", "win-*"].
        // An AI window outside that glob would get no permissions at all.
        let ai = WindowCounterState::new().next_ai_label();
        assert!(ai.starts_with("win-"), "{ai} must match the win-* glob");
        assert!(AI_WINDOW_PREFIX.starts_with("win-"));
    }

    #[test]
    fn with_no_monitors_the_rect_is_left_alone() {
        let want = rect(100, 200, 400, 700);
        assert_eq!(fit_rect_to_monitors(want, &[]), want);
    }

    #[test]
    fn a_rect_already_inside_a_monitor_is_unchanged() {
        let screen = rect(0, 0, 1920, 1080);
        let want = rect(100, 100, 460, 760);
        assert_eq!(fit_rect_to_monitors(want, &[screen]), want);
    }

    #[test]
    fn a_rect_hanging_off_the_right_edge_is_pulled_back_in() {
        let screen = rect(0, 0, 1920, 1080);
        let got = fit_rect_to_monitors(rect(1800, 100, 460, 760), &[screen]);
        assert_eq!(got.x, 1920 - 460);
        assert_eq!(got.y, 100);
        assert_eq!(got.width, 460);
    }

    #[test]
    fn a_negative_position_is_pulled_back_in() {
        let screen = rect(0, 0, 1920, 1080);
        let got = fit_rect_to_monitors(rect(-300, -200, 460, 760), &[screen]);
        assert_eq!(got.x, 0);
        assert_eq!(got.y, 0);
    }

    #[test]
    fn an_unplugged_monitor_centers_the_window_on_the_first_one() {
        // Saved at x=2600 on a second screen that is no longer attached.
        let screen = rect(0, 0, 1920, 1080);
        let got = fit_rect_to_monitors(rect(2600, 300, 460, 760), &[screen]);
        assert_eq!(got.x, (1920 - 460) / 2);
        assert_eq!(got.y, (1080 - 760) / 2);
        assert!(got.x >= 0 && got.x + got.width <= 1920);
    }

    #[test]
    fn the_monitor_with_the_most_overlap_wins() {
        let left = rect(0, 0, 1920, 1080);
        let right = rect(1920, 0, 2560, 1440);
        // Mostly on the right-hand screen, so it should be fitted to that one.
        let got = fit_rect_to_monitors(rect(2000, 100, 460, 760), &[left, right]);
        assert_eq!(got.x, 2000);
        assert_eq!(got.y, 100);
        // And it must NOT have been dragged onto the left screen.
        assert!(got.x >= right.x);
    }

    #[test]
    fn a_window_taller_than_the_screen_is_shrunk_to_fit() {
        let small = rect(0, 0, 1280, 720);
        let got = fit_rect_to_monitors(rect(0, 0, 460, 2000), &[small]);
        assert_eq!(got.height, 720);
        assert!(got.y + got.height <= small.y + small.height + OFFSCREEN_MARGIN);
    }

    #[test]
    fn a_too_small_saved_size_is_grown_to_the_usable_minimum() {
        let screen = rect(0, 0, 1920, 1080);
        let got = fit_rect_to_monitors(rect(10, 10, 80, 40), &[screen]);
        assert_eq!(got.width, AI_WINDOW_MIN_WIDTH);
        assert_eq!(got.height, AI_WINDOW_MIN_HEIGHT);
    }

    #[test]
    fn the_title_bar_always_stays_grabbable() {
        let screen = rect(0, 0, 1920, 1080);
        // Saved almost entirely below the bottom edge.
        let got = fit_rect_to_monitors(rect(100, 1070, 460, 760), &[screen]);
        assert!(
            got.y <= 1080 - OFFSCREEN_MARGIN,
            "y={} leaves nothing to grab",
            got.y
        );
    }

    #[test]
    fn overlap_area_is_zero_for_disjoint_rects() {
        assert_eq!(overlap_area(&rect(0, 0, 10, 10), &rect(20, 20, 10, 10)), 0);
        // Touching edges do not overlap.
        assert_eq!(overlap_area(&rect(0, 0, 10, 10), &rect(10, 0, 10, 10)), 0);
        assert_eq!(overlap_area(&rect(0, 0, 10, 10), &rect(5, 5, 10, 10)), 25);
    }
}
