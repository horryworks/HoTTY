use async_trait::async_trait;
use serde::Deserialize;
use std::sync::Arc;
use std::time::Duration;
use tauri::AppHandle;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, Mutex};
use tokio::task::JoinHandle;

use super::session_service::{
    emit_session_data, emit_session_error, emit_session_status, encoding_for, SessionError,
    SessionService,
};

// --- Telnet protocol constants -----------------------------------------

const IAC: u8 = 0xFF;
const DONT: u8 = 0xFE;
const DO: u8 = 0xFD;
const WONT: u8 = 0xFC;
const WILL: u8 = 0xFB;
const SB: u8 = 0xFA;
const SE: u8 = 0xF0;
const NOP: u8 = 0xF1;

// Telnet options
const OPT_ECHO: u8 = 0x01;
const OPT_SGA: u8 = 0x03; // suppress-go-ahead
const OPT_TTYPE: u8 = 0x18;
const NAWS: u8 = 0x1F;

// --- Config -----------------------------------------------------------

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TelnetConfig {
    pub host: String,
    pub port: u16,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default = "default_encoding")]
    pub encoding: String,
    #[serde(default)]
    pub keepalive_interval_secs: u32,
}

fn default_encoding() -> String {
    "utf8".to_string()
}

impl TelnetConfig {
    pub fn validate(&self) -> Result<(), SessionError> {
        if self.host.trim().is_empty() {
            return Err(SessionError::InvalidConfig("host is empty".into()));
        }
        if self.port == 0 {
            return Err(SessionError::InvalidConfig("port must be > 0".into()));
        }
        Ok(())
    }
}

// --- Login state machine ----------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LoginState {
    WaitingForUsername,
    WaitingForPassword,
    Done,
}

// --- IAC stripper ------------------------------------------------------

/// Process a raw telnet byte stream. Returns `(clean_data, response)` where
/// `clean_data` has all IAC sequences removed and `response` contains the
/// bytes the client should send back to the server to acknowledge the
/// negotiation. Without sending `response`, many telnet servers will block
/// waiting on option negotiation and never send the login prompt.
///
/// Negotiation policy:
/// - We WILL: NAWS, SGA
/// - We DO:   ECHO (server-side echo), SGA
/// - Everything else is declined (WONT / DONT).
pub fn process_iac(data: &[u8]) -> (Vec<u8>, Vec<u8>) {
    let mut out = Vec::with_capacity(data.len());
    let mut resp: Vec<u8> = Vec::new();
    let mut i = 0;
    while i < data.len() {
        let b = data[i];
        if b != IAC {
            out.push(b);
            i += 1;
            continue;
        }
        if i + 1 >= data.len() {
            // Incomplete trailing IAC — drop it.
            break;
        }
        let cmd = data[i + 1];
        match cmd {
            IAC => {
                // Escaped 0xFF
                out.push(IAC);
                i += 2;
            }
            SB => {
                // Consume until IAC SE
                let mut j = i + 2;
                while j + 1 < data.len() {
                    if data[j] == IAC && data[j + 1] == SE {
                        break;
                    }
                    j += 1;
                }
                if j + 1 < data.len() {
                    // Parse the subnegotiation body data[i+2..j].
                    let sb_body = &data[i + 2..j];
                    if let Some(&opt) = sb_body.first() {
                        // IAC SB TTYPE SEND IAC SE  → respond with IS "XTERM-256COLOR"
                        if opt == OPT_TTYPE && sb_body.get(1) == Some(&1) {
                            resp.extend_from_slice(&[IAC, SB, OPT_TTYPE, 0]);
                            resp.extend_from_slice(b"XTERM-256COLOR");
                            resp.extend_from_slice(&[IAC, SE]);
                        }
                    }
                    i = j + 2;
                } else {
                    // Unterminated — drop the rest.
                    break;
                }
            }
            WILL => {
                if i + 2 >= data.len() {
                    break;
                }
                let opt = data[i + 2];
                // Accept server's WILL for options we want it to do.
                let accept = matches!(opt, OPT_ECHO | OPT_SGA);
                resp.extend_from_slice(&[IAC, if accept { DO } else { DONT }, opt]);
                i += 3;
            }
            WONT => {
                if i + 2 >= data.len() {
                    break;
                }
                let opt = data[i + 2];
                resp.extend_from_slice(&[IAC, DONT, opt]);
                i += 3;
            }
            DO => {
                if i + 2 >= data.len() {
                    break;
                }
                let opt = data[i + 2];
                // Server asks us to enable option. Accept NAWS, SGA, TTYPE; decline others.
                let accept = matches!(opt, NAWS | OPT_SGA | OPT_TTYPE);
                resp.extend_from_slice(&[IAC, if accept { WILL } else { WONT }, opt]);
                i += 3;
                // If the server asks for NAWS, also send the current size immediately.
                if accept && opt == NAWS {
                    resp.extend_from_slice(&naws_frame(80, 24));
                }
            }
            DONT => {
                if i + 2 >= data.len() {
                    break;
                }
                let opt = data[i + 2];
                resp.extend_from_slice(&[IAC, WONT, opt]);
                i += 3;
            }
            _ => {
                // Two-byte command; skip.
                i += 2;
            }
        }
    }
    (out, resp)
}

