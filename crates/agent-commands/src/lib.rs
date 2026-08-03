//! # agent-commands — Agent 命令层（服务层）
//!
//! 把 `agent-runtime` 的 AgentLoop 能力封装为可被 Tauri 前端调用的命令服务。
//!
//! ## 架构定位
//! - 本 crate 是**纯逻辑命令层**，不依赖 tauri，可独立 `cargo test`。
//! - Tauri 命令绑定（`#[tauri::command]`）在 `apps/tauri/src-tauri` 端做薄包装，
//!   通过 manage 一个 [`AgentCommandService`] 实例，再调用本 crate 的方法。
//!
//! ## 会话管理
//! [`AgentCommandService`] 内部持有 `session_id -> Arc<AgentLoop>` 映射，用
//! `tokio::sync::Mutex` 保护。AgentLoop 的方法全部为 `&self`（内部 Arc 共享状态），
//! 因此取到 `Arc<AgentLoop>` 后即可跨 await 调用，无需回写。
//!
//! ## Phase 5.1 说明
//! 当前使用 [`MockBackend`] 占位 LLM 后端，打通"send_message → run → 响应"链路。
//! 5.2 接入真实 genai 后端时，仅替换 `new_agent` 中的 backend 构造即可。

mod error;
mod mock_backend;

pub use error::CommandError;
pub use mock_backend::{MockBackend, thinking_level_to_str};

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use agent_runtime::agent::{AgentLoop, AgentLoopConfig, AgentStateSnapshot};
use agent_runtime::backend::ThinkingLevel;
use agent_runtime::long_task::HeartbeatStatus;
use agent_runtime::tool::SimpleToolBus;
use agent_runtime::types::OrchestratorMessage;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

// ─── 命令参数 / 返回类型 ────────────────────────────────────

/// 会话信息（列表项）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: String,
    pub created_at: u64,
    pub message_count: u32,
}

/// 发送消息参数
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SendMessageParams {
    pub session_id: String,
    pub text: String,
    /// 图片附件（Base64 data + mime）—— 5.2 真实后端接入后生效
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub images: Vec<ImageAttachmentParam>,
    /// 聊天模式（normal / deep 等）
    #[serde(default)]
    pub mode: Option<String>,
}

/// 图片附件参数
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageAttachmentParam {
    pub data: String,
    pub mime_type: String,
}

/// 发送消息结果
#[derive(Debug, Clone, serde::Serialize)]
pub struct SendMessageResult {
    pub session_id: String,
    pub reply: String,
    pub state: AgentStateSnapshot,
}

/// 更新模型参数
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateModelParams {
    pub session_id: String,
    pub provider: String,
    pub model_id: String,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub temperature: Option<f32>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
}

/// Provider 配置（5.1 返回占位，5.2 接入真实配置）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub provider: String,
    pub model: String,
    pub base_url: Option<String>,
}

// ─── 服务 ────────────────────────────────────────────────────

/// Agent 命令服务 — 会话管理 + 命令方法
///
/// 由 Tauri app 端 `manage` 为状态，供 `#[tauri::command]` 调用。
#[derive(Default)]
pub struct AgentCommandService {
    sessions: Mutex<HashMap<String, Arc<AgentLoop>>>,
    meta: Mutex<HashMap<String, SessionInfo>>,
}

impl AgentCommandService {
    /// 创建空服务
    pub fn new() -> Self {
        Self::default()
    }

    /// 构造一个 AgentLoop（当前使用 MockBackend 占位）
    fn new_agent(system_prompt: Option<String>) -> Arc<AgentLoop> {
        let backend = Arc::new(MockBackend::new());
        let tool_bus = Arc::new(SimpleToolBus::new());
        let config = AgentLoopConfig {
            system_prompt,
            ..Default::default()
        };
        Arc::new(AgentLoop::new(backend, tool_bus).with_config(config))
    }

