//! # GenaiBackend — 基于 genai 的 NodeBackendAccessor 实现
//!
//! 对应 TS 版 `pi-ai` 的核心调用逻辑（streamSimple + getModel）。
//! 将 [`ProviderConfig`] 转换为 genai 的 `ServiceTarget`，调用
//! `Client::exec_chat_stream` 获取流式响应，并通过事件广播器推送流事件。
//!
//! ## 关键映射
//! | TS 侧                | Rust 侧                              |
//! |----------------------|--------------------------------------|
//! | `streamSimple`       | `GenaiBackend::prompt`               |
//! | `getModel`           | [`crate::llm::stream::get_model`]    |
//! | `ProviderConfig`     | [`super::config::ProviderConfig`]    |
//! | `messages` 数组      | `Arc<RwLock<Vec<OrchestratorMessage>>>` |
//! | `StreamEvent` 回调   | `EventEmitter` trait                 |

use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use genai::chat::{
    ChatMessage, ChatOptions, ChatRequest, ChatStreamEvent, MessageContent, ToolCall, ToolResponse,
};
use genai::chat::{Tool as GenaiTool, ToolName};
use genai::adapter::AdapterKind;
use genai::resolver::{AuthData, Endpoint};
use genai::{Client, ModelIden, ServiceTarget};
use tokio::sync::RwLock;
use tracing::{debug, warn};

use crate::backend::{BackendError, NodeBackendAccessor, PromptCallOptions, PromptResponse};
use crate::event::{EventBroadcaster, EventListener, OrchestratorEvent};
use crate::llm::config::ProviderConfig;
use crate::llm::error::LlmError;
use crate::llm::manifest::find_manifest;
use crate::llm::model::ApiType;
use crate::types::{MessageRole, OrchestratorMessage};

/// GenaiBackend — 基于 genai crate 的 LLM 后端实现
///
/// 持有：
/// - `Client`：genai 客户端（可复用连接池）
/// - `ProviderConfig`：当前 Provider 配置（运行时可切换）
/// - `messages`：内部消息历史（线程安全）
/// - `steer_buffer`：steer 调用的缓冲区（下次 prompt 时附加为 user 消息）
/// - `event_broadcaster`：流事件广播器
pub struct GenaiBackend {
    /// genai 客户端
    client: Client,
    /// Provider 配置
    config: Arc<RwLock<ProviderConfig>>,
    /// 内部消息历史
    messages: Arc<RwLock<Vec<OrchestratorMessage>>>,
    /// steer 缓冲区
    steer_buffer: Arc<RwLock<Vec<String>>>,
    /// 事件广播器（可选，便于上层订阅流事件）
    event_broadcaster: Arc<RwLock<EventBroadcaster>>,
}

impl GenaiBackend {
    /// 创建新的 GenaiBackend
    ///
    /// # 参数
    /// - `config`：初始 Provider 配置
    pub fn new(config: ProviderConfig) -> Self {
        Self {
            client: Client::default(),
            config: Arc::new(RwLock::new(config)),
            messages: Arc::new(RwLock::new(Vec::new())),
            steer_buffer: Arc::new(RwLock::new(Vec::new())),
            event_broadcaster: Arc::new(RwLock::new(EventBroadcaster::new())),
        }
    }

    /// 创建带自定义 Client 的 GenaiBackend（用于测试或代理配置）
    pub fn with_client(client: Client, config: ProviderConfig) -> Self {
        Self {
            client,
            config: Arc::new(RwLock::new(config)),
            messages: Arc::new(RwLock::new(Vec::new())),
            steer_buffer: Arc::new(RwLock::new(Vec::new())),
            event_broadcaster: Arc::new(RwLock::new(EventBroadcaster::new())),
        }
    }

    /// 订阅事件广播
    pub async fn subscribe_events(&self, listener: Arc<dyn crate::event::EventListener>) {
        self.event_broadcaster.write().await.subscribe(listener);
    }

    /// 切换 Provider 配置（不清理消息历史）
    pub async fn switch_provider(&self, config: ProviderConfig) {
        *self.config.write().await = config;
    }

    /// 当前 Provider 配置快照
    pub async fn provider_config(&self) -> ProviderConfig {
        self.config.read().await.clone()
    }

