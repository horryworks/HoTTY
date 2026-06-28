use std::collections::HashMap;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use tokio::sync::Mutex;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FILENAME_LEN: usize = 200;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Per-session log state: the main .txt stream and the parallel .tslog stream.
struct SessionLog {
    /// Main log file writer (ANSI-stripped text).
    file: File,
    /// Timestamp log file writer (one timestamp per line in .txt).
    ts_file: File,
    /// Tracks whether we are at the start of a new line (for timestamp insertion).
    at_line_start: bool,
}

impl Drop for SessionLog {
    fn drop(&mut self) {
        // Ensure buffered writes hit disk even if stop_logging/stop_all was
        // skipped (panic, abrupt session removal, app shutdown).
        let _ = self.file.flush();
        let _ = self.ts_file.flush();
    }
}

/// Manages session logging for all active sessions.
///
/// Thread-safe via `Arc<Mutex<...>>` — designed to be stored in Tauri managed state.
pub struct LogManager {
    inner: Arc<Mutex<LogManagerInner>>,
}

struct LogManagerInner {
    /// sessionId → active log state
    logs: HashMap<String, SessionLog>,
    /// Set of directories the user has explicitly attested for logging — only
    /// populated via a native dialog round-trip (`select_folder`'s file picker
    /// or `confirm_log_dir`'s yes/no prompt). The renderer cannot synthesise
    /// this attestation, so a compromised renderer cannot grow this set just
    /// by calling Tauri commands.
    allowed_dirs: Vec<PathBuf>,
    /// File where `allowed_dirs` is persisted across app sessions. Set by
    /// `set_persist_path` during app startup; written each time
    /// `approve_dir` adds a new directory; loaded by
    /// `load_persisted_approvals` on startup. Lives under `app_data_dir`
    /// which the renderer cannot write to, so persistence does not weaken
    /// the dialog-attestation guarantee.
    persist_path: Option<PathBuf>,
}

// ---------------------------------------------------------------------------
// ANSI stripping
// ---------------------------------------------------------------------------

/// Strip ANSI escape sequences from a string.
///
/// Uses a state-machine approach to handle CSI, OSC, and simple ESC sequences
/// without relying on nested character classes in regex.
fn strip_ansi(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch == '\x1b' {
            // ESC sequence
            match chars.peek() {
                Some('[') => {
                    // CSI sequence: ESC [ ... <final byte>
                    chars.next(); // consume '['
                                  // Skip parameter bytes (0x30-0x3F) and intermediate bytes (0x20-0x2F)
                    while let Some(&c) = chars.peek() {
                        if ('\x20'..='\x3f').contains(&c) {
                            chars.next();
                        } else {
                            break;
                        }
                    }
                    // Skip final byte (0x40-0x7E)
                    if let Some(&c) = chars.peek() {
                        if ('\x40'..='\x7e').contains(&c) {
                            chars.next();
                        }
                    }
                }
                Some(']') => {
                    // OSC sequence: ESC ] ... (terminated by BEL or ST)
                    chars.next(); // consume ']'
                    while let Some(c) = chars.next() {
                        if c == '\x07' {
                            break; // BEL terminator
                        }
                        if c == '\x1b' {
                            // ST = ESC \
                            if chars.peek() == Some(&'\\') {
                                chars.next();
                            }
                            break;
                        }
                    }
                }
                Some(_) => {
                    // Simple two-byte ESC+char sequence
                    chars.next();
                }
                None => {}
            }
        } else if ch == '\u{9b}' {
            // 8-bit CSI (C1 control code) — same as ESC [
            while let Some(&c) = chars.peek() {
                if ('\x20'..='\x3f').contains(&c) {
                    chars.next();
                } else {
                    break;
                }
            }
            if let Some(&c) = chars.peek() {
                if ('\x40'..='\x7e').contains(&c) {
                    chars.next();
                }
            }
        } else {
            out.push(ch);
        }
    }

    out
}

/// Process raw terminal data for logging:
/// 1. Strip ANSI escape codes
/// 2. Normalize CRLF → LF
/// 3. Remove standalone CR (progress bars / line overwrites)
fn process_log_data(raw: &str) -> String {
    let stripped = strip_ansi(raw);
    let normalized = stripped.replace("\r\n", "\n");
    normalized.replace('\r', "")
}

