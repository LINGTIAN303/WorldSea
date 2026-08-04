//! # Tauri 命令层 — Agent 主链路 14 命令
//!
//! Phase 5.1：在 `apps/tauri/src-tauri` 端做薄包装，通过 `manage` 一个
//! [`AgentCommandService`] 实例，把 `agent-commands` 的纯逻辑方法暴露为
//! `#[tauri::command]`，供 WebView 前端 `invoke` 调用。
//!
//! 命令签名与 Web 端 `useAgent` 接口对齐（newSession / sendMessage / abort /
//! resumeTask / switchSession / getProviderConfig / updateModel /
//! updateThinkingLevel / clearHistory / getSessionList / getSessionMessages /
//! getUsage / getHeartbeat / ...），此处为其中已落地的主链路子集。
//!
//! P2 新增：Deep Phase 事件转发 — 订阅 AgentLoop 的 DeepPhaseChanged 事件，
//! 通过 Tauri 事件系统 `agent:event:deep_phase_changed` 发送到前端。

use agent_commands::{AgentCommandService, SendMessageParams, TerminalService, UpdateModelParams};
use agent_runtime::backend::ThinkingLevel;
use agent_runtime::event::{OrchestratorEvent, EventListener};
use agent_runtime::llm::config::ProviderConfig;
use std::sync::Arc;
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
            // 其他事件目前不需要转发到前端
            _ => {}
        }
    }
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

/// 发送消息（ReAct 循环执行）
#[tauri::command]
pub async fn send_message(
    app: AppHandle,
    state: State<'_, AgentCommandService>,
    params: SendMessageParams,
) -> Result<agent_commands::SendMessageResult, String> {
    let agent = state.get_agent(&params.session_id).await.map_err(|e| e.to_string())?;
    
    // 注册 Deep Phase 事件转发监听器
    // 幂等：如果已注册过，Arc 会保留，重复订阅不影响（broadcaster 允许多个监听器）
    let emitter = Arc::new(TauriAgentEventEmitter {
        app: app.clone(),
        session_id: params.session_id.clone(),
    });
    agent.subscribe(emitter).await;
    
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