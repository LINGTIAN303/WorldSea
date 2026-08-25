//! Provider 静态清单（25 个内置 Provider），详细见 docs/details/注释/agent-runtime/llm.md

use super::model::ApiType;

/// Provider ID（与 manifest.id 一一对应）
pub type ProviderId = &'static str;

/// 视觉模型检测函数类型
pub type VisionDetector = fn(&str) -> bool;

/// 思考模型检测函数类型
pub type ThinkingDetector = fn(&str) -> bool;

/// 思考格式（影响响应解析）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ThinkingFormat {
    /// DeepSeek 格式（`reasoning_content` 字段，但有特殊处理）
    Deepseek,
    /// 标准 `reasoning_content` 字段
    ReasoningContent,
}

/// Provider 元数据（静态清单）
#[derive(Debug, Clone)]
pub struct ProviderManifest {
    /// Provider ID（如 "deepseek" / "openai" / "anthropic"）
    pub id: ProviderId,
    /// 显示名称
    pub label: &'static str,
    /// API 协议类型
    pub api_type: ApiType,
    /// 是否为国内供应商（影响代理路由与 buildCustomModel）
    pub is_domestic: bool,
    /// Vite 代理路径前缀（开发环境用，Rust 侧仅作元数据保留）
    pub proxy_path: &'static str,
    /// 直连 API Base URL（生产环境用）
    pub direct_base_url: &'static str,
    /// 聊天补全端点路径（相对于 direct_base_url）
    pub chat_completions_path: &'static str,
    /// 默认模型 ID
    pub default_model_id: &'static str,
    /// 视觉模型检测函数
    pub vision_detector: VisionDetector,
    /// 思考模型检测函数
    pub thinking_detector: ThinkingDetector,
    /// 思考格式（thinking_detector 返回 true 时使用）
    pub thinking_format: Option<ThinkingFormat>,
    /// 是否支持 /v1/models 动态拉取
    pub supports_model_listing: bool,
}

impl ProviderManifest {
    /// 检测模型是否支持视觉输入
    pub fn supports_vision(&self, model_id: &str) -> bool {
        (self.vision_detector)(model_id)
    }

    /// 检测模型是否支持思考（reasoning）
    pub fn supports_thinking(&self, model_id: &str) -> bool {
        (self.thinking_detector)(model_id)
    }
}

// ─── 检测函数（私有，对应 TS 版的闭包） ────────────────────────────────

fn always_true(_id: &str) -> bool {
    true
}

fn always_false(_id: &str) -> bool {
    false
}

fn anthropic_vision(_id: &str) -> bool {
    // Anthropic 全系支持视觉
    true
}

fn anthropic_thinking(id: &str) -> bool {
    // Fable 5 始终开启；Opus/Sonnet 5 走 Adaptive；Haiku 4.5 走 Extended
    id.starts_with("claude-fable-5")
        || id.starts_with("claude-opus-5")
        || id.starts_with("claude-sonnet-5")
        || id.contains("haiku-4-5")
}

fn deepseek_thinking(id: &str) -> bool {
    id == "deepseek-reasoner" || id.starts_with("deepseek-v4")
}

fn deepseek_vision(id: &str) -> bool {
    id.contains("vision")
}

fn groq_vision(id: &str) -> bool {
    id.contains("scout") && id.contains("vision")
}

fn zhipu_vision(id: &str) -> bool {
    // /\d+v/i.test(id) — 数字后跟 v（如 glm-4v）
    let bytes = id.as_bytes();
    let mut i = 0;
    while i + 1 < bytes.len() {
        if bytes[i].is_ascii_digit() {
            let next = bytes[i + 1];
            if next == b'v' || next == b'V' {
                return true;
            }
        }
        i += 1;
    }
    false
}

fn zhipu_thinking(id: &str) -> bool {
    id.starts_with("glm-5") || id.starts_with("glm-4.7")
}

fn qwen_vision(id: &str) -> bool {
    id.contains("vl")
        || id.contains("VL")
        || id.contains("3.8-plus")
        || id.contains("3.8-flash")
        || id.contains("3.8-max")
        || id.contains("3.7-plus")
        || id.contains("3.7-flash")
        || id.contains("3.7-max")
        || id.contains("3.6-plus")
        || id.contains("3.5-plus")
        || id.contains("3.5-flash")
}

fn qwen_thinking(id: &str) -> bool {
    id.contains("qwen3")
}

