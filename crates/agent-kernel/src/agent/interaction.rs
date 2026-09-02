use std::sync::atomic::Ordering;

use tracing::{debug, info, warn};

use crate::backend::ThinkingLevel;
use crate::llm::config::ProviderConfig;
use crate::types::{MessageRole, OrchestratorMessage};

use super::{AgentError, AgentLoop, AgentStateSnapshot};

// ─── IAgentBackend 接口补全（阶段 1.3 P0 修复） ─────────────

impl AgentLoop {
    /// 中途引导（不结束当前轮） — 委托给 `backend.steer`
    ///
    /// 对应前端 `IAgentBackend.steer(text)`。
    /// 实现机制：文本进入 backend 的 steer_buffer，下次 prompt 时附加为前置 user 消息。
    pub async fn steer(&self, text: String) -> Result<(), AgentError> {
        self.backend.steer(text).await.map_err(AgentError::from)
    }

    /// 跟进提问（保留历史，开始新一轮 ReAct 循环）
    ///
    /// 对应前端 `IAgentBackend.followUp(text)`。
    /// 与 `run` 的区别：不重置 current_iteration，不清除 messages。
    pub async fn follow_up(&self, text: String) -> Result<String, AgentError> {
        info!("AgentLoop followUp，输入长度: {}", text.len());
        // 检查中断
        {
            let state = self.state.lock().await;
            if state.aborted {
                return Err(AgentError::Aborted);
            }
        }
        // 直接调用 run（run 内部会推入 user 消息并启动循环）
        self.run(text).await
    }

    /// 清空对话历史 — 对应前端 `IAgentBackend.clearHistory()`
    ///
    /// 重置 state.messages、current_iteration 与总步骤预算，但保留 aborted 标志。
    pub async fn clear_history(&self) {
        let mut state = self.state.lock().await;
        state.messages.clear();
        state.current_iteration = 0;
        state.total_steps_used = 0;
        state.budget_warn_80_notified = false;
        state.budget_warn_95_notified = false;
        state.budget_final_notified = false;
        debug!("AgentLoop clear_history: 已清空 messages");
    }

    /// 更新思考级别 — 对应前端 `IAgentBackend.updateThinkingLevel(level)`
    ///
    /// 仅修改 config.thinking_level，不影响消息历史。
    pub fn update_thinking_level(&self, level: ThinkingLevel) {
        if let Ok(mut guard) = self.config.write() {
            guard.thinking_level = Some(level);
            debug!("update_thinking_level: 已更新为 {:?}", level);
        } else {
            warn!("update_thinking_level: config RwLock poisoned");
        }
    }

    /// 清理上下文窗口 — 对应前端 `IAgentBackend.trimContext(upToIndex)`
    ///
    /// 同时同步 state.messages 和 backend 内部 messages，
    /// 保证两边一致（避免 AgentLoop 与 backend 状态漂移）。
    pub async fn trim_context(&self, up_to_index: usize) -> Result<(), AgentError> {
        // 1. backend 端清理
        self.backend.trim_context(up_to_index).await?;

        // 2. state 端同步清理
        let mut state = self.state.lock().await;
        let total = state.messages.len();
        if up_to_index >= total {
            state.messages.clear();
        } else {
            state.messages.drain(0..up_to_index);
        }
        debug!(
            "trim_context: 移除前 {} 条，剩余 {} 条",
            up_to_index,
            state.messages.len()
        );
        Ok(())
    }

    /// 获取 pi-ai agent 内部 messages — 对应前端 `IAgentBackend.getRuntimeMessages()`
    ///
    /// 用于长任务 checkpoint 持久化，区别于 `get_messages()`（返回值类型相同，但语义上为 runtime）。
    pub async fn get_runtime_messages(&self) -> Vec<OrchestratorMessage> {
        self.state.lock().await.messages.clone()
    }

    /// 写回 pi-ai agent 内部 messages — 对应前端 `IAgentBackend.setRuntimeMessages(messages)`
    ///
    /// 用于断点恢复：将 checkpoint 持久化的 messages 写回 state.messages。
    /// 同时同步到 backend，保证两边一致。
    pub async fn set_runtime_messages(
        &self,
        messages: Vec<OrchestratorMessage>,
    ) -> Result<(), AgentError> {
        // 1. 同步到 backend
        self.backend
            .set_messages(messages.clone())
            .await
            .map_err(AgentError::from)?;

        // 2. 写回 state
        let mut state = self.state.lock().await;
        state.messages = messages;
        debug!("set_runtime_messages: 已写回 {} 条消息", state.messages.len());
        Ok(())
    }

