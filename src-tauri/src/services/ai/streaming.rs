//! Shared helpers for AI chat streaming.
//!
//! The full per-chunk SSE consume loop is intentionally NOT unified here yet:
//! the inline-emit providers (Gemini/OpenAI/Anthropic) and Vertex's
//! return-the-accumulated-text pair have different control flow, and streaming
//! is a core feature with no integration test, so a closure-driven rewrite
//! carries more risk than its dedup is worth. The behavioral bug that the
//! duplication caused (divergent error/cancel history handling) is already
//! fixed and unified across providers. What *is* shared here is the small,
//! identical history-finalization rule, so the cancel/empty/format wording
//! can't drift between providers.

use std::future::Future;

use tokio_util::sync::CancellationToken;

use crate::services::ai::ai_provider::TokenUsage;
use crate::services::ai::sse::{StreamError, StreamOutcome};

/// Run `fut` unless `cancel` fires first (`None`). The stream loop already
/// watches the token; this covers the waits before it — the request itself and
/// an error body — which the HTTP client would otherwise let run on, keeping the
/// send (and the conversation's queue behind it) stuck after a Stop.
pub async fn cancellable<F: Future>(cancel: &CancellationToken, fut: F) -> Option<F::Output> {
    tokio::select! {
        biased;
        _ = cancel.cancelled() => None,
        r = fut => Some(r),
    }
}

/// What a provider does with a stream that ended without a transport error.
#[derive(Debug, PartialEq)]
pub enum TurnResolution {
    /// Commit the answer and emit `done`.
    Done {
        content: String,
        usage: Option<TokenUsage>,
    },
    /// The user stopped it: commit the partial text as cancelled, emit nothing.
    Cancelled { partial: String },
    /// Emit `error` and drop the pending user turn. The frontend discards the
    /// partial answer it was showing, so history must not keep it either.
    Failed(TurnFailure),
}

#[derive(Debug, PartialEq)]
pub enum TurnFailure {
    /// The provider reported an error or a block inside the stream.
    Stream(StreamError),
    /// The stream ended normally with no text. Committing an empty assistant
    /// turn would make Anthropic reject every later request in the conversation.
    Empty,
}

/// Decide how a finished stream closes the turn. Order matters: a user cancel
/// wins over everything (nobody is waiting for an error), then a reported
/// error, then an empty answer.
pub fn resolve_turn(outcome: StreamOutcome, cancelled: bool) -> TurnResolution {
    if cancelled {
        return TurnResolution::Cancelled {
            partial: outcome.full_response,
        };
    }
    if let Some(e) = outcome.stream_error {
        return TurnResolution::Failed(TurnFailure::Stream(e));
    }
    if outcome.full_response.is_empty() {
        return TurnResolution::Failed(TurnFailure::Empty);
    }
    TurnResolution::Done {
        content: outcome.full_response,
        usage: outcome.usage,
    }
}

/// Compute the assistant-turn content to commit to chat history after a stream
/// ends normally or via user cancel.
///
/// - normal completion: the full accumulated response.
/// - cancel with partial text: the text plus a `[cancelled by user]` marker.
/// - cancel before any text: a `[cancelled before response]` placeholder so the
///   user/assistant alternation the chat APIs require is preserved.
pub fn finalize_assistant_content(full_response: &str, cancelled: bool) -> String {
    if !cancelled {
        return full_response.to_string();
    }
    if full_response.is_empty() {
        "[cancelled before response]".to_string()
    } else {
        format!("{full_response}\n\n[cancelled by user]")
    }
}

/// Default cap on the number of messages kept per session in a provider's
/// in-memory chat history. Interim guard against unbounded growth; the real
/// bound is the model's context window. Kept generous so normal sessions are
/// never trimmed.
pub const MAX_HISTORY_MESSAGES: usize = 200;

