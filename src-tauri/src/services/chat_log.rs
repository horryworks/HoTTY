//! Pure helpers for the AI-Chat markdown transcript log.
//!
//! This module owns only *formatting* — filename construction and markdown
//! rendering. All state (open files, the dialog-attested directory allow-list)
//! lives in [`crate::services::log_manager::LogManager`], which is the single
//! place where a log directory is authorised. Keeping the formatting here means
//! it can be unit-tested without a filesystem or a mutex.
//!
//! The file layout deliberately mirrors terminal session logging:
//! `<YYYYMMDDHHMMSS>-AICHAT-<title>.md` alongside the `.txt`/`.tslog` pairs, so
//! both show up together (newest first) in the Log Viewer pane.

use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::services::log_manager::{sanitize_host, timestamp_prefix, MAX_FILENAME_LEN};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Extension used for AI chat transcripts. Also allow-listed by the Log Viewer.
pub const CHAT_LOG_EXT: &str = "md";

/// Filename infix identifying an AI chat transcript, mirroring the `PROTOCOL`
/// slot of a terminal log (`<ts>-SSH-host.txt` ⇄ `<ts>-AICHAT-title.md`).
const CHAT_LOG_KIND: &str = "AICHAT";

/// Used when a tab title sanitizes down to nothing. Tab titles are derived from
/// a session's display name, which is frequently non-ASCII (CJK hostnames), and
/// `sanitize_host` maps every non-`[A-Za-z0-9.-]` char to `_` — so without this
/// fallback such a chat would be filed as `…-AICHAT-___.md`.
const TITLE_FALLBACK: &str = "chat";

// ---------------------------------------------------------------------------
// Types (mirror `ChatLogTurnPayload` / `ChatLogMeta` in src/types/appTypes.ts)
// ---------------------------------------------------------------------------

/// Who produced a turn. An enum rather than a `String` so an unrecognised role
/// fails at deserialization — the command rejects it before it can reach disk.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChatLogRole {
    User,
    Model,
}

impl ChatLogRole {
    fn heading(self) -> &'static str {
        match self {
            ChatLogRole::User => "User",
            ChatLogRole::Model => "Assistant",
        }
    }
}

/// Image attachment *metadata only*.
///
/// The base64 payload is deliberately never sent from the renderer: a single
/// turn may carry 5 images × 5 MiB, i.e. ~33 MB of base64 text. Two such turns
/// would push the transcript past the Log Viewer's 50 MB read cap and make the
/// file unopenable in the very feature this integrates with.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatLogImage {
    pub mime_type: String,
    pub bytes: u64,
}

/// One conversation turn as displayed in the pane.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatLogTurn {
    pub role: ChatLogRole,
    pub content: String,
    #[serde(default)]
    pub images: Vec<ChatLogImage>,
}

/// Conversation-level context, captured once when the file is created.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatLogMeta {
    /// Tab title at file-creation time. Titles mutate as terminal links change;
    /// like a terminal log's host, this is a snapshot, not a live value.
    pub title: String,
    pub model: String,
    pub provider: String,
    /// Display names of the terminals this tab was watching.
    pub terminals: Vec<String>,
}

// ---------------------------------------------------------------------------
// Filename
// ---------------------------------------------------------------------------

/// Sanitize a tab title for use in a filename.
///
/// Reuses `sanitize_host` so the result is guaranteed ASCII — which is what
/// makes `build_log_path`-style byte truncation safe.
fn sanitize_title(title: &str) -> String {
    let cleaned = sanitize_host(title);
    let trimmed = cleaned.trim_matches(|c| c == '_' || c == '.' || c == '-');
    if trimmed.is_empty() {
        TITLE_FALLBACK.to_string()
    } else {
        trimmed.to_string()
    }
}