/// Legacy helper kept for existing callers/tests that only care about the
/// cleaned data half of `process_iac`.
pub fn strip_iac(data: &[u8]) -> Vec<u8> {
    process_iac(data).0
}

// --- Login prompt detection -------------------------------------------

fn is_username_prompt(tail: &str) -> bool {
    // "login:" or "username:" (case-insensitive), optionally with trailing space.
    let t = tail.to_ascii_lowercase();
    let t = t.trim_end();
    t.ends_with("login:")
        || t.ends_with("username:")
        || t.ends_with("login :")
        || t.ends_with("username :")
}

fn is_password_prompt(tail: &str) -> bool {
    let t = tail.to_ascii_lowercase();
    let t = t.trim_end();
    t.ends_with("password:") || t.ends_with("password :")
}

// --- Service -----------------------------------------------------------

pub struct TelnetSession {
    config: TelnetConfig,
    encoding: &'static encoding_rs::Encoding,
    writer_tx: Option<mpsc::Sender<WriterCmd>>,
    join: Vec<JoinHandle<()>>,
    login_done: Arc<Mutex<bool>>,
}

enum WriterCmd {
    Bytes(Vec<u8>),
    Resize(u16, u16),
    Close,
}

impl TelnetSession {
    pub fn new(config: TelnetConfig) -> Self {
        let encoding = encoding_for(&config.encoding);
        Self {
            config,
            encoding,
            writer_tx: None,
            join: Vec::new(),
            login_done: Arc::new(Mutex::new(false)),
        }
    }
}

fn naws_frame(cols: u16, rows: u16) -> [u8; 9] {
    [
        IAC,
        SB,
        NAWS,
        (cols >> 8) as u8,
        (cols & 0xFF) as u8,
        (rows >> 8) as u8,
        (rows & 0xFF) as u8,
        IAC,
        SE,
    ]
}

