//! Native window chrome (the OS title bar). All Windows-specific calls for it
//! live here, so a future macOS/Linux port swaps this one module.

/// An sRGB colour as `(r, g, b)`.
pub type Rgb = (u8, u8, u8);

/// Parse a strict `#rrggbb` string. Anything else is rejected: the frontend
/// normalizes theme colours before sending them.
pub fn parse_hex_rgb(value: &str) -> Option<Rgb> {
    let hex = value.strip_prefix('#')?;
    if hex.len() != 6 || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let channel = |i: usize| u8::from_str_radix(&hex[i..i + 2], 16).ok();
    Some((channel(0)?, channel(2)?, channel(4)?))
}

/// Win32 COLORREF layout: 0x00BBGGRR.
#[cfg_attr(not(windows), allow(dead_code))]
fn to_colorref((r, g, b): Rgb) -> u32 {
    u32::from(r) | (u32::from(g) << 8) | (u32::from(b) << 16)
}

/// Whether a background is dark enough to want light caption-button glyphs
/// (relative luminance below the midpoint).
#[cfg_attr(not(windows), allow(dead_code))]
fn is_dark((r, g, b): Rgb) -> bool {
    let lum = 0.2126 * f64::from(r) + 0.7152 * f64::from(g) + 0.0722 * f64::from(b);
    lum < 128.0
}

/// Colour a window's title bar. `None` restores the system default.
///
/// The caption and text colours need Windows 11 (build 22000+). On older
/// Windows the DWM call fails; that is not an error for the user — the title
/// bar simply keeps the system look — so it is only logged. Elsewhere this is
/// a no-op.
pub fn set_title_bar_colors(
    window: &tauri::WebviewWindow,
    background: Option<Rgb>,
    text: Option<Rgb>,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::Graphics::Dwm::{
            DwmSetWindowAttribute, DWMWA_CAPTION_COLOR, DWMWA_TEXT_COLOR, DWMWINDOWATTRIBUTE,
        };

        // The caption buttons (min / max / close) follow the window's
        // light/dark mode, not the text colour, so match it to the background.
        let theme = background.map(|c| {
            if is_dark(c) {
                tauri::Theme::Dark
            } else {
                tauri::Theme::Light
            }
        });
        if let Err(e) = window.set_theme(theme) {
            log::debug!("set_title_bar_colors: set_theme failed: {e}");
        }

        let hwnd = window
            .hwnd()
            .map_err(|e| format!("no window handle: {e}"))?;
        let hwnd = HWND(hwnd.0);
        // DWMWA_COLOR_DEFAULT: hand the colour back to the system.
        const COLOR_DEFAULT: u32 = 0xFFFF_FFFF;
        let set = |attr: DWMWINDOWATTRIBUTE, colour: Option<Rgb>| {
            let value: u32 = colour.map_or(COLOR_DEFAULT, to_colorref);
            // SAFETY: `hwnd` is this live window's handle (just obtained from
            // tauri), and `value` is a u32 on this stack frame that outlives the
            // call; its size is passed exactly as DWM requires for COLORREF.
            let result = unsafe {
                DwmSetWindowAttribute(
                    hwnd,
                    attr,
                    std::ptr::from_ref(&value).cast(),
                    std::mem::size_of::<u32>() as u32,
                )
            };
            if let Err(e) = result {
                log::debug!(
                    "set_title_bar_colors: DwmSetWindowAttribute({}) failed: {e}",
                    attr.0
                );
            }
        };
        set(DWMWA_CAPTION_COLOR, background);
        set(DWMWA_TEXT_COLOR, text);
    }

    #[cfg(not(windows))]
    let _ = (window, background, text);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_hex_rgb_accepts_only_full_hex() {
        assert_eq!(parse_hex_rgb("#252526"), Some((0x25, 0x25, 0x26)));
        assert_eq!(parse_hex_rgb("#FfA0b1"), Some((0xff, 0xa0, 0xb1)));
        assert_eq!(parse_hex_rgb("#fff"), None);
        assert_eq!(parse_hex_rgb("252526"), None);
        assert_eq!(parse_hex_rgb("#25252g"), None);
        assert_eq!(parse_hex_rgb("#2525260"), None);
        assert_eq!(parse_hex_rgb("#é2525"), None);
    }

    #[test]
    fn colorref_is_bgr() {
        assert_eq!(to_colorref((0x11, 0x22, 0x33)), 0x0033_2211);
    }

    #[test]
    fn dark_detection_splits_builtin_themes() {
        assert!(is_dark((0x25, 0x25, 0x26)));
        assert!(is_dark((0x45, 0x45, 0x45)));
        assert!(!is_dark((0xf8, 0xf8, 0xf8)));
    }
}