fn minimax_vision(id: &str) -> bool {
    id.contains("vl") || id.contains("VL") || id.starts_with("MiniMax-M3")
}

fn minimax_thinking(id: &str) -> bool {
    id.starts_with("MiniMax-M2") || id.starts_with("MiniMax-M3")
}

fn kimi_vision(id: &str) -> bool {
    id.starts_with("kimi-k3")
        || id.starts_with("kimi-k2.7")
        || id.starts_with("kimi-k2.6")
        || id.starts_with("kimi-k2.5")
}

fn kimi_thinking(id: &str) -> bool {
    id.starts_with("kimi-k2") || id.starts_with("kimi-k3")
}

fn sensenova_vision(_id: &str) -> bool {
    true
}

fn sensenova_thinking(id: &str) -> bool {
    id.contains("reasoner") || id.contains("6.5") || id.contains("6-pro") || id.contains("6-turbo")
}

fn doubao_vision(id: &str) -> bool {
    id.contains("vision")
        || id.contains("vl")
        || id.contains("evolving")
        || id.contains("2.0-lite")
        || id.contains("2.0-pro")
        || id.contains("2.0-mini")
        // Seed2.1 官方确认支持图文视频输入；1.8 为多模态 Agent
        || id.contains("seed-2.1")
        || id.contains("seed-1.8")
}

fn doubao_thinking(id: &str) -> bool {
    id.contains("seed-evolving")
        || id.contains("seed-2.1")
        || id.contains("seed-2.0")
        || id.contains("1.5-pro")
}

fn xai_thinking(id: &str) -> bool {
    id.contains("grok-4") || id.contains("grok-3")
}

fn mistral_vision(id: &str) -> bool {
    id.contains("pixtral") || id.contains("medium-3-5") || id.contains("small-2603") || id.contains("large-latest")
}

fn mistral_thinking(id: &str) -> bool {
    id.contains("medium-3-5") || id.contains("small-2603") || id.contains("devstral")
}

fn stepfun_vision(id: &str) -> bool {
    id == "step-3.7-flash"
}

fn stepfun_thinking(id: &str) -> bool {
    id == "step-3.7-flash"
        || id == "step-3.5-flash"
        || id == "step-3.5-flash-2603"
}

fn mimo_vision(id: &str) -> bool {
    // v2.5 全模态(含图/视频/音)，pro 纯文本
    id == "mimo-v2.5" || id.contains("omni")
}

fn mimo_thinking(id: &str) -> bool {
    id.starts_with("mimo-v2")
}

fn generic_vision(_id: &str) -> bool {
    true
}

fn generic_thinking_false(_id: &str) -> bool {
    false
}

fn siliconflow_thinking(id: &str) -> bool {
    id.contains("DeepSeek")
        || id.contains("deepseek")
        || id.contains("GLM")
        || id.contains("glm")
        || id.contains("Kimi")
        || id.contains("kimi")
}

fn tencentcloud_thinking(id: &str) -> bool {
    id.contains("GLM")
        || id.contains("glm")
        || id.contains("Kimi")
        || id.contains("kimi")
        || id.contains("DeepSeek")
        || id.contains("deepseek")
        || id.contains("MiniMax")
        || id.contains("MiMo")
}

fn longcat_thinking(id: &str) -> bool {
    id.starts_with("longcat") || id.contains("LongCat")
}

fn xfyun_vision(id: &str) -> bool {
    id.contains("vision") || id.contains("VL") || id.contains("vl")
}

fn xfyun_thinking(id: &str) -> bool {
    id.contains("spark-x") || id.contains("ultra") || id.contains("pro")
}

fn bailian_vision(id: &str) -> bool {
    id.contains("vl") || id.contains("VL") || id.contains("vision")
}

fn bailian_thinking(id: &str) -> bool {
    id.contains("qwen3")
        || id.contains("DeepSeek")
        || id.contains("deepseek")
        || id.contains("GLM")
        || id.contains("glm")
        || id.contains("kimi")
        || id.contains("Kimi")
}

fn modelscope_vision(id: &str) -> bool {
    id.contains("VL") || id.contains("vl") || id.contains("Vision") || id.contains("vision")
}

fn modelscope_thinking(id: &str) -> bool {
    id.contains("R1") || id.contains("Reason") || id.contains("Thinking") || id.contains("qwq")
}

// ─── Provider 清单（16 个） ────────────────────────────────

