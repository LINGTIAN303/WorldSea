use serde::{Deserialize, Serialize};

// ─── 收敛策略 ────────────────────────────────────────────

/// 收敛策略 — 控制多 Agent 协作何时终止
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ConvergenceStrategy {
    /// 达到 max_rounds 即停止
    MaxRounds,
    /// LLM 判断目标达成即停止
    GoalReached,
    /// 所有 Agent 空闲且无消息即停止
    AllAgentsIdle,
    /// 组合策略（任一条件满足即停止）
    Hybrid {
        /// 是否启用目标检查
        goal_check: bool,
        /// 最大轮次（即使未达成目标也停止）
        max_rounds: usize,
    },
}

impl Default for ConvergenceStrategy {
    fn default() -> Self {
        Self::Hybrid {
            goal_check: true,
            max_rounds: 10,
        }
    }
}

/// 收敛原因（用于事件 payload）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConvergenceReason {
    /// 达到最大轮次
    MaxRoundsReached,
    /// LLM 判断目标达成
    GoalReached,
    /// 所有 Agent 空闲且无消息
    AllAgentsIdle,
    /// 外部中断
    Aborted,
}

// ─── 错误类型 ────────────────────────────────────────────

/// Multi-Agent 错误类型
#[derive(Debug, thiserror::Error)]
pub enum MultiAgentError {
    #[error("Agent 不存在: {0}")]
    AgentNotFound(String),

    #[error("无可用 Agent（specs 为空）")]
    NoAgents,

    #[error("LLM 调用失败: {0}")]
    LlmCall(String),

    #[error("LLM 响应解析失败: {0}")]
    Parse(String),

    #[error("Agent '{0}' 执行失败: {1}")]
    AgentRun(String, String),

    #[error("收敛检查失败: {0}")]
    ConvergenceCheck(String),

    #[error("综合输出失败: {0}")]
    Synthesis(String),

    #[error("其他错误: {0}")]
    Other(String),
}

impl From<crate::backend::BackendError> for MultiAgentError {
    fn from(e: crate::backend::BackendError) -> Self {
        Self::LlmCall(e.to_string())
    }
}

impl From<crate::agent::AgentError> for MultiAgentError {
    fn from(e: crate::agent::AgentError) -> Self {
        Self::AgentRun("unknown".into(), e.to_string())
    }
}
