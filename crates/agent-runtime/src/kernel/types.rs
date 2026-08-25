//! # 核心数据结构
//!
//! 对应 TS 版 `packages/agent-core/src/orchestrator/types.ts` 的数据部分。
//! 所有结构体派生 `Serialize`/`Deserialize`，便于跨 Tauri 边界传递。

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

// ─── 共享状态 ────────────────────────────────────────────

/// 编排状态 — 节点间共享的数据容器
///
/// 所有节点读取/写入同一个 State 实例，实现数据流传递。
/// 类比 LangGraph 的 State，但用 `HashMap` 承载扩展字段，
/// 避免限制节点扩展自定义数据。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrchestratorState {
    /// 用户原始输入
    pub input: String,
    /// 图片附件（多模态）
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub images: Vec<ImageAttachment>,
    /// 当前累积的消息历史（含 user/assistant/toolResult/system）
    pub messages: Vec<OrchestratorMessage>,
    /// 当前选中的模型 ID
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub model_id: Option<String>,
    /// 当前会话模式
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub chat_mode: Option<String>,
    /// Plan-and-Execute 模式的计划项
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub plan: Option<Vec<PlanItem>>,
    /// Reflection 模式的评审结果
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub reflections: Option<Vec<ReflectionResult>>,
    /// 自定义扩展字段（各模式专用数据放这里）
    #[serde(default)]
    pub extra: HashMap<String, serde_json::Value>,
}

impl OrchestratorState {
    /// 创建一个新的空状态（仅含用户输入）
    pub fn new(input: impl Into<String>) -> Self {
        Self {
            input: input.into(),
            images: Vec::new(),
            messages: Vec::new(),
            model_id: None,
            chat_mode: None,
            plan: None,
            reflections: None,
            extra: HashMap::new(),
        }
    }
}

/// 图片附件
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageAttachment {
    /// Base64 编码的图片数据（不含 data: 前缀）
    pub data: String,
    /// MIME 类型（如 "image/png"）
    pub mime_type: String,
}

// ─── 消息 ────────────────────────────────────────────

/// 编排消息（与 pi-agent-core 的内部消息格式解耦）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrchestratorMessage {
    /// 角色
    pub role: MessageRole,
    /// 消息内容
    pub content: String,
    /// 工具调用信息（assistant 消息触发工具时）
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub tool_calls: Vec<ToolCall>,
    /// 工具调用 ID（toolResult 消息）
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub tool_call_id: Option<String>,
    /// 元数据（usage/thinking 等）
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub meta: Option<HashMap<String, serde_json::Value>>,
}

/// 消息角色
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MessageRole {
    User,
    Assistant,
    ToolResult,
    System,
}

/// 工具调用
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    /// 调用 ID（用于关联 toolResult）
    pub id: String,
    /// 工具名称
    pub name: String,
    /// 调用参数
    pub args: serde_json::Value,
}

// ─── Plan-and-Execute ────────────────────────────────────

/// 计划项
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanItem {
    /// 唯一 ID
    pub id: String,
    /// 标题
    pub title: String,
    /// 描述
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub description: Option<String>,
    /// 状态
    pub status: PlanItemStatus,
    /// 执行顺序
    pub order: i32,
    /// 执行结果摘要
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub output: Option<String>,
}

/// 计划项状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlanItemStatus {
    Pending,
    InProgress,
    Completed,
    Skipped,
    Failed,
}

// ─── Reflection ────────────────────────────────────

/// 评审结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReflectionResult {
    /// 被评审的内容摘要
    pub target: String,
    /// 评分（0-100，越高越好）
    pub score: u32,
    /// 识别的问题列表
    pub issues: Vec<ReflectionIssue>,
    /// 改进建议
    pub suggestions: Vec<String>,
    /// 评审轮次
    pub iteration: u32,
}

/// 评审问题
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReflectionIssue {
    /// 严重程度
    pub severity: ReflectionSeverity,
    /// 问题描述
    pub description: String,
}

/// 问题严重程度
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReflectionSeverity {
    Info,
    Warning,
    Error,
}

// ─── 工作记忆 ────────────────────────────────────

/// 工作记忆条目 — ReAct 循环内的单次观察记录
///
/// 与 `OrchestratorMessage` 的区别：
/// - `OrchestratorMessage`：完整对话历史
/// - `WorkingMemoryEntry`：仅工具调用的观察结果，是 ReAct 循环内的临时缓冲
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkingMemoryEntry {
    /// 条目唯一 ID
    pub id: String,
    /// 关联的工具调用 ID
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub tool_call_id: Option<String>,
    /// 工具名称
    pub tool_name: String,
    /// 工具调用参数摘要（避免存储完整参数）
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub args_summary: Option<String>,
    /// 观察结果（工具返回内容）
    pub observation: String,
    /// 创建时间戳（Unix 毫秒）
    pub timestamp: i64,
    /// 来源节点 ID
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub source_node_id: Option<String>,
    /// 重要性评分（0.0-1.0，影响 trim 时的保留优先级，默认 0.5）
    #[serde(default = "default_importance")]
    pub importance: f32,
}

fn default_importance() -> f32 {
    0.5
}

/// 工作记忆快照 — 供节点读取的只读视图
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkingMemorySnapshot {
    /// 所有观察条目（按时间顺序）
    pub entries: Vec<WorkingMemoryEntry>,
    /// 条目总数
    pub count: usize,
    /// 估算的 token 数
    pub estimated_tokens: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_new_should_init_minimal() {
        let s = OrchestratorState::new("hello");
        assert_eq!(s.input, "hello");
        assert!(s.messages.is_empty());
        assert!(s.plan.is_none());
    }

    #[test]
    fn plan_item_status_should_serialize_snake_case() {
        let item = PlanItem {
            id: "1".into(),
            title: "t".into(),
            description: None,
            status: PlanItemStatus::InProgress,
            order: 0,
            output: None,
        };
        let json = serde_json::to_string(&item).unwrap();
        assert!(json.contains("\"in_progress\""));
    }
}