    fn now() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    }

    // ── 会话生命周期 ────────────────────────────────────

    /// 新建会话
    pub async fn new_session(&self, system_prompt: Option<String>) -> Result<SessionInfo, CommandError> {
        let agent = Self::new_agent(system_prompt);
        let id = uuid::Uuid::new_v4().to_string();
        let info = SessionInfo {
            id: id.clone(),
            created_at: Self::now(),
            message_count: 0,
        };
        self.sessions.lock().await.insert(id.clone(), agent);
        self.meta.lock().await.insert(id.clone(), info.clone());
        Ok(info)
    }

    /// 获取会话（不存在则报错）
    async fn get_agent(&self, session_id: &str) -> Result<Arc<AgentLoop>, CommandError> {
        self.sessions
            .lock()
            .await
            .get(session_id)
            .cloned()
            .ok_or_else(|| CommandError::session_not_found(session_id))
    }

    /// 会话列表
    pub async fn list_sessions(&self) -> Result<Vec<SessionInfo>, CommandError> {
        let meta = self.meta.lock().await;
        let mut list: Vec<SessionInfo> = meta.values().cloned().collect();
        list.sort_by_key(|s| s.created_at);
        Ok(list)
    }

    /// 删除会话
    pub async fn delete_session(&self, session_id: &str) -> Result<(), CommandError> {
        let mut sessions = self.sessions.lock().await;
        let mut meta = self.meta.lock().await;
        sessions.remove(session_id);
        meta.remove(session_id);
        Ok(())
    }

    // ── 对话主链路 ────────────────────────────────────

    /// 发送消息（ReAct 循环执行）
    pub async fn send_message(&self, params: SendMessageParams) -> Result<SendMessageResult, CommandError> {
        let agent = self.get_agent(&params.session_id).await?;
        let reply = agent.run(params.text).await?;
        let state = agent.get_state_snapshot().await;
        // 更新会话消息数
        let count = state.messages.len() as u32;
        if let Some(meta) = self.meta.lock().await.get_mut(&params.session_id) {
            meta.message_count = count;
        }
        Ok(SendMessageResult {
            session_id: params.session_id,
            reply,
            state,
        })
    }

    /// 中途引导（steer，对应前端 sendBlockAction）
    pub async fn steer(&self, session_id: &str, text: String) -> Result<(), CommandError> {
        let agent = self.get_agent(session_id).await?;
        agent.steer(text).await.map_err(CommandError::from)
    }

    /// 中断当前运行
    pub async fn abort(&self, session_id: &str) -> Result<(), CommandError> {
        let agent = self.get_agent(session_id).await?;
        agent.abort().await;
        Ok(())
    }

    /// 清空历史
    pub async fn clear_history(&self, session_id: &str) -> Result<(), CommandError> {
        let agent = self.get_agent(session_id).await?;
        agent.clear_history().await;
        if let Some(meta) = self.meta.lock().await.get_mut(session_id) {
            meta.message_count = 0;
        }
        Ok(())
    }

    // ── 状态 / 消息查询 ────────────────────────────────────

    /// 状态快照
    pub async fn get_state(&self, session_id: &str) -> Result<AgentStateSnapshot, CommandError> {
        let agent = self.get_agent(session_id).await?;
        Ok(agent.get_state_snapshot().await)
    }

    /// 消息列表
    pub async fn get_messages(&self, session_id: &str) -> Result<Vec<OrchestratorMessage>, CommandError> {
        let agent = self.get_agent(session_id).await?;
        Ok(agent.get_messages().await)
    }

    /// 是否正在流式输出
    pub async fn is_streaming(&self, session_id: &str) -> Result<bool, CommandError> {
        let agent = self.get_agent(session_id).await?;
        Ok(agent.is_streaming())
    }

    // ── 模型 / 思考级别 ────────────────────────────────────

    /// 热切换模型
    pub async fn update_model(&self, params: UpdateModelParams) -> Result<(), CommandError> {
        let agent = self.get_agent(&params.session_id).await?;
        agent
            .update_model(
                params.provider,
                params.model_id,
                params.base_url,
                params.api_key,
                params.temperature,
                params.max_tokens,
            )
            .await
            .map_err(CommandError::from)
    }

    /// 更新思考级别（AgentLoop.update_thinking_level 为同步方法）
    pub async fn update_thinking_level(
        &self,
        session_id: &str,
        level: ThinkingLevel,
    ) -> Result<(), CommandError> {
        let agent = self.get_agent(session_id).await?;
        agent.update_thinking_level(level);
        Ok(())
    }

    // ── 配置 / 心跳 ────────────────────────────────────

    /// 获取 Provider 配置（5.1 返回占位）
    pub async fn get_provider_config(&self, session_id: &str) -> Result<ProviderConfig, CommandError> {
        let agent = self.get_agent(session_id).await?;
        let snapshot = agent.get_state_snapshot().await;
        Ok(ProviderConfig {
            provider: "mock".into(),
            model: snapshot.model,
            base_url: None,
        })
    }

    /// 获取心跳状态（长任务监控）
    pub async fn get_heartbeat(&self, session_id: &str) -> Result<HeartbeatStatus, CommandError> {
        let agent = self.get_agent(session_id).await?;
        let status = agent.long_task_manager().get_heartbeat_status().await;
        Ok(status)
    }
}

// ─── 单元测试 ────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn new_session_and_send_message_roundtrip() {
        let svc = AgentCommandService::new();
        let info = svc.new_session(Some("测试助手".into())).await.unwrap();
        let result = svc
            .send_message(SendMessageParams {
                session_id: info.id.clone(),
                text: "你好".into(),
                images: vec![],
                mode: None,
            })
            .await
            .unwrap();
        // MockBackend 以空 prompt 回显（用户消息已推入 state.messages），
        // 因此 reply 为 "[mock] 收到："，断言其非空且带 mock 标识即可验证链路。
        assert!(result.reply.contains("[mock]"));
        assert!(!result.state.messages.is_empty());
    }

    #[tokio::test]
    async fn session_not_found_returns_error() {
        let svc = AgentCommandService::new();
        let err = svc
            .send_message(SendMessageParams {
                session_id: "nope".into(),
                text: "hi".into(),
                images: vec![],
                mode: None,
            })
            .await
            .unwrap_err();
        assert!(matches!(err, CommandError::SessionNotFound(_)));
    }

    #[tokio::test]
    async fn list_and_delete_session() {
        let svc = AgentCommandService::new();
        let info = svc.new_session(None).await.unwrap();
        let list = svc.list_sessions().await.unwrap();
        assert_eq!(list.len(), 1);
        svc.delete_session(&info.id).await.unwrap();
        assert!(svc.list_sessions().await.unwrap().is_empty());
    }
}