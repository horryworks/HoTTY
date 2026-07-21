//! Shared per-session chat-history storage for AI providers.
//!
//! Before this module each provider owned its own
//! `chat_histories: HashMap<String, Vec<ChatMessage>>` field plus duplicated
//! `ChatMessage`, `pop_trailing_user`, and finalize/cap logic. Consolidating it
//! here removes that four-way duplication and — more importantly — makes history
//! **interior-mutable** (`&self` methods over a `Mutex`), so a provider's
//! `send_message` no longer needs `&mut self` merely to record a turn. That is
//! the precondition for reducing the AI service lock's granularity.
//!
//! `role` is stored verbatim as the owning provider's API role name ("user" plus
//! "assistant" for OpenAI/Anthropic or "model" for Gemini/Vertex); the store is
//! agnostic to which string a provider uses.

use std::collections::HashMap;
use std::sync::Mutex;

use crate::services::ai::streaming::{cap_history, finalize_assistant_content};

/// An image attachment on a user turn.
///
/// `data_base64` is standard-alphabet base64 (NO `data:` URL prefix). This type
/// is the deserialize target for the `ai_chat_send` command param *and* the
/// in-history representation, so a validated attachment threads through unchanged.
#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatImage {
    pub mime_type: String,
    pub data_base64: String,
}

impl ChatImage {
    /// Decoded byte size, derived from the base64 length (no allocation).
    /// base64 encodes 3 bytes per 4 chars; this ignores padding, which is a
    /// close-enough estimate for the session image-byte budget.
    pub fn approx_decoded_bytes(&self) -> usize {
        self.data_base64.len() / 4 * 3
    }
}

/// A single conversation turn.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    /// Image attachments (user turns only; always empty for assistant/model turns).
    pub images: Vec<ChatImage>,
}

impl ChatMessage {
    pub fn new(role: impl Into<String>, content: impl Into<String>) -> Self {
        Self {
            role: role.into(),
            content: content.into(),
            images: Vec::new(),
        }
    }

    pub fn new_with_images(
        role: impl Into<String>,
        content: impl Into<String>,
        images: Vec<ChatImage>,
    ) -> Self {
        Self {
            role: role.into(),
            content: content.into(),
            images,
        }
    }
}

/// Per-session chat history shared by all providers.
pub struct ChatHistoryStore {
    inner: Mutex<HashMap<String, Vec<ChatMessage>>>,
    max_messages: usize,
}

impl ChatHistoryStore {
    /// Create a store that caps each session to `max_messages` turns (0 = no cap).
    pub fn new(max_messages: usize) -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
            max_messages,
        }
    }

    /// Append a text-only turn (machine/assistant/user) to a session's history.
    pub fn push(&self, session_id: &str, role: &str, content: &str) {
        let mut map = self.inner.lock().unwrap();
        map.entry(session_id.to_string())
            .or_default()
            .push(ChatMessage::new(role, content));
    }

    /// Append a `user` turn that may carry image attachments, then evict the
    /// oldest images if the session's total image bytes exceed the budget (so a
    /// long conversation of screenshots stays bounded while recent images — which
    /// follow-up questions reference — are preserved).
    pub fn push_user(&self, session_id: &str, content: &str, images: Vec<ChatImage>) {
        let mut map = self.inner.lock().unwrap();
        let history = map.entry(session_id.to_string()).or_default();
        history.push(ChatMessage::new_with_images("user", content, images));
        evict_images_over_budget(history, MAX_SESSION_IMAGE_BYTES);
    }

    /// Snapshot a session's history for building a request body.
    pub fn snapshot(&self, session_id: &str) -> Vec<ChatMessage> {
        self.inner
            .lock()
            .unwrap()
            .get(session_id)
            .cloned()
            .unwrap_or_default()
    }

    /// Commit the assistant turn after a stream ends (normal completion or user
    /// cancel), applying the shared finalize rule and the history cap. `role` is
    /// the provider's assistant role name ("assistant" or "model"). No-op if the
    /// session has no history (nothing was ever pushed).
    pub fn finalize_assistant(
        &self,
        session_id: &str,
        role: &str,
        full_response: &str,
        cancelled: bool,
    ) {
        let content = finalize_assistant_content(full_response, cancelled);
        let mut map = self.inner.lock().unwrap();
        if let Some(history) = map.get_mut(session_id) {
            history.push(ChatMessage::new(role, content));
            cap_history(history, self.max_messages);
            evict_images_over_budget(history, MAX_SESSION_IMAGE_BYTES);
        }
    }

    /// Drop a trailing `user` turn (hard error before any assistant content) so
    /// the user/assistant alternation the chat APIs require stays consistent for
    /// the next request.
    pub fn pop_trailing_user(&self, session_id: &str) {
        let mut map = self.inner.lock().unwrap();
        if let Some(history) = map.get_mut(session_id) {
            if matches!(history.last(), Some(m) if m.role == "user") {
                history.pop();
            }
        }
    }

    /// Clear a single session's history.
    pub fn clear(&self, session_id: &str) {
        self.inner.lock().unwrap().remove(session_id);
    }

    /// Clear every session (logout).
    pub fn clear_all(&self) {
        self.inner.lock().unwrap().clear();
    }

    #[cfg(test)]
    pub fn len(&self, session_id: &str) -> usize {
        self.inner
            .lock()
            .unwrap()
            .get(session_id)
            .map(|h| h.len())
            .unwrap_or(0)
    }
}

