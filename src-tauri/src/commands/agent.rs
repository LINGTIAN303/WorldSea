//! # Agent 命令层 — Tauri 命令封装
//!
//! 阶段 1.5 新增。本模块把 `agent_runtime::AgentLoop` 的能力通过 Tauri 命令暴露给前端。
//!
//! ## 命令一览
//! | 命令 | 对应 IAgentBackend 方法 | 说明 |
//! |------|------------------------|------|
//! | `cmd_agent_create`              | （构造函数）           | 创建 AgentLoop 实例并注册 |
//! | `cmd_agent_prompt`              | `prompt(text, options)` | 启动 ReAct 循环，返回最终文本 |
//! | `cmd_agent_steer`               | `steer(text)`           | 中途引导 |
//! | `cmd_agent_follow_up`           | `followUp(text)`        | 跟进提问（保留历史） |
//! | `cmd_agent_abort`               | `abort()`               | 中断当前运行 |
//! | `cmd_agent_destroy`             | `dispose()`             | 销毁实例 |
//! | `cmd_agent_clear_history`       | `clearHistory()`        | 清空对话历史 |
//! | `cmd_agent_update_model`        | `updateModel(...)`      | 热切换模型 |
//! | `cmd_agent_update_thinking_level` | `updateThinkingLevel(level)` | 更新思考级别 |
//! | `cmd_agent_trim_context`        | `trimContext(upToIndex)` | 清理上下文窗口 |
//! | `cmd_agent_get_state_snapshot`  | `state` (getter)        | 获取状态快照 |
//! | `cmd_agent_get_runtime_messages`  | `getRuntimeMessages()`  | 获取内部 messages |
//! | `cmd_agent_set_runtime_messages`  | `setRuntimeMessages(messages)` | 写回内部 messages |
//!
//! ## 事件流
//! 事件通过 `app.emit("agent:event:{session_id}", AgentEventPayload)` 推送，
//! 前端通过 `listen("agent:event:" + sessionId, handler)` 监听。
//!
//! 每条事件携带 `messageId`（用于 `StreamDelta`/`StreamEnd` 关联），
//! 由 `cmd_agent_prompt` 在调用前轮换生成，存入 `AgentEntry.current_message_id`。
//!
//! ## 设计要点
//! - **多实例**：每个 `session_id` 对应独立 `AgentLoop`，通过 `AgentRegistry` 管理
//! - **事件桥接**：`TauriEventListener` 实现 `EventListener`，把 `OrchestratorEvent` 转为
//!   `AgentEventPayload` 后 emit 到前端
//! - **不阻塞 Tauri 命令**：所有命令都是 `async fn`，由 Tauri 自动调度到异步运行时
//! - **错误友好**：`AgentRegistryError` 实现 `Serialize`，前端能拿到结构化错误

use std::sync::Arc;
use std::time::Duration;

use agent_runtime::backend::ThinkingLevel;
use agent_runtime::event::{EventListener, OrchestratorEvent};
use agent_runtime::llm::config::ProviderConfig;
use agent_runtime::llm::GenaiBackend;
use agent_runtime::tool::SimpleToolBus;
use agent_runtime::{AgentLoop, AgentLoopConfig, OrchestratorMessage};
use tauri::{AppHandle, Emitter, State};
use tracing::{debug, info, warn};

use crate::agent_bridge::payload::AgentEventPayload;
use crate::agent_bridge::registry::{AgentRegistryError, SharedMessageId};
use crate::agent_bridge::tool_bridge::{FrontendToolBridge, ToolCallResult};
use crate::state::AppState;

// ─── 事件名约定 ────────────────────────────────────────────

/// 单 Agent 会话事件名前缀
///
/// 完整事件名：`agent:event:{session_id}`
/// 前端：`listen(\`agent:event:${sessionId}\`, ...)`
const fn event_name_prefix() -> &'static str {
    "agent:event:"
}

/// 构造单个 session 的事件名
fn session_event_name(session_id: &str) -> String {
    format!("{}{}", event_name_prefix(), session_id)
}

