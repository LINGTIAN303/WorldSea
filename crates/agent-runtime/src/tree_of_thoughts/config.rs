use serde::{Deserialize, Serialize};

// ─── ToT 配置 ────────────────────────────────────────────

/// ToT 配置
///
/// 派生 `Serialize`/`Deserialize` 以支持 GoT 配置的 `#[serde(flatten)]` 复用。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToTConfig {
    /// 最大深度（默认 5）
    pub max_depth: usize,
    /// 最大节点数（默认 50）
    pub max_thoughts: usize,
    /// Beam 宽度 — 每层保留的 top-K 节点数（默认 3）
    pub beam_width: usize,
    /// 分支因子 — 每个节点生成的候选数（默认 3）
    pub branch_factor: usize,
    /// 评分收敛阈值 — top-K 评分差距小于此值则收敛（默认 5）
    pub score_convergence_threshold: u8,
    /// 是否在最后汇总最优思维（生成 summary 字段）
    pub require_summary: bool,
    /// 是否在根节点就检查目标（默认 false，根节点通常只是问题陈述）
    pub check_goal_at_root: bool,
}

impl Default for ToTConfig {
    fn default() -> Self {
        Self {
            max_depth: 5,
            max_thoughts: 50,
            beam_width: 3,
            branch_factor: 3,
            score_convergence_threshold: 5,
            require_summary: true,
            check_goal_at_root: false,
        }
    }
}
