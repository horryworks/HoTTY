//! Shared, user-facing error formatting for AI providers.
//!
//! Historically only Vertex AI mapped a failed request's status/body to a helpful
//! message; OpenAI / Anthropic / Gemini emitted a single generic
//! "An error occurred while communicating with X. Please try again." and threw
//! the real status/body away. These helpers give the API-key providers the same
//! actionable messages (auth vs quota vs model-not-found vs service outage)
//! without leaking raw provider payloads into the chat.

use crate::services::ai::sse::StreamError;
use crate::services::ai::streaming::TurnFailure;

/// Turn a non-2xx HTTP status (and optional body) from a chat/classify/list call
/// into a short, actionable message. `provider` is the human name ("OpenAI").
pub fn describe_http_error(provider: &str, status: u16, body: &str) -> String {
    let base = match status {
        400 => format!("{provider} rejected the request (HTTP 400). The model name or request may be invalid."),
        401 | 403 => format!(
            "Authentication failed for {provider} (HTTP {status}). Check that your API key is valid and has access."
        ),
        404 => format!("{provider} could not find the requested model (HTTP 404)."),
        408 | 504 => format!("{provider} timed out (HTTP {status}). Please try again."),
        429 => format!(
            "{provider} rate limit or quota exceeded (HTTP 429). Wait a moment and try again, or check your plan's limits."
        ),
        500..=599 => format!("{provider} had a service error (HTTP {status}). Please try again shortly."),
        _ => format!("{provider} returned an error (HTTP {status})."),
    };
    match extract_api_message(body) {
        Some(detail) if !detail.is_empty() => format!("{base} ({detail})"),
        _ => base,
    }
}

/// Format a transport-level failure (no HTTP response — DNS, TLS, connection).
pub fn describe_transport_error(provider: &str) -> String {
    format!("Could not reach {provider}. Check your network connection and try again.")
}

/// Finish reasons that mean a content filter withheld the answer, as opposed to
/// some other abnormal stop (recitation, malformed tool call, …).
const CONTENT_FILTER_REASONS: &[&str] = &[
    "SAFETY",
    "BLOCKLIST",
    "PROHIBITED_CONTENT",
    "SPII",
    "IMAGE_SAFETY",
    "content_filter",
];

/// Turn a failed streamed turn into a short, actionable message. Built only from
/// the provider's `message` and category fields, passed through [`cap`] — never
/// the raw event JSON.
pub fn describe_turn_failure(provider: &str, failure: &TurnFailure) -> String {
    match failure {
        TurnFailure::Empty => {
            format!("{provider} returned an empty answer. Please try again.")
        }
        TurnFailure::Stream(StreamError::Blocked { reason }) => {
            let reason = cap(reason);
            if CONTENT_FILTER_REASONS.contains(&reason.as_str()) {
                format!(
                    "{provider} withheld the answer because its content filter flagged it ({reason}). Try rephrasing the request."
                )
            } else {
                format!(
                    "{provider} stopped without finishing the answer ({reason}). Please try again."
                )
            }
        }
        TurnFailure::Stream(StreamError::Api {
            code,
            kind,
            message,
        }) => {
            let kind = kind.as_deref().unwrap_or("");
            let base = if *code == Some(429)
                || matches!(
                    kind,
                    "rate_limit_error"
                        | "rate_limit_exceeded"
                        | "insufficient_quota"
                        | "RESOURCE_EXHAUSTED"
                ) {
                format!("{provider} rate limit or quota exceeded while answering. Wait a moment and try again.")
            } else if matches!(code, Some(503) | Some(529))
                || matches!(kind, "overloaded_error" | "UNAVAILABLE")
            {
                format!(
                    "{provider} is overloaded and stopped mid-answer. Please try again shortly."
                )
            } else {
                format!("{provider} stopped with an error while answering. Please try again.")
            };
            let detail = cap(message);
            if detail.is_empty() {
                base
            } else {
                format!("{base} ({detail})")
            }
        }
    }
}

/// Pull a concise human message out of a provider error body without dumping the
/// whole payload. Recognizes the common `{"error": {"message": "..."}}` and
/// `{"error": "..."}` shapes; otherwise returns a trimmed, length-capped snippet.
fn extract_api_message(body: &str) -> Option<String> {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if let Some(msg) = v.pointer("/error/message").and_then(|m| m.as_str()) {
            return Some(cap(msg));
        }
        if let Some(msg) = v.get("error").and_then(|m| m.as_str()) {
            return Some(cap(msg));
        }
        if let Some(msg) = v.get("message").and_then(|m| m.as_str()) {
            return Some(cap(msg));
        }
        // Structured but unrecognized shape — don't echo raw JSON at the user.
        return None;
    }
    Some(cap(trimmed))
}

