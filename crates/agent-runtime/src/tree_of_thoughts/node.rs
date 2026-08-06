use serde::{Deserialize, Serialize};

// ─── 思维节点 ────────────────────────────────────────────

/// 思维节点 — 树/图中的一个思维状态
///
/// 每个节点包含思维内容、父节点引用、深度、评分与子节点列表。
/// 根节点 depth=0，content=用户输入。
///
/// ## GoT 扩展（阶段 2.2）
/// - `parents`：图语义下的多父节点列表（树语义下为空 Vec）
/// - `parent_id` 保留用于树语义兼容（ToT 模式下为单一 parent）
/// - GoT 聚合节点的 `parents` 包含所有被聚合的源节点 ID
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThoughtNode {
    /// 节点唯一 ID（UUID 或递增编号）
    pub id: String,
    /// 思维内容（LLM 生成的思维文本）
    pub content: String,
    /// 父节点 ID（根节点为 None）
    ///
    /// 树语义字段：ToT 模式下为单一 parent。
    /// GoT 聚合节点也设置此字段（取第一个源节点），以保持向后兼容。
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub parent_id: Option<String>,
    /// 多父节点列表（图语义）
    ///
    /// GoT 扩展字段：聚合节点的所有源节点 ID。
    /// ToT 模式下为空 Vec（树语义，仅用 `parent_id`）。
    /// 序列化时默认空 Vec（向后兼容老数据）。
    #[serde(default)]
    pub parents: Vec<String>,
    /// 深度（根节点=0）
    pub depth: usize,
    /// 评分（0-100，越高越好；None=未评分）
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub score: Option<u8>,
    /// 评分理由（可选，LLM 评分策略会填充）
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub score_reasoning: Option<String>,
    /// 子节点 ID 列表
    #[serde(default)]
    pub children: Vec<String>,
    /// 节点状态
    pub status: ThoughtNodeStatus,
}

/// 思维节点状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ThoughtNodeStatus {
    /// 待评分（刚创建）
    Pending,
    /// 已评分
    Scored,
    /// 已扩展（已生成子节点）
    Expanded,
    /// 被剪枝（评分过低，不继续扩展）
    Pruned,
    /// 达成目标
    Goal,
}

// ─── 终止原因 ────────────────────────────────────────────

/// ToT 终止原因
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ToTTerminationReason {
    /// LLM 目标达成
    GoalReached,
    /// 深度超限
    MaxDepthExceeded,
    /// 节点数超限
    MaxThoughtsExceeded,
    /// 评分收敛（top-K 差距 < threshold）
    ScoreConverged,
    /// 无候选节点（所有都被剪枝）
    NoCandidates,
    /// 外部中断
    Aborted,
}

impl ToTTerminationReason {
    /// 转为字符串标识（用于事件序列化）
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::GoalReached => "goal_reached",
            Self::MaxDepthExceeded => "max_depth_exceeded",
            Self::MaxThoughtsExceeded => "max_thoughts_exceeded",
            Self::ScoreConverged => "score_converged",
            Self::NoCandidates => "no_candidates",
            Self::Aborted => "aborted",
        }
    }
}
