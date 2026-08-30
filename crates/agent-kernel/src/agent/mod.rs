//! AgentLoop — ReAct 模式的核心循环，详细见 docs/details/注释/agent-runtime/agent.md

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock as StdRwLock};
use std::time::Instant;

use tokio::sync::{Mutex as AsyncMutex, RwLock};
use tracing::{debug, error, info, warn};

use crate::backend::NodeBackendAccessor;
use crate::confirmation::{ConfirmationBroker, ConfirmationPolicy};
use crate::event::{AgentEvent, EventBroadcaster, EventListener, OrchestratorEvent};
use crate::loop_control::{LoopControlConfig, LoopController};
use crate::long_task::{CheckpointProvider, LongTaskManager};
use crate::router_decider::{Pipeline, RouterDecider};
use crate::tool::ToolBus;
use crate::types::{MessageRole, OrchestratorMessage, PlanItem, ToolCall};

// 仅供 tests.rs（`use super::*` glob 引入）使用的类型，非 test 构建下不参与编译
#[cfg(test)]
use crate::backend::{BackendError, PromptCallOptions};

mod backend_bridge;
mod config;
mod error;
mod hooks;
mod interaction;
mod llm;
mod long_task;
mod loop_control;
mod memory;
mod state;
mod tools;

pub use config::AgentLoopConfig;
pub use error::AgentError;
pub use hooks::{AgentLoopHook, AgentLoopHooks, HookContext, RunPhase};
pub use state::{AgentState, AgentStateSnapshot};

use backend_bridge::BackendEventBridge;

// ─── AgentLoop ────────────────────────────────────────────

/// 会话累计用量（input/output tokens）
#[derive(Debug, Clone, Default)]
pub struct UsageAccum {
    pub input_tokens: u64,
    pub output_tokens: u64,
}

/// AgentLoop — ReAct 模式的核心循环，详细见 docs/details/注释/agent-runtime/agent.md
pub struct AgentLoop {
    /// LLM 后端访问器
    backend: Arc<dyn NodeBackendAccessor>,
    /// 工具总线
    tool_bus: Arc<dyn ToolBus>,
    /// 运行时状态（线程安全）
    state: Arc<AsyncMutex<AgentState>>,
    /// 配置（用 std::sync::RwLock，便于 `with_config` 同步链式调用）
    ///
    /// 选用 `std::sync::RwLock` 而非 `tokio::sync::RwLock` 的原因：
    /// - 配置写入是短临界区，不涉及 await，不会阻塞异步运行时
    /// - 同步锁允许 `with_config` 保持同步签名，便于链式调用
    config: Arc<StdRwLock<AgentLoopConfig>>,
    /// 会话绑定的工作区根目录（从 `config.workdir` 读取）
    ///
    /// 用于构造 [`crate::tool_context::ToolContext`] 并注入到工具执行，
    /// 使 FS 类工具能基于该目录解析相对路径。与 `config.workdir` 保持一致
    /// （`with_config`/`set_config` 同步更新）。
    ///
    /// 选用 `Arc<StdRwLock<...>>` 而非普通字段：`set_config` 接收 `&self`，
    /// 无法直接写普通字段；用锁包裹后 `with_config`/`set_config` 均可更新，
    /// 且工具执行时读取（短临界区，不跨 await）。
    workdir: Arc<StdRwLock<Option<std::path::PathBuf>>>,
    /// 会话绑定的 Workspace 实体 id（从 `config.workspace_id` 读取）
    ///
    /// 用于构造 [`crate::tool_context::ToolContext`] 并注入到工具执行（Phase A）。
    /// 与 `config.workspace_id` 保持一致（`with_config`/`set_config` 同步更新）。
    workspace_id: Arc<StdRwLock<Option<String>>>,
    /// 事件广播器
    broadcaster: Arc<RwLock<EventBroadcaster>>,
    /// 是否正在流式输出（run 方法活跃中）
    ///
    /// 使用 `AtomicBool` 而非 `Mutex<bool>`，因为：
    /// 1. 只需布尔标志，无需复杂状态机
    /// 2. 原子操作足够保证可见性，且不阻塞异步任务
    /// 3. 前端 `IAgentBackend.isStreaming` 通过 `is_streaming()` 读取
    is_streaming: Arc<AtomicBool>,
    /// 长任务管理器（Loop Engineering 核心组件），详细见 docs/details/注释/agent-runtime/agent.md
    long_task_manager: Arc<LongTaskManager>,
    /// 最近一次用户输入文本（用于 `CheckpointProvider::get_checkpoint` 填充 last_user_text）
    ///
    /// 在 `run` / `follow_up` 中更新。使用 `StdRwLock`（不跨 await 持有）：
    /// - 写入：`run` 方法开头同步写入（不持锁跨 await）
    /// - 读取：`get_checkpoint` 中同步读取（不持锁跨 await）
    last_user_text: Arc<StdRwLock<String>>,
    /// 最近一次 LLM 调用时间（用于限流：`min_interval_between_calls`）
    ///
    /// 使用 `std::sync::Mutex`（同步锁，不跨 await 持有）：
    /// - 写入：`call_llm_with_retry` 内每次调用前/后同步写入
    /// - 读取：`call_llm_with_retry` 内同步读取计算需等待的时间
    ///
    /// 选用 `std::sync::Mutex` 而非 `tokio::sync::Mutex` 的原因：
    /// 临界区极短（仅读写一个 `Option<Instant>`），不涉及 await，同步锁开销更低。
    last_llm_call_time: Arc<std::sync::Mutex<Option<Instant>>>,
    /// 最近一次 Deep Mode 阶段标签，详细见 docs/details/注释/agent-runtime/agent.md
    last_phase_label: Arc<StdRwLock<Option<String>>>,
    /// 内建 LoopController（Loop Engineering 批次5 新增）
    ///
    /// 聚合 RateLimiter/RetryPolicy/SoftTimeout/Watchdog，在 ReAct 循环内部自动驱动。
    /// 与命令层 `LoopControlRegistry`（按 task_id 手动控制）互补：
    /// - 本字段：AgentLoop 内建自动控制（每轮 check + 事件 + 停止）
    /// - 命令层：前端手动触发 `check_and_emit` / `record_turn` 等
    ///
    /// 无锁设计（RateLimiter 用 Atomic，SoftTimeout/Watchdog 用同步锁），
    /// 不跨 await 持有，可直接在异步循环中调用。
    loop_controller: Arc<LoopController>,
    /// 内建 LoopController 上一轮是否处于告警锁存态（软超时/看门狗已触发）
    ///
    /// 用于恢复边沿检测：`loop_controller.is_alerted()` 由 `true → false` 跳变时
    /// emit `LoopEngRecovered`。基于底层触发标志而非 check 返回级别，避免
    /// 软超时锁存后"后续 check 返回 None"被误判为恢复。
    loop_control_warned: Arc<AtomicBool>,
    /// 会话累计用量（input/output tokens，供前端用量面板）
    ///
    /// 每轮 LLM 调用后从 `PromptResponse` 累加；`get_usage` 读取。
    usage: Arc<AsyncMutex<UsageAccum>>,
    /// 记忆访问器（阶段 3：记忆闭环）
    ///
    /// 提供 recall / inject / record_turn / archive 织入能力。
    /// 通过 `with_memory(Some(...))` 启用；默认 `None`（不启用记忆）。
    memory: Option<Arc<dyn crate::memory::MemoryAccessor>>,
    /// 最近一次记忆注入文本（阶段 3：记忆闭环）
    ///
    /// 每次 `run` 开头重新计算（recall → inject），供 `build_prompt_options`
    /// 拼入 `system_prompt_override`。使用 `StdRwLock`（短临界区，不跨 await 持有）。
    memory_context: Arc<StdRwLock<Option<String>>>,
    /// HITL 确认协调器（A5，`None`=不启用确认）
    ///
    /// 通过 `with_confirmation` 注入。启用后，`execute_tool_calls` 对命中
    /// `config.confirmation_policy` 的工具调用发起确认（广播事件 + 等待前端回传）。
    confirmation_broker: Option<Arc<ConfirmationBroker>>,
    /// A6 工具生命周期钩子（空=不启用）
    ///
    /// 通过 `with_tool_hook` 注入。`execute_tool_with_retry` 在 `call_tool` 前
    /// 依次跑 `on_pre_use`（可改 args / 拒绝），成功后跑 `on_post_use`，失败跑 `on_error`。
    tool_hooks: Vec<Arc<dyn crate::tool_hook::ToolLifecycleHook>>,
    /// A3 四管线路由决策器（`None`=不启用发送链路路由）
    ///
    /// 通过 `with_router` 注入。启用后，`run()` 在接收用户输入时先经
    /// `RouterDecider::decide` 决策管线（force_pipeline 兜底生效），广播
    /// `RouterDecisionMade` 事件，并把管线指引写入 `pipeline_context`（追加到 system prompt）。
    /// 依赖 trait 而非具体 `RouterNode`（crate 拆分前置，matrix §8 里程碑 2）。
    router: Option<Arc<dyn RouterDecider>>,
    /// 最近一次路由决策的管线指引（`None`=本轮无路由/未命中管线）
    ///
    /// `run()` 开头写入，`build_prompt_options` 拼入 system_prompt 末尾。
    pipeline_context: Arc<StdRwLock<Option<String>>>,
    /// 织入点 Hook 注册表（轻量协议化，matrix §8 里程碑 5）
    ///
    /// `run()` 在各位点（`RunPhase`）统一调度；默认无钩子，注册后按位点观察/扩展。
    /// 内置织入（记忆/路由/DeepPhase）为底座内聚能力，不随钩子启用与否而改变。
    hooks: AgentLoopHooks,
}