// ─── TauriEventListener ────────────────────────────────────────────

/// 把 `OrchestratorEvent` 转为 `AgentEventPayload` 并通过 `app.emit` 推送到前端
///
/// 每个 `AgentLoop` 实例对应一个 `TauriEventListener`，在 `cmd_agent_create` 时
/// 通过 `agent.subscribe(Arc::new(...))` 注入。
///
/// # 设计
/// - `app: AppHandle`：可克隆，跨任务安全
/// - `session_id: String`：用于事件名和 payload 中的 sessionId 字段
/// - `message_id: SharedMessageId`：与 `AgentEntry.current_message_id` **共享同一 Arc**
///   修复多轮对话事件关联错位缺陷：`cmd_agent_prompt` 调用
///   `entry.rotate_message_id()` 后，listener 立即可见新值
///
/// # 事件丢失风险
/// `app.emit` 失败（如前端尚未 listen）只记日志不阻断流程，
/// 因为事件流是"尽力而为"，前端应有兜底（如最终文本通过命令返回值获取）。
struct TauriEventListener {
    /// Tauri 应用句柄（用于 emit 事件）
    app: AppHandle,
    /// 会话 ID（事件名组成部分）
    session_id: String,
    /// 当前消息 ID（与 AgentEntry 共享同一 Arc，rotate 时立即可见）
    message_id: SharedMessageId,
}

impl TauriEventListener {
    /// 读取当前 message_id（用于事件 payload）
    fn current_message_id(&self) -> String {
        self.message_id
            .read()
            .map(|g| g.clone())
            .unwrap_or_default()
    }
}

impl EventListener for TauriEventListener {
    fn on_event(&self, event: &OrchestratorEvent) {
        let message_id = self.current_message_id();
        let payload = AgentEventPayload::from_orchestrator_event(
            event,
            &self.session_id,
            &message_id,
        );

        let Some(payload) = payload else {
            // 未映射的事件（如 UserMessage / 编排层扩展事件）直接丢弃
            return;
        };

        let event_name = session_event_name(&self.session_id);
        match self.app.emit(&event_name, payload) {
            Ok(()) => {
                debug!(
                    "agent event emitted: session={} event={}",
                    self.session_id, event_name
                );
            }
            Err(e) => {
                warn!(
                    "agent event emit 失败: session={} err={}",
                    self.session_id, e
                );
            }
        }
    }
}

// ─── 命令参数与返回类型 ────────────────────────────────────────────

