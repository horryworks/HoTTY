use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SerialPortInfo {
    pub path: String,
    pub display_name: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FontInfo {
    pub family: String,
}

// ---------------------------------------------------------------------------
// list_serial_ports
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn list_serial_ports() -> Result<Vec<SerialPortInfo>, String> {
    let ports = serialport::available_ports().map_err(|e| {
        log::error!("failed to list serial ports: {e}");
        format!("failed to list serial ports: {e}")
    })?;

    let result: Vec<SerialPortInfo> = ports
        .into_iter()
        .map(|p| SerialPortInfo {
            display_name: p.port_name.clone(),
            path: p.port_name,
        })
        .collect();

    log::info!("listed {} serial ports", result.len());
    Ok(result)
}

// ---------------------------------------------------------------------------
// list_wsl_distributions
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn list_wsl_distributions() -> Result<Vec<String>, String> {
    use tokio::process::Command;

    let output = Command::new("wsl.exe")
        .args(["--list", "--quiet"])
        .output()
        .await
        .map_err(|e| {
            log::error!("failed to run wsl.exe: {e}");
            format!("failed to run wsl.exe: {e}")
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::warn!("wsl --list returned non-zero: {stderr}");
        return Ok(vec![]);
    }

    // wsl.exe outputs UTF-16LE on most Windows builds — sometimes with BOM,
    // sometimes without.  Detect both cases so we don't get garbled output.
    let raw = &output.stdout;
    let text = if raw.len() >= 2 && raw[0] == 0xFF && raw[1] == 0xFE {
        // UTF-16LE with BOM — skip the 2-byte BOM
        let u16s: Vec<u16> = raw[2..]
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        String::from_utf16_lossy(&u16s)
    } else if raw.len() >= 2 && raw.iter().skip(1).step_by(2).any(|&b| b == 0) {
        // UTF-16LE without BOM — heuristic: null bytes at odd positions
        let u16s: Vec<u16> = raw
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        String::from_utf16_lossy(&u16s)
    } else {
        String::from_utf8_lossy(raw).into_owned()
    };

    let distro_re =
        regex_lite::Regex::new(r"^[a-zA-Z0-9_][a-zA-Z0-9_.\-]{0,62}$").expect("valid regex");

    let distros: Vec<String> = text
        .lines()
        .map(|l| l.trim().trim_matches('\0'))
        .filter(|l| !l.is_empty() && distro_re.is_match(l))
        .map(String::from)
        .collect();

    log::info!("found {} WSL distributions", distros.len());
    Ok(distros)
}

// ---------------------------------------------------------------------------
// detect_git_bash
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn detect_git_bash() -> Result<Option<String>, String> {
    use std::path::Path;

    let candidates = [
        r"C:\Program Files\Git\bin\bash.exe",
        r"C:\Program Files (x86)\Git\bin\bash.exe",
    ];

    for c in &candidates {
        if Path::new(c).exists() {
            log::info!("detected git bash at {c}");
            return Ok(Some(c.to_string()));
        }
    }

    // Fallback: search PATH for git.exe, derive bash.exe path
    if let Ok(output) = tokio::process::Command::new("where")
        .arg("git.exe")
        .output()
        .await
    {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if let Some(git_path) = stdout.lines().next() {
                let git_path = git_path.trim();
                // git.exe is usually in Git/cmd/git.exe – bash.exe is in Git/bin/bash.exe
                if let Some(parent) = Path::new(git_path).parent() {
                    if let Some(grandparent) = parent.parent() {
                        let bash_path = grandparent.join("bin").join("bash.exe");
                        if bash_path.exists() {
                            let p = bash_path.to_string_lossy().to_string();
                            log::info!("detected git bash via PATH at {p}");
                            return Ok(Some(p));
                        }
                    }
                }
            }
        }
    }

    log::info!("git bash not found");
    Ok(None)
}

// ---------------------------------------------------------------------------
// list_system_fonts
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn list_system_fonts() -> Result<Vec<FontInfo>, String> {
    #[cfg(windows)]
    {
        use std::collections::BTreeSet;
        use windows::core::PCWSTR;
        use windows::Win32::Foundation::LPARAM;
        use windows::Win32::Graphics::Gdi::{
            CreateDCW, DeleteDC, EnumFontFamiliesExW, DEFAULT_CHARSET, ENUMLOGFONTEXW, HDC,
            LOGFONTW,
        };

        let mut families = BTreeSet::<String>::new();

        unsafe {
            let display: Vec<u16> = "DISPLAY\0".encode_utf16().collect();
            let hdc: HDC = CreateDCW(
                PCWSTR(display.as_ptr()),
                PCWSTR::null(),
                PCWSTR::null(),
                None,
            );
            if hdc.is_invalid() {
                return Err("failed to create device context for font enumeration".into());
            }

            let logfont = LOGFONTW {
                lfCharSet: DEFAULT_CHARSET,
                ..Default::default()
            };

            unsafe extern "system" fn enum_cb(
                lpelfe: *const LOGFONTW,
                _: *const windows::Win32::Graphics::Gdi::TEXTMETRICW,
                _: u32,
                lparam: LPARAM,
            ) -> i32 {
                // Defensive validation: both pointers are supplied by the OS, but
                // guard against a null/misaligned input rather than dereferencing blindly.
                if lpelfe.is_null() || lparam.0 == 0 {
                    return 1;
                }
                let families_ptr = lparam.0 as *mut BTreeSet<String>;
                if (families_ptr as usize) % std::mem::align_of::<BTreeSet<String>>() != 0 {
                    return 1;
                }
                if (lpelfe as usize) % std::mem::align_of::<ENUMLOGFONTEXW>() != 0 {
                    return 1;
                }
                let families = &mut *families_ptr;
                let lf = &*(lpelfe as *const ENUMLOGFONTEXW);
                let name_u16 = &lf.elfLogFont.lfFaceName;
                let len = name_u16
                    .iter()
                    .position(|&c| c == 0)
                    .unwrap_or(name_u16.len());
                let name = String::from_utf16_lossy(&name_u16[..len]);
                if !name.starts_with('@') {
                    families.insert(name);
                }
                1 // continue enumeration
            }

            EnumFontFamiliesExW(
                hdc,
                &logfont,
                Some(enum_cb),
                LPARAM(&mut families as *mut BTreeSet<String> as isize),
                0,
            );

            let _ = DeleteDC(hdc);
        }

        let result: Vec<FontInfo> = families
            .into_iter()
            .map(|family| FontInfo { family })
            .collect();

        log::info!("enumerated {} system fonts", result.len());
        Ok(result)
    }

    #[cfg(not(windows))]
    {
        Ok(vec![])
    }
}

// ---------------------------------------------------------------------------
// focus_window
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn focus_window(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("main window not found")?;
    window
        .set_focus()
        .map_err(|e| format!("failed to focus window: {e}"))
}

// ---------------------------------------------------------------------------
// show_context_menu
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn show_context_menu(
    app: AppHandle,
    items: Vec<ContextMenuItem>,
) -> Result<Option<String>, String> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder};

    let window = app
        .get_webview_window("main")
        .ok_or("main window not found")?;

    let mut builder = MenuBuilder::new(&app);
    for item in &items {
        let mi = MenuItemBuilder::new(&item.label)
            .id(&item.id)
            .enabled(item.enabled.unwrap_or(true))
            .build(&app)
            .map_err(|e| format!("failed to build menu item: {e}"))?;
        builder = builder.item(&mi);
    }
    let menu = builder
        .build()
        .map_err(|e| format!("failed to build context menu: {e}"))?;

    // Use popup to show menu at cursor position. The popup is blocking.
    window
        .popup_menu(&menu)
        .map_err(|e| format!("failed to show context menu: {e}"))?;

    Ok(None)
}

