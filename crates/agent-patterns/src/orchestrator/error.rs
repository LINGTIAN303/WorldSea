//! 错误分级与处置（设计 §4.5）
//!
//! 三档语义：`Retryable`（可重试，按退避重试且不换路由）、
//! `Fatal`（立即终局，外层治理可捕获后改参重进）、
//! `Governed`（预算/轮次/取消触发的治理终止——以 `RunReport::Governed`
//! 表达而非错误值，见 executor）。

use thiserror::Error;

/// 节点/执行器错误。`Retryable` 与 `Fatal` 的分档决定执行器行为（设计 4.5 表）。
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum NodeError {
    /// 可重试：Provider 5xx/超时、工具瞬态失败。重试不换路由。
    #[error("可重试错误（{label}）: {message}")]
    Retryable { label: String, message: String },

    /// 不可重试：schema 不匹配、预算拒绝、取消。立即终局。
    #[error("致命错误（{label}）: {message}")]
    Fatal { label: String, message: String },
}

impl NodeError {
    pub fn retryable(label: impl Into<String>, message: impl Into<String>) -> Self {
        NodeError::Retryable { label: label.into(), message: message.into() }
    }

    pub fn fatal(label: impl Into<String>, message: impl Into<String>) -> Self {
        NodeError::Fatal { label: label.into(), message: message.into() }
    }

    /// 执行器据此分级处置（设计 4.5）
    pub fn is_retryable(&self) -> bool {
        matches!(self, NodeError::Retryable { .. })
    }

    /// `Fatal` 的标签，与 `Port::Fatal(label)` 对应
    pub fn fatal_label(&self) -> Option<&str> {
        match self {
            NodeError::Fatal { label, .. } => Some(label),
            _ => None,
        }
    }
}

/// 通信层错误（M1 最小面；M5 GenaiAdapter 接入时扩展重试/降级语义）
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum LlmError {
    #[error("LLM 可重试错误: {0}")]
    Retryable(String),
    #[error("LLM 致命错误: {0}")]
    Fatal(String),
}

impl From<LlmError> for NodeError {
    fn from(e: LlmError) -> Self {
        match e {
            LlmError::Retryable(m) => NodeError::retryable("llm", m),
            LlmError::Fatal(m) => NodeError::fatal("llm", m),
        }
    }
}

/// 记忆层错误（M1 最小面；M4 四层记忆接入时扩展）
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum MemoryError {
    #[error("记忆层错误: {0}")]
    Storage(String),
}