impl AgentLoop {
    /// 创建新的 AgentLoop
    ///
    /// 自动注入 backend 事件桥接 listener，使订阅 AgentLoop 的监听器
    /// 能收到 backend 广播的 `StreamStart`/`StreamDelta`/`StreamEnd` 等事件。
    pub fn new(backend: Arc<dyn NodeBackendAccessor>, tool_bus: Arc<dyn ToolBus>) -> Self {
        let broadcaster = Arc::new(RwLock::new(EventBroadcaster::new()));
        let is_streaming = Arc::new(AtomicBool::new(false));
        let state = Arc::new(AsyncMutex::new(AgentState::new()));
        let config = Arc::new(StdRwLock::new(AgentLoopConfig::default()));
        let long_task_manager = Arc::new(LongTaskManager::new());
        let last_user_text = Arc::new(StdRwLock::new(String::new()));
        let last_llm_call_time = Arc::new(std::sync::Mutex::new(None));
        let last_phase_label = Arc::new(StdRwLock::new(None));
        // 默认配置启用内建 LoopController（宽松配置），后续 with_loop_control 可覆盖
        let loop_controller = Arc::new(LoopController::new(LoopControlConfig::default()));
        let loop_control_warned = Arc::new(AtomicBool::new(false));
        let usage = Arc::new(AsyncMutex::new(UsageAccum::default()));

        // 注入 backend 事件桥接 listener
        // 将 backend 的事件转发到 AgentLoop 的广播器
        let bridge = BackendEventBridge {
            target_broadcaster: broadcaster.clone(),
        };
        // spawn 注入避免阻塞（subscribe_events 是 async）
        let backend_clone = backend.clone();
        tokio::spawn(async move {
            backend_clone.subscribe_events(Arc::new(bridge)).await;
        });

        Self {
            backend,
            tool_bus,
            state,
            config,
            workdir: Arc::new(StdRwLock::new(None)),
            workspace_id: Arc::new(StdRwLock::new(None)),
            broadcaster,
            is_streaming,
            long_task_manager,
            last_user_text,
            last_llm_call_time,
            last_phase_label,
            loop_controller,
            loop_control_warned,
            usage,
            memory: None,
            memory_context: Arc::new(StdRwLock::new(None)),
            confirmation_broker: None,
            tool_hooks: Vec::new(),
            router: None,
            pipeline_context: Arc::new(StdRwLock::new(None)),
            hooks: AgentLoopHooks::default(),
        }
    }

