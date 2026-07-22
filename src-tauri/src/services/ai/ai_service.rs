use serde_json::Value;
use std::path::Path;
use tauri::AppHandle;

use super::ai_provider::{AuthStatus, ModelInfo};
use super::provider_registry::AIProviderRegistry;
use tokio_util::sync::CancellationToken;

/// Centralised AI service that manages an active provider and delegates
/// all operations to the provider registry.
pub struct AIService {
    registry: AIProviderRegistry,
    active_provider_id: String,
}

impl AIService {
    pub fn new(registry: AIProviderRegistry, default_provider_id: &str) -> Self {
        Self {
            registry,
            active_provider_id: default_provider_id.to_string(),
        }
    }

    // -- Provider selection ---------------------------------------------------

    pub fn set_active_provider(&mut self, id: &str) -> Result<(), String> {
        if !self.registry.contains(id) {
            return Err(format!("Unknown AI provider: {id}"));
        }
        self.active_provider_id = id.to_string();
        Ok(())
    }

    // -- Authentication -------------------------------------------------------

    pub async fn authenticate(
        &mut self,
        app: &AppHandle,
        credentials: Value,
    ) -> Result<bool, String> {
        let id = self.active_provider_id.clone();
        let provider = self
            .registry
            .get_mut(&id)
            .ok_or_else(|| format!("AI provider '{}' not found", id))?;
        provider.authenticate(app, credentials).await
    }

    pub async fn auto_auth(
        &mut self,
        app_data_dir: &Path,
        credentials: Value,
    ) -> Result<bool, String> {
        let id = self.active_provider_id.clone();
        let provider = self
            .registry
            .get_mut(&id)
            .ok_or_else(|| format!("AI provider '{}' not found", id))?;
        provider.auto_auth(app_data_dir, credentials).await
    }

    pub fn get_auth_status(&self) -> AuthStatus {
        self.registry
            .get(&self.active_provider_id)
            .map(|p| p.get_auth_status())
            .unwrap_or(AuthStatus {
                authenticated: false,
                account_info: None,
            })
    }

    pub fn logout(&mut self) {
        // Log out of EVERY provider, not just the active one. A single "Logout"
        // means "disconnect AI"; clearing only the active provider left other
        // providers' stored credentials on disk to silently re-auth on switch.
        for provider in self.registry.iter_mut() {
            provider.logout();
        }
    }

    // -- Chat -----------------------------------------------------------------

    #[allow(clippy::too_many_arguments)]
    pub async fn send_message(
        &self,
        app: &AppHandle,
        session_id: &str,
        message: &str,
        model: &str,
        system_instruction: Option<&str>,
        images: Vec<crate::services::ai::history::ChatImage>,
        cancel_token: CancellationToken,
    ) -> Result<(), String> {
        let provider = self
            .registry
            .get(&self.active_provider_id)
            .ok_or_else(|| format!("AI provider '{}' not found", self.active_provider_id))?;
        provider
            .send_message(
                app,
                session_id,
                message,
                model,
                system_instruction,
                images,
                cancel_token,
            )
            .await
    }

    /// One-shot command-safety classification via the active provider.
    pub async fn classify_command(
        &self,
        command: &str,
        model: &str,
    ) -> Result<crate::services::ai::classifier::CommandVerdict, String> {
        let provider = self
            .registry
            .get(&self.active_provider_id)
            .ok_or_else(|| format!("AI provider '{}' not found", self.active_provider_id))?;
        provider.classify_command(command, model).await
    }

    pub fn clear_history(&self, session_id: &str) {
        // A tab's history can live in a non-active provider (opened under provider
        // A, then switched to B). Clear the session in ALL providers so closing a
        // tab or starting a new chat never strands a conversation in memory.
        for provider in self.registry.iter() {
            provider.clear_history(session_id);
        }
    }

    // -- Models & locations ---------------------------------------------------

    pub async fn list_models(&self) -> Result<Vec<ModelInfo>, String> {
        let provider = self
            .registry
            .get(&self.active_provider_id)
            .ok_or_else(|| format!("AI provider '{}' not found", self.active_provider_id))?;
        provider.list_models().await
    }

    pub fn set_location(&mut self, location: &str) {
        let id = self.active_provider_id.clone();
        if let Some(provider) = self.registry.get_mut(&id) {
            provider.set_location(location);
        }
    }

    pub async fn list_locations(&self) -> Result<Vec<String>, String> {
        let provider = self
            .registry
            .get(&self.active_provider_id)
            .ok_or_else(|| format!("AI provider '{}' not found", self.active_provider_id))?;
        provider.list_locations().await
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::ai::ai_provider::{AIProvider, AuthStatus, ModelInfo};
    use crate::services::ai::provider_registry::AIProviderRegistry;
    use async_trait::async_trait;

    struct StubProvider {
        provider_id: String,
    }

    #[async_trait]
    impl AIProvider for StubProvider {
        fn id(&self) -> &str {
            &self.provider_id
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

    fn make_service() -> AIService {
        let mut registry = AIProviderRegistry::new();
        registry.register(Box::new(StubProvider {
            provider_id: "alpha".into(),
        }));
        registry.register(Box::new(StubProvider {
            provider_id: "beta".into(),
        }));
        AIService::new(registry, "alpha")
    }

    #[test]
    fn default_provider_is_set() {
        let svc = make_service();
        assert_eq!(svc.active_provider_id.as_str(), "alpha");
    }

    #[test]
    fn set_active_provider_valid() {
        let mut svc = make_service();
        assert!(svc.set_active_provider("beta").is_ok());
        assert_eq!(svc.active_provider_id.as_str(), "beta");
    }

    #[test]
    fn set_active_provider_invalid() {
        let mut svc = make_service();
        let result = svc.set_active_provider("nonexistent");
        assert!(result.is_err());
        assert_eq!(svc.active_provider_id.as_str(), "alpha");
    }

    #[test]
    fn get_auth_status_unauthenticated() {
        let svc = make_service();
        let status = svc.get_auth_status();
        assert!(!status.authenticated);
    }
}
