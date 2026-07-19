//! Shared, user-facing error formatting for AI providers.
//!
//! Historically only Vertex AI mapped a failed request's status/body to a helpful
//! message; OpenAI / Anthropic / Gemini emitted a single generic
//! "An error occurred while communicating with X. Please try again." and threw
//! the real status/body away. These helpers give the API-key providers the same
//! actionable messages (auth vs quota vs model-not-found vs service outage)
//! without leaking raw provider payloads into the chat.

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
    format!(
        "Could not reach {provider}. Check your network connection and try again."
    )
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
}
