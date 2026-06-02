use async_trait::async_trait;
use serde::Serialize;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use thiserror::Error;
use tokio::task::JoinHandle;

#[derive(Debug, Error)]
pub enum SessionError {
    #[error("{0}")]
    ConnectionFailed(String),

    #[error("{0}")]
    AuthFailed(String),

    #[error("{0}")]
    HostKeyRejected(String),

    #[error("{0}")]
    Protocol(String),

    #[error("{0}")]
    InvalidConfig(String),

    #[error("session not found")]
    NotFound,

    #[error("i/o error: {0}")]
    Io(#[from] std::io::Error),

    #[error("{0}")]
    Other(String),
}

/// Convert a raw `std::io::Error` from a connect attempt into a short,
/// human-friendly string. The TCP target (`host:port`) is intentionally not
/// included — the toast surface already prefixes the session display name,
/// which carries that information.
///
/// `timeout_secs` is only used to render the timeout message; pass `None` if
/// the error did not originate from a timeout race.
pub fn humanize_io_error(err: &std::io::Error, timeout_secs: Option<u32>) -> String {
    use std::io::ErrorKind;
    match err.kind() {
        ErrorKind::TimedOut => match timeout_secs {
            Some(s) => format!("Connection timed out ({s}s)"),
            None => "Connection timed out".to_string(),
        },
        ErrorKind::ConnectionRefused => "Connection refused".to_string(),
        ErrorKind::NotFound => "Host not found".to_string(),
        ErrorKind::HostUnreachable => "Host unreachable".to_string(),
        ErrorKind::NetworkUnreachable => "Network unreachable".to_string(),
        _ => {
            // String-match fallback: Windows surfaces several connect failures
            // as `Uncategorized` with a raw WSAE* message rather than a typed
            // ErrorKind. Detect the most common ones so the user sees a short
            // label instead of "A socket operation was attempted to an
            // unreachable host. (os error 10065)".
            let s = err.to_string();
            let lower = s.to_ascii_lowercase();
            if lower.contains("failed to lookup address")
                || lower.contains("no such host")
                || lower.contains("name or service not known")
            {
                return "Host not found".to_string();
            }
            if lower.contains("connection refused") {
                return "Connection refused".to_string();
            }
            if lower.contains("unreachable network") {
                return "Network unreachable".to_string();
            }
            if lower.contains("unreachable host") {
                return "Host unreachable".to_string();
            }
            if lower.contains("timed out") || lower.contains("timeout") {
                return match timeout_secs {
                    Some(t) => format!("Connection timed out ({t}s)"),
                    None => "Connection timed out".to_string(),
                };
            }
            format!("Connection failed: {s}")
        }
    }
}

impl From<SessionError> for String {
    fn from(e: SessionError) -> String {
        e.to_string()
    }
}

#[async_trait]
pub trait SessionService: Send + Sync {
    /// Establish the connection and start the read loop.
    /// Implementations should spawn background tasks for I/O and
    /// emit `session-data` / `session-status` / `session-error` events.
    async fn connect(
        &mut self,
        app: AppHandle,
        session_id: String,
    ) -> Result<(), SessionError>;

    /// Send user input to the remote side.
    async fn write(&mut self, data: &[u8]) -> Result<(), SessionError>;

    /// Resize the terminal (NAWS / SSH window change).
    async fn resize(&mut self, cols: u16, rows: u16) -> Result<(), SessionError>;

    /// Change the character encoding used for decoding/encoding byte streams.
    fn set_encoding(&mut self, encoding: &str);

