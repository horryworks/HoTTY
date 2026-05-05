use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostKeyCheck {
    /// Host is present and key matches.
    Match,
    /// Host has a different key on record — possible MITM.
    Mismatch { recorded_base64: String },
    /// Host is not in the file.
    New,
}

/// Consult a known_hosts file (OpenSSH format).
///
/// A record is `<host-pattern> <keytype> <base64>` separated by whitespace. Multiple
/// hostnames may be comma-separated. Lines starting with `#` and blank lines are ignored.
pub fn check_known_host(
    path: &Path,
    host: &str,
    port: u16,
    key_type: &str,
    key_base64: &str,
) -> std::io::Result<HostKeyCheck> {
    if !path.exists() {
        return Ok(HostKeyCheck::New);
    }
    let f = File::open(path)?;
    let reader = BufReader::new(f);
    let host_matches: Vec<String> = host_patterns(host, port);
    let mut mismatch: Option<String> = None;

    for line in reader.lines() {
        let line = line?;
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let mut parts = trimmed.split_whitespace();
        let (Some(pattern), Some(ty), Some(b64)) =
            (parts.next(), parts.next(), parts.next())
        else {
            continue;
        };
        let pattern_hosts: Vec<&str> = pattern.split(',').collect();
        let host_match = pattern_hosts
            .iter()
            .any(|p| host_matches.iter().any(|h| h == p));
        if !host_match {
            continue;
        }
        if ty == key_type && b64 == key_base64 {
            return Ok(HostKeyCheck::Match);
        }
        // Same host, different key — remember first mismatch in case no later match shows up.
        if ty == key_type && mismatch.is_none() {
            mismatch = Some(b64.to_string());
        }
    }

    if let Some(recorded) = mismatch {
        Ok(HostKeyCheck::Mismatch {
            recorded_base64: recorded,
        })
    } else {
        Ok(HostKeyCheck::New)
    }
}

pub fn append_known_host(
    path: &Path,
    host: &str,
    port: u16,
    key_type: &str,
    key_base64: &str,
) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut f = OpenOptions::new().create(true).append(true).open(path)?;
    let pattern = if port == 22 {
        host.to_string()
    } else {
        format!("[{host}]:{port}")
    };
    writeln!(f, "{pattern} {key_type} {key_base64}")?;
    Ok(())
}

/// Remove any existing record for (host, port) with the given key type.
/// Used when replacing a mismatched key after the user has accepted the new one.
pub fn remove_known_host(
    path: &Path,
    host: &str,
    port: u16,
    key_type: &str,
) -> std::io::Result<()> {
    if !path.exists() {
        return Ok(());
    }
    let f = File::open(path)?;
    let reader = BufReader::new(f);
    let host_matches: Vec<String> = host_patterns(host, port);

    let mut kept: Vec<String> = Vec::new();
    for line in reader.lines() {
        let line = line?;
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            kept.push(line);
            continue;
        }
        let mut parts = trimmed.split_whitespace();
        let (Some(pattern), Some(ty), Some(_b64)) =
            (parts.next(), parts.next(), parts.next())
        else {
            kept.push(line);
            continue;
        };
        let pattern_hosts: Vec<&str> = pattern.split(',').collect();
        let host_match = pattern_hosts
            .iter()
            .any(|p| host_matches.iter().any(|h| h == p));
        if host_match && ty == key_type {
            continue; // drop
        }
        kept.push(line);
    }

    let mut f = File::create(path)?;
    for line in kept {
        writeln!(f, "{line}")?;
    }
    Ok(())
}

fn host_patterns(host: &str, port: u16) -> Vec<String> {
    if port == 22 {
        vec![host.to_string()]
    } else {
        vec![format!("[{host}]:{port}")]
    }
}

pub fn default_known_hosts_path(app_config_dir: &Path) -> PathBuf {
    app_config_dir.join("known_hosts")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn temp_file() -> PathBuf {
        let mut p = std::env::temp_dir();
        let id = format!(
            "hotty_kh_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        p.push(id);
        p
    }

    #[test]
    fn check_new_when_file_missing() {
        let p = temp_file();
        let r = check_known_host(&p, "example.com", 22, "ssh-ed25519", "AAAA").unwrap();
        assert_eq!(r, HostKeyCheck::New);
    }

    #[test]
    fn append_and_check_match() {
        let p = temp_file();
        append_known_host(&p, "example.com", 22, "ssh-ed25519", "AAAAKEY").unwrap();
        let r = check_known_host(&p, "example.com", 22, "ssh-ed25519", "AAAAKEY").unwrap();
        assert_eq!(r, HostKeyCheck::Match);
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn detects_mismatch() {
        let p = temp_file();
        append_known_host(&p, "example.com", 22, "ssh-ed25519", "OLDKEY").unwrap();
        let r = check_known_host(&p, "example.com", 22, "ssh-ed25519", "NEWKEY").unwrap();
        assert!(matches!(r, HostKeyCheck::Mismatch { .. }));
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn non_default_port_uses_bracket_form() {
        let p = temp_file();
        append_known_host(&p, "example.com", 2222, "ssh-rsa", "KEY").unwrap();
        let contents = std::fs::read_to_string(&p).unwrap();
        assert!(contents.contains("[example.com]:2222"));
        let r = check_known_host(&p, "example.com", 2222, "ssh-rsa", "KEY").unwrap();
        assert_eq!(r, HostKeyCheck::Match);
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn remove_drops_matching_records_only() {
        let p = temp_file();
        // Pre-populate with mixed records.
        {
            let mut f = File::create(&p).unwrap();
            writeln!(f, "# comment").unwrap();
            writeln!(f, "example.com ssh-ed25519 KEY1").unwrap();
            writeln!(f, "other.com ssh-ed25519 KEY2").unwrap();
        }
        remove_known_host(&p, "example.com", 22, "ssh-ed25519").unwrap();
        let contents = std::fs::read_to_string(&p).unwrap();
        assert!(contents.contains("other.com"));
        assert!(!contents.contains("KEY1"));
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn comma_separated_hosts_matches() {
        let p = temp_file();
        {
            let mut f = File::create(&p).unwrap();
            writeln!(f, "a.com,b.com ssh-rsa KEYX").unwrap();
        }
        let r = check_known_host(&p, "b.com", 22, "ssh-rsa", "KEYX").unwrap();
        assert_eq!(r, HostKeyCheck::Match);
        let _ = std::fs::remove_file(&p);
    }

    /// I/O errors must surface as Err rather than collapsing into Ok(New) —
    /// the SSH handler relies on this distinction to refuse connections when
    /// the known_hosts file cannot be read (e.g. permission denied).
    /// We provoke an error by passing a directory path where a file is expected.
    #[test]
    fn io_error_surfaces_as_err_not_new() {
        let mut dir = std::env::temp_dir();
        dir.push(format!(
            "hotty_kh_dir_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let r = check_known_host(&dir, "example.com", 22, "ssh-ed25519", "AAAA");
        assert!(r.is_err(), "opening a directory should be an I/O error");
        let _ = std::fs::remove_dir(&dir);
    }
}
