//! # 矛盾调和（A1 甲2）
//!
//! 对应 [A1 记忆系统设计](../../../docs/plans/2026-09-11-A1-记忆系统设计.md) §4.1。
//!
//! ## 硬规则：矛盾不覆盖
//!
//! 冲突信息**不作为 UPDATE 覆盖旧值**，而是：
//!
//! ```text
//! 「2025-11 前：使用 React；之后（2026-01）：改用 Vue」   ← 调和摘要（新记忆）
//!   ├─ 保留 A 条：hook_id=xxx（React 方案）              ← 原样不动
//!   ├─ 保留 B 条：hook_id=yyy（Vue 方案）                ← 新事实原样入库
//!   └─ 记链 C  ：supersede_chain(old=A, new=B, reason, summary)
//! ```
//!
//! 依据：外部调研的 temporal arbiter 实践（扁平 append-only 结构累积 **38% 陈旧率**，
//! Mem0 在 LongMemEval 从基准 93.4% 跑 30 天掉到 **49.0%**）；且与 D1 咬合——
//! **调和结论正是最该进 `MEMORY.md` 的那类内容**（跨项目、稳定、必须常驻）。
//!
//! ## 成本控制（对应 R1）
//!
//! 调和摘要若用 LLM 生成会产生成本 / 延迟，故做成**三档策略**，默认零成本：
//!
//! | 档位 | 行为 | 成本 |
//! |---|---|---|
//! | [`ReconcileMode::ChainOnly`] | 只记取代链，不产摘要 | 零（关闭开关） |
//! | [`ReconcileMode::RuleSummary`] | 规则拼接时序摘要 + 写入调和记忆（**默认**） | 零 |
//! | [`ReconcileMode::LlmSummary`] | LLM 生成摘要（需注入 [`ReconcileSummarizer`]） | 一次 LLM 调用 |
//!
//! 未注入生成器时 `LlmSummary` **自动降级**为 `RuleSummary`（不报错、不阻塞主链路）。
//!
//! ## 为什么规则摘要能成立
//!
//! 设计文档给的示例是「用户 2025-11 前使用 React，之后转 Vue」——它需要的三个要素
//! **都在手上且不需要 LLM**：旧事实、新事实、两侧时点。模板化表达即达意：
//!
//! ```text
//! 「2025-11-03 前：使用 React；之后（2026-01-15）：改用 Vue」
//! ```
//!
//! 若两侧存在**明确矛盾**（冲突检测判定），追加判定依据，使摘要自带可解释性：
//!
//! ```text
//! 「2025-11-03 前：使用 React；之后（2026-01-15）：改用 Vue」（判定：立场反转）
//! ```
//!
//! LLM 的价值在于**改写措辞**（消解术语、跨语言归一），不是提供事实——
//! 故它属「质量升级」而非「功能前提」，这正是可以做默认零成本的根据。

use std::sync::Arc;

use async_trait::async_trait;
use memory_center_core::conflict::ConflictKind;

use crate::Result;

/// 调和上下文的单侧（旧 / 新）
#[derive(Debug, Clone)]
pub struct ReconcileSide {
    /// 该侧的钩子 ID
    pub hook_id: String,
    /// 该侧内容（优先用摘要标题；无则取记忆正文）
    pub text: String,
    /// 该侧时点（Unix 毫秒）
    pub at_ms: i64,
}

/// 调和上下文（喂给摘要生成器）
#[derive(Debug, Clone)]
pub struct ReconcileContext {
    /// 旧侧
    pub old: ReconcileSide,
    /// 新侧
    pub new: ReconcileSide,
    /// 冲突判定（`None` = 未检测到明确矛盾，属「修订」）
    pub conflict: Option<ConflictKind>,
}

