//! Tauri 命令层：Agent 主链路薄包装 + Deep Phase 事件转发，详细见 docs/details/注释/tauri/commands.md

use agent_commands::{
    AgentCommandService, LongTaskRepository, LoopControlCheckResult, LoopControlEntry,
    LoopControlRegistry, LoopControlRegistryError, LoopControlStatus, SendMessageParams,
    SubAgentInstanceInfo, TerminalService, UpdateModelParams,
};
use agent_runtime::backend::ThinkingLevel;
use agent_runtime::event::{OrchestratorEvent, EventListener, AgentEvent};
use agent_runtime::llm::config::ProviderConfig;
use agent_runtime::long_task::{LongTaskRecord, LongTaskStatus};
use agent_runtime::loop_control::LoopControlConfig;
use agent_runtime::supervisor::SubAgentSpec;
use std::collections::HashMap;
use std::sync::{Arc, Mutex as StdMutex, OnceLock};
use tauri::{AppHandle, Emitter, State};

/// 转发 AgentLoop 事件到 Tauri 前端事件系统
///
/// 当 AgentLoop 广播 `DeepPhaseChanged` 事件时，通过 Tauri 事件系统
/// `agent:event:deep_phase_changed` 发送到前端。
struct TauriAgentEventEmitter {
    app: AppHandle,
    session_id: String,
}

impl EventListener for TauriAgentEventEmitter {
    fn on_event(&self, event: &OrchestratorEvent) {
        match event {
            OrchestratorEvent::DeepPhaseChanged {
                phase_label,
                phase_index,
                trigger_tool,
                tool_status,
                phase_completed,
                ..
            } => {
                // 转发到前端：事件名 `agent:event:deep_phase_changed:{session_id}`
                // payload: { phaseLabel, phaseIndex, triggerTool, toolStatus, phaseCompleted }
                let event_name = format!("agent:event:deep_phase_changed:{}", self.session_id);
                if let Err(err) = self.app.emit(
                    &event_name,
                    serde_json::json!({
                        "phaseLabel": phase_label,
                        "phaseIndex": phase_index,
                        "triggerTool": trigger_tool,
                        "toolStatus": tool_status,
                        "phaseCompleted": phase_completed,
                    }),
                ) {
                    tracing::warn!(
                        "Failed to emit DeepPhaseChanged event to frontend: {}",
                        err
                    );
                }
            }
            OrchestratorEvent::A2UIEvent {
                surface_id,
                message,
                ..
            } => {
                // 转发到前端：事件名 `agent:event:a2ui:{session_id}`
                // payload: { surfaceId, message }（message 序列化为 camelCase，null 变体自动跳过）
                let event_name = format!("agent:event:a2ui:{}", self.session_id);
                if let Err(err) = self.app.emit(
                    &event_name,
                    serde_json::json!({
                        "surfaceId": surface_id,
                        "message": message,
                    }),
                ) {
                    tracing::warn!(
                        "Failed to emit A2UI event to frontend: {}",
                        err
                    );
                }
            }
            OrchestratorEvent::SubAgentStarted {
                sub_agent_id,
                sub_agent_name,
                task_description,
                ..
            } => {
                // 转发到前端：事件名 `agent:event:subagent:{session_id}`
                // payload: { type, subAgentId, subAgentName, taskDescription }
                let event_name = format!("agent:event:subagent:{}", self.session_id);
                if let Err(err) = self.app.emit(&event_name, serde_json::json!({
                    "type": "start",
                    "subAgentId": sub_agent_id,
                    "subAgentName": sub_agent_name,
                    "taskDescription": task_description,
                })) {
                    tracing::warn!("Failed to emit SubAgentStarted event to frontend: {}", err);
                }
            }
            OrchestratorEvent::SubAgentCompleted {
                sub_agent_id,
                sub_agent_name,
                output_chars,
                duration_ms,
                ..
            } => {
                // 转发到前端：事件名 `agent:event:subagent:{session_id}`
                // payload: { type, subAgentId, subAgentName, outputChars, durationMs }
                let event_name = format!("agent:event:subagent:{}", self.session_id);
                if let Err(err) = self.app.emit(&event_name, serde_json::json!({
                    "type": "completed",
                    "subAgentId": sub_agent_id,
                    "subAgentName": sub_agent_name,
                    "outputChars": output_chars,
                    "durationMs": duration_ms,
                })) {
                    tracing::warn!("Failed to emit SubAgentCompleted event to frontend: {}", err);
                }
            }
            OrchestratorEvent::SubAgentError {
                sub_agent_id,
                sub_agent_name,
                error,
                ..
            } => {
                // 转发到前端：事件名 `agent:event:subagent:{session_id}`
                // payload: { type, subAgentId, subAgentName, error }
                let event_name = format!("agent:event:subagent:{}", self.session_id);
                if let Err(err) = self.app.emit(&event_name, serde_json::json!({
                    "type": "error",
                    "subAgentId": sub_agent_id,
                    "subAgentName": sub_agent_name,
                    "error": error,
                })) {
                    tracing::warn!("Failed to emit SubAgentError event to frontend: {}", err);
                }
            }
            // 流式响应事件（打字机效果）
            //
            // 转发 `StreamStart` / `StreamDelta` / `StreamEnd` / `Error` / `AgentEnd`
            // 到前端通道 `agent:event:stream:{session_id}`，前端据此实现打字机效果。
            // payload: { type, model | delta | fullText | message }
            OrchestratorEvent::Agent(agent_event) => {
                let payload = match agent_event {
                    AgentEvent::StreamStart { model } => {
                        serde_json::json!({ "type": "start", "model": model })
                    }
                    AgentEvent::StreamDelta { delta } => {
                        serde_json::json!({ "type": "delta", "delta": delta })
                    }
                    AgentEvent::StreamEnd { full_text } => {
                        serde_json::json!({ "type": "end", "fullText": full_text })
                    }
                    AgentEvent::Error { message } => {
                        serde_json::json!({ "type": "error", "message": message })
                    }
                    AgentEvent::AgentEnd => serde_json::json!({ "type": "agent_end" }),
                    // 其他基础 Agent 事件（UserMessage / ToolCall* / A2UI）暂不在此通道转发
                    _ => return,
                };
                let event_name = format!("agent:event:stream:{}", self.session_id);
                if let Err(err) = self.app.emit(&event_name, payload) {
                    tracing::warn!("Failed to emit Stream event to frontend: {}", err);
                }
            }
            // 其他事件目前不需要转发到前端
            _ => {}
        }
    }
}