    /// 注册织入点钩子（builder 链式，构造期使用）
    ///
    /// 钩子按 `RunPhase` 位点在 `run()` 生命周期被调度；可多次调用注册多个钩子。
    /// 内置织入（记忆/路由/DeepPhase）不受影响，钩子仅作额外观察/扩展。
    pub fn with_hook(self, hook: Arc<dyn AgentLoopHook>) -> Self {
        self.hooks.register(hook);
        self
    }

    /// 向已创建的 AgentLoop 追加织入点钩子（运行期使用）
    pub fn register_hook(&self, hook: Arc<dyn AgentLoopHook>) {
        self.hooks.register(hook);
    }

    /// 覆盖内建 LoopController 配置（链式，同步）
    ///
    /// 重建 `loop_controller` 并同步 `config.loop_control`。
    /// 传 `Some(config)` 启用自定义配置，传 `None` 禁用内建自动控制。
    pub fn with_loop_control(mut self, config: Option<LoopControlConfig>) -> Self {
        if let Ok(mut guard) = self.config.write() {
            guard.loop_control = config.clone();
        } else {
            warn!("with_loop_control: config RwLock poisoned");
        }
        // 重建 controller（None → 用默认宽松配置，功能上仍创建但调用方禁用检查）
        let controller_config = config.unwrap_or_default();
        self.loop_controller = Arc::new(LoopController::new(controller_config));
        self
    }

    /// 获取内建 LoopController 引用
    ///
    /// 返回 `&Arc<LoopController>`：调用方既可读取计数器/状态、手动驱动
    /// （如 `record_turn`），也可 `clone()` 出 `Arc` 与外部（如命令层注册表）
    /// 共享同一实例，消除"内建自动 vs 命令层手动"双轨不共享问题。
    pub fn loop_controller(&self) -> &Arc<LoopController> {
        &self.loop_controller
    }

    /// 获取内建记忆访问器引用（克隆 `Arc` 以便命令层共享同一实例）
    ///
    /// 返回 `Some(accessor)` 表示该会话已启用记忆后端（`with_memory` 注入），
    /// 命令层可据此实现 list / recall / archive / load_chunk 等会话级记忆操作。
    pub fn memory(&self) -> Option<Arc<dyn crate::memory::MemoryAccessor>> {
        self.memory.clone()
    }

    /// 注入记忆访问器（链式，同步）
    ///
    /// 传 `Some(accessor)` 启用记忆闭环（recall → inject → record_turn → archive），
    /// 传 `None` 禁用。默认（`new` 创建）不启用记忆。
    pub fn with_memory(mut self, memory: Option<Arc<dyn crate::memory::MemoryAccessor>>) -> Self {
        self.memory = memory;
        self
    }

    /// 注入 HITL 确认协调器（链式，同步，A5）
    ///
    /// 传 `Some(broker)` 启用确认能力（配合 `config.confirmation_policy` 生效），
    /// 传 `None` 禁用。默认（`new` 创建）不启用。
    pub fn with_confirmation(mut self, broker: Option<Arc<ConfirmationBroker>>) -> Self {
        self.confirmation_broker = broker;
        self
    }

    /// 注册工具生命周期钩子（链式，同步，A6）
    ///
    /// 可多次调用注册多个钩子，按注册顺序在 `call_tool` 前依次执行。
    pub fn with_tool_hook(mut self, hook: Arc<dyn crate::tool_hook::ToolLifecycleHook>) -> Self {
        self.tool_hooks.push(hook);
        self
    }

    /// 注入四管线路由节点（链式，同步，A3）
    ///
    /// 传 `Some(router)` 启用发送链路路由（`run()` 时先决策管线并注入指引），
    /// 传 `None` 禁用。默认（`new` 创建）不启用，行为与未接入前一致。
    ///
    /// 接受任意实现 `RouterDecider` 的决策器（`patterns::router::RouterNode` 或自定义）；
    /// `Arc<RouterNode>` 可自动 upcast 为 `Arc<dyn RouterDecider>`。
    pub fn with_router(mut self, router: Option<Arc<dyn RouterDecider>>) -> Self {
        self.router = router;
        self
    }

    /// 设置会话级确认策略（A7 安全级别，运行时即时生效）
    ///
    /// - `Some(policy)`：启用对应确认策略（如 `dangerous_only` / `moderate_and_dangerous`）
    /// - `None`：关闭确认（所有工具直接执行）
    ///
    /// 写入 config（`maybe_require_confirmation` 每次读取），无需重启会话。
    pub fn set_confirmation_policy(&self, policy: Option<ConfirmationPolicy>) {
        if let Ok(mut guard) = self.config.write() {
            guard.confirmation_policy = policy;
        }
    }

    /// 解析一次待定的工具确认（前端经 `cmd_agent_confirm` 回传）
    ///
    /// 返回是否成功唤醒对应等待方（confirm_id 不存在 = 已超时/已处理）。
    /// 未启用确认或 broker 不存在时恒返回 `false`。
    pub async fn resolve_confirmation(&self, confirm_id: &str, approved: bool) -> bool {
        let Some(broker) = &self.confirmation_broker else {
            return false;
        };
        let resolved = broker.resolve(confirm_id, approved).await;
        if resolved {
            // 广播确认已解决，供前端清理进行中的确认弹窗
            self.broadcast(OrchestratorEvent::ConfirmationResolved {
                confirm_id: confirm_id.to_string(),
                approved,
            })
            .await;
        }
        resolved
    }

    /// 内建 LoopController 是否启用
    fn loop_control_enabled(&self) -> bool {
        self.config_snapshot().loop_control.is_some()
    }

    /// 链式配置（同步）
    ///
    /// 系统提示词不在此时推入 messages，而是在 `run` 时通过
    /// `PromptCallOptions.system_prompt_override` 传给 backend 处理，
    /// 避免 `blocking_lock` 在异步上下文中 panic。
    pub fn with_config(self, config: AgentLoopConfig) -> Self {
        // 同步 workdir 独立字段（供工具执行时构造 ToolContext）
        if let Ok(mut guard) = self.workdir.write() {
            *guard = config.workdir.clone();
        } else {
            warn!("with_config: workdir RwLock poisoned");
        }
        // 同步 workspace_id 独立字段（Phase A，供 ToolContext 注入）
        if let Ok(mut guard) = self.workspace_id.write() {
            *guard = config.workspace_id.clone();
        } else {
            warn!("with_config: workspace_id RwLock poisoned");
        }
        if let Ok(mut guard) = self.config.write() {
            *guard = config;
        } else {
            warn!("with_config: config RwLock poisoned, 配置未更新");
        }
        self
    }