#[async_trait]
impl SessionService for TelnetSession {
    async fn connect(
        &mut self,
        app: AppHandle,
        session_id: String,
    ) -> Result<(), SessionError> {
        self.config.validate()?;

        let addr = format!("{}:{}", self.config.host, self.config.port);
        log::info!("telnet: connecting to {addr} (session {session_id})");
        let stream = TcpStream::connect(&addr).await.map_err(|e| {
            log::error!("telnet: TcpStream::connect({addr}) failed: {e}");
            SessionError::ConnectionFailed(format!("{addr}: {e}"))
        })?;
        log::info!("telnet: TCP connected to {addr}");

        // Enable TCP keepalive via socket2 (best-effort; portable-pty is unused here).
        // Rust's tokio TcpStream does not expose set_keepalive directly, so we leave the
        // OS defaults and rely on the application-level IAC NOP instead.

        let (read_half, write_half) = stream.into_split();
        let write_half = Arc::new(Mutex::new(write_half));

        let (tx, mut rx) = mpsc::channel::<WriterCmd>(64);
        self.writer_tx = Some(tx.clone());

        emit_session_status(&app, &session_id, "connected");

        // Send initial NAWS
        {
            let mut w = write_half.lock().await;
            let _ = w.write_all(&naws_frame(80, 24)).await;
        }

        // --- Writer task: drains WriterCmd channel ------------------
        let writer_half = write_half.clone();
        let writer_join = tokio::spawn(async move {
            while let Some(cmd) = rx.recv().await {
                match cmd {
                    WriterCmd::Bytes(b) => {
                        let mut w = writer_half.lock().await;
                        if w.write_all(&b).await.is_err() {
                            break;
                        }
                    }
                    WriterCmd::Resize(cols, rows) => {
                        let mut w = writer_half.lock().await;
                        let _ = w.write_all(&naws_frame(cols, rows)).await;
                    }
                    WriterCmd::Close => break,
                }
            }
        });
        self.join.push(writer_join);

        // --- Keepalive task: periodic IAC NOP ------------------------
        if self.config.keepalive_interval_secs > 0 {
            let interval = Duration::from_secs(self.config.keepalive_interval_secs as u64);
            let ka_writer = write_half.clone();
            let ka_join = tokio::spawn(async move {
                let mut ticker = tokio::time::interval(interval);
                ticker.tick().await; // skip immediate
                loop {
                    ticker.tick().await;
                    let mut w = ka_writer.lock().await;
                    if w.write_all(&[IAC, NOP]).await.is_err() {
                        break;
                    }
                }
            });
            self.join.push(ka_join);
        }

        // --- Reader task: drains TCP, strips IAC, decodes, emits ----
        let encoding = self.encoding;
        let login_done = self.login_done.clone();
        let username = self.config.username.clone().unwrap_or_default();
        let password = self.config.password.clone().unwrap_or_default();
        let app_r = app.clone();
        let sid = session_id.clone();
        let writer_tx_for_login = tx.clone();

        let reader_join = tokio::spawn(async move {
            log::info!("telnet reader task started for {sid}");
            let mut rd = read_half;
            let mut buf = [0u8; 4096];
            let mut login_state = if username.is_empty() && password.is_empty() {
                LoginState::Done
            } else if username.is_empty() {
                LoginState::WaitingForPassword
            } else {
                LoginState::WaitingForUsername
            };
            // Tail of recently-decoded text, used for prompt detection.
            let mut tail = String::new();

            loop {
                let n = match rd.read(&mut buf).await {
                    Ok(0) => {
                        log::info!("telnet {sid}: read returned 0 (remote closed)");
                        emit_session_status(&app_r, &sid, "disconnected");
                        break;
                    }
                    Ok(n) => n,
                    Err(e) => {
                        log::error!("telnet {sid}: read error: {e}");
                        emit_session_error(&app_r, &sid, format!("read error: {e}"));
                        emit_session_status(&app_r, &sid, "disconnected");
                        break;
                    }
                };
                log::debug!("telnet {sid}: read {n} bytes");
                let (cleaned, response) = process_iac(&buf[..n]);
                if !response.is_empty() {
                    log::debug!(
                        "telnet {sid}: sending {} bytes of IAC response",
                        response.len()
                    );
                    let _ = writer_tx_for_login
                        .send(WriterCmd::Bytes(response))
                        .await;
                }
                if cleaned.is_empty() {
                    log::debug!("telnet {sid}: {n} bytes all stripped as IAC");
                    continue;
                }
                let (decoded, _enc, _had_errors) = encoding.decode(&cleaned);
                let text = decoded.into_owned();

                // Auto-login state machine
                if login_state != LoginState::Done {
                    tail.push_str(&text);
                    if tail.len() > 256 {
                        let cut = tail.len() - 256;
                        tail.drain(..cut);
                    }
                    match login_state {
                        LoginState::WaitingForUsername => {
                            if is_username_prompt(&tail) {
                                let mut line = username.clone();
                                line.push_str("\r\n");
                                let _ = writer_tx_for_login
                                    .send(WriterCmd::Bytes(line.into_bytes()))
                                    .await;
                                login_state = LoginState::WaitingForPassword;
                                tail.clear();
                            } else if is_password_prompt(&tail) {
                                // Server jumped directly to password
                                let mut line = password.clone();
                                line.push_str("\r\n");
                                let _ = writer_tx_for_login
                                    .send(WriterCmd::Bytes(line.into_bytes()))
                                    .await;
                                login_state = LoginState::Done;
                                *login_done.lock().await = true;
                                tail.clear();
                            }
                        }
                        LoginState::WaitingForPassword => {
                            if is_password_prompt(&tail) {
                                let mut line = password.clone();
                                line.push_str("\r\n");
                                let _ = writer_tx_for_login
                                    .send(WriterCmd::Bytes(line.into_bytes()))
                                    .await;
                                login_state = LoginState::Done;
                                *login_done.lock().await = true;
                                tail.clear();
                            }
                        }
                        LoginState::Done => {}
                    }
                }

                log::debug!("telnet {sid}: emitting {} chars", text.chars().count());
                emit_session_data(&app_r, &sid, text);
            }
            log::info!("telnet reader task ended for {sid}");
        });
        self.join.push(reader_join);

        Ok(())
    }

