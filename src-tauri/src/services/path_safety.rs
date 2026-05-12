use std::path::Path;

#[cfg(windows)]
const BLOCKED_DIR_SUFFIXES: &[&str] = &[
    r"\windows\system32",
    r"\windows\syswow64",
    r"\programdata\ssh",
];

#[cfg(windows)]
const BLOCKED_HOME_DIRS: &[&str] = &[
    // SSH / GPG / cloud credential stores
    ".ssh",
    ".gnupg",
    ".aws",
    ".azure",
    r".config\gcloud",
    // Windows credential stores
    r"appdata\roaming\microsoft\credentials",
    r"appdata\local\microsoft\credentials",
    r"appdata\local\microsoft\vault",
    // GCP application default credentials
    r"appdata\roaming\gcloud",
    // HoTTY's own app data dir (DPAPI-encrypted tokens, htree exports,
    // approved_log_dirs.json, vertexai_config.json, etc.) — must never
    // be tampered with via the editor / dropped-file approval flows.
    r"appdata\roaming\com.hotty.terminal",
    r"appdata\local\com.hotty.terminal",
];

#[cfg(not(windows))]
const BLOCKED_HOME_DIRS_UNIX: &[&str] = &[
    ".ssh",
    ".gnupg",
    ".aws",
    ".azure",
    ".config/gcloud",
];

pub fn is_sensitive_path(resolved: &Path) -> bool {
    #[cfg(windows)]
    {
        let raw = resolved
            .to_string_lossy()
            .to_lowercase()
            .replace('/', "\\");
        // canonicalize() on Windows returns `\\?\C:\...` (verbatim prefix);
        // strip it so prefix-based comparisons against ordinary paths match.
        let lower = raw
            .strip_prefix(r"\\?\")
            .map(str::to_string)
            .unwrap_or(raw);

        for suffix in BLOCKED_DIR_SUFFIXES {
            if lower.contains(suffix) {
                return true;
            }
        }

        if let Some(home) = dirs_home() {
            let home_raw = home.to_lowercase().replace('/', "\\");
            let home_lower = home_raw
                .strip_prefix(r"\\?\")
                .map(str::to_string)
                .unwrap_or(home_raw);
            for dir in BLOCKED_HOME_DIRS {
                let blocked = format!("{}\\{}", home_lower, dir);
                if lower.starts_with(&blocked) {
                    return true;
                }
            }
        }

        false
    }

    #[cfg(not(windows))]
    {
        if let Some(home) = dirs_home() {
            let lower = resolved.to_string_lossy().to_lowercase();
            let home_lower = home.to_lowercase();
            for dir in BLOCKED_HOME_DIRS_UNIX {
                let blocked_path = format!("{}/{}", home_lower, dir);
                if lower.starts_with(&blocked_path) {
                    return true;
                }
            }
        }
        let _ = resolved;
        false
    }
}

pub fn dirs_home() -> Option<String> {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[cfg(windows)]
    #[test]
    fn is_sensitive_path_blocks_system32() {
        let p = Path::new(r"C:\Windows\System32\config\SAM");
        assert!(is_sensitive_path(p));
    }

    #[cfg(windows)]
    #[test]
    fn is_sensitive_path_handles_verbatim_prefix() {
        // canonicalize() on Windows returns paths with a \\?\ prefix; the
        // check must still match against an ordinary blocked path.
        if let Some(home) = dirs_home() {
            let verbatim =
                PathBuf::from(format!(r"\\?\{}", home)).join(".ssh").join("id_rsa");
            assert!(is_sensitive_path(&verbatim));
        }
    }

    #[cfg(windows)]
    #[test]
    fn is_sensitive_path_allows_normal() {
        let p = Path::new(r"C:\Users\Public\test.txt");
        assert!(!is_sensitive_path(p));
    }

    #[test]
    fn is_sensitive_path_blocks_ssh_dir() {
        if let Some(home) = dirs_home() {
            let ssh_path = PathBuf::from(&home).join(".ssh").join("id_rsa");
            assert!(is_sensitive_path(&ssh_path));
        }
    }

    #[test]
    fn is_sensitive_path_blocks_gnupg_dir() {
        if let Some(home) = dirs_home() {
            let gnupg_path = PathBuf::from(&home).join(".gnupg").join("pubring.kbx");
            assert!(is_sensitive_path(&gnupg_path));
        }
    }

    #[test]
    fn is_sensitive_path_blocks_aws_credentials() {
        if let Some(home) = dirs_home() {
            let p = PathBuf::from(&home).join(".aws").join("credentials");
            assert!(is_sensitive_path(&p));
        }
    }

    #[test]
    fn is_sensitive_path_blocks_azure_dir() {
        if let Some(home) = dirs_home() {
            let p = PathBuf::from(&home).join(".azure").join("config");
            assert!(is_sensitive_path(&p));
        }
    }

    #[cfg(windows)]
    #[test]
    fn is_sensitive_path_blocks_appdata_gcloud() {
        if let Some(home) = dirs_home() {
            let p = PathBuf::from(&home)
                .join("AppData")
                .join("Roaming")
                .join("gcloud")
                .join("application_default_credentials.json");
            assert!(is_sensitive_path(&p));
        }
    }

    #[cfg(windows)]
    #[test]
    fn is_sensitive_path_blocks_hotty_appdata_roaming() {
        if let Some(home) = dirs_home() {
            let p = PathBuf::from(&home)
                .join("AppData")
                .join("Roaming")
                .join("com.hotty.terminal")
                .join("vertexai_config.json");
            assert!(is_sensitive_path(&p));
        }
    }

    #[cfg(windows)]
    #[test]
    fn is_sensitive_path_blocks_hotty_appdata_local() {
        if let Some(home) = dirs_home() {
            let p = PathBuf::from(&home)
                .join("AppData")
                .join("Local")
                .join("com.hotty.terminal")
                .join("approved_log_dirs.json");
            assert!(is_sensitive_path(&p));
        }
    }

    #[cfg(windows)]
    #[test]
    fn is_sensitive_path_blocks_credential_vault() {
        if let Some(home) = dirs_home() {
            let p = PathBuf::from(&home)
                .join("AppData")
                .join("Local")
                .join("Microsoft")
                .join("Vault")
                .join("anything.bin");
            assert!(is_sensitive_path(&p));
        }
    }

    #[test]
    fn dirs_home_returns_some() {
        assert!(dirs_home().is_some());
    }
}
