use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};

use regex_lite::Regex;

/// Fallback cap on one session's watch buffer when the frontend doesn't supply
/// a limit (mirrors the `watchBufferLimit` setting default).
const DEFAULT_LIMIT: usize = 500_000;

struct BufEntry {
    watching: bool,
    buf: String,
    limit: usize,
}

/// App-global (single process, all windows) capture of terminal output for AI
/// "watch". Keyed by GLOBAL session id and fed directly from the session read
/// loop (see `emit_session_data`), so any window's AI Chat can read the buffer
/// of any window's session — this is what makes cross-window AI watch work.
#[derive(Default)]
pub struct WatchBufferState {
    inner: Mutex<HashMap<String, BufEntry>>,
    /// Number of watched sessions, mirrored as an atomic so the hot `append`
    /// path (called for EVERY terminal data chunk of EVERY session) can skip
    /// taking the global mutex when nothing is being watched (the common case).
    watching_count: AtomicUsize,
}

impl WatchBufferState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
            watching_count: AtomicUsize::new(0),
        }
    }

    /// Enable/disable capture for a session. Enabling (re)starts with an empty
    /// buffer so the AI sees only output produced after Watch was pressed.
    pub fn set_watching(&self, session_id: &str, watching: bool, limit: usize) {
        let mut map = self.inner.lock().unwrap();
        if watching {
            let limit = if limit == 0 { DEFAULT_LIMIT } else { limit };
            let existed = map
                .insert(
                    session_id.to_string(),
                    BufEntry {
                        watching: true,
                        buf: String::new(),
                        limit,
                    },
                )
                .is_some();
            if !existed {
                self.watching_count.fetch_add(1, Ordering::Relaxed);
            }
        } else if map.remove(session_id).is_some() {
            self.watching_count.fetch_sub(1, Ordering::Relaxed);
        }
    }

    /// Append decoded terminal text for a watched session (ANSI-stripped and
    /// front-trimmed to the limit). No-op if the session isn't being watched.
    pub fn append(&self, session_id: &str, text: &str) {
        // Cheap atomic gate: avoid locking the global map for the overwhelmingly
        // common case where no session is being watched.
        if self.watching_count.load(Ordering::Relaxed) == 0 {
            return;
        }
        let mut map = self.inner.lock().unwrap();
        let Some(entry) = map.get_mut(session_id) else {
            return;
        };
        if !entry.watching {
            return;
        }
        entry.buf.push_str(&strip_ansi(text));
        if entry.buf.len() > entry.limit {
            // Keep the most recent `limit` bytes; advance to a char boundary so
            // we never split a multibyte char (which would panic on drain).
            let mut cut = entry.buf.len() - entry.limit;
            while cut < entry.buf.len() && !entry.buf.is_char_boundary(cut) {
                cut += 1;
            }
            entry.buf.drain(..cut);
        }
    }

    /// Return a copy of the buffer WITHOUT clearing it (peek). Used by the
    /// auto-exec poll, which reads incrementally to detect command completion.
    pub fn get(&self, session_id: &str) -> String {
        let map = self.inner.lock().unwrap();
        map.get(session_id)
            .map(|e| e.buf.clone())
            .unwrap_or_default()
    }

    /// Return and clear the buffer (read-once semantics for the AI prompt).
    pub fn take(&self, session_id: &str) -> String {
        let mut map = self.inner.lock().unwrap();
        match map.get_mut(session_id) {
            Some(e) => std::mem::take(&mut e.buf),
            None => String::new(),
        }
    }

    /// Clear the buffer without disabling watching (used on (re)link).
    pub fn clear(&self, session_id: &str) {
        let mut map = self.inner.lock().unwrap();
        if let Some(e) = map.get_mut(session_id) {
            e.buf.clear();
        }
    }

    /// Drop a session's entry entirely (cleanup on disconnect / window close).
    pub fn remove(&self, session_id: &str) {
        if self.inner.lock().unwrap().remove(session_id).is_some() {
            self.watching_count.fetch_sub(1, Ordering::Relaxed);
        }
    }
}

fn ansi_regexes() -> &'static (Regex, Regex) {
    static RE: OnceLock<(Regex, Regex)> = OnceLock::new();
    RE.get_or_init(|| {
        // String literals contain the literal control chars (ESC/BEL/CSI), so
        // these don't rely on regex-lite hex-escape support. Mirrors the
        // frontend `stripAnsiCodes`.
        let osc = Regex::new("\u{1b}\\][^\u{7}\u{1b}]*(?:\u{7}|\u{1b}\\\\)").unwrap();
        let csi =
            Regex::new("[\u{1b}\u{9b}][\\[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[@-~]").unwrap();
        (osc, csi)
    })
}

/// Strip ANSI OSC/CSI escape sequences and normalize CR/CRLF to LF so the AI
/// watch buffer is plain text. Mirrors the frontend `stripAnsiCodes`.
pub fn strip_ansi(input: &str) -> String {
    let (osc, csi) = ansi_regexes();
    let s = osc.replace_all(input, "");
    let s = csi.replace_all(&s, "");
    s.replace("\r\n", "\n").replace('\r', "\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_ansi_removes_csi_and_osc_and_normalizes_newlines() {
        // CSI colour codes
        assert_eq!(strip_ansi("\u{1b}[31mred\u{1b}[0m"), "red");
        // OSC window title (BEL-terminated)
        assert_eq!(strip_ansi("\u{1b}]0;title\u{7}hello"), "hello");
        // CRLF / bare CR normalized to LF
        assert_eq!(strip_ansi("a\r\nb\rc"), "a\nb\nc");
    }

    #[test]
    fn append_only_when_watching() {
        let s = WatchBufferState::new();
        s.append("sid", "ignored"); // not watching -> dropped
        assert_eq!(s.take("sid"), "");

        s.set_watching("sid", true, 100);
        s.append("sid", "\u{1b}[32mok\u{1b}[0m\n");
        assert_eq!(s.take("sid"), "ok\n");
        // take cleared it
        assert_eq!(s.take("sid"), "");
    }

    #[test]
    fn set_watching_false_removes_entry() {
        let s = WatchBufferState::new();
        s.set_watching("sid", true, 100);
        s.append("sid", "data");
        s.set_watching("sid", false, 0);
        s.append("sid", "more"); // entry gone -> dropped
        assert_eq!(s.take("sid"), "");
    }

    #[test]
    fn enabling_watch_resets_buffer() {
        let s = WatchBufferState::new();
        s.set_watching("sid", true, 100);
        s.append("sid", "first");
        s.set_watching("sid", true, 100); // re-enable -> fresh
        s.append("sid", "second");
        assert_eq!(s.take("sid"), "second");
    }

    #[test]
    fn append_trims_from_front_at_limit() {
        let s = WatchBufferState::new();
        s.set_watching("sid", true, 5);
        s.append("sid", "abcdefgh"); // 8 bytes, limit 5
        assert_eq!(s.take("sid"), "defgh");
    }

    #[test]
    fn clear_keeps_watching() {
        let s = WatchBufferState::new();
        s.set_watching("sid", true, 100);
        s.append("sid", "x");
        s.clear("sid");
        s.append("sid", "y");
        assert_eq!(s.take("sid"), "y");
    }
}
