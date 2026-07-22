use std::collections::HashMap;

use super::ai_provider::AIProvider;

/// Registry that holds all available AI providers keyed by their ID.
pub struct AIProviderRegistry {
    providers: HashMap<String, Box<dyn AIProvider>>,
}

impl Default for AIProviderRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl AIProviderRegistry {
    pub fn new() -> Self {
        Self {
            providers: HashMap::new(),
        }
    }

    /// Register a provider. Overwrites any existing provider with the same ID.
    pub fn register(&mut self, provider: Box<dyn AIProvider>) {
        let id = provider.id().to_string();
        self.providers.insert(id, provider);
    }

    /// Get an immutable reference to a provider by ID.
    pub fn get(&self, id: &str) -> Option<&dyn AIProvider> {
        self.providers.get(id).map(|p| p.as_ref())
    }

    /// Get a mutable reference to a provider by ID.
    pub fn get_mut(&mut self, id: &str) -> Option<&mut Box<dyn AIProvider>> {
        self.providers.get_mut(id)
    }

    /// Mutable iterator over every registered provider. Used for `&mut self`
    /// session-scoped operations (logout) that must reach whichever provider
    /// actually holds that session's state — not just the active one.
    pub fn iter_mut(&mut self) -> impl Iterator<Item = &mut Box<dyn AIProvider>> {
        self.providers.values_mut()
    }

    /// Shared iterator over every registered provider. Used for `&self`
    /// session-scoped operations (clear_history) now that per-session state is
    /// interior-mutable — reaches whichever provider holds the session, not just
    /// the active one, without an exclusive borrow.
    pub fn iter(&self) -> impl Iterator<Item = &dyn AIProvider> {
        self.providers.values().map(|p| p.as_ref())
    }

    /// Check if a provider with the given ID exists.
    pub fn contains(&self, id: &str) -> bool {
        self.providers.contains_key(id)
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::ai::ai_provider::{AuthStatus, ModelInfo};
    use async_trait::async_trait;
    use serde_json::Value;
    use std::path::Path;
    use tauri::AppHandle;

    struct MockProvider {
        id: String,
    }

    #[async_trait]
    impl AIProvider for MockProvider {
        fn id(&self) -> &str {
            &self.id
        }
        async fn authenticate(
            &mut self,
            _app: &AppHandle,
            _credentials: Value,
        ) -> Result<bool, String> {
            Ok(false)
        }
        async fn auto_auth(
            &mut self,
            _app_data_dir: &Path,
            _credentials: Value,
        ) -> Result<bool, String> {
            Ok(false)
        }
        fn get_auth_status(&self) -> AuthStatus {
            AuthStatus {
                authenticated: false,
                account_info: None,
            }
        }
        fn logout(&mut self) {}
        async fn send_message(
            &self,
            _app: &AppHandle,
            _session_id: &str,
            _message: &str,
            _model: &str,
            _system_instruction: Option<&str>,
            _images: Vec<crate::services::ai::history::ChatImage>,
            _cancel_token: tokio_util::sync::CancellationToken,
        ) -> Result<(), String> {
            Ok(())
        }
        fn clear_history(&self, _session_id: &str) {}
        async fn list_models(&self) -> Result<Vec<ModelInfo>, String> {
            Ok(vec![])
        }
    }

    #[test]
    fn register_and_get() {
        let mut reg = AIProviderRegistry::new();
        reg.register(Box::new(MockProvider { id: "test".into() }));
        assert!(reg.get("test").is_some());
        assert!(reg.get("nonexistent").is_none());
    }

    #[test]
    fn contains_works() {
        let mut reg = AIProviderRegistry::new();
        reg.register(Box::new(MockProvider { id: "a".into() }));
        assert!(reg.contains("a"));
        assert!(!reg.contains("b"));
    }

    #[test]
    fn get_mut_works() {
        let mut reg = AIProviderRegistry::new();
        reg.register(Box::new(MockProvider { id: "m".into() }));
        assert!(reg.get_mut("m").is_some());
        assert!(reg.get_mut("x").is_none());
    }
}