/// 所有内置 Provider 清单（16 个）
pub const ALL_MANIFESTS: &[ProviderManifest] = &[
    ProviderManifest {
        id: "anthropic",
        label: "Anthropic",
        api_type: ApiType::AnthropicMessages,
        is_domestic: false,
        proxy_path: "/api/anthropic",
        direct_base_url: "https://api.anthropic.com",
        chat_completions_path: "/v1/messages",
        default_model_id: "claude-fable-5",
        vision_detector: anthropic_vision,
        thinking_detector: anthropic_thinking,
        thinking_format: None,
        supports_model_listing: true,
    },
    ProviderManifest {
        id: "openai",
        label: "OpenAI",
        api_type: ApiType::OpenaiCompletions,
        is_domestic: false,
        proxy_path: "/api/openai/v1",
        direct_base_url: "https://api.openai.com",
        chat_completions_path: "/v1/chat/completions",
        default_model_id: "gpt-5.6-sol",
        vision_detector: always_true,
        thinking_detector: always_false,
        thinking_format: None,
        supports_model_listing: true,
    },
    ProviderManifest {
        id: "google",
        label: "Google",
        api_type: ApiType::GoogleGenerativeAi,
        is_domestic: false,
        proxy_path: "/api/google",
        direct_base_url: "https://generativelanguage.googleapis.com",
        chat_completions_path: "/v1beta/models", // 特殊：含 {modelId}:generateContent
        default_model_id: "gemini-3.7-flash",
        vision_detector: always_true,
        thinking_detector: always_false,
        thinking_format: None,
        supports_model_listing: true,
    },
    ProviderManifest {
        id: "deepseek",
        label: "DeepSeek",
        api_type: ApiType::OpenaiCompletions,
        is_domestic: true,
        proxy_path: "/api/deepseek",
        direct_base_url: "https://api.deepseek.com",
        chat_completions_path: "/v1/chat/completions",
        default_model_id: "deepseek-v4-flash",
        vision_detector: deepseek_vision,
        thinking_detector: deepseek_thinking,
        thinking_format: Some(ThinkingFormat::Deepseek),
        supports_model_listing: true,
    },
    ProviderManifest {
        id: "groq",
        label: "Groq",
        api_type: ApiType::OpenaiCompletions,
        is_domestic: false,
        proxy_path: "/api/groq/openai/v1",
        direct_base_url: "https://api.groq.com/openai",
        chat_completions_path: "/v1/chat/completions",
        default_model_id: "openai/gpt-oss-120b",
        vision_detector: groq_vision,
        thinking_detector: always_false,
        thinking_format: None,
        supports_model_listing: true,
    },
    ProviderManifest {
        id: "openrouter",
        label: "OpenRouter",
        api_type: ApiType::OpenaiCompletions,
        is_domestic: false,
        proxy_path: "/api/openrouter/api/v1",
        direct_base_url: "https://openrouter.ai/api",
        chat_completions_path: "/v1/chat/completions",
        default_model_id: "openai/gpt-4o",
        vision_detector: always_true,
        thinking_detector: always_false,
        thinking_format: None,
        supports_model_listing: true,
    },
    ProviderManifest {
        id: "zhipu",
        label: "智谱 GLM",
        api_type: ApiType::OpenaiCompletions,
        is_domestic: true,
        proxy_path: "/api/zhipu/api/paas/v4",
        direct_base_url: "https://open.bigmodel.cn/api/paas/v4",
        chat_completions_path: "/chat/completions",
        default_model_id: "glm-5.3",
        vision_detector: zhipu_vision,
        thinking_detector: zhipu_thinking,
        thinking_format: Some(ThinkingFormat::ReasoningContent),
        supports_model_listing: true,
    },
    ProviderManifest {
        id: "qwen",
        label: "通义千问",
        api_type: ApiType::OpenaiCompletions,
        is_domestic: true,
        proxy_path: "/api/qwen/compatible-mode/v1",
        direct_base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        chat_completions_path: "/chat/completions",
        default_model_id: "qwen3.8-max",
        vision_detector: qwen_vision,
        thinking_detector: qwen_thinking,
        thinking_format: Some(ThinkingFormat::ReasoningContent),
        supports_model_listing: true,
    },
    ProviderManifest {
        id: "minimax",
        label: "MiniMax",
        api_type: ApiType::OpenaiCompletions,
        is_domestic: true,
        proxy_path: "/api/minimax/v1",
        direct_base_url: "https://api.minimax.chat/v1",
        chat_completions_path: "/chat/completions",
        default_model_id: "MiniMax-M3",
        vision_detector: minimax_vision,
        thinking_detector: minimax_thinking,
        thinking_format: Some(ThinkingFormat::ReasoningContent),
        supports_model_listing: true,
    },
    ProviderManifest {
        id: "kimi",
        label: "Kimi",
        api_type: ApiType::OpenaiCompletions,
        is_domestic: true,
        proxy_path: "/api/kimi/v1",
        direct_base_url: "https://api.moonshot.cn/v1",
        chat_completions_path: "/chat/completions",
        default_model_id: "kimi-k3",
        vision_detector: kimi_vision,
        thinking_detector: kimi_thinking,
        thinking_format: Some(ThinkingFormat::ReasoningContent),
        supports_model_listing: true,
    },
    ProviderManifest {
        id: "agnes",
        label: "Agnes AI",
        api_type: ApiType::OpenaiCompletions,
        is_domestic: true,
        proxy_path: "/api/agnes/v1",
        direct_base_url: "https://api.agnesai.com/v1",
        chat_completions_path: "/chat/completions",
        default_model_id: "agnes-2.5-pro",
        vision_detector: generic_vision,
        thinking_detector: |id| id.starts_with("agnes-2.5"),
        thinking_format: None,
        supports_model_listing: false,
    },
    ProviderManifest {
        id: "sensenova",
        label: "商汤 SenseNova",
        api_type: ApiType::OpenaiCompletions,
        is_domestic: true,
        proxy_path: "/api/sensenova/v1",
        // genai OpenAI 适配器用 `base_url.join("chat/completions")` 硬编码拼接端点，
        // 不消费 chat_completions_path 字段。故 base 必须含 `/v1`，否则拼出
        // `https://token.sensenova.cn/chat/completions`（404）。见 docs/details/注释/agent-runtime/llm.md
        direct_base_url: "https://token.sensenova.cn/v1",
        chat_completions_path: "/v1/chat/completions",
        default_model_id: "sensenova-6.5-pro",
        vision_detector: sensenova_vision,
        thinking_detector: sensenova_thinking,
        thinking_format: None,
        supports_model_listing: true,
    },
    ProviderManifest {
        id: "doubao",
        label: "字节豆包",
        api_type: ApiType::OpenaiCompletions,
        is_domestic: true,
        proxy_path: "/api/doubao/api/v3",
        direct_base_url: "https://ark.cn-beijing.volces.com/api/v3",
        chat_completions_path: "/chat/completions",
        default_model_id: "doubao-seed-evolving",
        vision_detector: doubao_vision,
        thinking_detector: doubao_thinking,
        thinking_format: Some(ThinkingFormat::ReasoningContent),
        supports_model_listing: false,
    },
    ProviderManifest {
        id: "xai",
        label: "xAI Grok",
        api_type: ApiType::OpenaiCompletions,
        is_domestic: false,
        proxy_path: "/api/xai/v1",
        direct_base_url: "https://api.x.ai",
        chat_completions_path: "/v1/chat/completions",
        default_model_id: "grok-4.6",
        vision_detector: always_true,
        thinking_detector: xai_thinking,
        thinking_format: Some(ThinkingFormat::ReasoningContent),
        supports_model_listing: true,
    },
    ProviderManifest {
        id: "mistral",
        label: "Mistral AI",
        api_type: ApiType::OpenaiCompletions,
        is_domestic: false,
        proxy_path: "/api/mistral/v1",
        direct_base_url: "https://api.mistral.ai",
        chat_completions_path: "/v1/chat/completions",
        default_model_id: "mistral-medium-3-5",
        vision_detector: mistral_vision,
        thinking_detector: mistral_thinking,
        thinking_format: None,
        supports_model_listing: true,
    },
    ProviderManifest {
        id: "stepfun",
        label: "StepFun",
        api_type: ApiType::OpenaiCompletions,
        is_domestic: true,
        proxy_path: "/api/stepfun/v1",
        direct_base_url: "https://api.stepfun.com",
        chat_completions_path: "/v1/chat/completions",
        default_model_id: "step-3.7-flash",
        vision_detector: stepfun_vision,
        thinking_detector: stepfun_thinking,
        thinking_format: Some(ThinkingFormat::ReasoningContent),
        supports_model_listing: true,
    },
    ProviderManifest {
        id: "mimo",
        label: "小米 MiMo",
        api_type: ApiType::OpenaiCompletions,
        is_domestic: true,
        proxy_path: "/api/mimo/v1",
        direct_base_url: "https://api.xiaomimimo.com/v1",
        chat_completions_path: "/chat/completions",
        default_model_id: "mimo-v2.5-pro",
        vision_detector: mimo_vision,
        thinking_detector: mimo_thinking,
        thinking_format: Some(ThinkingFormat::ReasoningContent),
        supports_model_listing: true,
    },
    ProviderManifest {
        id: "siliconflow",
        label: "SiliconFlow 硅基流动",
        api_type: ApiType::OpenaiCompletions,
        is_domestic: true,
        proxy_path: "/api/siliconflow/v1",
        direct_base_url: "https://api.siliconflow.cn/v1",
        chat_completions_path: "/chat/completions",
        default_model_id: "deepseek-ai/DeepSeek-V4-Flash",
        vision_detector: generic_vision,
        thinking_detector: siliconflow_thinking,
        thinking_format: Some(ThinkingFormat::ReasoningContent),
        supports_model_listing: true,
    },
    ProviderManifest {
        id: "tencentcloud",
        label: "腾讯云 TokenHub",
        api_type: ApiType::OpenaiCompletions,
        is_domestic: true,
        proxy_path: "/api/tencentcloud/v1",
        direct_base_url: "https://api.cloud.tencent.com",
        chat_completions_path: "/v1/chat/completions",
        default_model_id: "hy3",
        vision_detector: generic_vision,
        thinking_detector: tencentcloud_thinking,
        thinking_format: Some(ThinkingFormat::ReasoningContent),
        supports_model_listing: true,
    },
    ProviderManifest {
        id: "longcat",
        label: "LongCat 美团",
        api_type: ApiType::OpenaiCompletions,
        is_domestic: true,
        proxy_path: "/api/longcat/v1",
        direct_base_url: "https://api.longcat.chat/v1",
        chat_completions_path: "/chat/completions",
        default_model_id: "longcat-2.0",
        vision_detector: generic_vision,
        thinking_detector: longcat_thinking,
        thinking_format: Some(ThinkingFormat::ReasoningContent),
        supports_model_listing: true,
    },
    ProviderManifest {
        id: "dots",
        label: "Dots Studio",
        api_type: ApiType::OpenaiCompletions,
        is_domestic: false,
        proxy_path: "/api/dots/v1",
        direct_base_url: "https://api.dots.ai/v1",
        chat_completions_path: "/chat/completions",
        default_model_id: "dots-3-note-preview",
        vision_detector: generic_vision,
        thinking_detector: |id| id.contains("dots-3"),
        thinking_format: None,
        supports_model_listing: true,
    },
    ProviderManifest {
        id: "xfyun",
        label: "讯飞星火 MaaS",
        api_type: ApiType::OpenaiCompletions,
        is_domestic: true,
        proxy_path: "/api/xfyun/v1",
        direct_base_url: "https://maas-api.xfyun.cn/v1",
        chat_completions_path: "/chat/completions",
        default_model_id: "spark-ultra",
        vision_detector: xfyun_vision,
        thinking_detector: xfyun_thinking,
        thinking_format: Some(ThinkingFormat::ReasoningContent),
        supports_model_listing: true,
    },
    ProviderManifest {
        id: "bailian",
        label: "阿里云百炼",
        api_type: ApiType::OpenaiCompletions,
        is_domestic: true,
        proxy_path: "/api/bailian/compatible-mode/v1",
        direct_base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        chat_completions_path: "/chat/completions",
        default_model_id: "qwen3.8-max",
        vision_detector: bailian_vision,
        thinking_detector: bailian_thinking,
        thinking_format: Some(ThinkingFormat::ReasoningContent),
        supports_model_listing: true,
    },
    ProviderManifest {
        id: "modelscope",
        label: "ModelScope 魔搭",
        api_type: ApiType::OpenaiCompletions,
        is_domestic: true,
        proxy_path: "/api/modelscope/v1",
        direct_base_url: "https://api-inference.modelscope.cn/v1",
        chat_completions_path: "/chat/completions",
        default_model_id: "Qwen/Qwen2.5-Coder-32B-Instruct",
        vision_detector: modelscope_vision,
        thinking_detector: modelscope_thinking,
        thinking_format: None,
        supports_model_listing: true,
    },
    ProviderManifest {
        id: "kling",
        label: "可灵 Kling",
        api_type: ApiType::OpenaiCompletions,
        is_domestic: true,
        proxy_path: "/api/kling/v1",
        direct_base_url: "https://api.klingai.com",
        chat_completions_path: "/v1/videos/text2video",
        default_model_id: "kling-v2",
        vision_detector: generic_vision,
        thinking_detector: generic_thinking_false,
        thinking_format: None,
        supports_model_listing: false,
    },
];

