use crate::backend::BackendError;
use crate::tool::ToolError;

// ─── 错误类型 ────────────────────────────────────────────

/// AgentLoop 错误
#[derive(Debug, thiserror::Error)]
pub enum AgentError {
    #[error("LLM 后端错误: {0}")]
    Backend(#[from] BackendError),

    #[error("工具执行错误: {0}")]
    Tool(#[from] ToolError),

    #[error("超过最大迭代次数: {0}")]
    MaxIterationsExceeded(u32),

    #[error("Loop Engineering 速率限制超限: {0}")]
    RateLimitExceeded(String),

    #[error("Agent 已被中断")]
    Aborted,

    #[error("其他错误: {0}")]
    Other(String),
}