/// `cmd_agent_create` 的可选配置
///
/// # Loop Engineering 参数（批次6 扩展）
/// 以下字段允许调用方（前端/Agent 自身）按任务特征调整循环控制参数，
/// 实现 Loops 的重要承载：任务可由 Agent 判断后传入合适的超时/重试/限流配置。
/// - 长任务（task 模式）：可放宽 `llm_timeout` / `tool_timeout`
/// - 高频调用场景：可设 `min_interval_between_calls_ms` 避免触发 Provider 限流
/// - 易失败工具：可设 `tool_max_retries` 自动重试
/// 所有字段 Optional，未提供则使用 `AgentLoopConfig::default()` 保守策略。
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAgentOptions {
    /// 系统提示词（每次 prompt 都会附加）
    #[serde(default)]
    pub system_prompt: Option<String>,
    /// 最大迭代次数（默认 25）
    #[serde(default)]
    pub max_iterations: Option<u32>,
    /// 温度（None=使用 Provider 默认）
    #[serde(default)]
    pub temperature: Option<f32>,
    /// 最大输出 token
    #[serde(default)]
    pub max_tokens: Option<u32>,
    /// 是否并行执行工具调用（默认 false）
    #[serde(default)]
    pub parallel_tool_calls: Option<bool>,
    /// 思考级别
    #[serde(default)]
    pub thinking_level: Option<ThinkingLevel>,

    // ─── Loop Engineering 批次6：通用循环控制参数 ───
    /// LLM 调用失败时的最大重试次数（默认 3，0=不重试）
    ///
    /// 采用指数退避：delay = `llm_retry_base_delay_ms * 2^attempt`
    #[serde(default)]
    pub llm_max_retries: Option<u32>,
    /// LLM 重试基础延迟（毫秒，指数退避基数，默认 1000ms）
    #[serde(default)]
    pub llm_retry_base_delay_ms: Option<u64>,
    /// 单次 LLM 调用超时（毫秒，None=不限时，默认 300000=5min）
    ///
    /// 注意：超时只针对单次 LLM 调用，不针对整个任务。
    /// 超时后会触发重试（若 `llm_max_retries > 0`），不会强制终止整个 Agent 任务。
    #[serde(default)]
    pub llm_timeout_ms: Option<u64>,
    /// 工具执行失败时的最大重试次数（默认 0，工具自身负责重试）
    ///
    /// 默认不重试，因为工具可能有副作用（如写文件、发请求），
    /// 重复执行可能导致数据不一致。需要重试的工具应在 ToolBus 层自行实现。
    #[serde(default)]
    pub tool_max_retries: Option<u32>,
    /// 工具重试基础延迟（毫秒，默认 1000ms）
    #[serde(default)]
    pub tool_retry_base_delay_ms: Option<u64>,
    /// 单次工具执行超时（毫秒，None=不限时）
    ///
    /// 超时后工具执行被视为失败，错误信息推入 toolResult 消息让 LLM 处理。
    #[serde(default)]
    pub tool_timeout_ms: Option<u64>,
    /// LLM 调用之间的最小间隔（毫秒，限流，None=不限制）
    ///
    /// 用于避免触发 Provider 的速率限制（如 DeepSeek 60次/分钟）。
    /// 在每次 LLM 调用前检查距上次调用的间隔，不足则 sleep。
    #[serde(default)]
    pub min_interval_between_calls_ms: Option<u64>,
}

impl Default for CreateAgentOptions {
    fn default() -> Self {
        Self {
            system_prompt: None,
            max_iterations: None,
            temperature: None,
            max_tokens: None,
            parallel_tool_calls: None,
            thinking_level: None,
            // Loop Engineering 批次6：默认全 None，使用 AgentLoopConfig::default()
            llm_max_retries: None,
            llm_retry_base_delay_ms: None,
            llm_timeout_ms: None,
            tool_max_retries: None,
            tool_retry_base_delay_ms: None,
            tool_timeout_ms: None,
            min_interval_between_calls_ms: None,
        }
    }
}

// ─── Tauri 命令 ────────────────────────────────────────────

