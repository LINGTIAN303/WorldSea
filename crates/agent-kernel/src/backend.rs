//! # LLM 后端访问器
//!
//! 对应 TS 版 `NodeBackendAccessor` 接口。
//! 节点通过此 trait 调用 LLM，与具体 LLM 实现解耦。
//!
//! 阶段 1.2 将提供基于 `genai` 的实现。

use std::sync::Arc;

use async_trait::async_trait;

use crate::event_bus::Listener;
use crate::llm::config::ProviderConfig;
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

    /// 旁路调用（一次性辅助任务：压缩摘要等）——**不触碰会话消息**
    ///
    /// 与 [`Self::prompt`] 的区别：prompt 会把输入推入内部会话消息、广播流式事件、
    /// 把响应写回内部历史；旁路调用**不产生任何会话副作用**，
    /// 由调用方提供完整请求材料（系统提示 + 历史快照 + 指令），响应只回传不落历史。
    ///
    /// 用途（阶段 3 · D4 压缩摘要）：以「与主对话同前缀的历史 + 尾部指令」做暖前缀复用，
    /// 调用结果（摘要文本）作为压缩回填材料，绝不进入对话流。
    ///
    /// 默认实现返回不支持（非 LLM 后端 / 测试替身可不实现，调用方应回退）。
    async fn prompt_side_call(
        &self,
        _system_prompt: Option<String>,
        _history: Vec<OrchestratorMessage>,
        _instruction: String,
        _options: PromptCallOptions,
    ) -> Result<PromptResponse, BackendError> {
        Err(BackendError::Other("旁路调用未实现".into()))
    }

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
    async fn subscribe_events(&self, _listener: Arc<dyn Listener>) {
        // 默认无操作
    }

    /// 获取当前模型 ID（用于 `AgentStart` 事件）
    ///
    /// 默认返回 `"unknown"`，由具体 backend 覆盖返回实际模型 ID。
    async fn current_model(&self) -> String {
        "unknown".to_string()
    }

    /// 热切换 Provider 配置（不清空消息历史），详细见 docs/details/注释/agent-runtime/backend.md
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

    /// 获取当前 Provider 配置（后端实现覆盖）
    ///
    /// 默认返回 `None`（后端不暴露配置），由支持配置回读的 backend（如
    /// `GenaiBackend`）覆盖，供 `get_provider_config` 命令回显真实配置。
    async fn current_provider_config(&self) -> Option<ProviderConfig> {
        None
    }

    /// 整体替换 Provider 配置（不清空消息历史）
    ///
    /// 与 [`update_provider`] 的区别：接收完整 [`ProviderConfig`]（含
    /// cloud/local/custom 三种模式与 api_type），可跨模式切换（包括
    /// 非 Local→Local 等 `update_provider` 无法表达的场景）。
    ///
    /// 默认返回 `BackendError::Unsupported`，由支持的目标 backend 覆盖。
    async fn set_provider_config(&self, _config: ProviderConfig) -> Result<(), BackendError> {
        Err(BackendError::Unsupported(
            "set_provider_config not supported by this backend".into(),
        ))
    }

    /// 注入备用 API Key 池（A2 多 Key 降级）
    ///
    /// 主 key 由 [`ProviderConfig`] 承载；`keys` 为备用 key 池，当主 key 请求
    /// 命中可重试错误（认证失败/限流/网络）时逐把降级重试。默认空实现（不启用）。
    async fn set_api_key_pool(&self, _keys: Vec<String>) -> Result<(), BackendError> {
        Ok(())
    }

    /// 读取备用 API Key 池（A2 多 Key 降级；供会话派生面复制配置——如分叉子会话继承）。
    /// 默认空（不支持的后端无池可言）。
    async fn api_key_pool(&self) -> Vec<String> {
        Vec::new()
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
    /// 推理文本（链式/深度推理模型的内部推理内容，可选；供持久化与前端渲染）
    pub reasoning: Option<String>,
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
            reasoning: None,
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
    /// 强制工具调用（2026-09-02 B 类迁移）：指定必须调用的工具名
    ///
    /// 对应 genai `ToolChoice::Tool{name}`（OpenAI tool_choice: {function} / Anthropic
    /// tool_choice 同语义）。用于「编排决策」形态的 LLM 调用——把"请输出 JSON"的决策
    /// 点改成强制调用一个决策工具，模型经 tool_call 返回结构化参数（structured
    /// output 的 tool-use-as-JSON 形态）。None 时维持 Auto（模型自行决定是否调用）。
    pub force_tool: Option<String>,
    /// 温度
    pub temperature: Option<f32>,
    /// 最大 token
    pub max_tokens: Option<u32>,
    /// 采样 Top P（None=用 Provider 默认）
    pub top_p: Option<f32>,
    /// 采样 Top K（None=用 Provider 默认）
    pub top_k: Option<u32>,
    /// 思考模式开关（true=请求模型推理，经 reasoning_effort 传导）
    pub thinking_mode: Option<bool>,
    /// 思考级别
    pub thinking_level: Option<ThinkingLevel>,
    /// 图片附件
    pub images: Vec<ImageAttachment>,
    /// 静默调用（R6 第四部分·路由口径统一）：true 时抑制流式事件广播
    /// （StreamStart/StreamDelta/ReasoningDelta/ToolCallStart/StreamEnd）——
    /// 用于「过程内决策」型 LLM 调用（如路由判型），决策 JSON 等中间产物
    /// 不再泄漏为对话流正文段；事件面改由 RouterDecisionMade 承载（router 动作段）。
    pub silent: bool,
    /// 调用用途标签（诊断 / 计费归类用；如 `"compaction"` 压缩摘要）
    ///
    /// 对齐 dsh `GenerateOptions.purpose`：不参与请求构造，只进日志与用量统计口径。
    pub purpose: Option<String>,
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
    Max,
}

