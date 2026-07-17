/// Parsed SSE (Server-Sent Events) line.
#[derive(Debug, PartialEq)]
pub enum SseLine<'a> {
    /// An `event:` line with the event type.
    Event(&'a str),
    /// A `data:` line with the data payload.
    Data(&'a str),
    /// An empty line (event boundary).
    Empty,
    /// Any other line (comments, unknown fields, etc.) — ignored.
    Other,
}

/// Parse a single SSE line into its type.
pub fn parse_sse_line(line: &str) -> SseLine<'_> {
    if line.is_empty() {
        SseLine::Empty
    } else if let Some(rest) = line.strip_prefix("data: ") {
        SseLine::Data(rest)
    } else if line == "data:" {
        SseLine::Data("")
    } else if let Some(rest) = line.strip_prefix("event: ") {
        SseLine::Event(rest)
    } else if line == "event:" {
        SseLine::Event("")
    } else {
        SseLine::Other
    }
}

/// Buffer for accumulating streaming bytes and extracting complete SSE lines.
///
/// Holds RAW BYTES (not a String) so a multi-byte UTF-8 character split across
/// two network chunks is not mangled: `from_utf8_lossy` per chunk would turn a
/// half-received character into `U+FFFD` and commit the garbled text to history.
/// Bytes are only decoded once a complete line (up to `\n`) has arrived.
pub struct SseBuffer {
    buffer: Vec<u8>,
}

impl Default for SseBuffer {
    fn default() -> Self {
        Self::new()
    }
}

impl SseBuffer {
    /// Hard cap on the unflushed buffer. A well-formed SSE stream emits a newline
    /// per event and token deltas are tiny, so a buffer that grows past this
    /// without a newline indicates a malformed or hostile stream — drop it rather
    /// than let it exhaust process memory (the streaming chat paths have no
    /// overall request timeout, only a connect timeout).
    const MAX_BUFFER_BYTES: usize = 8 * 1024 * 1024;

    pub fn new() -> Self {
        Self { buffer: Vec::new() }
    }

    /// Append raw bytes and return the complete lines that are now available.
    /// Incomplete lines (no trailing newline yet) — including a partial multi-byte
    /// UTF-8 sequence at a chunk boundary — are retained in the buffer until the
    /// rest arrives. Only complete lines are decoded (lossily, so a genuinely
    /// invalid byte inside a full line still degrades gracefully).
    pub fn push(&mut self, chunk: &[u8]) -> Vec<String> {
        self.buffer.extend_from_slice(chunk);

        let mut lines = Vec::new();
        // Split off each complete line at every `\n`, decoding only whole lines.
        while let Some(pos) = self.buffer.iter().position(|&b| b == b'\n') {
            let mut line_bytes: Vec<u8> = self.buffer.drain(..=pos).collect();
            line_bytes.pop(); // drop the trailing '\n'
            if line_bytes.last() == Some(&b'\r') {
                line_bytes.pop(); // drop a trailing '\r' (CRLF)
            }
            lines.push(String::from_utf8_lossy(&line_bytes).into_owned());
        }
        // Guard against unbounded growth on a newline-free stream: if the retained
        // partial line has blown past the cap, discard it. The stream is already
        // abnormal at this point, so dropping the malformed partial is acceptable.
        if self.buffer.len() > Self::MAX_BUFFER_BYTES {
            self.buffer.clear();
        }
        lines
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_data_line() {
        assert_eq!(
            parse_sse_line("data: {\"text\":\"hello\"}"),
            SseLine::Data("{\"text\":\"hello\"}")
        );
    }

    #[test]
    fn parse_empty_data_line() {
        assert_eq!(parse_sse_line("data:"), SseLine::Data(""));
    }

    #[test]
    fn parse_event_line() {
        assert_eq!(
            parse_sse_line("event: content_block_delta"),
            SseLine::Event("content_block_delta")
        );
    }

    #[test]
    fn parse_empty_line() {
        assert_eq!(parse_sse_line(""), SseLine::Empty);
    }

    #[test]
    fn parse_comment_line() {
        assert_eq!(parse_sse_line(": keep-alive"), SseLine::Other);
    }

    #[test]
    fn parse_unknown_field() {
        assert_eq!(parse_sse_line("id: 42"), SseLine::Other);
    }

    #[test]
    fn sse_buffer_splits_lines() {
        let mut buf = SseBuffer::new();
        let lines = buf.push(b"data: hello\ndata: world\n");
        assert_eq!(lines, vec!["data: hello", "data: world"]);
    }

    #[test]
    fn sse_buffer_handles_partial_lines() {
        let mut buf = SseBuffer::new();
        let lines1 = buf.push(b"data: hel");
        assert!(lines1.is_empty());
        let lines2 = buf.push(b"lo\n");
        assert_eq!(lines2, vec!["data: hello"]);
    }

    #[test]
    fn sse_buffer_handles_crlf() {
        let mut buf = SseBuffer::new();
        let lines = buf.push(b"data: test\r\n");
        assert_eq!(lines, vec!["data: test"]);
    }

    #[test]
    fn sse_buffer_reassembles_utf8_split_across_chunks() {
        // "こんにちは" — each kana is 3 UTF-8 bytes. Split the stream mid-character
        // (a real network-chunk boundary) and confirm the reassembled line is intact,
        // not mangled into replacement characters.
        let full = "data: こんにちは\n".as_bytes().to_vec();
        let split = 9; // partway through a multi-byte character
        let mut buf = SseBuffer::new();
        assert!(buf.push(&full[..split]).is_empty());
        let lines = buf.push(&full[split..]);
        assert_eq!(lines, vec!["data: こんにちは"]);
        assert!(!lines[0].contains('\u{FFFD}'));
    }

    #[test]
    fn sse_buffer_reassembles_utf8_split_one_byte_at_a_time() {
        let full = "data: 日本語\n".as_bytes().to_vec();
        let mut buf = SseBuffer::new();
        let mut out = Vec::new();
        for b in &full {
            out.extend(buf.push(&[*b]));
        }
        assert_eq!(out, vec!["data: 日本語"]);
    }

    #[test]
    fn sse_buffer_multiple_chunks() {
        let mut buf = SseBuffer::new();
        assert!(buf.push(b"event: msg").is_empty());
        assert!(buf.push(b"_start").is_empty());
        let lines = buf.push(b"\ndata: {}\n\n");
        assert_eq!(lines, vec!["event: msg_start", "data: {}", ""]);
    }

    #[test]
    fn data_done_marker() {
        assert_eq!(parse_sse_line("data: [DONE]"), SseLine::Data("[DONE]"));
    }

    #[test]
    fn sse_buffer_caps_unbounded_growth() {
        let mut buf = SseBuffer::new();
        // A newline-free stream (malformed/hostile) must not grow without bound.
        let chunk = vec![b'x'; 64 * 1024]; // 64 KiB, no newline
        for _ in 0..256 {
            assert!(buf.push(&chunk).is_empty());
        }
        assert!(
            buf.buffer.len() <= SseBuffer::MAX_BUFFER_BYTES,
            "buffer must stay capped, got {} bytes",
            buf.buffer.len()
        );
        // The cap must not break normal line extraction afterwards.
        let lines = buf.push(b"\ndata: ok\n");
        assert_eq!(lines.last().map(String::as_str), Some("data: ok"));
    }
}
