//! # AgentLoop — ReAct 模式的核心循环
//!
//! 对应 TS 版 `pi-agent-core` 的 `Agent` 类核心循环逻辑。
//! 阶段 1.3 实现 ReAct（Reasoning + Acting）模式的最小可用版本。
//!
//! ## 架构位置
//! ```text
//! ┌────────────────────────────────────────────┐
//! │  编排框架层（Orchestrator + Node）           │  ← 阶段 2
//! ├────────────────────────────────────────────┤
//! │  AgentLoop（本模块）                        │  ← 阶段 1.3
//! ├────────────────────────────────────────────┤
//! │  LLM 通信层（GenaiBackend）                 │  ← 阶段 1.2
//! └────────────────────────────────────────────┘
//! ```
//!
//! ## ReAct 循环流程
//! ```text
//! 用户输入
//!    ↓
//! ┌──→ LLM 调用（backend.prompt）
//! │      ↓
//! │   响应含 tool_calls?
//! │      ├─ 否 → 返回最终文本（循环结束）
//! │      └─ 是 ↓
//! │         执行工具（tool_bus.call_tool）
//! │            ↓
//! │         推入 toolResult 消息
//! │            ↓
//! └──── 继续循环（iteration+1）
//! ```
//!
//! ## 与 TS 版的差异
//! - **单层循环**：阶段 1.3 只实现单层 tool_call 循环，外层 follow-up 由调用方驱动
//! - **同步工具执行**：阶段 1.3 工具串行执行，阶段 1.4 再支持并行
//! - **不传工具定义给 LLM**：阶段 1.3 通过系统提示词告知工具列表，阶段 1.4 再接入完整 tools 参数

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock as StdRwLock};
use std::time::{Duration, Instant};

use async_trait::async_trait;
use tokio::sync::{Mutex as AsyncMutex, RwLock};
use tracing::{debug, error, info, warn};

use crate::backend::{BackendError, NodeBackendAccessor, PromptCallOptions, ThinkingLevel};
use crate::event::{AgentEvent, EventBroadcaster, EventListener, OrchestratorEvent};
use crate::llm::config::ProviderConfig;
use crate::loop_control::{
    LoopControlCheck, LoopControlConfig, LoopController, RateLimitExceeded, SoftTimeoutLevel,
    WatchdogAlert,
};
use crate::long_task::{
    CheckpointProvider, HeartbeatTick, LongTaskCheckpoint, LongTaskManager,
};
use crate::tool::{ToolBus, ToolError};
use crate::types::{MessageRole, OrchestratorMessage, ToolCall};

// ─── 配置与状态 ────────────────────────────────────────────

/// AgentLoop 配置
#[derive(Debug, Clone)]
pub struct AgentLoopConfig {
    /// 最大迭代次数（防止无限循环，默认 25）
    pub max_iterations: u32,
    /// 系统提示词（每次 prompt 都会附加）
    pub system_prompt: Option<String>,
    /// 温度（None=使用 Provider 默认）
    pub temperature: Option<f32>,
    /// 最大 token
    pub max_tokens: Option<u32>,
    /// 是否并行执行工具调用（阶段 1.3 恒为 false，阶段 1.4 启用）
    pub parallel_tool_calls: bool,
    /// 思考级别（DeepSeek/Anthropic reasoning）
    pub thinking_level: Option<crate::backend::ThinkingLevel>,

    // ─── Loop Engineering 批次4：通用循环控制 ───
    /// LLM 调用失败时的最大重试次数（默认 3，0=不重试）
    ///
    /// 采用指数退避策略：delay = `llm_retry_base_delay * 2^attempt`
    /// 适用场景：网络抖动、429 Too Many Requests、5xx 服务器错误
    /// 不适用场景：认证失败、参数错误（这些重试也无用，但当前实现不区分错误类型）
    pub llm_max_retries: u32,
    /// LLM 重试基础延迟（指数退避基数，默认 1s）
    pub llm_retry_base_delay: Duration,
    /// 单次 LLM 调用超时（None=不限时，默认 5min）
    ///
    /// 注意：超时只针对单次 LLM 调用，不针对整个任务。
    /// 超时后会触发重试（若 `llm_max_retries > 0`），不会强制终止整个 Agent 任务。
    pub llm_timeout: Option<Duration>,

    /// 工具执行失败时的最大重试次数（默认 0，工具自身负责重试）
    ///
    /// 默认不重试，因为工具可能有副作用（如写文件、发请求），
    /// 重复执行可能导致数据不一致。需要重试的工具应在 ToolBus 层自行实现。
    pub tool_max_retries: u32,
    /// 工具重试基础延迟（默认 1s）
    pub tool_retry_base_delay: Duration,
    /// 单次工具执行超时（None=不限时）
    ///
    /// 超时后工具执行被视为失败，错误信息推入 toolResult 消息让 LLM 处理。
    pub tool_timeout: Option<Duration>,

    /// LLM 调用之间的最小间隔（限流，None=不限制）
    ///
    /// 用于避免触发 Provider 的速率限制（如 DeepSeek 60次/分钟）。
    /// 在每次 LLM 调用前检查距上次调用的间隔，不足则 sleep。
    /// 注意：重试时也受限流约束（避免雪崩）。
    pub min_interval_between_calls: Option<Duration>,

    // ─── Loop Engineering 批次5：内建循环控制器 ───
    /// 内建 LoopController 配置（`None`=禁用内建自动控制，默认启用宽松配置）
    ///
    /// 阶段 2.6 的 `LoopController` 聚合 RateLimiter/RetryPolicy/SoftTimeout/Watchdog。
    /// 默认启用（`LoopControlConfig::default()` 宽松配置：100 turns / 200 tools / 6h），
    /// 在内层 ReAct 循环自动驱动：
    /// - rate_limit 超限 → 抛 `AgentError::RateLimitExceeded` 停止循环
    /// - soft_timeout / watchdog → 广播 `LoopEng*` 事件提醒（不强制停止）
    /// - 重试路径 → 广播 `LoopEngRetrying` / `LoopEngRetryExhausted`
    ///
    /// 若需完全禁用内建自动控制，将其设为 `None`（命令层 `LoopControlRegistry`
    /// 的手动控制不受影响）。
    pub loop_control: Option<LoopControlConfig>,
}

impl Default for AgentLoopConfig {
    fn default() -> Self {
        Self {
            max_iterations: 25,
            system_prompt: None,
            temperature: None,
            max_tokens: None,
            parallel_tool_calls: false,
            thinking_level: None,
            // 批次4 默认值：保守策略
            llm_max_retries: 3,
            llm_retry_base_delay: Duration::from_secs(1),
            llm_timeout: Some(Duration::from_secs(300)), // 5min
            tool_max_retries: 0,
            tool_retry_base_delay: Duration::from_secs(1),
            tool_timeout: None, // 工具默认不限时（可能执行长任务如文件扫描）
            min_interval_between_calls: None,
            // 批次5：默认启用内建 LoopController（宽松配置）
            loop_control: Some(LoopControlConfig::default()),
        }
    }
}

/// AgentLoop 运行时状态
#[derive(Debug, Clone)]
pub struct AgentState {
    /// 消息历史（含 system/user/assistant/toolResult）
    pub messages: Vec<OrchestratorMessage>,
    /// 当前迭代次数
    pub current_iteration: u32,
    /// 是否被中断
    pub aborted: bool,
    /// 是否暂停
    pub paused: bool,
}

impl AgentState {
    /// 创建空状态
    pub fn new() -> Self {
        Self {
            messages: Vec::new(),
            current_iteration: 0,
            aborted: false,
            paused: false,
        }
    }

    /// 创建带系统提示词的状态
    pub fn with_system_prompt(system_prompt: impl Into<String>) -> Self {
        let mut state = Self::new();
        state.messages.push(OrchestratorMessage {
            role: MessageRole::System,
            content: system_prompt.into(),
            tool_calls: Vec::new(),
            tool_call_id: None,
            meta: None,
        });
        state
    }
}

impl Default for AgentState {
    fn default() -> Self {
        Self::new()
    }
}

// ─── 状态快照（前端友好） ────────────────────────────────────────────

/// AgentLoop 状态快照 — 对应前端 `IAgentBackend.state` 的只读视图
///
/// 与 `AgentState` 的区别：
/// - `AgentState`：内部可变运行时状态（含 messages 写入权）
/// - `AgentStateSnapshot`：序列化友好的只读视图，用于 Tauri IPC 传递给前端
#[derive(Debug, Clone, serde::Serialize)]
pub struct AgentStateSnapshot {
    /// 当前迭代次数
    pub current_iteration: u32,
    /// 是否被中断
    pub aborted: bool,
    /// 是否暂停
    pub paused: bool,
    /// 是否正在流式输出（run 方法活跃中）
    pub is_streaming: bool,
    /// 当前消息历史快照
    pub messages: Vec<OrchestratorMessage>,
    /// 当前模型 ID（从 backend 获取）
    pub model: String,
    /// 当前思考级别
    pub thinking_level: Option<ThinkingLevel>,
}

// ─── 错误类型 ────────────────────────────────────────────