/// LLM 后端错误
#[derive(Debug, thiserror::Error)]
pub enum BackendError {
    #[error("网络错误: {0}")]
    Network(String),

    #[error("认证失败: {0}")]
    Auth(String),

    #[error("Provider 未适配: {0}")]
    NoAdapter(String),

    #[error("未配置 API Key: {0}")]
    MissingCredential(String),

    #[error("API Key 无效或已过期: {0}")]
    InvalidCredential(String),

    #[error("配额或余额不足: {0}")]
    Quota(String),

    #[error("模型不存在: {0}")]
    ModelNotFound(String),

    #[error("速率限制")]
    RateLimit {
        /// 服务端 `Retry-After` 建议等待（毫秒；无该响应头为 `None`）——A5 后续
        retry_after_ms: Option<u64>,
    },

    #[error("上下文超出模型窗口: {0}")]
    ContextWindowExceeded(String),

    #[error("模型返回空响应（无文本且无工具调用）")]
    EmptyResponse,

    #[error("请求超时: {0}")]
    Timeout(String),

    #[error("服务端错误（HTTP {status}）: {message}")]
    ServerError {
        /// HTTP 状态码
        status: u16,
        /// 错误摘要
        message: String,
        /// 服务端 `Retry-After` 建议等待（毫秒；无该响应头为 `None`）——A5 后续
        retry_after_ms: Option<u64>,
    },

    #[error("响应解析失败: {0}")]
    Parse(String),

    #[error("调用被中止")]
    Aborted,

    #[error("不支持的操作: {0}")]
    Unsupported(String),

    #[error("其他错误: {0}")]
    Other(String),
}

/// LLM 错误稳定码（A5：分层路由按 code 判定，**不解析 message**）
///
/// 对齐 dsh 的错误 code 集；`IMAGE_OFFLOAD_REQUIRED` 不适用（本项目无图片外置
/// 路径）故未列。分类边界（`llm/error.rs` 的 genai 错误映射）负责把 provider
/// 的 HTTP 状态/错误载荷归一到本枚举，**下游所有路由只认 code**：
/// - 重试（同 key 退避）：[`BackendErrorCode::is_retryable`]
/// - 降级（多 Key 换 key）：[`BackendErrorCode::is_key_fallback_eligible`]
/// - 压缩触发：`ContextWindowExceeded`（provider 溢出 = 计量的地面真值信号）
/// - 用户提示：[`BackendErrorCode::user_hint`]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum BackendErrorCode {
    /// 无可用适配器（Provider/协议未适配）
    NoAdapter,
    /// 未配置凭证（API Key 缺失）
    MissingCredential,
    /// 凭证无效或过期（401/403）
    InvalidCredential,
    /// 通用认证失败（无法细分的认证语义）
    Auth,
    /// 速率限制（429）
    RateLimit,
    /// 配额/余额不足（402 或限流 + 配额语义）
    Quota,
    /// 上下文窗口超限（400 + 溢出语义）
    ContextWindowExceeded,
    /// 空响应（无文本且无工具调用）
    EmptyResponse,
    /// 网络错误（连接失败/中断）
    Network,
    /// 请求超时
    Timeout,
    /// 服务端错误（5xx）
    ServerError,
    /// 模型不存在
    ModelNotFound,
    /// 响应解析失败
    Parse,
    /// 不支持的操作
    Unsupported,
    /// 已中止
    Aborted,
    /// 其他（未分类）
    Other,
}

