//! # LLM 后端访问器
//!
//! 对应 TS 版 `NodeBackendAccessor` 接口。
//! 节点通过此 trait 调用 LLM，与具体 LLM 实现解耦。
//!
//! 阶段 1.2 将提供基于 `genai` 的实现。

use std::sync::Arc;

use async_trait::async_trait;

use crate::event::EventListener;
use crate::types::{ImageAttachment, OrchestratorMessage, ToolCall};

/// LLM 后端访问器 — 节点通过此接口调用 LLM
///
/// 设计为 trait 而非具体类型，解耦 pi-agent-core。
/// - 阶段 0：实现为对 pi-agent-core Agent 的包装（TS 侧）
/// - 阶段 1.2：实现为对 Rust `genai` 的封装
/// - 阶段 1.3：`prompt` 返回 [`PromptResponse`]（含 `tool_calls`），供 AgentLoop 执行 ReAct 循环
/// - 阶段 1.3 复查：新增 `subscribe_events`/`current_model`/`update_provider` default 方法
///   用于支持前端 `IAgentBackend` 接口完整实现（流式事件连接、模型热切换）
#[async_trait]
pub trait NodeBackendAccessor: Send + Sync {
    /// 发送 prompt 并流式获取响应
    ///
    /// # 参数
    /// - `prompt`：用户输入
    /// - `options`：调用选项（系统提示词/工具集/温度等）
    ///
    /// # 返回
    /// [`PromptResponse`]，包含最终文本与工具调用列表。
    /// 流式事件（StreamDelta/ToolCallStart 等）通过 [`crate::event::EventBroadcaster`] 推送。
    async fn prompt(
        &self,
        prompt: String,
        options: Option<PromptCallOptions>,
    ) -> Result<PromptResponse, BackendError>;

    /// 中途引导（不结束当前轮）
    async fn steer(&self, text: String) -> Result<(), BackendError>;

    /// 获取当前 messages 快照（用于 checkpoint）
    async fn get_messages(&self) -> Vec<OrchestratorMessage>;

    /// 写回 messages（用于断点恢复）
    async fn set_messages(&self, messages: Vec<OrchestratorMessage>) -> Result<(), BackendError>;

    /// 清理上下文（释放窗口空间）
    ///
    /// # 参数
    /// - `up_to_index`：移除前 N 条
    async fn trim_context(&self, up_to_index: usize) -> Result<(), BackendError>;

    /// 订阅 backend 内部事件（流式增量、工具调用等）
    ///
    /// 默认空实现，由支持流式事件的 backend（如 `GenaiBackend`）覆盖。
    /// AgentLoop 在构造时调用此方法，把转发 listener 注入 backend，
    /// 使订阅 AgentLoop 的监听器能收到 backend 的流式事件。
    ///
    /// # 设计动机
    /// AgentLoop 和 Backend 各自持有独立的 `EventBroadcaster`，
    /// 若不连接，订阅 AgentLoop 的监听器收不到 `StreamStart`/`StreamDelta` 等事件。
    async fn subscribe_events(&self, _listener: Arc<dyn EventListener>) {
        // 默认无操作
    }

    /// 获取当前模型 ID（用于 `AgentStart` 事件）
    ///
    /// 默认返回 `"unknown"`，由具体 backend 覆盖返回实际模型 ID。
    async fn current_model(&self) -> String {
        "unknown".to_string()
    }

    /// 热切换 Provider 配置（不清空消息历史）
    ///
    /// 默认返回 `BackendError::Unsupported`，由支持热切换的 backend 覆盖。
    /// 对应前端 `IAgentBackend.updateModel` 接口。
    ///
    /// # 参数
    /// - `provider`：Provider ID（如 "deepseek"/"openai"/"anthropic"）
    /// - `model_id`：模型 ID（如 "deepseek-v4-flash"）
    /// - `api_key`：API Key（None=保持原值）
    /// - `base_url`：自定义 base URL（None=使用 Provider 默认）
    async fn update_provider(
        &self,
        _provider: String,
        _model_id: String,
        _api_key: Option<String>,
        _base_url: Option<String>,
    ) -> Result<(), BackendError> {
        Err(BackendError::Unsupported(
            "update_provider not supported by this backend".into(),
        ))
    }
}

/// LLM 调用返回结果 — 阶段 1.3 引入
///
/// 包含最终文本与工具调用列表。AgentLoop 据此决定是否进入工具执行循环。
#[derive(Debug, Clone, Default)]
pub struct PromptResponse {
    /// 最终响应文本（流式增量的合并结果）
    pub text: String,
    /// LLM 触发的工具调用列表（按调用顺序）
    ///
    /// 空列表表示 LLM 未触发工具调用，AgentLoop 应结束循环。
    pub tool_calls: Vec<ToolCall>,
    /// 输入 token 数（usage 统计，可选）
    pub input_tokens: Option<u32>,
    /// 输出 token 数（usage 统计，可选）
    pub output_tokens: Option<u32>,
    /// 停止原因（如 "stop"、"tool_calls"、"length"）
    pub stop_reason: Option<String>,
}

impl PromptResponse {
    /// 创建仅含文本的响应（无工具调用）
    pub fn text_only(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            tool_calls: Vec::new(),
            input_tokens: None,
            output_tokens: None,
            stop_reason: None,
        }
    }

    /// 是否包含工具调用
    pub fn has_tool_calls(&self) -> bool {
        !self.tool_calls.is_empty()
    }
}

/// 节点调用 LLM 的选项
#[derive(Debug, Clone, Default)]
pub struct PromptCallOptions {
    /// 系统提示词覆盖
    pub system_prompt_override: Option<String>,
    /// 工具集覆盖（空数组=禁用工具）
    pub tools_override: Option<Vec<String>>,
    /// 工具定义列表（阶段 1.3 新增，传递给 LLM 作为 `tools` 参数）
    ///
    /// 与 `tools_override` 的区别：
    /// - `tools_override`：工具名列表（用于服务端筛选）
    /// - `tools`：完整工具定义（含 JSON Schema），直接传给 LLM
    pub tools: Vec<crate::tool::ToolDefinition>,
    /// 温度
    pub temperature: Option<f32>,
    /// 最大 token
    pub max_tokens: Option<u32>,
    /// 思考级别
    pub thinking_level: Option<ThinkingLevel>,
    /// 图片附件
    pub images: Vec<ImageAttachment>,
}

/// 思考级别（对应 pi-ai 的 thinking 配置）
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ThinkingLevel {
    Off,
    Minimal,
    Low,
    Medium,
    High,
    Xhigh,
}

/// LLM 后端错误
#[derive(Debug, thiserror::Error)]
pub enum BackendError {
    #[error("网络错误: {0}")]
    Network(String),

    #[error("认证失败: {0}")]
    Auth(String),

    #[error("模型不存在: {0}")]
    ModelNotFound(String),

    #[error("速率限制")]
    RateLimit,

    #[error("响应解析失败: {0}")]
    Parse(String),

    #[error("调用被中止")]
    Aborted,

    #[error("不支持的操作: {0}")]
    Unsupported(String),

    #[error("其他错误: {0}")]
    Other(String),
}
