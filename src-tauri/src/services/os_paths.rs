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