impl BackendErrorCode {
    /// 稳定字符串（日志/审计口径；大写蛇形）
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NoAdapter => "NO_ADAPTER",
            Self::MissingCredential => "MISSING_CREDENTIAL",
            Self::InvalidCredential => "INVALID_CREDENTIAL",
            Self::Auth => "AUTH",
            Self::RateLimit => "RATE_LIMIT",
            Self::Quota => "QUOTA",
            Self::ContextWindowExceeded => "CONTEXT_WINDOW_EXCEEDED",
            Self::EmptyResponse => "EMPTY_RESPONSE",
            Self::Network => "NETWORK",
            Self::Timeout => "TIMEOUT",
            Self::ServerError => "SERVER_ERROR",
            Self::ModelNotFound => "MODEL_NOT_FOUND",
            Self::Parse => "PARSE",
            Self::Unsupported => "UNSUPPORTED",
            Self::Aborted => "ABORTED",
            Self::Other => "OTHER",
        }
    }

    /// 是否可同 key 退避重试（瞬时性故障；`Other` 保守视为可重试，
    /// 保持「未分类错误不降低既有韧性」）
    pub fn is_retryable(self) -> bool {
        matches!(
            self,
            Self::Network | Self::Timeout | Self::RateLimit | Self::ServerError | Self::Other
        )
    }

    /// 是否可触发多 Key 降级（换池中下一把 key 重试）
    ///
    /// 认证/限流/配额/网络——`MissingCredential` 不在列（池中虽有备用 key，
    /// 但「主 key 未配置」属装配问题，交由用户提示）；`Timeout` 不在列
    /// （端点级问题，换 key 不改变链路）。
    pub fn is_key_fallback_eligible(self) -> bool {
        matches!(
            self,
            Self::Auth | Self::InvalidCredential | Self::RateLimit | Self::Quota | Self::Network
        )
    }

    /// 用户可行动提示（附加到终态错误消息；`None` = 无需额外引导）
    pub fn user_hint(self) -> Option<&'static str> {
        match self {
            Self::MissingCredential => Some("请在模型设置中填写该 Provider 的 API Key"),
            Self::InvalidCredential | Self::Auth => {
                Some("请检查 API Key 是否正确、是否已过期或无该模型权限")
            }
            Self::Quota => Some("请检查账户余额与配额，或更换 API Key"),
            Self::RateLimit => Some("请稍后重试，或在设置中补充备用 API Key 以自动降级"),
            Self::ContextWindowExceeded => {
                Some("自动压缩后仍超限：请缩减输入，或更换上下文窗口更大的模型")
            }
            Self::ModelNotFound => Some("请检查模型 ID，或在该 Provider 下重新选择模型"),
            Self::NoAdapter => Some("该 Provider 未适配，请在模型设置中更换 Provider"),
            Self::ServerError => Some("Provider 服务端异常，请稍后重试"),
            _ => None,
        }
    }
}

impl BackendError {
    /// 稳定错误码（A5：路由判据；穷尽映射，不解析 message）
    pub fn code(&self) -> BackendErrorCode {
        match self {
            Self::Network(_) => BackendErrorCode::Network,
            Self::Auth(_) => BackendErrorCode::Auth,
            Self::NoAdapter(_) => BackendErrorCode::NoAdapter,
            Self::MissingCredential(_) => BackendErrorCode::MissingCredential,
            Self::InvalidCredential(_) => BackendErrorCode::InvalidCredential,
            Self::Quota(_) => BackendErrorCode::Quota,
            Self::ModelNotFound(_) => BackendErrorCode::ModelNotFound,
            Self::RateLimit { .. } => BackendErrorCode::RateLimit,
            Self::ContextWindowExceeded(_) => BackendErrorCode::ContextWindowExceeded,
            Self::EmptyResponse => BackendErrorCode::EmptyResponse,
            Self::Timeout(_) => BackendErrorCode::Timeout,
            Self::ServerError { .. } => BackendErrorCode::ServerError,
            Self::Parse(_) => BackendErrorCode::Parse,
            Self::Aborted => BackendErrorCode::Aborted,
            Self::Unsupported(_) => BackendErrorCode::Unsupported,
            Self::Other(_) => BackendErrorCode::Other,
        }
    }

    /// 服务端建议等待时长（`Retry-After`；毫秒）——A5 后续
    ///
    /// 仅限流（429）与服务端错误（5xx）两类可重试码可能携带；重试循环据此与
    /// 指数退避取大（超上限截断，见 `agent/llm.rs` 的 `RETRY_AFTER_CAP_MS`）。
    pub fn retry_after_ms(&self) -> Option<u64> {
        match self {
            Self::RateLimit { retry_after_ms } | Self::ServerError { retry_after_ms, .. } => {
                *retry_after_ms
            }
            _ => None,
        }
    }
}

