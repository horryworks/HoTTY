//! Locate an external executable by checking well-known install paths first,
//! then scanning `PATH`.
//!
//! Replaces three hand-rolled copies (gcloud, ssh, ssh-keygen) that split
//! `PATH` on the wrong separator under a cross-platform refactor and — in the
//! ssh-keygen case — silently skipped the `PATH` scan entirely, so a
//! non-default OpenSSH install would find `ssh.exe` but not `ssh-keygen.exe`.

use std::path::PathBuf;

/// Return the first existing path among `well_known` (each a complete candidate
/// path to the executable), else the first `exe_name` found by scanning `PATH`
/// with the OS-appropriate separator. `None` if nothing matches.
pub fn find_executable<I>(well_known: I, exe_name: &str) -> Option<PathBuf>
where
    I: IntoIterator<Item = PathBuf>,
{
    for candidate in well_known {
        if candidate.exists() {
            return Some(candidate);
        }
    }

    let path_var = std::env::var("PATH").ok()?;
    let sep = if cfg!(target_os = "windows") { ';' } else { ':' };
    for dir in path_var.split(sep).filter(|d| !d.is_empty()) {
        let p = PathBuf::from(dir).join(exe_name);
        if p.exists() {
            return Some(p);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_first_existing_well_known() {
        // The current executable's own dir definitely exists; use a path we know
        // resolves (the temp dir) as a stand-in "well-known" candidate.
        let existing = std::env::temp_dir();
        let missing = PathBuf::from("Z:\\definitely\\missing\\nope-xyz");
        let found = find_executable([missing.clone(), existing.clone()], "irrelevant");
        assert_eq!(found, Some(existing));
    }

    #[test]
    fn none_when_nothing_matches() {
        let missing = PathBuf::from("Z:\\definitely\\missing\\nope-xyz");
        // Use an exe name that won't be on PATH.
        let found = find_executable([missing], "hotty-no-such-exe-9f3a.exe");
        assert!(found.is_none());
    }
}
