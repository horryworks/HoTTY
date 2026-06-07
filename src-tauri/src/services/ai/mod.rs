pub mod ai_provider;
pub mod ai_service;
pub mod classifier;
pub mod config_store;
pub mod provider_registry;
pub mod providers;
pub mod sse;
pub mod streaming;
pub mod validation;

// Re-export commonly used types
pub use ai_provider::{
    AuthResultPayload, AuthStatus, AuthType, ChatResponseData, ModelInfo, ProviderInfo,
    TokenUsage,
};
pub use classifier::CommandVerdict;
pub use ai_service::AIService;
pub use provider_registry::AIProviderRegistry;
