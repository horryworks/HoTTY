//! Integration tests for the shared AI SSE stream drivers
//! (`services::ai::sse::run_{google,openai,anthropic}_sse_stream`).
//!
//! These exercise the *exact* loops production uses, but feed them a synthetic
//! `futures::stream` of byte chunks instead of a live HTTP response — so a whole
//! class of previously-untested behavior (chunk accumulation across arbitrary
//! byte boundaries, usage extraction, `[DONE]` handling, mid-stream transport
//! errors, user cancel with partial text, and concurrent-session isolation) is
//! now locked in without any network. The drivers are generic over the byte and
//! error types (`B: AsRef<[u8]>`, `E: Display`), which is what lets a test pass
//! `Result<Vec<u8>, String>` where production passes `reqwest`'s
//! `Result<Bytes, reqwest::Error>`.

use std::sync::Mutex;
use std::task::Poll;

use app_lib::services::ai::ai_provider::ChatResponseData;
use app_lib::services::ai::sse::{
    run_anthropic_sse_stream, run_google_sse_stream, run_openai_sse_stream, ChatSink,
};
use tokio_util::sync::CancellationToken;

/// Collecting sink: records every emitted event so a test can assert on the
/// `chunk` deltas that arrived (order + content) during a stream.
struct CollectingSink(Mutex<Vec<ChatResponseData>>);

impl CollectingSink {
    fn new() -> Self {
        Self(Mutex::new(Vec::new()))
    }

    /// The `content` of every `chunk` event, in arrival order.
    fn chunks(&self) -> Vec<String> {
        self.0
            .lock()
            .unwrap()
            .iter()
            .filter(|d| d.response_type == "chunk")
            .map(|d| d.content.clone())
            .collect()
    }
}

impl ChatSink for CollectingSink {
    fn emit(&self, data: ChatResponseData) {
        self.0.lock().unwrap().push(data);
    }
}

type Item = Result<Vec<u8>, String>;

/// A stream that yields each item in order and then ends (`None`).
fn stream_of(items: Vec<Item>) -> futures::stream::Iter<std::vec::IntoIter<Item>> {
    futures::stream::iter(items)
}

fn ok(bytes: &str) -> Item {
    Ok(bytes.as_bytes().to_vec())
}

// ---------------------------------------------------------------------------
// Google (Gemini / Vertex) format
// ---------------------------------------------------------------------------

#[tokio::test]
async fn google_accumulates_text_and_usage_across_chunks() {
    // Two text deltas plus a trailing usage line, delivered as a single blob and
    // then re-chunked byte-by-byte to prove the SseBuffer reassembly inside the
    // driver handles arbitrary network boundaries.
    let sse = concat!(
        "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"Hello\"}]}}]}\n\n",
        "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\" world\"}]}}]}\n\n",
        "data: {\"usageMetadata\":{\"promptTokenCount\":5,\"candidatesTokenCount\":2,\"totalTokenCount\":7}}\n\n",
    );
    // One byte per chunk — the most adversarial split possible.
    let items: Vec<Item> = sse.bytes().map(|b| Ok(vec![b])).collect();

    let sink = CollectingSink::new();
    let cancel = CancellationToken::new();
    let outcome = run_google_sse_stream(stream_of(items), &sink, "s1", &cancel)
        .await
        .expect("stream should complete normally");

    assert_eq!(outcome.full_response, "Hello world");
    assert_eq!(sink.chunks(), vec!["Hello", " world"]);
    let usage = outcome.usage.expect("usage should be reported");
    assert_eq!(usage.prompt_token_count, Some(5));
    assert_eq!(usage.candidates_token_count, Some(2));
    assert_eq!(usage.total_token_count, Some(7));
}

