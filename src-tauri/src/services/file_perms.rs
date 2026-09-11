//! Locking a file or directory down to its owner.
//!
//! Extracted from `gcloud_iap`, which needed it for the key it generates for
//! `ssh.exe`. `ssh_keys` needs exactly the same thing for the keys the user
//! generates, and a second copy of an `icacls` invocation is the kind of
//! scattered OS detail the architecture Non-goal on cross-platform support
//! rules out.
//!
//! Deliberately free of `SessionError`: this is a `services` module, and having
//! it speak one caller's error type would make every other caller depend on
//! that caller. Each converts at its own boundary.
//!
//! Nothing here logs the path. Callers that already log theirs (gcloud-iap's
//! key path is a fixed, non-secret location) keep doing so; `ssh_keys` must not,
//! because a user's key paths and names are their own business.

use std::path::Path;

#[cfg(target_os = "windows")]
use std::process::Stdio;
#[cfg(target_os = "windows")]
use std::time::Duration;
#[cfg(target_os = "windows")]
use tokio::process::Command as TokioCommand;
#[cfg(target_os = "windows")]
use tokio::time::timeout;

/// Which kind of entry is being locked down.
///
/// The two differ on both platforms -- a directory needs the traverse bit on
/// Unix and inheritance flags on Windows -- so the caller states which it means
/// rather than us inferring it from a `metadata()` call that could race with
/// whatever just created the entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OwnerOnly {
    File,
    Dir,
}

#[derive(Debug, thiserror::Error)]
pub enum FilePermError {
    #[error("non-UTF8 path")]
    NonUtf8Path,
    #[error("USERNAME / USER env var not set")]
    NoUser,
    #[error("icacls timed out")]
    Timeout,
    #[error("could not run icacls")]
    Spawn,
    #[error("icacls failed: {0}")]
    Icacls(String),
    #[error("{0}")]
    Io(#[from] std::io::Error),
}

/// Restrict `path` so only the current user can reach it. Idempotent.
///
/// **Windows:** `icacls <path> /inheritance:r /grant:r "<user>:F"`. Stripping
/// inheritance matters as much as the grant: the ACL that `ssh-keygen` and
/// gcloud leave behind often inherits an `OWNER RIGHTS` ACE from the parent
/// directory, and Windows OpenSSH refuses a key whose ACL is not confined to
/// (owner, BUILTIN\Administrators, NT AUTHORITY\SYSTEM) -- the user then sees
/// "Permissions for '...' are too open. This private key will be ignored."
/// The result here is `<user>:F` alone, which is what `ssh-keygen` produces
/// when run interactively and the most conservative form that still works.
///
/// **Unix:** `chmod 0600` / `0700`, and only when the group/other bits are
/// actually set, so an already-correct file is not rewritten.
#[cfg(target_os = "windows")]
pub async fn restrict_to_owner(path: &Path, kind: OwnerOnly) -> Result<(), FilePermError> {
    let path_str = path.to_str().ok_or(FilePermError::NonUtf8Path)?.to_string();
    let user = std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .map_err(|_| FilePermError::NoUser)?;

    // `(OI)(CI)` makes the grant inherit to files and subdirectories. A key
    // directory wants that so keys dropped in later are covered; a key file
    // must not have it.
    let grant = match kind {
        OwnerOnly::File => format!("{user}:F"),
        OwnerOnly::Dir => format!("{user}:(OI)(CI)F"),
    };

    let mut cmd = TokioCommand::new(r"C:\Windows\System32\icacls.exe");
    cmd.arg(&path_str)
        .arg("/inheritance:r")
        .arg("/grant:r")
        .arg(&grant);
    cmd.stdout(Stdio::null());
    cmd.stderr(Stdio::piped());
    // tokio::process::Command exposes creation_flags as an inherent method on
    // Windows; no CommandExt import needed.
    cmd.creation_flags(crate::services::os_paths::CREATE_NO_WINDOW);

    let output = timeout(Duration::from_secs(10), cmd.output())
        .await
        .map_err(|_| FilePermError::Timeout)?
        .map_err(|e| {
            // The io::Error text is a raw OS string ("The system cannot find the
            // file specified. (os error 2)"), and this error reaches the user on
            // the IAP connect path. Keep the detail in the log, not the message.
            log::warn!("icacls could not be started: {e}");
            FilePermError::Spawn
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(FilePermError::Icacls(stderr.trim().to_string()));
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub async fn restrict_to_owner(path: &Path, kind: OwnerOnly) -> Result<(), FilePermError> {
    use std::os::unix::fs::PermissionsExt;

    let desired = match kind {
        OwnerOnly::File => 0o600,
        OwnerOnly::Dir => 0o700,
    };
    let perms = std::fs::metadata(path)?.permissions();
    if perms.mode() & 0o077 != 0 {
        let mut perms = perms;
        perms.set_mode(desired);
        std::fs::set_permissions(path, perms)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// A scratch path under the OS temp dir. Never under `~/.ssh` -- these tests
    /// must not touch a real key directory.
    fn scratch(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("hotty-file-perms-{}-{name}", std::process::id()))
    }

    fn make_file(name: &str) -> std::path::PathBuf {
        let p = scratch(name);
        let mut f = std::fs::File::create(&p).expect("create scratch file");
        f.write_all(b"not a real key").expect("write scratch file");
        p
    }

    #[tokio::test]
    async fn restricting_a_file_twice_succeeds_both_times() {
        // Idempotence is load-bearing: the generate path may retry, and the
        // gcloud-iap path runs this on every connect.
        let p = make_file("idempotent");
        assert!(restrict_to_owner(&p, OwnerOnly::File).await.is_ok());
        assert!(restrict_to_owner(&p, OwnerOnly::File).await.is_ok());
        let _ = std::fs::remove_file(&p);
    }

    #[tokio::test]
    async fn restricting_a_directory_succeeds() {
        let p = scratch("dir");
        std::fs::create_dir_all(&p).expect("create scratch dir");
        assert!(restrict_to_owner(&p, OwnerOnly::Dir).await.is_ok());
        let _ = std::fs::remove_dir_all(&p);
    }

    #[tokio::test]
    async fn a_missing_path_is_an_error_not_a_silent_success() {
        // Failing quietly here would mean the caller believes a key is protected
        // when nothing was done to it.
        let p = scratch("does-not-exist");
        let _ = std::fs::remove_file(&p);
        assert!(restrict_to_owner(&p, OwnerOnly::File).await.is_err());
    }

    #[cfg(not(target_os = "windows"))]
    #[tokio::test]
    async fn group_and_other_bits_are_cleared() {
        use std::os::unix::fs::PermissionsExt;
        let p = make_file("modes");
        let mut perms = std::fs::metadata(&p).unwrap().permissions();
        perms.set_mode(0o644);
        std::fs::set_permissions(&p, perms).unwrap();

        restrict_to_owner(&p, OwnerOnly::File).await.unwrap();

        let mode = std::fs::metadata(&p).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
        let _ = std::fs::remove_file(&p);
    }
}
