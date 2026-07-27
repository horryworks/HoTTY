//! Tauri commands for the AI-Chat markdown transcript log.
//!
//! The renderer owns the transcript (it is React state), so it is the renderer
//! that pushes new turns down. Authorisation still lives entirely in
//! [`LogManager`]: `log_dir` must be in the dialog-attested allow-list, which
//! the renderer cannot grow on its own.

use std::path::Path;

use tauri::State;

use crate::services::chat_log::{ChatLogMeta, ChatLogTurn};
use crate::services::log_manager::LogManager;

/// Upper bound on a single append. The renderer batches the turns produced by
/// one React commit, which in practice is 1–2; anything wildly larger indicates
/// a bug or a forged call.
const MAX_TURNS_PER_APPEND: usize = 256;

/// Upper bound on a header metadata field. Transcript *content* is legitimately
/// unbounded, but the header is a fixed handful of short labels — capping it
/// keeps a forged call from writing a huge header block.
const MAX_META_FIELD_LEN: usize = 512;

/// Upper bound on the number of watched-terminal names in the header.
const MAX_META_TERMINALS: usize = 64;

/// Validate the string parameters. Extracted so it is unit-testable without a
/// Tauri `State`.
fn validate_args(log_key: &str, log_dir: &str) -> Result<(), String> {
    if log_key.trim().is_empty() {
        return Err("log key must not be empty".to_string());
    }
    if log_dir.trim().is_empty() {
        return Err("log directory must not be empty".to_string());
    }
    Ok(())
}

/// Clamp the header metadata to sane bounds. Truncation is on a char boundary
/// so a multi-byte title cannot panic.
fn clamp_meta(mut meta: ChatLogMeta) -> ChatLogMeta {
    fn clamp(s: &mut String) {
        if s.chars().count() > MAX_META_FIELD_LEN {
            *s = s.chars().take(MAX_META_FIELD_LEN).collect();
        }
    }
    clamp(&mut meta.title);
    clamp(&mut meta.model);
    clamp(&mut meta.provider);
    meta.terminals.truncate(MAX_META_TERMINALS);
    for name in &mut meta.terminals {
        clamp(name);
    }
    meta
}

/// Append conversation turns to `log_key`'s markdown transcript, creating the
/// file on the first call.
#[tauri::command]
pub async fn ai_chat_log_append(
    log_manager: State<'_, LogManager>,
    log_key: String,
    log_dir: String,
    meta: ChatLogMeta,
    turns: Vec<ChatLogTurn>,
) -> Result<(), String> {
    validate_args(&log_key, &log_dir)?;
    if turns.is_empty() {
        return Ok(());
    }
    if turns.len() > MAX_TURNS_PER_APPEND {
        return Err(format!(
            "too many turns in one append (max {MAX_TURNS_PER_APPEND})"
        ));
    }
    log_manager
        .append_chat_log(&log_key, Path::new(&log_dir), &clamp_meta(meta), &turns)
        .await
}

/// Forget `log_key` so the next append starts a fresh transcript file.
#[tauri::command]
pub async fn ai_chat_log_close(
    log_manager: State<'_, LogManager>,
    log_key: String,
) -> Result<(), String> {
    if log_key.trim().is_empty() {
        return Err("log key must not be empty".to_string());
    }
    log_manager.close_chat_log(&log_key).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_args_accepts_normal_input() {
        assert!(validate_args("ai-1::tab-1", "C:/logs").is_ok());
    }

    #[test]
    fn validate_args_rejects_empty_key() {
        assert!(validate_args("", "C:/logs").is_err());
        assert!(validate_args("   ", "C:/logs").is_err());
    }

    #[test]
    fn validate_args_rejects_empty_dir() {
        assert!(validate_args("ai-1::tab-1", "").is_err());
        assert!(validate_args("ai-1::tab-1", "  ").is_err());
    }

    #[test]
    fn clamp_meta_limits_field_length_and_terminal_count() {
        let meta = ChatLogMeta {
            title: "a".repeat(5000),
            model: "b".repeat(5000),
            provider: "gemini".to_string(),
            terminals: (0..500).map(|i| format!("vm-{i}")).collect(),
        };
        let clamped = clamp_meta(meta);
        assert_eq!(clamped.title.chars().count(), MAX_META_FIELD_LEN);
        assert_eq!(clamped.model.chars().count(), MAX_META_FIELD_LEN);
        assert_eq!(clamped.provider, "gemini");
        assert_eq!(clamped.terminals.len(), MAX_META_TERMINALS);
    }

    #[test]
    fn clamp_meta_truncates_on_char_boundaries() {
        let meta = ChatLogMeta {
            title: "日".repeat(5000),
            ..Default::default()
        };
        let clamped = clamp_meta(meta);
        assert_eq!(clamped.title.chars().count(), MAX_META_FIELD_LEN);
    }

    #[test]
    fn clamp_meta_leaves_normal_values_untouched() {
        let meta = ChatLogMeta {
            title: "router-a".to_string(),
            model: "gemini-2.5-pro".to_string(),
            provider: "gemini".to_string(),
            terminals: vec!["router-a".to_string()],
        };
        let clamped = clamp_meta(meta.clone());
        assert_eq!(clamped.title, meta.title);
        assert_eq!(clamped.terminals, meta.terminals);
    }
}
