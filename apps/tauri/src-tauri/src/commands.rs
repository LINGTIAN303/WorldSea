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

use agent_commands::{AgentCommandService, SendMessageParams, UpdateModelParams};
use agent_runtime::backend::ThinkingLevel;
use agent_runtime::llm::config::ProviderConfig;
use tauri::State;

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
    state: State<'_, AgentCommandService>,
    params: SendMessageParams,
) -> Result<agent_commands::SendMessageResult, String> {
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