// ─── 测试 ───────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// 变体 → 稳定码映射（穷尽、稳定字符串口径）
    #[test]
    fn error_code_maps_each_variant() {
        let cases: Vec<(BackendError, BackendErrorCode, &str)> = vec![
            (BackendError::Network("x".into()), BackendErrorCode::Network, "NETWORK"),
            (BackendError::Auth("x".into()), BackendErrorCode::Auth, "AUTH"),
            (
                BackendError::NoAdapter("x".into()),
                BackendErrorCode::NoAdapter,
                "NO_ADAPTER",
            ),
            (
                BackendError::MissingCredential("x".into()),
                BackendErrorCode::MissingCredential,
                "MISSING_CREDENTIAL",
            ),
            (
                BackendError::InvalidCredential("x".into()),
                BackendErrorCode::InvalidCredential,
                "INVALID_CREDENTIAL",
            ),
            (BackendError::Quota("x".into()), BackendErrorCode::Quota, "QUOTA"),
            (
                BackendError::ModelNotFound("x".into()),
                BackendErrorCode::ModelNotFound,
                "MODEL_NOT_FOUND",
            ),
            (
                BackendError::RateLimit {
                    retry_after_ms: None,
                },
                BackendErrorCode::RateLimit,
                "RATE_LIMIT",
            ),
            (
                BackendError::ContextWindowExceeded("x".into()),
                BackendErrorCode::ContextWindowExceeded,
                "CONTEXT_WINDOW_EXCEEDED",
            ),
            (
                BackendError::EmptyResponse,
                BackendErrorCode::EmptyResponse,
                "EMPTY_RESPONSE",
            ),
            (BackendError::Timeout("x".into()), BackendErrorCode::Timeout, "TIMEOUT"),
            (
                BackendError::ServerError {
                    status: 503,
                    message: "x".into(),
                    retry_after_ms: None,
                },
                BackendErrorCode::ServerError,
                "SERVER_ERROR",
            ),
            (BackendError::Parse("x".into()), BackendErrorCode::Parse, "PARSE"),
            (BackendError::Aborted, BackendErrorCode::Aborted, "ABORTED"),
            (
                BackendError::Unsupported("x".into()),
                BackendErrorCode::Unsupported,
                "UNSUPPORTED",
            ),
            (BackendError::Other("x".into()), BackendErrorCode::Other, "OTHER"),
        ];
        for (err, code, s) in cases {
            assert_eq!(err.code(), code, "变体映射: {err:?}");
            assert_eq!(code.as_str(), s);
        }
    }

    /// 路由表：可重试 ∪ 可降级 的边界（A5 四路分流的判据）
    #[test]
    fn error_code_routing_tables() {
        assert!(BackendErrorCode::RateLimit.is_retryable());
        assert!(BackendErrorCode::Network.is_retryable());
        assert!(BackendErrorCode::Timeout.is_retryable());
        assert!(BackendErrorCode::ServerError.is_retryable());
        assert!(BackendErrorCode::Other.is_retryable(), "未分类错误保守可重试");
        assert!(!BackendErrorCode::InvalidCredential.is_retryable());
        assert!(!BackendErrorCode::MissingCredential.is_retryable());
        assert!(!BackendErrorCode::Quota.is_retryable());
        assert!(!BackendErrorCode::ContextWindowExceeded.is_retryable());
        assert!(!BackendErrorCode::Aborted.is_retryable());

        assert!(BackendErrorCode::InvalidCredential.is_key_fallback_eligible());
        assert!(BackendErrorCode::Auth.is_key_fallback_eligible());
        assert!(BackendErrorCode::RateLimit.is_key_fallback_eligible());
        assert!(BackendErrorCode::Quota.is_key_fallback_eligible());
        assert!(BackendErrorCode::Network.is_key_fallback_eligible());
        assert!(
            !BackendErrorCode::MissingCredential.is_key_fallback_eligible(),
            "主 key 未配置属装配问题，不换 key"
        );
        assert!(
            !BackendErrorCode::Timeout.is_key_fallback_eligible(),
            "超时属端点级问题，换 key 不改变链路"
        );

        assert!(BackendErrorCode::MissingCredential.user_hint().is_some());
        assert!(BackendErrorCode::Quota.user_hint().is_some());
        assert!(BackendErrorCode::Network.user_hint().is_none());
    }
}
