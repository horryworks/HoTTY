use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use tokio::sync::Mutex;

use crate::services::chat_log::{
    build_chat_log_path, render_header, render_turn, ChatLogMeta, ChatLogTurn,
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

pub(crate) const MAX_FILENAME_LEN: usize = 200;

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
    /// Number of sessions currently logging, mirrored as an atomic so the hot
    /// [`write`](LogManager::write) path — called for EVERY terminal data chunk
    /// of EVERY session — can skip the process-global mutex when nothing is
    /// being logged (the default). Same fast-path-gate pattern as
    /// `WatchBufferState::watching_count`.
    active_logs: Arc<AtomicUsize>,
}

/// Per-conversation AI-chat log state, keyed by `paneId::tabId`.
///
/// Deliberately holds no `File`: `append_chat_log` opens, appends, flushes and
/// closes on every call. Chat turns arrive a few per *minute* (not per
/// keystroke like terminal output), so the reopen cost is noise, and in exchange
/// there is no handle to release — no `Drop` impl, no window-close cleanup, no
/// app-quit flush, and the transcript is complete on disk after every turn even
/// if the app is killed.
struct ChatLogState {
    /// Absolute path of the markdown transcript.
    path: PathBuf,
    /// Canonicalized directory the file lives in, so a mid-conversation change
    /// of the configured log folder rotates to a new file instead of appending
    /// to the old one.
    dir: PathBuf,
}

