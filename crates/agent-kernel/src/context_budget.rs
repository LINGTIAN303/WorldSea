//! # 上下文 token 计量与预算策略（A1 丙1）
//!
//! 对应 [A1 记忆系统设计](../../../docs/plans/2026-09-11-A1-记忆系统设计.md) §5.1–§5.3。
//!
//! ## 为什么单独成模块
//!
//! 此前全链路的窗口计量**以「字节」为单位**（`HISTORY_BUDGET_BYTES = 160_000`），
//! 属**实现与语义不一致**：同一预算在「全中文」与「全 ASCII」两种内容下，
//! 换算成上下文 token 相差近一倍。本模块把计量口径统一为
//! **上下文 token（LLM 上下文窗口占用）**，并让数值由**模型声明的窗口**推导。
//!
//! ## 三个概念（不可混用）
//!
//! | 概念 | 含义 | 来源 |
//! |---|---|---|
//! | `context_window` | 模型上下文窗口总量（token） | 模型声明（`ModelVariant` / Provider 配置） |
//! | `archive_threshold` | 归档阈值 = 窗口 × 归档比率（专家调校 0.20–0.50） | MemoryCenter 模型特配 |
//! | `trim_trigger` | 上下文裁剪触发点 = 归档阈值 × 最高压缩层比率（0.95） | 本模块推导 |
//!
//! ## 与四层压缩阶梯的关系
//!
//! 阶梯的百分比是**相对归档阈值**，不是相对整个窗口（2026-09-11 澄清）：
//!
//! ```text
//! 占归档阈值   层              动作
//!   60%       Snip            删早期工具返回的超长原始数据，只保留摘要
//!   75%       MicroCompact    早期长对话 → 简短摘要替换
//!   85%       Collapse        多轮早期对话 → 折叠成一条摘要消息
//!   95%       AutoCompact     全面压缩：system + 全局摘要 + 最近 3 轮   ← 当前唯一实现点
//!  100%       完整归档        清空上下文，交 MemoryCenter 完成索引/钩子
//! ```
//!
//! 当前仅落地「最高层（AutoCompact）」这一个裁剪点——它是**兜底**，其余三层
//! 是精度工具、尚未实现。因此本模块把 [`ContextBudgetPolicy::trim_trigger`]
//! 定位为「最后手段」：只有在逼近归档阈值时才裁剪整条消息。
//!
//! ## 归一后的收益（对 200K 窗口举例）
//!
//! | 项 | 旧（字节口径） | 新（token 口径） |
//! |---|---|---|
//! | 单位 | 字节 | 上下文 token |
//! | 数值来源 | 硬编码 160_000 | 模型窗口推导 |
//! | 中文内容实际可用量 | ≈5.3 万汉字 | 与预算等值（不再因编码膨胀而缩水） |
//! | 英文内容实际可用量 | ≈16 万字符 | 与预算等值 |
//!
//! ## 依赖倒置（星型拓扑）
//!
//! 真实分词器（tiktoken）**不在本 crate**——本模块只定义
//! [`TokenEstimator`] **闭包类型**与**无依赖的近似兜底**。真实实现由装配层
//! （已依赖 `memory-center-models` 的 crate）构造后经
//! [`crate::agent::AgentLoop::with_token_estimator`] 注入。
//! 这样底座内核不引入 tiktoken 及其 C 依赖，保持可独立编译。

use std::sync::Arc;

/// Token 估算器：文本 → 上下文 token 数
///
/// 用闭包而非 trait，理由（对齐上游 `memory-center-models::build_token_estimator`）：
/// 调用方只需「一个函数」，闭包注入避免为了一个方法引入整条 crate 依赖边。
pub type TokenEstimator = Arc<dyn Fn(&str) -> usize + Send + Sync>;

/// 无依赖的近似估算器（兜底）
///
/// 口径：CJK 字符 ≈ 1 token/字，ASCII ≈ 1 token/4 字符（+1 保底）。
///
/// **仅供无真实分词器时降级使用**——中文场景偏差可达 20–30%（上游实测），
/// 会让阈值触发时机漂移。装配层应尽量注入真实分词器。
pub fn heuristic_estimator() -> TokenEstimator {
    Arc::new(|text: &str| estimate_tokens_heuristic(text))
}

