use std::fmt::Write as _;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::services::atomic_file::atomic_write;

/// Serializes the read-modify-write in `upsert_known_host` across all windows
/// (single process). `atomic_write` prevents a torn file but NOT a lost update:
/// two concurrent upserts would each read the pre-image and the later rename
/// would silently drop the earlier window's just-recorded key. This lock makes
/// each upsert atomic end-to-end.
static UPSERT_LOCK: Mutex<()> = Mutex::new(());

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
    // A same-key-type record with a different key is the classic "host key
    // changed" case. A record for this host under a *different* key type is just
    // as security-relevant: an active MITM who cannot forge the recorded key can
    // offer a key of a type we have no record of — if that were treated as a new
    // host it would downgrade the alarming "changed" prompt to the benign "new
    // host" one. Surface both as Mismatch, preferring a same-type record for the
    // reported `recorded_base64`. (A legitimate key-type rotation therefore shows
    // the "changed" prompt, which is the safe direction — the user re-verifies.)
    let mut mismatch_same_type: Option<String> = None;
    let mut mismatch_other_type: Option<String> = None;

    for line in reader.lines() {
        let line = line?;
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let mut parts = trimmed.split_whitespace();
        let (Some(pattern), Some(ty), Some(b64)) = (parts.next(), parts.next(), parts.next())
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
        if ty == key_type {
            if b64 == key_base64 {
                return Ok(HostKeyCheck::Match);
            }
            // Same host and key type, different key — the classic changed-key case.
            if mismatch_same_type.is_none() {
                mismatch_same_type = Some(b64.to_string());
            }
        } else if mismatch_other_type.is_none() {
            // Host is on record, but only under a different key type.
            mismatch_other_type = Some(b64.to_string());
        }
    }

    match mismatch_same_type.or(mismatch_other_type) {
        Some(recorded) => Ok(HostKeyCheck::Mismatch {
            recorded_base64: recorded,
        }),
        None => Ok(HostKeyCheck::New),
    }
}

