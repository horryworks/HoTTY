use async_trait::async_trait;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum SessionError {
    #[error("connection failed: {0}")]
    ConnectionFailed(String),

    #[error("authentication failed: {0}")]
    AuthFailed(String),

    #[error("host key rejected: {0}")]
    HostKeyRejected(String),

    #[error("protocol error: {0}")]
    Protocol(String),

    #[error("invalid config: {0}")]
    InvalidConfig(String),

    #[error("session not found")]
    NotFound,

    #[error("i/o error: {0}")]
    Io(#[from] std::io::Error),

    #[error("{0}")]
    Other(String),
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
        let e = SessionError::AuthFailed("bad pass".into());
        assert_eq!(String::from(e), "authentication failed: bad pass");
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
}
