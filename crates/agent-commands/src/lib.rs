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
//!
//! ## Phase 5.4 说明
//! `new_agent` 已改用 [`GenaiBackend`]（真实 LLM 后端），从注入的
//! [`RuntimeProviderConfig`] 构造。前端通过 `set_provider_config` 命令写入
//! Provider 配置（含 API Key），`get_provider_config` 回显真实配置。

mod error;
mod mock_backend;
mod subagent;
mod subagent_store;
mod terminal;

pub use error::CommandError;
pub use mock_backend::{MockBackend, thinking_level_to_str};
pub use subagent::{register_subagent_tools, SubAgentInstanceInfo, SubAgentManager};
pub use subagent_store::{SqliteSubAgentSpecStore, SubAgentSpecStore};
pub use terminal::{register_terminal_tools, TerminalService};

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use agent_runtime::agent::{AgentLoop, AgentLoopConfig, AgentStateSnapshot};
use agent_runtime::backend::ThinkingLevel;
use agent_runtime::llm::config::ProviderConfig as RuntimeProviderConfig;
use agent_runtime::llm::GenaiBackend;
use agent_runtime::long_task::HeartbeatStatus;
use agent_runtime::supervisor::SubAgentSpec;
use agent_runtime::tool::SimpleToolBus;
use agent_runtime::types::OrchestratorMessage;
use serde::{Deserialize, Serialize};
use tokio::sync::{Mutex, RwLock};

// ─── 命令参数 / 返回类型 ────────────────────────────────────

/// 会话信息（列表项）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: String,
    pub created_at: u64,
    pub message_count: u32,
}

/// 发送消息参数
///
/// `rename_all = "camelCase"`：Tauri v2 只对顶层命令参数做 camelCase 转换，
/// 嵌套结构体需在 serde 层声明，前端才可用 `sessionId` / `mimeType` 等字段名。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
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

/// Provider 配置（`get_provider_config` 回显的简化视图）
///
/// 仅含 provider / model / base_url 三个展示字段；完整配置（含 API Key、
/// 模式、api_type 等）由 [`RuntimeProviderConfig`] 承载，通过
/// [`AgentCommandService::set_provider_config`] 写入。
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
    /// 子 Agent 规格注册表（跨会话共享，运行期可动态注册）
    ///
    /// 每个会话的 `SubAgentManager` 都持有此共享注册表，因此
    /// `register_subagent_spec` 的变更对所有会话可见。
    subagent_specs: Arc<RwLock<Vec<SubAgentSpec>>>,
    /// 子 Agent 规格持久化存储（可选）
    ///
    /// `None`：纯内存（默认，单测/无持久化场景）；`Some`：构造时从存储 `load_all`
    /// 装入内存注册表，此后注册/删除**写穿**到存储，应用重启后配置不丢失。
    subagent_store: Option<Arc<dyn SubAgentSpecStore>>,
    /// 各会话的子 Agent 管理器（按 session_id 跟踪）
    ///
    /// `new_session` 创建会话时把该会话的 `SubAgentManager` 存入此映射，
    /// 供「清空实例 / 查看实例」命令按会话定位管理器。实例池按会话隔离，
    /// 清空某会话的实例不影响其他会话。
    subagent_managers: Mutex<HashMap<String, Arc<SubAgentManager>>>,
}