/// 每会话一个 TauriAgentEventEmitter 的注册表
///
/// `send_message` 每次调用都会 `agent.subscribe`；若每次都新建 emitter，
/// 即使 `EventBroadcaster` 已去重（不同实例指针不同），仍会造成事件多播。
/// 这里按 `session_id` 复用同一个 emitter，保证每个会话只订阅一次。
static EMITTER_REGISTRY: OnceLock<StdMutex<HashMap<String, Arc<TauriAgentEventEmitter>>>> =
    OnceLock::new();

fn emitter_registry() -> &'static StdMutex<HashMap<String, Arc<TauriAgentEventEmitter>>> {
    EMITTER_REGISTRY.get_or_init(|| StdMutex::new(HashMap::new()))
}

/// 新建会话
///
/// # 参数
/// - `system_prompt`：系统提示词
/// - `provider_config`：Provider 配置（可选，缺省用默认 Cloud 占位，
///   随后可调用 `set_provider_config` 写入真实配置）
#[tauri::command]
pub async fn new_session(
    state: State<'_, AgentCommandService>,
    system_prompt: Option<String>,
    provider_config: Option<ProviderConfig>,
) -> Result<agent_commands::SessionInfo, String> {
    state
        .new_session(system_prompt, provider_config)
        .await
        .map_err(|e| e.to_string())
}

/// 会话列表
#[tauri::command]
pub async fn list_sessions(
    state: State<'_, AgentCommandService>,
) -> Result<Vec<agent_commands::SessionInfo>, String> {
    state.list_sessions().await.map_err(|e| e.to_string())
}

/// 删除会话
#[tauri::command]
pub async fn delete_session(
    state: State<'_, AgentCommandService>,
    session_id: String,
) -> Result<(), String> {
    state.delete_session(&session_id).await.map_err(|e| e.to_string())
}

/// 重命名会话标题
#[tauri::command]
pub async fn update_session_title(
    state: State<'_, AgentCommandService>,
    session_id: String,
    title: String,
) -> Result<(), String> {
    state
        .update_session_title(&session_id, &title)
        .await
        .map_err(|e| e.to_string())
}

/// 设置会话固定状态
#[tauri::command]
pub async fn set_session_pinned(
    state: State<'_, AgentCommandService>,
    session_id: String,
    pinned: bool,
) -> Result<(), String> {
    state
        .set_session_pinned(&session_id, pinned)
        .await
        .map_err(|e| e.to_string())
}