    async fn write(&mut self, data: &[u8]) -> Result<(), SessionError> {
        let tx = self
            .writer_tx
            .as_ref()
            .ok_or_else(|| SessionError::Other("session not connected".into()))?;

        // Encode outgoing UTF-8 text into the configured encoding.
        // The frontend sends strings as UTF-8 bytes; re-decode to &str then encode.
        let as_str = std::str::from_utf8(data)
            .map_err(|e| SessionError::Protocol(format!("invalid utf-8: {e}")))?;
        let (encoded, _, _) = self.encoding.encode(as_str);
        let mut bytes = encoded.into_owned();
        // Escape any bare 0xFF bytes by doubling them, per telnet IAC escaping.
        if bytes.contains(&IAC) {
            let mut escaped = Vec::with_capacity(bytes.len() + 4);
            for b in &bytes {
                escaped.push(*b);
                if *b == IAC {
                    escaped.push(IAC);
                }
            }
            bytes = escaped;
        }
        tx.send(WriterCmd::Bytes(bytes))
            .await
            .map_err(|e| SessionError::Other(format!("writer channel closed: {e}")))?;
        Ok(())
    }

    async fn resize(&mut self, cols: u16, rows: u16) -> Result<(), SessionError> {
        if let Some(tx) = &self.writer_tx {
            let _ = tx.send(WriterCmd::Resize(cols, rows)).await;
        }
        Ok(())
    }

    fn set_encoding(&mut self, encoding: &str) {
        self.encoding = encoding_for(encoding);
        self.config.encoding = encoding.to_string();
    }

    async fn disconnect(&mut self) -> Result<(), SessionError> {
        if let Some(tx) = self.writer_tx.take() {
            let _ = tx.send(WriterCmd::Close).await;
        }
        for h in self.join.drain(..) {
            h.abort();
        }
        Ok(())
    }
}

