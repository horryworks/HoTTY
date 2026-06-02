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
}