/// 近似 token 计数（CJK 1/字，ASCII 1/4 字符）
pub fn estimate_tokens_heuristic(text: &str) -> usize {
    let mut cjk = 0usize;
    let mut ascii = 0usize;
    for ch in text.chars() {
        if ch.is_ascii() {
            ascii += 1;
        } else {
            cjk += 1;
        }
    }
    cjk + ascii / 4 + 1
}

/// 上下文预算策略（窗口 → 归档阈值 → 裁剪触发点）
///
/// 由装配层按当前模型解析后注入 [`crate::agent::AgentLoopConfig`]。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ContextBudgetPolicy {
    /// 模型上下文窗口总量（token）
    pub context_window: usize,
    /// 归档阈值（token）= 窗口 × 归档比率
    ///
    /// 归档比率来自 MemoryCenter 模型特配的**专家调校值**（内置型号 0.20–0.50；
    /// 未知型号保守取 0.25）。**阈值必须单一来源**——上游曾因双兜底不一致
    /// （一处 120K、一处 400K）造成「反馈断裂」，WorldSea 引以为戒。
    pub archive_threshold: usize,
}

/// 四层压缩阶梯的层比率（**相对归档阈值**）
pub const TIER_SNIP: f32 = 0.60;
/// 见 [`TIER_SNIP`]
pub const TIER_MICRO_COMPACT: f32 = 0.75;
/// 见 [`TIER_SNIP`]
pub const TIER_COLLAPSE: f32 = 0.85;
/// 见 [`TIER_SNIP`]
pub const TIER_AUTO_COMPACT: f32 = 0.95;

/// 当前唯一实现的裁剪点所在层（兜底：逼近归档阈值时才动整条消息）
pub const ACTIVE_TRIM_TIER: f32 = TIER_AUTO_COMPACT;

/// 未知型号的归档比率兜底（对齐上游 `ModelVariant::custom` 的统一保守值）
pub const FALLBACK_ARCHIVE_RATIO: f32 = 0.25;

/// 窗口未知时的兜底窗口（token）
///
/// 取 32K 而非某个大值：**宁可早裁、不可撑爆**——撑爆窗口是硬错误（API 直接拒绝），
/// 早裁只是效率损失。装配层应尽量传入真实窗口。
pub const FALLBACK_CONTEXT_WINDOW: usize = 32_768;

impl ContextBudgetPolicy {
    /// 按窗口与归档比率构建
    pub fn new(context_window: usize, archive_ratio: f32) -> Self {
        let window = context_window.max(1);
        // 比率夹到 (0, 1)，避免上游数据异常导致阈值为 0 或超过窗口
        let ratio = if archive_ratio > 0.0 && archive_ratio < 1.0 {
            archive_ratio
        } else {
            FALLBACK_ARCHIVE_RATIO
        };
        Self {
            context_window: window,
            archive_threshold: ((window as f32) * ratio) as usize,
        }
    }

    /// 按已知归档阈值直接构建（阈值已是 token 数）
    pub fn from_threshold(context_window: usize, archive_threshold: usize) -> Self {
        let window = context_window.max(1);
        Self {
            context_window: window,
            archive_threshold: archive_threshold.min(window),
        }
    }

    /// 兜底策略（模型信息缺失时使用）
    pub fn fallback() -> Self {
        Self::new(FALLBACK_CONTEXT_WINDOW, FALLBACK_ARCHIVE_RATIO)
    }

    /// 取某一层级的触发点（token）
    pub fn tier(&self, ratio: f32) -> usize {
        ((self.archive_threshold as f32) * ratio) as usize
    }

    /// 当前实现的裁剪触发点（= 最高压缩层）
    pub fn trim_trigger(&self) -> usize {
        self.tier(ACTIVE_TRIM_TIER)
    }

    /// 该窗口占用是否已达归档阈值
    pub fn archive_due(&self, tokens: usize) -> bool {
        tokens >= self.archive_threshold
    }

