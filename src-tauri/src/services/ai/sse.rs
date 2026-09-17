use futures::StreamExt;
use serde_json::Value;
use tokio_util::sync::CancellationToken;

use crate::services::ai::ai_provider::{ChatResponseData, ChatResponseKind, TokenUsage};
use crate::services::ai::classifier::extract_gemini_text;

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

    /// Take the final line when the stream ends without a trailing newline.
    /// Without this the last event of such a stream was silently dropped, cutting
    /// off the end of the answer (or its usage / finish reason).
    pub fn flush(&mut self) -> Option<String> {
        if self.buffer.is_empty() {
            return None;
        }
        let mut line_bytes = std::mem::take(&mut self.buffer);
        if line_bytes.last() == Some(&b'\r') {
            line_bytes.pop();
        }
        Some(String::from_utf8_lossy(&line_bytes).into_owned())
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
    /// An error the provider reported INSIDE the stream (HTTP 200, then an
    /// error event or a blocked finish). Reading stops at the first one.
    pub stream_error: Option<StreamError>,
}

/// An error a provider sent as part of an otherwise successful stream.
///
/// Kept structured rather than pre-formatted: Vertex AI maps API errors to its
/// own actionable wording, and a content-filter stop must not read like an
/// outage.
#[derive(Debug, Clone, PartialEq)]
pub enum StreamError {
    /// An `error` object: overloaded, rate limited, internal error, …
    Api {
        code: Option<u64>,
        kind: Option<String>,
        message: String,
    },
    /// The provider withheld or cut off the answer (safety filter, recitation, …).
    Blocked { reason: String },
}

/// A top-level `error` in a stream event, in any of the shapes the providers
/// use: Anthropic `{"type":"error","error":{"type","message"}}`, OpenAI
/// `{"error":{"message","type","code"}}`, Google `{"error":{"code","message","status"}}`,
/// or a bare `{"error":"message"}`.
pub(crate) fn api_error(v: &Value) -> Option<StreamError> {
    let err = v.get("error")?;
    if let Some(message) = err.as_str() {
        return Some(StreamError::Api {
            code: None,
            kind: None,
            message: message.to_string(),
        });
    }
    if !err.is_object() {
        return None;
    }
    let text = |key: &str| err.get(key).and_then(Value::as_str).map(str::to_string);
    Some(StreamError::Api {
        code: err.get("code").and_then(Value::as_u64),
        // Anthropic/OpenAI name the category `type`; Google calls it `status`.
        // OpenAI sometimes only has a string `code` such as "rate_limit_exceeded".
        kind: text("type")
            .or_else(|| text("status"))
            .or_else(|| text("code")),
        message: text("message").unwrap_or_default(),
    })
}

/// Finish reasons that mean a Google answer ended normally.
const GOOGLE_OK_FINISH: &[&str] = &["", "STOP", "MAX_TOKENS", "FINISH_REASON_UNSPECIFIED"];
/// Finish reasons that mean Google withheld or cut off the answer.
const GOOGLE_BLOCKED_FINISH: &[&str] = &[
    "SAFETY",
    "RECITATION",
    "BLOCKLIST",
    "PROHIBITED_CONTENT",
    "SPII",
    "LANGUAGE",
    "IMAGE_SAFETY",
    "MALFORMED_FUNCTION_CALL",
    "OTHER",
];