    /// 将 ProviderConfig 解析为 genai 的 ServiceTarget
    ///
    /// 直接构造 [`ServiceTarget`]（endpoint / auth / model），绕过 genai 的
    /// adapter 推断逻辑。原因：genai 只内置了有限适配器（opneai / anthropic /
    /// ollama 等），Agnes 等未注册适配器在字符串解析（`{provider}::{model}`）
    /// 时会 fallback 到 Ollama，导致请求发错地址。
    ///
    /// 通过 `ServiceTarget::Target` 传入时，genai 直接使用我们指定的
    /// endpoint / auth / model，不再做 provider 推断。
    fn resolve_service_target(config: &ProviderConfig) -> Result<ServiceTarget, LlmError> {
        // 校验 manifest 存在（cloud 模式）
        if matches!(config, ProviderConfig::Cloud { .. }) {
            let provider = config.provider_id();
            if find_manifest(provider).is_none() {
                return Err(LlmError::ProviderNotFound(provider.to_string()));
            }
        }

        let base_url = config.resolve_base_url();
        let model_id = config.model_id().to_string();
        let api_key = config.api_key().to_string();

        // 由 API 协议推断 adapter kind：
        // - Anthropic Messages 协议 → Anthropic 适配器
        // - 其余（OpenAI 兼容 / Response / Google / 本地）→ OpenAI 适配器
        let adapter_kind = match config.infer_api_type() {
            ApiType::AnthropicMessages => AdapterKind::Anthropic,
            _ => AdapterKind::OpenAI,
        };

        // 规范化 base_url 以 `/` 结尾。
        //
        // 原因：genai 的 OpenAI 适配器用 `base_url.join("chat/completions")` 拼接 URL，
        // 而 `reqwest::Url::join` 在 base_url 无尾斜杠时会将末尾路径段当作文件名丢弃。
        // 例：`https://api.agnesai.com/v1` + `chat/completions` → `https://api.agnesai.com/chat/completions`
        // （丢失 `/v1`）。保证尾斜杠后拼接结果才正确。
        let endpoint = Endpoint::from_owned(Self::ensure_trailing_slash(base_url));
        let auth = AuthData::from_single(api_key);
        let model = ModelIden::new(adapter_kind, model_id);

        Ok(ServiceTarget { endpoint, auth, model })
    }

    /// 确保 base_url 以 `/` 结尾
    ///
    /// genai 的 OpenAI 适配器用 `Url::join` 拼接 service 路径，无尾斜杠时末尾路径段
    /// 会被当作文件名丢弃（见 [`Self::resolve_service_target`] 的说明）。
    fn ensure_trailing_slash(url: String) -> String {
        if url.ends_with('/') {
            url
        } else {
            format!("{url}/")
        }
    }

    /// 将 OrchestratorMessage 转换为 genai ChatMessage
    fn to_genai_message(msg: &OrchestratorMessage) -> Result<ChatMessage, LlmError> {
        match msg.role {
            MessageRole::System => Ok(ChatMessage::system(&msg.content)),
            MessageRole::User => Ok(ChatMessage::user(&msg.content)),
            MessageRole::Assistant => {
                // 如果含工具调用，应转为带 tool_calls 的 Assistant 消息
                // genai 0.7.0-beta.14 的 ChatMessage::assistant 接受 &str
                // 工具调用通过 ToolCall<ToolCalling> 处理，此处先简化为纯文本
                if !msg.tool_calls.is_empty() {
                    debug!(
                        "assistant 消息含 {} 个工具调用，当前实现仅取 content",
                        msg.tool_calls.len()
                    );
                }
                Ok(ChatMessage::assistant(&msg.content))
            }
            MessageRole::ToolResult => {
                // genai 0.7.0-beta.14 的 Tool 消息构造：
                //   ChatMessage::tool(content: impl Into<MessageContent>)
                //   MessageContent: From<ToolResponse>
                //   ToolResponse::new(call_id, content)
                let tool_call_id = msg.tool_call_id.clone().unwrap_or_default();
                let tool_resp = ToolResponse::new(tool_call_id, msg.content.clone());
                Ok(ChatMessage::tool(MessageContent::from(tool_resp)))
            }
        }
    }