    /// 运行时更新配置
    pub async fn set_config(&self, config: AgentLoopConfig) {
        // 同步 workdir 独立字段（供工具执行时构造 ToolContext）
        if let Ok(mut guard) = self.workdir.write() {
            *guard = config.workdir.clone();
        }
        // 同步 workspace_id 独立字段（Phase A，供 ToolContext 注入）
        if let Ok(mut guard) = self.workspace_id.write() {
            *guard = config.workspace_id.clone();
        }
        if let Ok(mut guard) = self.config.write() {
            *guard = config;
        }
    }

    /// 读取配置快照
    fn config_snapshot(&self) -> AgentLoopConfig {
        self.config
            .read()
            .map(|g| g.clone())
            .unwrap_or_else(|_| AgentLoopConfig::default())
    }

    /// 订阅事件
    pub async fn subscribe(&self, listener: Arc<dyn EventListener>) {
        self.broadcaster.write().await.subscribe(listener);
    }

    /// 获取内部广播器引用（供外部组件向同一广播器广播事件）
    ///
    /// 例如：`SubAgentManager` 在子 Agent 委派时向主 Agent 的广播器广播
    /// `SubAgentStarted` / `SubAgentCompleted` / `SubAgentError`，使订阅主 Agent
    /// 事件的监听器（如 Tauri 端）能收到子 Agent 的委派进度。
    pub fn broadcaster_ref(&self) -> Arc<RwLock<EventBroadcaster>> {
        Arc::clone(&self.broadcaster)
    }

    /// 获取内部 LLM 后端访问器（供编排节点复用同一 backend）
    ///
    /// 例如：AgentCommandService 在运行 Plan→Execute→Reflection→Refine 编排图时，
    /// 从会话的 AgentLoop 取出 backend 注入 `DefaultOrchestrator`，使编排节点与
    /// 会话使用同一个 LLM Provider 配置。
    pub fn node_backend(&self) -> Arc<dyn NodeBackendAccessor> {
        Arc::clone(&self.backend)
    }

    /// 获取内部 ToolBus 访问器（供 Supervisor 编排节点为子 Agent 提供共享工具）
    ///
    /// SupervisorNode 构造需要 `Arc<dyn ToolBus>` 来运行被委派的子 Agent，
    /// 从会话 AgentLoop 取出即可与主 Agent 共享同一批工具（terminal/subagent 等）。
    pub fn tool_bus(&self) -> Arc<dyn ToolBus> {
        Arc::clone(&self.tool_bus)
    }

    /// 广播事件
    async fn broadcast(&self, event: OrchestratorEvent) {
        self.broadcaster.read().await.broadcast(&event);
    }

    /// 中断当前运行
    pub async fn abort(&self) {
        let mut state = self.state.lock().await;
        state.aborted = true;
        debug!("AgentLoop abort 已请求");
    }

    /// 获取状态快照（用于 checkpoint）
    pub async fn get_state(&self) -> AgentState {
        self.state.lock().await.clone()
    }

    /// 从快照恢复状态
    pub async fn restore_state(&self, state: AgentState) {
        *self.state.lock().await = state;
    }

    /// 获取当前消息历史快照
    pub async fn get_messages(&self) -> Vec<OrchestratorMessage> {
        self.state.lock().await.messages.clone()
    }

    /// 追加消息到会话历史（不触发执行；命令层编排路径收口入环用——X1 持久化缺口修复）
    pub async fn append_messages(&self, msgs: Vec<OrchestratorMessage>) {
        self.state.lock().await.messages.extend(msgs);
    }

    /// A4 Plan-Exec：获取当前任务计划（None=无计划）
    pub async fn get_plan(&self) -> Option<Vec<PlanItem>> {
        self.state.lock().await.plan.clone()
    }

    /// A4 Plan-Exec：设置当前任务计划（None=清空计划）
    pub async fn set_plan(&self, plan: Option<Vec<PlanItem>>) {
        self.state.lock().await.plan = plan;
    }

    /// 获取会话累计用量（input/output tokens）
    pub async fn get_usage(&self) -> UsageAccum {
        self.usage.lock().await.clone()
    }