// ─── 查询 API ────────────────────────────────────────────

/// 根据 Provider ID 查找 manifest
pub fn find_manifest(provider_id: &str) -> Option<&'static ProviderManifest> {
    ALL_MANIFESTS.iter().find(|m| m.id == provider_id)
}

/// 获取所有国内供应商 ID
pub fn domestic_provider_ids() -> Vec<&'static str> {
    ALL_MANIFESTS
        .iter()
        .filter(|m| m.is_domestic)
        .map(|m| m.id)
        .collect()
}

/// 获取所有供应商 ID
pub fn provider_ids() -> Vec<&'static str> {
    ALL_MANIFESTS.iter().map(|m| m.id).collect()
}

/// 检测模型是否支持视觉
pub fn detect_vision_support(provider_id: &str, model_id: &str) -> bool {
    find_manifest(provider_id)
        .map(|m| m.supports_vision(model_id))
        .unwrap_or(false)
}

/// 检测模型是否支持思考
pub fn detect_thinking_support(provider_id: &str, model_id: &str) -> bool {
    find_manifest(provider_id)
        .map(|m| m.supports_thinking(model_id))
        .unwrap_or(false)
}

/// 获取思考格式
pub fn thinking_format(provider_id: &str) -> Option<ThinkingFormat> {
    find_manifest(provider_id).and_then(|m| m.thinking_format)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifests_count_is_16() {
        assert_eq!(ALL_MANIFESTS.len(), 25, "应有 25 个 Provider manifest");
    }

    #[test]
    fn find_manifest_should_return_correct_provider() {
        let ds = find_manifest("deepseek").expect("deepseek 必须存在");
        assert_eq!(ds.label, "DeepSeek");
        assert!(ds.is_domestic);
        assert_eq!(ds.api_type, ApiType::OpenaiCompletions);
    }

    #[test]
    fn find_manifest_unknown_returns_none() {
        assert!(find_manifest("nonexistent").is_none());
    }

    #[test]
    fn deepseek_thinking_detection() {
        assert!(detect_thinking_support("deepseek", "deepseek-reasoner"));
        assert!(detect_thinking_support("deepseek", "deepseek-v4-pro-256k"));
        // 官方文档：V4 全系支持思考模式（可开关），v4-flash/v4-flash-vision-exp 亦支持
        assert!(detect_thinking_support("deepseek", "deepseek-v4-flash"));
        assert!(detect_thinking_support("deepseek", "deepseek-v4-flash-vision-exp"));
    }

    #[test]
    fn zhipu_vision_detection() {
        assert!(detect_vision_support("zhipu", "glm-4v"));
        assert!(detect_vision_support("zhipu", "glm-4.6v"));
        assert!(!detect_vision_support("zhipu", "glm-5.1"));
    }

    #[test]
    fn domestic_providers_includes_deepseek_and_zhipu() {
        let domestic = domestic_provider_ids();
        assert!(domestic.contains(&"deepseek"));
        assert!(domestic.contains(&"zhipu"));
        assert!(domestic.contains(&"qwen"));
        assert!(!domestic.contains(&"openai"));
    }

    #[test]
    fn anthropic_supports_model_listing() {
        // Anthropic 官方提供 GET /v1/models，启用模型列表拉取
        let anthropic_manifest = find_manifest("anthropic").unwrap();
        assert!(anthropic_manifest.supports_model_listing);
    }

    #[test]
    fn doubao_does_not_support_model_listing() {
        // 火山方舟无 OpenAI 兼容 /models 列表接口（endpointID+鉴权），关闭列表拉取
        let doubao_manifest = find_manifest("doubao").unwrap();
        assert!(!doubao_manifest.supports_model_listing);
    }

    #[test]
    fn deepseek_uses_deepseek_thinking_format() {
        assert_eq!(
            thinking_format("deepseek"),
            Some(ThinkingFormat::Deepseek)
        );
    }

    #[test]
    fn zhipu_uses_reasoning_content_format() {
        assert_eq!(
            thinking_format("zhipu"),
            Some(ThinkingFormat::ReasoningContent)
        );
    }

    #[test]
    fn openai_has_no_thinking_format() {
        assert_eq!(thinking_format("openai"), None);
    }
}
