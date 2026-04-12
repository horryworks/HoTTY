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
pub struct SseBuffer {
    buffer: String,
}

impl Default for SseBuffer {
    fn default() -> Self {
        Self::new()
    }
}

impl SseBuffer {
    pub fn new() -> Self {
        Self {
            buffer: String::new(),
        }
    }

    /// Append raw bytes and return an iterator over complete lines.
    /// Incomplete lines (without a trailing newline) are retained in the buffer.
    pub fn push(&mut self, chunk: &[u8]) -> Vec<String> {
        self.buffer
            .push_str(&String::from_utf8_lossy(chunk));

        let mut lines = Vec::new();
        while let Some(pos) = self.buffer.find('\n') {
            let line = self.buffer[..pos].trim_end_matches('\r').to_string();
            lines.push(line);
            self.buffer.drain(..=pos);
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
}