#[derive(serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ContextMenuItem {
    pub id: String,
    pub label: String,
    pub enabled: Option<bool>,
}

// ---------------------------------------------------------------------------
// open_debug_log_folder
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn open_debug_log_folder(app: AppHandle) -> Result<(), String> {
    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("failed to resolve log directory: {e}"))?;

    if !log_dir.exists() {
        std::fs::create_dir_all(&log_dir)
            .map_err(|e| format!("failed to create log directory: {e}"))?;
    }

    #[cfg(windows)]
    {
        tokio::process::Command::new("explorer.exe")
            .arg(log_dir.to_string_lossy().as_ref())
            .spawn()
            .map_err(|e| format!("failed to open log folder: {e}"))?;
    }

    #[cfg(not(windows))]
    {
        tokio::process::Command::new("xdg-open")
            .arg(log_dir.to_string_lossy().as_ref())
            .spawn()
            .map_err(|e| format!("failed to open log folder: {e}"))?;
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// open_external  — open an http(s)/mailto URL in the user's default app
// ---------------------------------------------------------------------------

/// URLs that match one of these prefixes open without a confirm dialog —
/// these are the destinations the app itself wires up (About tab, gcloud
/// install docs, GitHub repo + release pages, GPL license).
const CURATED_URL_PREFIXES: &[&str] = &[
    "https://github.com/",
    "https://cloud.google.com/",
    "https://www.gnu.org/",
    "https://accounts.google.com/",
];

/// Returns `true` if `url` starts with one of the curated prefixes.
/// Matching is case-sensitive on the path (URL paths are case-sensitive)
/// but case-insensitive on the scheme + host portion.
fn is_curated_url(url: &str) -> bool {
    // Find the boundary between authority and path so we can lowercase only
    // the scheme://host portion (RFC 3986: scheme + host are case-insensitive,
    // path is case-sensitive).
    let split_at = url
        .find("://")
        .and_then(|i| url[i + 3..].find('/').map(|p| i + 3 + p))
        .unwrap_or(url.len());
    let (authority, rest) = url.split_at(split_at);
    let normalized = format!("{}{}", authority.to_ascii_lowercase(), rest);
    CURATED_URL_PREFIXES
        .iter()
        .any(|prefix| normalized.starts_with(prefix))
}

/// Returns `true` if the URL has a scheme we are willing to hand to the
/// system opener. Anything else (`file:`, `javascript:`, custom schemes) is
/// rejected outright, with no fallback dialog.
fn is_allowed_scheme(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    lower.starts_with("https://") || lower.starts_with("http://") || lower.starts_with("mailto:")
}

/// Open an external URL in the user's default browser / mail client.
///
/// URLs matching a curated prefix open immediately. Anything else triggers
/// a native confirmation dialog showing the full URL — a compromised
/// renderer can call this command, but it cannot fake the OS-level click,
/// so it cannot silently send the user to attacker-chosen destinations.
#[tauri::command]
pub async fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    if !is_allowed_scheme(&url) {
        return Err(format!("scheme not allowed: {url}"));
    }

    if !is_curated_url(&url) {
        let body = format!("Open this URL in your default browser?\n\n{url}");
        let approved = app
            .dialog()
            .message(body)
            .title("Open external URL")
            .kind(MessageDialogKind::Info)
            .buttons(MessageDialogButtons::OkCancel)
            .blocking_show();
        if !approved {
            return Ok(());
        }
    }

    app.opener()
        .open_url(&url, None::<&str>)
        .map_err(|e| format!("failed to open url: {e}"))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serial_port_info_serializes() {
        let info = SerialPortInfo {
            path: "COM3".to_string(),
            display_name: "COM3".to_string(),
        };
        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(json["path"], "COM3");
        assert_eq!(json["displayName"], "COM3");
    }

    #[test]
    fn curated_urls_match() {
        assert!(is_curated_url("https://github.com/horryworks/HoTTY"));
        assert!(is_curated_url(
            "https://github.com/horryworks/HoTTY/releases/download/v2.0.0/HoTTY.exe"
        ));
        assert!(is_curated_url("https://cloud.google.com/sdk/docs/install"));
        assert!(is_curated_url("https://www.gnu.org/licenses/gpl-3.0.html"));
        assert!(is_curated_url(
            "https://accounts.google.com/o/oauth2/v2/auth"
        ));
    }

    #[test]
    fn curated_urls_are_case_insensitive_on_host() {
        assert!(is_curated_url("https://GITHUB.com/horryworks/HoTTY"));
        assert!(is_curated_url("HTTPS://github.com/horryworks/HoTTY"));
    }

    #[test]
    fn non_curated_urls_do_not_match() {
        assert!(!is_curated_url("https://example.com/"));
        assert!(!is_curated_url("https://github.com.evil.example/"));
        assert!(!is_curated_url("https://evil.com/?u=https://github.com/"));
        assert!(!is_curated_url("http://github.com/"));
        assert!(!is_curated_url("https://raw.githubusercontent.com/"));
    }

    #[test]
    fn allowed_schemes_match() {
        assert!(is_allowed_scheme("https://example.com"));
        assert!(is_allowed_scheme("HTTP://example.com"));
        assert!(is_allowed_scheme("mailto:user@example.com"));
    }

    #[test]
    fn disallowed_schemes_reject() {
        assert!(!is_allowed_scheme("file:///etc/passwd"));
        assert!(!is_allowed_scheme("javascript:alert(1)"));
        assert!(!is_allowed_scheme("ftp://example.com"));
        assert!(!is_allowed_scheme("data:text/html,<script>"));
        assert!(!is_allowed_scheme(""));
    }

    #[test]
    fn font_info_serializes() {
        let info = FontInfo {
            family: "Consolas".to_string(),
        };
        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(json["family"], "Consolas");
    }

    #[test]
    fn context_menu_item_deserializes() {
        let json = r#"{"id":"copy","label":"Copy","enabled":true}"#;
        let item: ContextMenuItem = serde_json::from_str(json).unwrap();
        assert_eq!(item.id, "copy");
        assert_eq!(item.label, "Copy");
        assert_eq!(item.enabled, Some(true));
    }

    #[test]
    fn context_menu_item_enabled_defaults() {
        let json = r#"{"id":"paste","label":"Paste"}"#;
        let item: ContextMenuItem = serde_json::from_str(json).unwrap();
        assert_eq!(item.enabled, None);
    }

    /// Helper that mirrors the WSL output parsing logic from list_wsl_distributions
    /// so we can test it without spawning wsl.exe.
    fn parse_wsl_output(raw: &[u8]) -> Vec<String> {
        let text = if raw.len() >= 2 && raw[0] == 0xFF && raw[1] == 0xFE {
            let u16s: Vec<u16> = raw[2..]
                .chunks_exact(2)
                .map(|c| u16::from_le_bytes([c[0], c[1]]))
                .collect();
            String::from_utf16_lossy(&u16s)
        } else if raw.len() >= 2 && raw.iter().skip(1).step_by(2).any(|&b| b == 0) {
            let u16s: Vec<u16> = raw
                .chunks_exact(2)
                .map(|c| u16::from_le_bytes([c[0], c[1]]))
                .collect();
            String::from_utf16_lossy(&u16s)
        } else {
            String::from_utf8_lossy(raw).into_owned()
        };

        let distro_re =
            regex_lite::Regex::new(r"^[a-zA-Z0-9_][a-zA-Z0-9_.\-]{0,62}$").expect("valid regex");

        text.lines()
            .map(|l| l.trim().trim_matches('\0'))
            .filter(|l| !l.is_empty() && distro_re.is_match(l))
            .map(String::from)
            .collect()
    }

    #[test]
    fn wsl_parse_utf16le_with_bom() {
        // UTF-16LE BOM + "Ubuntu\r\nDebian\r\n"
        let mut raw: Vec<u8> = vec![0xFF, 0xFE];
        for c in "Ubuntu\r\nDebian\r\n".encode_utf16() {
            raw.extend_from_slice(&c.to_le_bytes());
        }
        let distros = parse_wsl_output(&raw);
        assert_eq!(distros, vec!["Ubuntu", "Debian"]);
    }

    #[test]
    fn wsl_parse_utf16le_without_bom() {
        // UTF-16LE WITHOUT BOM — this is the case that was broken
        let mut raw: Vec<u8> = Vec::new();
        for c in "Ubuntu\r\nDebian\r\n".encode_utf16() {
            raw.extend_from_slice(&c.to_le_bytes());
        }
        let distros = parse_wsl_output(&raw);
        assert_eq!(distros, vec!["Ubuntu", "Debian"]);
    }

    #[test]
    fn wsl_parse_plain_utf8() {
        let raw = b"Ubuntu\nDebian\n";
        let distros = parse_wsl_output(raw);
        assert_eq!(distros, vec!["Ubuntu", "Debian"]);
    }

    #[test]
    fn wsl_parse_empty_output() {
        let distros = parse_wsl_output(b"");
        assert!(distros.is_empty());
    }
}