    /// 将内部消息列表转换为 genai ChatRequest，并返回 (ChatRequest, ChatOptions)
    ///
    /// genai 0.7.0-beta.14 中 ChatOptions 不挂在 ChatRequest 上，
    /// 而是作为 `Client::exec_chat_stream` 的第三参数 `Option<&ChatOptions>` 传入。
    ///
    /// # 阶段 1.4：工具定义传给 LLM
    /// `PromptCallOptions.tools`（`Vec<crate::tool::ToolDefinition>`）转换为
    /// `Vec<genai::chat::Tool>`，通过 `ChatRequest::with_tools` 注入。
    /// 每次调用都重新构建，确保动态注册的工具（如 MCP 工具）能被 LLM 调用。
    fn build_chat_request(
        messages: &[OrchestratorMessage],
        options: &PromptCallOptions,
    ) -> Result<(ChatRequest, ChatOptions), LlmError> {
        let mut chat_messages: Vec<ChatMessage> = Vec::with_capacity(messages.len() + 1);

        // 系统提示词优先级：options.system_prompt_override > messages 中的 system
        if let Some(sys_override) = &options.system_prompt_override {
            chat_messages.push(ChatMessage::system(sys_override));
        }

        for msg in messages {
            // 若 options 提供了 system_override，跳过 messages 中的 system
            if matches!(msg.role, MessageRole::System) && options.system_prompt_override.is_some() {
                continue;
            }
            chat_messages.push(Self::to_genai_message(msg)?);
        }

        // ChatRequest::new(messages) 是 genai 0.7 的构造函数（无 with_messages）
        let req = ChatRequest::new(chat_messages);

        // 阶段 1.4：将工具定义转换为 genai Tool 并注入 ChatRequest
        //
        // - ToolDefinition.name → GenaiTool.name（ToolName::Custom）
        // - ToolDefinition.description → GenaiTool.description
        // - ToolDefinition.parameters → GenaiTool.schema（JSON Schema）
        //
        // 空工具列表时不调用 with_tools，保持 None（避免 LLM 误认为禁用工具）
        let req = if options.tools.is_empty() {
            req
        } else {
            let genai_tools: Vec<GenaiTool> = options
                .tools
                .iter()
                .map(|td| {
                    GenaiTool::new(ToolName::Custom(td.name.clone()))
                        .with_description(&td.description)
                        .with_schema(td.parameters.clone())
                })
                .collect();
            req.with_tools(genai_tools)
        };

        // 构建 ChatOptions（with_capture_* 是 builder 方法）
        let mut chat_opts = ChatOptions::default();
        if let Some(temp) = options.temperature {
            chat_opts = chat_opts.with_temperature(temp.into());
        }
        if let Some(max_tokens) = options.max_tokens {
            chat_opts = chat_opts.with_max_tokens(max_tokens as u32);
        }
        // 启用捕获（用于 StreamEnd 提取完整内容与用量）
        chat_opts = chat_opts
            .with_capture_content(true)
            .with_capture_usage(true);

        Ok((req, chat_opts))
    }

    /// 广播事件
    async fn broadcast(&self, event: OrchestratorEvent) {
        self.event_broadcaster.read().await.broadcast(&event);
    }
}

