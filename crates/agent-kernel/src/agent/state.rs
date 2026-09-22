use crate::backend::ThinkingLevel;
use crate::types::{MessageRole, OrchestratorMessage, PlanItem};

/// AgentLoop 运行时状态
#[derive(Debug, Clone)]
pub struct AgentState {
    /// 消息历史（含 system/user/assistant/toolResult）
    pub messages: Vec<OrchestratorMessage>,
    /// 当前迭代次数（LLM 调用轮数，日志/checkpoint 用）
    pub current_iteration: u32,
    /// 总步骤已用（工具调用轮数，口径对齐 Claude Code maxTurns：
    /// 每轮含 ≥1 工具调用的 LLM 决策计 1 步；纯文本收尾轮不计）
    pub total_steps_used: u32,
    /// 80% 预算告警已通知（每任务一次，避免重复注入）
    pub budget_warn_80_notified: bool,
    /// 95% 预算告警已通知（每任务一次）
    pub budget_warn_95_notified: bool,
    /// 最终收尾步提示已注入（达到 100% 预算时一次）
    pub budget_final_notified: bool,
    /// 是否被中断
    pub aborted: bool,
    /// 是否暂停
    pub paused: bool,
    /// A4 Plan-Exec：当前任务计划（由 `todo_write` 全量重写，随会话持久化）
    pub plan: Option<Vec<PlanItem>>,
}

impl AgentState {
    /// 创建空状态
    pub fn new() -> Self {
        Self {
            messages: Vec::new(),
            current_iteration: 0,
            total_steps_used: 0,
            budget_warn_80_notified: false,
            budget_warn_95_notified: false,
            budget_final_notified: false,
            aborted: false,
            paused: false,
            plan: None,
        }
    }

    /// 创建带系统提示词的状态
    pub fn with_system_prompt(system_prompt: impl Into<String>) -> Self {
        let mut state = Self::new();
        state.messages.push(OrchestratorMessage {
            role: MessageRole::System,
            content: system_prompt.into(),
            tool_calls: Vec::new(),
            tool_call_id: None,
            meta: None,
        });
        state
    }
}

impl Default for AgentState {
    fn default() -> Self {
        Self::new()
    }
}

// ─── 状态快照（前端友好） ────────────────────────────────────────────

/// AgentLoop 状态快照 — 对应前端 `IAgentBackend.state` 的只读视图
///
/// 与 `AgentState` 的区别：
/// - `AgentState`：内部可变运行时状态（含 messages 写入权）
/// - `AgentStateSnapshot`：序列化友好的只读视图，用于 Tauri IPC 传递给前端
#[derive(Debug, Clone, serde::Serialize)]
pub struct AgentStateSnapshot {
    /// 当前迭代次数
    pub current_iteration: u32,
    /// 是否被中断
    pub aborted: bool,
    /// 是否暂停
    pub paused: bool,
    /// 是否正在流式输出（run 方法活跃中）
    pub is_streaming: bool,
    /// 当前消息历史快照
    pub messages: Vec<OrchestratorMessage>,
    /// 当前模型 ID（从 backend 获取）
    pub model: String,
    /// 当前思考级别
    pub thinking_level: Option<ThinkingLevel>,
    /// A4 Plan-Exec：当前任务计划（前端 get_state 恢复用；null=无计划）
    pub plan: Option<Vec<PlanItem>>,
}
