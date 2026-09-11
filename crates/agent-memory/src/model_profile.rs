//! # 模型特配档案（A1 丙1 的装配侧入口）
//!
//! 把「模型 → 分词器 + 上下文窗口 + 归档阈值」的解析收在一处，供装配层
//! （`agent-commands`）在构造 `AgentLoop` 与 `MemoryCenterAccessor` 时取用。
//!
//! 设计依据：[A1 记忆系统设计](../../../docs/plans/2026-09-11-A1-记忆系统设计.md) §5.1/§5.3。
//!
//! ## 为什么放在 agent-memory
//!
//! 本适配层已是「WorldSea ↔ MemoryCenter 家族」的边界：它依赖
//! `memory-center-core`，再多依赖 `memory-center-models` 属同一族内的自然延伸。
//! 这样装配层（agent-commands）**不需要新增依赖**——它本就依赖 agent-memory。
//!
//! ## 单一事实源约束
//!
//! 归档阈值**只从「窗口 × 归档比率」推导**，比率取自上游专家调校值
//! （内置型号 0.20–0.50；未知型号保守 0.25）。
//! 引以为戒：上游曾因 `get_archive_threshold`（120K）与 `ArchiveConfig::default()`（400K）
//! 双兜底不一致，造成「LLM 建议归档但 Archiver 不触发」的**反馈断裂**。
//!
//! ## 量纲
//!
//! `context_window` / `archive_threshold` **均为上下文 token**，非字节。
//! 修正前主链路以字节计量（`HISTORY_BUDGET_BYTES = 160_000`），属实现与语义不一致。

use std::sync::Arc;

use agent_runtime::context_budget::{
    ContextBudgetPolicy, TokenEstimator, FALLBACK_CONTEXT_WINDOW,
};

use memory_center_models::family::ModelFamily;
use memory_center_models::tokenizer::Tokenizer;
use memory_center_models::{build_token_estimator, ModelRegistry, ModelVariant};

/// 未知型号的归档比率（对齐上游 `ModelVariant::custom` 的统一保守值 0.25）
pub const FALLBACK_ARCHIVE_RATIO: f64 = 0.25;

/// 模型特配档案
///
/// 一次解析、多处消费：装配层用它同时喂给
/// [`ContextBudgetPolicy`]（agent-kernel）与 `ArchiveConfig`（vendor）。
pub struct ModelProfile {
    /// 实际使用的模型名（注册表命中时为规范名，否则为传入名）
    pub model_name: String,
    /// 命中的家族（用于日志与调试）
    pub family: ModelFamily,
    /// 上下文窗口（上下文 token）
    pub context_window: usize,
    /// 归档阈值（上下文 token）= 窗口 × 归档比率
    pub archive_threshold: usize,
    /// 分词器名称（如 `claude_approx` / `o200k_base` / `character_based`）
    pub tokenizer_name: String,
    /// 是否命中内置注册表（`false` = 按家族推导的保守档案）
    pub from_registry: bool,
    /// token 估算器（真实分词器；失败时自动降级为字符级）
    estimator: TokenEstimator,
}

impl std::fmt::Debug for ModelProfile {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // estimator 是闭包，无法 Debug——只打印可读字段
        f.debug_struct("ModelProfile")
            .field("model_name", &self.model_name)
            .field("family", &self.family)
            .field("context_window", &self.context_window)
            .field("archive_threshold", &self.archive_threshold)
            .field("tokenizer_name", &self.tokenizer_name)
            .field("from_registry", &self.from_registry)
            .finish()
    }
}

impl ModelProfile {
    /// 解析模型档案
    ///
    /// # 参数
    /// - `model_id`：模型 ID（如 `deepseek-v4-flash`；支持上游 `*-latest` 别名）
    /// - `provider_id`：供应商 ID（注册表未命中时用于家族推断）
    /// - `declared_context_window`：调用方声明的窗口（来自 Provider 配置）；`0` = 未声明
    ///
    /// # 解析顺序
    ///
    /// 1. **注册表精确命中**（含别名解析）→ 用其专家档案；若调用方声明的窗口更小，
    ///    **按同一比率缩放阈值**（尊重声明，但不破坏比率单一来源）
    /// 2. **未命中** → 按供应商推断家族 → `ModelVariant::custom` 推导（比率 0.25）
    pub fn resolve(model_id: &str, provider_id: &str, declared_context_window: u32) -> Self {
        let declared = declared_context_window as usize;

        if let Some(variant) = ModelRegistry::find(model_id) {
            // 专家比率 = 专家阈值 / 专家窗口（保留比率、尊重声明窗口）
            let expert_window = variant.context_window.max(1);
            let ratio = variant.archive_strategy.threshold() as f64 / expert_window as f64;
            let window = if declared > 0 {
                declared.min(expert_window)
            } else {
                expert_window
            };
            return Self::from_variant(variant, window, ratio, true);
        }

        // 未命中：按供应商推断家族，走保守推导（比率 0.25）
        let family = infer_family(provider_id, model_id);
        let window = if declared > 0 { declared } else { FALLBACK_CONTEXT_WINDOW };
        let variant = ModelVariant::custom(model_id.to_string(), family, window);
        Self::from_variant(variant, window, FALLBACK_ARCHIVE_RATIO, false)
    }