    /// 启动 ReAct 循环，详细见 docs/details/注释/agent-runtime/agent.md
    pub async fn run(&self, user_input: String) -> Result<String, AgentError> {
        info!("AgentLoop 启动，用户输入长度: {}", user_input.len());

        // 检查中断状态（先调 abort 再调 run 应立即返回错误）
        // 注意：不在此处重置 aborted，让 abort 持续生效至显式 restore_state
        {
            let state = self.state.lock().await;
            if state.aborted {
                return Err(AgentError::Aborted);
            }
        }

        // 记录最近一次用户输入（供 CheckpointProvider::get_checkpoint 使用）
        // 不跨 await 持锁，写入后立即释放
        {
            if let Ok(mut guard) = self.last_user_text.write() {
                *guard = user_input.clone();
            }
        }

        // 阶段 3：记忆闭环需要原始用户输入（recall query + record_turn），
        // 在 user_input 被 UserMessage 事件 move 前克隆一份。
        let run_user_input = user_input.clone();

        // 标记 is_streaming = true（run 方法活跃中）
        self.is_streaming.store(true, Ordering::SeqCst);

        // 获取当前模型 ID（从 backend 读取，避免硬编码 "unknown"）
        let current_model = self.backend.current_model().await;

        // 广播 AgentStart
        self.broadcast(OrchestratorEvent::Agent(AgentEvent::AgentStart {
            model: current_model.clone(),
        }))
        .await;

        // P2 Deep Mode：每轮重置阶段缓存，确保新一轮首个工具必定触发
        // DeepPhaseChanged 事件（None → 当前阶段），与前端 agent_start 重置
        // deepSegments 对齐。否则同阶段的连续轮次不会发事件，前端 UI 缺失首工具。
        {
            if let Ok(mut guard) = self.last_phase_label.write() {
                *guard = None;
            }
        }

        // [RunPhase::BeforeReact] 内置织入（组织化内部方法）+ 钩子调度
        // 1. 记忆闭环（recall → inject → memory_context）见 run_recall_memory
        // 2. 四管线路由决策（decide → pipeline_context + RouterDecisionMade）见 run_router_decision
        // 3. 外部钩子可在 BeforeReact 位点观察/扩展（协议：不改变内置织入行为）
        self.run_recall_memory(&run_user_input).await;
        self.run_router_decision(&run_user_input).await;
        {
            let ctx = HookContext::new(&self, &run_user_input);
            self.hooks.dispatch(RunPhase::BeforeReact, &ctx).await;
        }

        // 推入 user 消息
        let config_snapshot = self.config_snapshot();
        {
            let mut state = self.state.lock().await;
            // 若配置了 system_prompt 且 state.messages 中尚无 system 消息，则推入
            // 这样 get_messages() 能看到 system 消息，同时 backend 通过 system_prompt_override 跳过重复
            if let Some(sys_prompt) = &config_snapshot.system_prompt {
                let has_system = state.messages.iter().any(|m| matches!(m.role, MessageRole::System));
                if !has_system {
                    state.messages.push(OrchestratorMessage {
                        role: MessageRole::System,
                        content: sys_prompt.clone(),
                        tool_calls: Vec::new(),
                        tool_call_id: None,
                        meta: None,
                    });
                }
            }
            // 用户消息注入时间戳前缀（2026-08-30）：LLM 在接收请求时即可感知当前时间，
            // 无需额外工具调用。格式 [YYYY-MM-DD HH:MM:SS]。仅改存储进历史的消息内容
            // （LLM 视图），下方 UserMessage 广播事件仍用原始 user_input，避免前端气泡显示时间戳。
            let timestamped = format!(
                "[{}] {}",
                chrono::Local::now().format("%Y-%m-%d %H:%M:%S"),
                user_input
            );
            state.messages.push(OrchestratorMessage {
                role: MessageRole::User,
                content: timestamped,
                tool_calls: Vec::new(),
                tool_call_id: None,
                meta: None,
            });
            state.current_iteration = 0;
        }

        // 广播 UserMessage
        self.broadcast(OrchestratorEvent::Agent(AgentEvent::UserMessage {
            content: user_input,
            images: Vec::new(),
        }))
        .await;

        // [RunPhase::AfterUserMessage] 钩子调度（外部观察本轮输入侧上下文）
        {
            let ctx = HookContext::new(&self, &run_user_input);
            self.hooks.dispatch(RunPhase::AfterUserMessage, &ctx).await;
        }

        // 执行 ReAct 循环
        let result = self.run_react_loop().await;

        // 标记 is_streaming = false
        self.is_streaming.store(false, Ordering::SeqCst);

        // 广播终态事件（failTask 终态闭环修复，2026-08-02）：
        // - 成功 → AgentEnd（前端 agent_end 分支 → completeTask）
        // - 失败（LLM 错误/超迭代/中止）→ 先 Error 再 AgentEnd：
        //     * Error → 前端 error 分支 failTask（真实错误）/ cancelTask（用户 abort）
        //     * AgentEnd → 前端清理 _isStreaming / deepSegments / autoSave
        //   修复前错误路径只广播 AgentEnd，前端误把失败任务标为 completed，failTask 永不触发。
        match &result {
            Ok(_) => {
                self.broadcast(OrchestratorEvent::Agent(AgentEvent::AgentEnd)).await;
            }
            Err(e) => {
                self.broadcast(OrchestratorEvent::Agent(AgentEvent::Error {
                    message: e.to_string(),
                }))
                .await;
                self.broadcast(OrchestratorEvent::Agent(AgentEvent::AgentEnd)).await;
            }
        }

        // [RunPhase::AfterReact] 钩子调度（外部观察本轮成败）
        {
            let mut ctx = HookContext::new(&self, &run_user_input);
            ctx.succeeded = result.is_ok();
            self.hooks.dispatch(RunPhase::AfterReact, &ctx).await;
        }

        // [RunPhase::AfterRun] 内置织入（记忆归档，见 run_memory_archive）+ 钩子调度
        self.run_memory_archive(&run_user_input, &result).await;
        {
            let mut ctx = HookContext::new(&self, &run_user_input);
            ctx.succeeded = result.is_ok();
            self.hooks.dispatch(RunPhase::AfterRun, &ctx).await;
        }

        result
    }

    /// [RunPhase::BeforeReact 内置] 记忆闭环 — recall → inject → memory_context
    ///
    /// 仅在启用记忆且检索到结果时执行；任一环节失败静默跳过，不影响主流程。
    /// 注入文本存入 memory_context，由 build_prompt_options 拼入 system_prompt_override。
    async fn run_recall_memory(&self, user_input: &str) {
        if let Some(memory) = &self.memory {
            if let Ok(recall_results) = memory.recall(user_input.to_string(), None).await {
                if !recall_results.is_empty() {
                    if let Ok(injected) = memory.inject(recall_results, None).await {
                        if !injected.is_empty() {
                            if let Ok(mut guard) = self.memory_context.write() {
                                *guard = Some(injected);
                            }
                        }
                    }
                }
            }
        }
    }