/// AgentLoop 错误
#[derive(Debug, thiserror::Error)]
pub enum AgentError {
    #[error("LLM 后端错误: {0}")]
    Backend(#[from] BackendError),

    #[error("工具执行错误: {0}")]
    Tool(#[from] ToolError),

    #[error("超过最大迭代次数: {0}")]
    MaxIterationsExceeded(u32),

    #[error("Loop Engineering 速率限制超限: {0}")]
    RateLimitExceeded(String),

    #[error("Agent 已被中断")]
    Aborted,

    #[error("其他错误: {0}")]
    Other(String),
}

// ─── AgentLoop ────────────────────────────────────────────

/// AgentLoop — ReAct 模式的核心循环
///
/// 持有 [`NodeBackendAccessor`]（LLM 调用）和 [`ToolBus`]（工具执行），
/// 通过 `run` 方法启动 ReAct 循环。
///
/// # 使用示例
/// ```rust,ignore
/// let backend = Arc::new(GenaiBackend::new(provider_config));
/// let tool_bus = Arc::new(SimpleToolBus::new());
/// tool_bus.register(Arc::new(EchoTool)).await;
///
/// let agent = AgentLoop::new(backend, tool_bus)
///     .with_config(AgentLoopConfig {
///         max_iterations: 10,
///         system_prompt: Some("你是一个有用的助手".into()),
///         ..Default::default()
///     });
///
/// let response = agent.run("你好".into()).await?;
/// ```
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
    /// 事件广播器
    broadcaster: Arc<RwLock<EventBroadcaster>>,
    /// 是否正在流式输出（run 方法活跃中）
    ///
    /// 使用 `AtomicBool` 而非 `Mutex<bool>`，因为：
    /// 1. 只需布尔标志，无需复杂状态机
    /// 2. 原子操作足够保证可见性，且不阻塞异步任务
    /// 3. 前端 `IAgentBackend.isStreaming` 通过 `is_streaming()` 读取
    is_streaming: Arc<AtomicBool>,
    /// 长任务管理器（Loop Engineering 核心组件，阶段 2.2 新增）
    ///
    /// 每个 AgentLoop 持有独立的 `LongTaskManager`，负责：
    /// - 长任务状态机（running/completed/failed/cancelled）
    /// - 心跳定时器（5s 间隔，UI 监控用）
    /// - checkpoint 脏标记节流（避免频繁写 SQLite）
    /// - 协作式取消标志（ReAct 循环每轮检查）
    ///
    /// 调用方通过 `long_task_manager()` 获取只读引用，调用 `start_task` / `complete_task`
    /// / `request_cancel` / `checkpoint` 等方法。持久化由 Tauri 端 `LongTaskRepository`
    /// 通过 `HeartbeatTick` 回调驱动，agent-runtime 不依赖 rusqlite。
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
    /// 最近一次 Deep Mode 阶段标签（P2 新增）
    ///
    /// 用于检测阶段切换：每次工具执行后调用 `classify_tool`，
    /// 若返回的标签与 `last_phase_label` 不同，则广播 `DeepPhaseChanged` 事件。
    ///
    /// - 初始值 `None`：尚未执行任何工具，首次工具调用必定触发事件
    /// - 后续值 `Some("证据收集")` 等：缓存上次阶段标签
    ///
    /// 使用 `StdRwLock<String>` 而非 `Mutex<String>`：
    /// - 临界区极短（仅读写一个 `Option<String>`），不跨 await
    /// - 读写比例约 1:1，RwLock 略优于 Mutex
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
            broadcaster,
            is_streaming,
            long_task_manager,
            last_user_text,
            last_llm_call_time,
            last_phase_label,
            loop_controller,
            loop_control_warned,
        }
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
        if let Ok(mut guard) = self.config.write() {
            *guard = config;
        } else {
            warn!("with_config: config RwLock poisoned, 配置未更新");
        }
        self
    }

    /// 运行时更新配置
    pub async fn set_config(&self, config: AgentLoopConfig) {
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

    /// 启动 ReAct 循环
    ///
    /// # 参数
    /// - `user_input`：用户输入文本
    ///
    /// # 返回
    /// 最终响应文本（LLM 在最后一轮未触发工具调用时的回复）
    ///
    /// # 流式事件
    /// - `AgentStart`：循环开始（携带 `backend.current_model()` 返回的模型 ID）
    /// - `UserMessage`：用户消息推入
    /// - `StreamStart`：首次 LLM 调用前（携带模型 ID）
    /// - `StreamDelta`：流式增量（由 backend 桥接转发）
    /// - `StreamEnd`：最终文本返回
    /// - `AgentEnd`：循环结束
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
            state.messages.push(OrchestratorMessage {
                role: MessageRole::User,
                content: user_input.clone(),
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

        result
    }

    /// ReAct 核心循环
    ///
    /// 单层循环：LLM 调用 → 工具执行 → LLM 再调用 → ... → 最终文本
    ///
    /// # Loop Engineering 集成（阶段 2.2 批次3）
    /// - **协作式取消**（批次3.2）：每轮迭代开始检查 `long_task_manager.is_cancel_requested()`，
    ///   若为 true 调用 `cancel_task()` 转换状态机并返回 `Aborted`。
    ///   设计动机：让当前 tool call 完成后优雅停止，而非强制中断（符合"无强制中断"需求）。
    /// - **事件驱动 checkpoint**（批次3.3）：每次工具执行完成后调用 `long_task_manager.checkpoint()`，
    ///   更新 `turn_count` / `current_tool` / checkpoint 快照（含完整 messages 用于断点恢复）。
    ///   节流策略：仅在 `has_active_task()` 时生成 checkpoint 快照，避免无活跃任务时的无效克隆。
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

            // ─── Loop Engineering 批次5：内建 LoopController 驱动 ───
            // 每轮迭代开始：
            // - 更新看门狗活动时间（watchdog.update_activity）
            // - 记录 turns 计数（rate_limiter.inc_turns）
            // - check_all() 一站式检查速率限制 / 软超时 / 看门狗
            // - 软超时 / 看门狗 → 广播 LoopEng* 事件（提醒，不强制停止，符合"无强制中断"需求）
            // - 速率限制超限 → 广播 LoopEngRateLimitExceeded 并停止循环
            //
            // 设计：与命令层 `LoopControlRegistry`（按 task_id 手动 check_and_emit）互补。
            // 本块是 AgentLoop 内建自动驱动，仅当 `config.loop_control = Some(...)`（默认启用）时生效。
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

            // ─── 风险点修复：同步 state.messages → backend（2026-08-04）───
            //
            // 架构问题：AgentLoop 把消息放在 state.messages，但 backend.prompt 只接收
            // 单个 prompt 字符串，backend 内部自维护自己的 messages（初始为空）。
            // 此前 AgentLoop 传空字符串 prompt，导致真实用户消息（system/user）从未传给
            // backend，LLM 收到的只有空 user 消息 → 不触发工具调用（实测复现）。
            //
            // 修复：每次 LLM 调用前，把 state.messages 完整同步给 backend。
            // 注意：backend.prompt 返回后会在 backend.messages 追加 assistant 消息，
    // 但工具执行产生的 toolResult 消息只在 state.messages，故每轮必须重新同步。
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
                        meta: None,
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

            // 推入 assistant 消息（含 tool_calls）
            {
                let mut state = self.state.lock().await;
                state.messages.push(OrchestratorMessage {
                    role: MessageRole::Assistant,
                    content: assistant_text,
                    tool_calls: tool_calls.clone(),
                    tool_call_id: None,
                    meta: None,
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

            // ─── Loop Engineering 批次3.3：事件驱动 checkpoint 更新 ───
            // 每次 tool_execution_end + turn_end 触发 checkpoint 更新：
            // - progress_turn_count：当前迭代轮次（用于 UI 显示进度）
            // - progress_current_tool：最后一个工具名（用于 UI 显示当前阶段）
            // - new_checkpoint：完整 messages 快照（用于断点恢复续跑）
            //
            // 节流优化：仅当有活跃长任务时才生成 checkpoint 快照（克隆 messages 有开销）
            // 持久化节流：dirty 标记由心跳定时器（5s 一次）批量写库，避免每轮都落 SQLite
            //
            // ─── P2 新增：Deep Mode 阶段判定与事件广播 ───
            // 在 checkpoint 前计算 current_phase，使长任务持久化时也带上阶段标签；
            // 同时检测阶段变化并广播 `DeepPhaseChanged` 事件，前端构建 deepSegments。
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

    // ─── Loop Engineering 批次5：内建 LoopController 辅助方法 ─────────

    /// 获取当前任务 ID（用于 LoopEng 事件广播）
    ///
    /// 复用长任务管理器当前活跃任务的 task_id；若无活跃长任务则返回空串，
    /// 由 Tauri 端按 session 填充（对齐 `DeepPhaseChanged.node_id` 的处理方式）。
    async fn loop_task_id(&self) -> String {
        self.long_task_manager
            .get_active_task_id()
            .await
            .unwrap_or_default()
    }

    /// 广播恢复事件（`LoopEngRecovered`）
    ///
    /// # 触发
    /// 内建 LoopController 的告警锁存态（`is_alerted()`）由 `true → false` 跳变时触发。
    /// 基于底层触发标志（SoftTimeout/Watchdog 的 `*_triggered`）而非 `check_all` 返回级别，
    /// 避免软超时锁存后"后续 check 返回 None"被误判为恢复。
    ///
    /// # 恢复场景
    /// - 看门狗：活动恢复（`update_activity` 清除 Idle/Dead 触发标志）
    /// - 软超时：`reset()`（命令层 `reset_counters` / retry 路径）
    ///
    /// 符合项目"无强制中断"原则：恢复为协作式自动上报，不干预循环本身。
    async fn emit_loop_recovered_if_needed(&self) {
        let alerted_now = self.loop_controller.is_alerted();
        let was_alerted = self
            .loop_control_warned
            .swap(alerted_now, Ordering::SeqCst);
        if was_alerted && !alerted_now {
            let task_id = self.loop_task_id().await;
            let turn_count = self.loop_controller.rate_limiter.turns();
            self.broadcast(OrchestratorEvent::LoopEngRecovered {
                task_id,
                turn_count,
                recovery_method: "auto".to_string(),
            })
            .await;
        }
    }

    /// 广播软超时 / 看门狗告警事件（不停止循环，仅提醒用户）
    ///
    /// # 设计
    /// - 软超时：达到 `warn_threshold` → `LoopEngSoftTimeoutWarning`；
    ///   达到 `critical_threshold` → `LoopEngSoftTimeoutCritical`（建议停止，但不强制）
    /// - 看门狗：达到 `idle_threshold` → `LoopEngWatchdogIdle`；
    ///   达到 `dead_threshold` → `LoopEngWatchdogDead`（建议恢复，但不自动恢复）
    ///
    /// 符合项目"无强制中断"原则：所有控制均为协作式软限制。
    async fn emit_loop_control_warnings(&self, check: &LoopControlCheck) {
        let task_id = self.loop_task_id().await;
        if let Some(level) = &check.soft_timeout_level {
            let elapsed_secs = self.loop_controller.soft_timeout.elapsed().as_secs();
            let cfg = self.loop_controller.soft_timeout.config();
            match level {
                SoftTimeoutLevel::Warning => {
                    self.broadcast(OrchestratorEvent::LoopEngSoftTimeoutWarning {
                        task_id: task_id.clone(),
                        elapsed_secs,
                        threshold_secs: cfg.warn_threshold.as_secs(),
                    })
                    .await;
                }
                SoftTimeoutLevel::Critical => {
                    self.broadcast(OrchestratorEvent::LoopEngSoftTimeoutCritical {
                        task_id: task_id.clone(),
                        elapsed_secs,
                        threshold_secs: cfg.critical_threshold.as_secs(),
                    })
                    .await;
                }
            }
        }
        if let Some(alert) = &check.watchdog_alert {
            match alert {
                WatchdogAlert::Idle {
                    last_activity,
                    elapsed,
                } => {
                    self.broadcast(OrchestratorEvent::LoopEngWatchdogIdle {
                        task_id: task_id.clone(),
                        last_activity: *last_activity,
                        idle_secs: elapsed.as_secs(),
                    })
                    .await;
                }
                WatchdogAlert::Dead {
                    last_activity,
                    elapsed,
                } => {
                    self.broadcast(OrchestratorEvent::LoopEngWatchdogDead {
                        task_id: task_id.clone(),
                        last_activity: *last_activity,
                        idle_secs: elapsed.as_secs(),
                    })
                    .await;
                }
            }
        }
    }

    /// 广播速率限制超限事件并更新长任务状态
    ///
    /// # 触发
    /// `check_all().rate_limit_exceeded` 非空时调用（turns / tool_calls / tokens / duration 任一超限）。
    ///
    /// # 动作
    /// 1. 广播 `LoopEngRateLimitExceeded`（携带超限类型 + 当前/最大值，前端可展示进度）
    /// 2. 同步 `LongTaskManager` 的 rate_limit 状态（供 heartbeat tick 携带）
    async fn emit_rate_limit_exceeded(&self, exceeded: &RateLimitExceeded) {
        let task_id = self.loop_task_id().await;
        // 将超限枚举映射为事件字段（limit_type / current / max）
        let (limit_type, current, max) = match exceeded {
            RateLimitExceeded::Turns { current, max } => {
                ("turns", *current as u64, *max as u64)
            }
            RateLimitExceeded::ToolCalls { current, max } => {
                ("tool_calls", *current as u64, *max as u64)
            }
            RateLimitExceeded::Tokens { current, max } => ("tokens", *current, *max),
            RateLimitExceeded::Duration { current, max } => {
                ("duration", current.as_secs(), max.as_secs())
            }
        };
        info!(
            "Loop Engineering 速率限制超限: {} ({}/{})",
            limit_type, current, max
        );
        self.broadcast(OrchestratorEvent::LoopEngRateLimitExceeded {
            task_id,
            limit_type: limit_type.to_string(),
            current,
            max,
        })
        .await;
        // 同步长任务状态（供心跳 tick 携带 + 前端展示）
        self.long_task_manager.record_rate_limit_status(limit_type).await;
    }

    /// 广播 `LoopEngRetrying` 事件（重试决策时调用）
    async fn emit_loop_retrying(&self, attempt: u32, max_retries: u32, backoff_ms: u64, error: &str) {
        let task_id = self.loop_task_id().await;
        self.broadcast(OrchestratorEvent::LoopEngRetrying {
            task_id,
            attempt,
            max_retries,
            backoff_ms,
            error: error.to_string(),
        })
        .await;
    }

    /// 广播 `LoopEngRetryExhausted` 事件（重试次数用尽时调用）
    async fn emit_loop_retry_exhausted(&self, total_attempts: u32, final_error: &str) {
        let task_id = self.loop_task_id().await;
        self.broadcast(OrchestratorEvent::LoopEngRetryExhausted {
            task_id,
            total_attempts,
            final_error: final_error.to_string(),
        })
        .await;
    }

    /// 构建 PromptCallOptions
    ///
    /// 阶段 1.4：从 `tool_bus.list_all()` 拉取工具定义并填入 `tools` 字段，
    /// 让 LLM 能看到完整工具列表（含 JSON Schema）以触发 tool_calls。
    ///
    /// 每轮循环都重新拉取，确保动态注册的工具（如 MCP 工具）能被 LLM 调用。
    async fn build_prompt_options(&self, config: &AgentLoopConfig) -> PromptCallOptions {
        let tools = self.tool_bus.list_all().await;
        PromptCallOptions {
            system_prompt_override: config.system_prompt.clone(),
            tools_override: None,
            tools,
            temperature: config.temperature,
            max_tokens: config.max_tokens,
            thinking_level: config.thinking_level,
            images: Vec::new(),
        }
    }

    // ─── Loop Engineering 批次4：通用循环控制 ─────────────

    /// 调用 LLM，含限流/超时/重试（批次4）
    ///
    /// 包裹 `backend.prompt`，根据 [`AgentLoopConfig`] 应用以下策略：
    ///
    /// # 1. 限流（`min_interval_between_calls`）
    /// 在每次 LLM 调用前检查距上次调用的间隔，不足则 sleep。
    /// 限流目的是避免触发 Provider 速率限制（如 DeepSeek 60次/分钟）。
    ///
    /// # 2. 超时（`llm_timeout`）
    /// 用 `tokio::time::timeout` 包裹 `backend.prompt`，超时视为单次调用失败，
    /// 触发重试（若 `llm_max_retries > 0`）。
    /// 注意：超时只针对单次调用，不针对整个任务。
    ///
    /// # 3. 重试（`llm_max_retries` + 指数退避）
    /// 失败时按 `delay = llm_retry_base_delay * 2^attempt` 等待后重试。
    /// 适用场景：网络抖动、429 Too Many Requests、5xx 服务器错误。
    /// 不区分错误类型：认证失败/参数错误重试也无效，但当前实现不细分（简化逻辑）。
    ///
    /// # 4. 取消检查
    /// 每次重试前检查 `long_task_manager.is_cancel_requested()`，
    /// 若已请求取消则返回 [`AgentError::Aborted`]，避免无谓重试。
    ///
    /// # 调用时机
    /// - `run_react_loop` 中每轮 LLM 调用
    /// - 不在 `follow_up` / `clear_history` 等非 LLM 调用中使用
    ///
    /// # 参数
    /// - `prompt_input`：用户输入文本（阶段 1.3 传空字符串，因消息已通过 state.messages 注入）
    /// - `options`：PromptCallOptions（含工具定义、系统提示词等）
    ///
    /// # 返回
    /// - `Ok(PromptResponse)`：LLM 响应
    /// - `Err(AgentError::Aborted)`：协作式取消
    /// - `Err(AgentError::Backend(_))`：重试耗尽后的最后一次错误
    async fn call_llm_with_retry(
        &self,
        prompt_input: String,
        options: Option<PromptCallOptions>,
    ) -> Result<crate::backend::PromptResponse, AgentError> {
        let config = self.config_snapshot();
        let max_retries = config.llm_max_retries;
        let base_delay = config.llm_retry_base_delay;
        let timeout = config.llm_timeout;
        let min_interval = config.min_interval_between_calls;

        // 1. 限流：等待最小间隔
        if let Some(min_interval) = min_interval {
            let wait_time = {
                // 同步读取 + 计算需等待的时间，不跨 await 持锁
                let last = self.last_llm_call_time.lock().ok();
                last.and_then(|g| {
                    g.as_ref().and_then(|last_time| {
                        let elapsed = Instant::now().duration_since(*last_time);
                        if elapsed < min_interval {
                            Some(min_interval - elapsed)
                        } else {
                            None
                        }
                    })
                })
            };
            if let Some(wait) = wait_time {
                debug!("LLM 限流：等待 {:?}", wait);
                tokio::time::sleep(wait).await;
            }
        }

        // 2. 调用 + 重试 + 超时
        let mut attempt: u32 = 0;
        loop {
            // 取消检查（每次重试前）
            if self.long_task_manager.is_cancel_requested() {
                info!("call_llm_with_retry: 检测到取消请求，停止重试");
                return Err(AgentError::Aborted);
            }

            // 执行调用（含超时）
            // 注意：timeout 仅包裹 backend.prompt 的未来，不影响后续逻辑
            let call_result = if let Some(t) = timeout {
                match tokio::time::timeout(
                    t,
                    self.backend.prompt(prompt_input.clone(), options.clone()),
                )
                .await
                {
                    Ok(r) => r,
                    Err(_elapsed) => {
                        warn!("LLM 调用超时（{:?}，attempt {}）", t, attempt + 1);
                        Err(BackendError::Other(format!(
                            "LLM 调用超时（{:?}）",
                            t
                        )))
                    }
                }
            } else {
                self.backend
                    .prompt(prompt_input.clone(), options.clone())
                    .await
            };

            // 记录调用时间（无论成功失败都记录，用于限流；同步写入不跨 await）
            if let Ok(mut last) = self.last_llm_call_time.lock() {
                *last = Some(Instant::now());
            }

            match call_result {
                Ok(resp) => return Ok(resp),
                Err(e) => {
                    if attempt >= max_retries {
                        warn!(
                            "LLM 调用失败，已达最大重试次数 {}：{}",
                            max_retries, e
                        );
                        // Loop Engineering 批次5：广播重试耗尽事件
                        self.emit_loop_retry_exhausted(max_retries, &e.to_string())
                            .await;
                        return Err(AgentError::from(e));
                    }
                    let delay = base_delay * 2u32.pow(attempt);
                    warn!(
                        "LLM 调用失败（attempt {}/{}），{:?} 后重试：{}",
                        attempt + 1,
                        max_retries,
                        delay,
                        e
                    );
                    // Loop Engineering 批次5：广播正在重试事件（attempt 从 1 计）
                    self.emit_loop_retrying(
                        attempt + 1,
                        max_retries,
                        delay.as_millis() as u64,
                        &e.to_string(),
                    )
                    .await;
                    tokio::time::sleep(delay).await;
                    attempt += 1;
                }
            }
        }
    }

    /// 执行单个工具调用，含超时/重试（批次4）
    ///
    /// 包裹 `tool_bus.call_tool`，根据 [`AgentLoopConfig`] 应用以下策略：
    ///
    /// # 1. 超时（`tool_timeout`）
    /// 用 `tokio::time::timeout` 包裹 `tool_bus.call_tool`，超时视为单次执行失败。
    /// 超时后工具执行被视为失败，错误信息推入 toolResult 消息让 LLM 处理。
    ///
    /// # 2. 重试（`tool_max_retries` + 指数退避）
    /// 失败时按 `delay = tool_retry_base_delay * 2^attempt` 等待后重试。
    /// **默认 0=不重试**，因为工具可能有副作用（如写文件、发请求），
    /// 重复执行可能导致数据不一致。需要重试的工具应在 ToolBus 层自行实现。
    ///
    /// # 3. 取消检查
    /// 每次重试前检查 `long_task_manager.is_cancel_requested()`，
    /// 若已请求取消则返回 [`ToolError::Aborted`]，避免无谓重试。
    ///
    /// # 注意
    /// - 仅在串行模式生效（`parallel_tool_calls=false`，默认配置）
    /// - 并行模式因 `self` 无法 move 进 'static 闭包，不应用超时/重试
    ///
    /// # 参数
    /// - `name`：工具名
    /// - `args`：工具参数（JSON Value）
    async fn execute_tool_with_retry(
        &self,
        name: &str,
        args: serde_json::Value,
    ) -> Result<serde_json::Value, ToolError> {
        let config = self.config_snapshot();
        let max_retries = config.tool_max_retries;
        let base_delay = config.tool_retry_base_delay;
        let timeout = config.tool_timeout;

        let mut attempt: u32 = 0;
        loop {
            // 取消检查（每次重试前）
            if self.long_task_manager.is_cancel_requested() {
                info!("execute_tool_with_retry: 检测到取消请求，停止重试");
                return Err(ToolError::Aborted);
            }

            // 执行调用（含超时）
            let call_result = if let Some(t) = timeout {
                match tokio::time::timeout(t, self.tool_bus.call_tool(name, args.clone())).await {
                    Ok(r) => r,
                    Err(_elapsed) => {
                        warn!("工具 {} 执行超时（{:?}，attempt {}）", name, t, attempt + 1);
                        Err(ToolError::Timeout)
                    }
                }
            } else {
                self.tool_bus.call_tool(name, args.clone()).await
            };

            match call_result {
                Ok(v) => return Ok(v),
                Err(e) => {
                    if attempt >= max_retries {
                        // Loop Engineering 批次5：广播重试耗尽事件
                        self.emit_loop_retry_exhausted(max_retries, &e.to_string())
                            .await;
                        return Err(e);
                    }
                    let delay = base_delay * 2u32.pow(attempt);
                    warn!(
                        "工具 {} 执行失败（attempt {}/{}），{:?} 后重试：{}",
                        name,
                        attempt + 1,
                        max_retries,
                        delay,
                        e
                    );
                    // Loop Engineering 批次5：广播正在重试事件（attempt 从 1 计）
                    self.emit_loop_retrying(
                        attempt + 1,
                        max_retries,
                        delay.as_millis() as u64,
                        &e.to_string(),
                    )
                    .await;
                    tokio::time::sleep(delay).await;
                    attempt += 1;
                }
            }
        }
    }

    /// 执行工具调用
    ///
    /// 阶段 1.3：仅串行执行
    /// 阶段 1.4：根据 `config.parallel_tool_calls` 启用并行（基于 `tokio::task::JoinSet`）
    ///
    /// # 并行模式策略
    /// 1. 主任务按顺序广播所有 `ToolCallStart`（UI 能先看到全部待执行工具）
    /// 2. 用 `JoinSet` 并发 spawn 每个工具调用
    /// 3. 收集结果后按原索引排序（保证 toolResult 消息顺序与 tool_calls 一致，便于 LLM 理解）
    /// 4. 主任务按顺序广播 `ToolCallEnd`
    ///
    /// 单工具调用时走串行路径（避免 spawn 开销）。
    async fn execute_tool_calls(
        &self,
        tool_calls: Vec<ToolCall>,
    ) -> Result<Vec<OrchestratorMessage>, AgentError> {
        let config_snapshot = self.config_snapshot();
        if config_snapshot.parallel_tool_calls && tool_calls.len() > 1 {
            self.execute_tool_calls_parallel(tool_calls).await
        } else {
            self.execute_tool_calls_serial(tool_calls).await
        }
    }

    /// 串行执行工具调用
    ///
    /// # Loop Engineering 批次4 集成
    /// 通过 [`execute_tool_with_retry`] 包裹每个工具调用：
    /// - 超时：`tool_timeout` 限制单次工具执行时长
    /// - 重试：`tool_max_retries` 控制失败重试次数（默认 0=不重试）
    /// - 取消：每次重试前检查 `cancel_flag`
    async fn execute_tool_calls_serial(
        &self,
        tool_calls: Vec<ToolCall>,
    ) -> Result<Vec<OrchestratorMessage>, AgentError> {
        let mut results = Vec::with_capacity(tool_calls.len());

        for tc in tool_calls {
            // 广播 ToolCallStart
            self.broadcast(OrchestratorEvent::Agent(AgentEvent::ToolCallStart {
                tool_call_id: tc.id.clone(),
                name: tc.name.clone(),
                args: tc.args.clone(),
            }))
            .await;

            debug!("执行工具: {} (call_id={})", tc.name, tc.id);

            // Loop Engineering 批次5：记录工具调用计数（供速率限制 tool_calls 维度）
            if self.loop_control_enabled() {
                self.loop_controller.rate_limiter.inc_tool_calls();
            }

            // 调用工具（含重试/超时，批次4）
            let tool_result = self.execute_tool_with_retry(&tc.name, tc.args.clone()).await;

            let result_value = match tool_result {
                Ok(v) => v,
                Err(e) => {
                    warn!("工具 {} 执行失败: {}", tc.name, e);
                    serde_json::json!({
                        "error": e.to_string(),
                        "tool": tc.name,
                    })
                }
            };

            // 广播 ToolCallEnd
            self.broadcast(OrchestratorEvent::Agent(AgentEvent::ToolCallEnd {
                tool_call_id: tc.id.clone(),
                result: result_value.clone(),
            }))
            .await;

            // 构造 toolResult 消息
            let tool_result_msg = OrchestratorMessage {
                role: MessageRole::ToolResult,
                content: serde_json::to_string(&result_value).unwrap_or_else(|_| {
                    format!("{{\"error\":\"结果序列化失败\",\"tool\":\"{}\"}}", tc.name)
                }),
                tool_calls: Vec::new(),
                tool_call_id: Some(tc.id.clone()),
                meta: None,
            };

            results.push(tool_result_msg);
        }

        Ok(results)
    }

    /// 并行执行工具调用（基于 `tokio::task::JoinSet`）
    ///
    /// 事件广播顺序：
    /// - `ToolCallStart` × N（按原顺序，spawn 前）
    /// - 工具并发执行（每个 task 不广播，避免事件交错）
    /// - `ToolCallEnd` × N（按原索引顺序，结果收集完成后）
    async fn execute_tool_calls_parallel(
        &self,
        tool_calls: Vec<ToolCall>,
    ) -> Result<Vec<OrchestratorMessage>, AgentError> {
        // 1. 按顺序广播所有 ToolCallStart
        for tc in &tool_calls {
            self.broadcast(OrchestratorEvent::Agent(AgentEvent::ToolCallStart {
                tool_call_id: tc.id.clone(),
                name: tc.name.clone(),
                args: tc.args.clone(),
            }))
            .await;
        }

        // 2. 用 JoinSet 并发执行
        // 每个 task 返回 (原索引, call_id, tool_name, result_value)
        //
        // ─── Loop Engineering 批次4 集成 ───
        // 并行模式下的工具重试/超时限制：
        // - **超时**：每个 task 独立应用 `tool_timeout`（spawn 内部用 `tokio::time::timeout`）
        // - **重试**：每个 task 独立重试（`tool_max_retries` 控制单工具重试次数）
        // - **限流**：不在并行模式应用（并行执行本身就不需要严格限流）
        //
        // 注意：spawn 内部不能调用 `self.execute_tool_with_retry`（因为 `self` 不能 move 进
        // 'static 闭包），因此这里直接用 `tool_bus.call_tool`，不应用超时/重试。
        // 若需在并行模式应用超时/重试，应在 ToolBus 层实现（如 `RetryToolBus` 装饰器）。
        // 当前实现保持并行模式简单，超时/重试仅在串行模式生效（默认配置 parallel_tool_calls=false）。
        let mut join_set: tokio::task::JoinSet<
            (usize, String, String, serde_json::Value),
        > = tokio::task::JoinSet::new();

        for (idx, tc) in tool_calls.into_iter().enumerate() {
            let tool_bus = self.tool_bus.clone();
            let call_id = tc.id.clone();
            let tool_name = tc.name.clone();
            let args = tc.args.clone();

            // Loop Engineering 批次5：记录工具调用计数（供速率限制 tool_calls 维度）
            if self.loop_control_enabled() {
                self.loop_controller.rate_limiter.inc_tool_calls();
            }

            join_set.spawn(async move {
                debug!("并行执行工具: {} (call_id={})", tool_name, call_id);
                let result_value = match tool_bus.call_tool(&tool_name, args).await {
                    Ok(v) => v,
                    Err(e) => {
                        warn!("工具 {} 并行执行失败: {}", tool_name, e);
                        serde_json::json!({
                            "error": e.to_string(),
                            "tool": tool_name,
                        })
                    }
                };
                (idx, call_id, tool_name, result_value)
            });
        }

        // 3. 收集所有结果
        let mut indexed_results: Vec<(usize, String, String, serde_json::Value)> =
            Vec::with_capacity(join_set.len());

        while let Some(joined) = join_set.join_next().await {
            match joined {
                Ok(item) => indexed_results.push(item),
                Err(join_err) => {
                    // JoinError 意味着 task panic，用占位结果填补
                    warn!("工具并行执行 task panic: {}", join_err);
                    indexed_results.push((
                        0, // 占位索引，排序后会被覆盖或放到最前
                        String::new(),
                        String::new(),
                        serde_json::json!({
                            "error": format!("task panic: {join_err}"),
                        }),
                    ));
                }
            }
        }

        // 4. 按原索引排序，保证 toolResult 顺序与 tool_calls 一致
        indexed_results.sort_by_key(|(idx, _, _, _)| *idx);

        // 5. 按顺序广播 ToolCallEnd 并构造 toolResult 消息
        let mut results = Vec::with_capacity(indexed_results.len());
        for (_, call_id, tool_name, result_value) in indexed_results {
            self.broadcast(OrchestratorEvent::Agent(AgentEvent::ToolCallEnd {
                tool_call_id: call_id.clone(),
                result: result_value.clone(),
            }))
            .await;

            let tool_result_msg = OrchestratorMessage {
                role: MessageRole::ToolResult,
                content: serde_json::to_string(&result_value).unwrap_or_else(|_| {
                    format!("{{\"error\":\"结果序列化失败\",\"tool\":\"{}\"}}", tool_name)
                }),
                tool_calls: Vec::new(),
                tool_call_id: Some(call_id),
                meta: None,
            };

            results.push(tool_result_msg);
        }

        Ok(results)
    }

    // ─── IAgentBackend 接口补全（阶段 1.3 P0 修复） ─────────────

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
    /// 重置 state.messages 和 current_iteration，但保留 aborted 标志。
    pub async fn clear_history(&self) {
        let mut state = self.state.lock().await;
        state.messages.clear();
        state.current_iteration = 0;
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

    /// 是否正在流式输出 — 对应前端 `IAgentBackend.isStreaming`
    ///
    /// 基于 `run` 方法的活跃状态判断，使用 `AtomicBool` 保证原子可见性。
    pub fn is_streaming(&self) -> bool {
        self.is_streaming.load(Ordering::SeqCst)
    }

    /// 重置实例状态（委派超时后调用）
    ///
    /// 当子 Agent 的 `run` future 被 `tokio::time::timeout` 丢弃时：
    /// 1. `run` 尾部复位 `is_streaming` 的语句不会执行（future 被 drop，剩余代码
    ///    不运行），导致实例残留 `is_streaming=true`，前端/并发判断误以为仍在流式。
    /// 2. ReAct 循环可能在中途被丢弃，留下"含 `tool_calls` 但无配对 `toolResult` 的
    ///    assistant 消息"，污染下次复用的对话上下文。
    ///
    /// 本方法复位 `is_streaming` 并裁剪尾部不完整的工具调用消息，保证实例下次可复用。
    ///
    /// **注意**：不置位 `state.aborted`——置位会使实例永久不可复用（下次 `run` 立即
    /// 返回 `Aborted`），与"复用实例累积上下文"的目标冲突。若确需彻底停用实例，应调用
    /// [`AgentLoop::dispose`]。
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
        }
    }

    /// 热切换模型 — 对应前端 `IAgentBackend.updateModel(...)`
    ///
    /// 委托给 `backend.update_provider`，不清空消息历史。
    /// 同时更新 config 的 temperature/max_tokens（若传入）。
    ///
    /// # 参数
    /// - `provider`：Provider ID（如 "deepseek"/"openai"/"anthropic"）
    /// - `model_id`：模型 ID
    /// - `base_url`：自定义 base URL
    /// - `api_key`：API Key（None=保持原值）
    /// - `temperature`：温度（None=保持原值）
    /// - `max_tokens`：最大 token（None=保持原值）
    pub async fn update_model(
        &self,
        provider: String,
        model_id: String,
        base_url: Option<String>,
        api_key: Option<String>,
        temperature: Option<f32>,
        max_tokens: Option<u32>,
    ) -> Result<(), AgentError> {
        // 1. 调用 backend.update_provider 热切换
        // clone provider/model_id 供下面日志使用，避免 move 后借用报错
        self.backend
            .update_provider(provider.clone(), model_id.clone(), api_key, base_url)
            .await
            .map_err(AgentError::from)?;

        // 2. 同步更新 config 的 temperature/max_tokens（若传入）
        if temperature.is_some() || max_tokens.is_some() {
            if let Ok(mut guard) = self.config.write() {
                if let Some(t) = temperature {
                    guard.temperature = Some(t);
                }
                if let Some(m) = max_tokens {
                    guard.max_tokens = Some(m);
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

    // ─── Loop Engineering 集成（阶段 2.2 新增） ─────────────

    /// 获取长任务管理器引用
    ///
    /// 调用方通过此引用调用 `LongTaskManager` 的方法：
    /// - `start_task` / `complete_task` / `fail_task` / `cancel_task`
    /// - `request_cancel` / `is_cancel_requested`（协作式取消）
    /// - `checkpoint`（事件驱动更新 checkpoint）
    /// - `start_heartbeat` / `stop_heartbeat`（心跳定时器）
    /// - `get_active_task` / `get_heartbeat_status`（UI 查询）
    ///
    /// # 设计说明
    /// 返回 `&LongTaskManager`（Arc 解引用），调用方无法 clone Arc 自身，
    /// 但可以通过 `Arc::clone(&agent.long_task_manager())` 获取独立的所有权句柄。
    pub fn long_task_manager(&self) -> &LongTaskManager {
        &self.long_task_manager
    }

    /// 获取长任务管理器的 Arc 句柄
    ///
    /// 用于需要独立持有 `Arc<LongTaskManager>` 的场景（如心跳定时器回调闭包）。
    pub fn long_task_manager_arc(&self) -> Arc<LongTaskManager> {
        Arc::clone(&self.long_task_manager)
    }

    /// 启动长任务心跳定时器（helper 方法，批次3.4）
    ///
    /// 封装 [`LongTaskManager::start_heartbeat`]，让调用方无需手动传入 `manager_arc`。
    ///
    /// # 参数
    /// - `on_tick`：心跳 tick 回调（持久化逻辑）
    ///
    /// # 行为
    /// 1. 获取 `long_task_manager` 的 Arc 句柄
    /// 2. 调用 `LongTaskManager::start_heartbeat(manager_arc, on_tick)`
    ///
    /// # 调用时机
    /// - **长任务启动后**：调用方先 `start_task()` 创建任务，再调用本方法启动心跳
    /// - **断点恢复后**：调用方先 `resume_task()` 恢复内存状态，再调用本方法重启心跳
    ///
    /// # 使用示例（Tauri 命令层）
    /// ```rust,ignore
    /// agent_loop.start_long_task_heartbeat(|tick| async move {
    ///     match tick {
    ///         HeartbeatTick::HeartbeatOnly { task_id, last_heartbeat_at } => {
    ///             // 轻量写入：仅更新 last_heartbeat_at 列
    ///             if let Some(repo) = state.long_task_repository.get() {
    ///                 let _ = repo.update_heartbeat(task_id, last_heartbeat_at).await;
    ///             }
    ///         }
    ///         HeartbeatTick::CheckpointFlush { task_id, record } => {
    ///             // 重量级写入：upsert 完整 record（含最新 checkpoint）
    ///             if let Some(repo) = state.long_task_repository.get() {
    ///                 let _ = repo.save(record).await;
    ///             }
    ///         }
    ///     }
    /// }).await;
    /// ```
    ///
    /// # 设计说明
    /// - **不在 agent-runtime 内部自动启动**：持久化依赖 `LongTaskRepository`（Tauri 端），
    ///   agent-runtime crate 不依赖 rusqlite，故心跳定时器必须由调用方显式启动。
    /// - **回调闭包捕获**：`on_tick` 闭包可以捕获 Tauri `State` 等外部引用，
    ///   通过 `Arc<LongTaskRepository>` 等方式访问持久化层。
    pub async fn start_long_task_heartbeat<F, Fut>(&self, on_tick: F)
    where
        F: Fn(HeartbeatTick) -> Fut + Send + 'static,
        Fut: std::future::Future<Output = ()> + Send,
    {
        let manager_arc = self.long_task_manager_arc();
        self.long_task_manager
            .start_heartbeat(manager_arc, on_tick)
            .await;
    }

    /// 停止长任务心跳定时器（helper 方法，批次3.4）
    ///
    /// 封装 [`LongTaskManager::stop_heartbeat`]，用于 dispose / 显式停止场景。
    pub async fn stop_long_task_heartbeat(&self) {
        self.long_task_manager.stop_heartbeat().await;
    }
}

// ─── CheckpointProvider 实现 ────────────────────────────────────────────

/// 为 `AgentLoop` 实现 `CheckpointProvider`，供 `LongTaskManager` 拉取 checkpoint。
///
/// # 实现
/// - `agent_messages`：从 `state.messages` 克隆（持 AsyncMutex，需 await）
/// - `last_user_text`：从 `last_user_text` 字段读取（同步 RwLock）
/// - `skill_names` / `chat_mode` / `locked_chat_mode`：当前 AgentLoop 不持有，
///   留 `None`。调用方需要更细粒度的 checkpoint 时，直接构造 `LongTaskCheckpoint`
///   并调 `LongTaskManager::checkpoint()` 而不通过本 trait。
#[async_trait]
impl CheckpointProvider for AgentLoop {
    async fn get_checkpoint(&self) -> LongTaskCheckpoint {
        let messages = self.get_messages().await;
        let last_user_text = self
            .last_user_text
            .read()
            .map(|g| g.clone())
            .unwrap_or_default();
        LongTaskCheckpoint {
            agent_messages: messages,
            last_user_text,
            skill_names: None,
            chat_mode: None,
            locked_chat_mode: None,
        }
    }
}

// ─── Backend 事件桥接 ────────────────────────────────────────────

/// Backend 事件桥接 listener
///
/// 将 `NodeBackendAccessor`（如 `GenaiBackend`）广播的内部事件转发到
/// `AgentLoop` 的 `EventBroadcaster`，使订阅 AgentLoop 的监听器能收到
/// backend 的 `StreamStart`/`StreamDelta`/`StreamEnd`/`ToolCallStart`/`ToolCallEnd` 等事件。
///
/// # 设计动机
/// AgentLoop 和 Backend 各自持有独立的 `EventBroadcaster`：
/// - Backend 广播：LLM 流式增量、原始工具调用事件
/// - AgentLoop 广播：ReAct 循环级事件（AgentStart/UserMessage/AgentEnd 等）
///
/// 若不桥接，订阅 AgentLoop 的监听器收不到 backend 的流式事件，
/// 前端无法看到流式输出。
struct BackendEventBridge {
    /// 目标广播器（AgentLoop 的 broadcaster）
    target_broadcaster: Arc<RwLock<EventBroadcaster>>,
}

impl EventListener for BackendEventBridge {
    fn on_event(&self, event: &OrchestratorEvent) {
        // 同步转发：尝试读取 broadcaster，失败则丢弃（避免 panic）
        // 注意：使用 try_read 避免阻塞，因为 backend 可能在持有锁时调用
        if let Ok(broadcaster) = self.target_broadcaster.try_read() {
            broadcaster.broadcast(event);
        } else {
            // 锁竞争时丢弃事件（流式增量丢失一两个不影响整体）
            debug!("BackendEventBridge: broadcaster 锁竞争，丢弃事件");
        }
    }
}

// ─── 测试 ────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use crate::backend::PromptResponse;
    use crate::tool::{EchoTool, SimpleToolBus};
    use crate::types::ToolCall;

    /// Mock 后端 — 返回预设响应
    struct MockBackend {
        responses: AsyncMutex<Vec<PromptResponse>>,
        last_options: AsyncMutex<Option<PromptCallOptions>>,
    }

    impl MockBackend {
        fn new(responses: Vec<PromptResponse>) -> Self {
            Self {
                responses: AsyncMutex::new(responses),
                last_options: AsyncMutex::new(None),
            }
        }
    }

    #[async_trait]
    impl NodeBackendAccessor for MockBackend {
        async fn prompt(
            &self,
            _prompt: String,
            options: Option<PromptCallOptions>,
        ) -> Result<PromptResponse, BackendError> {
            *self.last_options.lock().await = options;
            let mut responses = self.responses.lock().await;
            if responses.is_empty() {
                return Err(BackendError::Other("no more mock responses".into()));
            }
            Ok(responses.remove(0))
        }

        async fn steer(&self, _text: String) -> Result<(), BackendError> {
            Ok(())
        }

        async fn get_messages(&self) -> Vec<OrchestratorMessage> {
            Vec::new()
        }

        async fn set_messages(
            &self,
            _messages: Vec<OrchestratorMessage>,
        ) -> Result<(), BackendError> {
            Ok(())
        }

        async fn trim_context(&self, _up_to_index: usize) -> Result<(), BackendError> {
            Ok(())
        }
    }

    #[tokio::test]
    async fn run_returns_final_text_when_no_tool_calls() {
        let backend = Arc::new(MockBackend::new(vec![PromptResponse::text_only(
            "你好，我是助手",
        )]));
        let tool_bus = Arc::new(SimpleToolBus::new());

        let agent = AgentLoop::new(backend, tool_bus);
        let result = agent.run("你好".into()).await.expect("应执行成功");

        assert_eq!(result, "你好，我是助手");
    }

    #[tokio::test]
    async fn run_executes_tool_calls_then_returns_final_text() {
        let backend = Arc::new(MockBackend::new(vec![
            PromptResponse {
                text: "我来调用 echo".into(),
                tool_calls: vec![ToolCall {
                    id: "call_1".into(),
                    name: "echo".into(),
                    args: serde_json::json!({"message": "hello"}),
                }],
                input_tokens: None,
                output_tokens: None,
                stop_reason: Some("tool_calls".into()),
            },
            PromptResponse::text_only("工具返回了 hello"),
        ]));
        let tool_bus = Arc::new(SimpleToolBus::new());
        tool_bus.register(Arc::new(EchoTool)).await;

        let agent = AgentLoop::new(backend, tool_bus);
        let result = agent.run("调用 echo 工具".into()).await.expect("应执行成功");

        assert_eq!(result, "工具返回了 hello");

        // 验证消息历史：user → assistant(含 tool_call) → toolResult → assistant(最终)
        let messages = agent.get_messages().await;
        assert_eq!(messages.len(), 4);
        assert!(matches!(messages[0].role, MessageRole::User));
        assert!(matches!(messages[1].role, MessageRole::Assistant));
        assert_eq!(messages[1].tool_calls.len(), 1);
        assert!(matches!(messages[2].role, MessageRole::ToolResult));
        assert_eq!(messages[2].tool_call_id, Some("call_1".into()));
        assert!(matches!(messages[3].role, MessageRole::Assistant));
    }

    #[tokio::test]
    async fn run_returns_error_when_max_iterations_exceeded() {
        // 每轮都返回工具调用，永远不结束
        let infinite_tool_call = PromptResponse {
            text: "继续".into(),
            tool_calls: vec![ToolCall {
                id: "call_loop".into(),
                name: "echo".into(),
                args: serde_json::json!({}),
            }],
            input_tokens: None,
            output_tokens: None,
            stop_reason: Some("tool_calls".into()),
        };
        let backend = Arc::new(MockBackend::new(vec![infinite_tool_call; 100]));
        let tool_bus = Arc::new(SimpleToolBus::new());
        tool_bus.register(Arc::new(EchoTool)).await;

        let agent = AgentLoop::new(backend, tool_bus).with_config(AgentLoopConfig {
            max_iterations: 3,
            ..Default::default()
        });

        let result = agent.run("无限循环".into()).await;
        assert!(result.is_err());
        match result {
            Err(AgentError::MaxIterationsExceeded(3)) => {}
            _ => panic!("应返回 MaxIterationsExceeded(3)"),
        }
    }

    #[tokio::test]
    async fn abort_stops_loop() {
        let backend = Arc::new(MockBackend::new(vec![
            PromptResponse {
                text: "继续".into(),
                tool_calls: vec![ToolCall {
                    id: "call_1".into(),
                    name: "echo".into(),
                    args: serde_json::json!({}),
                }],
                input_tokens: None,
                output_tokens: None,
                stop_reason: Some("tool_calls".into()),
            },
            PromptResponse::text_only("最终回复"),
        ]));
        let tool_bus = Arc::new(SimpleToolBus::new());
        tool_bus.register(Arc::new(EchoTool)).await;

        let agent = AgentLoop::new(backend, tool_bus);
        agent.abort().await;

        let result = agent.run("测试中断".into()).await;
        assert!(matches!(result, Err(AgentError::Aborted)));
    }

    // ── failTask 终态闭环测试（2026-08-02 修复） ──
    // 修复前：run() 错误路径只广播 AgentEnd，前端误把失败任务标为 completed，failTask 永不触发。
    // 修复后：错误路径先广播 Error（前端 failTask）再广播 AgentEnd（前端清理 UI 状态）。

    /// 测试用：收集终态事件的监听器（Error / AgentEnd / StreamEnd）
    struct TerminalEventListener {
        events: std::sync::Mutex<Vec<String>>,
    }

    impl EventListener for TerminalEventListener {
        fn on_event(&self, event: &OrchestratorEvent) {
            let label = match event {
                OrchestratorEvent::Agent(AgentEvent::Error { message }) => {
                    format!("error:{message}")
                }
                OrchestratorEvent::Agent(AgentEvent::AgentEnd) => "agent_end".into(),
                OrchestratorEvent::Agent(AgentEvent::StreamEnd { .. }) => "stream_end".into(),
                _ => return,
            };
            if let Ok(mut v) = self.events.lock() {
                v.push(label);
            }
        }
    }

    #[tokio::test]
    async fn run_error_broadcasts_error_then_agent_end() {
        // 每轮都返回工具调用，永不结束 → 超迭代错误
        let infinite_tool_call = PromptResponse {
            text: "继续".into(),
            tool_calls: vec![ToolCall {
                id: "call_loop".into(),
                name: "echo".into(),
                args: serde_json::json!({}),
            }],
            input_tokens: None,
            output_tokens: None,
            stop_reason: Some("tool_calls".into()),
        };
        let backend = Arc::new(MockBackend::new(vec![infinite_tool_call; 100]));
        let tool_bus = Arc::new(SimpleToolBus::new());
        tool_bus.register(Arc::new(EchoTool)).await;

        let agent = AgentLoop::new(backend, tool_bus).with_config(AgentLoopConfig {
            max_iterations: 3,
            ..Default::default()
        });

        let listener = Arc::new(TerminalEventListener {
            events: std::sync::Mutex::new(Vec::new()),
        });
        agent.subscribe(listener.clone()).await;

        let result = agent.run("无限循环".into()).await;
        assert!(result.is_err());

        // 断言事件序列：Error 先于 AgentEnd（前端 failTask 依赖此顺序）
        let collected = listener.events.lock().unwrap().clone();
        assert!(
            collected.iter().any(|e| e.starts_with("error:")),
            "错误路径应广播 Error 事件，实际: {collected:?}"
        );
        assert!(
            collected.iter().any(|e| e == "agent_end"),
            "错误路径应广播 AgentEnd 事件（前端清理 UI 状态），实际: {collected:?}"
        );
        let error_pos = collected
            .iter()
            .position(|e| e.starts_with("error:"))
            .unwrap();
        let end_pos = collected.iter().position(|e| e == "agent_end").unwrap();
        assert!(
            error_pos < end_pos,
            "Error 应先于 AgentEnd，实际顺序: {collected:?}"
        );
    }

    #[tokio::test]
    async fn run_success_broadcasts_agent_end_without_error() {
        let backend = Arc::new(MockBackend::new(vec![PromptResponse::text_only("好的")]));
        let tool_bus = Arc::new(SimpleToolBus::new());

        let agent = AgentLoop::new(backend, tool_bus);

        let listener = Arc::new(TerminalEventListener {
            events: std::sync::Mutex::new(Vec::new()),
        });
        agent.subscribe(listener.clone()).await;

        let result = agent.run("你好".into()).await;
        assert!(result.is_ok());

        let collected = listener.events.lock().unwrap().clone();
        assert!(
            collected.iter().any(|e| e == "agent_end"),
            "成功路径应广播 AgentEnd，实际: {collected:?}"
        );
        assert!(
            !collected.iter().any(|e| e.starts_with("error:")),
            "成功路径不应广播 Error，实际: {collected:?}"
        );
    }

    #[tokio::test]
    async fn run_with_system_prompt_prepends_system_message() {
        let backend = Arc::new(MockBackend::new(vec![PromptResponse::text_only(
            "好的",
        )]));
        let tool_bus = Arc::new(SimpleToolBus::new());

        let agent = AgentLoop::new(backend, tool_bus).with_config(AgentLoopConfig {
            system_prompt: Some("你是一个翻译助手".into()),
            ..Default::default()
        });

        let _ = agent.run("hello".into()).await.unwrap();

        let messages = agent.get_messages().await;
        assert!(!messages.is_empty());
        assert!(matches!(messages[0].role, MessageRole::System));
        assert_eq!(messages[0].content, "你是一个翻译助手");
    }

    #[tokio::test]
    async fn tool_failure_does_not_break_loop() {
        // 工具不存在，应继续循环并返回最终文本
        let backend = Arc::new(MockBackend::new(vec![
            PromptResponse {
                text: "调用不存在的工具".into(),
                tool_calls: vec![ToolCall {
                    id: "call_1".into(),
                    name: "nonexistent_tool".into(),
                    args: serde_json::json!({}),
                }],
                input_tokens: None,
                output_tokens: None,
                stop_reason: Some("tool_calls".into()),
            },
            PromptResponse::text_only("工具失败，但我继续回复"),
        ]));
        let tool_bus = Arc::new(SimpleToolBus::new());

        let agent = AgentLoop::new(backend, tool_bus);
        let result = agent.run("调用不存在的工具".into()).await.expect("应执行成功");

        assert_eq!(result, "工具失败，但我继续回复");

        // 验证 toolResult 消息含错误信息
        let messages = agent.get_messages().await;
        assert_eq!(messages.len(), 4);
        assert!(matches!(messages[2].role, MessageRole::ToolResult));
        assert!(messages[2].content.contains("error"));
    }

    // ── Loop Engineering 批次5：内建 LoopController 驱动测试 ──

    /// 测试用：收集 LoopEng* 事件的监听器
    struct LoopEngEventListener {
        events: std::sync::Mutex<Vec<String>>,
    }

    impl EventListener for LoopEngEventListener {
        fn on_event(&self, event: &OrchestratorEvent) {
            let label = match event {
                OrchestratorEvent::LoopEngRateLimitExceeded {
                    limit_type,
                    current,
                    max,
                    ..
                } => format!("rate_limit:{limit_type}:{current}/{max}"),
                OrchestratorEvent::LoopEngRetrying { attempt, .. } => {
                    format!("retrying:{attempt}")
                }
                OrchestratorEvent::LoopEngRetryExhausted { total_attempts, .. } => {
                    format!("retry_exhausted:{total_attempts}")
                }
                OrchestratorEvent::LoopEngRecovered {
                    recovery_method,
                    turn_count,
                    ..
                } => format!("recovered:{recovery_method}:{turn_count}"),
                _ => return,
            };
            if let Ok(mut v) = self.events.lock() {
                v.push(label);
            }
        }
    }

    #[tokio::test]
    async fn run_stops_on_rate_limit_exceeded() {
        // 每轮都返回工具调用，永不结束；但内建 LoopController 限制 max_turns=2
        let infinite_tool_call = PromptResponse {
            text: "继续".into(),
            tool_calls: vec![ToolCall {
                id: "call_loop".into(),
                name: "echo".into(),
                args: serde_json::json!({}),
            }],
            input_tokens: None,
            output_tokens: None,
            stop_reason: Some("tool_calls".into()),
        };
        let backend = Arc::new(MockBackend::new(vec![infinite_tool_call; 100]));
        let tool_bus = Arc::new(SimpleToolBus::new());
        tool_bus.register(Arc::new(EchoTool)).await;

        let loop_config = LoopControlConfig {
            rate_limit: crate::loop_control::RateLimitConfig {
                max_turns: Some(2),
                max_tool_calls: None,
                max_tokens: None,
                max_duration: None,
            },
            ..LoopControlConfig::default()
        };
        // 用 with_loop_control 显式启用严格配置（验证独立于 with_config 的配置开关）
        let agent = AgentLoop::new(backend, tool_bus)
            .with_loop_control(Some(loop_config))
            .with_config(AgentLoopConfig {
                max_iterations: 100, // 不触发超迭代，验证是速率限制停止而非超迭代
                ..Default::default()
            });

        let listener = Arc::new(LoopEngEventListener {
            events: std::sync::Mutex::new(Vec::new()),
        });
        agent.subscribe(listener.clone()).await;

        let result = agent.run("触发速率限制".into()).await;
        assert!(
            matches!(result, Err(AgentError::RateLimitExceeded(_))),
            "应返回 RateLimitExceeded，实际: {result:?}"
        );

        let collected = listener.events.lock().unwrap().clone();
        assert!(
            collected.iter().any(|e| e.starts_with("rate_limit:turns:2/2")),
            "应广播 LoopEngRateLimitExceeded(turns 2/2)，实际: {collected:?}"
        );
    }

    #[tokio::test]
    async fn default_lenient_config_does_not_stop_normal_loop() {
        // 回归保护：默认（宽松）配置下，正常对话任务不应被速率限制误停。
        // 覆盖待办"桌面端实测宽松配置默认不误停止"的单元级可重复验证——
        // 以真实默认 LoopControlConfig（100 turns / 200 tools / 100k tokens / 6h）
        // 运行一个"几轮工具调用后返回文本"的正常流，断言最终返回 Ok 且未广播速率限制事件。
        let tool_call = |id: &str| PromptResponse {
            text: "继续".into(),
            tool_calls: vec![ToolCall {
                id: id.into(),
                name: "echo".into(),
                args: serde_json::json!({}),
            }],
            input_tokens: None,
            output_tokens: None,
            stop_reason: Some("tool_calls".into()),
        };
        // 3 轮工具调用 + 1 轮最终文本 = 正常收敛，远低于默认 100 turns 上限
        let backend = Arc::new(MockBackend::new(vec![
            tool_call("call_1"),
            tool_call("call_2"),
            tool_call("call_3"),
            PromptResponse::text_only("任务完成"),
        ]));
        let tool_bus = Arc::new(SimpleToolBus::new());
        tool_bus.register(Arc::new(EchoTool)).await;

        // 不显式 with_loop_control → 使用默认宽松配置（生产默认路径）
        let agent = AgentLoop::new(backend, tool_bus).with_config(AgentLoopConfig {
            max_iterations: 100, // 不触发超迭代，验证是正常收敛而非被循环控制停止
            ..Default::default()
        });

        let listener = Arc::new(LoopEngEventListener {
            events: std::sync::Mutex::new(Vec::new()),
        });
        agent.subscribe(listener.clone()).await;

        let result = agent.run("正常对话任务".into()).await;
        assert!(
            matches!(result.as_deref(), Ok("任务完成")),
            "正常流应收敛并返回最终文本，实际: {result:?}"
        );

        // 记录的 turns 应远低于默认上限（100），证明宽松配置未误停
        let turns = agent.loop_controller().rate_limiter.turns();
        assert!(
            turns < 10,
            "正常流 turns 应远低于默认上限，实际: {turns}"
        );

        let collected = listener.events.lock().unwrap().clone();
        assert!(
            !collected.iter().any(|e| e.starts_with("rate_limit:")),
            "正常流不应广播速率限制事件，实际: {collected:?}"
        );
    }

    #[tokio::test]
    async fn llm_failure_emits_retry_events() {
        // backend 永远报错 → 触发重试 → 重试耗尽
        struct FailingBackend;

        #[async_trait]
        impl NodeBackendAccessor for FailingBackend {
            async fn prompt(
                &self,
                _prompt: String,
                _options: Option<PromptCallOptions>,
            ) -> Result<PromptResponse, BackendError> {
                Err(BackendError::Other("网络错误".into()))
            }
            async fn steer(&self, _text: String) -> Result<(), BackendError> {
                Ok(())
            }
            async fn get_messages(&self) -> Vec<OrchestratorMessage> {
                Vec::new()
            }
            async fn set_messages(
                &self,
                _messages: Vec<OrchestratorMessage>,
            ) -> Result<(), BackendError> {
                Ok(())
            }
            async fn trim_context(&self, _up_to_index: usize) -> Result<(), BackendError> {
                Ok(())
            }
        }

        let backend = Arc::new(FailingBackend);
        let tool_bus = Arc::new(SimpleToolBus::new());

        let agent = AgentLoop::new(backend, tool_bus).with_config(AgentLoopConfig {
            llm_max_retries: 1,
            llm_retry_base_delay: std::time::Duration::from_millis(1),
            ..Default::default()
        });

        let listener = Arc::new(LoopEngEventListener {
            events: std::sync::Mutex::new(Vec::new()),
        });
        agent.subscribe(listener.clone()).await;

        let result = agent.run("测试重试".into()).await;
        assert!(result.is_err());

        let collected = listener.events.lock().unwrap().clone();
        assert!(
            collected.iter().any(|e| e == "retrying:1"),
            "应广播 LoopEngRetrying，实际: {collected:?}"
        );
        assert!(
            collected.iter().any(|e| e == "retry_exhausted:1"),
            "应广播 LoopEngRetryExhausted，实际: {collected:?}"
        );
        let retry_pos = collected.iter().position(|e| e == "retrying:1").unwrap();
        let exhausted_pos = collected
            .iter()
            .position(|e| e == "retry_exhausted:1")
            .unwrap();
        assert!(
            retry_pos < exhausted_pos,
            "retrying 应先于 retry_exhausted，实际顺序: {collected:?}"
        );
    }

    /// 软超时告警锁存后经 `reset()` 恢复 → 内建 emit `LoopEngRecovered`
    ///
    /// 验证恢复检测基于底层触发标志边沿（`is_alerted` true→false），
    /// 且不会在软超时锁存期（后续 check 返回 None）误发 Recovered。
    #[tokio::test]
    async fn soft_timeout_reset_emits_recovered() {
        let backend = Arc::new(MockBackend::new(vec![PromptResponse {
            text: "完成".into(),
            tool_calls: vec![],
            input_tokens: None,
            output_tokens: None,
            stop_reason: Some("end_turn".into()),
        }]));
        let tool_bus = Arc::new(SimpleToolBus::new());

        // warn_threshold=0 → 首轮 check 即触发软超时 Warning（锁存 warn_triggered）
        let loop_config = LoopControlConfig {
            soft_timeout: crate::loop_control::SoftTimeoutConfig {
                warn_threshold: std::time::Duration::from_millis(0),
                ..Default::default()
            },
            ..Default::default()
        };
        let agent = AgentLoop::new(backend, tool_bus).with_loop_control(Some(loop_config));

        // 触发软超时告警并锁存
        agent.loop_controller().check_all();
        assert!(agent.loop_controller().is_alerted(), "软超时应处于告警锁存态");

        let listener = Arc::new(LoopEngEventListener {
            events: std::sync::Mutex::new(Vec::new()),
        });
        agent.subscribe(listener.clone()).await;

        // 第一帧：告警锁存期（is_alerted=true），不应 emit Recovered
        agent.emit_loop_recovered_if_needed().await;
        assert!(
            listener.events.lock().unwrap().is_empty(),
            "告警锁存期不应 emit Recovered"
        );

        // 模拟命令层 reset_counters / retry 路径：reset 清除软超时触发标志
        agent.loop_controller().soft_timeout.reset();
        assert!(!agent.loop_controller().is_alerted(), "reset 后应解除告警");

        // 第二帧：告警解除（true→false 边沿）→ emit Recovered（auto）
        agent.emit_loop_recovered_if_needed().await;
        let collected = listener.events.lock().unwrap().clone();
        assert!(
            collected.iter().any(|e| e.starts_with("recovered:auto:")),
            "应对告警解除 emit LoopEngRecovered(auto)，实际: {collected:?}"
        );
    }
}