    /// 兜底档案（模型信息完全缺失时；保守窗口 + 保守比率）
    pub fn fallback() -> Self {
        let variant = ModelVariant::custom(
            "unknown".to_string(),
            ModelFamily::Custom,
            FALLBACK_CONTEXT_WINDOW,
        );
        Self::from_variant(variant, FALLBACK_CONTEXT_WINDOW, FALLBACK_ARCHIVE_RATIO, false)
    }

    /// 由型号构造档案（内部）
    fn from_variant(
        variant: ModelVariant,
        context_window: usize,
        archive_ratio: f64,
        from_registry: bool,
    ) -> Self {
        let tokenizer: Arc<dyn Tokenizer> = variant.tokenizer.build();
        let tokenizer_name = tokenizer.name().to_string();

        // 阈值只从「窗口 × 比率」推导——单一来源
        let archive_threshold = ((context_window as f64) * archive_ratio).round() as usize;
        let archive_threshold = archive_threshold.clamp(1, context_window.max(1));

        Self {
            model_name: variant.name.clone(),
            family: variant.family,
            context_window,
            archive_threshold,
            tokenizer_name,
            from_registry,
            estimator: build_token_estimator(tokenizer),
        }
    }

    /// token 估算器（闭包克隆，可多次注入）
    pub fn estimator(&self) -> TokenEstimator {
        self.estimator.clone()
    }

    /// 由本档案导出上下文预算策略（喂给 agent-kernel）
    pub fn budget_policy(&self) -> ContextBudgetPolicy {
        ContextBudgetPolicy::from_threshold(self.context_window, self.archive_threshold)
    }

    /// 归档比率（诊断用）
    pub fn archive_ratio(&self) -> f64 {
        if self.context_window == 0 {
            0.0
        } else {
            self.archive_threshold as f64 / self.context_window as f64
        }
    }
}

/// 按供应商 ID / 模型名推断模型家族
///
/// 覆盖 WorldSea 现有 provider 清单（见 `agent-kernel` 的
/// `default_window_for_provider`）与常见命名习惯。推断失败返回
/// [`ModelFamily::Custom`]（走保守比率，不做乐观假设）。
pub fn infer_family(provider_id: &str, model_id: &str) -> ModelFamily {
    let p = provider_id.to_ascii_lowercase();
    let m = model_id.to_ascii_lowercase();

    // 先看模型名（更精确），再看供应商
    let by_name = if m.contains("claude") || m.contains("opus") || m.contains("sonnet") {
        Some(ModelFamily::Claude)
    } else if m.contains("gpt") || m.contains("o1") || m.contains("o3") || m.contains("codex") {
        Some(ModelFamily::Gpt)
    } else if m.contains("gemini") {
        Some(ModelFamily::Gemini)
    } else if m.contains("deepseek") {
        Some(ModelFamily::DeepSeek)
    } else if m.contains("qwen") || m.contains("通义") {
        Some(ModelFamily::Qwen)
    } else if m.contains("llama") {
        Some(ModelFamily::Llama)
    } else if m.contains("grok") {
        Some(ModelFamily::Grok)
    } else if m.contains("doubao") || m.contains("豆包") {
        Some(ModelFamily::Doubao)
    } else if m.contains("minimax") || m.contains("abab") {
        Some(ModelFamily::MiniMax)
    } else if m.contains("kimi") || m.contains("moonshot") {
        Some(ModelFamily::Kimi)
    } else if m.contains("glm") || m.contains("chatglm") {
        Some(ModelFamily::Glm)
    } else if m.contains("hunyuan") || m.contains("hy3") {
        Some(ModelFamily::Hunyuan)
    } else if m.contains("mimo") {
        Some(ModelFamily::Mimo)
    } else {
        None
    };
    if let Some(f) = by_name {
        return f;
    }

    match p.as_str() {
        "anthropic" => ModelFamily::Claude,
        "openai" => ModelFamily::Gpt,
        "google" | "gemini" => ModelFamily::Gemini,
        "deepseek" => ModelFamily::DeepSeek,
        "qwen" | "bailian" | "modelscope" => ModelFamily::Qwen,
        "xai" => ModelFamily::Grok,
        "doubao" => ModelFamily::Doubao,
        "minimax" => ModelFamily::MiniMax,
        "kimi" | "moonshot" => ModelFamily::Kimi,
        "zhipu" => ModelFamily::Glm,
        "tencentcloud" | "hunyuan" => ModelFamily::Hunyuan,
        "mimo" => ModelFamily::Mimo,
        // 本地部署：家族未知，用 Local（tokenizer 兜底为字符级）
        "ollama" | "lm-studio" | "vllm" | "llama-cpp" | "local" => ModelFamily::Local,
        _ => ModelFamily::Custom,
    }
}

