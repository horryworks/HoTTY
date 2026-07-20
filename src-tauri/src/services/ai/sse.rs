use futures::StreamExt;
use serde_json::Value;
use tokio_util::sync::CancellationToken;

use crate::services::ai::ai_provider::{ChatResponseData, ChatResponseKind, TokenUsage};

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
// Shared streaming drivers
// ---------------------------------------------------------------------------
//
// The per-chunk SSE consume loop used to be copy-pasted into every provider
// (openai/gemini/anthropic emitted inline + set an `errored` flag; vertex's
// `stream_google_response` / `stream_anthropic_response` returned the accumulated
// text). Unified here behind a Tauri-free [`ChatSink`] so a single, tested loop
// serves all four providers and can be exercised end-to-end by
// `tests/ai_streaming.rs` with a synthetic byte stream (no live HTTP).

/// Sink for streamed chat events. Decouples the SSE consume loop from Tauri's
/// `AppHandle` so the loops are testable with a collecting sink. Production uses
/// `ai_provider::AppHandleSink`, which forwards to `emit_chat_response`.
///
/// `Sync` (supertrait): the stream drivers hold `&S` across `.await` points, and
/// `send_message` runs on the multi-thread runtime, so the shared reference must
/// be `Send` — which for `&S` means `S: Sync`.
pub trait ChatSink: Sync {
    fn emit(&self, data: ChatResponseData);
}

/// Text + latest usage accumulated from a streamed assistant turn. Returned on
/// normal completion or user cancel (with whatever partial text arrived); a
/// transport/stream error instead yields `Err` so the caller can surface it and
/// roll back the pending user turn.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct StreamOutcome {
    pub full_response: String,
    pub usage: Option<TokenUsage>,
}

/// Build a `chunk` event for a single text delta.
fn chunk_event(session_id: &str, text: &str) -> ChatResponseData {
    ChatResponseData {
        session_id: session_id.to_string(),
        response_type: ChatResponseKind::Chunk,
        content: text.to_string(),
        usage_metadata: None,
    }
}

/// Extract Google-format (`usageMetadata`) token counts.
fn google_usage(usage: &Value) -> TokenUsage {
    TokenUsage {
        prompt_token_count: usage
            .get("promptTokenCount")
            .and_then(|v| v.as_u64())
            .map(|v| v as u32),
        candidates_token_count: usage
            .get("candidatesTokenCount")
            .and_then(|v| v.as_u64())
            .map(|v| v as u32),
        total_token_count: usage
            .get("totalTokenCount")
            .and_then(|v| v.as_u64())
            .map(|v| v as u32),
    }
}

/// Drive an SSE byte stream to completion, invoking `on_line` for every complete
/// decoded line. Returns `Ok(())` on a normal end (stream exhausted) or when
/// `cancel_token` fires, and `Err` on a transport/stream error. Generic over the
/// byte and error types so tests can feed a synthetic `futures::stream::iter`
/// without a live HTTP response (production passes `reqwest`'s `bytes_stream()`).
async fn drive_sse<St, B, E, F>(
    mut stream: St,
    cancel_token: &CancellationToken,
    mut on_line: F,
) -> Result<(), String>
where
    St: futures::Stream<Item = Result<B, E>> + Unpin + Send,
    B: AsRef<[u8]> + Send,
    E: std::fmt::Display + Send,
    F: FnMut(&str) + Send,
{
    let mut sse_buf = SseBuffer::new();
    loop {
        tokio::select! {
            _ = cancel_token.cancelled() => break,
            chunk = stream.next() => {
                match chunk {
                    Some(Ok(bytes)) => {
                        for line in sse_buf.push(bytes.as_ref()) {
                            on_line(&line);
                        }
                    }
                    Some(Err(e)) => return Err(format!("Stream error: {e}")),
                    None => break,
                }
            }
        }
    }
    Ok(())
}

/// Consume a Google-format (Gemini / Vertex `streamGenerateContent`) SSE stream,
/// emitting each text delta as a `chunk` event and accumulating the full text and
/// latest `usageMetadata`.
pub async fn run_google_sse_stream<S, St, B, E>(
    stream: St,
    sink: &S,
    session_id: &str,
    cancel_token: &CancellationToken,
) -> Result<StreamOutcome, String>
where
    S: ChatSink,
    St: futures::Stream<Item = Result<B, E>> + Unpin + Send,
    B: AsRef<[u8]> + Send,
    E: std::fmt::Display + Send,
{
    let mut full_response = String::new();
    let mut last_usage: Option<TokenUsage> = None;
    drive_sse(stream, cancel_token, |line| {
        if let SseLine::Data(data) = parse_sse_line(line) {
            if data.is_empty() {
                return;
            }
            if let Ok(parsed) = serde_json::from_str::<Value>(data) {
                if let Some(text) = parsed
                    .pointer("/candidates/0/content/parts/0/text")
                    .and_then(|v| v.as_str())
                {
                    if !text.is_empty() {
                        full_response.push_str(text);
                        sink.emit(chunk_event(session_id, text));
                    }
                }
                if let Some(usage) = parsed.get("usageMetadata") {
                    last_usage = Some(google_usage(usage));
                }
            }
        }
    })
    .await?;
    Ok(StreamOutcome {
        full_response,
        usage: last_usage,
    })
}