#[tokio::test]
async fn google_reassembles_multibyte_utf8_split_across_chunks() {
    // A Japanese reply split mid-character across chunk boundaries must arrive
    // intact (no U+FFFD), all the way through the JSON decode.
    let sse = "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"こんにちは\"}]}}]}\n\n";
    let bytes = sse.as_bytes();
    // Split into 3-byte chunks, which will fall mid-character.
    let items: Vec<Item> = bytes.chunks(3).map(|c| Ok(c.to_vec())).collect();

    let sink = CollectingSink::new();
    let cancel = CancellationToken::new();
    let outcome = run_google_sse_stream(stream_of(items), &sink, "s1", &cancel)
        .await
        .unwrap();

    assert_eq!(outcome.full_response, "こんにちは");
    assert!(!outcome.full_response.contains('\u{FFFD}'));
}

#[tokio::test]
async fn google_stream_error_propagates_after_emitting_partial_chunks() {
    // A chunk arrives and is emitted, then the transport dies mid-stream: the
    // driver must return Err (so the caller rolls back the user turn) while the
    // already-emitted chunk stays visible to the sink.
    let items: Vec<Item> = vec![
        ok("data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"Hello\"}]}}]}\n\n"),
        Err("connection reset".into()),
    ];

    let sink = CollectingSink::new();
    let cancel = CancellationToken::new();
    let result = run_google_sse_stream(stream_of(items), &sink, "s1", &cancel).await;

    let err = result.expect_err("a transport error must surface as Err");
    assert!(err.contains("Stream error"), "unexpected error text: {err}");
    assert!(err.contains("connection reset"));
    // The pre-error delta was still delivered.
    assert_eq!(sink.chunks(), vec!["Hello"]);
}

#[tokio::test]
async fn google_cancel_before_any_data_returns_empty() {
    // A pre-cancelled token with a stream that never yields: the cancel branch is
    // the only ready one, so the loop breaks immediately with no partial text.
    let cancel = CancellationToken::new();
    cancel.cancel();
    let pending = futures::stream::pending::<Item>();

    let sink = CollectingSink::new();
    let outcome = run_google_sse_stream(pending, &sink, "s1", &cancel)
        .await
        .expect("cancel is a normal (Ok) end, not an error");

    assert_eq!(outcome.full_response, "");
    assert!(sink.chunks().is_empty());
}

#[tokio::test]
async fn google_cancel_midstream_keeps_partial_text() {
    // Deterministic mid-stream cancel: the stream yields two deltas, then on its
    // next poll cancels the token and pends — so the loop breaks via cancel after
    // committing exactly the text seen so far.
    let cancel = CancellationToken::new();
    let cancel_from_stream = cancel.clone();
    let mut count = 0usize;
    let stream = futures::stream::poll_fn(move |_cx| -> Poll<Option<Item>> {
        count += 1;
        match count {
            1 => Poll::Ready(Some(ok(
                "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"Hello\"}]}}]}\n\n",
            ))),
            2 => Poll::Ready(Some(ok(
                "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\" world\"}]}}]}\n\n",
            ))),
            _ => {
                cancel_from_stream.cancel();
                Poll::Pending
            }
        }
    });

    let sink = CollectingSink::new();
    let outcome = run_google_sse_stream(stream, &sink, "s1", &cancel)
        .await
        .expect("cancel is a normal (Ok) end");

    assert!(cancel.is_cancelled());
    assert_eq!(outcome.full_response, "Hello world");
    assert_eq!(sink.chunks(), vec!["Hello", " world"]);
}

#[tokio::test]
async fn google_two_sessions_stream_independently() {
    // Two concurrent streams with distinct session ids and sinks must not bleed
    // into one another — the drivers hold no shared state.
    let items_a: Vec<Item> = vec![ok(
        "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"alpha\"}]}}]}\n\n",
    )];
    let items_b: Vec<Item> = vec![ok(
        "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"beta\"}]}}]}\n\n",
    )];

    let sink_a = CollectingSink::new();
    let sink_b = CollectingSink::new();
    let cancel = CancellationToken::new();

    let (out_a, out_b) = tokio::join!(
        run_google_sse_stream(stream_of(items_a), &sink_a, "sA", &cancel),
        run_google_sse_stream(stream_of(items_b), &sink_b, "sB", &cancel),
    );

    assert_eq!(out_a.unwrap().full_response, "alpha");
    assert_eq!(out_b.unwrap().full_response, "beta");
    assert_eq!(sink_a.chunks(), vec!["alpha"]);
    assert_eq!(sink_b.chunks(), vec!["beta"]);
}