// ---------------------------------------------------------------------------
// Filename helpers
// ---------------------------------------------------------------------------

/// Sanitize a host string for use in filenames: replace non-alphanumeric chars with `_`.
fn sanitize_host(host: &str) -> String {
    host.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

/// Generate a timestamp string in the format YYYYMMDDHHMMSS.
fn timestamp_prefix() -> String {
    chrono_lite_stamp()
}

/// Simple timestamp without pulling in the `chrono` crate.
/// Returns YYYYMMDDHHMMSS using system local time.
fn chrono_lite_stamp() -> String {
    use std::time::SystemTime;

    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();

    // Convert to date/time components (UTC-based, good enough for filenames)
    let days = secs / 86400;
    let time_of_day = secs % 86400;
    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;
    let seconds = time_of_day % 60;

    // Calculate year/month/day from days since epoch
    let (year, month, day) = days_to_ymd(days);

    format!("{year:04}{month:02}{day:02}{hours:02}{minutes:02}{seconds:02}")
}

/// Convert days since Unix epoch to (year, month, day).
fn days_to_ymd(mut days: u64) -> (u64, u64, u64) {
    // Algorithm from http://howardhinnant.github.io/date_algorithms.html
    days += 719_468;
    let era = days / 146_097;
    let doe = days % 146_097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

/// Generate a millisecond-precision timestamp for .tslog entries.
fn ts_log_timestamp() -> String {
    use std::time::SystemTime;

    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();
    let millis = now.subsec_millis();

    let days = secs / 86400;
    let time_of_day = secs % 86400;
    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;
    let seconds = time_of_day % 60;

    let (year, month, day) = days_to_ymd(days);

    format!("{year:04}-{month:02}-{day:02} {hours:02}:{minutes:02}:{seconds:02}.{millis:03}")
}

/// Build the log filename: `YYYYMMDDHHMMSS-PROTOCOL-host.txt`
/// Handles collision by appending `-N`.
fn build_log_path(dir: &Path, protocol: &str, host: &str) -> PathBuf {
    let ts = timestamp_prefix();
    let proto = protocol.to_ascii_uppercase();
    let safe_host = sanitize_host(host);

    // Truncate if too long
    let base = format!("{ts}-{proto}-{safe_host}");
    let base = if base.len() > MAX_FILENAME_LEN {
        base[..MAX_FILENAME_LEN].to_string()
    } else {
        base
    };

    let mut path = dir.join(format!("{base}.txt"));
    let mut counter = 1u32;
    while path.exists() {
        if counter > 9999 {
            // Pathological collision count: rather than returning an existing
            // path (which File::create would truncate, clobbering a prior log),
            // fall back to a high-entropy name that won't collide.
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            path = dir.join(format!("{base}-{}-{nanos}.txt", std::process::id()));
            break;
        }
        path = dir.join(format!("{base}-{counter}.txt"));
        counter += 1;
    }
    path
}

// ---------------------------------------------------------------------------
// LogManager implementation
// ---------------------------------------------------------------------------

impl LogManager {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(LogManagerInner {
                logs: HashMap::new(),
                allowed_dirs: Vec::new(),
                persist_path: None,
            })),
        }
    }

    /// Set the file path used to persist approved log directories.
    /// Called once during app startup with `<app_data_dir>/approved_log_dirs.json`.
    pub async fn set_persist_path(&self, path: PathBuf) {
        let mut inner = self.inner.lock().await;
        inner.persist_path = Some(path);
    }

    /// Load previously-persisted approvals from disk into memory.
    /// Errors are logged and swallowed — a missing or corrupt file simply
    /// means the user will be re-prompted next time logging is used.
    pub async fn load_persisted_approvals(&self) {
        let path_opt = {
            let inner = self.inner.lock().await;
            inner.persist_path.clone()
        };
        let Some(path) = path_opt else { return };
        match std::fs::read_to_string(&path) {
            Ok(content) => match serde_json::from_str::<Vec<String>>(&content) {
                Ok(dirs) => {
                    let mut inner = self.inner.lock().await;
                    for d in dirs {
                        let pb = PathBuf::from(d);
                        if !inner.allowed_dirs.contains(&pb) {
                            inner.allowed_dirs.push(pb);
                        }
                    }
                    log::info!(
                        "loaded {} persisted log-dir approvals",
                        inner.allowed_dirs.len()
                    );
                }
                Err(e) => log::warn!("approved_log_dirs.json is corrupt: {e}"),
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                // First run — no persisted file yet.
            }
            Err(e) => log::warn!("failed to load approved log dirs: {e}"),
        }
    }

    /// Approve a directory for logging and log-file reading.
    ///
    /// Must only be called from code paths that have user attestation outside
    /// the renderer's control — currently `select_folder` (file picker dialog)
    /// and `confirm_log_dir` (native yes/no dialog). A compromised renderer
    /// can call Tauri commands but cannot synthesise the user click these
    /// commands require, so it cannot grow this set on its own.
    ///
    /// Approvals are persisted to `<app_data_dir>/approved_log_dirs.json` so
    /// the user only sees the confirm dialog once per folder ever (rather
    /// than once per app launch).
    pub async fn approve_dir(&self, dir: &Path) {
        let mut inner = self.inner.lock().await;
        let canonical = canonicalize_for_compare(dir);
        if !inner.allowed_dirs.contains(&canonical) {
            inner.allowed_dirs.push(canonical);
            Self::persist_locked(&inner);
        }
    }

    /// Write `allowed_dirs` to disk. Caller must already hold the inner lock.
    fn persist_locked(inner: &LogManagerInner) {
        let Some(path) = &inner.persist_path else {
            return;
        };
        let dirs: Vec<String> = inner
            .allowed_dirs
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect();
        let content = match serde_json::to_string_pretty(&dirs) {
            Ok(c) => c,
            Err(e) => {
                log::warn!("failed to serialize approved log dirs: {e}");
                return;
            }
        };
        if let Some(parent) = path.parent() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                log::warn!("failed to create app data dir for approvals: {e}");
                return;
            }
        }
        if let Err(e) = std::fs::write(path, content) {
            log::warn!("failed to save approved log dirs: {e}");
        }
    }

    /// Check if a directory has been user-approved.
    pub async fn is_dir_approved(&self, dir: &Path) -> bool {
        let inner = self.inner.lock().await;
        let canonical = canonicalize_for_compare(dir);
        inner.allowed_dirs.iter().any(|d| d == &canonical)
    }

    /// Check if a path is within an approved directory.
    pub async fn is_path_allowed(&self, path: &Path) -> bool {
        let inner = self.inner.lock().await;
        is_path_in_allowed_dirs(path, &inner.allowed_dirs)
    }

    /// Start logging for a session.
    ///
    /// Creates `<timestamp>-<PROTOCOL>-<host>.txt` and `.tslog` files in `log_dir`.
    pub async fn start_logging(
        &self,
        session_id: &str,
        log_dir: &Path,
        protocol: &str,
        host: &str,
    ) -> Result<(), String> {
        let mut inner = self.inner.lock().await;

        // Don't double-start
        if inner.logs.contains_key(session_id) {
            return Ok(());
        }

        // Ensure directory exists
        fs::create_dir_all(log_dir).map_err(|e| format!("failed to create log dir: {e}"))?;

        // Require the directory to have been user-approved via a native dialog
        // (Browse-to-pick or yes/no confirm). This means a compromised
        // renderer cannot start logging to attacker-supplied paths just by
        // forging `connect_session` / `update_session_logging` arguments.
        let dir_buf = canonicalize_for_compare(log_dir);
        if !inner.allowed_dirs.contains(&dir_buf) {
            return Err(format!("log directory not approved: {}", log_dir.display()));
        }

        let txt_path = build_log_path(log_dir, protocol, host);
        let ts_path = txt_path.with_extension("tslog");

        let file =
            File::create(&txt_path).map_err(|e| format!("failed to create log file: {e}"))?;
        let ts_file =
            File::create(&ts_path).map_err(|e| format!("failed to create tslog file: {e}"))?;

        log::info!(
            "started logging session '{session_id}' to {}",
            txt_path.display()
        );

        inner.logs.insert(
            session_id.to_string(),
            SessionLog {
                file,
                ts_file,
                at_line_start: true,
            },
        );

        Ok(())
    }

    /// Write terminal data to the session's log files.
    pub async fn write(&self, session_id: &str, raw_data: &str) {
        let mut inner = self.inner.lock().await;
        let Some(log) = inner.logs.get_mut(session_id) else {
            return;
        };

        let processed = process_log_data(raw_data);
        if processed.is_empty() {
            return;
        }

        // Write processed text to .txt file. A write failure (disk full,
        // permission change, removed media) was previously swallowed, silently
        // truncating the transcript. Surface it once and stop logging this
        // session so the user isn't misled into thinking the log is complete.
        if let Err(e) = log.file.write_all(processed.as_bytes()) {
            log::error!(
                "session log write failed for {session_id}: {e}; stopping logging for this session"
            );
            inner.logs.remove(session_id);
            return;
        }

        // Write timestamps to .tslog file (one per line start)
        for ch in processed.chars() {
            if log.at_line_start {
                let ts = ts_log_timestamp();
                let _ = writeln!(log.ts_file, "{ts}");
                log.at_line_start = false;
            }
            if ch == '\n' {
                log.at_line_start = true;
            }
        }
    }

    /// Stop logging for a session (flushes and closes files).
    pub async fn stop_logging(&self, session_id: &str) {
        let mut inner = self.inner.lock().await;
        if let Some(mut log) = inner.logs.remove(session_id) {
            let _ = log.file.flush();
            let _ = log.ts_file.flush();
            log::info!("stopped logging session '{session_id}'");
        }
    }

    /// Stop logging for all sessions.
    pub async fn stop_all(&self) {
        let mut inner = self.inner.lock().await;
        for (id, mut log) in inner.logs.drain() {
            let _ = log.file.flush();
            let _ = log.ts_file.flush();
            log::info!("stopped logging session '{id}'");
        }
    }
}