#[async_trait]
impl NodeBackendAccessor for GenaiBackend {
    async fn prompt(
        &self,
        prompt: String,
        options: Option<PromptCallOptions>,
    ) -> Result<PromptResponse, BackendError> {
        let opts = options.unwrap_or_default();
        let config = self.config.read().await.clone();

        // 1. 校验 API Key（cloud/custom 模式）
        if !matches!(config, ProviderConfig::Local { .. }) {
            let api_key = config.api_key();
            if api_key.is_empty() {
                return Err(BackendError::Auth(format!(
                    "API Key 缺失: provider={}",
                    config.provider_id()
                )));
            }
        }

        // 2. 推入 user 消息（含 steer 缓冲）
        {
            let mut messages = self.messages.write().await;
            // steer 缓冲作为前置 user 消息
            let steer_buf = self.steer_buffer.read().await.clone();
            for steer_text in steer_buf {
                messages.push(OrchestratorMessage {
                    role: MessageRole::User,
                    content: steer_text,
                    tool_calls: Vec::new(),
                    tool_call_id: None,
                    meta: None,
                });
            }
            // 清空 steer 缓冲
            self.steer_buffer.write().await.clear();
            // 推入本次 prompt
            messages.push(OrchestratorMessage {
                role: MessageRole::User,
                content: prompt.clone(),
                tool_calls: Vec::new(),
                tool_call_id: None,
                meta: None,
            });
        }

        // 3. 解析 ServiceTarget
        let service_target = Self::resolve_service_target(&config).map_err(BackendError::from)?;

        // 4. 构建 ChatRequest + ChatOptions
        let messages_snapshot = self.messages.read().await.clone();
        let (chat_req, chat_opts) =
            Self::build_chat_request(&messages_snapshot, &opts).map_err(BackendError::from)?;

        // 5. 广播 StreamStart
        self.broadcast(OrchestratorEvent::Agent(crate::event::AgentEvent::StreamStart {
            model: config.model_id().to_string(),
        }))
        .await;

        // 6. 执行流式调用，聚合 ToolCall 与文本
        let stream_result: Result<PromptResponse, BackendError> = async {
            use futures_util::StreamExt;

            // exec_chat_stream 签名：(&self, model, chat_req, Option<&ChatOptions>)
            // 返回 ChatStreamResponse { stream: ChatStream, model_iden: ModelIden }
            // 传入 ServiceTarget（ModelSpec::Target），直接绕过 adapter 推断。
            let stream_resp = self
                .client
                .exec_chat_stream(service_target, chat_req, Some(&chat_opts))
                .await
                .map_err(LlmError::from)?;

            let mut stream = stream_resp.stream;

            let mut full_text = String::new();
            let mut reasoning_text = String::new();

            // 工具调用聚合状态机：call_id -> ToolCall
            //
            // genai 0.7 的 ToolCallChunk 每次携带一个完整 ToolCall（非增量），
            // 但同一个 call_id 可能多次出现（不同字段分批到达），故用 HashMap 去重合并。
            // 与 stream.rs 的实现保持一致。
            let mut pending_tool_calls: HashMap<String, ToolCall> = HashMap::new();

            while let Some(event_result) = stream.next().await {
                let event = event_result.map_err(LlmError::from)?;
                match event {
                    ChatStreamEvent::Start => {
                        debug!("genai stream start");
                    }
                    ChatStreamEvent::Chunk(chunk) => {
                        // genai 0.7 StreamChunk.content 直接是 String
                        let text = chunk.content.as_str();
                        full_text.push_str(text);
                        // 广播 StreamDelta
                        let _ = self
                            .broadcast(OrchestratorEvent::Agent(
                                crate::event::AgentEvent::StreamDelta {
                                    delta: text.to_string(),
                                },
                            ))
                            .await;
                    }
                    ChatStreamEvent::ReasoningChunk(chunk) => {
                        reasoning_text.push_str(chunk.content.as_str());
                    }
                    ChatStreamEvent::ThoughtSignatureChunk(_) => {
                        // 暂不处理 thought signature
                    }
                    ChatStreamEvent::Heartbeat => {
                        // 握手心跳（genai >= 0.7.0-beta.16），忽略即可
                    }
                    ChatStreamEvent::ToolCallChunk(tool_chunk) => {
                        // genai 0.7 ToolChunk { tool_call: ToolCall }
                        // ToolCall 含 call_id / fn_name / fn_arguments / thought_signatures
                        // 每次到达的 ToolCall 通常是完整的（非增量），用 HashMap 合并去重
                        let tc = tool_chunk.tool_call;
                        let call_id = tc.call_id.clone();
                        // 广播 ToolCallStart（携带工具名，便于前端展示）
                        let _ = self
                            .broadcast(OrchestratorEvent::Agent(
                                crate::event::AgentEvent::ToolCallStart {
                                    tool_call_id: call_id.clone(),
                                    name: tc.fn_name.clone(),
                                    args: tc.fn_arguments.clone(),
                                },
                            ))
                            .await;
                        // 覆盖式更新（后到的 chunk 字段更完整）
                        pending_tool_calls.insert(call_id, tc);
                    }
                    ChatStreamEvent::End(end) => {
                        // 优先使用 StreamEnd 的 captured_tool_calls（权威），
                        // 回退到循环中累积的 pending_tool_calls。
                        let final_tool_calls: Vec<ToolCall> = end
                            .captured_tool_calls()
                            .map(|v| v.into_iter().cloned().collect())
                            .unwrap_or_else(|| pending_tool_calls.values().cloned().collect());

                        // 广播每个工具调用的 ToolCallEnd
                        for tc in &final_tool_calls {
                            let _ = self
                                .broadcast(OrchestratorEvent::Agent(
                                    crate::event::AgentEvent::ToolCallEnd {
                                        tool_call_id: tc.call_id.clone(),
                                        result: tc.fn_arguments.clone(),
                                    },
                                ))
                                .await;
                        }

                        // 先 clone 出 captured_usage / captured_stop_reason，
                        // 再调用 captured_into_first_text()（后者会消费 end）
                        let captured_usage = end.captured_usage.clone();
                        let captured_stop_reason = end.captured_stop_reason.clone();
                        if let Some(captured) = end.captured_into_first_text() {
                            if full_text.is_empty() {
                                full_text = captured;
                            }
                        }
                        debug!(
                            "genai stream end, stop_reason={:?}, usage={:?}, tool_calls={}",
                            captured_stop_reason,
                            captured_usage,
                            final_tool_calls.len()
                        );

                        // 将聚合的 ToolCall 转换为 types::ToolCall
                        // 注意：此处不能直接 return，因为还需要处理完 stream
                        // 将结果暂存到 pending_tool_calls（覆盖），稍后统一构造 PromptResponse
                        // 为避免借用问题，直接构造 PromptResponse 并 break
                        let aggregated: Vec<crate::types::ToolCall> = final_tool_calls
                            .iter()
                            .map(|tc| crate::types::ToolCall {
                                id: tc.call_id.clone(),
                                name: tc.fn_name.clone(),
                                args: tc.fn_arguments.clone(),
                            })
                            .collect();

                        let input_tokens = captured_usage
                            .as_ref()
                            .and_then(|u| u.prompt_tokens)
                            .map(|v| v as u32);
                        let output_tokens = captured_usage
                            .as_ref()
                            .and_then(|u| u.completion_tokens)
                            .map(|v| v as u32);
                        let stop_reason_str = captured_stop_reason.as_ref().map(|r| match r {
                            genai::chat::StopReason::Completed(_) => "end_turn",
                            genai::chat::StopReason::ToolCall(_) => "tool_calls",
                            genai::chat::StopReason::MaxTokens(_) => "max_tokens",
                            genai::chat::StopReason::StopSequence(_) => "stop_sequence",
                            genai::chat::StopReason::ContentFilter(_) => "content_filter",
                            genai::chat::StopReason::Other(_) => "other",
                        });

                        return Ok(PromptResponse {
                            text: full_text.clone(),
                            tool_calls: aggregated,
                            input_tokens,
                            output_tokens,
                            stop_reason: stop_reason_str.map(|s| s.to_string()),
                        });
                    }
                }
            }

            // 走到这里说明 stream 未触发 End 事件（异常情况）
            // 返回已收集的内容，但不包含工具调用
            debug!("genai stream 未触发 End 事件，返回部分内容");
            Ok(PromptResponse {
                text: full_text,
                tool_calls: Vec::new(),
                input_tokens: None,
                output_tokens: None,
                stop_reason: None,
            })
        }
        .await;

        // 7. 处理结果
        match stream_result {
            Ok(response) => {
                // 推入 assistant 消息（含 tool_calls，供下一轮 LLM 上下文使用）
                let mut messages = self.messages.write().await;
                messages.push(OrchestratorMessage {
                    role: MessageRole::Assistant,
                    content: response.text.clone(),
                    tool_calls: response.tool_calls.clone(),
                    tool_call_id: None,
                    meta: None,
                });

                // 广播 StreamEnd
                let _ = self
                    .broadcast(OrchestratorEvent::Agent(
                        crate::event::AgentEvent::StreamEnd {
                            full_text: response.text.clone(),
                        },
                    ))
                    .await;

                Ok(response)
            }
            Err(e) => {
                warn!("genai prompt 失败: {e}");
                // 广播 Error 事件
                let _ = self
                    .broadcast(OrchestratorEvent::Agent(crate::event::AgentEvent::Error {
                        message: e.to_string(),
                    }))
                    .await;
                Err(e)
            }
        }
    }