// ─── 测试 ────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_known_model_from_registry() {
        let p = ModelProfile::resolve("deepseek-v4-flash", "deepseek", 0);
        assert!(p.from_registry, "应命中内置注册表");
        assert_eq!(p.model_name, "deepseek-v4-flash");
        assert_eq!(p.family, ModelFamily::DeepSeek);
        assert_eq!(p.context_window, 1_000_000, "注册表窗口");
        // 专家比率 0.20（1M 取 200K）
        assert!((p.archive_ratio() - 0.20).abs() < 0.01, "比率 {}", p.archive_ratio());
        assert_eq!(p.tokenizer_name, "deepseek_approx");
    }

    #[test]
    fn declared_window_shrinks_threshold_but_preserves_ratio() {
        // 供应商把窗口限制到 200K（如 Trae 内置限制）→ 阈值按同一比率缩放
        let p = ModelProfile::resolve("deepseek-v4-flash", "deepseek", 200_000);
        assert_eq!(p.context_window, 200_000, "声明窗口更小则采用声明值");
        assert!((p.archive_ratio() - 0.20).abs() < 0.01, "比率不得漂移");
        assert_eq!(p.archive_threshold, 40_000);
    }

    #[test]
    fn unknown_model_falls_back_to_family_and_conservative_ratio() {
        let p = ModelProfile::resolve("some-new-model-x", "zhipu", 128_000);
        assert!(!p.from_registry);
        assert_eq!(p.family, ModelFamily::Glm, "应按供应商推断家族");
        assert_eq!(p.context_window, 128_000);
        assert_eq!(p.archive_threshold, 32_000, "未知型号保守取 0.25");
    }

    #[test]
    fn zero_declared_window_uses_fallback_window() {
        let p = ModelProfile::resolve("完全未知的模型", "完全未知的供应商", 0);
        assert_eq!(p.context_window, FALLBACK_CONTEXT_WINDOW);
        assert_eq!(p.family, ModelFamily::Custom);
        // 兜底档案也只从窗口 × 比率推导
        assert_eq!(
            p.archive_threshold,
            ((FALLBACK_CONTEXT_WINDOW as f64) * FALLBACK_ARCHIVE_RATIO).round() as usize
        );
    }

    #[test]
    fn alias_latest_resolves() {
        // 上游 v2.54 P25 别名机制：`<family>-latest`
        let p = ModelProfile::resolve("deepseek-latest", "deepseek", 0);
        assert!(p.from_registry, "别名应解析到具体型号");
        assert!(p.context_window >= 200_000);
    }

    #[test]
    fn estimator_counts_tokens_and_never_panics_on_empty() {
        let p = ModelProfile::resolve("claude-sonnet-5", "anthropic", 0);
        let est = p.estimator();
        assert!(est("Hello, world!") > 0);
        // 空文本不 panic（分词器实现各异，只断言可调用）
        let _ = est("");
        // 中文应能被计数
        assert!(est("你好，世界") >= 2);
    }

    #[test]
    fn budget_policy_matches_profile() {
        let p = ModelProfile::resolve("claude-sonnet-5", "anthropic", 200_000);
        let b = p.budget_policy();
        assert_eq!(b.context_window, p.context_window);
        assert_eq!(b.archive_threshold, p.archive_threshold);
        // 裁剪触发点在归档阈值之内（阶梯最高层 95%）
        assert!(b.trim_trigger() < b.archive_threshold);
    }

    #[test]
    fn family_inference_covers_worldsea_providers() {
        assert_eq!(infer_family("anthropic", "x"), ModelFamily::Claude);
        assert_eq!(infer_family("openai", "x"), ModelFamily::Gpt);
        assert_eq!(infer_family("google", "x"), ModelFamily::Gemini);
        assert_eq!(infer_family("deepseek", "x"), ModelFamily::DeepSeek);
        assert_eq!(infer_family("bailian", "x"), ModelFamily::Qwen);
        assert_eq!(infer_family("zhipu", "x"), ModelFamily::Glm);
        assert_eq!(infer_family("ollama", "x"), ModelFamily::Local);
        assert_eq!(infer_family("never-heard", "x"), ModelFamily::Custom);
        // 模型名优先于供应商
        assert_eq!(infer_family("openrouter", "claude-sonnet-5"), ModelFamily::Claude);
    }
}