struct LogManagerInner {
    /// sessionId → active log state
    logs: HashMap<String, SessionLog>,
    /// `paneId::tabId` → active AI-chat transcript
    chat_logs: HashMap<String, ChatLogState>,
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
///
/// The ASCII-only output is load-bearing: callers byte-truncate the resulting
/// filename at `MAX_FILENAME_LEN`, which would panic on a char boundary if
/// multi-byte characters survived. Do not widen the accepted set.
pub(crate) fn sanitize_host(host: &str) -> String {
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
pub(crate) fn timestamp_prefix() -> String {
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
pub(crate) fn ts_log_timestamp() -> String {
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
                chat_logs: HashMap::new(),
                allowed_dirs: Vec::new(),
                persist_path: None,
            })),
            active_logs: Arc::new(AtomicUsize::new(0)),
        }
    }

    /// True while at least one session is logging.
    ///
    /// Deliberately process-wide rather than per-session: it exists only so the
    /// terminal read loops can skip cloning a chunk they would hand to
    /// [`write`](LogManager::write), and a false positive there costs one
    /// needless clone, never correctness.
    pub fn is_logging_active(&self) -> bool {
        self.active_logs.load(Ordering::Relaxed) > 0
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
        // Atomic write (temp + rename) so a crash or a concurrent save from
        // another window can't truncate the approvals file. Creates parent dirs.
        if let Err(e) = crate::services::atomic_file::atomic_write(path, content.as_bytes()) {
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

        // Reject UNC/network paths BEFORE touching the filesystem. `log_dir`
        // arrives straight from the renderer, and `create_dir_all` below runs
        // ahead of the approval check (so a previously approved folder the user
        // has since deleted is transparently recreated). Without this guard a
        // forged `connect_session` could aim that at `\\attacker\share`, making
        // the Windows redirector authenticate and leak an NTLMv2 hash before
        // the approval check ever runs. Same defense as ssh.rs / local.rs /
        // file_server.rs — see `path_safety::is_unc_path`.
        if crate::services::path_safety::is_unc_path(&log_dir.to_string_lossy()) {
            return Err("log directory cannot be a UNC/network path".into());
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
        self.active_logs.fetch_add(1, Ordering::Relaxed);

        Ok(())
    }

    /// Write terminal data to the session's log files.
    pub async fn write(&self, session_id: &str, raw_data: &str) {
        // Cheap atomic gate: this runs for every chunk of every session, so
        // don't serialize them all on the global mutex just to discover that
        // logging is off (the default).
        if !self.is_logging_active() {
            return;
        }
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
            self.active_logs.fetch_sub(1, Ordering::Relaxed);
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
            self.active_logs.fetch_sub(1, Ordering::Relaxed);
            let _ = log.file.flush();
            let _ = log.ts_file.flush();
            log::info!("stopped logging session '{session_id}'");
        }
    }

    /// Append AI-chat turns to the conversation's markdown transcript, creating
    /// the file (and writing its header) on the first call for `log_key`.
    ///
    /// Security: `log_dir` must be in the same dialog-attested allow-list that
    /// gates `start_logging`, so a compromised renderer cannot write markdown to
    /// an arbitrary path by forging `log_key` / `log_dir`. Unlike
    /// `start_logging` the approval check runs *before* any filesystem mutation
    /// — no directory is created for an unapproved path. An approved directory
    /// necessarily exists already (`confirm_log_dir` requires `is_dir()`).
    pub async fn append_chat_log(
        &self,
        log_key: &str,
        log_dir: &Path,
        meta: &ChatLogMeta,
        turns: &[ChatLogTurn],
    ) -> Result<(), String> {
        if turns.is_empty() {
            return Ok(());
        }

        let mut inner = self.inner.lock().await;

        let dir_buf = canonicalize_for_compare(log_dir);
        if !inner.allowed_dirs.contains(&dir_buf) {
            return Err(format!("log directory not approved: {}", log_dir.display()));
        }
        if !log_dir.is_dir() {
            return Err(format!("log directory not found: {}", log_dir.display()));
        }

        // The configured log folder changed mid-conversation — retire the old
        // file and start a fresh one under the new (also approved) directory.
        if let Some(existing) = inner.chat_logs.get(log_key) {
            if existing.dir != dir_buf {
                inner.chat_logs.remove(log_key);
            }
        }

        // Lazy start: an AI chat tab often never receives a message, so creating
        // the file eagerly would litter the log folder with empty transcripts.
        // Creating it on the first turn is also the moment the tab title is
        // meaningful (it is empty until a terminal is linked).
        let path = match inner.chat_logs.get(log_key) {
            Some(state) => state.path.clone(),
            None => {
                let path = build_chat_log_path(log_dir, &meta.title);
                let mut file = File::create(&path)
                    .map_err(|e| format!("failed to create chat log file: {e}"))?;
                let header = render_header(meta, log_key, &ts_log_timestamp());
                file.write_all(header.as_bytes())
                    .and_then(|()| file.flush())
                    .map_err(|e| format!("failed to write chat log header: {e}"))?;
                log::info!("started AI chat log '{log_key}' to {}", path.display());
                inner.chat_logs.insert(
                    log_key.to_string(),
                    ChatLogState {
                        path: path.clone(),
                        dir: dir_buf,
                    },
                );
                path
            }
        };

        let mut body = String::new();
        for turn in turns {
            body.push_str(&render_turn(turn, &ts_log_timestamp()));
        }

        let write_result = OpenOptions::new()
            .append(true)
            .open(&path)
            .and_then(|mut f| f.write_all(body.as_bytes()).and_then(|()| f.flush()));

        if let Err(e) = write_result {
            // Mirrors `write`'s policy: surface the failure once and stop logging
            // this conversation rather than silently truncating the transcript.
            log::error!(
                "AI chat log write failed for '{log_key}': {e}; stopping chat logging for this conversation"
            );
            inner.chat_logs.remove(log_key);
            return Err(format!("failed to write chat log: {e}"));
        }

        Ok(())
    }

    /// Forget `log_key` so the next append starts a fresh transcript file.
    ///
    /// Called when a conversation is cleared, its tab closes, or the provider
    /// changes. Nothing to flush — transcripts are never held open.
    pub async fn close_chat_log(&self, log_key: &str) {
        let mut inner = self.inner.lock().await;
        if inner.chat_logs.remove(log_key).is_some() {
            log::info!("closed AI chat log '{log_key}'");
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
            active_logs: Arc::clone(&self.active_logs),
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

        mgr.stop_logging("s1").await;
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

    // ---- AI chat transcripts -------------------------------------------

    use crate::services::chat_log::{ChatLogRole, CHAT_LOG_EXT};

    fn chat_turn(role: ChatLogRole, content: &str) -> ChatLogTurn {
        ChatLogTurn {
            role,
            content: content.to_string(),
            images: Vec::new(),
        }
    }

    fn chat_meta() -> ChatLogMeta {
        ChatLogMeta {
            title: "router-a".to_string(),
            model: "gemini-2.5-pro".to_string(),
            provider: "gemini".to_string(),
            terminals: vec!["router-a".to_string()],
        }
    }

    /// Count `.md` files directly inside `dir`.
    fn md_files(dir: &Path) -> Vec<PathBuf> {
        let mut out: Vec<PathBuf> = fs::read_dir(dir)
            .map(|rd| {
                rd.flatten()
                    .map(|e| e.path())
                    .filter(|p| p.extension().and_then(|e| e.to_str()) == Some(CHAT_LOG_EXT))
                    .collect()
            })
            .unwrap_or_default();
        out.sort();
        out
    }

    /// Fresh, approved temp directory for a chat-log test.
    async fn approved_chat_dir(mgr: &LogManager, name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(name);
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        mgr.approve_dir(&dir).await;
        dir
    }

    #[tokio::test]
    async fn append_chat_log_creates_file_with_header_then_appends() {
        let mgr = LogManager::new();
        let dir = approved_chat_dir(&mgr, "hotty_test_chat_log_create").await;

        mgr.append_chat_log(
            "ai-1::tab-1",
            &dir,
            &chat_meta(),
            &[chat_turn(ChatLogRole::User, "show version")],
        )
        .await
        .unwrap();
        mgr.append_chat_log(
            "ai-1::tab-1",
            &dir,
            &chat_meta(),
            &[chat_turn(ChatLogRole::Model, "Here is the version.")],
        )
        .await
        .unwrap();

        let files = md_files(&dir);
        assert_eq!(files.len(), 1, "second append must reuse the same file");
        let content = fs::read_to_string(&files[0]).unwrap();
        assert!(content.starts_with("# AI Chat — router-a"));
        assert!(content.contains("- **Model:** gemini-2.5-pro"));
        let user_at = content.find("] User").expect("user turn missing");
        let model_at = content.find("] Assistant").expect("model turn missing");
        assert!(user_at < model_at, "turns must be in order");
        assert!(content.contains("```text\nshow version\n```"));
        assert!(content.contains("Here is the version."));

        let _ = fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn append_chat_log_rejects_unapproved_dir() {
        let dir = std::env::temp_dir().join("hotty_test_chat_log_unapproved");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let mgr = LogManager::new();
        let result = mgr
            .append_chat_log(
                "ai-1::tab-1",
                &dir,
                &chat_meta(),
                &[chat_turn(ChatLogRole::User, "hi")],
            )
            .await;

        let msg = result.expect_err("expected error for unapproved dir");
        assert!(
            msg.contains("not approved"),
            "expected 'not approved' in error, got: {msg}"
        );
        assert!(
            md_files(&dir).is_empty(),
            "an unapproved append must not create a file"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn close_chat_log_starts_a_new_file() {
        let mgr = LogManager::new();
        let dir = approved_chat_dir(&mgr, "hotty_test_chat_log_close").await;
        let meta = chat_meta();

        mgr.append_chat_log("k", &dir, &meta, &[chat_turn(ChatLogRole::User, "one")])
            .await
            .unwrap();
        mgr.close_chat_log("k").await;
        mgr.append_chat_log("k", &dir, &meta, &[chat_turn(ChatLogRole::User, "two")])
            .await
            .unwrap();

        let files = md_files(&dir);
        assert_eq!(files.len(), 2, "close must start a fresh transcript");
        // Both files are created inside the same second, so the collision
        // suffix decides their sort order — assert on content, not position.
        let bodies: Vec<String> = files
            .iter()
            .map(|p| fs::read_to_string(p).unwrap())
            .collect();
        assert_eq!(
            bodies.iter().filter(|b| b.contains("one")).count(),
            1,
            "the first turn must live in exactly one transcript"
        );
        assert_eq!(
            bodies.iter().filter(|b| b.contains("two")).count(),
            1,
            "the second turn must live in exactly one transcript"
        );
        assert!(
            !bodies
                .iter()
                .any(|b| b.contains("one") && b.contains("two")),
            "close must not let both turns land in the same transcript"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn append_chat_log_rotates_when_log_dir_changes() {
        let mgr = LogManager::new();
        let dir_a = approved_chat_dir(&mgr, "hotty_test_chat_log_rot_a").await;
        let dir_b = approved_chat_dir(&mgr, "hotty_test_chat_log_rot_b").await;
        let meta = chat_meta();

        mgr.append_chat_log("k", &dir_a, &meta, &[chat_turn(ChatLogRole::User, "a")])
            .await
            .unwrap();
        mgr.append_chat_log("k", &dir_b, &meta, &[chat_turn(ChatLogRole::User, "b")])
            .await
            .unwrap();

        assert_eq!(md_files(&dir_a).len(), 1);
        assert_eq!(md_files(&dir_b).len(), 1);

        let _ = fs::remove_dir_all(&dir_a);
        let _ = fs::remove_dir_all(&dir_b);
    }

    #[tokio::test]
    async fn append_chat_log_empty_turns_is_noop() {
        let mgr = LogManager::new();
        let dir = approved_chat_dir(&mgr, "hotty_test_chat_log_empty").await;

        mgr.append_chat_log("k", &dir, &chat_meta(), &[])
            .await
            .unwrap();
        assert!(md_files(&dir).is_empty(), "no turns means no file");

        let _ = fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn append_chat_log_rejects_missing_dir() {
        let mgr = LogManager::new();
        let dir = approved_chat_dir(&mgr, "hotty_test_chat_log_missing").await;
        // Approved, then removed out from under us.
        let _ = fs::remove_dir_all(&dir);

        let result = mgr
            .append_chat_log(
                "k",
                &dir,
                &chat_meta(),
                &[chat_turn(ChatLogRole::User, "hi")],
            )
            .await;
        assert!(result.is_err(), "expected error for a missing directory");
    }

    #[tokio::test]
    async fn close_chat_log_unknown_key_is_noop() {
        let mgr = LogManager::new();
        mgr.close_chat_log("never-seen").await;
    }

    #[tokio::test]
    async fn log_manager_allowed_dirs() {
        let mgr = LogManager::new();
        let dir = Path::new("/test/logs");
        mgr.approve_dir(dir).await;

        assert!(mgr.is_path_allowed(Path::new("/test/logs/file.txt")).await);
        assert!(!mgr.is_path_allowed(Path::new("/other/file.txt")).await);
    }

    /// A renderer-supplied UNC log dir must be rejected before `start_logging`
    /// touches the filesystem — resolving `\\host\share` makes Windows
    /// authenticate over SMB and leak an NTLMv2 hash. The check runs ahead of
    /// `create_dir_all`, so this must fail even though the dir is unapproved
    /// (the approval error would otherwise come only *after* the FS touch).
    #[tokio::test]
    async fn start_logging_rejects_unc_log_dir() {
        let mgr = LogManager::new();
        for dir in [r"\\attacker.example\share\logs", "//attacker.example/share"] {
            let err = mgr
                .start_logging("s-unc", Path::new(dir), "ssh", "host")
                .await
                .expect_err("UNC log dir must be rejected");
            assert!(
                err.contains("UNC"),
                "expected a UNC rejection for {dir}, got: {err}"
            );
        }
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

    /// `write` runs for every chunk of every session, so it must not touch the
    /// global mutex while nothing is being logged. Proven by holding the lock
    /// for the duration of the call: if `write` tried to acquire it, this would
    /// deadlock rather than return.
    #[tokio::test]
    async fn write_skips_the_global_lock_when_nothing_is_logging() {
        let mgr = LogManager::new();
        assert!(!mgr.is_logging_active());

        let held = mgr.inner.lock().await;
        mgr.write("sid", "output that goes nowhere").await;
        drop(held);
    }

    /// The atomic gate must track start/stop so a real log is never skipped.
    #[tokio::test]
    async fn active_log_count_tracks_start_and_stop() {
        let dir = std::env::temp_dir().join("hotty_test_active_log_count");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let mgr = LogManager::new();
        mgr.approve_dir(&dir).await;
        assert!(!mgr.is_logging_active());

        mgr.start_logging("sid", &dir, "ssh", "host").await.unwrap();
        assert!(mgr.is_logging_active());

        // A repeat start is a no-op and must not double-count, or the counter
        // would never fall back to zero after a single stop.
        mgr.start_logging("sid", &dir, "ssh", "host").await.unwrap();
        mgr.stop_logging("sid").await;
        assert!(!mgr.is_logging_active());

        // A stop for a session that was never logging must not underflow.
        mgr.stop_logging("never-logged").await;
        assert!(!mgr.is_logging_active());

        let _ = fs::remove_dir_all(&dir);
    }
}