    async fn steer(&self, text: String) -> Result<(), BackendError> {
        self.steer_buffer.write().await.push(text);
        Ok(())
    }

    async fn get_messages(&self) -> Vec<OrchestratorMessage> {
        self.messages.read().await.clone()
    }

    async fn set_messages(&self, messages: Vec<OrchestratorMessage>) -> Result<(), BackendError> {
        *self.messages.write().await = messages;
        Ok(())
    }

    async fn trim_context(&self, up_to_index: usize) -> Result<(), BackendError> {
        let mut messages = self.messages.write().await;
        if up_to_index >= messages.len() {
            messages.clear();
        } else {
            messages.drain(0..up_to_index);
        }
        Ok(())
    }

    /// 订阅 backend 内部事件 — 将 listener 注入 `event_broadcaster`
    ///
    /// AgentLoop 在 `new` 时调用此方法，使订阅 AgentLoop 的监听器
    /// 能收到 backend 广播的 `StreamStart`/`StreamDelta`/`StreamEnd` 等事件。
    async fn subscribe_events(&self, listener: Arc<dyn EventListener>) {
        self.event_broadcaster.write().await.subscribe(listener);
    }

    /// 获取当前模型 ID — 用于 `AgentStart` 事件
    ///
    /// 返回 `ProviderConfig` 中的 `model_id`。
    async fn current_model(&self) -> String {
        self.config.read().await.model_id().to_string()
    }

