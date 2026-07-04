pub mod ai_provider;
pub mod ai_service;
pub mod classifier;
pub mod config_store;
pub mod provider_registry;
pub mod providers;
pub mod sse;
pub mod streaming;
pub mod validation;

// Re-export commonly used types. Only the names consumed through the
// `services::ai::` path live here; the rest are reached via the direct
// `ai_provider::` path (unused `pub use` draws no compiler warning, so keep
// this list tight).
pub use ai_provider::{AuthStatus, ModelInfo};
pub use ai_service::AIService;
pub use classifier::CommandVerdict;
pub use provider_registry::AIProviderRegistry;
