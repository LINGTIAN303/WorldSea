//! # Provider 配置
//!
//! 对应 TS 版 `worldsea-agent/src/providers/config.ts`。
//! 三种部署模式：cloud / local / custom。
//!
//! ## 存储策略
//! worldsea 没有 SQLite provider 表，配置在前端 localStorage。
//! Rust 侧通过运行时注入 ProviderConfig（Tauri 命令从前端传入）。
//! API Key 通过 keyring 或运行时传入，不在此结构中持久化。

use serde::{Deserialize, Serialize};

use super::model::ApiType;

/// Provider 部署模式
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProviderMode {
    /// 云端供应商（OpenAI/Anthropic/DeepSeek 等）
    Cloud,
    /// 本地推理（ollama/lm-studio/vllm/llama-cpp）
    Local,
    /// 自定义远程端点（OpenAI/Anthropic 兼容协议）
    Custom,
}

/// 本地推理 API 类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LocalApiType {
    Ollama,
    LmStudio,
    Vllm,
    LlamaCpp,
}

/// 自定义远程 API 类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CustomApiType {
    /// OpenAI 兼容协议
    OpenaiCompatible,
    /// Anthropic 兼容协议
    AnthropicCompatible,
}

/// Provider 配置（运行时注入）
///
/// 对应 TS 版 `ProviderConfig` 联合类型。
/// 用 enum 而非 struct + Option 字段，保证模式与字段一一对应。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "lowercase")]
pub enum ProviderConfig {
    /// 云端供应商
    Cloud {
        /// Provider ID（如 "deepseek" / "openai" / "anthropic"）
        provider: String,
        /// 模型 ID（如 "deepseek-v4-flash"）
        model_id: String,
        /// API Key（运行时注入，不持久化）
        #[serde(skip_serializing)]
        api_key: String,
    },
    /// 本地推理
    Local {
        /// 端点 URL（如 "http://localhost:11434"）
        endpoint: String,
        /// 本地 API 类型
        api_type: LocalApiType,
        /// 模型 ID
        model_id: String,
    },
    /// 自定义远程端点
    Custom {
        /// Base URL（如 "https://api.example.com/v1"）
        base_url: String,
        /// API Key（运行时注入，不持久化）
        #[serde(skip_serializing)]
        api_key: String,
        /// 自定义 API 类型
        api_type: CustomApiType,
        /// 模型 ID
        model_id: String,
        /// 上下文窗口大小（可选，默认 1048576）
        #[serde(default = "default_context_window")]
        context_window: u32,
        /// 最大输出 token（可选，默认 65536）
        #[serde(default = "default_max_tokens")]
        max_tokens: u32,
    },
}

impl ProviderConfig {
    /// 获取模型 ID
    pub fn model_id(&self) -> &str {
        match self {
            Self::Cloud { model_id, .. } => model_id,
            Self::Local { model_id, .. } => model_id,
            Self::Custom { model_id, .. } => model_id,
        }
    }

    /// 获取 API Key（local 模式返回空字符串）
    pub fn api_key(&self) -> &str {
        match self {
            Self::Cloud { api_key, .. } => api_key,
            Self::Local { .. } => "",
            Self::Custom { api_key, .. } => api_key,
        }
    }

    /// 获取 Provider ID（用于查找 manifest）
    pub fn provider_id(&self) -> &str {
        match self {
            Self::Cloud { provider, .. } => provider,
            Self::Local { api_type, .. } => match api_type {
                LocalApiType::Ollama => "ollama",
                LocalApiType::LmStudio => "lm-studio",
                LocalApiType::Vllm => "vllm",
                LocalApiType::LlamaCpp => "llama-cpp",
            },
            Self::Custom { api_type, .. } => match api_type {
                CustomApiType::OpenaiCompatible => "openai-compatible",
                CustomApiType::AnthropicCompatible => "anthropic-compatible",
            },
        }
    }

    /// 推断 API 协议类型
    pub fn infer_api_type(&self) -> ApiType {
        match self {
            Self::Cloud { provider, .. } => {
                // 查 manifest 确定协议
                super::manifest::find_manifest(provider)
                    .map(|m| m.api_type)
                    .unwrap_or(ApiType::OpenaiCompletions)
            }
            Self::Local { .. } => ApiType::OpenaiCompletions, // 本地推理默认 OpenAI 兼容
            Self::Custom { api_type, .. } => match api_type {
                CustomApiType::OpenaiCompatible => ApiType::OpenaiCompletions,
                CustomApiType::AnthropicCompatible => ApiType::AnthropicMessages,
            },
        }
    }

    /// 获取 Base URL（cloud 模式从 manifest 查找）
    pub fn resolve_base_url(&self) -> String {
        match self {
            Self::Cloud { provider, .. } => {
                super::manifest::find_manifest(provider)
                    .map(|m| m.direct_base_url.to_string())
                    .unwrap_or_default()
            }
            Self::Local { endpoint, .. } => endpoint.clone(),
            Self::Custom { base_url, .. } => base_url.clone(),
        }
    }
}

fn default_context_window() -> u32 {
    1_048_576
}

fn default_max_tokens() -> u32 {
    65_536
}