/// 校验一个子 Agent 规格是否合法
///
/// 在命令层（`subagent_register_spec`）与批量导入（`import_subagent_specs`）两个入口
/// 统一调用，阻止非法规格进入注册表。返回 `Err` 时携带中文说明，可直接透传给前端展示。
pub fn validate_subagent_spec(spec: &SubAgentSpec) -> Result<(), String> {
    let id = spec.id.trim();
    if id.is_empty() {
        return Err("子 Agent 的 id 不能为空".into());
    }
    if id.len() > 64 {
        return Err("子 Agent 的 id 过长（最多 64 个字符）".into());
    }
    if !id
        .chars()
        .all(|c| c.is_alphanumeric() || c == '_' || c == '-')
    {
        return Err("子 Agent 的 id 仅允许字母、数字、下划线、连字符".into());
    }

    if spec.name.trim().is_empty() {
        return Err(format!("子 Agent [{id}] 的 name 不能为空"));
    }
    if spec.description.trim().is_empty() {
        return Err(format!("子 Agent [{id}] 的 description 不能为空"));
    }
    if spec.system_prompt.trim().is_empty() {
        return Err(format!("子 Agent [{id}] 的 system_prompt 不能为空"));
    }

    if let Some(n) = spec.max_iterations {
        if n == 0 {
            return Err(format!("子 Agent [{id}] 的 max_iterations 必须大于 0"));
        }
    }

    if let Some(tools) = &spec.tools_whitelist {
        if tools.iter().any(|t| t.trim().is_empty()) {
            return Err(format!("子 Agent [{id}] 的工具白名单不能包含空名称"));
        }
    }

    Ok(())
}

impl AgentCommandService {
    /// 创建空服务
    pub fn new() -> Self {
        Self::default()
    }

    /// 创建带持久化存储的服务（启动时把存储中已保存的规格装入内存注册表）
    ///
    /// 用于 Tauri 应用启动：用户在前端「子 Agent」标签页配置的规格会在重启后恢复。
    /// 存储失败（如数据库损坏）时返回 [`CommandError`]，由调用方决定是否降级为纯内存。
    pub async fn with_subagent_store(store: Arc<dyn SubAgentSpecStore>) -> Result<Self, CommandError> {
        let svc = Self {
            subagent_store: Some(store.clone()),
            ..Self::default()
        };
        let loaded = store.load_all().await?;
        *svc.subagent_specs.write().await = loaded;
        Ok(svc)
    }

    /// 构造一个 AgentLoop（Phase 5.4：使用 GenaiBackend 真实 LLM 后端）
    ///
    /// # 参数
    /// - `system_prompt`：系统提示词
    /// - `provider_config`：Provider 配置（cloud/local/custom 三种模式）
    ///   - `Some`：按注入配置构造 GenaiBackend
    ///   - `None`：降级为默认 Cloud 占位（空 API Key，需 `set_provider_config` 后可用）
    async fn new_agent(
        &self,
        system_prompt: Option<String>,
        provider_config: Option<RuntimeProviderConfig>,
    ) -> (Arc<AgentLoop>, Arc<SubAgentManager>) {
        let config = provider_config.unwrap_or_else(Self::default_provider_config);
        let backend = Arc::new(GenaiBackend::new(config));
        let tool_bus = Arc::new(SimpleToolBus::new());
        // 注册终端工具（execute_command + 持久化 shell 会话）
        terminal::register_terminal_tools(&*tool_bus).await;
        // 注册子 Agent 编排工具（delegate_to_sub_agent / list_sub_agents），
        // 共享服务级 `subagent_specs` 注册表，跨会话可见。
        let sub_agent_manager = subagent::register_subagent_tools(
            &*tool_bus,
            backend.clone(),
            tool_bus.clone(),
            self.subagent_specs.clone(),
        )
        .await;
        let agent_config = AgentLoopConfig {
            system_prompt,
            ..Default::default()
        };
        let agent = Arc::new(AgentLoop::new(backend, tool_bus).with_config(agent_config));
        // 将子 Agent 管理器的广播器指向主 Agent 的广播器，
        // 使子 Agent 委派事件（Started/Completed/Error）能透传到订阅主 Agent 的前端。
        sub_agent_manager.set_broadcaster(agent.broadcaster_ref());
        (agent, sub_agent_manager)
    }

    /// 默认 Provider 配置（未注入时使用，空 API Key 占位）
    ///
    /// 使用 DeepSeek 云端占位，便于 `get_provider_config` 有稳定返回值；
    /// 实际使用前前端必须调用 `set_provider_config` 写入真实配置。
    fn default_provider_config() -> RuntimeProviderConfig {
        RuntimeProviderConfig::Cloud {
            provider: "deepseek".into(),
            model_id: "deepseek-v4-flash".into(),
            api_key: String::new(),
        }
    }