/// 记忆列表（空查询=全量，按时间排序；支持可选关键词过滤）
#[tauri::command]
pub async fn memory_list(
    state: State<'_, AgentCommandService>,
    session_id: String,
    keyword: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<agent_runtime::memory::MemoryRecallResult>, String> {
    state
        .memory_list(&session_id, keyword, limit)
        .await
        .map_err(|e| e.to_string())
}

/// 记忆检索（关键词）
#[tauri::command]
pub async fn memory_recall(
    state: State<'_, AgentCommandService>,
    session_id: String,
    query: String,
    top_k: Option<u32>,
) -> Result<Vec<agent_runtime::memory::MemoryRecallResult>, String> {
    state
        .memory_recall(&session_id, query, top_k)
        .await
        .map_err(|e| e.to_string())
}

/// 手动触发归档（消费缓冲轮次）
#[tauri::command]
pub async fn memory_archive(
    state: State<'_, AgentCommandService>,
    session_id: String,
) -> Result<Option<agent_runtime::memory::MemoryArchiveResult>, String> {
    state
        .memory_archive(&session_id)
        .await
        .map_err(|e| e.to_string())
}

/// 加载记忆块完整内容
#[tauri::command]
pub async fn memory_load_chunk(
    state: State<'_, AgentCommandService>,
    session_id: String,
    hook_id: String,
    chunk_id: String,
) -> Result<Option<agent_runtime::memory::MemoryChunkContent>, String> {
    state
        .memory_load_chunk(&session_id, hook_id, chunk_id)
        .await
        .map_err(|e| e.to_string())
}

/// 获取当前归档边界
#[tauri::command]
pub async fn memory_boundary(
    state: State<'_, AgentCommandService>,
    session_id: String,
) -> Result<usize, String> {
    state
        .memory_boundary(&session_id)
        .await
        .map_err(|e| e.to_string())
}

/// 发送消息（ReAct 循环执行）
#[tauri::command]
pub async fn send_message(
    app: AppHandle,
    state: State<'_, AgentCommandService>,
    params: SendMessageParams,
) -> Result<agent_commands::SendMessageResult, String> {
    let agent = state.get_agent(&params.session_id).await.map_err(|e| e.to_string())?;

    // 注册事件转发监听器（每会话仅一次，复用 emitter 避免事件多播）
    //
    // 注意：`emitter_registry` 的 MutexGuard 不能跨 await 持有（否则 future 非 Send），
    // 故先判断是否需要注册（guard 随即释放），再在 guard 之外 await subscribe，
    // 最后重新加锁插入。
    let needs_register = {
        let registry = emitter_registry().lock().unwrap();
        !registry.contains_key(&params.session_id)
    };
    if needs_register {
        let emitter = Arc::new(TauriAgentEventEmitter {
            app: app.clone(),
            session_id: params.session_id.clone(),
        });
        agent.subscribe(emitter.clone()).await;
        let mut registry = emitter_registry().lock().unwrap();
        registry.entry(params.session_id.clone()).or_insert(emitter);
    }

    state.send_message(params).await.map_err(|e| e.to_string())
}

/// 中断当前运行
#[tauri::command]
pub async fn abort(
    state: State<'_, AgentCommandService>,
    session_id: String,
) -> Result<(), String> {
    state.abort(&session_id).await.map_err(|e| e.to_string())
}

/// 中途引导（steer）
#[tauri::command]
pub async fn steer(
    state: State<'_, AgentCommandService>,
    session_id: String,
    text: String,
) -> Result<(), String> {
    state.steer(&session_id, text).await.map_err(|e| e.to_string())
}

/// 清空历史
#[tauri::command]
pub async fn clear_history(
    state: State<'_, AgentCommandService>,
    session_id: String,
) -> Result<(), String> {
    state.clear_history(&session_id).await.map_err(|e| e.to_string())
}

/// 清理上下文窗口（移除前 up_to_index 条消息）
#[tauri::command]
pub async fn trim_context(
    state: State<'_, AgentCommandService>,
    session_id: String,
    up_to_index: usize,
) -> Result<(), String> {
    state
        .trim_context(&session_id, up_to_index)
        .await
        .map_err(|e| e.to_string())
}

/// 状态快照
#[tauri::command]
pub async fn get_state(
    state: State<'_, AgentCommandService>,
    session_id: String,
) -> Result<agent_runtime::AgentStateSnapshot, String> {
    state.get_state(&session_id).await.map_err(|e| e.to_string())
}

/// 消息列表
#[tauri::command]
pub async fn get_messages(
    state: State<'_, AgentCommandService>,
    session_id: String,
) -> Result<Vec<agent_runtime::OrchestratorMessage>, String> {
    state.get_messages(&session_id).await.map_err(|e| e.to_string())
}

/// 是否正在流式输出
#[tauri::command]
pub async fn is_streaming(
    state: State<'_, AgentCommandService>,
    session_id: String,
) -> Result<bool, String> {
    state.is_streaming(&session_id).await.map_err(|e| e.to_string())
}

/// 热切换模型
#[tauri::command]
pub async fn update_model(
    state: State<'_, AgentCommandService>,
    params: UpdateModelParams,
) -> Result<(), String> {
    state.update_model(params).await.map_err(|e| e.to_string())
}

/// 更新思考级别（level 为 "off"/"minimal"/"low"/"medium"/"high"/"xhigh"）
#[tauri::command]
pub async fn update_thinking_level(
    state: State<'_, AgentCommandService>,
    session_id: String,
    level: String,
) -> Result<(), String> {
    let parsed = parse_thinking_level(&level)?;
    state
        .update_thinking_level(&session_id, parsed)
        .await
        .map_err(|e| e.to_string())
}

/// 获取 Provider 配置
#[tauri::command]
pub async fn get_provider_config(
    state: State<'_, AgentCommandService>,
    session_id: String,
) -> Result<agent_commands::ProviderConfig, String> {
    state.get_provider_config(&session_id).await.map_err(|e| e.to_string())
}

/// 整体写入 Provider 配置（5.4：真实 LLM 后端接入）
///
/// 前端从本地存储读取配置 + API Key 后传入，支持 cloud/local/custom 三种
/// 模式，可跨模式切换，不清空消息历史。
#[tauri::command]
pub async fn set_provider_config(
    state: State<'_, AgentCommandService>,
    session_id: String,
    config: ProviderConfig,
) -> Result<(), String> {
    state
        .set_provider_config(&session_id, config)
        .await
        .map_err(|e| e.to_string())
}

/// 获取心跳状态（长任务监控）
#[tauri::command]
pub async fn get_heartbeat(
    state: State<'_, AgentCommandService>,
    session_id: String,
) -> Result<agent_runtime::long_task::HeartbeatStatus, String> {
    state.get_heartbeat(&session_id).await.map_err(|e| e.to_string())
}

/// 解析思考级别字符串，非法值返回错误
fn parse_thinking_level(level: &str) -> Result<ThinkingLevel, String> {
    match level {
        "off" => Ok(ThinkingLevel::Off),
        "minimal" => Ok(ThinkingLevel::Minimal),
        "low" => Ok(ThinkingLevel::Low),
        "medium" => Ok(ThinkingLevel::Medium),
        "high" => Ok(ThinkingLevel::High),
        "xhigh" => Ok(ThinkingLevel::Xhigh),
        other => Err(format!("未知思考级别: {other}")),
    }
}

// ─── 终端（terminal）命令 ───────────────────────────────────
//
// 直接暴露终端工具给前端，与 Agent 工具总线解耦：
// 前端调用 `terminal_execute_command` / `terminal_*_session` 即可
// 执行命令、管理持久化 Shell 会话，无需经过 AgentLoop。
// 参数为 serde_json::Value，键名与工具参数一致（snake_case）。

/// 单次命令执行
#[tauri::command]
pub async fn terminal_execute_command(
    state: State<'_, TerminalService>,
    args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    state.execute_command(args).await.map_err(|e| e.to_string())
}

/// 检测可用 Shell
#[tauri::command]
pub async fn terminal_detect_shells(
    state: State<'_, TerminalService>,
) -> Result<serde_json::Value, String> {
    state.detect_shells().await.map_err(|e| e.to_string())
}

/// 创建持久化 Shell 会话
#[tauri::command]
pub async fn terminal_create_session(
    state: State<'_, TerminalService>,
    args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    state.create_session(args).await.map_err(|e| e.to_string())
}

/// 在持久化会话中执行命令
#[tauri::command]
pub async fn terminal_exec_session(
    state: State<'_, TerminalService>,
    args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    state.exec_session(args).await.map_err(|e| e.to_string())
}

/// 向持久化会话发送交互输入
#[tauri::command]
pub async fn terminal_input_session(
    state: State<'_, TerminalService>,
    args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    state.input_session(args).await.map_err(|e| e.to_string())
}

/// 销毁持久化会话
#[tauri::command]
pub async fn terminal_destroy_session(
    state: State<'_, TerminalService>,
    args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    state.destroy_session(args).await.map_err(|e| e.to_string())
}

/// 列出持久化会话
#[tauri::command]
pub async fn terminal_list_sessions(
    state: State<'_, TerminalService>,
) -> Result<serde_json::Value, String> {
    state.list_sessions().await.map_err(|e| e.to_string())
}

// ─── 子 Agent（subagent）命令 ───────────────────────────────────
//
// 暴露子 Agent 规格管理能力给前端：查看/注册/删除规格，
// 使主 Agent 的 `delegate_to_sub_agent` 工具可被用户在桌面端配置。
// `SubAgentSpec` 复用 agent-runtime 类型（已 derive Serialize/Deserialize）。

/// 列出已注册的子 Agent 规格
#[tauri::command]
pub async fn subagent_list_specs(
    state: State<'_, AgentCommandService>,
) -> Result<Vec<SubAgentSpec>, String> {
    Ok(state.list_subagent_specs().await)
}

/// 注册一个子 Agent 规格（同名按 id 覆盖）
#[tauri::command]
pub async fn subagent_register_spec(
    state: State<'_, AgentCommandService>,
    spec: SubAgentSpec,
) -> Result<(), String> {
    agent_commands::validate_subagent_spec(&spec)?;
    state.register_subagent_spec(spec).await;
    Ok(())
}

/// 删除一个子 Agent 规格（按 id）
#[tauri::command]
pub async fn subagent_remove_spec(
    state: State<'_, AgentCommandService>,
    id: String,
) -> Result<bool, String> {
    Ok(state.remove_subagent_spec(&id).await)
}

/// 导出全部子 Agent 规格为 JSON 字符串（备份/跨机迁移）
#[tauri::command]
pub async fn subagent_export_specs(
    state: State<'_, AgentCommandService>,
) -> Result<String, String> {
    state
        .export_subagent_specs()
        .await
        .map_err(|e| e.to_string())
}

/// 从 JSON 字符串导入子 Agent 规格（按 id 覆盖，返回导入条数）
#[tauri::command]
pub async fn subagent_import_specs(
    state: State<'_, AgentCommandService>,
    json: String,
) -> Result<usize, String> {
    state
        .import_subagent_specs(&json)
        .await
        .map_err(|e| e.to_string())
}

/// 列出指定会话子 Agent 实例池中所有活跃实例（含累积消息数/流式状态）
#[tauri::command]
pub async fn subagent_list_instances(
    state: State<'_, AgentCommandService>,
    session_id: String,
) -> Result<Vec<SubAgentInstanceInfo>, String> {
    state
        .list_subagent_instances(&session_id)
        .await
        .map_err(|e| e.to_string())
}

/// 清空指定会话的单个子 Agent 实例（重置其累积上下文，返回是否成功移除）
#[tauri::command]
pub async fn subagent_clear_instance(
    state: State<'_, AgentCommandService>,
    session_id: String,
    sub_agent_id: String,
) -> Result<bool, String> {
    state
        .clear_subagent_instance(&session_id, &sub_agent_id)
        .await
        .map_err(|e| e.to_string())
}

/// 清空指定会话的全部子 Agent 实例（重置累积上下文，返回清空数量）
#[tauri::command]
pub async fn subagent_clear_instances(
    state: State<'_, AgentCommandService>,
    session_id: String,
) -> Result<usize, String> {
    state
        .clear_subagent_instances(&session_id)
        .await
        .map_err(|e| e.to_string())
}

// ─── Loop Control（loop_control）命令 ───────────────────────────────────
//
// 恢复端分离迁移时丢失的命令层（原 src-tauri/src/commands/loop_control.rs）。
// 注册表与检查逻辑在 agent-commands 的 LoopControlRegistry（纯逻辑层），
// 此处做薄包装。前端 composable：useLoopControlRust.ts（11 个命令）。

/// 转发 LoopEng* 事件到前端 `loop_control:event:{task_id}` 通道
///
/// 每个 LoopController 实例在 `cmd_loop_control_create` 时订阅一个本监听器，
/// `cmd_loop_control_check` 检查到非空结果时经条目 broadcaster 广播，这里
/// 转为前端 `RustLoopControlEventPayload`（snake_case 字段）推送到前端。
struct LoopControlTauriEventListener {
    app: AppHandle,
}

impl EventListener for LoopControlTauriEventListener {
    fn on_event(&self, event: &OrchestratorEvent) {
        // 只处理 Loop Engineering 事件；字段名与前端 RustLoopControlEventPayload 对齐（snake_case）
        let (task_id, payload): (String, serde_json::Value) = match event {
            OrchestratorEvent::LoopEngRateLimitExceeded {
                task_id,
                limit_type,
                current,
                max,
            } => (
                task_id.clone(),
                serde_json::json!({
                    "type": "loop_eng_rate_limit_exceeded",
                    "task_id": task_id,
                    "limit_type": limit_type,
                    "current": current,
                    "max": max,
                }),
            ),
            OrchestratorEvent::LoopEngRetrying {
                task_id,
                attempt,
                max_retries,
                backoff_ms,
                error,
            } => (
                task_id.clone(),
                serde_json::json!({
                    "type": "loop_eng_retrying",
                    "task_id": task_id,
                    "attempt": attempt,
                    "max_retries": max_retries,
                    "backoff_ms": backoff_ms,
                    "error": error,
                }),
            ),
            OrchestratorEvent::LoopEngRetryExhausted {
                task_id,
                total_attempts,
                final_error,
            } => (
                task_id.clone(),
                serde_json::json!({
                    "type": "loop_eng_retry_exhausted",
                    "task_id": task_id,
                    "total_attempts": total_attempts,
                    "final_error": final_error,
                }),
            ),
            OrchestratorEvent::LoopEngSoftTimeoutWarning {
                task_id,
                elapsed_secs,
                threshold_secs,
            } => (
                task_id.clone(),
                serde_json::json!({
                    "type": "loop_eng_soft_timeout_warning",
                    "task_id": task_id,
                    "elapsed_secs": elapsed_secs,
                    "threshold_secs": threshold_secs,
                }),
            ),
            OrchestratorEvent::LoopEngSoftTimeoutCritical {
                task_id,
                elapsed_secs,
                threshold_secs,
            } => (
                task_id.clone(),
                serde_json::json!({
                    "type": "loop_eng_soft_timeout_critical",
                    "task_id": task_id,
                    "elapsed_secs": elapsed_secs,
                    "threshold_secs": threshold_secs,
                }),
            ),
            OrchestratorEvent::LoopEngWatchdogIdle {
                task_id,
                last_activity,
                idle_secs,
            } => (
                task_id.clone(),
                serde_json::json!({
                    "type": "loop_eng_watchdog_idle",
                    "task_id": task_id,
                    "last_activity": last_activity,
                    "idle_secs": idle_secs,
                }),
            ),
            OrchestratorEvent::LoopEngWatchdogDead {
                task_id,
                last_activity,
                idle_secs,
            } => (
                task_id.clone(),
                serde_json::json!({
                    "type": "loop_eng_watchdog_dead",
                    "task_id": task_id,
                    "last_activity": last_activity,
                    "idle_secs": idle_secs,
                }),
            ),
            OrchestratorEvent::LoopEngRecovered {
                task_id,
                turn_count,
                recovery_method,
            } => (
                task_id.clone(),
                serde_json::json!({
                    "type": "loop_eng_recovered",
                    "task_id": task_id,
                    "turn_count": turn_count,
                    "recovery_method": recovery_method,
                }),
            ),
            // 其他事件不转发
            _ => return,
        };

        let event_name = format!("loop_control:event:{task_id}");
        if let Err(err) = self.app.emit(&event_name, payload) {
            tracing::warn!("Failed to emit loop_control event to frontend: {}", err);
        }
    }
}

/// 创建 LoopController 实例并注册到 registry，详细见 docs/details/注释/tauri/commands.md
#[tauri::command]
pub async fn cmd_loop_control_create(
    app: AppHandle,
    state: State<'_, Arc<LoopControlRegistry>>,
    service: State<'_, AgentCommandService>,
    task_id: String,
    config: Option<LoopControlConfig>,
    session_id: Option<String>,
) -> Result<(), LoopControlRegistryError> {
    // 绑定会话：复用该会话 AgentLoop 内建 LoopController（共享单实例）
    if let Some(sid) = session_id {
        service
            .register_session_loop_control(task_id.clone(), &sid)
            .await
            .map_err(|e| LoopControlRegistryError::Internal {
                message: e.to_string(),
            })?;
        attach_loop_control_listener(&app, &state, &task_id).await;
        tracing::info!("cmd_loop_control_create: 已绑定会话 {sid} 复用内建控制器 task={task_id}");
        return Ok(());
    }

    // 无会话绑定：独立创建控制器（手动轨）
    let config = config.unwrap_or_default();
    let controller =
        Arc::new(agent_runtime::loop_control::LoopController::new(config.clone()));
    let entry = LoopControlEntry::new(controller, config);
    state.register(task_id.clone(), entry).await?;
    attach_loop_control_listener(&app, &state, &task_id).await;
    tracing::info!("cmd_loop_control_create: 已创建 task={task_id}");
    Ok(())
}

/// 取出已注册条目并订阅 TauriEventListener（把 LoopEng* 事件转发到前端）
async fn attach_loop_control_listener(
    app: &AppHandle,
    state: &State<'_, Arc<LoopControlRegistry>>,
    task_id: &str,
) {
    let entry = match state.get(task_id).await {
        Ok(e) => e,
        Err(_) => return,
    };
    let listener = Arc::new(LoopControlTauriEventListener { app: app.clone() });
    entry.subscribe(listener).await;
}

/// 执行一站式检查并 emit 事件
///
/// 调用 `LoopControlRegistry::check_and_emit`：检查 rate_limit / soft_timeout /
/// watchdog，非空结果广播 LoopEng* 事件（经监听器转发前端）。
#[tauri::command]
pub async fn cmd_loop_control_check(
    state: State<'_, Arc<LoopControlRegistry>>,
    task_id: String,
) -> Result<LoopControlCheckResult, LoopControlRegistryError> {
    state.check_and_emit(&task_id).await
}

/// 记录一次轮次（inc_turns），同时更新活动时间
#[tauri::command]
pub async fn cmd_loop_control_record_turn(
    state: State<'_, Arc<LoopControlRegistry>>,
    task_id: String,
) -> Result<(), LoopControlRegistryError> {
    let entry = state.get(&task_id).await?;
    entry.controller.rate_limiter.inc_turns();
    entry.update_activity();
    Ok(())
}

/// 记录一次工具调用（inc_tool_calls），同时更新活动时间
#[tauri::command]
pub async fn cmd_loop_control_record_tool_call(
    state: State<'_, Arc<LoopControlRegistry>>,
    task_id: String,
) -> Result<(), LoopControlRegistryError> {
    let entry = state.get(&task_id).await?;
    entry.controller.rate_limiter.inc_tool_calls();
    entry.update_activity();
    Ok(())
}

/// 记录 token 消耗（add_tokens），同时更新活动时间
#[tauri::command]
pub async fn cmd_loop_control_record_tokens(
    state: State<'_, Arc<LoopControlRegistry>>,
    task_id: String,
    tokens: u64,
) -> Result<(), LoopControlRegistryError> {
    let entry = state.get(&task_id).await?;
    entry.controller.rate_limiter.add_tokens(tokens);
    entry.update_activity();
    Ok(())
}

/// 更新活动时间（心跳，重置 Watchdog 的 last_activity）
#[tauri::command]
pub async fn cmd_loop_control_update_activity(
    state: State<'_, Arc<LoopControlRegistry>>,
    task_id: String,
) -> Result<(), LoopControlRegistryError> {
    let entry = state.get(&task_id).await?;
    entry.update_activity();
    Ok(())
}

/// 重置计数器（retry 后调用；不重置 started_at）
#[tauri::command]
pub async fn cmd_loop_control_reset_counters(
    state: State<'_, Arc<LoopControlRegistry>>,
    task_id: String,
) -> Result<(), LoopControlRegistryError> {
    let entry = state.get(&task_id).await?;
    entry.reset_counters();
    Ok(())
}

/// 获取任务配置快照
#[tauri::command]
pub async fn cmd_loop_control_get_config(
    state: State<'_, Arc<LoopControlRegistry>>,
    task_id: String,
) -> Result<LoopControlConfig, LoopControlRegistryError> {
    let entry = state.get(&task_id).await?;
    Ok(entry.config.clone())
}

/// 获取状态快照（计数器 + 触发状态）
#[tauri::command]
pub async fn cmd_loop_control_get_status(
    state: State<'_, Arc<LoopControlRegistry>>,
    task_id: String,
) -> Result<LoopControlStatus, LoopControlRegistryError> {
    let entry = state.get(&task_id).await?;
    Ok(LoopControlStatus::from_entry(&task_id, &entry))
}

/// 销毁 LoopController 实例（从 registry 移除）
#[tauri::command]
pub async fn cmd_loop_control_destroy(
    state: State<'_, Arc<LoopControlRegistry>>,
    task_id: String,
) -> Result<(), LoopControlRegistryError> {
    state.remove(&task_id).await?;
    tracing::info!("cmd_loop_control_destroy: 已销毁 task={task_id}");
    Ok(())
}

/// 列出所有已注册的 task_id
#[tauri::command]
pub async fn cmd_loop_control_list_tasks(
    state: State<'_, Arc<LoopControlRegistry>>,
) -> Result<Vec<String>, LoopControlRegistryError> {
    Ok(state.list().await)
}

// ─── 长任务（long_task）命令 ───────────────────────────────────────────
//
// 恢复端分离迁移时丢失的命令层（原 src-tauri/src/commands/long_task.rs）。
// 持久化在 agent-commands 的 LongTaskRepository（SQLite），此处做薄包装。
// 前端 composable：useLongTaskRust.ts（7 个命令）。

/// 保存或更新长任务（upsert 语义）
///
/// # 参数
/// - `record`: `LongTaskRecord`（含 task_id / status / checkpoint / meta 等完整字段）
///
/// # 调用时机
/// 心跳定时器 CheckpointFlush tick / `start_task` 后首次持久化 /
/// `complete_task` / `fail_task` / `cancel_task` 后写入终态 record。
#[tauri::command]
pub async fn cmd_long_task_save(
    state: State<'_, LongTaskRepository>,
    record: LongTaskRecord,
) -> Result<(), String> {
    state.save(record).await.map_err(|e| e.to_string())
}

/// 加载长任务完整数据（断点恢复用）
///
/// # 错误
/// task_id 不存在时返回 `not_found` 错误（前端 `loadTask` catch 后返回 null）。
#[tauri::command]
pub async fn cmd_long_task_load(
    state: State<'_, LongTaskRepository>,
    task_id: String,
) -> Result<LongTaskRecord, String> {
    state.load(&task_id).await.map_err(|e| e.to_string())
}

/// 列出所有 Running 任务（应用启动恢复用）
#[tauri::command]
pub async fn cmd_long_task_list_running(
    state: State<'_, LongTaskRepository>,
) -> Result<Vec<LongTaskRecord>, String> {
    state.list_running().await.map_err(|e| e.to_string())
}

/// 列出所有长任务（按 started_at DESC 排序，最近的在前）
#[tauri::command]
pub async fn cmd_long_task_list_all(
    state: State<'_, LongTaskRepository>,
) -> Result<Vec<LongTaskRecord>, String> {
    state.list_all().await.map_err(|e| e.to_string())
}

/// 轻量心跳更新（仅写 last_heartbeat_at）
///
/// # 返回
/// - `Ok(true)`: 更新成功
/// - `Ok(false)`: task_id 不存在（幂等，不报错）
#[tauri::command]
pub async fn cmd_long_task_update_heartbeat(
    state: State<'_, LongTaskRepository>,
    task_id: String,
    last_heartbeat_at: chrono::DateTime<chrono::Utc>,
) -> Result<bool, String> {
    state
        .update_heartbeat(&task_id, last_heartbeat_at)
        .await
        .map_err(|e| e.to_string())
}

/// 轻量状态更新（complete/fail/cancel 时调用）
///
/// 仅更新 status + ended_at，不触碰 checkpoint/meta。
#[tauri::command]
pub async fn cmd_long_task_update_status(
    state: State<'_, LongTaskRepository>,
    task_id: String,
    status: LongTaskStatus,
    ended_at: chrono::DateTime<chrono::Utc>,
) -> Result<bool, String> {
    state
        .update_status(&task_id, status, ended_at)
        .await
        .map_err(|e| e.to_string())
}

/// 删除长任务记录
///
/// # 返回
/// - `Ok(true)`: 删除成功
/// - `Ok(false)`: task_id 不存在（幂等，不报错）
#[tauri::command]
pub async fn cmd_long_task_delete(
    state: State<'_, LongTaskRepository>,
    task_id: String,
) -> Result<bool, String> {
    state.delete(&task_id).await.map_err(|e| e.to_string())
}