//! # MockBackend — 占位 LLM 后端
//!
//! Phase 5.1 命令层用于打通"send_message → AgentLoop.run → 响应"链路，
//! 不依赖真实 LLM（genai）。实现 [`NodeBackendAccessor`]，返回固定占位文本。
//!
//! 5.2 阶段接入真实 genai 后端时，替换 `AgentCommandService::new_agent`
//! 中的 `MockBackend` 为 `GenaiBackend` 即可，命令层参数/返回类型不变。

use std::sync::Arc;

use async_trait::async_trait;
use agent_runtime::backend::{
    BackendError, NodeBackendAccessor, PromptCallOptions, PromptResponse, ThinkingLevel,
};
use agent_runtime::event_bus::Listener;
use agent_runtime::types::OrchestratorMessage;

/// 占位 LLM 后端：回显收到的输入，返回固定模型名。
#[derive(Debug, Clone, Default)]
pub struct MockBackend {
    /// 每次 prompt 返回的文本（默认回显）
    pub reply_prefix: Option<String>,
}

impl MockBackend {
    /// 创建默认 MockBackend
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl NodeBackendAccessor for MockBackend {
    async fn prompt(
        &self,
        prompt: String,
        _options: Option<PromptCallOptions>,
    ) -> Result<PromptResponse, BackendError> {
        let text = match &self.reply_prefix {
            Some(prefix) => format!("{prefix} {prompt}"),
            None => format!("[mock] 收到：{prompt}"),
        };
        Ok(PromptResponse::text_only(text))
    }

    async fn get_messages(&self) -> Vec<OrchestratorMessage> {
        Vec::new()
    }

    async fn set_messages(&self, _messages: Vec<OrchestratorMessage>) -> Result<(), BackendError> {
        Ok(())
    }

    async fn trim_context(&self, _up_to_index: usize) -> Result<(), BackendError> {
        Ok(())
    }

    async fn subscribe_events(&self, _listener: Arc<dyn Listener>) {
        // Mock 后端无流式事件
    }

    async fn current_model(&self) -> String {
        "mock-model".to_string()
    }

    async fn update_provider(
        &self,
        _provider: String,
        _model_id: String,
        _api_key: Option<String>,
        _base_url: Option<String>,
    ) -> Result<(), BackendError> {
        Ok(())
    }
}

/// 运行时思考级别辅助（供命令层序列化用）
pub fn thinking_level_to_str(level: Option<ThinkingLevel>) -> Option<String> {
    level.map(|l| match l {
        ThinkingLevel::Off => "off",
        ThinkingLevel::Minimal => "minimal",
        ThinkingLevel::Low => "low",
        ThinkingLevel::Medium => "medium",
        ThinkingLevel::High => "high",
        ThinkingLevel::Xhigh => "xhigh",
        ThinkingLevel::Max => "max",
    }
    .to_string())
}