/// 创建 Agent 实例并注册到 registry
///
/// # 参数
/// - `session_id`：会话 ID（前端生成，用于后续命令关联）
/// - `provider_config`：LLM Provider 配置（Cloud / Local / Custom）
/// - `options`：可选的 AgentLoop 配置
///
/// # 行为
/// 1. 创建 `GenaiBackend`（持有 provider_config）
/// 2. 创建空的 `SimpleToolBus`（阶段 1.5 不预置工具，阶段 2 接入 SkillRegistry）
/// 3. 创建 `AgentLoop`，应用配置
/// 4. 注入 `TauriEventListener`：把 `OrchestratorEvent` 转为 payload 后 emit 到前端
/// 5. 注册到 `AgentRegistry`
///
/// # 错误
/// - `AlreadyExists`：session_id 已存在（需先 destroy）
#[tauri::command]
pub async fn cmd_agent_create(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    provider_config: ProviderConfig,
    options: Option<CreateAgentOptions>,
) -> Result<(), AgentRegistryError> {
    let options = options.unwrap_or_default();

    info!(
        "cmd_agent_create: session={} provider_mode={:?} model={}",
        session_id,
        std::mem::discriminant(&provider_config),
        provider_config.model_id(),
    );

    // 1. 创建 backend + tool_bus
    let backend = Arc::new(GenaiBackend::new(provider_config));
    let tool_bus: Arc<dyn agent_runtime::tool::ToolBus> = Arc::new(SimpleToolBus::new());

    // 2. 创建 FrontendToolBridge（用于 frontend 工具反向调用前端 TS 实现）
    //    在创建 AgentLoop 之前创建，以便注册 frontend 工具到 tool_bus
    let tool_bridge = Arc::new(FrontendToolBridge::new(app.clone(), session_id.clone()));

    // 3. 注册 native + frontend 工具到 tool_bus（P0-A4）
    //    native 工具：read_file/write_file/list_dir 等 Rust 原生实现
    //    frontend 工具：entity/kb/schema/ui 等通过 FrontendToolBridge 反向调用前端
    crate::agent_bridge::register_default_tools(&tool_bus, &tool_bridge).await;

    // 4. 创建 AgentLoop（注入已注册好工具的 tool_bus）
    let agent = AgentLoop::new(backend, tool_bus);

    // 5. 应用配置
    //    Loop Engineering 批次6：前端可通过 CreateAgentOptions 传入循环控制参数，
    //    未提供者使用 AgentLoopConfig::default() 保守策略。
    //    这让 Agent 可根据任务特征（长任务/高频调用/易失败工具）动态调整超时/重试/限流，
    //    是 Loops 的重要承载：调用方按需注入策略，避免一刀切。
    let config = AgentLoopConfig {
        max_iterations: options.max_iterations.unwrap_or(25),
        system_prompt: options.system_prompt,
        temperature: options.temperature,
        max_tokens: options.max_tokens,
        parallel_tool_calls: options.parallel_tool_calls.unwrap_or(false),
        thinking_level: options.thinking_level,
        // Loop Engineering 参数：Option→具体值，None 用 default
        llm_max_retries: options.llm_max_retries.unwrap_or(3),
        llm_retry_base_delay: Duration::from_millis(
            options.llm_retry_base_delay_ms.unwrap_or(1000),
        ),
        llm_timeout: options
            .llm_timeout_ms
            .map(Duration::from_millis)
            .or_else(|| Some(Duration::from_secs(300))),
        tool_max_retries: options.tool_max_retries.unwrap_or(0),
        tool_retry_base_delay: Duration::from_millis(
            options.tool_retry_base_delay_ms.unwrap_or(1000),
        ),
        tool_timeout: options.tool_timeout_ms.map(Duration::from_millis),
        min_interval_between_calls: options
            .min_interval_between_calls_ms
            .map(Duration::from_millis),
    };
    let agent = Arc::new(agent.with_config(config));

    // 6. 注册到 registry（registry 内部创建 AgentEntry，含共享 message_id Arc）
    state
        .agent_registry
        .register(session_id.clone(), agent.clone())
        .await?;

    // 7. 从 registry 取出 entry，拿共享 message_id Arc 创建 TauriEventListener
    //    这样 listener 与 entry 持有同一 Arc<RwLock<String>>，
    //    cmd_agent_prompt 调用 entry.rotate_message_id() 后，listener 立即可见新值
    let entry = state.agent_registry.get(&session_id).await?;
    let shared_message_id = entry.shared_message_id();

    let listener = Arc::new(TauriEventListener {
        app: app.clone(),
        session_id: session_id.clone(),
        message_id: shared_message_id,
    });
    agent.subscribe(listener).await;

    // 8. 注入 FrontendToolBridge 到 registry（cmd_agent_tool_result 命令会查找它）
    state
        .agent_registry
        .set_tool_bridge(&session_id, tool_bridge)
        .await?;

    info!("cmd_agent_create: 成功创建 session={}", session_id);
    Ok(())
}

