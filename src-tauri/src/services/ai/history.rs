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

/// A single conversation turn.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

impl ChatMessage {
    pub fn new(role: impl Into<String>, content: impl Into<String>) -> Self {
        Self {
            role: role.into(),
            content: content.into(),
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

    /// Append a turn (typically the user turn) to a session's history.
    pub fn push(&self, session_id: &str, role: &str, content: &str) {
        let mut map = self.inner.lock().unwrap();
        map.entry(session_id.to_string())
            .or_default()
            .push(ChatMessage::new(role, content));
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
}