    /// [RunPhase::BeforeReact 内置] 四管线路由决策 — decide → pipeline_context + RouterDecisionMade
    ///
    /// 若配置了路由节点，先决策管线（force_pipeline 兜底生效）：
    /// 1. 广播 RouterDecisionMade 事件（前端可展示选中管线 / force_pipeline Chip 生效）
    /// 2. 把管线指引写入 pipeline_context，由 build_prompt_options 追加到 system prompt
    /// 未配置路由节点 / 路由失败时静默跳过并清空管线指引。
    async fn run_router_decision(&self, user_input: &str) {
        // FIX-4/M5 决策：路由无会话级开关（自动判型默认全开），由 `/指令` 颗粒度覆盖。
        // 未配置路由节点时静默跳过并清空管线指引。
        match &self.router {
            Some(router) => match router.decide(user_input, self.backend.as_ref()).await {
                Ok(decision) => {
                    let pipeline = Pipeline::from_str(&decision.target_id);
                    if let Some(p) = pipeline {
                        if let Ok(mut guard) = self.pipeline_context.write() {
                            *guard = Some(p.directive().to_string());
                        }
                    }
                    self.broadcast(OrchestratorEvent::RouterDecisionMade {
                        node_id: router.id(),
                        target_id: decision.target_id.clone(),
                        target_name: decision.target_name.clone(),
                        reason: decision.reason.clone(),
                        is_fallback: false,
                    })
                    .await;
                    debug!(
                        "AgentLoop 路由决策：target={} pipeline={:?}",
                        decision.target_id, pipeline
                    );
                }
                Err(e) => {
                    warn!("AgentLoop 路由决策失败，本轮使用静态配置: {}", e);
                }
            },
            None => {
                if let Ok(mut guard) = self.pipeline_context.write() {
                    *guard = None;
                }
            }
        }
    }

    /// [RunPhase::AfterRun 内置] 记忆归档 — record_turn + archive + 上下文预算裁剪
    ///
    /// 记录本轮对话（供归档前累积）并触发归档；任一环节失败静默跳过，不影响主流程返回。
    /// 归档后执行上下文预算检查（H1 修复 P1.5，见 `enforce_context_budget`）。
    async fn run_memory_archive(&self, user_input: &str, result: &Result<String, AgentError>) {
        if let Some(memory) = &self.memory {
            let assistant_text = match result {
                Ok(text) => text.clone(),
                Err(_) => String::new(),
            };
            let _ = memory.record_turn(user_input.to_string(), assistant_text).await;
            let _ = memory.archive(None).await;
        }
        self.enforce_context_budget().await;
    }

    /// H1 修复（P1.5，2026-08-30）：上下文预算自动裁剪 — 消息历史只进不出的解药
    ///
    /// 此前消息历史只进不出：归档是"增值"而非"腾挪"（archive 的边界被忽略），
    /// 全链路无 token 计量，长会话终将顶爆 LLM 上下文窗口。
    ///
    /// 策略：AfterRun 阶段估算活跃历史字节量，超预算则从头部裁掉最旧消息只保留
    /// 最近 `HISTORY_KEEP_MESSAGES` 条（`trim_context` 同步 backend + state 两边）。
    ///
    /// 语义安全：被裁轮次必然已归档进记忆——归档阈值（2000 token）远小于预算阈值
    /// （约 5 万+ token），预算触发时未归档缓冲只剩最近几轮，保留条数足够覆盖。
    async fn enforce_context_budget(&self) {
        // ═══════════════════════════════════════════════════════════════
        // ⚠ TODO(await-user · 2026-08-30)：以下两个阈值为【占位默认值】，已标记待定！
        // 用户明确要求：上下文压缩/归档阈值涉及消息删除，需慎重——后续将由用户
        // 说明具体策略后调整（可能改为可配置/按 token 精算/归档联动策略等）。
        // 在用户说明之前，此处的数值仅作为保守占位，勿当作最终设计依赖。
        // ═══════════════════════════════════════════════════════════════
        const HISTORY_BUDGET_BYTES: usize = 160_000; // ⚠ 占位待定（≈5.3 万汉字 / 16 万 ASCII 字符）
        const HISTORY_KEEP_MESSAGES: usize = 12; // ⚠ 占位待定（保留最近 12 条 ≈4-6 轮）

        let (total_bytes, total_msgs) = {
            let state = self.state.lock().await;
            let bytes: usize = state
                .messages
                .iter()
                .map(|m| m.content.len() + 32) // content + 结构开销粗估
                .sum();
            (bytes, state.messages.len())
        };
        if total_bytes <= HISTORY_BUDGET_BYTES || total_msgs <= HISTORY_KEEP_MESSAGES {
            return;
        }

        // 从头部计算需裁条数：裁到预算内或只剩保留条数
        let mut drop = 0usize;
        let mut acc = total_bytes;
        {
            let state = self.state.lock().await;
            let keep_from = total_msgs.saturating_sub(HISTORY_KEEP_MESSAGES);
            for m in state.messages.iter() {
                if drop >= keep_from || acc <= HISTORY_BUDGET_BYTES {
                    break;
                }
                acc -= m.content.len() + 32;
                drop += 1;
            }
        }
        if drop == 0 {
            return;
        }
        match self.trim_context(drop).await {
            Ok(()) => info!(
                "上下文预算裁剪：历史 {} 字节超预算 {}，已裁掉最旧 {} 条（保留 {} 条）",
                total_bytes, HISTORY_BUDGET_BYTES, drop, total_msgs - drop
            ),
            Err(e) => warn!("上下文预算裁剪失败: {}", e),
        }
    }

    /// M4-5（B10）：预判型 — 供 send_message 在 run 启动前决定 run 形状
    ///
    /// 复用与 `run_router_decision` 完全相同的 `RouterDecider::decide` 判型链路
    /// （force_pipeline → LLM → 关键词 → 兜底），但不广播事件、不改写 pipeline_context，
    /// 纯查询无副作用。
    pub async fn classify_pipeline(&self, user_input: &str) -> Option<Pipeline> {
        let router = self.router.as_ref()?;
        match router.decide(user_input, self.backend.as_ref()).await {
            Ok(decision) => Pipeline::from_str(&decision.target_id),
            Err(e) => {
                tracing::warn!("AgentLoop 预判型失败，按 query 处理: {}", e);
                None
            }
        }
    }

