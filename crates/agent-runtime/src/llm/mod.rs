//! # LLM 通信层
//!
//! 对应 TS 版 `pi-ai` 的 `streamSimple` / `getModel` / Provider 适配层。
//! 阶段 1.2 实现：基于 `genai` crate 封装统一 LLM 通信接口。
//!
//! ## 模块组织
//! - [`manifest`]：Provider 静态清单（16 个内置 Provider 的元数据）
//! - [`config`]：运行时 ProviderConfig（cloud/local/custom 三种部署模式）
//! - [`model`]：ModelInfo（对应 pi-ai 的 Model 结构）
//! - [`error`]：LLM 通信层错误
//! - [`genai_backend`]：基于 genai 的 NodeBackendAccessor 实现（feature = "llm-genai"）
//! - [`stream`]：stream_simple 等价函数 + 事件映射（feature = "llm-genai"）
//!
//! ## 与 TS 版差异
//! - worldsmith 没有 SQLite provider 表，配置在前端 localStorage
//! - Rust 侧通过运行时注入 ProviderConfig（与 TS 版一致）
//! - API Key 通过 keyring 或运行时传入，不持久化到 SQLite

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