/// Trim a chat history in place so it holds at most `max_messages`, dropping the
/// oldest turns first. Messages are removed in **pairs** from the front so the
/// user/assistant alternation the chat APIs require is preserved (removing an
/// even number keeps the parity of the first message). `max_messages == 0` means
/// "no cap". Call this right after committing the assistant turn.
pub fn cap_history<T>(history: &mut Vec<T>, max_messages: usize) {
    if max_messages == 0 || history.len() <= max_messages {
        return;
    }
    let mut remove = history.len() - max_messages;
    if !remove.is_multiple_of(2) {
        remove += 1; // round up to an even count to keep alternation parity
    }
    if remove >= history.len() {
        history.clear();
    } else {
        history.drain(0..remove);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn outcome(text: &str, stream_error: Option<StreamError>) -> StreamOutcome {
        StreamOutcome {
            full_response: text.to_string(),
            usage: None,
            stream_error,
        }
    }

    fn overloaded() -> StreamError {
        StreamError::Api {
            code: None,
            kind: Some("overloaded_error".into()),
            message: "Overloaded".into(),
        }
    }

    #[test]
    fn resolve_turn_cancel_wins_over_an_error() {
        assert_eq!(
            resolve_turn(outcome("part", Some(overloaded())), true),
            TurnResolution::Cancelled {
                partial: "part".into()
            }
        );
    }

    #[test]
    fn resolve_turn_fails_on_a_reported_error_even_with_text() {
        assert_eq!(
            resolve_turn(outcome("half an answer", Some(overloaded())), false),
            TurnResolution::Failed(TurnFailure::Stream(overloaded()))
        );
    }

    #[test]
    fn resolve_turn_fails_on_an_empty_answer() {
        assert_eq!(
            resolve_turn(outcome("", None), false),
            TurnResolution::Failed(TurnFailure::Empty)
        );
    }

    #[test]
    fn resolve_turn_completes_a_normal_answer() {
        let usage = TokenUsage {
            prompt_token_count: Some(1),
            candidates_token_count: Some(2),
            total_token_count: Some(3),
        };
        let mut o = outcome("answer", None);
        o.usage = Some(usage.clone());
        assert_eq!(
            resolve_turn(o, false),
            TurnResolution::Done {
                content: "answer".into(),
                usage: Some(usage),
            }
        );
    }

    #[tokio::test]
    async fn cancellable_stops_a_pending_wait() {
        let cancel = CancellationToken::new();
        let trigger = cancel.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            trigger.cancel();
        });
        let r = tokio::time::timeout(
            std::time::Duration::from_secs(1),
            cancellable(&cancel, std::future::pending::<()>()),
        )
        .await
        .expect("cancel must end the wait");
        assert_eq!(r, None);
    }

    #[tokio::test]
    async fn cancellable_returns_a_finished_result() {
        let cancel = CancellationToken::new();
        assert_eq!(cancellable(&cancel, async { 7 }).await, Some(7));
    }

    #[tokio::test]
    async fn cancellable_does_not_start_after_a_cancel() {
        let cancel = CancellationToken::new();
        cancel.cancel();
        let polled = std::sync::atomic::AtomicBool::new(false);
        let r = cancellable(&cancel, async {
            polled.store(true, std::sync::atomic::Ordering::SeqCst);
        })
        .await;
        assert_eq!(r, None);
        assert!(!polled.load(std::sync::atomic::Ordering::SeqCst));
    }

    #[test]
    fn normal_completion_returns_full_text() {
        assert_eq!(finalize_assistant_content("hello", false), "hello");
        assert_eq!(finalize_assistant_content("", false), "");
    }

    #[test]
    fn cancel_with_partial_text_marks_it() {
        assert_eq!(
            finalize_assistant_content("partial", true),
            "partial\n\n[cancelled by user]"
        );
    }

    #[test]
    fn cancel_before_any_text_uses_placeholder() {
        assert_eq!(
            finalize_assistant_content("", true),
            "[cancelled before response]"
        );
    }

    #[test]
    fn cap_history_noop_when_under_or_at_limit() {
        let mut h = vec![1, 2, 3, 4];
        cap_history(&mut h, 4);
        assert_eq!(h, vec![1, 2, 3, 4]);
        cap_history(&mut h, 10);
        assert_eq!(h, vec![1, 2, 3, 4]);
    }

    #[test]
    fn cap_history_zero_means_no_cap() {
        let mut h = vec![1, 2, 3, 4, 5, 6];
        cap_history(&mut h, 0);
        assert_eq!(h, vec![1, 2, 3, 4, 5, 6]);
    }

    #[test]
    fn cap_history_trims_oldest_in_even_pairs() {
        // 6 messages, cap 4 -> remove 2 from the front.
        let mut h = vec![1, 2, 3, 4, 5, 6];
        cap_history(&mut h, 4);
        assert_eq!(h, vec![3, 4, 5, 6]);
    }

    #[test]
    fn cap_history_rounds_odd_removal_up_to_keep_parity() {
        // 6 messages, cap 3 -> raw removal 3 (odd) rounds to 4, leaving 2.
        let mut h = vec![1, 2, 3, 4, 5, 6];
        cap_history(&mut h, 3);
        assert_eq!(h, vec![5, 6]);
    }
}