/// 启动 ReAct 循环
///
/// # 参数
/// - `session_id`：会话 ID
/// - `text`：用户输入
///
/// # 返回
/// 最终响应文本（LLM 最后一轮未触发工具调用时的回复）
///
/// # 事件流
/// 调用前轮换 `message_id`，期间通过 `app.emit("agent:event:{session_id}", ...)` 推送：
/// - `AgentStart` / `UserMessage` / `StreamStart`
/// - `StreamDelta` × N（流式增量）
/// - `ToolCallStart` / `ToolCallEnd` × N（如有工具调用）
/// - `StreamEnd`
/// - `AgentEnd`
///
/// # 错误
/// - `NotFound`：session 不存在
/// - `AgentError`：LLM 调用失败 / 超过迭代次数 / Agent 已中断
#[tauri::command]
pub async fn cmd_agent_prompt(
    state: State<'_, AppState>,
    session_id: String,
    text: String,
) -> Result<String, AgentRegistryError> {
    debug!(
        "cmd_agent_prompt: session={} text_len={}",
        session_id,
        text.len()
    );

    // 获取 agent（用于后续 run）
    let agent = state.agent_registry.get(&session_id).await?.agent;

    // 轮换 message_id（共享 Arc，TauriEventListener 立即可见新值）
    // 这样新一轮 ReAct 循环的 StreamStart/StreamDelta/StreamEnd 都关联到新 message_id，
    // 避免多轮对话时事件错位关联到旧消息。
    state
        .agent_registry
        .with_entry_mut(&session_id, |entry| entry.rotate_message_id())
        .await?;

    // 执行 ReAct 循环
    let result = agent.run(text).await?;

    Ok(result)
}

/// 中途引导（不结束当前轮）
///
/// 文本进入 backend 的 steer_buffer，下次 prompt 时附加为前置 user 消息。
#[tauri::command]
pub async fn cmd_agent_steer(
    state: State<'_, AppState>,
    session_id: String,
    text: String,
) -> Result<(), AgentRegistryError> {
    let agent = state.agent_registry.get(&session_id).await?.agent;
    agent.steer(text).await?;
    Ok(())
}

/// 跟进提问（保留历史，开始新一轮 ReAct 循环）
#[tauri::command]
pub async fn cmd_agent_follow_up(
    state: State<'_, AppState>,
    session_id: String,
    text: String,
) -> Result<String, AgentRegistryError> {
    let agent = state.agent_registry.get(&session_id).await?.agent;
    let result = agent.follow_up(text).await?;
    Ok(result)
}

/// 中断当前运行
#[tauri::command]
pub async fn cmd_agent_abort(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), AgentRegistryError> {
    state.agent_registry.abort(&session_id).await?;
    Ok(())
}

/// 销毁 Agent 实例
///
/// 1. 调用 `tool_bridge.abort_all()` 取消所有 pending 工具调用
/// 2. 调用 `agent.dispose()` 清空状态
/// 3. 从 registry 移除
#[tauri::command]
pub async fn cmd_agent_destroy(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), AgentRegistryError> {
    // 先取 tool_bridge，abort 所有 pending 工具调用
    if let Some(bridge) = state.agent_registry.get_tool_bridge(&session_id).await? {
        bridge.abort_all().await;
    }

    let entry = state.agent_registry.remove(&session_id).await?;
    entry.agent.dispose().await;
    info!("cmd_agent_destroy: 已销毁 session={}", session_id);
    Ok(())
}

/// 清空对话历史
#[tauri::command]
pub async fn cmd_agent_clear_history(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), AgentRegistryError> {
    let agent = state.agent_registry.get(&session_id).await?.agent;
    agent.clear_history().await;
    Ok(())
}

/// 热切换模型
///
/// 不清空消息历史，只更新 backend 的 provider 配置和 config 的 temperature/max_tokens。
#[tauri::command]
pub async fn cmd_agent_update_model(
    state: State<'_, AppState>,
    session_id: String,
    provider: String,
    model_id: String,
    base_url: Option<String>,
    api_key: Option<String>,
    temperature: Option<f32>,
    max_tokens: Option<u32>,
) -> Result<(), AgentRegistryError> {
    let agent = state.agent_registry.get(&session_id).await?.agent;
    agent
        .update_model(
            provider,
            model_id,
            base_url,
            api_key,
            temperature,
            max_tokens,
        )
        .await?;
    Ok(())
}

/// 更新思考级别
#[tauri::command]
pub async fn cmd_agent_update_thinking_level(
    state: State<'_, AppState>,
    session_id: String,
    level: ThinkingLevel,
) -> Result<(), AgentRegistryError> {
    let agent = state.agent_registry.get(&session_id).await?.agent;
    agent.update_thinking_level(level);
    Ok(())
}

