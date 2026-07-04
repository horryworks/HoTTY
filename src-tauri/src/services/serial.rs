use async_trait::async_trait;
use serde::Deserialize;
use std::io::Read as IoRead;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tokio::sync::{mpsc, Mutex};
use tokio::task::JoinHandle;

use super::session_service::{
    abort_all, emit_session_data, emit_session_error, emit_session_status, encoding_for,
    join_or_abort, SessionError, SessionService, DISCONNECT_DRAIN_MS,
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SerialConfig {
    /// Serial port path (e.g. "COM3" on Windows, "/dev/ttyUSB0" on Linux)
    pub path: String,

    #[serde(default = "default_baud_rate")]
    pub baud_rate: u32,

    /// "five", "six", "seven", "eight" (default: "eight")
    #[serde(default = "default_data_bits")]
    pub data_bits: String,

    /// "none", "even", "odd", "mark", "space" (default: "none")
    #[serde(default = "default_parity")]
    pub parity: String,

    /// "one", "one_point_five", "two" (default: "one")
    #[serde(default = "default_stop_bits")]
    pub stop_bits: String,

    /// "none", "xon_xoff", "rts_cts" (default: "none")
    #[serde(default = "default_flow_control")]
    pub flow_control: String,

    #[serde(default = "default_encoding")]
    pub encoding: String,
}

fn default_baud_rate() -> u32 {
    9600
}
fn default_data_bits() -> String {
    "eight".into()
}
fn default_parity() -> String {
    "none".into()
}
fn default_stop_bits() -> String {
    "one".into()
}
fn default_flow_control() -> String {
    "none".into()
}
fn default_encoding() -> String {
    "utf8".into()
}

impl SerialConfig {
    pub fn validate(&self) -> Result<(), SessionError> {
        if self.path.is_empty() {
            return Err(SessionError::InvalidConfig(
                "serial port path is empty".into(),
            ));
        }

        // Validate port path format
        use std::sync::OnceLock;
        static RE: OnceLock<regex_lite::Regex> = OnceLock::new();
        let path_re = RE.get_or_init(|| {
            if cfg!(windows) {
                regex_lite::Regex::new(r"^COM\d{1,3}$").unwrap()
            } else {
                regex_lite::Regex::new(r"^/dev/tty.*$").unwrap()
            }
        });

        if !path_re.is_match(&self.path) {
            return Err(SessionError::InvalidConfig(format!(
                "invalid serial port path: {}",
                self.path
            )));
        }

        Ok(())
    }

    fn to_data_bits(&self) -> Result<serialport::DataBits, SessionError> {
        match self.data_bits.to_lowercase().as_str() {
            "five" | "5" => Ok(serialport::DataBits::Five),
            "six" | "6" => Ok(serialport::DataBits::Six),
            "seven" | "7" => Ok(serialport::DataBits::Seven),
            "eight" | "8" => Ok(serialport::DataBits::Eight),
            other => Err(SessionError::InvalidConfig(format!(
                "invalid data bits: {other}"
            ))),
        }
    }

    fn to_parity(&self) -> Result<serialport::Parity, SessionError> {
        match self.parity.to_lowercase().as_str() {
            "none" => Ok(serialport::Parity::None),
            "even" => Ok(serialport::Parity::Even),
            "odd" => Ok(serialport::Parity::Odd),
            other => Err(SessionError::InvalidConfig(format!(
                "invalid parity: {other}"
            ))),
        }
    }

    fn to_stop_bits(&self) -> Result<serialport::StopBits, SessionError> {
        match self.stop_bits.to_lowercase().replace(' ', "_").as_str() {
            "one" | "1" => Ok(serialport::StopBits::One),
            "two" | "2" => Ok(serialport::StopBits::Two),
            other => Err(SessionError::InvalidConfig(format!(
                "invalid stop bits: {other}"
            ))),
        }
    }

    fn to_flow_control(&self) -> Result<serialport::FlowControl, SessionError> {
        match self.flow_control.to_lowercase().replace('-', "_").as_str() {
            "none" => Ok(serialport::FlowControl::None),
            "xon_xoff" | "xonxoff" | "software" => Ok(serialport::FlowControl::Software),
            "rts_cts" | "rtscts" | "hardware" => Ok(serialport::FlowControl::Hardware),
            other => Err(SessionError::InvalidConfig(format!(
                "invalid flow control: {other}"
            ))),
        }
    }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

enum WriterCmd {
    Bytes(Vec<u8>),
    Close,
}

pub struct SerialSession {
    config: SerialConfig,
    encoding: &'static encoding_rs::Encoding,
    writer_tx: Option<mpsc::Sender<WriterCmd>>,
    join: Vec<JoinHandle<()>>,
}

impl SerialSession {
    pub fn new(config: SerialConfig) -> Self {
        let encoding = encoding_for(&config.encoding);
        Self {
            config,
            encoding,
            writer_tx: None,
            join: Vec::new(),
        }
    }
}

/// Convert a raw `serialport::Error` from the port-open path into a short,
/// human-readable message, mirroring `humanize_io_error` for the TCP
/// protocols. Without this, Windows COM open failures surface raw OS phrases
/// like "Access is denied." or "The system cannot find the file specified.".
/// The port path is kept in the message because it is the port's identity.
fn humanize_serial_error(err: &serialport::Error, path: &str) -> String {
    use serialport::ErrorKind;
    use std::io::ErrorKind as IoKind;
    match err.kind {
        ErrorKind::NoDevice | ErrorKind::Io(IoKind::NotFound) => {
            return format!("Serial port {path} not found")
        }
        ErrorKind::Io(IoKind::PermissionDenied) => {
            return format!("Serial port {path} is in use or access was denied")
        }
        ErrorKind::InvalidInput => return format!("Invalid serial port settings for {path}"),
        _ => {}
    }
    // String-match fallback: Windows surfaces most COM open failures as an
    // untyped error carrying a raw OS phrase rather than a typed ErrorKind.
    let lower = err.to_string().to_ascii_lowercase();
    if lower.contains("access is denied") || lower.contains("in use") || lower.contains("busy") {
        format!("Serial port {path} is in use or access was denied")
    } else if lower.contains("cannot find")
        || lower.contains("does not exist")
        || lower.contains("no such")
    {
        format!("Serial port {path} not found")
    } else {
        format!("Failed to open serial port {path}: {err}")
    }
}

#[async_trait]
impl SessionService for SerialSession {
    async fn connect(&mut self, app: AppHandle, session_id: String) -> Result<(), SessionError> {
        self.config.validate()?;

        let data_bits = self.config.to_data_bits()?;
        let parity = self.config.to_parity()?;
        let stop_bits = self.config.to_stop_bits()?;
        let flow_control = self.config.to_flow_control()?;

        log::info!(
            "serial: opening {} at {} baud (session {session_id})",
            self.config.path,
            self.config.baud_rate
        );

        let port = serialport::new(&self.config.path, self.config.baud_rate)
            .data_bits(data_bits)
            .parity(parity)
            .stop_bits(stop_bits)
            .flow_control(flow_control)
            .timeout(Duration::from_millis(100))
            .open()
            .map_err(|e| {
                log::error!("serial: failed to open {}: {e}", self.config.path);
                SessionError::ConnectionFailed(humanize_serial_error(&e, &self.config.path))
            })?;

        // Give the reader its own independent handle so its blocking 100ms read
        // never holds a lock the writer needs — otherwise every keystroke could
        // wait up to one read-timeout (~100ms) for the reader to release the
        // port. `try_clone` works on Windows COM and Linux tty; if it ever fails
        // we fall back to the shared-lock path so behaviour never regresses.
        let read_handle: Option<Box<dyn serialport::SerialPort>> = match port.try_clone() {
            Ok(h) => Some(h),
            Err(e) => {
                log::warn!(
                    "serial: try_clone failed for {} ({e}); falling back to shared read/write lock",
                    self.config.path
                );
                None
            }
        };

        let port = Arc::new(Mutex::new(port));

        let (tx, mut rx) = mpsc::channel::<WriterCmd>(64);
        self.writer_tx = Some(tx);

        emit_session_status(&app, &session_id, "connected");

        // --- Writer task ---
        let write_port = port.clone();
        let writer_join = tokio::spawn(async move {
            while let Some(cmd) = rx.recv().await {
                match cmd {
                    WriterCmd::Bytes(b) => {
                        let mut p = write_port.lock().await;
                        if p.write_all(&b).is_err() {
                            break;
                        }
                        let _ = p.flush();
                    }
                    WriterCmd::Close => break,
                }
            }
        });
        self.join.push(writer_join);

        // --- Reader task ---
        let encoding = self.encoding;
        let app_r = app.clone();
        let sid = session_id.clone();
        let read_port = port;
        let log_mgr: super::log_manager::LogManager = app
            .state::<super::log_manager::LogManager>()
            .inner()
            .clone();

        let reader_join = tokio::spawn(async move {
            log::info!("serial reader task started for {sid}");
            let mut buf = [0u8; 1024];
            let mut read_handle = read_handle;
            loop {
                // Prefer the independent clone (no lock); only fall back to the
                // shared port under a lock when try_clone was unavailable.
                let result = if let Some(rp) = read_handle.as_mut() {
                    rp.read(&mut buf)
                } else {
                    let mut p = read_port.lock().await;
                    p.read(&mut buf)
                };
                match result {
                    Ok(0) => {
                        log::info!("serial {sid}: read returned 0 (port closed)");
                        log_mgr.stop_logging(&sid).await;
                        emit_session_status(&app_r, &sid, "disconnected");
                        break;
                    }
                    Ok(n) => {
                        let (decoded, _enc, _had_errors) = encoding.decode(&buf[..n]);
                        let text = decoded.into_owned();
                        emit_session_data(&app_r, &sid, text.clone());
                        log_mgr.write(&sid, &text).await;
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => {
                        tokio::task::yield_now().await;
                        continue;
                    }
                    Err(e) => {
                        log::error!("serial {sid}: read error: {e}");
                        log_mgr.stop_logging(&sid).await;
                        emit_session_error(&app_r, &sid, format!("read error: {e}"));
                        emit_session_status(&app_r, &sid, "disconnected");
                        break;
                    }
                }
            }
        });
        self.join.push(reader_join);

        Ok(())
    }

    async fn write(&mut self, data: &[u8]) -> Result<(), SessionError> {
        if let Some(ref tx) = self.writer_tx {
            let text = String::from_utf8_lossy(data);
            let (encoded, _enc, _had_errors) = self.encoding.encode(&text);
            tx.send(WriterCmd::Bytes(encoded.into_owned()))
                .await
                .map_err(|_| SessionError::Other("writer channel closed".into()))?;
        }
        Ok(())
    }

    /// Serial has no PTY — resize is a no-op.
    async fn resize(&mut self, _cols: u16, _rows: u16) -> Result<(), SessionError> {
        Ok(())
    }

    fn set_encoding(&mut self, encoding: &str) {
        self.encoding = encoding_for(encoding);
    }

    async fn disconnect(&mut self) -> Result<(), SessionError> {
        if let Some(tx) = self.writer_tx.take() {
            let _ = tx.send(WriterCmd::Close).await;
        }
        join_or_abort(
            std::mem::take(&mut self.join),
            "Serial",
            DISCONNECT_DRAIN_MS,
        )
        .await;
        Ok(())
    }
}

impl Drop for SerialSession {
    fn drop(&mut self) {
        if self.writer_tx.is_some() {
            log::warn!("SerialSession dropped without calling disconnect()");
            abort_all(std::mem::take(&mut self.join));
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_validates_windows_port() {
        let cfg = SerialConfig {
            path: "COM3".into(),
            baud_rate: 9600,
            data_bits: "eight".into(),
            parity: "none".into(),
            stop_bits: "one".into(),
            flow_control: "none".into(),
            encoding: "utf8".into(),
        };
        if cfg!(windows) {
            assert!(cfg.validate().is_ok());
        }
    }

    #[test]
    fn config_rejects_empty_path() {
        let cfg = SerialConfig {
            path: String::new(),
            baud_rate: 9600,
            data_bits: "eight".into(),
            parity: "none".into(),
            stop_bits: "one".into(),
            flow_control: "none".into(),
            encoding: "utf8".into(),
        };
        assert!(cfg.validate().is_err());
    }

    #[test]
    fn data_bits_parsing() {
        let cfg = SerialConfig {
            path: "COM1".into(),
            baud_rate: 9600,
            data_bits: "seven".into(),
            parity: "none".into(),
            stop_bits: "one".into(),
            flow_control: "none".into(),
            encoding: "utf8".into(),
        };
        assert!(matches!(
            cfg.to_data_bits(),
            Ok(serialport::DataBits::Seven)
        ));
    }

    #[test]
    fn parity_parsing() {
        let cfg = SerialConfig {
            path: "COM1".into(),
            baud_rate: 9600,
            data_bits: "eight".into(),
            parity: "even".into(),
            stop_bits: "one".into(),
            flow_control: "none".into(),
            encoding: "utf8".into(),
        };
        assert!(matches!(cfg.to_parity(), Ok(serialport::Parity::Even)));
    }

    #[test]
    fn flow_control_parsing() {
        let cfg = SerialConfig {
            path: "COM1".into(),
            baud_rate: 9600,
            data_bits: "eight".into(),
            parity: "none".into(),
            stop_bits: "one".into(),
            flow_control: "rts_cts".into(),
            encoding: "utf8".into(),
        };
        assert!(matches!(
            cfg.to_flow_control(),
            Ok(serialport::FlowControl::Hardware)
        ));
    }

    #[test]
    fn config_deserializes() {
        let json = r#"{"path":"COM3","baudRate":115200,"dataBits":"eight","parity":"none","stopBits":"one","flowControl":"none","encoding":"utf8"}"#;
        let cfg: SerialConfig = serde_json::from_str(json).unwrap();
        assert_eq!(cfg.path, "COM3");
        assert_eq!(cfg.baud_rate, 115200);
    }

    #[test]
    fn config_deserializes_with_defaults() {
        let json = r#"{"path":"COM1"}"#;
        let cfg: SerialConfig = serde_json::from_str(json).unwrap();
        assert_eq!(cfg.baud_rate, 9600);
        assert_eq!(cfg.data_bits, "eight");
        assert_eq!(cfg.parity, "none");
        assert_eq!(cfg.stop_bits, "one");
        assert_eq!(cfg.flow_control, "none");
    }

    // -- humanize_serial_error tests --

    #[test]
    fn humanize_serial_no_device_is_not_found() {
        let e = serialport::Error::new(serialport::ErrorKind::NoDevice, "device disconnected");
        assert_eq!(
            humanize_serial_error(&e, "COM3"),
            "Serial port COM3 not found"
        );
    }

    #[test]
    fn humanize_serial_permission_denied_is_in_use() {
        let e = serialport::Error::new(
            serialport::ErrorKind::Io(std::io::ErrorKind::PermissionDenied),
            "Access is denied.",
        );
        assert_eq!(
            humanize_serial_error(&e, "COM3"),
            "Serial port COM3 is in use or access was denied"
        );
    }

    #[test]
    fn humanize_serial_io_not_found_is_not_found() {
        let e = serialport::Error::new(
            serialport::ErrorKind::Io(std::io::ErrorKind::NotFound),
            "The system cannot find the file specified.",
        );
        assert_eq!(
            humanize_serial_error(&e, "COM9"),
            "Serial port COM9 not found"
        );
    }

    #[test]
    fn humanize_serial_string_fallback_access_denied() {
        // Windows often reports the busy/denied case as an untyped Unknown error
        // carrying a raw OS phrase — the string-match fallback must catch it.
        let e = serialport::Error::new(serialport::ErrorKind::Unknown, "Access is denied.");
        assert_eq!(
            humanize_serial_error(&e, "COM4"),
            "Serial port COM4 is in use or access was denied"
        );
    }

    #[test]
    fn humanize_serial_string_fallback_cannot_find() {
        let e = serialport::Error::new(
            serialport::ErrorKind::Unknown,
            "The system cannot find the file specified.",
        );
        assert_eq!(
            humanize_serial_error(&e, "COM5"),
            "Serial port COM5 not found"
        );
    }

    #[test]
    fn humanize_serial_unrecognized_falls_through_to_generic() {
        let e = serialport::Error::new(serialport::ErrorKind::Unknown, "something unexpected");
        assert_eq!(
            humanize_serial_error(&e, "COM6"),
            "Failed to open serial port COM6: something unexpected"
        );
    }
}
