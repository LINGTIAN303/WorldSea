//! # 核心数据结构
//!
//! 对应 TS 版 `packages/agent-core/src/orchestrator/types.ts` 的数据部分。
//! 所有结构体派生 `Serialize`/`Deserialize`，便于跨 Tauri 边界传递。

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::router_decider::RouterDecision;

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
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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

// ─── 段间交接物（D23 定案）───────────────────────────────────

/// 收敛原因 — run 出口如何收敛的六值枚举（D0-4）
///
/// 各模式内部终止条件向本枚举映射（ToT GoalReached→GoalReached、ScoreConverged→ThresholdMet、
/// MaxDepth/MaxThoughts→LimitReached、NoCandidates→NoProgress；MultiAgent 三收敛同理）。
/// 由节点经 `NodeResult.converge_reason` 传出，编排器写入 `OrchestratorEndResult`。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConvergeReason {
    /// 达成目标（正常完成）
    GoalReached,
    /// 达到评审阈值（评分合格收敛）
    ThresholdMet,
    /// 达到次数/时间上限（B0-4：超限 = 正常收敛的一种，带当前最优/部分结果）
    LimitReached,
    /// 无进展（循环检测/停止推进判定）
    NoProgress,
    /// 被中止
    Aborted,
    /// 降级收敛（产出 Degraded 物）
    Degraded,
}

/// 交接物 — 段间流动的类型化信封（D23）
///
/// 节点经 `NodeResult.artifact` 显式输出；编排器存入 run 交接物区，
/// 并只在 `TracePhaseResult` 事件里携带 `artifact_id + summary`（事件轻、物权威）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HandoverArtifact {
    /// 物唯一 ID
    pub artifact_id: String,
    /// 归属 run
    pub run_id: String,
    /// 产出节点 ID
    pub from_node: String,
    /// 物类型与载荷（九类）
    pub kind: ArtifactKind,
    /// 一句话摘要（迹线与事件用）
    pub summary: String,
    /// 产出时间戳（Unix 毫秒）
    pub produced_at: i64,
}

/// 交接物类型（D23 九类）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ArtifactKind {
    /// 计划（已有类型升格一等公民）
    Plan(Vec<PlanItem>),
    /// 评审结果（已有类型升格）
    Reflection(ReflectionResult),
    /// 路由决策（已有类型升格；reason 与 decision 内嵌理由并存，事件用前者）
    Routing {
        decision: RouterDecision,
        reason: Option<String>,
    },
    /// 执行结果（Execute 各步输出聚合为一个物，步骤级是 phase 内细节）
    Execution {
        step_results: Vec<StepResult>,
        status: ExecStatus,
    },
    /// 委派结果（挂接 run 树子节点）
    Delegation {
        sub_run_id: String,
        task: String,
        output: String,
    },
    /// 探索结果（ToT）
    Exploration {
        best_path: String,
        score: u8,
        explored: usize,
        term_reason: String,
    },
    /// 多源聚合（GoT）
    Aggregation {
        content: String,
        sources: Vec<String>,
    },
    /// 协作收敛（MultiAgent）
    Convergence {
        final_result: String,
        reason: String,
    },
    /// 一等降级物（探索失败/委派失败/评审不达阈都产出，审计链不断裂）
    Degraded {
        from: String,
        reason: String,
        partial: Option<String>,
    },
}

/// 交接物类型标签 — 无载荷的 kind 名字（D23 构图期 kind 校验用）
///
/// 边声明"接受什么 kind"、节点声明"产出什么 kind"都使用标签配对，
/// 避免在校验逻辑里匹配带载荷的 `ArtifactKind` 全枚举。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArtifactKindTag {
    Plan,
    Reflection,
    Routing,
    Execution,
    Delegation,
    Exploration,
    Aggregation,
    Convergence,
    Degraded,
}

impl ArtifactKind {
    /// 映射为无载荷标签（供构图期 kind 校验 / 注册表声明）
    pub fn tag(&self) -> ArtifactKindTag {
        match self {
            ArtifactKind::Plan(_) => ArtifactKindTag::Plan,
            ArtifactKind::Reflection(_) => ArtifactKindTag::Reflection,
            ArtifactKind::Routing { .. } => ArtifactKindTag::Routing,
            ArtifactKind::Execution { .. } => ArtifactKindTag::Execution,
            ArtifactKind::Delegation { .. } => ArtifactKindTag::Delegation,
            ArtifactKind::Exploration { .. } => ArtifactKindTag::Exploration,
            ArtifactKind::Aggregation { .. } => ArtifactKindTag::Aggregation,
            ArtifactKind::Convergence { .. } => ArtifactKindTag::Convergence,
            ArtifactKind::Degraded { .. } => ArtifactKindTag::Degraded,
        }
    }
}

/// 执行步骤结果 — `ArtifactKind::Execution` 的 step_results 元素
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepResult {
    /// 步骤 ID
    pub step_id: String,
    /// 步骤标题
    pub title: String,
    /// 执行输出摘要
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub output: Option<String>,
    /// 步骤状态
    pub status: StepStatus,
}

/// 执行步骤状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StepStatus {
    Pending,
    InProgress,
    Completed,
    Skipped,
    Failed,
}

/// 执行批次状态 — `ArtifactKind::Execution` 的整体 status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExecStatus {
    Completed,
    Degraded,
    Failed,
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