/// 清理上下文窗口
///
/// 同时同步 state.messages 和 backend 内部 messages，保证两边一致。
#[tauri::command]
pub async fn cmd_agent_trim_context(
    state: State<'_, AppState>,
    session_id: String,
    up_to_index: usize,
) -> Result<(), AgentRegistryError> {
    let agent = state.agent_registry.get(&session_id).await?.agent;
    agent.trim_context(up_to_index).await?;
    Ok(())
}

/// 获取状态快照（对应前端 `IAgentBackend.state`）
#[tauri::command]
pub async fn cmd_agent_get_state_snapshot(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<agent_runtime::AgentStateSnapshot, AgentRegistryError> {
    let agent = state.agent_registry.get(&session_id).await?.agent;
    let snapshot = agent.get_state_snapshot().await;
    Ok(snapshot)
}

/// 获取内部 messages（用于 checkpoint 持久化）
#[tauri::command]
pub async fn cmd_agent_get_runtime_messages(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Vec<OrchestratorMessage>, AgentRegistryError> {
    let agent = state.agent_registry.get(&session_id).await?.agent;
    let messages = agent.get_runtime_messages().await;
    Ok(messages)
}

/// 写回内部 messages（用于断点恢复）
#[tauri::command]
pub async fn cmd_agent_set_runtime_messages(
    state: State<'_, AppState>,
    session_id: String,
    messages: Vec<OrchestratorMessage>,
) -> Result<(), AgentRegistryError> {
    let agent = state.agent_registry.get(&session_id).await?.agent;
    agent.set_runtime_messages(messages).await?;
    Ok(())
}

/// 列出所有已注册的 session_id（用于调试 / 多会话切换 UI）
#[tauri::command]
pub async fn cmd_agent_list_sessions(
    state: State<'_, AppState>,
) -> Result<Vec<String>, AgentRegistryError> {
    Ok(state.agent_registry.list().await)
}

/// 接收前端回传的工具调用结果
///
/// # 流程
/// Rust Agent → FrontendToolBridge.call_tool → emit `agent:tool_call:{session_id}` →
/// 前端执行 TS 工具实现 → invoke('cmd_agent_tool_result', { sessionId, callId, result, success }) →
/// 本命令 → bridge.on_tool_result(ToolCallResult) → 唤醒等待中的 oneshot receiver →
/// AgentLoop 收到工具结果继续 ReAct 循环
///
/// # 参数
/// - `session_id`：会话 ID
/// - `call_id`：调用 ID（与 emit 时的 `ToolCallRequest.call_id` 对应）
/// - `result`：工具执行结果（成功时为返回值，失败时为错误信息）
/// - `success`：是否成功
///
/// # 返回
/// - `Ok(true)`：成功唤醒等待的调用
/// - `Ok(false)`：call_id 不存在（可能已超时或 Agent 已销毁）
#[tauri::command]
pub async fn cmd_agent_tool_result(
    state: State<'_, AppState>,
    session_id: String,
    call_id: String,
    result: serde_json::Value,
    success: bool,
) -> Result<bool, AgentRegistryError> {
    let bridge = state
        .agent_registry
        .get_tool_bridge(&session_id)
        .await?
        .ok_or_else(|| AgentRegistryError::NotFound {
            session_id: session_id.clone(),
        })?;

    let tool_result = ToolCallResult {
        call_id,
        result,
        success,
    };

    let woken = bridge.on_tool_result(tool_result).await;
    debug!(
        "cmd_agent_tool_result: session={} woken={}",
        session_id, woken
    );
    Ok(woken)
}

// ─── 单元测试 ────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_event_name_should_format_correctly() {
        let name = session_event_name("sess_abc");
        assert_eq!(name, "agent:event:sess_abc");
    }

    #[test]
    fn event_name_prefix_should_be_constant() {
        assert_eq!(event_name_prefix(), "agent:event:");
    }
}