/// Trim a message to a single line and cap its length so a runaway body can't
/// flood the chat.
fn cap(msg: &str) -> String {
    let one_line = msg.replace(['\n', '\r'], " ");
    let one_line = one_line.trim();
    const MAX: usize = 200;
    if one_line.chars().count() > MAX {
        let truncated: String = one_line.chars().take(MAX).collect();
        format!("{truncated}…")
    } else {
        one_line.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_common_statuses() {
        assert!(describe_http_error("OpenAI", 401, "").contains("Authentication failed"));
        assert!(describe_http_error("OpenAI", 429, "").contains("rate limit"));
        assert!(describe_http_error("Anthropic", 503, "").contains("service error"));
        assert!(describe_http_error("Gemini", 404, "").contains("model"));
    }

    #[test]
    fn appends_openai_style_message() {
        let body = r#"{"error": {"message": "You exceeded your current quota", "type": "insufficient_quota"}}"#;
        let msg = describe_http_error("OpenAI", 429, body);
        assert!(msg.contains("rate limit"));
        assert!(msg.contains("You exceeded your current quota"));
    }

    #[test]
    fn appends_anthropic_style_message() {
        let body = r#"{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}"#;
        let msg = describe_http_error("Anthropic", 401, body);
        assert!(msg.contains("invalid x-api-key"));
    }

    #[test]
    fn ignores_unrecognized_json_shape() {
        let msg = describe_http_error("OpenAI", 400, r#"{"weird": [1,2,3]}"#);
        assert!(!msg.contains("weird"));
    }

    #[test]
    fn caps_long_plain_body() {
        let long = "x".repeat(500);
        let msg = describe_http_error("OpenAI", 500, &long);
        assert!(msg.chars().count() < 300);
        assert!(msg.contains('…'));
    }

    #[test]
    fn transport_error_is_actionable() {
        assert!(describe_transport_error("OpenAI").contains("network"));
    }

    fn api(code: Option<u64>, kind: Option<&str>, message: &str) -> TurnFailure {
        TurnFailure::Stream(StreamError::Api {
            code,
            kind: kind.map(str::to_string),
            message: message.to_string(),
        })
    }

    #[test]
    fn turn_failure_maps_overload_and_rate_limit() {
        let msg = describe_turn_failure(
            "Anthropic",
            &api(None, Some("overloaded_error"), "Overloaded"),
        );
        assert!(msg.contains("overloaded"), "{msg}");
        assert!(msg.ends_with("(Overloaded)"), "{msg}");
        let msg = describe_turn_failure("Gemini", &api(Some(429), None, ""));
        assert!(msg.contains("rate limit"), "{msg}");
        assert!(!msg.contains("()"), "no empty detail: {msg}");
    }

    #[test]
    fn turn_failure_separates_content_filter_from_other_stops() {
        let blocked = |r: &str| {
            TurnFailure::Stream(StreamError::Blocked {
                reason: r.to_string(),
            })
        };
        assert!(describe_turn_failure("Gemini", &blocked("SAFETY")).contains("content filter"));
        assert!(
            describe_turn_failure("OpenAI", &blocked("content_filter")).contains("content filter")
        );
        let other = describe_turn_failure("Gemini", &blocked("RECITATION"));
        assert!(!other.contains("content filter"), "{other}");
        assert!(other.contains("RECITATION"), "{other}");
    }

    #[test]
    fn turn_failure_empty_answer_is_explained() {
        assert!(describe_turn_failure("OpenAI", &TurnFailure::Empty).contains("empty answer"));
    }

    #[test]
    fn turn_failure_detail_is_capped_to_one_line() {
        let long = format!("line one\nline two {}", "y".repeat(500));
        let msg = describe_turn_failure("OpenAI", &api(None, Some("server_error"), &long));
        assert!(!msg.contains('\n'), "{msg}");
        assert!(msg.contains('…'), "{msg}");
        assert!(msg.chars().count() < 350, "{msg}");
    }

    #[test]
    fn turn_failure_never_echoes_raw_json() {
        // Only the message field is used, so a JSON-looking category stays out.
        let msg = describe_turn_failure("OpenAI", &api(None, Some("{\"raw\":1}"), "m"));
        assert!(!msg.contains("raw"), "{msg}");
    }
}