// --- Tests -------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_iac_plain_passthrough() {
        let input = b"hello world\r\n";
        assert_eq!(strip_iac(input), input.to_vec());
    }

    #[test]
    fn strip_iac_doubled_ff_unescapes() {
        let input = [b'a', IAC, IAC, b'b'];
        assert_eq!(strip_iac(&input), vec![b'a', IAC, b'b']);
    }

    #[test]
    fn strip_iac_will_wont_do_dont() {
        // IAC DO ECHO, then "x"
        let input = [IAC, DO, 0x01, b'x'];
        assert_eq!(strip_iac(&input), vec![b'x']);
        let input = [IAC, WILL, 0x03, b'y'];
        assert_eq!(strip_iac(&input), vec![b'y']);
        let input = [IAC, WONT, 0x01, b'z'];
        assert_eq!(strip_iac(&input), vec![b'z']);
        let input = [IAC, DONT, 0x01, b'w'];
        assert_eq!(strip_iac(&input), vec![b'w']);
    }

    #[test]
    fn strip_iac_subnegotiation() {
        // IAC SB NAWS 00 50 00 18 IAC SE then "A"
        let input = [
            IAC, SB, NAWS, 0x00, 0x50, 0x00, 0x18, IAC, SE, b'A',
        ];
        assert_eq!(strip_iac(&input), vec![b'A']);
    }

    #[test]
    fn strip_iac_mixed() {
        // "hi" + IAC DO ECHO + " " + IAC IAC + "!"
        let input = [b'h', b'i', IAC, DO, 0x01, b' ', IAC, IAC, b'!'];
        assert_eq!(strip_iac(&input), b"hi \xFF!".to_vec());
    }

    #[test]
    fn strip_iac_unterminated_sb_dropped() {
        // IAC SB ... without SE — everything from IAC is dropped.
        let input = [b'a', IAC, SB, 0x01, 0x02, 0x03];
        assert_eq!(strip_iac(&input), vec![b'a']);
    }

    #[test]
    fn username_prompt_detection() {
        assert!(is_username_prompt("login:"));
        assert!(is_username_prompt("Username: "));
        assert!(is_username_prompt("switch login:"));
        assert!(!is_username_prompt("Password:"));
        assert!(!is_username_prompt("welcome"));
    }

    #[test]
    fn password_prompt_detection() {
        assert!(is_password_prompt("Password:"));
        assert!(is_password_prompt("password: "));
        assert!(!is_password_prompt("login:"));
    }

    #[test]
    fn process_iac_responds_to_do_naws_with_will_and_size() {
        let input = [IAC, DO, NAWS];
        let (clean, resp) = process_iac(&input);
        assert!(clean.is_empty());
        // Expect IAC WILL NAWS followed by an IAC SB NAWS ... IAC SE frame.
        assert_eq!(&resp[..3], &[IAC, WILL, NAWS]);
        assert_eq!(&resp[3..5], &[IAC, SB]);
        assert_eq!(resp[5], NAWS);
        assert_eq!(&resp[resp.len() - 2..], &[IAC, SE]);
    }

    #[test]
    fn process_iac_declines_unknown_do() {
        let input = [IAC, DO, 0x20];
        let (_clean, resp) = process_iac(&input);
        assert_eq!(resp, vec![IAC, WONT, 0x20]);
    }

    #[test]
    fn process_iac_accepts_will_echo_and_sga() {
        let input = [IAC, WILL, OPT_ECHO, IAC, WILL, OPT_SGA, IAC, WILL, 0x20];
        let (_clean, resp) = process_iac(&input);
        assert_eq!(
            resp,
            vec![IAC, DO, OPT_ECHO, IAC, DO, OPT_SGA, IAC, DONT, 0x20]
        );
    }

    #[test]
    fn process_iac_responds_to_ttype_send() {
        // IAC SB TTYPE SEND IAC SE
        let input = [IAC, SB, OPT_TTYPE, 0x01, IAC, SE];
        let (clean, resp) = process_iac(&input);
        assert!(clean.is_empty());
        assert_eq!(&resp[..4], &[IAC, SB, OPT_TTYPE, 0]);
        assert_eq!(&resp[resp.len() - 2..], &[IAC, SE]);
        let body = &resp[4..resp.len() - 2];
        assert_eq!(body, b"XTERM-256COLOR");
    }

    #[test]
    fn naws_frame_encoding() {
        let f = naws_frame(80, 24);
        assert_eq!(f, [IAC, SB, NAWS, 0, 80, 0, 24, IAC, SE]);
        let f = naws_frame(300, 100);
        assert_eq!(f, [IAC, SB, NAWS, 1, 44, 0, 100, IAC, SE]);
    }
}
