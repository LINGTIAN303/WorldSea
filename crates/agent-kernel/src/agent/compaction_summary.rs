//! # 压缩摘要（阶段 3 · D4：LLM 摘要替代规则浓缩）
//!
//! 对应 [04-施工准备](../../../../docs/plans/2026-09-16-deepseek-harness-方向探究/04-施工准备.md)
//! §三 阶段 3 ⑤（裁定 D4：引入 LLM 摘要；规则浓缩保留为回退路径）。
//!
//! ## 要解决的问题
//!
//! 折叠（`fold_context`）把原文外置后，回填文本来自**规则浓缩**（`condense`：头 N 字符 +
//! 尾 M 字符切片）——信息不丢但不成篇：模型看到的是原文片段而非「这一段发生了什么」。
//! 本模块把回填文本升级为 **LLM 生成的检查点摘要**（8 章节模板，参照 dsh 检查点装帧），
//! 规则浓缩保留为**回退路径**（调用失败 / 超时 / 摘要不达标时**逐组**降级）。
//!
//! ## 三条工程约束
//!
//! 1. **旁路调用**：摘要经 [`crate::backend::NodeBackendAccessor::prompt_side_call`] 发起——
//!    不写会话消息、不消费 steer 缓冲、不广播流式事件（静默）；请求材料由调用方给全。
//! 2. **暖前缀**：请求 = 主对话系统提示 + 主对话消息快照（前缀与主请求逐字一致，
//!    provider 前缀缓存可命中到指令之前；对齐 dsh §4.5 的复用策略）+ 尾部压缩指令。
//! 3. **预算上限**：单次压缩最多 [`MAX_SUMMARY_CALLS_PER_COMPACTION`] 次摘要调用——
//!    压缩在请求派生前执行，须控制前置延迟；超出部分沿用规则浓缩。
//!
//! ## 验收（shrink 校验）
//!
//! 摘要不显著小于材料（压缩率不足 50%）即视为不合格 → 回退规则浓缩——
//! 对齐 dsh「不比源小的摘要 → 拒绝」，防止"摘要反而膨胀"。

use std::time::Duration;

use tracing::{debug, warn};

use super::AgentLoop;
use crate::anchor::FoldOutcome;
use crate::backend::PromptCallOptions;
use crate::context_budget::TokenEstimator;

/// 单次压缩最多发起的摘要调用数（控制请求派生前的前置延迟）
pub const MAX_SUMMARY_CALLS_PER_COMPACTION: usize = 3;

/// 摘要调用超时（秒）——超时即回退规则浓缩（压缩本身不因此失败）
pub const SUMMARY_TIMEOUT_SECS: u64 = 60;

/// 摘要输出上限（token）——收敛前置延迟；4096 ≈ 3000 中文字，足够 8 章节
pub const SUMMARY_MAX_OUTPUT_TOKENS: u32 = 4096;

/// 摘要可用的最低压缩率：摘要 token 必须 ≤ 材料 token × 该比率，否则回退规则浓缩
pub const MIN_SHRINK_RATIO: f32 = 0.5;

/// 摘要指令模板（8 固定章节 + 三条忠实性规则）——参照 dsh 检查点装帧（调研 §4.6）
///
/// 作为旁路调用的**尾部 user 指令**；材料拼接在模板末尾。
pub const SUMMARY_INSTRUCTION_TEMPLATE: &str = r#"以下是从对话上下文中折叠出去的一段原始内容。请生成一份「检查点摘要」——随后这段原文将从上下文窗口中移除，未来只会以你的摘要形式存在。

严格按以下 8 个章节组织输出（无内容的章节写"（无）"，不要编造）：

## Primary Request and Intent
## Key Technical Concepts
## Files and Code
## Errors and Fixes
## Pending Jobs
## Current Work
## Next Step
## Critical Context

忠实性规则：
1. 保留精确的文件路径、命令、错误串、标识符、数值、函数签名与代码片段，不要改写它们；
2. 忠实记录用户反馈与明确指令，尤其是对既有做法的纠正；
3. 摘要总长度控制在原文的四分之一以内；不要输出任何前言、致谢或对摘要本身的说明。