impl Default for LogManager {
    fn default() -> Self {
        Self::new()
    }
}

impl Clone for LogManager {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
        }
    }
}

/// Canonicalize a path for use in allowed-directory comparisons.
///
/// Falls back to the original path if canonicalization fails (e.g., the
/// directory was deleted, drive unmounted, ACL denies access). Logs a warning
/// in that case so disappearing dirs don't silently degrade to permissive
/// behavior — security is still enforced via byte-exact `starts_with` against
/// whatever was stored at registration time.
fn canonicalize_for_compare(p: &Path) -> PathBuf {
    match p.canonicalize() {
        Ok(c) => c,
        Err(e) => {
            log::warn!("canonicalize failed for {}: {e}", p.display());
            p.to_path_buf()
        }
    }
}

/// Check if a given path is within one of the allowed directories.
///
/// `allowed` entries are stored in canonical form (see `register_allowed_dir`
/// and `start_logging`). The input `path` is canonicalized here so callers
/// can pass either raw or already-canonical paths. `Path::starts_with` is
/// component-wise, so a sibling like `<dir>_evil` cannot bypass `<dir>`.
fn is_path_in_allowed_dirs(path: &Path, allowed: &[PathBuf]) -> bool {
    let canon_path = canonicalize_for_compare(path);
    for dir in allowed {
        if canon_path.starts_with(dir) {
            return true;
        }
    }
    false
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_ansi_removes_csi_sequences() {
        let input = "\x1b[31mHello\x1b[0m World";
        assert_eq!(strip_ansi(input), "Hello World");
    }

    #[test]
    fn strip_ansi_removes_osc_sequences() {
        let input = "before\x1b]0;window title\x07after";
        assert_eq!(strip_ansi(input), "beforeafter");
    }

    #[test]
    fn strip_ansi_preserves_plain_text() {
        let input = "Hello World 123 !@#";
        assert_eq!(strip_ansi(input), input);
    }

    #[test]
    fn process_log_data_normalizes_crlf() {
        assert_eq!(process_log_data("line1\r\nline2\r\n"), "line1\nline2\n");
    }

    #[test]
    fn process_log_data_removes_standalone_cr() {
        // Standalone CRs are simply removed (no terminal-style overwrite simulation)
        assert_eq!(process_log_data("progress\r50%\r100%"), "progress50%100%");
    }

    #[test]
    fn process_log_data_combined() {
        let input = "\x1b[32mOK\x1b[0m\r\nDone\r";
        assert_eq!(process_log_data(input), "OK\nDone");
    }

    #[test]
    fn sanitize_host_replaces_special_chars() {
        assert_eq!(sanitize_host("my.host.com"), "my.host.com");
        assert_eq!(sanitize_host("user@host:22"), "user_host_22");
        assert_eq!(sanitize_host("COM3"), "COM3");
    }

    #[test]
    fn days_to_ymd_epoch() {
        let (y, m, d) = days_to_ymd(0);
        assert_eq!((y, m, d), (1970, 1, 1));
    }

    #[test]
    fn days_to_ymd_known_date() {
        // 2024-01-01 = 19723 days since epoch
        let (y, m, d) = days_to_ymd(19723);
        assert_eq!((y, m, d), (2024, 1, 1));
    }

    #[test]
    fn build_log_path_basic() {
        let dir = std::env::temp_dir().join("hotty_test_log_path");
        let _ = fs::remove_dir_all(&dir);
        let path = build_log_path(&dir, "ssh", "myhost.com");
        let name = path.file_name().unwrap().to_str().unwrap();
        assert!(name.ends_with("-SSH-myhost.com.txt"));
        assert!(name.len() > 14); // timestamp prefix at minimum
    }

    #[test]
    fn build_log_path_collision() {
        let dir = std::env::temp_dir().join("hotty_test_collision");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        // Create the first file to force collision
        let first = build_log_path(&dir, "ssh", "host");
        File::create(&first).unwrap();

        let second = build_log_path(&dir, "ssh", "host");
        // second should have a -1 suffix
        let name = second.file_name().unwrap().to_str().unwrap();
        assert!(name.contains("-1.txt") || second != first);

        // Cleanup
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn is_path_in_allowed_dirs_with_unresolvable_paths_falls_back() {
        // When neither side can be canonicalized (paths don't exist), the
        // helper falls back to raw `starts_with` comparison.
        let allowed = vec![PathBuf::from("/logs"), PathBuf::from("/data/logs")];
        assert!(is_path_in_allowed_dirs(
            Path::new("/logs/session.txt"),
            &allowed
        ));
        assert!(is_path_in_allowed_dirs(
            Path::new("/data/logs/file.txt"),
            &allowed
        ));
        assert!(!is_path_in_allowed_dirs(
            Path::new("/tmp/evil.txt"),
            &allowed
        ));
    }

    /// Regression test for the Windows `\\?\` extended-length prefix bug:
    /// `read_log_file` canonicalizes the requested file before the security
    /// check, so the path it tests against allowed_dirs has the `\\?\`
    /// prefix on Windows. Allowed_dirs must be stored canonicalized so that
    /// `Path::starts_with` matches.
    #[tokio::test]
    async fn registered_dir_matches_canonical_file_path() {
        let dir = std::env::temp_dir().join("hotty_test_canonical_match");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let mgr = LogManager::new();
        // Register raw (as the user would supply via settings).
        mgr.approve_dir(&dir).await;

        // Create a file inside and canonicalize its path — mimics what
        // `read_log_file` passes to `is_path_allowed`.
        let file = dir.join("session.txt");
        File::create(&file).unwrap();
        let canonical_file = file.canonicalize().unwrap();

        assert!(
            mgr.is_path_allowed(&canonical_file).await,
            "canonical file path inside registered dir must be allowed (got {})",
            canonical_file.display()
        );

        let _ = fs::remove_dir_all(&dir);
    }

    /// `Path::starts_with` is component-wise, so a sibling directory whose
    /// name shares a prefix with the registered dir must NOT be allowed.
    #[tokio::test]
    async fn registered_dir_does_not_allow_sibling_with_shared_prefix() {
        let parent = std::env::temp_dir().join("hotty_test_prefix_boundary");
        let _ = fs::remove_dir_all(&parent);
        let allowed_dir = parent.join("logs");
        let evil_dir = parent.join("logs_evil");
        fs::create_dir_all(&allowed_dir).unwrap();
        fs::create_dir_all(&evil_dir).unwrap();

        let mgr = LogManager::new();
        mgr.approve_dir(&allowed_dir).await;

        let evil_file = evil_dir.join("steal.txt");
        File::create(&evil_file).unwrap();
        let canonical_evil = evil_file.canonicalize().unwrap();

        assert!(
            !mgr.is_path_allowed(&canonical_evil).await,
            "sibling dir with shared name prefix must NOT be allowed (got {})",
            canonical_evil.display()
        );

        let _ = fs::remove_dir_all(&parent);
    }

    #[tokio::test]
    async fn log_manager_start_write_stop() {
        let dir = std::env::temp_dir().join("hotty_test_log_manager");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let mgr = LogManager::new();
        mgr.approve_dir(&dir).await;
        mgr.start_logging("s1", &dir, "ssh", "test-host")
            .await
            .unwrap();

        mgr.write("s1", "\x1b[31mHello\x1b[0m\r\nWorld\r\n").await;
        mgr.stop_logging("s1").await;

        // Find the .txt file
        let entries: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("txt"))
            .collect();
        assert_eq!(entries.len(), 1);

        let content = fs::read_to_string(entries[0].path()).unwrap();
        assert_eq!(content, "Hello\nWorld\n");

        // Verify .tslog exists
        let tslog = entries[0].path().with_extension("tslog");
        assert!(tslog.exists());
        let ts_content = fs::read_to_string(&tslog).unwrap();
        let ts_lines: Vec<&str> = ts_content.lines().collect();
        assert_eq!(ts_lines.len(), 2); // Two lines started

        // Cleanup
        let _ = fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn log_manager_write_to_nonexistent_session() {
        let mgr = LogManager::new();
        // Should not panic
        mgr.write("nonexistent", "data").await;
    }

    #[tokio::test]
    async fn log_manager_double_start_is_idempotent() {
        let dir = std::env::temp_dir().join("hotty_test_double_start");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let mgr = LogManager::new();
        mgr.approve_dir(&dir).await;
        mgr.start_logging("s1", &dir, "ssh", "host").await.unwrap();
        // Second start should be ok (idempotent)
        mgr.start_logging("s1", &dir, "ssh", "host").await.unwrap();

        mgr.stop_all().await;
        let _ = fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn approvals_persist_across_log_manager_instances() {
        let tmp = std::env::temp_dir().join("hotty_test_persist_approvals");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        let dir = tmp.join("logs");
        fs::create_dir_all(&dir).unwrap();
        let persist_path = tmp.join("approved.json");

        let mgr1 = LogManager::new();
        mgr1.set_persist_path(persist_path.clone()).await;
        mgr1.approve_dir(&dir).await;
        assert!(mgr1.is_dir_approved(&dir).await);
        assert!(persist_path.exists(), "approve_dir must write the file");

        // New instance — must pick up the persisted approval after load.
        let mgr2 = LogManager::new();
        mgr2.set_persist_path(persist_path.clone()).await;
        assert!(
            !mgr2.is_dir_approved(&dir).await,
            "fresh instance should be empty before load"
        );
        mgr2.load_persisted_approvals().await;
        assert!(
            mgr2.is_dir_approved(&dir).await,
            "load must restore approvals"
        );

        let _ = fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn approve_dir_is_a_noop_without_persist_path() {
        let dir = std::env::temp_dir().join("hotty_test_no_persist");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        // No set_persist_path call — approve must still work in-memory.
        let mgr = LogManager::new();
        mgr.approve_dir(&dir).await;
        assert!(mgr.is_dir_approved(&dir).await);

        let _ = fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn start_logging_rejects_unapproved_dir() {
        let dir = std::env::temp_dir().join("hotty_test_unapproved_dir");
        let _ = fs::remove_dir_all(&dir);

        let mgr = LogManager::new();
        // No approve_dir call — start_logging must refuse.
        let result = mgr.start_logging("s1", &dir, "ssh", "host").await;
        assert!(result.is_err(), "expected error for unapproved dir");
        let msg = result.unwrap_err();
        assert!(
            msg.contains("not approved"),
            "expected 'not approved' in error, got: {msg}"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn log_manager_allowed_dirs() {
        let mgr = LogManager::new();
        let dir = Path::new("/test/logs");
        mgr.approve_dir(dir).await;

        assert!(mgr.is_path_allowed(Path::new("/test/logs/file.txt")).await);
        assert!(!mgr.is_path_allowed(Path::new("/other/file.txt")).await);
    }

    #[test]
    fn ts_log_timestamp_format() {
        let ts = ts_log_timestamp();
        // Should match YYYY-MM-DD HH:MM:SS.mmm
        assert_eq!(ts.len(), 23);
        assert_eq!(&ts[4..5], "-");
        assert_eq!(&ts[7..8], "-");
        assert_eq!(&ts[10..11], " ");
        assert_eq!(&ts[13..14], ":");
        assert_eq!(&ts[16..17], ":");
        assert_eq!(&ts[19..20], ".");
    }
}
