//! GenaiBackend — 基于 genai 的 NodeBackendAccessor 实现，详细见 docs/details/注释/agent-runtime/llm.md

use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use genai::chat::{
    ChatMessage, ChatOptions, ChatRequest, ChatStreamEvent, ContentPart, MessageContent, ToolCall,
    ToolResponse,
};
use genai::chat::{Tool as GenaiTool, ToolChoice, ToolName, ReasoningEffort};
use genai::adapter::AdapterKind;
use genai::resolver::{AuthData, Endpoint};
use genai::{Client, ModelIden, ServiceTarget};
use tokio::sync::RwLock;
use tracing::debug;

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
    /// 备用 API Key 池（A2 多 Key 降级）；主 key 在 config 中，池为空则无降级
    key_pool: Arc<RwLock<Vec<String>>>,
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
            key_pool: Arc::new(RwLock::new(Vec::new())),
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
            key_pool: Arc::new(RwLock::new(Vec::new())),
            messages: Arc::new(RwLock::new(Vec::new())),
            steer_buffer: Arc::new(RwLock::new(Vec::new())),
            event_broadcaster: Arc::new(RwLock::new(EventBroadcaster::new())),
        }
    }

    /// 注入备用 API Key 池（A2）
    pub async fn set_key_pool(&self, keys: Vec<String>) {
        *self.key_pool.write().await = keys;
    }

    /// 读取备用 API Key 池（去重，排除与主 key 重复的项）
    async fn backup_keys(&self, primary: &str) -> Vec<String> {
        let pool = self.key_pool.read().await.clone();
        pool.into_iter()
            .filter(|k| !k.is_empty() && k != primary)
            .collect()
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
                // 若含工具调用，必须将 tool_calls 一并转成 genai 格式随消息发送。
                // 原因：DeepSeek/OpenAI 校验要求 tool 消息必须紧跟一条带 `tool_calls`
                // 的 assistant 消息，否则报 "Messages with role 'tool' must be a response
                // to a preceding message with 'tool_calls'"。此前仅取 content 丢弃了
                // tool_calls，导致工具结果回填后第二轮请求被拒（实测复现）。
                if !msg.tool_calls.is_empty() {
                    let mut parts: Vec<ContentPart> = Vec::new();
                    if !msg.content.is_empty() {
                        parts.push(ContentPart::Text(msg.content.clone()));
                    }
                    parts.extend(msg.tool_calls.iter().map(|tc| {
                        ContentPart::ToolCall(ToolCall {
                            call_id: tc.id.clone(),
                            fn_name: tc.name.clone(),
                            fn_arguments: tc.args.clone(),
                            thought_signatures: None,
                        })
                    }));
                    Ok(ChatMessage::assistant(MessageContent::from_parts(parts)))
                } else {
                    Ok(ChatMessage::assistant(&msg.content))
                }
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
            // 显式设置 tool_choice（存在工具时）：否则部分 provider（如 DeepSeek）
            // 在未收到 tool_choice 字段时可能不触发工具调用（实测复现）。
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
        // 采样 Top P（真实传导到模型请求）
        if let Some(top_p) = options.top_p {
            chat_opts = chat_opts.with_top_p(top_p as f64);
        }
        // 采样 Top K（genai 无原生项，经 extra_body 通用注入）
        if let Some(top_k) = options.top_k {
            let mut extra = chat_opts
                .extra_body
                .clone()
                .unwrap_or_else(|| serde_json::json!({}));
            extra["top_k"] = serde_json::json!(top_k);
            chat_opts.extra_body = Some(extra);
        }
        // 思考模式（true=向模型请求推理，经 reasoning_effort 传导，受厂商支持）
        if options.thinking_mode == Some(true) {
            chat_opts = chat_opts.with_reasoning_effort(ReasoningEffort::Medium);
        }
        // 存在工具时显式设置 tool_choice = auto（部分 provider 未收到该字段不触发工具调用）
        if !options.tools.is_empty() {
            chat_opts = chat_opts.with_tool_choice(ToolChoice::Auto);
        }
        // 启用捕获（用于 StreamEnd 提取完整内容与用量，以及原始请求体诊断）
        //
        // 关键：必须开启 capture_tool_calls。否则 genai 的 OpenAI streamer 在
        // capture_tool_call 开头直接 return（不累积参数），DeepSeek 流式把工具
        // 参数拆成多片（后续 chunk 的 id 缺失会退化为 "call_{index}"），导致
        // 下游按 call_id 去重时把碎片当成多个工具调用（args 为空/半截）。
        // 开启后 genai 会按 index 累积参数到同一 ToolCall，并在 StreamEnd 时
        // 将累积的字符串解析为完整 JSON，`end.captured_tool_calls()` 返回权威结果。
        chat_opts = chat_opts
            .with_capture_content(true)
            .with_capture_usage(true)
            .with_capture_raw_body(true)
            .with_capture_tool_calls(true);

        Ok((req, chat_opts))
    }

    /// 广播事件
    async fn broadcast(&self, event: OrchestratorEvent) {
        self.event_broadcaster.read().await.broadcast(&event);
    }

    /// 用指定 ServiceTarget 执行一次流式调用并聚合结果（A2 多 Key 降级的单次尝试）
    async fn exec_stream_once(
        &self,
        service_target: ServiceTarget,
        chat_req: genai::chat::ChatRequest,
        chat_opts: &genai::chat::ChatOptions,
    ) -> Result<PromptResponse, BackendError> {
        use futures_util::StreamExt;

        let stream_resp = self
            .client
            .exec_chat_stream(service_target, chat_req, Some(chat_opts))
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
                    // [链逐条] 广播推理增量，供前端逐条追加到助理消息 thinking 字段实时渲染
                    let reasoning = chunk.content.as_str();
                    let _ = self
                        .broadcast(OrchestratorEvent::Agent(
                            crate::event::AgentEvent::ReasoningDelta {
                                delta: reasoning.to_string(),
                            },
                        ))
                        .await;
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

    /// 处理一次成功响应：推入 assistant 消息并广播 StreamEnd（A2 降级成功后的收尾）
    async fn finish_prompt(&self, response: PromptResponse) -> Result<PromptResponse, BackendError> {
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

        // 3. 收集候选 key（主 key + 备用 key 池）
        let primary_key = config.api_key().to_string();
        let mut candidate_keys: Vec<String> = vec![primary_key.clone()];
        if !matches!(config, ProviderConfig::Local { .. }) {
            candidate_keys.extend(self.backup_keys(&primary_key).await);
        }

        // 4-6. 逐 key 尝试执行（A2 多 Key 降级）：
        // 主 key 请求命中可重试错误（认证/限流/网络）时，换池中下一把 key 重试。
        let messages_snapshot = self.messages.read().await.clone();
        let (chat_req, chat_opts) =
            Self::build_chat_request(&messages_snapshot, &opts).map_err(BackendError::from)?;

        let mut last_error: Option<BackendError> = None;
        for key in &candidate_keys {
            let mut attempt_config = config.clone();
            if !matches!(config, ProviderConfig::Local { .. }) {
                attempt_config = set_config_api_key(&config, key);
            }
            let service_target =
                Self::resolve_service_target(&attempt_config).map_err(BackendError::from)?;
            self.broadcast(OrchestratorEvent::Agent(crate::event::AgentEvent::StreamStart {
                model: attempt_config.model_id().to_string(),
            }))
            .await;
            let stream_result = self
                .exec_stream_once(service_target, chat_req.clone(), &chat_opts)
                .await;
            match stream_result {
                Ok(resp) => return self.finish_prompt(resp).await,
                Err(e) => {
                    if is_retryable_error(&e) && last_error.is_none() {
                        last_error = Some(e);
                        continue;
                    }
                    return Err(e);
                }
            }
        }
        // 所有候选 key 均失败
        Err(last_error.unwrap_or_else(|| BackendError::Other("无可用 API Key".into())))
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

    /// 热切换 Provider 配置（不清空消息历史），详细见 docs/details/注释/agent-runtime/llm.md
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

    /// 注入备用 API Key 池（A2 多 Key 降级）
    async fn set_api_key_pool(&self, keys: Vec<String>) -> Result<(), BackendError> {
        self.set_key_pool(keys).await;
        Ok(())
    }
}

// ─── genai 类型适配辅助 ────────────────────────────────────
// 注：genai 0.7.0-beta.14 的 StreamChunk.content 直接是 String，
// 无需额外的 content_text trait。直接通过 chunk.content.as_str() 访问。

// ─── A2 多 Key 降级辅助 ────────────────────────────────────

/// 用备用 key 替换 ProviderConfig 中的 api_key（返回新副本，不改原 config）
fn set_config_api_key(config: &ProviderConfig, key: &str) -> ProviderConfig {
    match config {
        ProviderConfig::Cloud {
            provider,
            model_id,
            api_key: _,
        } => ProviderConfig::Cloud {
            provider: provider.clone(),
            model_id: model_id.clone(),
            api_key: key.to_string(),
        },
        ProviderConfig::Local {
            endpoint,
            api_type,
            model_id,
        } => ProviderConfig::Local {
            endpoint: endpoint.clone(),
            api_type: *api_type,
            model_id: model_id.clone(),
        },
        ProviderConfig::Custom {
            base_url,
            api_key: _,
            api_type,
            model_id,
            context_window,
            max_tokens,
        } => ProviderConfig::Custom {
            base_url: base_url.clone(),
            api_key: key.to_string(),
            api_type: *api_type,
            model_id: model_id.clone(),
            context_window: *context_window,
            max_tokens: *max_tokens,
        },
    }
}

/// 判断某个错误是否可触发 key 降级重试（认证失败/限流/网络）
fn is_retryable_error(e: &BackendError) -> bool {
    matches!(
        e,
        BackendError::Auth(_)
            | BackendError::RateLimit
            | BackendError::Network(_)
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::config::{LocalApiType, ProviderConfig};

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

    // ─── A2 多 Key 降级 ───

    #[test]
    fn set_config_api_key_replaces_cloud_key() {
        let config = ProviderConfig::Cloud {
            provider: "deepseek".to_string(),
            model_id: "deepseek-v4-flash".to_string(),
            api_key: "sk-primary".to_string(),
        };
        let swapped = set_config_api_key(&config, "sk-backup");
        assert_eq!(swapped.api_key(), "sk-backup");
        assert_eq!(swapped.model_id(), "deepseek-v4-flash");
        // 原 config 不被修改
        assert_eq!(config.api_key(), "sk-primary");
    }

    #[test]
    fn set_config_api_key_preserves_local() {
        let config = ProviderConfig::Local {
            endpoint: "http://localhost:11434".to_string(),
            api_type: LocalApiType::Ollama,
            model_id: "llama3".to_string(),
        };
        let swapped = set_config_api_key(&config, "sk-ignored");
        assert_eq!(swapped.api_key(), "");
        assert_eq!(swapped.model_id(), "llama3");
    }

    #[test]
    fn is_retryable_error_classifies_network_and_auth() {
        assert!(is_retryable_error(&BackendError::Network("timeout".into())));
        assert!(is_retryable_error(&BackendError::Auth("401".into())));
        assert!(is_retryable_error(&BackendError::RateLimit));
        assert!(!is_retryable_error(&BackendError::ModelNotFound("x".into())));
        assert!(!is_retryable_error(&BackendError::Other("boom".into())));
    }

    #[tokio::test]
    async fn backup_keys_excludes_primary_and_empty() {
        let backend = GenaiBackend::new(ProviderConfig::Cloud {
            provider: "deepseek".to_string(),
            model_id: "deepseek-v4-flash".to_string(),
            api_key: "sk-primary".to_string(),
        });
        backend.set_key_pool(vec![
            "sk-backup1".to_string(),
            "sk-primary".to_string(), // 与主 key 重复，应排除
            "".to_string(),           // 空 key，应排除
            "sk-backup2".to_string(),
        ]).await;
        let backups = backend.backup_keys("sk-primary").await;
        assert_eq!(backups, vec!["sk-backup1".to_string(), "sk-backup2".to_string()]);
    }
}