原文如下：

"#;

/// 回填正文的检查点前言（随摘要渲染进折叠形，提示主对话模型视为既有背景）
pub const CHECKPOINT_PREAMBLE: &str =
    "〔自动压缩检查点：以下为此前对话片段的浓缩摘要，视为既有背景，直接继续任务，不要复述或确认。〕\n";

/// 组装摘要指令（模板 + 材料）
pub fn build_summary_instruction(material: &str) -> String {
    format!("{SUMMARY_INSTRUCTION_TEMPLATE}{material}")
}

/// shrink 校验：摘要须非空且显著小于材料（压缩率 ≥ 1 − [`MIN_SHRINK_RATIO`]）
pub fn summary_is_usable(summary: &str, material: &str, estimator: &TokenEstimator) -> bool {
    let trimmed = summary.trim();
    if trimmed.is_empty() {
        return false;
    }
    let material_tokens = estimator(material);
    if material_tokens == 0 {
        return false;
    }
    let summary_tokens = estimator(trimmed);
    (summary_tokens as f32) <= (material_tokens as f32) * MIN_SHRINK_RATIO
}

/// 摘要文本 → 折叠形回填正文（加检查点前言）
pub fn render_summary_body(summary: &str) -> String {
    format!("{CHECKPOINT_PREAMBLE}{}", summary.trim())
}

impl AgentLoop {
    /// 为折叠组生成回填材料（阶段 3 · D4）：优先 LLM 摘要，逐组回退规则浓缩
    ///
    /// 返回 `(fills, summarized)`——`fills` 与 [`FoldOutcome::fills`] 同序同长，
    /// 可直接交 [`AgentLoop::backfill_folds`]；`summarized` = 实际采用 LLM 摘要的组数
    /// （供 info 日志/审计）。材料缺失（不可达）或超预算的组沿用规则浓缩。
    pub(super) async fn fold_fills_with_summaries(
        &self,
        folded: &FoldOutcome,
    ) -> (Vec<(String, String)>, usize) {
        // 摘要请求基线选项：与主对话同系统提示 + 同工具集（暖前缀），单次构造全程复用
        let base_options = if folded.fills.is_empty() {
            None
        } else {
            let snapshot = self.config_snapshot();
            let mut opts = self.build_prompt_options(&snapshot).await;
            opts.purpose = Some("compaction".into());
            opts.silent = true;
            opts.max_tokens = Some(
                opts.max_tokens
                    .unwrap_or(SUMMARY_MAX_OUTPUT_TOKENS)
                    .min(SUMMARY_MAX_OUTPUT_TOKENS),
            );
            Some(opts)
        };

        let mut fills = Vec::with_capacity(folded.fills.len());
        let mut summarized = 0usize;
        for (hash, rule_condensed) in &folded.fills {
            let summary = if summarized < MAX_SUMMARY_CALLS_PER_COMPACTION {
                match (base_options.as_ref(), folded.materials.iter().find(|(h, _)| h == hash)) {
                    (Some(opts), Some((material_hash, material))) => {
                        self.generate_compaction_summary(material, Some(material_hash), opts)
                            .await
                    }
                    _ => None,
                }
            } else {
                None
            };
            match summary {
                Some(text) => {
                    summarized += 1;
                    fills.push((hash.clone(), text));
                }
                None => fills.push((hash.clone(), rule_condensed.clone())),
            }
        }
        (fills, summarized)
    }

