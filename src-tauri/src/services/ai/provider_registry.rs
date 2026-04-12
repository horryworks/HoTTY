use std::collections::HashMap;

use super::ai_provider::{AIProvider, ProviderInfo};

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

    /// List all registered providers as summary info.
    pub fn list(&self) -> Vec<ProviderInfo> {
        let mut list: Vec<ProviderInfo> = self
            .providers
            .values()
            .map(|p| ProviderInfo {
                id: p.id().to_string(),
                display_name: p.display_name().to_string(),
                auth_type: p.auth_type(),
            })
            .collect();
        list.sort_by(|a, b| a.id.cmp(&b.id));
        list
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
    use crate::services::ai::ai_provider::{AuthStatus, AuthType, ModelInfo};
    use async_trait::async_trait;
    use serde_json::Value;
    use std::path::Path;
    use tauri::AppHandle;

    struct MockProvider {
        id: String,
        name: String,
    }

    #[async_trait]
    impl AIProvider for MockProvider {
        fn id(&self) -> &str {
            &self.id
        }
        fn display_name(&self) -> &str {
            &self.name
        }
        fn auth_type(&self) -> AuthType {
            AuthType::ApiKey
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
            &mut self,
            _app: &AppHandle,
            _session_id: &str,
            _message: &str,
            _model: &str,
            _system_instruction: Option<&str>,
        ) -> Result<(), String> {
            Ok(())
        }
        fn cancel_message(&mut self, _session_id: &str) {}
        fn clear_history(&mut self, _session_id: &str) {}
        async fn list_models(&self) -> Result<Vec<ModelInfo>, String> {
            Ok(vec![])
        }
    }

    #[test]
    fn register_and_get() {
        let mut reg = AIProviderRegistry::new();
        reg.register(Box::new(MockProvider {
            id: "test".into(),
            name: "Test Provider".into(),
        }));
        assert!(reg.get("test").is_some());
        assert!(reg.get("nonexistent").is_none());
    }

    #[test]
    fn contains_works() {
        let mut reg = AIProviderRegistry::new();
        reg.register(Box::new(MockProvider {
            id: "a".into(),
            name: "A".into(),
        }));
        assert!(reg.contains("a"));
        assert!(!reg.contains("b"));
    }

    #[test]
    fn list_returns_sorted() {
        let mut reg = AIProviderRegistry::new();
        reg.register(Box::new(MockProvider {
            id: "z_provider".into(),
            name: "Z".into(),
        }));
        reg.register(Box::new(MockProvider {
            id: "a_provider".into(),
            name: "A".into(),
        }));
        let list = reg.list();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].id, "a_provider");
        assert_eq!(list[1].id, "z_provider");
    }

    #[test]
    fn get_mut_works() {
        let mut reg = AIProviderRegistry::new();
        reg.register(Box::new(MockProvider {
            id: "m".into(),
            name: "M".into(),
        }));
        assert!(reg.get_mut("m").is_some());
        assert!(reg.get_mut("x").is_none());
    }
}
