//! # LLM 通信层错误

use crate::backend::BackendError;

/// LLM 通信层错误
///
/// 与 [`BackendError`] 的转换：所有 `LlmError` 都可转换为 `BackendError`，
/// 供 `NodeBackendAccessor` 实现使用。
#[derive(Debug, thiserror::Error)]
pub enum LlmError {
    #[error("Provider 不存在: {0}")]
    ProviderNotFound(String),

    #[error("模型不存在: {0}")]
    ModelNotFound(String),

    #[error("API Key 缺失: provider={0}")]
    MissingApiKey(String),

    #[error("BaseURL 无效: {0}")]
    InvalidBaseUrl(String),

    #[error("网络错误: {0}")]
    Network(String),

    #[error("认证失败: {0}")]
    Auth(String),

    #[error("速率限制")]
    RateLimit,

    #[error("响应解析失败: {0}")]
    Parse(String),

    #[error("调用被中止")]
    Aborted,

    #[error("genai 错误: {0}")]
    Genai(String),

    #[error("其他错误: {0}")]
    Other(String),
}

impl From<LlmError> for BackendError {
    fn from(e: LlmError) -> Self {
        match e {
            LlmError::Network(msg) => BackendError::Network(msg),
            LlmError::Auth(msg) => BackendError::Auth(msg),
            LlmError::ModelNotFound(msg) => BackendError::ModelNotFound(msg),
            LlmError::RateLimit => BackendError::RateLimit,
            LlmError::Parse(msg) => BackendError::Parse(msg),
            LlmError::Aborted => BackendError::Aborted,
            other => BackendError::Other(other.to_string()),
        }
    }
}

#[cfg(feature = "llm-genai")]
impl From<genai::Error> for LlmError {
    fn from(e: genai::Error) -> Self {
        let msg = e.to_string();
        // 简单的关键字匹配，将 genai 错误分类
        if msg.contains("auth") || msg.contains("401") || msg.contains("403") {
            LlmError::Auth(msg)
        } else if msg.contains("429") || msg.contains("rate limit") {
            LlmError::RateLimit
        } else if msg.contains("model") && msg.contains("not found") {
            LlmError::ModelNotFound(msg)
        } else if msg.contains("network") || msg.contains("connection") || msg.contains("timeout") {
            LlmError::Network(msg)
        } else {
            LlmError::Genai(msg)
        }
    }
}