impl ReconcileContext {
    /// 机器可读的判定依据名（写入 `supersede_chain.reason`）
    ///
    /// 有冲突取冲突类型名（`direct_contradict` / `stance_reversal` / `self_contradict`），
    /// 无冲突取 `revision`（内容修订）。
    pub fn reason_name(&self) -> &'static str {
        match self.conflict.as_ref() {
            Some(ConflictKind::DirectContradict) => "direct_contradict",
            Some(ConflictKind::StanceReversal) => "stance_reversal",
            Some(ConflictKind::SelfContradict) => "self_contradict",
            None => "revision",
        }
    }

    /// 冲突类型的中文名（`None` = 无明确矛盾）
    pub fn reason_display(&self) -> Option<&'static str> {
        // ConflictKind 非 Copy，用引用匹配避免 move
        self.conflict.as_ref().map(|k| match k {
            ConflictKind::DirectContradict => "直接矛盾",
            ConflictKind::StanceReversal => "立场反转",
            ConflictKind::SelfContradict => "自我矛盾",
        })
    }
}

/// 调和摘要生成器（可插拔；LLM 实现由装配层注入）
///
/// 未注入时 [`ReconcileMode::LlmSummary`] 自动降级为规则摘要。
#[async_trait]
pub trait ReconcileSummarizer: Send + Sync {
    /// 生成一句调和摘要
    async fn summarize(&self, ctx: &ReconcileContext) -> Result<String>;
}

/// 调和模式（三档，成本递增）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ReconcileMode {
    /// 只记取代链，不产摘要（成本开关：完全关闭摘要生成）
    ChainOnly,
    /// 规则拼接时序摘要 + 写入调和记忆（**默认**，零成本）
    #[default]
    RuleSummary,
    /// LLM 生成摘要（需注入 [`ReconcileSummarizer`]；未注入降级为 [`Self::RuleSummary`]）
    LlmSummary,
}

/// 调和策略
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReconcilePolicy {
    /// 摘要模式
    pub mode: ReconcileMode,
    /// 是否启用冲突检测（**纯算法，零成本**，默认启用）
    ///
    /// 关闭后所有取代一律记为 `revision`（仍不覆盖旧值——安全性不依赖检测）。
    /// 检测的作用是**丰富判定依据与摘要**，不是安全闸门。
    pub detect_conflicts: bool,
    /// 摘要中单侧文本的最大字符数（超出截断，避免摘要条目本身过长）
    pub excerpt_chars: usize,
}

impl Default for ReconcilePolicy {
    fn default() -> Self {
        Self {
            mode: ReconcileMode::RuleSummary,
            detect_conflicts: true,
            excerpt_chars: 120,
        }
    }
}

impl ReconcilePolicy {
    /// 是否需要产出摘要
    pub fn wants_summary(&self) -> bool {
        !matches!(self.mode, ReconcileMode::ChainOnly)
    }
}

/// 规则拼接时序摘要（零成本；[`ReconcileMode::RuleSummary`] 与降级路径使用）
///
/// 输出形态（对齐设计文档 §4.1 示例的语义）：
///
/// ```text
/// 2025-11-03 前：使用 React；之后（2026-01-15）：改用 Vue（判定：立场反转）
/// ```
pub fn rule_summary(ctx: &ReconcileContext, excerpt_chars: usize) -> String {
    let old_date = format_date(ctx.old.at_ms);
    let new_date = format_date(ctx.new.at_ms);
    let old_text = excerpt(&ctx.old.text, excerpt_chars);
    let new_text = excerpt(&ctx.new.text, excerpt_chars);

    let base = format!("{old_date} 前：{old_text}；之后（{new_date}）：{new_text}");
    match ctx.reason_display() {
        Some(kind) => format!("{base}（判定：{kind}）"),
        None => base,
    }
}

/// 摘要生成（按策略分派；LLM 缺失 / 失败时**降级为规则摘要**）
///
/// 返回 `(摘要文本, 是否由 LLM 生成)`。
pub async fn summarize(
    policy: &ReconcilePolicy,
    ctx: &ReconcileContext,
    llm: Option<&Arc<dyn ReconcileSummarizer>>,
) -> (Option<String>, bool) {
    if !policy.wants_summary() {
        return (None, false);
    }
    if matches!(policy.mode, ReconcileMode::LlmSummary) {
        if let Some(generator) = llm {
            match generator.summarize(ctx).await {
                Ok(text) if !text.trim().is_empty() => return (Some(text), true),
                Ok(_) => {
                    tracing::warn!("LLM 调和摘要返回空文本，降级为规则摘要");
                }
                Err(e) => {
                    // 降级不阻塞：调和链已记录，摘要只是增强
                    tracing::warn!("LLM 调和摘要失败，降级为规则摘要: {e}");
                }
            }
        } else {
            tracing::debug!("LlmSummary 模式未注入生成器，降级为规则摘要");
        }
    }
    (Some(rule_summary(ctx, policy.excerpt_chars)), false)
}

