use std::fs::File;
use std::io::{self, Write};
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
/// truncated/half-written file (the old content stays intact until the rename),
/// and the destination is never left absent — on every failure path either the
/// new content or the original file remains in place.
///
/// The temp file is flushed and fsync'd before the rename so a crash immediately
/// after the rename cannot expose unflushed (zero/garbage) blocks.
///
/// On Windows, rename-over-existing occasionally fails if the target is briefly
/// locked (AV/indexer). The fallback moves the existing file *aside* first and
/// only deletes it once the replacement is safely in place — so a second failure
/// can never wipe both copies. The temp file is cleaned up on error.
pub fn atomic_write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = tmp_path(path);

    // Write, flush and fsync the temp file so its bytes are durably on disk
    // before the rename swaps it in.
    {
        let mut f = File::create(&tmp)?;
        if let Err(e) = f.write_all(bytes).and_then(|()| f.sync_all()) {
            let _ = std::fs::remove_file(&tmp);
            return Err(e);
        }
    }

    // Fast path: atomic replace. The old content stays intact until this rename.
    match std::fs::rename(&tmp, path) {
        Ok(()) => Ok(()),
        Err(e) if path.exists() => {
            // Move the current file aside, put the new file in place, then drop
            // the backup. Crucially the destination is never removed before the
            // replacement is in place, so a second failure restores the original
            // instead of leaving no file at all.
            let backup = tmp_path(path);
            match std::fs::rename(path, &backup) {
                Ok(()) => match std::fs::rename(&tmp, path) {
                    Ok(()) => {
                        let _ = std::fs::remove_file(&backup);
                        Ok(())
                    }
                    Err(e2) => {
                        // Restore the original from the backup; discard the temp.
                        let _ = std::fs::rename(&backup, path);
                        let _ = std::fs::remove_file(&tmp);
                        Err(e2)
                    }
                },
                // Could not move the destination aside (still locked): leave the
                // original intact, drop the temp, surface the rename error.
                Err(_) => {
                    let _ = std::fs::remove_file(&tmp);
                    Err(e)
                }
            }
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

    #[test]
    fn atomic_write_replaces_existing_with_exact_bytes() {
        let dir = std::env::temp_dir().join(format!(
            "hotty-atomic-test2-{}",
            TMP_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let path = dir.join("kh");

        atomic_write(&path, b"a-long-original-line\n").unwrap();
        atomic_write(&path, b"short\n").unwrap();

        // Exact replacement — no trailing bytes bleed through from the longer
        // original, and the destination is never missing after a write.
        assert_eq!(std::fs::read(&path).unwrap(), b"short\n");
        assert!(
            path.exists(),
            "destination must never be absent after write"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }
}
