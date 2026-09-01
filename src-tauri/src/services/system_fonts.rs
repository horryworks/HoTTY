//! System font-family enumeration, confined to a single module.
//!
//! Per the architecture Non-goal on cross-platform support, OS-specific API use
//! (here the Win32 GDI font enumeration) must be **isolated** in one swappable
//! module rather than living inside a Tauri command handler. When Mac/Linux
//! support lands, `enumerate_families` is the single place to add a backend —
//! the command in `commands/system.rs` stays untouched.
//!
//! This mirrors `os_paths.rs` and `dpapi.rs`: the `#[cfg(...)]` split lives
//! inside the module, and the pure post-processing (`is_listable_family`) is
//! platform-independent and unit-tested on every target.

use std::collections::BTreeSet;

/// Whether a font family reported by the OS should be offered to the user.
///
/// Windows exposes vertical-writing variants of CJK fonts under an `@`-prefixed
/// alias (`@MS Gothic`). They are the same family rotated for vertical layout,
/// which a terminal never uses, so listing them only doubles the picker. Empty
/// names are rejected defensively — the enumeration callback derives the name
/// from a fixed-size OS buffer, so a zero-length face name means the entry was
/// not populated.
pub fn is_listable_family(name: &str) -> bool {
    !name.is_empty() && !name.starts_with('@')
}

/// Enumerate the installed font families, sorted and de-duplicated.
///
/// Returns an empty list on platforms without a backend rather than an error:
/// the font picker degrades to the theme default, which is a working UI.
pub fn enumerate_families() -> Result<Vec<String>, String> {
    #[cfg(windows)]
    {
        windows_impl::enumerate()
    }

    #[cfg(not(windows))]
    {
        Ok(Vec::new())
    }
}

#[cfg(windows)]
mod windows_impl {
    use super::{is_listable_family, BTreeSet};
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::LPARAM;
    use windows::Win32::Graphics::Gdi::{
        CreateDCW, DeleteDC, EnumFontFamiliesExW, DEFAULT_CHARSET, ENUMLOGFONTEXW, HDC, LOGFONTW,
        TEXTMETRICW,
    };

    /// GDI enumeration callback. Invoked by `EnumFontFamiliesExW` once per face.
    ///
    /// # Safety
    /// Called by the OS with a `LOGFONTW` pointer that is really an
    /// `ENUMLOGFONTEXW`, and the `lparam` we handed to `EnumFontFamiliesExW`.
    /// Both are validated (null + alignment) before being dereferenced, and the
    /// `BTreeSet` behind `lparam` outlives the enumeration call because it is a
    /// local of `enumerate` that stays borrowed for the whole call.
    unsafe extern "system" fn enum_cb(
        lpelfe: *const LOGFONTW,
        _: *const TEXTMETRICW,
        _: u32,
        lparam: LPARAM,
    ) -> i32 {
        // Defensive validation: both pointers are supplied by the OS, but
        // guard against a null/misaligned input rather than dereferencing blindly.
        if lpelfe.is_null() || lparam.0 == 0 {
            return 1;
        }
        let families_ptr = lparam.0 as *mut BTreeSet<String>;
        if !(families_ptr as usize).is_multiple_of(std::mem::align_of::<BTreeSet<String>>()) {
            return 1;
        }
        if !(lpelfe as usize).is_multiple_of(std::mem::align_of::<ENUMLOGFONTEXW>()) {
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
        if is_listable_family(&name) {
            families.insert(name);
        }
        1 // continue enumeration
    }

    pub fn enumerate() -> Result<Vec<String>, String> {
        let mut families = BTreeSet::<String>::new();

        // SAFETY: `CreateDCW` is checked for an invalid handle before use, the
        // `LOGFONTW` is fully initialized, and `DeleteDC` releases the DC on
        // every path out of the block (no early return between create and
        // delete). `enum_cb` documents its own pointer contract.
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

            EnumFontFamiliesExW(
                hdc,
                &logfont,
                Some(enum_cb),
                LPARAM(&mut families as *mut BTreeSet<String> as isize),
                0,
            );

            let _ = DeleteDC(hdc);
        }

        Ok(families.into_iter().collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_vertical_writing_aliases() {
        // Windows lists CJK fonts twice: once normally, once under an `@` alias
        // for vertical layout. A terminal never renders vertically.
        assert!(!is_listable_family("@MS Gothic"));
        assert!(!is_listable_family("@Yu Mincho"));
    }

    #[test]
    fn rejects_empty_names() {
        assert!(!is_listable_family(""));
    }

    #[test]
    fn accepts_ordinary_families() {
        assert!(is_listable_family("Cascadia Mono"));
        assert!(is_listable_family("MS Gothic"));
        // An `@` that is not leading is a real character in the family name.
        assert!(is_listable_family("Foo@Bar"));
    }

    #[test]
    fn enumerate_families_never_errors_off_windows() {
        // On Windows this really enumerates; the assertion is only that the
        // call succeeds and returns sorted, de-duplicated names.
        let families = enumerate_families().expect("font enumeration must not fail");
        let mut sorted = families.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(families, sorted);
        assert!(families.iter().all(|f| is_listable_family(f)));
    }
}