/// Consume an OpenAI Chat Completions SSE stream (`choices[0].delta.content`),
/// emitting each delta as a `chunk` event. Usage arrives in a trailing `usage`
/// object (requires `stream_options.include_usage`); `[DONE]` is ignored.
pub async fn run_openai_sse_stream<S, St, B, E>(
    stream: St,
    sink: &S,
    session_id: &str,
    cancel_token: &CancellationToken,
) -> Result<StreamOutcome, String>
where
    S: ChatSink,
    St: futures::Stream<Item = Result<B, E>> + Unpin + Send,
    B: AsRef<[u8]> + Send,
    E: std::fmt::Display + Send,
{
    let mut full_response = String::new();
    let mut last_usage: Option<TokenUsage> = None;
    drive_sse(stream, cancel_token, |line| {
        if let SseLine::Data(data) = parse_sse_line(line) {
            if data.is_empty() || data == "[DONE]" {
                return;
            }
            if let Ok(parsed) = serde_json::from_str::<Value>(data) {
                if let Some(text) = parsed
                    .pointer("/choices/0/delta/content")
                    .and_then(|v| v.as_str())
                {
                    if !text.is_empty() {
                        full_response.push_str(text);
                        sink.emit(chunk_event(session_id, text));
                    }
                }
                if let Some(usage) = parsed.get("usage") {
                    last_usage = Some(TokenUsage {
                        prompt_token_count: usage
                            .get("prompt_tokens")
                            .and_then(|v| v.as_u64())
                            .map(|v| v as u32),
                        candidates_token_count: usage
                            .get("completion_tokens")
                            .and_then(|v| v.as_u64())
                            .map(|v| v as u32),
                        total_token_count: usage
                            .get("total_tokens")
                            .and_then(|v| v.as_u64())
                            .map(|v| v as u32),
                    });
                }
            }
        }
    })
    .await?;
    Ok(StreamOutcome {
        full_response,
        usage: last_usage,
    })
}

/// Consume an Anthropic Messages SSE stream (event-typed: `content_block_delta`
/// for text, `message_start` / `message_delta` for token usage), emitting each
/// text delta as a `chunk` event. Usage is always reported (assembled from the
/// input/output token counts), so the caller decides whether to surface it.
pub async fn run_anthropic_sse_stream<S, St, B, E>(
    stream: St,
    sink: &S,
    session_id: &str,
    cancel_token: &CancellationToken,
) -> Result<StreamOutcome, String>
where
    S: ChatSink,
    St: futures::Stream<Item = Result<B, E>> + Unpin + Send,
    B: AsRef<[u8]> + Send,
    E: std::fmt::Display + Send,
{
    let mut full_response = String::new();
    let mut current_event = String::new();
    let mut input_tokens: u32 = 0;
    let mut output_tokens: u32 = 0;
    drive_sse(stream, cancel_token, |line| match parse_sse_line(line) {
        SseLine::Event(event) => current_event = event.to_string(),
        SseLine::Data(data) => {
            if data.is_empty() {
                return;
            }
            if let Ok(parsed) = serde_json::from_str::<Value>(data) {
                match current_event.as_str() {
                    "content_block_delta" => {
                        if let Some(text) = parsed.pointer("/delta/text").and_then(|v| v.as_str()) {
                            if !text.is_empty() {
                                full_response.push_str(text);
                                sink.emit(chunk_event(session_id, text));
                            }
                        }
                    }
                    "message_start" => {
                        if let Some(t) = parsed
                            .pointer("/message/usage/input_tokens")
                            .and_then(|v| v.as_u64())
                        {
                            input_tokens = t as u32;
                        }
                    }
                    "message_delta" => {
                        if let Some(t) = parsed
                            .pointer("/usage/output_tokens")
                            .and_then(|v| v.as_u64())
                        {
                            output_tokens = t as u32;
                        }
                    }
                    _ => {}
                }
            }
        }
        _ => {}
    })
    .await?;
    Ok(StreamOutcome {
        full_response,
        usage: Some(TokenUsage {
            prompt_token_count: Some(input_tokens),
            candidates_token_count: Some(output_tokens),
            total_token_count: Some(input_tokens + output_tokens),
        }),
    })
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