    /// 生成一次压缩摘要（旁路调用；`None` = 回退规则浓缩，压缩主流程不中断）
    ///
    /// 请求 = 主对话系统提示 + 主对话消息快照（暖前缀）+ 尾部压缩指令；
    /// 超时 [`SUMMARY_TIMEOUT_SECS`]；输出经 shrink 校验（[`summary_is_usable`]）。
    async fn generate_compaction_summary(
        &self,
        material: &str,
        material_ref: Option<&String>,
        options: &PromptCallOptions,
    ) -> Option<String> {
        if material.trim().is_empty() {
            return None;
        }
        // 阶段 3 · ④：旁路调用同样入账（D13 全收）——快照含材料坐标
        // （指令 = 摘要模板 + 该材料，可据此重建）
        self.capture_request_snapshot("compaction", options, material_ref.cloned())
            .await;
        // 暖前缀：主对话消息快照（与主请求逐字一致的前缀）
        let history = self.state.lock().await.messages.clone();
        let instruction = build_summary_instruction(material);
        let call = self.backend.prompt_side_call(
            None,
            history,
            instruction,
            options.clone(),
        );
        let response =
            match tokio::time::timeout(Duration::from_secs(SUMMARY_TIMEOUT_SECS), call).await {
                Ok(Ok(resp)) => resp,
                Ok(Err(e)) => {
                    debug!("压缩摘要生成失败（回退规则浓缩）: {e}");
                    return None;
                }
                Err(_) => {
                    warn!("压缩摘要生成超时（{}s，回退规则浓缩）", SUMMARY_TIMEOUT_SECS);
                    return None;
                }
            };
        // 用量计入会话累计（摘要调用也是真实消耗，与主链路同一口径）
        if response.input_tokens.is_some() || response.output_tokens.is_some() {
            let mut usage = self.usage.lock().await;
            usage.input_tokens += response.input_tokens.unwrap_or(0) as u64;
            usage.output_tokens += response.output_tokens.unwrap_or(0) as u64;
        }
        let estimator = self.token_estimator.clone();
        if summary_is_usable(&response.text, material, &estimator) {
            Some(render_summary_body(&response.text))
        } else {
            debug!("压缩摘要未达 shrink 校验（回退规则浓缩）");
            None
        }
    }
}

// ─── 测试 ───────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::context_budget::TokenEstimator;
    use std::sync::Arc;

    fn estimator() -> TokenEstimator {
        Arc::new(|text: &str| crate::context_budget::estimate_tokens_heuristic(text))
    }

    /// 指令包含 8 个固定章节与材料原文（模板契约）
    #[test]
    fn instruction_contains_eight_sections_and_material() {
        let instruction = build_summary_instruction("材料内容XYZ");
        for section in [
            "## Primary Request and Intent",
            "## Key Technical Concepts",
            "## Files and Code",
            "## Errors and Fixes",
            "## Pending Jobs",
            "## Current Work",
            "## Next Step",
            "## Critical Context",
        ] {
            assert!(instruction.contains(section), "模板缺少章节: {section}");
        }
        assert!(
            instruction.ends_with("材料内容XYZ"),
            "材料应拼接在指令末尾"
        );
    }

    /// shrink 校验：空 / 不缩小 / 超半 → 拒绝；显著缩小 → 通过
    #[test]
    fn shrink_check_rejects_empty_and_oversized_summaries() {
        let estimator = estimator();
        let material = "原文".repeat(1_000); // ≈2000 token

        assert!(
            !summary_is_usable("", &material, &estimator),
            "空摘要应拒绝"
        );
        assert!(
            !summary_is_usable("   \n ", &material, &estimator),
            "空白摘要应拒绝"
        );
        // 与材料等长 → 拒绝（对齐 dsh「不比源小的摘要拒绝」）
        assert!(
            !summary_is_usable(&material, &material, &estimator),
            "未缩小的摘要应拒绝"
        );
        // 缩一半以上 → 通过
        assert!(
            summary_is_usable(&"摘要".repeat(200), &material, &estimator),
            "显著缩小的摘要应通过"
        );
    }

    /// 回填正文 = 检查点前言 + 摘要（首尾空白清理）
    #[test]
    fn summary_body_carries_checkpoint_preamble() {
        let body = render_summary_body("   ## Current Work\n正在推进  ");
        assert!(body.starts_with(CHECKPOINT_PREAMBLE));
        assert!(body.ends_with("正在推进"), "摘要应去除首尾空白: {body:?}");
        assert!(!body.contains("  \n"), "不应保留多余空白");
    }
}