/// Unix 毫秒 → `YYYY-MM-DD`（本地时区）
fn format_date(ms: i64) -> String {
    use chrono::{Local, TimeZone};
    match Local.timestamp_millis_opt(ms).single() {
        Some(dt) => dt.format("%Y-%m-%d").to_string(),
        None => "未知时点".to_string(),
    }
}

/// 取一段文本的前 N 字符（超长加省略号；按字符边界切，UTF-8 安全）
fn excerpt(text: &str, limit: usize) -> String {
    let cleaned: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let count = cleaned.chars().count();
    if limit == 0 || count <= limit {
        return cleaned;
    }
    let head: String = cleaned.chars().take(limit).collect();
    format!("{head}…")
}

// ─── 测试 ────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn side(hook: &str, text: &str, at_ms: i64) -> ReconcileSide {
        ReconcileSide {
            hook_id: hook.into(),
            text: text.into(),
            at_ms,
        }
    }

    /// 2026-01-15 00:00:00 UTC 附近的毫秒时间戳（用固定值避免时区依赖）
    const T_OLD: i64 = 1_767_225_600_000; // 2026-01-01
    const T_NEW: i64 = 1_769_904_000_000; // 2026-02-01

    fn ctx(conflict: Option<ConflictKind>) -> ReconcileContext {
        ReconcileContext {
            old: side("A", "使用 React 方案", T_OLD),
            new: side("B", "改用 Vue 方案", T_NEW),
            conflict,
        }
    }

    #[test]
    fn rule_summary_matches_design_example_shape() {
        let text = rule_summary(&ctx(Some(ConflictKind::StanceReversal)), 120);
        // 三段式：旧时点 + 旧内容 + 新时点 + 新内容 + 判定
        assert!(text.contains("使用 React 方案"), "含旧事实: {text}");
        assert!(text.contains("改用 Vue 方案"), "含新事实: {text}");
        assert!(text.contains("前："), "含时序标记: {text}");
        assert!(text.contains("之后（"), "含时序标记: {text}");
        assert!(text.contains("立场反转"), "含判定依据: {text}");
        // 两个日期都出现（格式 YYYY-MM-DD）
        assert_eq!(text.matches("2026-").count(), 2, "两侧日期都在: {text}");
    }

    #[test]
    fn rule_summary_omits_verdict_when_no_conflict() {
        let text = rule_summary(&ctx(None), 120);
        assert!(!text.contains("判定"), "无冲突不应带判定: {text}");
    }

    #[test]
    fn reason_name_maps_all_kinds() {
        assert_eq!(ctx(None).reason_name(), "revision");
        assert_eq!(
            ctx(Some(ConflictKind::DirectContradict)).reason_name(),
            "direct_contradict"
        );
        assert_eq!(
            ctx(Some(ConflictKind::StanceReversal)).reason_name(),
            "stance_reversal"
        );
        assert_eq!(
            ctx(Some(ConflictKind::SelfContradict)).reason_name(),
            "self_contradict"
        );
        assert!(ctx(None).reason_display().is_none());
        assert_eq!(
            ctx(Some(ConflictKind::DirectContradict)).reason_display(),
            Some("直接矛盾")
        );
    }

    #[test]
    fn excerpt_truncates_on_char_boundary_and_collapses_whitespace() {
        // 空白折叠
        assert_eq!(excerpt("a   b\n c", 100), "a b c");
        // 超长截断（中文按字符，不劈开 UTF-8）
        let long = "中".repeat(200);
        let out = excerpt(&long, 10);
        assert_eq!(out.chars().count(), 11, "10 字 + 省略号");
        assert!(out.ends_with('…'));
        // limit = 0 视为不截断
        assert_eq!(excerpt(&long, 0).chars().count(), 200);
        // 边界：恰好等于 limit 不截断
        assert_eq!(excerpt("abcde", 5), "abcde");
    }

    /// ChainOnly：不产摘要（成本开关）
    #[tokio::test]
    async fn chain_only_mode_produces_no_summary() {
        let policy = ReconcilePolicy {
            mode: ReconcileMode::ChainOnly,
            ..Default::default()
        };
        assert!(!policy.wants_summary());
        let (summary, from_llm) = summarize(&policy, &ctx(None), None).await;
        assert!(summary.is_none());
        assert!(!from_llm);
    }

    /// 默认档位 = RuleSummary（零成本）
    #[tokio::test]
    async fn default_mode_is_rule_summary() {
        let policy = ReconcilePolicy::default();
        assert_eq!(policy.mode, ReconcileMode::RuleSummary);
        assert!(policy.detect_conflicts, "默认启用检测（纯算法零成本）");
        let (summary, from_llm) = summarize(&policy, &ctx(None), None).await;
        assert!(summary.is_some());
        assert!(!from_llm, "规则摘要不应标记为 LLM 生成");
    }

    /// LlmSummary 未注入生成器 → 降级为规则摘要（不报错、不阻塞）
    #[tokio::test]
    async fn llm_mode_without_generator_falls_back_to_rule() {
        let policy = ReconcilePolicy {
            mode: ReconcileMode::LlmSummary,
            ..Default::default()
        };
        let (summary, from_llm) = summarize(&policy, &ctx(None), None).await;
        assert!(summary.is_some(), "降级后仍应有摘要");
        assert!(!from_llm, "降级后不标记 LLM");
    }

    /// LlmSummary 注入成功 → 用 LLM 文本
    #[tokio::test]
    async fn llm_mode_uses_generator_when_available() {
        struct Fake;
        #[async_trait]
        impl ReconcileSummarizer for Fake {
            async fn summarize(&self, _ctx: &ReconcileContext) -> Result<String> {
                Ok("LLM 改写：用户已从 React 切换到 Vue".to_string())
            }
        }
        let policy = ReconcilePolicy {
            mode: ReconcileMode::LlmSummary,
            ..Default::default()
        };
        let generator: Arc<dyn ReconcileSummarizer> = Arc::new(Fake);
        let (summary, from_llm) = summarize(&policy, &ctx(None), Some(&generator)).await;
        assert_eq!(summary.as_deref(), Some("LLM 改写：用户已从 React 切换到 Vue"));
        assert!(from_llm);
    }

    /// LlmSummary 生成失败 → 降级而非报错（调和链已记录，摘要只是增强）
    #[tokio::test]
    async fn llm_mode_failure_falls_back_without_error() {
        struct Broken;
        #[async_trait]
        impl ReconcileSummarizer for Broken {
            async fn summarize(&self, _ctx: &ReconcileContext) -> Result<String> {
                Err(crate::Error::Ext("模拟 LLM 故障".into()))
            }
        }
        struct Empty;
        #[async_trait]
        impl ReconcileSummarizer for Empty {
            async fn summarize(&self, _ctx: &ReconcileContext) -> Result<String> {
                Ok("   ".to_string())
            }
        }
        let policy = ReconcilePolicy {
            mode: ReconcileMode::LlmSummary,
            ..Default::default()
        };

        let broken: Arc<dyn ReconcileSummarizer> = Arc::new(Broken);
        let (s1, l1) = summarize(&policy, &ctx(None), Some(&broken)).await;
        assert!(s1.is_some() && !l1, "失败应降级为规则摘要");

        let empty: Arc<dyn ReconcileSummarizer> = Arc::new(Empty);
        let (s2, l2) = summarize(&policy, &ctx(None), Some(&empty)).await;
        assert!(s2.is_some() && !l2, "空文本也应降级");
    }
}