/// A Google (Gemini / Vertex) event that blocks the prompt or ends the answer
/// abnormally. `have_text` is whether any answer text has arrived: a finish
/// reason this code does not know yet only counts as a failure when nothing
/// was produced, so a new harmless reason cannot turn good answers into errors.
pub(crate) fn google_block(v: &Value, have_text: bool) -> Option<StreamError> {
    if let Some(reason) = v
        .pointer("/promptFeedback/blockReason")
        .and_then(Value::as_str)
        .filter(|r| !r.is_empty())
    {
        return Some(StreamError::Blocked {
            reason: reason.to_string(),
        });
    }
    let reason = v
        .pointer("/candidates/0/finishReason")
        .and_then(Value::as_str)?;
    if GOOGLE_OK_FINISH.contains(&reason) {
        return None;
    }
    if GOOGLE_BLOCKED_FINISH.contains(&reason) || !have_text {
        return Some(StreamError::Blocked {
            reason: reason.to_string(),
        });
    }
    None
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
/// decoded line. `on_line` returns `true` to stop reading (the provider reported
/// an error: a server that keeps the connection open afterwards must not leave
/// the turn hanging). Returns `Ok(())` on a normal end, on such a stop, or when
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
    F: FnMut(&str) -> bool + Send,
{
    let mut sse_buf = SseBuffer::new();
    loop {
        tokio::select! {
            // A cancel that is already set wins over data that is also ready.
            biased;
            _ = cancel_token.cancelled() => break,
            chunk = stream.next() => {
                match chunk {
                    Some(Ok(bytes)) => {
                        for line in sse_buf.push(bytes.as_ref()) {
                            if on_line(&line) {
                                return Ok(());
                            }
                        }
                    }
                    Some(Err(e)) => return Err(format!("Stream error: {e}")),
                    None => {
                        // The last event may lack its trailing newline.
                        if let Some(line) = sse_buf.flush() {
                            on_line(&line);
                        }
                        break;
                    }
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
    let mut stream_error: Option<StreamError> = None;
    drive_sse(stream, cancel_token, |line| {
        let SseLine::Data(data) = parse_sse_line(line) else {
            return false;
        };
        if data.is_empty() {
            return false;
        }
        let Ok(parsed) = serde_json::from_str::<Value>(data) else {
            return false;
        };
        if let Some(e) = api_error(&parsed) {
            stream_error = Some(e);
            return true;
        }
        if let Some(text) = extract_gemini_text(&parsed) {
            full_response.push_str(&text);
            sink.emit(chunk_event(session_id, &text));
        }
        if let Some(usage) = parsed.get("usageMetadata") {
            last_usage = Some(google_usage(usage));
        }
        // After this event's text, so a final chunk that carries both the last
        // words and `STOP` is judged with that text counted.
        if let Some(e) = google_block(&parsed, !full_response.is_empty()) {
            stream_error = Some(e);
            return true;
        }
        false
    })
    .await?;
    Ok(StreamOutcome {
        full_response,
        usage: last_usage,
        stream_error,
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
    let mut stream_error: Option<StreamError> = None;
    drive_sse(stream, cancel_token, |line| {
        let SseLine::Data(data) = parse_sse_line(line) else {
            return false;
        };
        if data.is_empty() || data == "[DONE]" {
            return false;
        }
        let Ok(parsed) = serde_json::from_str::<Value>(data) else {
            return false;
        };
        if let Some(e) = api_error(&parsed) {
            stream_error = Some(e);
            return true;
        }
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
        if parsed
            .pointer("/choices/0/finish_reason")
            .and_then(Value::as_str)
            == Some("content_filter")
        {
            stream_error = Some(StreamError::Blocked {
                reason: "content_filter".to_string(),
            });
            return true;
        }
        false
    })
    .await?;
    Ok(StreamOutcome {
        full_response,
        usage: last_usage,
        stream_error,
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
    let mut stream_error: Option<StreamError> = None;
    drive_sse(stream, cancel_token, |line| {
        let data = match parse_sse_line(line) {
            SseLine::Event(event) => {
                current_event = event.to_string();
                return false;
            }
            SseLine::Data(data) if !data.is_empty() => data,
            _ => return false,
        };
        let Ok(parsed) = serde_json::from_str::<Value>(data) else {
            return false;
        };
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
            // e.g. `overloaded_error` mid-answer. Used to fall into the
            // catch-all and be ignored, so a cut-off answer was shown as done.
            "error" => {
                stream_error = Some(api_error(&parsed).unwrap_or(StreamError::Api {
                    code: None,
                    kind: None,
                    message: String::new(),
                }));
                return true;
            }
            _ => {}
        }
        false
    })
    .await?;
    Ok(StreamOutcome {
        full_response,
        usage: Some(TokenUsage {
            prompt_token_count: Some(input_tokens),
            candidates_token_count: Some(output_tokens),
            total_token_count: Some(input_tokens + output_tokens),
        }),
        stream_error,
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

    #[test]
    fn sse_buffer_flush_returns_an_unterminated_last_line() {
        let mut buf = SseBuffer::new();
        assert_eq!(buf.push(b"data: a\ndata: b"), vec!["data: a"]);
        assert_eq!(buf.flush().as_deref(), Some("data: b"));
        assert_eq!(buf.flush(), None, "flushing empties the buffer");
    }

    #[test]
    fn sse_buffer_flush_strips_cr_and_is_none_when_empty() {
        let mut buf = SseBuffer::new();
        assert_eq!(buf.flush(), None);
        assert!(buf.push(b"data: x\r").is_empty());
        assert_eq!(buf.flush().as_deref(), Some("data: x"));
    }

    fn json(s: &str) -> Value {
        serde_json::from_str(s).unwrap()
    }

    #[test]
    fn api_error_reads_every_provider_shape() {
        assert_eq!(
            api_error(&json(
                r#"{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}"#
            )),
            Some(StreamError::Api {
                code: None,
                kind: Some("overloaded_error".into()),
                message: "Overloaded".into(),
            })
        );
        assert_eq!(
            api_error(&json(
                r#"{"error":{"code":503,"message":"try later","status":"UNAVAILABLE"}}"#
            )),
            Some(StreamError::Api {
                code: Some(503),
                kind: Some("UNAVAILABLE".into()),
                message: "try later".into(),
            })
        );
        assert_eq!(
            api_error(&json(
                r#"{"error":{"message":"m","type":null,"code":"rate_limit_exceeded"}}"#
            )),
            Some(StreamError::Api {
                code: None,
                kind: Some("rate_limit_exceeded".into()),
                message: "m".into(),
            })
        );
        assert_eq!(
            api_error(&json(r#"{"error":"plain"}"#)),
            Some(StreamError::Api {
                code: None,
                kind: None,
                message: "plain".into(),
            })
        );
    }

    #[test]
    fn api_error_ignores_ordinary_events() {
        assert_eq!(
            api_error(&json(r#"{"choices":[{"delta":{"content":"hi"}}]}"#)),
            None
        );
        assert_eq!(api_error(&json(r#"{"error":null}"#)), None);
    }

    #[test]
    fn google_block_classifies_finish_reasons() {
        let finish = |r: &str| json(&format!(r#"{{"candidates":[{{"finishReason":"{r}"}}]}}"#));
        let blocked = |r: &str| {
            Some(StreamError::Blocked {
                reason: r.to_string(),
            })
        };
        // Normal endings — with or without text.
        for ok in ["STOP", "MAX_TOKENS", "FINISH_REASON_UNSPECIFIED", ""] {
            assert_eq!(google_block(&finish(ok), false), None, "{ok}");
            assert_eq!(google_block(&finish(ok), true), None, "{ok}");
        }
        // Known abnormal endings — even after some text.
        for bad in ["SAFETY", "RECITATION", "PROHIBITED_CONTENT", "OTHER"] {
            assert_eq!(google_block(&finish(bad), true), blocked(bad), "{bad}");
        }
        // An unknown reason only fails a turn that produced nothing.
        assert_eq!(google_block(&finish("NEW_THING"), true), None);
        assert_eq!(
            google_block(&finish("NEW_THING"), false),
            blocked("NEW_THING")
        );
        // No finish reason yet: a mid-stream chunk.
        assert_eq!(
            google_block(
                &json(r#"{"candidates":[{"content":{"parts":[{"text":"a"}]}}]}"#),
                false
            ),
            None
        );
    }

    #[test]
    fn google_block_reports_a_blocked_prompt() {
        assert_eq!(
            google_block(
                &json(r#"{"promptFeedback":{"blockReason":"PROHIBITED_CONTENT"}}"#),
                false
            ),
            Some(StreamError::Blocked {
                reason: "PROHIBITED_CONTENT".into()
            })
        );
    }
}