    /// 热切换 Provider 配置（不清空消息历史）
    ///
    /// 重建 `ProviderConfig` 并替换内部 config，保留 messages 和 steer_buffer。
    /// 对应前端 `IAgentBackend.updateModel` 接口。
    ///
    /// # 模式切换规则
    /// - `Cloud` → `Cloud`：更新 provider/model_id/api_key
    /// - `Cloud` → `Custom`：传入 `base_url` 时降级为 Custom（OpenAI 兼容协议）
    /// - `Custom` → `Custom`：保留旧 `api_type`/`context_window`/`max_tokens`
    /// - `Local` → 不支持：返回 `Unsupported` 错误（需重建 backend）
    async fn update_provider(
        &self,
        provider: String,
        model_id: String,
        api_key: Option<String>,
        base_url: Option<String>,
    ) -> Result<(), BackendError> {
        let old_config = self.config.read().await.clone();

        // 构建新 config：保留旧 api_key（若未传入），按 base_url 是否存在选择 Cloud/Custom
        let new_config = match &old_config {
            ProviderConfig::Local { .. } => {
                // 本地模式不支持热切换到 cloud（需重新创建 backend）
                return Err(BackendError::Unsupported(
                    "Local provider 不支持 update_provider，请重建 backend".into(),
                ));
            }
            ProviderConfig::Cloud {
                api_key: old_key, ..
            } => {
                let final_key = api_key.unwrap_or_else(|| old_key.clone());
                if final_key.is_empty() {
                    return Err(BackendError::Auth(format!(
                        "API Key 缺失: provider={}",
                        provider
                    )));
                }
                // base_url 存在时降级为 Custom 模式（按 provider 推断 api_type）
                if let Some(url) = base_url {
                    // 简化策略：默认 OpenAI 兼容协议（Anthropic 兼容由前端显式选择时重建 backend）
                    let api_type = crate::llm::config::CustomApiType::OpenaiCompatible;
                    ProviderConfig::Custom {
                        base_url: url,
                        api_key: final_key,
                        api_type,
                        model_id: model_id.clone(),
                        context_window: 1_048_576,
                        max_tokens: 65_536,
                    }
                } else {
                    ProviderConfig::Cloud {
                        provider: provider.clone(),
                        model_id: model_id.clone(),
                        api_key: final_key,
                    }
                }
            }
            ProviderConfig::Custom {
                api_key: old_key,
                base_url: old_url,
                api_type: old_api_type,
                context_window: old_cw,
                max_tokens: old_mt,
                ..
            } => {
                let final_key = api_key.unwrap_or_else(|| old_key.clone());
                let final_url = base_url.unwrap_or_else(|| old_url.clone());
                // 保留旧 api_type/context_window/max_tokens
                ProviderConfig::Custom {
                    base_url: final_url,
                    api_key: final_key,
                    api_type: *old_api_type,
                    model_id: model_id.clone(),
                    context_window: *old_cw,
                    max_tokens: *old_mt,
                }
            }
        };

        // 校验 manifest（cloud 模式）
        if matches!(new_config, ProviderConfig::Cloud { .. }) {
            if find_manifest(&provider).is_none() {
                return Err(BackendError::ModelNotFound(format!(
                    "Provider 不存在: {}",
                    provider
                )));
            }
        }

        *self.config.write().await = new_config;
        debug!(
            "GenaiBackend update_provider: 已切换至 provider={}, model={}",
            provider, model_id
        );
        Ok(())
    }

    /// 获取当前 Provider 配置快照（供 `get_provider_config` 回显）
    async fn current_provider_config(&self) -> Option<ProviderConfig> {
        Some(self.config.read().await.clone())
    }

    /// 整体替换 Provider 配置（支持跨模式切换，不清空消息历史）
    async fn set_provider_config(&self, config: ProviderConfig) -> Result<(), BackendError> {
        *self.config.write().await = config;
        Ok(())
    }
}