    /// 该窗口占用落在四层阶梯的哪一层（1–4；0 = 未达第一层）
    ///
    /// 供日志与后续分层实现使用；当前裁剪只看 [`Self::trim_trigger`]。
    pub fn tier_of(&self, tokens: usize) -> u8 {
        if tokens >= self.tier(TIER_AUTO_COMPACT) {
            4
        } else if tokens >= self.tier(TIER_COLLAPSE) {
            3
        } else if tokens >= self.tier(TIER_MICRO_COMPACT) {
            2
        } else if tokens >= self.tier(TIER_SNIP) {
            1
        } else {
            0
        }
    }
}

impl Default for ContextBudgetPolicy {
    fn default() -> Self {
        Self::fallback()
    }
}

// ─── 测试 ────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn heuristic_counts_cjk_by_char_and_ascii_by_quarter() {
        // 纯 ASCII：4 字符 ≈ 1 token（+1 保底）
        assert_eq!(estimate_tokens_heuristic("abcd"), 0 + 4 / 4 + 1);
        assert_eq!(estimate_tokens_heuristic("abcdefgh"), 8 / 4 + 1);
        // 纯 CJK：1 字 = 1 token（+1 保底）
        assert_eq!(estimate_tokens_heuristic("你好"), 2 + 0 + 1);
        // 空串也返回 1（保底，避免 0 值让上层出现除零/无意义比较）
        assert_eq!(estimate_tokens_heuristic(""), 1);
    }

    #[test]
    fn policy_derives_threshold_from_window_and_ratio() {
        // 200K 窗口 × 0.40 = 80K（Claude 档）
        let p = ContextBudgetPolicy::new(200_000, 0.40);
        assert_eq!(p.context_window, 200_000);
        assert_eq!(p.archive_threshold, 80_000);
        // 最高层 95% → 76K
        assert_eq!(p.trim_trigger(), 76_000);
        // 阶梯分层
        assert_eq!(p.tier_of(47_999), 0);
        assert_eq!(p.tier_of(48_000), 1); // 60%
        assert_eq!(p.tier_of(60_000), 2); // 75%
        assert_eq!(p.tier_of(68_000), 3); // 85%
        assert_eq!(p.tier_of(76_000), 4); // 95%
    }

    #[test]
    fn policy_matches_design_table_for_1m_window() {
        // 设计文档 §5.2 表格：1M 窗口 / 归档比率 2/5 → 阈值 400K
        let p = ContextBudgetPolicy::new(1_000_000, 0.40);
        assert_eq!(p.archive_threshold, 400_000);
        assert_eq!(p.tier(TIER_SNIP), 240_000); // 占窗口 24%
        assert_eq!(p.tier(TIER_MICRO_COMPACT), 300_000); // 30%
        assert_eq!(p.tier(TIER_COLLAPSE), 340_000); // 34%
        assert_eq!(p.tier(TIER_AUTO_COMPACT), 380_000); // 38%
        // 归档兜最顶（100%），高于所有压缩层——阶梯时序不冲突
        assert!(p.archive_threshold > p.tier(TIER_AUTO_COMPACT));
    }

    #[test]
    fn invalid_ratio_falls_back_and_clamps() {
        let bad = ContextBudgetPolicy::new(100_000, 0.0);
        assert_eq!(bad.archive_threshold, 25_000); // 0.25 兜底

        let over = ContextBudgetPolicy::new(100_000, 5.0);
        assert_eq!(over.archive_threshold, 25_000);

        // 阈值不得超过窗口
        let clamped = ContextBudgetPolicy::from_threshold(10_000, 999_999);
        assert_eq!(clamped.archive_threshold, 10_000);
        // 窗口 0 时至少为 1，避免除零/无意义比较
        assert_eq!(ContextBudgetPolicy::new(0, 0.4).context_window, 1);
    }

    #[test]
    fn archive_due_uses_threshold() {
        let p = ContextBudgetPolicy::new(200_000, 0.40);
        assert!(!p.archive_due(79_999));
        assert!(p.archive_due(80_000));
    }

    #[test]
    fn estimator_is_injectable_via_closure() {
        // 闭包注入的形状验证：真实分词器（tiktoken）只需满足此签名即可替换
        let fake: TokenEstimator = Arc::new(|s: &str| s.chars().count());
        assert_eq!(fake("hello"), 5);
        assert_eq!(heuristic_estimator()("hello"), 1 + 1); // 5/4 + 1
    }
}