    fn now() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    }

    // ── 会话生命周期 ────────────────────────────────────

    /// 新建会话
    ///
    /// # 参数
    /// - `system_prompt`：系统提示词
    /// - `provider_config`：Provider 配置（可选，缺省用默认 Cloud 占位，
    ///   随后可调用 [`Self::set_provider_config`] 写入真实配置）
    pub async fn new_session(
        &self,
        system_prompt: Option<String>,
        provider_config: Option<RuntimeProviderConfig>,
    ) -> Result<SessionInfo, CommandError> {
        let (agent, sub_agent_manager) = self.new_agent(system_prompt, provider_config).await;
        let id = uuid::Uuid::new_v4().to_string();
        let info = SessionInfo {
            id: id.clone(),
            created_at: Self::now(),
            message_count: 0,
        };
        self.sessions.lock().await.insert(id.clone(), agent);
        self.subagent_managers
            .lock()
            .await
            .insert(id.clone(), sub_agent_manager);
        self.meta.lock().await.insert(id.clone(), info.clone());
        Ok(info)
    }

    /// 获取会话（不存在则报错）
    pub async fn get_agent(&self, session_id: &str) -> Result<Arc<AgentLoop>, CommandError> {
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
        self.subagent_managers.lock().await.remove(session_id);
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

    // ── 子 Agent 编排 ────────────────────────────────────

    /// 注册一个子 Agent 规格（同名按 id 覆盖）
    ///
    /// 注册后，后续创建/已有会话的主 Agent 都可通过 `list_sub_agents` 查看、
    /// 通过 `delegate_to_sub_agent` 委派任务。规格注册表跨会话共享。
    ///
    /// 同名（相同 `id`）规格会覆盖旧定义，避免重复 push 导致列表出现重复项。
    /// 若配置了持久化存储，本方法会**写穿**到存储（异步，失败仅记日志不阻断内存更新）。
    pub async fn register_subagent_spec(&self, spec: SubAgentSpec) {
        {
            let mut specs = self.subagent_specs.write().await;
            if let Some(existing) = specs.iter_mut().find(|s| s.id == spec.id) {
                *existing = spec.clone();
            } else {
                specs.push(spec.clone());
            }
        } // 释放写锁后再写库，避免 DB I/O 期间阻塞其他读
        if let Some(store) = &self.subagent_store {
            if let Err(e) = store.upsert(&spec).await {
                tracing::warn!("持久化子 Agent 规格失败（仅内存生效）: {e}");
            }
        }
    }

    /// 删除一个子 Agent 规格（按 id）
    ///
    /// 返回是否删除成功（id 不存在时返回 `false`）。仅操作共享注册表，
    /// 不影响子 Agent 实例池——池中实例懒加载，下次委派按最新规格重建。
    /// 若配置了持久化存储，删除会**写穿**到存储。
    pub async fn remove_subagent_spec(&self, id: &str) -> bool {
        let removed = {
            let mut specs = self.subagent_specs.write().await;
            let before = specs.len();
            specs.retain(|s| s.id != id);
            specs.len() != before
        };
        if removed {
            if let Some(store) = &self.subagent_store {
                if let Err(e) = store.remove(id).await {
                    tracing::warn!("删除持久化子 Agent 规格失败: {e}");
                }
            }
        }
        removed
    }

    /// 列出已注册的子 Agent 规格
    pub async fn list_subagent_specs(&self) -> Vec<SubAgentSpec> {
        self.subagent_specs.read().await.clone()
    }

    /// 列出某会话子 Agent 实例池中所有活跃实例的对外信息
    ///
    /// 实例池按会话隔离：返回该 `session_id` 对应 `SubAgentManager` 的实例快照。
    /// 会话不存在时返回 [`CommandError::session_not_found`]。
    pub async fn list_subagent_instances(
        &self,
        session_id: &str,
    ) -> Result<Vec<SubAgentInstanceInfo>, CommandError> {
        let manager = self
            .subagent_managers
            .lock()
            .await
            .get(session_id)
            .cloned()
            .ok_or_else(|| CommandError::session_not_found(session_id))?;
        Ok(manager.list_instances().await)
    }

    /// 清空某会话的单个子 Agent 实例（重置其累积上下文）
    ///
    /// 返回是否成功移除（该 id 在实例池中不存在时返回 `false`）。
    /// 清空后该子 Agent 下次委派时按最新注册规格懒加载重建（全新上下文）。
    /// 与 [`Self::clear_subagent_instances`] 的清空全部互补，用于只重置
    /// 某个行为异常/上下文膨胀的单个子 Agent，而不影响其他实例。
    pub async fn clear_subagent_instance(
        &self,
        session_id: &str,
        sub_agent_id: &str,
    ) -> Result<bool, CommandError> {
        let manager = self
            .subagent_managers
            .lock()
            .await
            .get(session_id)
            .cloned()
            .ok_or_else(|| CommandError::session_not_found(session_id))?;
        Ok(manager.clear_instance(sub_agent_id).await)
    }

    /// 清空某会话的全部子 Agent 实例（重置累积上下文）
    ///
    /// 返回被清空的实例数量。清空后该会话下次委派时按最新注册规格重建实例。
    /// 单聊会话常用 `clear_agent_pool` 清主 Agent 上下文，子 Agent 实例池此前
    /// 无对应能力，本方法补齐该缺口。
    pub async fn clear_subagent_instances(&self, session_id: &str) -> Result<usize, CommandError> {
        let manager = self
            .subagent_managers
            .lock()
            .await
            .get(session_id)
            .cloned()
            .ok_or_else(|| CommandError::session_not_found(session_id))?;
        Ok(manager.clear_instances().await)
    }

    /// 导出全部子 Agent 规格为 JSON 字符串（pretty 打印，便于人读与 diff）
    ///
    /// 用作备份或跨机器迁移：前端把返回的 JSON 保存为文件，换机后通过
    /// [`Self::import_subagent_specs`] 恢复。
    pub async fn export_subagent_specs(&self) -> Result<String, CommandError> {
        let specs = self.list_subagent_specs().await;
        serde_json::to_string_pretty(&specs)
            .map_err(|e| CommandError::Internal(format!("序列化子 Agent 规格失败: {e}")))
    }

    /// 从 JSON 字符串导入子 Agent 规格（按 id 覆盖，等同逐条 register）
    ///
    /// 接受 [`Self::export_subagent_specs`] 产生的数组 JSON。返回实际导入条数；
    /// JSON 结构非法或任一条规格校验不过时返回 [`CommandError`]（此时不写入任何规格，
    /// 保持原子性——要么全部导入，要么全部不导入）。
    pub async fn import_subagent_specs(&self, json: &str) -> Result<usize, CommandError> {
        let specs: Vec<SubAgentSpec> = serde_json::from_str(json)
            .map_err(|e| CommandError::Internal(format!("解析子 Agent 规格 JSON 失败: {e}")))?;
        // 先整体校验，任一非法即整体拒绝，避免部分写入
        for spec in specs.iter() {
            validate_subagent_spec(spec).map_err(CommandError::invalid_argument)?;
        }
        for spec in specs.iter() {
            self.register_subagent_spec(spec.clone()).await;
        }
        Ok(specs.len())
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

    /// 获取 Provider 配置（Phase 5.4：回显真实运行配置）
    pub async fn get_provider_config(&self, session_id: &str) -> Result<ProviderConfig, CommandError> {
        let agent = self.get_agent(session_id).await?;
        let cfg = agent
            .current_provider_config()
            .await
            .unwrap_or_else(Self::default_provider_config);
        Ok(ProviderConfig {
            provider: cfg.provider_id().to_string(),
            model: cfg.model_id().to_string(),
            base_url: Some(cfg.resolve_base_url()),
        })
    }

    /// 整体写入 Provider 配置（Phase 5.4：真实 LLM 后端接入）
    ///
    /// 接收完整 [`RuntimeProviderConfig`]（cloud/local/custom 三种模式），
    /// 前端从本地存储读取配置 + API Key 后传入。支持跨模式切换，不清空消息历史。
    pub async fn set_provider_config(
        &self,
        session_id: &str,
        config: RuntimeProviderConfig,
    ) -> Result<(), CommandError> {
        let agent = self.get_agent(session_id).await?;
        agent.set_provider_config(config).await.map_err(CommandError::from)
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

    fn cloud_config(api_key: &str) -> RuntimeProviderConfig {
        RuntimeProviderConfig::Cloud {
            provider: "deepseek".into(),
            model_id: "deepseek-v4-flash".into(),
            api_key: api_key.into(),
        }
    }

    #[tokio::test]
    async fn new_session_and_provider_config_roundtrip() {
        let svc = AgentCommandService::new();
        let info = svc
            .new_session(Some("测试助手".into()), Some(cloud_config("sk-test")))
            .await
            .unwrap();
        let cfg = svc.get_provider_config(&info.id).await.unwrap();
        // 回显真实配置（provider / model），而非 mock 占位
        assert_eq!(cfg.provider, "deepseek");
        assert_eq!(cfg.model, "deepseek-v4-flash");
        assert!(cfg.base_url.is_some());
    }

    #[tokio::test]
    async fn send_message_without_api_key_fails() {
        let svc = AgentCommandService::new();
        // 空 API Key 的 Cloud 配置 → 发送消息应报 Auth 错误（而非回显 mock）
        let info = svc
            .new_session(Some("测试助手".into()), Some(cloud_config("")))
            .await
            .unwrap();
        let err = svc
            .send_message(SendMessageParams {
                session_id: info.id.clone(),
                text: "你好".into(),
                images: vec![],
                mode: None,
            })
            .await
            .unwrap_err();
        assert!(matches!(err, CommandError::Agent(_)));
    }

    #[tokio::test]
    async fn set_provider_config_updates_backend() {
        let svc = AgentCommandService::new();
        // 创建会话时不注入配置（用默认占位）
        let info = svc.new_session(None, None).await.unwrap();
        // 前端写入真实配置（含 API Key）
        svc.set_provider_config(&info.id, cloud_config("sk-real")).await.unwrap();
        let cfg = svc.get_provider_config(&info.id).await.unwrap();
        assert_eq!(cfg.provider, "deepseek");
        assert_eq!(cfg.model, "deepseek-v4-flash");
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
        let info = svc.new_session(None, None).await.unwrap();
        let list = svc.list_sessions().await.unwrap();
        assert_eq!(list.len(), 1);
        svc.delete_session(&info.id).await.unwrap();
        assert!(svc.list_sessions().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn register_subagent_spec_is_shared_across_sessions() {
        let svc = AgentCommandService::new();
        // 先注册规格，再创建两个会话
        svc.register_subagent_spec(SubAgentSpec {
            id: "coder".into(),
            name: "代码助手".into(),
            description: "处理代码编写任务".into(),
            system_prompt: "你是代码专家".into(),
            tools_whitelist: None,
            max_iterations: Some(3),
        })
        .await;
        let s1 = svc.new_session(None, None).await.unwrap();
        let s2 = svc.new_session(None, None).await.unwrap();
        // 服务级注册表可见
        assert_eq!(svc.list_subagent_specs().await.len(), 1);
        // 两个会话共享同一注册表（各自 Agent 的 SubAgentManager 持同一 Arc）
        assert_eq!(s1.id.len(), 36);
        assert_eq!(s2.id.len(), 36);
    }

    #[tokio::test]
    async fn register_subagent_spec_overrides_by_id() {
        let svc = AgentCommandService::new();
        let mut spec = SubAgentSpec {
            id: "coder".into(),
            name: "代码助手".into(),
            description: "处理代码编写任务".into(),
            system_prompt: "你是代码专家".into(),
            tools_whitelist: None,
            max_iterations: Some(3),
        };
        svc.register_subagent_spec(spec.clone()).await;
        // 同名 id 覆盖，不产生重复项
        spec.name = "新版代码助手".into();
        svc.register_subagent_spec(spec).await;
        let list = svc.list_subagent_specs().await;
        assert_eq!(list.len(), 1, "同名 id 应覆盖而非追加");
        assert_eq!(list[0].name, "新版代码助手", "应取最新定义");
    }

    #[tokio::test]
    async fn remove_subagent_spec_returns_removed_flag() {
        let svc = AgentCommandService::new();
        svc.register_subagent_spec(SubAgentSpec {
            id: "coder".into(),
            name: "代码助手".into(),
            description: "处理代码编写任务".into(),
            system_prompt: "你是代码专家".into(),
            tools_whitelist: None,
            max_iterations: Some(3),
        })
        .await;
        // 删除存在的规格返回 true
        let removed = svc.remove_subagent_spec("coder").await;
        assert!(removed, "删除存在的规格应返回 true");
        assert!(svc.list_subagent_specs().await.is_empty());
        // 删除不存在的规格返回 false
        let removed = svc.remove_subagent_spec("nonexistent").await;
        assert!(!removed, "删除不存在的规格应返回 false");
    }

    #[tokio::test]
    async fn subagent_specs_persist_through_store() {
        // 用内存 store 模拟持久化层；注册写穿 → 新建服务复用同一 store → 启动加载
        let store = SqliteSubAgentSpecStore::new_in_memory().await.unwrap();
        let svc = AgentCommandService::with_subagent_store(store.clone())
            .await
            .expect("带存储构造服务应成功");
        svc.register_subagent_spec(SubAgentSpec {
            id: "coder".into(),
            name: "代码助手".into(),
            description: "处理代码编写任务".into(),
            system_prompt: "你是代码专家".into(),
            tools_whitelist: Some(vec!["execute_command".into()]),
            max_iterations: Some(3),
        })
        .await;
        assert_eq!(svc.list_subagent_specs().await.len(), 1);

        // 模拟"应用重启"：用同一 store 新建服务，应从存储加载回规格
        let svc2 = AgentCommandService::with_subagent_store(store)
            .await
            .expect("二次构造应成功");
        let restored = svc2.list_subagent_specs().await;
        assert_eq!(restored.len(), 1, "重启后应恢复已持久化的规格");
        assert_eq!(restored[0].id, "coder");
        assert_eq!(
            restored[0].tools_whitelist,
            Some(vec!["execute_command".into()]),
            "写穿应保留完整字段（含白名单）"
        );
    }

    #[tokio::test]
    async fn remove_subagent_spec_persists_through_store() {
        let store = SqliteSubAgentSpecStore::new_in_memory().await.unwrap();
        let svc = AgentCommandService::with_subagent_store(store.clone())
            .await
            .unwrap();
        svc.register_subagent_spec(SubAgentSpec {
            id: "coder".into(),
            name: "代码助手".into(),
            description: "处理代码编写任务".into(),
            system_prompt: "你是代码专家".into(),
            tools_whitelist: None,
            max_iterations: Some(3),
        })
        .await;
        svc.register_subagent_spec(SubAgentSpec {
            id: "writer".into(),
            name: "写作助手".into(),
            description: "处理写作任务".into(),
            system_prompt: "你是写作专家".into(),
            tools_whitelist: None,
            max_iterations: Some(3),
        })
        .await;
        assert!(svc.remove_subagent_spec("coder").await);

        // 重启后 coder 不应残留，writer 应保留
        let svc2 = AgentCommandService::with_subagent_store(store)
            .await
            .unwrap();
        let restored = svc2.list_subagent_specs().await;
        assert_eq!(restored.len(), 1, "删除应写穿，重启后不残留已删规格");
        assert_eq!(restored[0].id, "writer");
    }

    #[tokio::test]
    async fn export_import_subagent_specs_roundtrip() {
        let svc = AgentCommandService::new();
        svc.register_subagent_spec(SubAgentSpec {
            id: "coder".into(),
            name: "代码助手".into(),
            description: "处理代码编写任务".into(),
            system_prompt: "你是代码专家".into(),
            tools_whitelist: Some(vec!["execute_command".into()]),
            max_iterations: Some(3),
        })
        .await;
        svc.register_subagent_spec(SubAgentSpec {
            id: "writer".into(),
            name: "写作助手".into(),
            description: "处理写作任务".into(),
            system_prompt: "你是写作专家".into(),
            tools_whitelist: None,
            max_iterations: None,
        })
        .await;

        // 导出为 JSON → 导入到全新服务（模拟跨机迁移）
        let json = svc.export_subagent_specs().await.unwrap();
        assert!(json.contains("coder"), "导出 JSON 应包含全部规格");
        assert!(json.contains("writer"), "导出 JSON 应包含全部规格");

        let svc2 = AgentCommandService::new();
        let n = svc2.import_subagent_specs(&json).await.unwrap();
        assert_eq!(n, 2, "导入应返回实际条数");
        let restored = svc2.list_subagent_specs().await;
        assert_eq!(restored.len(), 2, "导入后应恢复全部规格");
        let coder = restored.iter().find(|s| s.id == "coder").unwrap();
        assert_eq!(
            coder.tools_whitelist,
            Some(vec!["execute_command".into()]),
            "导入应保留完整字段（含白名单）"
        );
    }

    #[tokio::test]
    async fn import_subagent_specs_overrides_by_id() {
        let svc = AgentCommandService::new();
        svc.register_subagent_spec(SubAgentSpec {
            id: "coder".into(),
            name: "旧代码助手".into(),
            description: "旧描述".into(),
            system_prompt: "旧提示词".into(),
            tools_whitelist: None,
            max_iterations: None,
        })
        .await;

        // 导入含同名 id 的新定义 → 应覆盖而非追加
        let json = r#"[{"id":"coder","name":"新代码助手","description":"新描述","system_prompt":"新提示词","tools_whitelist":["execute_command"],"max_iterations":5}]"#;
        let n = svc.import_subagent_specs(json).await.unwrap();
        assert_eq!(n, 1);
        let list = svc.list_subagent_specs().await;
        assert_eq!(list.len(), 1, "同名 id 导入应覆盖而非追加");
        assert_eq!(list[0].name, "新代码助手");
        assert_eq!(list[0].max_iterations, Some(5));
    }

    #[tokio::test]
    async fn import_subagent_specs_invalid_json_rejected() {
        let svc = AgentCommandService::new();
        let err = svc.import_subagent_specs("not-json").await.unwrap_err();
        assert!(matches!(err, CommandError::Internal(_)), "非法 JSON 应报错");
        assert!(
            svc.list_subagent_specs().await.is_empty(),
            "非法导入不应写入任何规格"
        );
    }

    #[test]
    fn validate_subagent_spec_accepts_valid() {
        let spec = SubAgentSpec {
            id: "coder".into(),
            name: "代码助手".into(),
            description: "处理代码编写".into(),
            system_prompt: "你是代码专家".into(),
            tools_whitelist: Some(vec!["execute_command".into()]),
            max_iterations: Some(3),
        };
        assert!(validate_subagent_spec(&spec).is_ok());
        // 白名单与 max_iterations 均可省略
        let minimal = SubAgentSpec {
            id: "writer".into(),
            name: "写作".into(),
            description: "写作".into(),
            system_prompt: "写作专家".into(),
            tools_whitelist: None,
            max_iterations: None,
        };
        assert!(validate_subagent_spec(&minimal).is_ok());
    }

    #[test]
    fn validate_subagent_spec_rejects_invalid() {
        let base = SubAgentSpec {
            id: "coder".into(),
            name: "代码助手".into(),
            description: "处理代码编写".into(),
            system_prompt: "你是代码专家".into(),
            tools_whitelist: None,
            max_iterations: None,
        };
        // 空 id
        assert!(validate_subagent_spec(&SubAgentSpec { id: "".into(), ..base.clone() }).is_err());
        // 非法字符 id
        assert!(validate_subagent_spec(&SubAgentSpec { id: "a b".into(), ..base.clone() }).is_err());
        assert!(validate_subagent_spec(&SubAgentSpec { id: "a/b".into(), ..base.clone() }).is_err());
        // 超长 id
        assert!(validate_subagent_spec(&SubAgentSpec {
            id: "x".repeat(65),
            ..base.clone()
        })
        .is_err());
        // 空 name / description / system_prompt
        assert!(validate_subagent_spec(&SubAgentSpec { name: "".into(), ..base.clone() }).is_err());
        assert!(validate_subagent_spec(&SubAgentSpec {
            description: "".into(),
            ..base.clone()
        })
        .is_err());
        assert!(validate_subagent_spec(&SubAgentSpec {
            system_prompt: "".into(),
            ..base.clone()
        })
        .is_err());
        // max_iterations = 0 非法
        assert!(validate_subagent_spec(&SubAgentSpec {
            max_iterations: Some(0),
            ..base.clone()
        })
        .is_err());
        // 白名单含空名非法
        assert!(validate_subagent_spec(&SubAgentSpec {
            tools_whitelist: Some(vec!["".into()]),
            ..base.clone()
        })
        .is_err());
    }

    #[tokio::test]
    async fn import_subagent_specs_rejects_invalid_atomically() {
        let svc = AgentCommandService::new();
        // 第一条合法、第二条 id 为空 → 整体应被拒绝，合法那条也不写入
        let json = r#"[
            {"id":"ok","name":"合法","description":"描述","system_prompt":"提示词"},
            {"id":"","name":"非法","description":"描述","system_prompt":"提示词"}
        ]"#;
        let err = svc.import_subagent_specs(json).await.unwrap_err();
        assert!(
            matches!(err, CommandError::InvalidArgument(_)),
            "含非法规格应报参数错误，实际: {err}"
        );
        assert!(
            svc.list_subagent_specs().await.is_empty(),
            "整体校验失败时不应写入任何规格（原子性）"
        );
    }

    /// 实例管理按会话隔离：会话不存在时 list/clear 应报 session_not_found
    #[tokio::test]
    async fn subagent_instances_guard_requires_existing_session() {
        let svc = AgentCommandService::new();
        let err_list = svc.list_subagent_instances("nope").await.unwrap_err();
        assert!(
            matches!(err_list, CommandError::SessionNotFound(_)),
            "list 不存在的会话应报 session_not_found，实际: {err_list}"
        );
        let err_clear = svc.clear_subagent_instances("nope").await.unwrap_err();
        assert!(
            matches!(err_clear, CommandError::SessionNotFound(_)),
            "clear 不存在的会话应报 session_not_found，实际: {err_clear}"
        );
    }

    /// 会话存在时，list 返回当前会话的实例（初始为空），clear 清空返回 0
    #[tokio::test]
    async fn subagent_instances_empty_until_delegation() {
        let svc = AgentCommandService::new();
        let info = svc.new_session(None, None).await.unwrap();
        // 未委派任何子 Agent 前，实例池为空
        let instances = svc.list_subagent_instances(&info.id).await.unwrap();
        assert!(instances.is_empty(), "未委派前实例池应为空");
        // 清空空池返回 0
        let cleared = svc.clear_subagent_instances(&info.id).await.unwrap();
        assert_eq!(cleared, 0, "空池清空应返回 0");
    }

    /// 单个实例清空：会话不存在报 session_not_found；会话存在但实例不存在返回 false
    #[tokio::test]
    async fn subagent_clear_instance_guards() {
        let svc = AgentCommandService::new();
        // 不存在的会话 → SessionNotFound
        let err = svc.clear_subagent_instance("nope", "coder").await.unwrap_err();
        assert!(
            matches!(err, CommandError::SessionNotFound(_)),
            "清空不存在的会话应报 session_not_found，实际: {err}"
        );
        // 会话存在但实例从未创建 → 返回 false（不报错）
        let info = svc.new_session(None, None).await.unwrap();
        let removed = svc.clear_subagent_instance(&info.id, "coder").await.unwrap();
        assert!(!removed, "实例池中无该实例时清空应返回 false");
    }

    /// 删除会话后，其实例管理器也应随之移除（list 应报 session_not_found）
    #[tokio::test]
    async fn delete_session_removes_subagent_manager() {
        let svc = AgentCommandService::new();
        let info = svc.new_session(None, None).await.unwrap();
        svc.delete_session(&info.id).await.unwrap();
        let err = svc.list_subagent_instances(&info.id).await.unwrap_err();
        assert!(
            matches!(err, CommandError::SessionNotFound(_)),
            "删除会话后 list 实例应报 session_not_found，实际: {err}"
        );
    }
}