// ─── genai 类型适配辅助 ────────────────────────────────────
// 注：genai 0.7.0-beta.14 的 StreamChunk.content 直接是 String，
// 无需额外的 content_text trait。直接通过 chunk.content.as_str() 访问。

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::config::ProviderConfig;

    #[test]
    fn resolve_service_target_cloud() {
        let config = ProviderConfig::Cloud {
            provider: "deepseek".to_string(),
            model_id: "deepseek-v4-flash".to_string(),
            api_key: "sk-test".to_string(),
        };
        let target = GenaiBackend::resolve_service_target(&config).unwrap();
        // ServiceTarget 直接指定 endpoint / auth / model，绕过 adapter 推断
        assert_eq!(target.endpoint.base_url(), "https://api.deepseek.com/");
        assert_eq!(target.model.model_name, "deepseek-v4-flash");
        assert_eq!(target.model.adapter_kind, AdapterKind::OpenAI);
    }

    #[test]
    fn resolve_service_target_agnes_uses_openai_adapter() {
        // Agnes 未注册 genai adapter，此前会 fallback 到 Ollama；
        // 现在直接构造 ServiceTarget 绕过推断，端点指向 Agnes 的 /v1 base。
        let config = ProviderConfig::Cloud {
            provider: "agnes".to_string(),
            model_id: "agnes-2.0-flash".to_string(),
            api_key: "sk-agnes-test".to_string(),
        };
        let target = GenaiBackend::resolve_service_target(&config).unwrap();
        assert_eq!(target.endpoint.base_url(), "https://api.agnesai.com/v1/");
        assert_eq!(target.model.model_name, "agnes-2.0-flash");
        assert_eq!(target.model.adapter_kind, AdapterKind::OpenAI);
    }

    #[test]
    fn resolve_service_target_anthropic_uses_anthropic_adapter() {
        let config = ProviderConfig::Cloud {
            provider: "anthropic".to_string(),
            model_id: "claude-sonnet-4-6".to_string(),
            api_key: "sk-ant-test".to_string(),
        };
        let target = GenaiBackend::resolve_service_target(&config).unwrap();
        assert_eq!(target.model.adapter_kind, AdapterKind::Anthropic);
    }

    #[test]
    fn resolve_service_target_unknown_provider_fails() {
        let config = ProviderConfig::Cloud {
            provider: "unknown-provider".to_string(),
            model_id: "model-x".to_string(),
            api_key: "sk-test".to_string(),
        };
        let result = GenaiBackend::resolve_service_target(&config);
        assert!(result.is_err());
        match result {
            Err(LlmError::ProviderNotFound(_)) => {}
            _ => panic!("应为 ProviderNotFound 错误"),
        }
    }

    #[test]
    fn resolve_service_target_local() {
        let config = ProviderConfig::Local {
            endpoint: "http://localhost:11434".to_string(),
            api_type: crate::llm::config::LocalApiType::Ollama,
            model_id: "llama3".to_string(),
        };
        let target = GenaiBackend::resolve_service_target(&config).unwrap();
        assert_eq!(target.endpoint.base_url(), "http://localhost:11434/");
        assert_eq!(target.model.model_name, "llama3");
        assert_eq!(target.model.adapter_kind, AdapterKind::OpenAI);
    }

    #[test]
    fn resolve_service_target_custom() {
        let config = ProviderConfig::Custom {
            base_url: "https://api.example.com/v1".to_string(),
            api_key: "sk-test".to_string(),
            api_type: crate::llm::config::CustomApiType::OpenaiCompatible,
            model_id: "custom-model".to_string(),
            context_window: 128_000,
            max_tokens: 4_096,
        };
        let target = GenaiBackend::resolve_service_target(&config).unwrap();
        assert_eq!(target.endpoint.base_url(), "https://api.example.com/v1/");
        assert_eq!(target.model.model_name, "custom-model");
        assert_eq!(target.model.adapter_kind, AdapterKind::OpenAI);
    }

    #[test]
    fn to_genai_message_user() {
        let msg = OrchestratorMessage {
            role: MessageRole::User,
            content: "hello".to_string(),
            tool_calls: Vec::new(),
            tool_call_id: None,
            meta: None,
        };
        // 仅验证转换成功（genai 0.7.0-beta.14 的 ChatMessage 无公开 role 字段）
        let _result = GenaiBackend::to_genai_message(&msg).expect("user 消息应转换成功");
    }

    #[test]
    fn to_genai_message_system() {
        let msg = OrchestratorMessage {
            role: MessageRole::System,
            content: "You are a helpful assistant".to_string(),
            tool_calls: Vec::new(),
            tool_call_id: None,
            meta: None,
        };
        let _result = GenaiBackend::to_genai_message(&msg).expect("system 消息应转换成功");
    }

    #[tokio::test]
    async fn genai_backend_new_initializes_empty_state() {
        let config = ProviderConfig::Cloud {
            provider: "deepseek".to_string(),
            model_id: "deepseek-v4-flash".to_string(),
            api_key: "sk-test".to_string(),
        };
        let backend = GenaiBackend::new(config);
        let messages = backend.get_messages().await;
        assert!(messages.is_empty());
    }

    #[tokio::test]
    async fn genai_backend_steer_appends_to_buffer() {
        let config = ProviderConfig::Cloud {
            provider: "deepseek".to_string(),
            model_id: "deepseek-v4-flash".to_string(),
            api_key: "sk-test".to_string(),
        };
        let backend = GenaiBackend::new(config);
        backend.steer("附加指令1".to_string()).await.unwrap();
        backend.steer("附加指令2".to_string()).await.unwrap();
        let buffer = backend.steer_buffer.read().await;
        assert_eq!(buffer.len(), 2);
        assert_eq!(buffer[0], "附加指令1");
    }

    #[tokio::test]
    async fn genai_backend_set_get_messages_roundtrip() {
        let config = ProviderConfig::Local {
            endpoint: "http://localhost:11434".to_string(),
            api_type: crate::llm::config::LocalApiType::Ollama,
            model_id: "llama3".to_string(),
        };
        let backend = GenaiBackend::new(config);

        let messages = vec![
            OrchestratorMessage {
                role: MessageRole::User,
                content: "hello".to_string(),
                tool_calls: Vec::new(),
                tool_call_id: None,
                meta: None,
            },
            OrchestratorMessage {
                role: MessageRole::Assistant,
                content: "Hi there".to_string(),
                tool_calls: Vec::new(),
                tool_call_id: None,
                meta: None,
            },
        ];

        backend.set_messages(messages.clone()).await.unwrap();
        let retrieved = backend.get_messages().await;
        assert_eq!(retrieved.len(), 2);
        assert_eq!(retrieved[0].content, "hello");
        assert_eq!(retrieved[1].content, "Hi there");
    }

    #[tokio::test]
    async fn genai_backend_trim_context_removes_first_n() {
        let config = ProviderConfig::Local {
            endpoint: "http://localhost:11434".to_string(),
            api_type: crate::llm::config::LocalApiType::Ollama,
            model_id: "llama3".to_string(),
        };
        let backend = GenaiBackend::new(config);

        let messages = vec![
            OrchestratorMessage {
                role: MessageRole::User,
                content: "msg1".to_string(),
                tool_calls: Vec::new(),
                tool_call_id: None,
                meta: None,
            },
            OrchestratorMessage {
                role: MessageRole::Assistant,
                content: "msg2".to_string(),
                tool_calls: Vec::new(),
                tool_call_id: None,
                meta: None,
            },
            OrchestratorMessage {
                role: MessageRole::User,
                content: "msg3".to_string(),
                tool_calls: Vec::new(),
                tool_call_id: None,
                meta: None,
            },
        ];
        backend.set_messages(messages).await.unwrap();
        backend.trim_context(2).await.unwrap();

        let remaining = backend.get_messages().await;
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].content, "msg3");
    }

    #[tokio::test]
    async fn genai_backend_switch_provider_preserves_messages() {
        let config1 = ProviderConfig::Cloud {
            provider: "deepseek".to_string(),
            model_id: "deepseek-v4-flash".to_string(),
            api_key: "sk-test1".to_string(),
        };
        let backend = GenaiBackend::new(config1);

        // 设置消息
        backend
            .set_messages(vec![OrchestratorMessage {
                role: MessageRole::User,
                content: "persist".to_string(),
                tool_calls: Vec::new(),
                tool_call_id: None,
                meta: None,
            }])
            .await
            .unwrap();

        // 切换 Provider
        let config2 = ProviderConfig::Cloud {
            provider: "openai".to_string(),
            model_id: "gpt-5.4".to_string(),
            api_key: "sk-test2".to_string(),
        };
        backend.switch_provider(config2).await;

        // 消息应保留
        let messages = backend.get_messages().await;
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].content, "persist");

        // Provider 应已切换
        let current_config = backend.provider_config().await;
        assert_eq!(current_config.provider_id(), "openai");
    }

    #[tokio::test]
    async fn genai_backend_prompt_without_api_key_fails() {
        let config = ProviderConfig::Cloud {
            provider: "deepseek".to_string(),
            model_id: "deepseek-v4-flash".to_string(),
            api_key: "".to_string(), // 空 API Key
        };
        let backend = GenaiBackend::new(config);

        let result = backend.prompt("hello".to_string(), None).await;
        assert!(result.is_err());
        match result {
            Err(BackendError::Auth(_)) => {}
            _ => panic!("应为 Auth 错误"),
        }
    }
}