    /// ReAct 核心循环，详细见 docs/details/注释/agent-runtime/agent.md
    async fn run_react_loop(&self) -> Result<String, AgentError> {
        let config_snapshot = self.config_snapshot();
        loop {
            // 检查中断
            {
                let state = self.state.lock().await;
                if state.aborted {
                    return Err(AgentError::Aborted);
                }
            }

            // ─── Loop Engineering 批次3.2：协作式取消检查点 ───
            // 每轮迭代开始检查 cancel_flag，若已请求取消则优雅停止循环。
            // 注意：取消请求由外部 `request_cancel()` 设置 flag，循环在此处感知并停止，
            // 让当前 tool call 完成后再退出，避免数据不一致。
            if self.long_task_manager.is_cancel_requested() {
                info!("ReAct 循环：检测到协作式取消请求，停止循环");
                // 转换状态机 Running → Cancelled（同时停止心跳定时器、清空内存）
                let cancelled_record = self.long_task_manager.cancel_task().await;
                if let Some(record) = cancelled_record {
                    // 广播 StreamEnd（携带已生成的部分文本，便于 UI 显示）
                    // 注意：此处不持久化 cancelled_record，调用方（Tauri 命令层）负责
                    // 通过心跳定时器的 CheckpointFlush tick 或显式 save 落库
                    debug!(
                        "ReAct 循环：任务 {} 已取消（轮次: {}）",
                        record.task_id, record.turn_count
                    );
                }
                return Err(AgentError::Aborted);
            }

            // 检查迭代次数
            {
                let mut state = self.state.lock().await;
                state.current_iteration += 1;
                if state.current_iteration > config_snapshot.max_iterations {
                    error!(
                        "超过最大迭代次数: {}",
                        config_snapshot.max_iterations
                    );
                    return Err(AgentError::MaxIterationsExceeded(
                        config_snapshot.max_iterations,
                    ));
                }
                debug!(
                    "ReAct 循环第 {} 轮",
                    state.current_iteration
                );
            }

            // 内建 LoopController 驱动（批次5），详细见 docs/details/注释/agent-runtime/agent.md
            if self.loop_control_enabled() {
                self.loop_controller.update_activity();
                self.loop_controller.rate_limiter.inc_turns();
                let check = self.loop_controller.check_all();
                // 恢复边沿检测：上一轮有告警锁存、本轮已解除 → Recovered（活动恢复=自动恢复）
                self.emit_loop_recovered_if_needed().await;
                // 广播软超时 / 看门狗告警（不停止循环，仅提醒）
                self.emit_loop_control_warnings(&check).await;
                // 速率限制超限 → 广播并停止
                if let Some(exceeded) = &check.rate_limit_exceeded {
                    self.emit_rate_limit_exceeded(exceeded).await;
                    return Err(AgentError::RateLimitExceeded(
                        exceeded.as_str().to_string(),
                    ));
                }
            }

            // 构建 PromptCallOptions（含工具定义，阶段 1.4）
            let options = self.build_prompt_options(&config_snapshot).await;

            // 风险点修复：同步 state.messages → backend，详细见 docs/details/注释/agent-runtime/agent.md
            {
                let state = self.state.lock().await;
                self.backend
                    .set_messages(state.messages.clone())
                    .await
                    .map_err(AgentError::from)?;
            }

            // 调用 LLM（空 prompt，因为消息已通过上方 set_messages 同步给 backend）
            //
            // ─── Loop Engineering 批次4：通过 `call_llm_with_retry` 包裹 ───
            // - 限流：检查距上次调用间隔，不足 `min_interval_between_calls` 则 sleep
            // - 超时：`tokio::time::timeout` 包裹 `backend.prompt`，超时可触发重试
            // - 重试：失败时指数退避（delay = base * 2^attempt），最多 `llm_max_retries` 次
            // - 取消：每次重试前检查 `cancel_flag`，已请求取消则返回 `Aborted`
            let prompt_input = String::new();
            let response = self.call_llm_with_retry(prompt_input, Some(options)).await?;

            // 累计用量（每次 LLM 调用后累加 input/output tokens，供用量面板）
            if response.input_tokens.is_some() || response.output_tokens.is_some() {
                let mut usage = self.usage.lock().await;
                usage.input_tokens += response.input_tokens.unwrap_or(0) as u64;
                usage.output_tokens += response.output_tokens.unwrap_or(0) as u64;
            }

            // 处理响应
            // 过滤空名工具调用（LLM 幻觉，实测复现）：空名工具无法执行，一律剔除，
            // 避免其产生的"工具不存在"错误消息污染上下文、引发偶发不收敛（撞 max_iterations）。
            // 剔除后若无有效工具调用，回退为"直接返回文本"分支。
            let tool_calls: Vec<ToolCall> = response
                .tool_calls
                .clone()
                .into_iter()
                .filter(|tc| !tc.name.trim().is_empty())
                .collect();

            // 若有推理内容，写入 meta["thinking"] 持久化，供刷新后回源重建推理段
            let meta = response.reasoning.as_ref().map(|r| {
                let mut m = std::collections::HashMap::new();
                m.insert("thinking".to_string(), serde_json::json!(r));
                m
            });

            if tool_calls.is_empty() {
                // 无有效工具调用：推入 assistant 消息，返回最终文本
                let final_text = response.text.clone();
                {
                    let mut state = self.state.lock().await;
                    state.messages.push(OrchestratorMessage {
                        role: MessageRole::Assistant,
                        content: final_text.clone(),
                        tool_calls: Vec::new(),
                        tool_call_id: None,
                        meta: meta.clone(),
                    });
                }

                // 广播 StreamEnd 由 genai_backend 在每次 LLM 流完成时发出（携带完整文本），
                // 此处不再重复广播，避免前端同一 message_id 产生重复消息（2026-08-03 修复）
                info!(
                    "AgentLoop 完成，迭代次数: {}，最终文本长度: {}",
                    self.state.lock().await.current_iteration,
                    final_text.len()
                );
                return Ok(final_text);
            }

            // 有有效工具调用：执行工具并推入 toolResult 消息
            let assistant_text = response.text.clone();
            // 批次3.3：clone 一份工具名，用于 checkpoint 更新（原 tool_calls 会被 move 进 execute_tool_calls）。
            // 此处 tool_calls 已过滤空名，取第一个（主工具）即可。
            let tool_name_for_checkpoint = tool_calls.first().map(|tc| tc.name.clone());

            // 推入 assistant 消息（含 tool_calls 与 reasoning）
            {
                let mut state = self.state.lock().await;
                state.messages.push(OrchestratorMessage {
                    role: MessageRole::Assistant,
                    content: assistant_text,
                    tool_calls: tool_calls.clone(),
                    tool_call_id: None,
                    meta: meta.clone(),
                });
            }

            // 执行工具
            let tool_results = self.execute_tool_calls(tool_calls).await?;

            // 捕获主工具执行状态（阶段 P2 扩展：DeepPhaseChanged 事件补充 tool_status）
            // tool_results 顺序与 tool_calls 一致（串行/并行均按原索引），第一个即主工具。
            // 失败判定（结构化解析）：工具结果 content 是 JSON 字符串，顶层含非 null 的
            // "error" 键即视为失败（execute_tool_calls_serial/parallel 失败时写入
            // `{"error": ..., "tool": ...}`）。替代原先的字符串 contains 匹配，避免误判
            // 成功数据中恰好出现的 "error" 文本。
            let main_tool_status = tool_results.first().map(|r| {
                // 注意：闭包内完成布尔计算，避免返回对临时 Value 的引用（借用生命周期问题）
                let is_failed = serde_json::from_str::<serde_json::Value>(&r.content)
                    .ok()
                    .map(|v| v.get("error").map(|e| !e.is_null()).unwrap_or(false))
                    .unwrap_or(false);
                if is_failed {
                    crate::event::ToolStatus::Failed
                } else {
                    crate::event::ToolStatus::Completed
                }
            });

            // 推入 toolResult 消息
            let current_turn_count = {
                let mut state = self.state.lock().await;
                for result in tool_results {
                    state.messages.push(result);
                }
                state.current_iteration
            };

            // 事件驱动 checkpoint 更新（批次3.3 + P2 阶段判定），详细见 docs/details/注释/agent-runtime/agent.md
            let current_phase_label = tool_name_for_checkpoint
                .as_ref()
                .map(|tool_name| crate::deep_phases::classify_tool(tool_name).0.to_string());

            // 阶段切换检测：当前阶段与缓存不同则广播事件
            //
            // 风险点1处理（阶段完成标记精确化）：切换时广播"双事件"——
            //   1. 若存在旧阶段，先广播"旧阶段完成"事件（phase_completed=true），
            //      前端据此把对应 phase 段标记为 done；
            //   2. 再广播"新阶段进入"事件（phase_completed=false），前端据此新建/激活阶段段。
            // 这样 `phase_completed` 不再是恒 false，而具有真实语义。
            {
                let prev_phase = self
                    .last_phase_label
                    .read()
                    .map(|g| g.clone())
                    .unwrap_or(None);
                if current_phase_label.as_deref() != prev_phase.as_deref() {
                    if let Some(tool_name) = &tool_name_for_checkpoint {
                        let (label, idx) = crate::deep_phases::classify_tool(tool_name);
                        let tool_status =
                            main_tool_status.unwrap_or(crate::event::ToolStatus::Completed);
                        debug!(
                            "Deep Mode 阶段切换：{:?} → {:?}（触发工具: {}）",
                            prev_phase, label, tool_name
                        );

                        // 1. 旧阶段完成事件（若存在旧阶段）
                        if let Some(prev_label) = &prev_phase {
                            let prev_idx = crate::deep_phases::phase_index_by_label(prev_label)
                                .unwrap_or(crate::deep_phases::OTHER_PHASE_INDEX);
                            self.broadcast(OrchestratorEvent::DeepPhaseChanged {
                                node_id: String::new(), // 由 Tauri 端按 session 填充
                                phase_label: prev_label.clone(),
                                phase_index: prev_idx,
                                trigger_tool: tool_name.clone(),
                                tool_status,
                                phase_completed: true, // 旧阶段已完成
                            })
                            .await;
                        }

                        // 2. 新阶段进入事件
                        self.broadcast(OrchestratorEvent::DeepPhaseChanged {
                            node_id: String::new(), // 由 Tauri 端按 session 填充
                            phase_label: label.to_string(),
                            phase_index: idx,
                            trigger_tool: tool_name.clone(),
                            tool_status,
                            phase_completed: false, // 新阶段刚激活，尚未完成
                        })
                        .await;
                    }
                    // 更新缓存（不跨 await 持锁）
                    if let Ok(mut guard) = self.last_phase_label.write() {
                        *guard = current_phase_label.clone();
                    }
                }
            }

            // [RunPhase::OnToolCall] 钩子调度（观察每轮工具调用；tool_name 由本循环暂存）
            if !self.hooks.is_empty() {
                let input = self
                    .last_user_text
                    .read()
                    .map(|g| g.clone())
                    .unwrap_or_default();
                let mut ctx = HookContext::new(&self, &input);
                ctx.tool_name = tool_name_for_checkpoint.as_deref();
                self.hooks.dispatch(RunPhase::OnToolCall, &ctx).await;
            }

            if self.long_task_manager.has_active_task().await {
                let new_checkpoint = self.get_checkpoint().await;
                self.long_task_manager
                    .checkpoint(
                        Some(current_turn_count),
                        tool_name_for_checkpoint,
                        current_phase_label,
                        new_checkpoint,
                    )
                    .await;
                debug!(
                    "ReAct 循环：已更新长任务 checkpoint（轮次: {}）",
                    current_turn_count
                );
            }

            // 继续循环
        }
    }

    /// 是否正在流式输出 — 对应前端 `IAgentBackend.isStreaming`
    ///
    /// 基于 `run` 方法的活跃状态判断，使用 `AtomicBool` 保证原子可见性。
    pub fn is_streaming(&self) -> bool {
        self.is_streaming.load(Ordering::SeqCst)
    }

    /// 销毁 Agent — 对应前端 `IAgentBackend.dispose()`
    ///
    /// 清空状态和消息历史，释放资源。
    /// 调用后不应再使用该 AgentLoop 实例。
    pub async fn dispose(&self) {
        let mut state = self.state.lock().await;
        state.messages.clear();
        state.current_iteration = 0;
        state.aborted = true; // 标记为已销毁，防止后续 run
        self.is_streaming.store(false, Ordering::SeqCst);
        // 同步停止长任务心跳定时器，避免泄漏
        self.long_task_manager.stop_heartbeat().await;
        debug!("AgentLoop dispose: 已释放资源");
    }
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