/// Build the transcript filename: `YYYYMMDDHHMMSS-AICHAT-<title>.md`.
///
/// Collision handling matches `build_log_path`: `-1`..`-9999`, then a
/// high-entropy `-<pid>-<nanos>` fallback. An existing path is never returned —
/// `File::create` truncates, which would clobber another conversation's log.
pub fn build_chat_log_path(dir: &Path, title: &str) -> PathBuf {
    let ts = timestamp_prefix();
    let safe_title = sanitize_title(title);

    let base = format!("{ts}-{CHAT_LOG_KIND}-{safe_title}");
    // Safe byte slice: every component is ASCII (timestamp digits, a literal,
    // and `sanitize_title`'s ASCII-only output).
    let base = if base.len() > MAX_FILENAME_LEN {
        base[..MAX_FILENAME_LEN].to_string()
    } else {
        base
    };

    let mut path = dir.join(format!("{base}.{CHAT_LOG_EXT}"));
    let mut counter = 1u32;
    while path.exists() {
        if counter > 9999 {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            path = dir.join(format!(
                "{base}-{}-{nanos}.{CHAT_LOG_EXT}",
                std::process::id()
            ));
            break;
        }
        path = dir.join(format!("{base}-{counter}.{CHAT_LOG_EXT}"));
        counter += 1;
    }
    path
}

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

/// Choose a fence long enough to survive backtick runs inside `body`.
///
/// CommonMark closes a fenced block at the first line whose leading backtick run
/// is at least as long as the opening fence, so pasted terminal output or a
/// markdown snippet containing ``` would otherwise break out of the block.
fn fence_for(body: &str) -> String {
    let mut longest = 0usize;
    for line in body.lines() {
        let run = line.trim_start().chars().take_while(|&c| c == '`').count();
        if run > longest {
            longest = run;
        }
    }
    "`".repeat(longest.max(2) + 1)
}

/// Human-readable byte count for the image placeholder.
fn format_bytes(n: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = 1024.0 * 1024.0;
    let f = n as f64;
    if f >= MB {
        format!("{:.1} MB", f / MB)
    } else if f >= KB {
        format!("{:.1} KB", f / KB)
    } else {
        format!("{n} B")
    }
}

/// Render the one-time file header.
pub fn render_header(meta: &ChatLogMeta, log_key: &str, started_at: &str) -> String {
    let title = if meta.title.trim().is_empty() {
        "AI Chat".to_string()
    } else {
        format!("AI Chat — {}", meta.title.trim())
    };

    let mut out = format!("# {title}\n\n");
    // `started_at` comes from the same UTC clock as the `.tslog` stream; the
    // suffix is explicit so the file isn't read as local time.
    out.push_str(&format!("- **Started:** {started_at} UTC\n"));
    if !meta.model.trim().is_empty() {
        out.push_str(&format!("- **Model:** {}\n", meta.model.trim()));
    }
    if !meta.provider.trim().is_empty() {
        out.push_str(&format!("- **Provider:** {}\n", meta.provider.trim()));
    }
    if !meta.terminals.is_empty() {
        out.push_str(&format!("- **Watching:** {}\n", meta.terminals.join(", ")));
    }
    out.push_str(&format!("- **Conversation:** {log_key}\n"));
    out.push_str("\n---\n");
    out
}

