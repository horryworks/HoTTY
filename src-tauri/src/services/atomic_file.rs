use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

/// Process-unique counter so concurrent writers to the same destination use
/// distinct temp files (the app is single-process but multiple windows may
/// write the same shared file at once).
static TMP_COUNTER: AtomicU64 = AtomicU64::new(0);

fn tmp_path(path: &Path) -> PathBuf {
    let n = TMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let mut name = path.as_os_str().to_owned();
    name.push(format!(".tmp{n}"));
    PathBuf::from(name)
}

/// Write `bytes` to `path` atomically: write a sibling temp file then rename it
/// over the destination. A crash or a concurrent write can never leave a
/// truncated/half-written file (the old content stays intact until the rename).
///
/// On Windows, rename-over-existing occasionally fails if the target is briefly
/// locked; fall back to remove-then-rename. The temp file is cleaned up on error.
pub fn atomic_write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = tmp_path(path);
    if let Err(e) = std::fs::write(&tmp, bytes) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    match std::fs::rename(&tmp, path) {
        Ok(()) => Ok(()),
        Err(_) if path.exists() => {
            if let Err(e) = std::fs::remove_file(path) {
                let _ = std::fs::remove_file(&tmp);
                return Err(e);
            }
            let r = std::fs::rename(&tmp, path);
            if r.is_err() {
                let _ = std::fs::remove_file(&tmp);
            }
            r
        }
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_write_creates_and_overwrites() {
        let dir = std::env::temp_dir().join(format!(
            "hotty-atomic-test-{}",
            TMP_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let path = dir.join("nested").join("file.txt");

        atomic_write(&path, b"first").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "first");

        atomic_write(&path, b"second").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "second");

        // No leftover temp files in the directory.
        let leftovers: Vec<_> = std::fs::read_dir(path.parent().unwrap())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "temp files left behind");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