/// Per-session ceiling on total attached-image bytes kept in history. Comfortably
/// under every provider's request-size limit (~20-30 MB) while leaving headroom
/// for text, so re-serializing the full snapshot each turn can't balloon a body
/// past what the API accepts. Multi-MB screenshots accumulate fast; without this
/// a long conversation would grow unbounded and eventually be rejected.
const MAX_SESSION_IMAGE_BYTES: usize = 20 * 1024 * 1024;

/// Drop image attachments from the oldest turns first until the session's total
/// image bytes are within `budget`. Only the `images` vec is cleared — the turn's
/// text and role stay intact, so user/assistant alternation is untouched and the
/// most recent images (the ones follow-up questions reference) are preserved.
fn evict_images_over_budget(history: &mut [ChatMessage], budget: usize) {
    let mut total: usize = history
        .iter()
        .flat_map(|m| m.images.iter())
        .map(|img| img.approx_decoded_bytes())
        .sum();
    if total <= budget {
        return;
    }
    for msg in history.iter_mut() {
        if total <= budget {
            break;
        }
        if msg.images.is_empty() {
            continue;
        }
        let freed: usize = msg
            .images
            .iter()
            .map(|img| img.approx_decoded_bytes())
            .sum();
        msg.images.clear();
        total = total.saturating_sub(freed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn push_and_snapshot_roundtrip() {
        let store = ChatHistoryStore::new(0);
        store.push("s1", "user", "hello");
        let snap = store.snapshot("s1");
        assert_eq!(snap, vec![ChatMessage::new("user", "hello")]);
        assert_eq!(store.snapshot("absent"), Vec::<ChatMessage>::new());
    }

    #[test]
    fn finalize_assistant_appends_and_marks_cancel() {
        let store = ChatHistoryStore::new(0);
        store.push("s1", "user", "hi");
        store.finalize_assistant("s1", "assistant", "answer", false);
        assert_eq!(
            store.snapshot("s1"),
            vec![
                ChatMessage::new("user", "hi"),
                ChatMessage::new("assistant", "answer"),
            ]
        );
        store.push("s1", "user", "again");
        store.finalize_assistant("s1", "assistant", "partial", true);
        assert_eq!(
            store.snapshot("s1").last().unwrap().content,
            "partial\n\n[cancelled by user]"
        );
    }

    #[test]
    fn finalize_is_noop_for_unknown_session() {
        let store = ChatHistoryStore::new(0);
        store.finalize_assistant("ghost", "model", "x", false);
        assert_eq!(store.len("ghost"), 0);
    }

    #[test]
    fn pop_trailing_user_only_pops_a_user_turn() {
        let store = ChatHistoryStore::new(0);
        store.push("s1", "user", "hi");
        store.pop_trailing_user("s1");
        assert_eq!(store.len("s1"), 0);
        // Non-user trailing turn is left intact.
        store.push("s1", "user", "hi");
        store.finalize_assistant("s1", "assistant", "ok", false);
        store.pop_trailing_user("s1");
        assert_eq!(store.len("s1"), 2);
    }

    #[test]
    fn cap_trims_oldest_pairs() {
        let store = ChatHistoryStore::new(2);
        for i in 0..3 {
            store.push("s1", "user", &format!("u{i}"));
            store.finalize_assistant("s1", "assistant", &format!("a{i}"), false);
        }
        // Cap of 2 keeps only the most recent user/assistant pair.
        let snap = store.snapshot("s1");
        assert_eq!(snap.len(), 2);
        assert_eq!(snap[0], ChatMessage::new("user", "u2"));
        assert_eq!(snap[1], ChatMessage::new("assistant", "a2"));
    }

    #[test]
    fn clear_and_clear_all() {
        let store = ChatHistoryStore::new(0);
        store.push("s1", "user", "a");
        store.push("s2", "user", "b");
        store.clear("s1");
        assert_eq!(store.len("s1"), 0);
        assert_eq!(store.len("s2"), 1);
        store.clear_all();
        assert_eq!(store.len("s2"), 0);
    }

    #[test]
    fn chat_message_new_defaults_empty_images() {
        assert!(ChatMessage::new("user", "hi").images.is_empty());
    }

    /// A ChatImage whose `approx_decoded_bytes()` is exactly `bytes` (base64 length
    /// = bytes/3*4; pass a multiple of 3). Content is arbitrary — eviction reads
    /// only the string length, not decoded data.
    fn img_of(bytes: usize) -> ChatImage {
        ChatImage {
            mime_type: "image/png".to_string(),
            data_base64: "A".repeat(bytes / 3 * 4),
        }
    }

    #[test]
    fn push_user_stores_images() {
        let store = ChatHistoryStore::new(0);
        store.push_user("s1", "look", vec![img_of(300)]);
        let snap = store.snapshot("s1");
        assert_eq!(snap.len(), 1);
        assert_eq!(snap[0].role, "user");
        assert_eq!(snap[0].content, "look");
        assert_eq!(snap[0].images.len(), 1);
    }

    #[test]
    fn push_user_under_budget_keeps_all_images() {
        let store = ChatHistoryStore::new(0);
        // Well under the 20 MiB session budget.
        store.push_user("s1", "a", vec![img_of(300)]);
        store.push_user("s1", "b", vec![img_of(300)]);
        let snap = store.snapshot("s1");
        assert_eq!(snap[0].images.len(), 1);
        assert_eq!(snap[1].images.len(), 1);
    }

    #[test]
    fn evict_drops_oldest_images_first() {
        // Three user turns, each with one 300-byte image (total 900). A 600-byte
        // budget must clear the oldest turn's image (freeing 300 -> total 600) and
        // stop, keeping the two most recent.
        let mut history = vec![
            ChatMessage::new_with_images("user", "u0", vec![img_of(300)]),
            ChatMessage::new_with_images("user", "u1", vec![img_of(300)]),
            ChatMessage::new_with_images("user", "u2", vec![img_of(300)]),
        ];
        evict_images_over_budget(&mut history, 600);
        assert!(
            history[0].images.is_empty(),
            "oldest image should be evicted"
        );
        assert_eq!(history[1].images.len(), 1);
        assert_eq!(history[2].images.len(), 1);
        // Text is never touched by eviction.
        assert_eq!(history[0].content, "u0");
    }

    #[test]
    fn evict_noop_when_within_budget() {
        let mut history = vec![ChatMessage::new_with_images(
            "user",
            "u0",
            vec![img_of(300)],
        )];
        evict_images_over_budget(&mut history, 20 * 1024 * 1024);
        assert_eq!(history[0].images.len(), 1);
    }
}
