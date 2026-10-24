//! Shared input validation for AI providers.
//!
//! The API-key providers (OpenAI, Anthropic) used byte-identical `is_valid_*`
//! helpers that re-`Regex::new`'d on every call. Centralizing them here keeps
//! the rule in one place and compiles each pattern once via `OnceLock`.

use regex_lite::Regex;
use std::sync::OnceLock;

fn api_key_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    // Compile-time-constant pattern: a bad pattern is a programmer error, so
    // `expect` is appropriate (and only runs once).
    RE.get_or_init(|| Regex::new(r"^[\x21-\x7E]{1,512}$").expect("valid api-key regex"))
}

fn model_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^[a-zA-Z0-9]+([._-][a-zA-Z0-9]+)*$").expect("valid model regex"))
}

/// True when `key` looks like a plausible API key: 1..=512 printable-ASCII
/// characters. A cheap shape check before the key hits the network or is
/// persisted — not a guarantee of validity.
pub fn is_valid_api_key(key: &str) -> bool {
    api_key_re().is_match(key)
}

/// True when `model` is a conservative model identifier (alphanumeric segments
/// separated by `.`, `_`, or `-`).
pub fn is_valid_model(model: &str) -> bool {
    model_re().is_match(model)
}

/// Longest model id a local server is allowed to name.
const MAX_LOCAL_MODEL_LEN: usize = 256;

/// True when `model` is a plausible model id for a local OpenAI-compatible
/// server. Looser than [`is_valid_model`] on purpose: Ollama names models
/// `llama3.1:8b`, vLLM and LM Studio use `org/Model-8B-Instruct`, and
/// llama-swap aliases are free-form. The id only ever travels inside a JSON
/// body, so the check just keeps out whitespace and control characters.
pub fn is_valid_local_model(model: &str) -> bool {
    !model.is_empty()
        && model.len() <= MAX_LOCAL_MODEL_LEN
        && !model.chars().any(|c| c.is_control() || c.is_whitespace())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_key_shape() {
        assert!(is_valid_api_key("sk-abc123"));
        assert!(is_valid_api_key("a"));
        assert!(is_valid_api_key(&"x".repeat(512)));
        assert!(!is_valid_api_key(""));
        assert!(!is_valid_api_key(&"x".repeat(513)));
        assert!(!is_valid_api_key("has space"));
        assert!(!is_valid_api_key("tab\tchar"));
    }

    #[test]
    fn model_shape() {
        assert!(is_valid_model("gpt-4o"));
        assert!(is_valid_model("claude-3.5-sonnet"));
        assert!(is_valid_model("gemini_2_0"));
        assert!(!is_valid_model(""));
        assert!(!is_valid_model("-leading"));
        assert!(!is_valid_model("trailing-"));
        assert!(!is_valid_model("bad space"));
    }

    #[test]
    fn local_model_shape() {
        assert!(is_valid_local_model("llama3.1:8b"));
        assert!(is_valid_local_model("qwen2.5-coder:7b-instruct-q4_K_M"));
        assert!(is_valid_local_model("meta-llama/Llama-3.1-8B-Instruct"));
        assert!(is_valid_local_model("hf.co/org/model-GGUF:Q4_K_M"));
        assert!(!is_valid_local_model(""));
        assert!(!is_valid_local_model("two words"));
        assert!(!is_valid_local_model(
            "line
break"
        ));
        assert!(!is_valid_local_model(&"x".repeat(257)));
    }
}