/// Render a single turn, including its leading blank line.
///
/// User turns are fenced, assistant turns are not. User turns routinely carry
/// pasted terminal output and machine-generated command envelopes whose `#`,
/// `|` and `---` characters would shred the document structure; assistant
/// replies are already markdown (that is how the pane renders them), so fencing
/// them would defeat the point of choosing `.md`.
pub fn render_turn(turn: &ChatLogTurn, at: &str) -> String {
    let mut out = format!("\n## [{at}] {}\n\n", turn.role.heading());

    // `trim_end` (not just newlines) so a whitespace-only turn renders as a bare
    // heading rather than an empty code fence.
    let body = turn.content.trim_end();
    if !body.is_empty() {
        match turn.role {
            ChatLogRole::User => {
                let fence = fence_for(body);
                out.push_str(&format!("{fence}text\n{body}\n{fence}\n"));
            }
            ChatLogRole::Model => {
                out.push_str(body);
                out.push('\n');
            }
        }
    }

    let total = turn.images.len();
    for (i, img) in turn.images.iter().enumerate() {
        out.push_str(&format!(
            "\n_[image {}/{total} — {}, {} — not saved]_\n",
            i + 1,
            img.mime_type,
            format_bytes(img.bytes),
        ));
    }

    out
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn turn(role: ChatLogRole, content: &str) -> ChatLogTurn {
        ChatLogTurn {
            role,
            content: content.to_string(),
            images: Vec::new(),
        }
    }

    #[test]
    fn build_chat_log_path_basic() {
        let dir = std::env::temp_dir().join("hotty_chat_log_basic_nonexistent");
        let p = build_chat_log_path(&dir, "router-a");
        let name = p.file_name().unwrap().to_str().unwrap();
        assert!(name.ends_with("-AICHAT-router-a.md"), "got {name}");
        // YYYYMMDDHHMMSS prefix
        assert!(name[..14].chars().all(|c| c.is_ascii_digit()), "got {name}");
    }

    #[test]
    fn build_chat_log_path_sanitizes_special_chars() {
        let dir = std::env::temp_dir().join("hotty_chat_log_sanitize_nonexistent");
        let p = build_chat_log_path(&dir, "user@host:22");
        let name = p.file_name().unwrap().to_str().unwrap();
        assert!(name.ends_with("-AICHAT-user_host_22.md"), "got {name}");
    }

    #[test]
    fn build_chat_log_path_cjk_title_falls_back_to_chat() {
        let dir = std::env::temp_dir().join("hotty_chat_log_cjk_nonexistent");
        let p = build_chat_log_path(&dir, "日本語");
        let name = p.file_name().unwrap().to_str().unwrap();
        assert!(name.ends_with("-AICHAT-chat.md"), "got {name}");
    }

    #[test]
    fn build_chat_log_path_empty_title_falls_back_to_chat() {
        let dir = std::env::temp_dir().join("hotty_chat_log_empty_nonexistent");
        let p = build_chat_log_path(&dir, "");
        let name = p.file_name().unwrap().to_str().unwrap();
        assert!(name.ends_with("-AICHAT-chat.md"), "got {name}");
    }

    /// A tab title is renderer-supplied, so it must not be able to steer the
    /// file out of the approved log directory.
    #[test]
    fn build_chat_log_path_title_cannot_escape_the_directory() {
        let dir = std::env::temp_dir().join("hotty_chat_log_traversal_nonexistent");
        for hostile in [
            "..",
            "../..",
            "..\\..\\Windows\\System32\\evil",
            "/etc/passwd",
            "C:\\Windows\\evil",
            "\\\\server\\share\\evil",
            "a/../../b",
        ] {
            let p = build_chat_log_path(&dir, hostile);
            assert_eq!(
                p.parent(),
                Some(dir.as_path()),
                "title {hostile:?} escaped to {p:?}"
            );
            let name = p.file_name().unwrap().to_str().unwrap();
            assert!(!name.contains('/') && !name.contains('\\'), "got {name}");
            assert!(name.starts_with(&format!("{}-", &name[..14])));
        }
    }

    #[test]
    fn build_chat_log_path_truncates_long_title() {
        let dir = std::env::temp_dir().join("hotty_chat_log_long_nonexistent");
        let p = build_chat_log_path(&dir, &"a".repeat(500));
        let stem = p.file_stem().unwrap().to_str().unwrap();
        assert_eq!(stem.len(), MAX_FILENAME_LEN);
    }

    #[test]
    fn build_chat_log_path_collision_appends_counter() {
        let dir = std::env::temp_dir().join("hotty_chat_log_collision");
        let _ = std::fs::create_dir_all(&dir);
        let first = build_chat_log_path(&dir, "host");
        std::fs::write(&first, b"x").unwrap();
        let second = build_chat_log_path(&dir, "host");
        assert_ne!(first, second);
        let name = second.file_name().unwrap().to_str().unwrap();
        assert!(name.ends_with("-1.md"), "got {name}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn fence_for_defaults_to_three_backticks() {
        assert_eq!(fence_for("plain text"), "```");
    }

    #[test]
    fn fence_for_escapes_embedded_fences() {
        assert_eq!(fence_for("before\n```\nafter"), "````");
        assert_eq!(fence_for("before\n````\nafter"), "`````");
        // Indented fences still count — CommonMark allows up to 3 spaces.
        assert_eq!(fence_for("  ```\n"), "````");
    }

    #[test]
    fn render_turn_user_is_fenced_model_is_raw() {
        let user = render_turn(&turn(ChatLogRole::User, "show ip int brief"), "T");
        assert!(user.contains("## [T] User"));
        assert!(user.contains("```text\nshow ip int brief\n```"));

        let model = render_turn(&turn(ChatLogRole::Model, "## Heading\n\n- bullet"), "T");
        assert!(model.contains("## [T] Assistant"));
        assert!(!model.contains("```text"));
        assert!(model.contains("- bullet"));
    }

    #[test]
    fn render_turn_has_blank_line_separation() {
        let out = render_turn(&turn(ChatLogRole::Model, "body"), "T");
        assert!(out.starts_with('\n'));
        assert!(out.ends_with('\n'));
    }

    #[test]
    fn render_turn_empty_content_still_emits_heading() {
        let out = render_turn(&turn(ChatLogRole::User, "   \n"), "T");
        assert!(out.contains("## [T] User"));
        assert!(!out.contains("```"));
    }

    #[test]
    fn render_turn_image_placeholder_has_no_base64() {
        let t = ChatLogTurn {
            role: ChatLogRole::User,
            content: "look at this".to_string(),
            images: vec![
                ChatLogImage {
                    mime_type: "image/png".to_string(),
                    bytes: 151_782,
                },
                ChatLogImage {
                    mime_type: "image/jpeg".to_string(),
                    bytes: 900,
                },
            ],
        };
        let out = render_turn(&t, "T");
        assert!(out.contains("_[image 1/2 — image/png, 148.2 KB — not saved]_"));
        assert!(out.contains("_[image 2/2 — image/jpeg, 900 B — not saved]_"));
        assert!(!out.contains("data:"));
        assert!(!out.contains("base64"));
    }

    #[test]
    fn format_bytes_tiers() {
        assert_eq!(format_bytes(900), "900 B");
        assert_eq!(format_bytes(2048), "2.0 KB");
        assert_eq!(format_bytes(3 * 1024 * 1024), "3.0 MB");
    }

    #[test]
    fn render_header_contains_model_provider_and_terminals() {
        let meta = ChatLogMeta {
            title: "router-a +2".to_string(),
            model: "gemini-2.5-pro".to_string(),
            provider: "gemini".to_string(),
            terminals: vec!["router-a".to_string(), "switch-b".to_string()],
        };
        let out = render_header(&meta, "ai-1::tab-1", "2026-07-27 09:14:07.882");
        assert!(out.starts_with("# AI Chat — router-a +2\n"));
        assert!(out.contains("- **Started:** 2026-07-27 09:14:07.882 UTC"));
        assert!(out.contains("- **Model:** gemini-2.5-pro"));
        assert!(out.contains("- **Provider:** gemini"));
        assert!(out.contains("- **Watching:** router-a, switch-b"));
        assert!(out.contains("- **Conversation:** ai-1::tab-1"));
        assert!(out.ends_with("\n---\n"));
    }

    #[test]
    fn render_header_omits_blank_fields() {
        let out = render_header(&ChatLogMeta::default(), "ai-1::tab-1", "T");
        assert!(out.starts_with("# AI Chat\n"));
        assert!(!out.contains("**Model:**"));
        assert!(!out.contains("**Provider:**"));
        assert!(!out.contains("**Watching:**"));
    }

    #[test]
    fn role_deserializes_from_lowercase_only() {
        assert_eq!(
            serde_json::from_str::<ChatLogRole>("\"user\"").unwrap(),
            ChatLogRole::User
        );
        assert_eq!(
            serde_json::from_str::<ChatLogRole>("\"model\"").unwrap(),
            ChatLogRole::Model
        );
        assert!(serde_json::from_str::<ChatLogRole>("\"system\"").is_err());
    }

    #[test]
    fn turn_deserializes_camel_case_images() {
        let t: ChatLogTurn = serde_json::from_str(
            r#"{"role":"user","content":"hi","images":[{"mimeType":"image/png","bytes":10}]}"#,
        )
        .unwrap();
        assert_eq!(t.images.len(), 1);
        assert_eq!(t.images[0].mime_type, "image/png");
    }
}
