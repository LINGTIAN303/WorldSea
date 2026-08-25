//! LLM 通信层（genai 封装），详细见 docs/details/注释/agent-runtime/llm.md

pub mod config;
pub mod error;
pub mod manifest;
pub mod model;

#[cfg(feature = "llm-genai")]
pub mod genai_backend;

#[cfg(feature = "llm-genai")]
pub mod stream;

// ─── 公共导出 ────────────────────────────────────────────
pub use config::{ProviderConfig, ProviderMode, LocalApiType, CustomApiType};
pub use error::LlmError;
pub use manifest::{ProviderManifest, ProviderId, ALL_MANIFESTS, find_manifest};
pub use model::{ModelInfo, ModelInput, ModelCost, ApiType};

#[cfg(feature = "llm-genai")]
pub use genai_backend::GenaiBackend;

#[cfg(feature = "llm-genai")]
pub use stream::{stream_simple, get_model, StreamEvent};
