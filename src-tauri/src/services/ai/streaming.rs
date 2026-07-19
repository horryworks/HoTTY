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
    if remove % 2 != 0 {
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
