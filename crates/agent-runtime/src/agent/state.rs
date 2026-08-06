use crate::backend::ThinkingLevel;
use crate::types::{MessageRole, OrchestratorMessage};

/// AgentLoop 运行时状态
#[derive(Debug, Clone)]
pub struct AgentState {
    /// 消息历史（含 system/user/assistant/toolResult）
    pub messages: Vec<OrchestratorMessage>,
    /// 当前迭代次数
    pub current_iteration: u32,
    /// 是否被中断
    pub aborted: bool,
    /// 是否暂停
    pub paused: bool,
}

impl AgentState {
    /// 创建空状态
    pub fn new() -> Self {
        Self {
            messages: Vec::new(),
            current_iteration: 0,
            aborted: false,
            paused: false,
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
}
