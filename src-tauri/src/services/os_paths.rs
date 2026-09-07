//! OS-specific filesystem path resolution, confined to a single module.
//!
//! Per the architecture Non-goal on cross-platform support, Windows-specific
//! path conventions (e.g. `%APPDATA%\gcloud`) must be **isolated** in one
//! swappable module rather than scattered across the codebase. When Mac/Linux
//! support lands, the per-OS branches here are the single place to adjust.
//!
//! The public resolvers delegate to small, pure `#[cfg(...)]` helpers that take
//! the environment values as arguments, so the platform logic is unit-testable
//! without mutating process-wide environment variables.

use std::path::PathBuf;

/// Win32 `CREATE_NO_WINDOW` — suppresses the console window a child process
/// would otherwise flash on screen.
///
/// Declared once here rather than re-derived at each call site: it was spelled
/// out in six modules, in two different notations, which is exactly the kind of
/// scattered OS detail the Non-goal on cross-platform support rules out. Only
/// meaningful on Windows, so callers keep their `#[cfg(windows)]` guard.
#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// The current user's home directory.
///
/// - **Windows:** `%USERPROFILE%`, falling back to `%HOME%` (set by Git Bash
///   and other POSIX-ish shells).
/// - **Other:** `$HOME`, falling back to `%USERPROFILE%`.
///
/// One resolver rather than three: `path_safety`, `gcloud_iap` and `local`
/// each had their own, and `local`'s read `USERPROFILE` with no fallback at
/// all — which would silently do nothing off Windows.
pub fn home_dir() -> Option<PathBuf> {
    home_dir_from(
        std::env::var_os("USERPROFILE").map(PathBuf::from),
        std::env::var_os("HOME").map(PathBuf::from),
    )
}

/// The preference order, taking both values as arguments so it is testable
/// without mutating process-wide environment variables.
fn home_dir_from(userprofile: Option<PathBuf>, home: Option<PathBuf>) -> Option<PathBuf> {
    #[cfg(windows)]
    {
        userprofile.or(home)
    }
    #[cfg(not(windows))]
    {
        home.or(userprofile)
    }
}

/// Directory where the gcloud CLI stores its configuration, including the
/// Application Default Credentials file (`application_default_credentials.json`).
///
/// - **Windows:** `%APPDATA%\gcloud`, falling back to
///   `%USERPROFILE%\AppData\Roaming\gcloud` when `APPDATA` is unset — matching
///   gcloud's own layout under Roaming AppData.
/// - **Other:** `~/.config/gcloud` (gcloud's default on Unix). An unset `HOME`
///   degrades to a relative `.config/gcloud`.
pub fn gcloud_config_dir() -> PathBuf {
    #[cfg(windows)]
    {
        windows_gcloud_config_dir(
            std::env::var("APPDATA").ok(),
            std::env::var("USERPROFILE").ok(),
        )
    }
    #[cfg(not(windows))]
    {
        unix_gcloud_config_dir(std::env::var("HOME").ok())
    }
}

/// Windows resolution of the gcloud config directory. Prefers `%APPDATA%`;
/// otherwise reconstructs the Roaming-AppData path from `%USERPROFILE%`.
/// Behavior is byte-identical to the previous inline implementation.
#[cfg(windows)]
fn windows_gcloud_config_dir(appdata: Option<String>, userprofile: Option<String>) -> PathBuf {
    let base = appdata.unwrap_or_else(|| {
        let home = userprofile.unwrap_or_default();
        format!("{home}\\AppData\\Roaming")
    });
    PathBuf::from(base).join("gcloud")
}

/// Unix resolution of the gcloud config directory: `$HOME/.config/gcloud`.
#[cfg(not(windows))]
fn unix_gcloud_config_dir(home: Option<String>) -> PathBuf {
    let home = home.unwrap_or_default();
    PathBuf::from(home).join(".config").join("gcloud")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn home_dir_prefers_the_platform_native_variable() {
        let up = PathBuf::from(r"C:Usersme");
        let home = PathBuf::from("/home/me");
        let picked = home_dir_from(Some(up.clone()), Some(home.clone()));
        #[cfg(windows)]
        assert_eq!(picked, Some(up));
        #[cfg(not(windows))]
        assert_eq!(picked, Some(home));
    }

    #[test]
    fn home_dir_falls_back_to_the_other_variable() {
        // Git Bash sets HOME but not USERPROFILE for some shells, and the
        // reverse holds on a Unix box running under a compatibility layer.
        assert_eq!(
            home_dir_from(None, Some(PathBuf::from("/home/me"))),
            Some(PathBuf::from("/home/me"))
        );
        assert_eq!(
            home_dir_from(Some(PathBuf::from("/u/me")), None),
            Some(PathBuf::from("/u/me"))
        );
    }

    #[test]
    fn home_dir_is_none_when_neither_is_set() {
        assert_eq!(home_dir_from(None, None), None);
    }

    #[test]
    fn gcloud_config_dir_ends_with_gcloud() {
        let dir = gcloud_config_dir();
        assert_eq!(dir.file_name().and_then(|s| s.to_str()), Some("gcloud"));
    }

    #[cfg(windows)]
    #[test]
    fn windows_uses_appdata_when_set() {
        let p = windows_gcloud_config_dir(Some(r"C:\Users\me\AppData\Roaming".into()), None);
        assert_eq!(p, PathBuf::from(r"C:\Users\me\AppData\Roaming\gcloud"));
    }

    #[cfg(windows)]
    #[test]
    fn windows_falls_back_to_userprofile_roaming() {
        let p = windows_gcloud_config_dir(None, Some(r"C:\Users\me".into()));
        assert_eq!(p, PathBuf::from(r"C:\Users\me\AppData\Roaming\gcloud"));
    }

    #[cfg(windows)]
    #[test]
    fn windows_empty_env_matches_legacy_shape() {
        // Both env vars unset → "\AppData\Roaming\gcloud" (the exact prior
        // fallback shape). Guards against a behavior drift from the extraction.
        let p = windows_gcloud_config_dir(None, None);
        assert_eq!(p, PathBuf::from(r"\AppData\Roaming\gcloud"));
    }

    #[cfg(not(windows))]
    #[test]
    fn unix_uses_dot_config_gcloud() {
        let p = unix_gcloud_config_dir(Some("/home/me".into()));
        assert_eq!(p, PathBuf::from("/home/me/.config/gcloud"));
    }
}