/// Atomically record `key_base64` as the key for (host, port, key_type).
///
/// Drops any existing record for that (host, port, key_type) and writes the new
/// one in a single rewrite — rather than a remove-then-append sequence, which
/// would briefly leave the host entirely absent from the file (a concurrent
/// connection landing in that window would see the host as `New` and re-prompt).
/// Works for both the new-host case (nothing to drop) and the changed-key case.
pub fn upsert_known_host(
    path: &Path,
    host: &str,
    port: u16,
    key_type: &str,
    key_base64: &str,
) -> std::io::Result<()> {
    // Hold the write lock for the entire read→modify→write so a concurrent
    // upsert from another window can't lose this key (see UPSERT_LOCK).
    let _guard = UPSERT_LOCK.lock().unwrap_or_else(|e| e.into_inner());

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let host_matches: Vec<String> = host_patterns(host, port);

    let mut kept: Vec<String> = Vec::new();
    if path.exists() {
        let f = File::open(path)?;
        let reader = BufReader::new(f);
        for line in reader.lines() {
            let line = line?;
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                kept.push(line);
                continue;
            }
            let mut parts = trimmed.split_whitespace();
            let (Some(pattern), Some(ty), Some(_b64)) = (parts.next(), parts.next(), parts.next())
            else {
                kept.push(line);
                continue;
            };
            let pattern_hosts: Vec<&str> = pattern.split(',').collect();
            let host_match = pattern_hosts
                .iter()
                .any(|p| host_matches.iter().any(|h| h == p));
            if host_match && ty == key_type {
                continue; // drop the superseded record
            }
            kept.push(line);
        }
    }

    let pattern = if port == 22 {
        host.to_string()
    } else {
        format!("[{host}]:{port}")
    };

    // Build the full file content, then write it atomically. The previous
    // in-place File::create truncated the file first, so a crash mid-write (or a
    // concurrent write from another window) could corrupt known_hosts and break
    // host-key verification. atomic_write swaps a temp file in via rename.
    let mut content = String::new();
    for line in kept {
        let _ = writeln!(content, "{line}");
    }
    let _ = writeln!(content, "{pattern} {key_type} {key_base64}");
    atomic_write(path, content.as_bytes())?;
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
        upsert_known_host(&p, "example.com", 22, "ssh-ed25519", "AAAAKEY").unwrap();
        let r = check_known_host(&p, "example.com", 22, "ssh-ed25519", "AAAAKEY").unwrap();
        assert_eq!(r, HostKeyCheck::Match);
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn detects_mismatch() {
        let p = temp_file();
        upsert_known_host(&p, "example.com", 22, "ssh-ed25519", "OLDKEY").unwrap();
        let r = check_known_host(&p, "example.com", 22, "ssh-ed25519", "NEWKEY").unwrap();
        assert!(matches!(r, HostKeyCheck::Mismatch { .. }));
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn different_key_type_for_known_host_is_mismatch_not_new() {
        // An active MITM offering a key of a type we have no record of must not
        // be downgraded to the benign "new host" prompt — the host is already
        // known, just under another key type, so this is a "changed" situation.
        let p = temp_file();
        upsert_known_host(&p, "example.com", 22, "ssh-rsa", "RSAKEY").unwrap();
        let r = check_known_host(&p, "example.com", 22, "ssh-ed25519", "ED25519KEY").unwrap();
        assert!(
            matches!(r, HostKeyCheck::Mismatch { .. }),
            "host known under a different key type must be a mismatch, got {r:?}"
        );
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn genuinely_unknown_host_is_still_new() {
        // The downgrade fix must not turn every unknown host into a mismatch:
        // a host with no record at all is still New.
        let p = temp_file();
        upsert_known_host(&p, "known.com", 22, "ssh-ed25519", "KEY").unwrap();
        let r = check_known_host(&p, "stranger.com", 22, "ssh-ed25519", "KEY2").unwrap();
        assert_eq!(r, HostKeyCheck::New);
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn same_type_mismatch_is_preferred_over_other_type() {
        // With both a same-type changed key and an other-type record on file,
        // the reported recorded key is the same-type one.
        let p = temp_file();
        {
            let mut f = File::create(&p).unwrap();
            writeln!(f, "example.com ssh-rsa OTHERTYPE").unwrap();
            writeln!(f, "example.com ssh-ed25519 SAMETYPE_OLD").unwrap();
        }
        let r = check_known_host(&p, "example.com", 22, "ssh-ed25519", "SAMETYPE_NEW").unwrap();
        assert_eq!(
            r,
            HostKeyCheck::Mismatch {
                recorded_base64: "SAMETYPE_OLD".to_string()
            }
        );
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn non_default_port_uses_bracket_form() {
        let p = temp_file();
        upsert_known_host(&p, "example.com", 2222, "ssh-rsa", "KEY").unwrap();
        let contents = std::fs::read_to_string(&p).unwrap();
        assert!(contents.contains("[example.com]:2222"));
        let r = check_known_host(&p, "example.com", 2222, "ssh-rsa", "KEY").unwrap();
        assert_eq!(r, HostKeyCheck::Match);
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn upsert_replaces_mismatched_key_in_one_pass() {
        let p = temp_file();
        upsert_known_host(&p, "example.com", 22, "ssh-ed25519", "OLDKEY").unwrap();
        // Sanity: the old key is currently recorded as a mismatch for NEWKEY.
        let before = check_known_host(&p, "example.com", 22, "ssh-ed25519", "NEWKEY").unwrap();
        assert!(matches!(before, HostKeyCheck::Mismatch { .. }));

        upsert_known_host(&p, "example.com", 22, "ssh-ed25519", "NEWKEY").unwrap();

        // The new key matches and the old key is gone — never both, never neither.
        let after = check_known_host(&p, "example.com", 22, "ssh-ed25519", "NEWKEY").unwrap();
        assert_eq!(after, HostKeyCheck::Match);
        let contents = std::fs::read_to_string(&p).unwrap();
        assert!(contents.contains("NEWKEY"));
        assert!(!contents.contains("OLDKEY"));
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn upsert_appends_new_host_and_preserves_others() {
        let p = temp_file();
        upsert_known_host(&p, "other.com", 22, "ssh-ed25519", "KEEP").unwrap();
        upsert_known_host(&p, "example.com", 22, "ssh-rsa", "ADDED").unwrap();

        let contents = std::fs::read_to_string(&p).unwrap();
        assert!(
            contents.contains("KEEP"),
            "unrelated record must be preserved"
        );
        assert!(contents.contains("ADDED"));
        assert_eq!(
            check_known_host(&p, "example.com", 22, "ssh-rsa", "ADDED").unwrap(),
            HostKeyCheck::Match
        );
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
