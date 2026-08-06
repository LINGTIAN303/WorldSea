//! agent-commands 命令层（服务层）：封装 AgentLoop 能力为 Tauri 可调用的命令服务，详细见 docs/details/注释/agent-commands/lib.md

mod error;
mod long_task_store;
mod loop_control;
mod mock_backend;
mod subagent;
mod subagent_store;
mod terminal;

pub use error::CommandError;
pub use long_task_store::LongTaskRepository;
pub use loop_control::{
    LoopControlCheckResult, LoopControlEntry, LoopControlRegistry, LoopControlRegistryError,
    LoopControlStatus,
};
pub use mock_backend::{MockBackend, thinking_level_to_str};
pub use subagent::{register_subagent_tools, SubAgentInstanceInfo, SubAgentManager};
pub use subagent_store::{SqliteSubAgentSpecStore, SubAgentSpecStore};
pub use terminal::{register_terminal_tools, TerminalService};

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use agent_memory::MemoryCenterAccessor;
use agent_runtime::agent::{AgentLoop, AgentLoopConfig, AgentStateSnapshot};
use agent_runtime::backend::ThinkingLevel;
use agent_runtime::llm::config::ProviderConfig as RuntimeProviderConfig;
use agent_runtime::llm::GenaiBackend;
use agent_runtime::long_task::HeartbeatStatus;
use agent_runtime::memory::MemoryAccessor;
use agent_runtime::supervisor::SubAgentSpec;
use memory_center_core::model::ArchiveConfig;
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
    /// Loop Control 注册表（按 task_id 管理 LoopController 实例）
    ///
    /// 默认自建独立实例；Tauri 端用 [`Self::with_loop_control_registry`] 注入
    /// 与命令层共享的同一实例，使「内建自动（AgentLoop 内）与命令层手动」
    /// 操作同一份控制器状态，消除双轨不共享。
    loop_control_registry: Arc<LoopControlRegistry>,
    /// 记忆存储根目录（SQLite 落盘路径，来自 tauri 应用数据目录）
    ///
    /// `None`：不启用长期记忆（默认）；`Some`：`new_session` 时为每个会话构造
    /// `MemoryCenterAccessor` 并注入 `AgentLoop`（通过 `with_memory`）。
    memory_root: Option<PathBuf>,
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

    /// 注入共享的 Loop Control 注册表（链式）
    ///
    /// 默认服务自建独立注册表；Tauri 端把命令层 `LoopControlRegistry` 传入，
    /// 使 `cmd_loop_control_*` 与 [`Self::register_session_loop_control`] 操作同一实例。
    pub fn with_loop_control_registry(self, registry: Arc<LoopControlRegistry>) -> Self {
        Self {
            loop_control_registry: registry,
            ..self
        }
    }

    /// 获取 Loop Control 注册表引用（Arc 克隆）
    pub fn loop_control_registry(&self) -> Arc<LoopControlRegistry> {
        self.loop_control_registry.clone()
    }

    /// 设置记忆存储根目录（链式）
    ///
    /// 传入应用数据目录子路径（如 `{app_data}/worldsmith/memory`）。设置后
    /// `new_session` 会为每个会话构造 `MemoryCenterAccessor` 并注入 AgentLoop。
    pub fn with_memory_root(mut self, root: Option<PathBuf>) -> Self {
        self.memory_root = root;
        self
    }

    /// 把指定会话的内建 LoopController 注册为 loop_control 任务（共享同一实例）
    ///
    /// 解决"内建（自动）与命令层（手动）双轨不共享"：取该会话 `AgentLoop` 内建的
    /// `Arc<LoopController>` 注册为 `task_id` 对应条目，使手动命令与自动驱动
    /// 操作同一份速率/超时/看门狗状态。
    ///
    /// # 错误
    /// - 会话不存在：`SessionNotFound`
    /// - task_id 已存在：注册表 `AlreadyExists`（包装为 `Internal`）
    pub async fn register_session_loop_control(
        &self,
        task_id: impl Into<String>,
        session_id: &str,
    ) -> Result<(), CommandError> {
        let task_id = task_id.into();
        let agent = {
            let sessions = self.sessions.lock().await;
            sessions
                .get(session_id)
                .cloned()
                .ok_or_else(|| CommandError::session_not_found(session_id))?
        };
        let controller = agent.loop_controller().clone();
        let config = controller.config();
        let entry = LoopControlEntry::new(controller, config);
        self.loop_control_registry
            .register(task_id, entry)
            .await
            .map_err(|e| CommandError::Internal(e.to_string()))?;
        Ok(())
    }

    /// 构造会话级 MemoryCenterAccessor（记忆适配层）
    ///
    /// 以 `root` 为存储根目录、`session_id` 为记忆隔离依据，为每个会话创建独立的
    /// SQLite 记忆后端。`project_id` 传 `None`（单聊按会话隔离，跨会话聚合检索暂不启用）。
    fn build_memory_accessor(
        root: &PathBuf,
        session_id: &str,
    ) -> std::result::Result<Arc<dyn MemoryAccessor>, agent_memory::Error> {
        // 归档阈值：MemoryCenter 默认 400K（生产长会话），对 Agent 会话过大——
        // 真实对话几乎达不到，归档永不触发。取 2000 token（约 10-20 轮普通对话）
        // 让阶段 3 闭环（归档 → 检索 → 注入）可在会话内验证，后续可按需调整。
        let config = ArchiveConfig::from_threshold(2000);
        let accessor = MemoryCenterAccessor::new_sqlite(root.clone(), session_id, None, config)?;
        Ok(Arc::new(accessor))
    }

    /// 构造一个 AgentLoop（Phase 5.4：使用 GenaiBackend 真实 LLM 后端）
    ///
    /// # 参数
    /// - `session_id`：会话 ID（记忆隔离依据，构造 MemoryCenterAccessor 用）
    /// - `system_prompt`：系统提示词
    /// - `provider_config`：Provider 配置（cloud/local/custom 三种模式）
    ///   - `Some`：按注入配置构造 GenaiBackend
    ///   - `None`：降级为默认 Cloud 占位（空 API Key，需 `set_provider_config` 后可用）
    async fn new_agent(
        &self,
        session_id: &str,
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
        let mut agent_builder = AgentLoop::new(backend, tool_bus).with_config(agent_config);
        // 记忆注入：配置了 memory_root 时为该会话构造 MemoryCenterAccessor 并注入，
        // 失败仅告警不阻断（弱提示语义，记忆不可用不影响主流程）。
        if let Some(root) = &self.memory_root {
            match Self::build_memory_accessor(root, session_id) {
                Ok(memory) => {
                    agent_builder = agent_builder.with_memory(Some(memory));
                }
                Err(e) => {
                    tracing::warn!("构造 MemoryCenterAccessor 失败，跳过记忆注入: {e}");
                }
            }
        }
        let agent = Arc::new(agent_builder);
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
        // 先生成会话 ID，作为记忆隔离依据传入 new_agent（构造 MemoryCenterAccessor）
        let id = uuid::Uuid::new_v4().to_string();
        let (agent, sub_agent_manager) = self.new_agent(&id, system_prompt, provider_config).await;
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

    /// 清理上下文窗口（移除前 up_to_index 条消息，同步 backend 与 state）
    ///
    /// 对应前端 `trimContext(upToIndex)`。用于长对话压缩上下文窗口，
    /// 避免超出模型 context window。移除后按剩余消息数刷新会话 message_count。
    pub async fn trim_context(&self, session_id: &str, up_to_index: usize) -> Result<(), CommandError> {
        let agent = self.get_agent(session_id).await?;
        agent.trim_context(up_to_index).await?;
        let count = agent.get_messages().await.len() as u32;
        if let Some(meta) = self.meta.lock().await.get_mut(session_id) {
            meta.message_count = count;
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

#[cfg(test)]
#[path = "lib_tests.rs"]
mod tests;
