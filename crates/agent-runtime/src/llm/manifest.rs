//! Provider 静态清单（16 个内置 Provider），详细见 docs/details/注释/agent-runtime/llm.md

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

fn deepseek_thinking(id: &str) -> bool {
    id == "deepseek-reasoner" || id.starts_with("deepseek-v4-pro")
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
    id.starts_with("glm-5") || id.starts_with("glm-4.5")
}

fn qwen_vision(id: &str) -> bool {
    id.contains("vl")
        || id.contains("VL")
        || id.contains("3.6-plus")
        || id.contains("3.6-flash")
        || id.contains("3.5-plus")
        || id.contains("3.5-flash")
}

fn qwen_thinking(id: &str) -> bool {
    id.contains("qwen3")
}

fn minimax_vision(id: &str) -> bool {
    id.contains("vl") || id.contains("VL")
}

fn minimax_thinking(id: &str) -> bool {
    id.starts_with("MiniMax-M2")
}

fn kimi_vision(id: &str) -> bool {
    id.starts_with("kimi-k2.5")
}

fn kimi_thinking(id: &str) -> bool {
    id.starts_with("kimi-k2")
}

fn sensenova_vision(id: &str) -> bool {
    id.contains("flash-lite")
}

fn doubao_vision(id: &str) -> bool {
    id.contains("vision") || id.contains("vl") || id.contains("seed-2.0-lite")
}

fn doubao_thinking(id: &str) -> bool {
    id.contains("seed-2.0") || id.contains("1.5-pro")
}

fn xai_thinking(id: &str) -> bool {
    id.contains("grok-4") || id.contains("grok-3-mini")
}

fn mistral_vision(id: &str) -> bool {
    id.contains("pixtral")
}

fn stepfun_vision(id: &str) -> bool {
    id == "step-3.7-flash" || id == "step-1o-turbo-vision"
}

fn stepfun_thinking(id: &str) -> bool {
    id == "step-3.7-flash"
        || id == "step-3.5-flash"
        || id == "step-3.5-flash-2603"
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
        default_model_id: "claude-sonnet-4-6",
        vision_detector: anthropic_vision,
        thinking_detector: always_false,
        thinking_format: None,
        supports_model_listing: false,
    },
    ProviderManifest {
        id: "openai",
        label: "OpenAI",
        api_type: ApiType::OpenaiCompletions,
        is_domestic: false,
        proxy_path: "/api/openai/v1",
        direct_base_url: "https://api.openai.com",
        chat_completions_path: "/v1/chat/completions",
        default_model_id: "gpt-5.4",
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
        default_model_id: "gemini-2.5-flash",
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
        vision_detector: always_false,
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
        default_model_id: "glm-5.1",
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
        default_model_id: "qwen3.6-plus",
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
        default_model_id: "kimi-k2.6",
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
        default_model_id: "agnes-2.0-flash",
        vision_detector: always_false,
        thinking_detector: always_false,
        thinking_format: None,
        supports_model_listing: false,
    },
    ProviderManifest {
        id: "sensenova",
        label: "商汤 SenseNova",
        api_type: ApiType::OpenaiCompletions,
        is_domestic: true,
        proxy_path: "/api/sensenova/v1",
        direct_base_url: "https://token.sensenova.cn",
        chat_completions_path: "/v1/chat/completions",
        default_model_id: "sensenova-6.7-flash-lite",
        vision_detector: sensenova_vision,
        thinking_detector: always_false,
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
        default_model_id: "doubao-1.5-pro-256k",
        vision_detector: doubao_vision,
        thinking_detector: doubao_thinking,
        thinking_format: Some(ThinkingFormat::ReasoningContent),
        supports_model_listing: true,
    },
    ProviderManifest {
        id: "xai",
        label: "xAI Grok",
        api_type: ApiType::OpenaiCompletions,
        is_domestic: false,
        proxy_path: "/api/xai/v1",
        direct_base_url: "https://api.x.ai",
        chat_completions_path: "/v1/chat/completions",
        default_model_id: "grok-4",
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
        default_model_id: "mistral-large-latest",
        vision_detector: mistral_vision,
        thinking_detector: always_false,
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
        assert_eq!(ALL_MANIFESTS.len(), 16, "应有 16 个 Provider manifest");
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
        assert!(!detect_thinking_support("deepseek", "deepseek-v4-flash"));
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
    fn anthropic_does_not_support_model_listing() {
        let anthropic_manifest = find_manifest("anthropic").unwrap();
        assert!(!anthropic_manifest.supports_model_listing);
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