    /// 重置实例状态（委派超时后调用），详细见 docs/details/注释/agent-runtime/agent.md
    pub async fn reset_after_timeout(&self) {
        self.is_streaming.store(false, Ordering::SeqCst);
        {
            let mut state = self.state.lock().await;
            if let Some(last) = state.messages.last() {
                if last.role == MessageRole::Assistant && !last.tool_calls.is_empty() {
                    state.messages.pop();
                }
            }
        }
    }

    /// 获取状态快照 — 对应前端 `IAgentBackend.state`
    ///
    /// 返回 `AgentStateSnapshot`，包含序列化友好的只读视图。
    pub async fn get_state_snapshot(&self) -> AgentStateSnapshot {
        let state = self.state.lock().await;
        let model = self.backend.current_model().await;
        let thinking_level = self
            .config_snapshot()
            .thinking_level;
        AgentStateSnapshot {
            current_iteration: state.current_iteration,
            aborted: state.aborted,
            paused: state.paused,
            is_streaming: self.is_streaming(),
            messages: state.messages.clone(),
            model,
            thinking_level,
            plan: state.plan.clone(),
        }
    }

    /// 热切换模型，详细见 docs/details/注释/agent-runtime/agent.md
    pub async fn update_model(
        &self,
        provider: String,
        model_id: String,
        base_url: Option<String>,
        api_key: Option<String>,
        temperature: Option<f32>,
        max_tokens: Option<u32>,
        top_p: Option<f32>,
        top_k: Option<u32>,
        thinking_mode: Option<bool>,
        total_steps: Option<u32>,
    ) -> Result<(), AgentError> {
        // 1. 调用 backend.update_provider 热切换
        // clone provider/model_id 供下面日志使用，避免 move 后借用报错
        self.backend
            .update_provider(provider.clone(), model_id.clone(), api_key, base_url)
            .await
            .map_err(AgentError::from)?;

        // 2. 同步更新 config 的 temperature/max_tokens/top_p/top_k/thinking_mode/total_steps（若传入）
        if temperature.is_some()
            || max_tokens.is_some()
            || top_p.is_some()
            || top_k.is_some()
            || thinking_mode.is_some()
            || total_steps.is_some()
        {
            if let Ok(mut guard) = self.config.write() {
                if let Some(t) = temperature {
                    guard.temperature = Some(t);
                }
                if let Some(m) = max_tokens {
                    guard.max_tokens = Some(m);
                }
                if let Some(p) = top_p {
                    guard.top_p = Some(p);
                }
                if let Some(k) = top_k {
                    guard.top_k = Some(k);
                }
                if let Some(tm) = thinking_mode {
                    guard.thinking_mode = Some(tm);
                }
                // 总步骤预算：clamp 到 1~500（与 AgentLoopConfig 范围约定一致）
                if let Some(s) = total_steps {
                    guard.total_steps = s.clamp(1, 500);
                }
            }
        }

        debug!("update_model: 已切换至 provider={}, model={}", provider, model_id);
        Ok(())
    }

    /// 获取当前 Provider 配置（供 `get_provider_config` 命令回显）
    ///
    /// 由 backend 实现决定是否返回（`GenaiBackend` 返回真实配置）。
    pub async fn current_provider_config(&self) -> Option<ProviderConfig> {
        self.backend.current_provider_config().await
    }

    /// 整体替换 Provider 配置（支持跨模式切换，不清空消息历史）
    ///
    /// 对应 `set_provider_config` 命令，接收完整 [`ProviderConfig`]
    /// （cloud/local/custom 三种模式），由 backend 实现覆盖。
    pub async fn set_provider_config(&self, config: ProviderConfig) -> Result<(), AgentError> {
        self.backend
            .set_provider_config(config)
            .await
            .map_err(AgentError::from)
    }

    /// 注入备用 API Key 池（A2 多 Key 降级）
    ///
    /// 主 key 由 [`Self::set_provider_config`] 写入；`keys` 为备用 key 池，
    /// 主 key 请求命中可重试错误（认证/限流/网络）时逐把降级重试。
    pub async fn set_api_key_pool(&self, keys: Vec<String>) -> Result<(), AgentError> {
        self.backend
            .set_api_key_pool(keys)
            .await
            .map_err(AgentError::from)
    }
}