    /// Tear down the connection and stop background tasks.
    async fn disconnect(&mut self) -> Result<(), SessionError>;
}

// --- Event payloads emitted from services to the frontend --------------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SessionDataPayload {
    session_id: String,
    data: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SessionStatusPayload {
    session_id: String,
    status: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SessionErrorPayload {
    session_id: String,
    error: String,
}

pub fn emit_session_data(app: &AppHandle, session_id: &str, data: String) {
    let _ = app.emit(
        "session-data",
        SessionDataPayload {
            session_id: session_id.to_string(),
            data,
        },
    );
}

pub fn emit_session_status(app: &AppHandle, session_id: &str, status: &str) {
    let _ = app.emit(
        "session-status",
        SessionStatusPayload {
            session_id: session_id.to_string(),
            status: status.to_string(),
        },
    );
}

pub fn emit_session_error(app: &AppHandle, session_id: &str, error: String) {
    let _ = app.emit(
        "session-error",
        SessionErrorPayload {
            session_id: session_id.to_string(),
            error,
        },
    );
}

// --- Background task lifecycle helpers ---------------------------------
//
// Every protocol service spawns reader/writer/keepalive tasks and must tear
// them down on disconnect (or as a Drop safety net). Timing out on a
// `JoinHandle` only *detaches* the task — it keeps running and holds its
// socket/PTY/channel open — so a forced `.abort()` is what actually prevents
// leaks. These two helpers centralize that logic so all services share one
// correct implementation instead of five slightly-divergent copies.

/// Drain background task handles on a graceful disconnect: give each up to
/// `timeout_ms` to finish on its own, then force-abort any that are still
/// running (e.g. a reader blocked in `read().await` with no shutdown signal).
pub async fn join_or_abort(joins: Vec<JoinHandle<()>>, label: &str, timeout_ms: u64) {
    for h in joins {
        let abort_handle = h.abort_handle();
        if tokio::time::timeout(Duration::from_millis(timeout_ms), h)
            .await
            .is_err()
        {
            log::warn!("{label} task did not finish within {timeout_ms}ms, aborting");
            abort_handle.abort();
        }
    }
}

/// Standard disconnect drain timeout. Brief enough to keep teardown snappy,
/// long enough to let a task that *can* finish gracefully (e.g. an SSH reader
/// receiving Eof/Close) do so before being aborted.
pub const DISCONNECT_DRAIN_MS: u64 = 1500;

/// Immediately abort background task handles. Used by `Drop` as a last-resort
/// safety net when a service is dropped without `disconnect()` having run.
pub fn abort_all(joins: Vec<JoinHandle<()>>) {
    for h in joins {
        h.abort();
    }
}

pub fn encoding_for(name: &str) -> &'static encoding_rs::Encoding {
    match name.to_ascii_lowercase().replace('-', "_").as_str() {
        "utf8" | "utf_8" => encoding_rs::UTF_8,
        "shift_jis" | "sjis" | "shiftjis" => encoding_rs::SHIFT_JIS,
        "euc_jp" | "eucjp" => encoding_rs::EUC_JP,
        _ => encoding_rs::UTF_8,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_error_to_string() {
        // SessionError is a transparent wrapper for the (already-humanized)
        // string the user will see. The Display impl must NOT prepend its own
        // category prefix — the upstream callers have already done that.
        let e = SessionError::AuthFailed("Password authentication failed".into());
        assert_eq!(String::from(e), "Password authentication failed");

        let e = SessionError::ConnectionFailed("Connection timed out (15s)".into());
        assert_eq!(String::from(e), "Connection timed out (15s)");

        let e = SessionError::InvalidConfig("Host is required".into());
        assert_eq!(String::from(e), "Host is required");
    }

    #[tokio::test]
    async fn join_or_abort_aborts_stuck_tasks() {
        // A task with no shutdown path would hang the drain forever without the
        // abort. join_or_abort must return shortly after the timeout.
        let h = tokio::spawn(async {
            loop {
                tokio::time::sleep(Duration::from_secs(3600)).await;
            }
        });
        let start = tokio::time::Instant::now();
        join_or_abort(vec![h], "test", 50).await;
        assert!(
            start.elapsed() < Duration::from_secs(1),
            "stuck task must be aborted, not awaited forever"
        );
    }

    #[tokio::test]
    async fn join_or_abort_joins_finished_tasks_quickly() {
        let h = tokio::spawn(async {});
        let start = tokio::time::Instant::now();
        join_or_abort(vec![h], "test", 1500).await;
        assert!(
            start.elapsed() < Duration::from_secs(1),
            "an already-finished task should join immediately"
        );
    }

    #[tokio::test]
    async fn abort_all_cancels_tasks() {
        let flag = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let f = flag.clone();
        let h = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(200)).await;
            f.store(true, std::sync::atomic::Ordering::SeqCst);
        });
        abort_all(vec![h]);
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert!(
            !flag.load(std::sync::atomic::Ordering::SeqCst),
            "aborted task must not run to completion"
        );
    }

    #[test]
    fn encoding_lookup() {
        assert_eq!(encoding_for("utf8").name(), "UTF-8");
        assert_eq!(encoding_for("UTF-8").name(), "UTF-8");
        assert_eq!(encoding_for("shift_jis").name(), "Shift_JIS");
        assert_eq!(encoding_for("SJIS").name(), "Shift_JIS");
        assert_eq!(encoding_for("euc-jp").name(), "EUC-JP");
        assert_eq!(encoding_for("unknown").name(), "UTF-8");
    }

    // -- humanize_io_error tests --

    fn io(kind: std::io::ErrorKind, msg: &str) -> std::io::Error {
        std::io::Error::new(kind, msg)
    }

    #[test]
    fn humanize_io_error_timeout_with_secs() {
        let e = io(std::io::ErrorKind::TimedOut, "operation timed out");
        assert_eq!(humanize_io_error(&e, Some(15)), "Connection timed out (15s)");
    }

    #[test]
    fn humanize_io_error_timeout_no_secs() {
        let e = io(std::io::ErrorKind::TimedOut, "");
        assert_eq!(humanize_io_error(&e, None), "Connection timed out");
    }

    #[test]
    fn humanize_io_error_connection_refused() {
        let e = io(
            std::io::ErrorKind::ConnectionRefused,
            "Connection refused (os error 10061)",
        );
        assert_eq!(humanize_io_error(&e, Some(15)), "Connection refused");
    }

    #[test]
    fn humanize_io_error_not_found() {
        let e = io(std::io::ErrorKind::NotFound, "failed to lookup address information");
        assert_eq!(humanize_io_error(&e, Some(15)), "Host not found");
    }

    #[test]
    fn humanize_io_error_network_unreachable() {
        let e = io(std::io::ErrorKind::NetworkUnreachable, "");
        assert_eq!(humanize_io_error(&e, Some(15)), "Network unreachable");
    }

    #[test]
    fn humanize_io_error_host_unreachable() {
        let e = io(std::io::ErrorKind::HostUnreachable, "");
        assert_eq!(humanize_io_error(&e, Some(15)), "Host unreachable");
    }

    #[test]
    fn humanize_io_error_uncategorized_dns_falls_through_to_string_match() {
        // Older Windows / pre-1.83 paths surface DNS lookup failures as
        // Uncategorized — exercise the string-fallback path.
        let e = io(
            std::io::ErrorKind::Other,
            "failed to lookup address information: getaddrinfo failed",
        );
        assert_eq!(humanize_io_error(&e, Some(15)), "Host not found");
    }

    #[test]
    fn humanize_io_error_unknown_fallback() {
        let e = io(std::io::ErrorKind::Other, "weird platform quirk");
        assert_eq!(
            humanize_io_error(&e, Some(15)),
            "Connection failed: weird platform quirk"
        );
    }
}