// ---------------------------------------------------------------------------
// OpenAI format
// ---------------------------------------------------------------------------

#[tokio::test]
async fn openai_accumulates_deltas_ignores_done_and_reads_usage() {
    let items: Vec<Item> = vec![
        ok("data: {\"choices\":[{\"delta\":{\"content\":\"Hi\"}}]}\n\n"),
        ok("data: {\"choices\":[{\"delta\":{\"content\":\" there\"}}]}\n\n"),
        ok("data: {\"choices\":[{\"delta\":{}}],\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":2,\"total_tokens\":5}}\n\n"),
        ok("data: [DONE]\n\n"),
    ];

    let sink = CollectingSink::new();
    let cancel = CancellationToken::new();
    let outcome = run_openai_sse_stream(stream_of(items), &sink, "s1", &cancel)
        .await
        .unwrap();

    assert_eq!(outcome.full_response, "Hi there");
    assert_eq!(sink.chunks(), vec!["Hi", " there"]);
    let usage = outcome.usage.expect("usage should be reported");
    assert_eq!(usage.prompt_token_count, Some(3));
    assert_eq!(usage.candidates_token_count, Some(2));
    assert_eq!(usage.total_token_count, Some(5));
}

#[tokio::test]
async fn openai_stream_error_surfaces() {
    let items: Vec<Item> = vec![
        ok("data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n"),
        Err("broken pipe".into()),
    ];
    let sink = CollectingSink::new();
    let cancel = CancellationToken::new();
    let err = run_openai_sse_stream(stream_of(items), &sink, "s1", &cancel)
        .await
        .expect_err("must surface as Err");
    assert!(err.contains("Stream error"));
    assert_eq!(sink.chunks(), vec!["partial"]);
}

// ---------------------------------------------------------------------------
// Anthropic format (event-typed)
// ---------------------------------------------------------------------------

#[tokio::test]
async fn anthropic_reads_events_text_and_token_usage() {
    let items: Vec<Item> = vec![
        ok("event: message_start\n"),
        ok("data: {\"message\":{\"usage\":{\"input_tokens\":10}}}\n\n"),
        ok("event: content_block_delta\n"),
        ok("data: {\"delta\":{\"text\":\"A\"}}\n\n"),
        ok("event: content_block_delta\n"),
        ok("data: {\"delta\":{\"text\":\"B\"}}\n\n"),
        ok("event: message_delta\n"),
        ok("data: {\"usage\":{\"output_tokens\":4}}\n\n"),
    ];

    let sink = CollectingSink::new();
    let cancel = CancellationToken::new();
    let outcome = run_anthropic_sse_stream(stream_of(items), &sink, "s1", &cancel)
        .await
        .unwrap();

    assert_eq!(outcome.full_response, "AB");
    assert_eq!(sink.chunks(), vec!["A", "B"]);
    // Anthropic always reports usage (assembled from input + output counts).
    let usage = outcome.usage.expect("usage always present for anthropic");
    assert_eq!(usage.prompt_token_count, Some(10));
    assert_eq!(usage.candidates_token_count, Some(4));
    assert_eq!(usage.total_token_count, Some(14));
}

#[tokio::test]
async fn anthropic_event_split_across_chunks() {
    // The `event:`/`data:` line pair split at an odd byte boundary must still be
    // routed to the right handler.
    let sse = concat!(
        "event: content_block_delta\n",
        "data: {\"delta\":{\"text\":\"chunked\"}}\n\n",
    );
    let bytes = sse.as_bytes();
    let items: Vec<Item> = bytes.chunks(5).map(|c| Ok(c.to_vec())).collect();

    let sink = CollectingSink::new();
    let cancel = CancellationToken::new();
    let outcome = run_anthropic_sse_stream(stream_of(items), &sink, "s1", &cancel)
        .await
        .unwrap();

    assert_eq!(outcome.full_response, "chunked");
    assert_eq!(sink.chunks(), vec!["chunked"]);
}
