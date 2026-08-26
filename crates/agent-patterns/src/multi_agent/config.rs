use serde::{Deserialize, Serialize};

use agent_kernel::agent::AgentLoopConfig;

use super::error::ConvergenceStrategy;
use super::types::Topology;

// ─── 多 Agent 配置 ────────────────────────────────────────────

/// Multi-Agent 配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MultiAgentConfig {
    /// 最大协作轮次（防止无限循环，默认 10）
    pub max_rounds: usize,
    /// 单轮最大并发 Agent 数（默认 5，受 tokio JoinSet 调度）
    pub max_concurrency: usize,
    /// 拓扑结构（默认 Mesh）
    #[serde(default)]
    pub topology: Topology,
    /// 是否启用共享黑板（默认 true）
    #[serde(default = "default_true")]
    pub blackboard_enabled: bool,
    /// 是否启用消息传递（默认 true）
    #[serde(default = "default_true")]
    pub message_passing_enabled: bool,
    /// 收敛策略（默认 Hybrid: goal_check + max_rounds=10）
    #[serde(default)]
    pub convergence_strategy: ConvergenceStrategy,
    /// mpsc 通道容量（默认 32，避免背压过大）
    #[serde(default = "default_channel_capacity")]
    pub channel_capacity: usize,
    /// 子 Agent 共享的 AgentLoop 配置
    ///
    /// 注意：`system_prompt` 和 `max_iterations` 会被 `AgentSpec` 的对应字段覆盖。
    /// 序列化时跳过（AgentLoopConfig 含 Duration 等不可序列化字段），
    /// 反序列化时用 `AgentLoopConfig::default()`。
    #[serde(skip)]
    pub agent_loop_config: AgentLoopConfig,
    /// 是否在最后综合所有 Agent 输出（生成 final_result）
    #[serde(default = "default_true")]
    pub require_synthesis: bool,
}

fn default_true() -> bool {
    true
}

fn default_channel_capacity() -> usize {
    32
}

impl Default for MultiAgentConfig {
    fn default() -> Self {
        Self {
            max_rounds: 10,
            max_concurrency: 5,
            topology: Topology::default(),
            blackboard_enabled: true,
            message_passing_enabled: true,
            convergence_strategy: ConvergenceStrategy::default(),
            channel_capacity: 32,
            agent_loop_config: AgentLoopConfig::default(),
            require_synthesis: true,
        }
    }
}
