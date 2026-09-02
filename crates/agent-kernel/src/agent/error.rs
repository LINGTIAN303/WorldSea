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

    #[error("总步骤预算耗尽（已达 {0} 步，仍未收敛）")]
    TotalStepsReached(u32),

    #[error("Loop Engineering 速率限制超限: {0}")]
    RateLimitExceeded(String),

    #[error("Agent 已被中断")]
    Aborted,

    #[error("其他错误: {0}")]
    Other(String),
}
