//! # 模型信息
//!
//! 对应 TS 版 pi-ai 的 `Model<TApi>` 结构。
//! 简化版：只保留 worldsmith 实际使用的字段。

use serde::{Deserialize, Serialize};

/// API 协议类型（对应 pi-ai 的 KnownApi）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ApiType {
    /// OpenAI Completions 协议（含 DeepSeek/Moonshot/Qwen 等兼容协议）
    OpenaiCompletions,
    /// OpenAI Responses 协议
    OpenaiResponses,
    /// Anthropic Messages 协议
    AnthropicMessages,
    /// Google Generative AI 协议
    GoogleGenerativeAi,
    /// Azure OpenAI Responses 协议
    AzureOpenaiResponses,
}

impl ApiType {
    /// 从字符串解析（用于从 manifest 字符串构建）
    pub fn from_str_lossy(s: &str) -> Self {
        match s {
            "openai-completions" => Self::OpenaiCompletions,
            "openai-responses" => Self::OpenaiResponses,
            "anthropic-messages" => Self::AnthropicMessages,
            "google-generative-ai" => Self::GoogleGenerativeAi,
            "azure-openai-responses" => Self::AzureOpenaiResponses,
            _ => Self::OpenaiCompletions, // 默认走 OpenAI 兼容
        }
    }
}

/// 模型输入模态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ModelInput {
    Text,
    Image,
}

/// 模型成本（每百万 token 的美元价格）
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ModelCost {
    pub input: f64,
    pub output: f64,
    pub cache_read: f64,
    pub cache_write: f64,
}

/// 模型信息（对应 pi-ai 的 `Model<TApi>`）
///
/// 简化字段：去掉 `compat` 三态联合，按 API 类型分支处理放到 `GenaiBackend` 内部。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    /// 模型 ID（如 "deepseek-v4-flash"）
    pub id: String,
    /// 显示名称
    pub name: String,
    /// API 协议
    pub api: ApiType,
    /// Provider ID（如 "deepseek"）
    pub provider: String,
    /// Base URL（直连，不含代理前缀）
    pub base_url: String,
    /// 是否支持思考（reasoning）
    pub reasoning: bool,
    /// 输入模态
    pub input: Vec<ModelInput>,
    /// 成本
    pub cost: ModelCost,
    /// 上下文窗口大小
    pub context_window: u32,
    /// 最大输出 token
    pub max_tokens: u32,
    /// 自定义请求头
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub headers: Option<std::collections::HashMap<String, String>>,
}

impl ModelInfo {
    /// 是否支持视觉输入
    pub fn supports_vision(&self) -> bool {
        self.input.contains(&ModelInput::Image)
    }

    /// 构建自定义模型（对应 TS 版 buildCustomModel）
    pub fn build_custom(
        provider: &str,
        model_id: &str,
        base_url: &str,
        api: ApiType,
        context_window: u32,
        max_tokens: u32,
    ) -> Self {
        Self {
            id: model_id.to_string(),
            name: model_id.to_string(),
            api,
            provider: provider.to_string(),
            base_url: base_url.to_string(),
            reasoning: false,
            input: vec![ModelInput::Text],
            cost: ModelCost::default(),
            context_window,
            max_tokens,
            headers: None,
        }
    }
}
