//! AgentLoop — ReAct 模式的核心循环，详细见 docs/details/注释/agent-runtime/agent.md

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex, RwLock as StdRwLock};
use std::time::Instant;

use tokio::sync::{Mutex as AsyncMutex, RwLock};
use tracing::{debug, error, info, warn};

use crate::backend::NodeBackendAccessor;
use crate::confirmation::ConfirmationPolicy;
use agent_engine::contracts::interaction::InteractionOutcome;
use crate::event::{AgentEvent, EventBroadcaster, EventKey, OrchestratorEvent};
use crate::event_bus::Listener;
use crate::loop_control::{LoopControlConfig, LoopController};
use crate::long_task::{CheckpointProvider, LongTaskManager};
use crate::retention::RetentionPlan;
use crate::router_decider::{Pipeline, RouterDecider};
use crate::tool::ToolBus;
use crate::types::{MessageRole, OrchestratorMessage, PlanItem, ToolCall};

use prompt_sections::PromptSection;

// 仅供 tests.rs（`use super::*` glob 引入）使用的类型，非 test 构建下不参与编译
#[cfg(test)]
use crate::backend::{BackendError, PromptCallOptions};

mod backend_bridge;
mod compaction_summary;
mod config;
mod error;
mod hooks;
pub mod input;
mod interaction;
mod llm;
mod long_task;
mod loop_control;
mod memory;
pub mod prompt_sections;
pub mod request_snapshot;
mod state;
mod tools;

pub use config::AgentLoopConfig;
pub use error::AgentError;
pub use hooks::{AgentLoopHook, AgentLoopHooks, HookContext, RunPhase};
pub use state::{AgentState, AgentStateSnapshot};

use backend_bridge::BackendEventBridge;

/// 单条消息的结构开销估算（role 标记 / tool_call_id / 分隔符等的 token 近似）
///
/// 对齐上游 `MessageContent::estimate_tokens` 的做法：正文之外的协议开销按固定值粗估，
/// 避免只数正文而系统性低估窗口占用。
const MESSAGE_STRUCTURE_OVERHEAD_TOKENS: usize = 8;

/// 上下文计量快照（内部，一次持锁取齐）
///
/// [丁1 加急] `enforce_context_budget`（自动裁剪）与 `context_usage`（面板查询）、
/// `compact_now`（手动压缩）共用同一次计量，保证「查询所见 = 裁剪所依」。
struct ContextMeasurement {
    policy: crate::context_budget::ContextBudgetPolicy,
    plan: RetentionPlan,
    costs: Vec<usize>,
    history_tokens: usize,
    system_tokens: usize,
    message_count: usize,
    /// 消息内容字节总量（前置检查短路基线用；与 `costs` 同一次持锁取齐）
    content_bytes: usize,
    /// 系统侧文本字节总量（同上）
    system_bytes: usize,
}

/// 请求派生前压缩的短路基线（阶段 3 · A2 补齐①）
///
/// 记「上次完整计量」时的四项：消息条数 / 体量字节（消息内容 + 系统侧文本）/
/// 总占用 token / 当时的触发线。每轮请求前先比对该基线做廉价短路——只有
/// 「上次占用 + 新增体量的保守 token 下界」可能越过触发线时才做完整计量。
/// 触发线不一致（模型切换导致窗口变化）时禁用短路，强制重新计量。
#[derive(Debug, Clone, Copy)]
struct CompactCheckMarker {
    message_count: usize,
    total_bytes: usize,
    total_tokens: usize,
    trigger: usize,
}

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
    /// 会话归属的项目 id（从 `config.project_id` 读取）
    ///
    /// 用于构造 [`crate::tool_context::ToolContext`] 并注入到工具执行
    /// （W2①，2026-09-18 工作区与环境对齐 dsh：此前 `tool_ctx` 恒写 `None`，
    /// 项目归属对工具不可见）。与 `config.project_id` 保持一致（同上前两字段）。
    project_id: Arc<StdRwLock<Option<String>>>,
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
    /// HITL 交互协调器（A5；S5 起为三型统一注册表，`None`=不启用确认）
    ///
    /// 通过 `with_confirmation` 注入。启用后，`execute_tool_calls` 对命中
    /// `config.confirmation_policy` 的工具调用发起确认（广播事件 + 等待前端回传）；
    /// 钩子 `ToolHookAction::Review` 经同一注册表发起复核（hookReview 型）。
    confirmation_broker: Option<Arc<crate::interaction_broker::InteractionBroker>>,
    /// S4-b：会话级授权（ZD2-3——仅会话内存活、不落盘；**只服务 alwaysAsk gate**）
    ///
    /// 经 `grant_session_permission` 写入（命令层 API；前端「本会话总是允许」按钮随 UX 批），
    /// `maybe_require_confirmation` 在 alwaysAsk 位次消费（`once` 命中即移除）。
    /// 选用 `StdMutex`（短临界区、不跨 await 持有）。
    session_grants: Arc<StdMutex<crate::permission_machine::SessionPermissionGrants>>,
    /// Q1 提问（2026-09-20）：本循环是否为子代理实例（`true` 时提问类工具不可用）
    ///
    /// 由 [`SubAgentManager`](crate::sub_agent_pool) 构造子代理时经 [`Self::mark_sub_agent`]
    /// 置位；随 [`ToolContext`](crate::tool_context::ToolContext) 注入工具执行
    /// （`is_sub_agent`），供 `ask_user_question` 在子代理内 fail loud（ASK_UNAVAILABLE）
    /// ——子代理无独立会话实例、无人类应答者，提问会永久阻塞。
    is_sub_agent: bool,
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
    /// Token 估算器（A1 丙1：上下文计量口径 = 上下文 token）
    ///
    /// 默认 [`crate::context_budget::heuristic_estimator`]（CJK 1/字、ASCII 1/4 字符），
    /// 装配层应用 [`Self::with_token_estimator`] 注入真实分词器（tiktoken）。
    ///
    /// **为什么是闭包而非 trait**：调用方只需「一个函数」，闭包注入避免为此引入
    /// 整条 crate 依赖边（真实分词器重依赖隔离在 `memory-center-models`）。
    token_estimator: crate::context_budget::TokenEstimator,
    /// 原文外置器（A1 己1①：工具结果截断**前**把完整原文外置成文件）
    ///
    /// 默认 [`crate::raw_context::noop_sink`]（不外置，行为与改造前一致）；
    /// 装配层注入真实实现（写 app_data 真文件 + 登记引用）后，超长工具结果的
    /// 截断标注会附带内容坐标，原文可据此取回。
    raw_context_sink: crate::raw_context::RawContextSink,
    /// 是否注入了真实外置器（A1 §6.2：决定裁剪走「折叠」还是旧「删除」路径）
    ///
    /// 折叠的硬前提 = 原文先安全外置；未注入外置器时折叠不可能执行，
    /// `enforce_context_budget` 保持既有「选择性删除」行为
    /// （测试与未配置记忆的环境）。
    raw_context_enabled: bool,
    /// 请求派生前压缩的轻量短路基线（阶段 3 · A2 补齐①）
    ///
    /// 每轮 LLM 请求派发前都要判断是否触压缩；完整计量成本 O(内容量)，故先比对
    /// 本基线（O(消息数) 的字节求和）——见 [`Self::enforce_context_budget`]。
    compact_check: Arc<StdMutex<Option<CompactCheckMarker>>>,
    /// 请求快照的上一条视图（阶段 3 · ④：增量判据——前缀比对为**逐字段等值**）
    ///
    /// 持有上一视图副本（不持哈希）：假前缀会静默损坏重建结果，宁可多一次内存拷贝。
    /// Agent 重建（项目切换 / 重载）后为空 → 首条快照必为全量视图（自纠正）。
    request_snapshot_tracker: Arc<StdMutex<Option<Vec<OrchestratorMessage>>>>,
    /// 输入 inbox（阶段 2 · A3：三通道统一入口，`run_react_loop` 每轮经准入消费）
    ///
    /// 见 [`input`] 模块：`FollowUp` / `Steer` / `Inject` 三语义 + pre-step 准入。
    inbox: Arc<StdMutex<Vec<input::InputItem>>>,
    /// 已交付文本累积（A3 取消收口：中断时落为终稿 + 中断锚点）
    ///
    /// 由 `DeliveredTextRecorder` 监听本环巴士维护（StreamStart 清零 / Delta 累积 /
    /// StreamEnd 权威覆盖）。
    delivered_text: Arc<StdMutex<String>>,
}

impl AgentLoop {
    /// 创建新的 AgentLoop
    ///
    /// 自动注入 backend 事件桥接 listener，使订阅 AgentLoop 的监听器
    /// 能收到 backend 广播的 `StreamStart`/`StreamDelta`/`StreamEnd` 等事件。
    pub fn new(backend: Arc<dyn NodeBackendAccessor>, tool_bus: Arc<dyn ToolBus>) -> Self {
        // 阶段 3 · ④ 扩展：链路锚点（旁路快照入链 → 本环增量基点失效，见 request_snapshot）
        // 先于其余监听器订阅：旁路行经 BackendEventBridge 到达本环时同步重置基点
        let request_snapshot_tracker = Arc::new(StdMutex::new(None));
        // 阶段 2 · A3：已交付文本记录器（取消收口用；订阅本环巴士，on_any）
        let delivered_text = Arc::new(StdMutex::new(String::new()));
        let broadcaster = {
            let mut b = EventBroadcaster::new();
            b.subscribe_key(
                crate::event::keys::REQUEST_SNAPSHOT_CAPTURED,
                Arc::new(request_snapshot::SnapshotChainAnchor::new(Arc::clone(
                    &request_snapshot_tracker,
                ))),
            );
            b.subscribe(Arc::new(input::DeliveredTextRecorder::new(Arc::clone(
                &delivered_text,
            ))));
            Arc::new(RwLock::new(b))
        };
        let is_streaming = Arc::new(AtomicBool::new(false));
        let state = Arc::new(AsyncMutex::new(AgentState::new()));
        let config = Arc::new(StdRwLock::new(AgentLoopConfig::default()));
        let long_task_manager = Arc::new(LongTaskManager::new());
        let last_user_text = Arc::new(StdRwLock::new(String::new()));
        let last_llm_call_time = Arc::new(std::sync::Mutex::new(None));
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
            project_id: Arc::new(StdRwLock::new(None)),
            broadcaster,
            is_streaming,
            long_task_manager,
            last_user_text,
            last_llm_call_time,
            loop_controller,
            loop_control_warned,
            usage,
            memory: None,
            memory_context: Arc::new(StdRwLock::new(None)),
            confirmation_broker: None,
            session_grants: Arc::new(StdMutex::new(
                crate::permission_machine::SessionPermissionGrants::default(),
            )),
            is_sub_agent: false,
            tool_hooks: Vec::new(),
            router: None,
            pipeline_context: Arc::new(StdRwLock::new(None)),
            hooks: AgentLoopHooks::default(),
            token_estimator: crate::context_budget::heuristic_estimator(),
            raw_context_sink: crate::raw_context::noop_sink(),
            raw_context_enabled: false,
            compact_check: Arc::new(StdMutex::new(None)),
            request_snapshot_tracker,
            inbox: Arc::new(StdMutex::new(Vec::new())),
            delivered_text,
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

    /// 注入 token 估算器（链式，同步，A1 丙1）
    ///
    /// 装配层应注入与当前模型匹配的真实分词器（如 `memory-center-models` 的
    /// tiktoken 实现）；不注入时使用无依赖的近似兜底（中文场景偏差 20–30%，
    /// 会让阈值触发时机漂移）。
    pub fn with_token_estimator(mut self, estimator: crate::context_budget::TokenEstimator) -> Self {
        self.token_estimator = estimator;
        self
    }

    /// 当前生效的 token 估算器（只读）
    pub fn token_estimator(&self) -> &crate::context_budget::TokenEstimator {
        &self.token_estimator
    }

    /// 注入原文外置器（链式，同步，A1 己1①）
    ///
    /// 装配层注入真实实现后，超长工具结果在**截断前**会先被外置成文件，
    /// 截断标注附带内容坐标（`原文已外置：raw/{hash}`），原文可据此取回。
    /// 不注入时行为与改造前完全一致（纯截断）。
    ///
    /// **同时置位 [`Self::raw_context_enabled`]**（A1 §6.2）：上下文预算裁剪
    /// 从「选择性删除」升级为「锚点折叠」——原文先外置（硬前提）→ 锚点占位
    /// → 压缩文本填回。未注入时保持旧的删除路径。
    pub fn with_raw_context_sink(mut self, sink: crate::raw_context::RawContextSink) -> Self {
        self.raw_context_sink = sink;
        self.raw_context_enabled = true;
        self
    }

    /// 当前生效的原文外置器（只读）
    pub fn raw_context_sink(&self) -> &crate::raw_context::RawContextSink {
        &self.raw_context_sink
    }

    /// 是否注入了真实外置器（A1 §6.2：裁剪走「折叠」还是「删除」的判据）
    pub fn raw_context_enabled(&self) -> bool {
        self.raw_context_enabled
    }

    /// 注入 HITL 交互协调器（链式，同步，A5；S5 起承载三型交互请求）
    ///
    /// 传 `Some(broker)` 启用确认能力（配合 `config.confirmation_policy` 生效），
    /// 传 `None` 禁用。默认（`new` 创建）不启用。
    pub fn with_confirmation(
        mut self,
        broker: Option<Arc<crate::interaction_broker::InteractionBroker>>,
    ) -> Self {
        self.confirmation_broker = broker;
        self
    }

    /// 标记为子代理实例（Q1，链式，同步）
    ///
    /// 置位后 [`Self::tool_ctx`] 注入的 `is_sub_agent = true`，使「仅主会话可用」的工具
    /// （如 `ask_user_question`）在子代理内显式拒绝（`ASK_UNAVAILABLE`）——子代理无人类
    /// 应答者，若放行会永久阻塞（对齐 dsh `DELEGATED_CALLER`）。由 `sub_agent_pool`
    /// 构造子代理时调用；主会话不调用（默认 `false`）。
    pub fn mark_sub_agent(mut self) -> Self {
        self.is_sub_agent = true;
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

    /// 设置 / 重载会话的项目规则（S4-c；`None` = 未声明/清除）
    ///
    /// 写入 config（`maybe_require_confirmation` 每次读取），编辑规则文件后调用即生效。
    pub fn set_project_rules(
        &self,
        rules: Option<Arc<crate::permission_machine::ProjectPermissionRules>>,
    ) {
        if let Ok(mut guard) = self.config.write() {
            guard.project_rules = rules;
        }
    }

    /// 解析一次待决交互（S5 统一入口；前端经回传命令唤起）
    ///
    /// `outcome` 判别即 kind：permission 四值 / user_input 四态 / hook_review 四态；
    /// **kind 与请求不符即拒**（不唤醒、不移除——等待方仍可被正确结果唤醒）。
    /// 返回是否成功唤醒等待方（id 不存在 = 已超时 / 已取消 / 已处理）；
    /// 未启用 broker 时恒返回 `false`。
    pub async fn resolve_interaction(
        &self,
        interaction_id: &str,
        outcome: InteractionOutcome,
    ) -> bool {
        let Some(broker) = &self.confirmation_broker else {
            return false;
        };
        let resolved = broker.resolve(interaction_id, outcome.clone()).await;
        if resolved {
            // 广播终态，供前端清理进行中的面板（S5-a 过渡映射见 interaction_broker）
            self.broadcast(crate::interaction_broker::resolved_event(interaction_id, &outcome))
                .await;
        }
        resolved
    }

    /// 解析一次待定的工具确认（前端经统一回传口 `cmd_agent_interaction_respond` 唤起；委托统一入口）
    ///
    /// `outcome` 为 D8 四值（approved / denied / skipped / timeout；
    /// 前端只回传前三值，`timeout` 由 [`crate::interaction_broker::InteractionBroker`] 超时产生）。
    /// 返回是否成功唤醒对应等待方（confirm_id 不存在 = 已超时/已处理）。
    pub async fn resolve_confirmation(
        &self,
        confirm_id: &str,
        outcome: crate::confirmation::ConfirmationOutcome,
    ) -> bool {
        self.resolve_interaction(confirm_id, InteractionOutcome::Permission(outcome))
            .await
    }

    /// 解析一次待回答的提问（Q1；前端经统一回传口 `cmd_agent_interaction_respond` 唤起）
    ///
    /// `outcome`：`Answered(answers)` = 用户作答 / `Denied` = 用户拒绝作答（前端取消键）；
    /// `Cancelled` 仅 kernel 侧产生（[`Self::abort`] / [`Self::dispose`] 随轮取消）。
    /// 返回是否成功唤醒对应等待方（ask_id 不存在 = 已处理/已取消）。
    pub async fn resolve_ask(
        &self,
        ask_id: &str,
        outcome: crate::confirmation::AskOutcome,
    ) -> bool {
        self.resolve_interaction(ask_id, InteractionOutcome::UserInput(outcome))
            .await
    }

    /// 随轮取消：中断全部待决交互并通知前端清理（S5 统一——permission 亦被取消）
    ///
    /// 在 [`Self::abort`]（用户中断运行）与 [`Self::dispose`]（会话销毁）时调用：
    /// 若不取消，等待中的交互将阻塞（提问工具永久阻塞；确认须等满 60s 超时），abort 无法生效。
    /// 各型以内核侧终值唤醒（permission → Timeout / user_input → Cancelled /
    /// hook_review → Cancelled），并广播终态供前端清理面板。
    async fn cancel_pending_interactions(&self) {
        let Some(broker) = &self.confirmation_broker else {
            return;
        };
        for (id, kind) in broker.cancel_all().await {
            let outcome = crate::interaction_broker::cancel_terminal_outcome(kind);
            self.broadcast(crate::interaction_broker::resolved_event(&id, &outcome))
                .await;
        }
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
        // 同步 project_id 独立字段（W2①，供 ToolContext 注入）
        if let Ok(mut guard) = self.project_id.write() {
            *guard = config.project_id.clone();
        } else {
            warn!("with_config: project_id RwLock poisoned");
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
        // 同步 project_id 独立字段（W2①，供 ToolContext 注入）
        if let Ok(mut guard) = self.project_id.write() {
            *guard = config.project_id.clone();
        }
        if let Ok(mut guard) = self.config.write() {
            *guard = config;
        }
    }

    /// 运行时更新会话提示段（H5 风险点③ 动态刷新 + A4 双端收口，2026-09-17）：
    /// 技能索引/规则文件/提示段中途变更时由命令层调用，下一轮 build_prompt_options
    /// 即从 `config.prompt_sections` 展开各段——旧会话立即生效。
    ///
    /// 同步刷新 `config.system_prompt` 缓存（= 段组装的静态合集文本，供首条
    /// System 消息推入等 legacy 消费）。
    pub async fn set_prompt_sections(&self, prompt_sections: Vec<PromptSection>) {
        let static_text = prompt_sections::assemble_sections(prompt_sections.clone());
        match self.config.write() {
            Ok(mut guard) => {
                guard.prompt_sections = prompt_sections;
                guard.system_prompt = static_text;
            }
            Err(_) => warn!("set_prompt_sections: config RwLock poisoned, 未更新"),
        }
    }

    /// 读取配置快照
    fn config_snapshot(&self) -> AgentLoopConfig {
        self.config
            .read()
            .map(|g| g.clone())
            .unwrap_or_else(|_| AgentLoopConfig::default())
    }

    /// 订阅事件（全量）
    pub async fn subscribe(&self, listener: Arc<dyn Listener>) {
        self.broadcaster.write().await.subscribe(listener);
    }

    /// 精确订阅（仅接收 `key` 的分发；供 Plan 事件族等精确监听器使用）
    pub async fn subscribe_key(&self, key: EventKey, listener: Arc<dyn Listener>) -> bool {
        self.broadcaster.write().await.subscribe_key(key, listener)
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

    /// 获取会话绑定的工作区根目录（构造 ToolContext 注入工具执行，FS 边界用）
    pub fn workdir(&self) -> Option<std::path::PathBuf> {
        self.workdir.read().ok().and_then(|g| g.clone())
    }

    /// 获取会话绑定的 Workspace 实体 id（构造 ToolContext 注入工具执行，Phase A）
    pub fn workspace_id(&self) -> Option<String> {
        self.workspace_id.read().ok().and_then(|g| g.clone())
    }

    /// 获取会话归属的项目 id（构造 ToolContext 注入工具执行；W2①，2026-09-18）
    pub fn project_id(&self) -> Option<String> {
        self.project_id.read().ok().and_then(|g| g.clone())
    }

    /// 当前档位派生的沙箱戳记（构造 ToolContext 注入工具执行；E3-1，2026-09-18）
    ///
    /// 观测期语义：仅随 ctx 传播（日志 + 审计元信息），不改变执行行为；
    /// 强制执行（受限令牌 + ACL）落 E3-2/E3-3——见 [crate::sandbox]。
    pub fn sandbox_spec(&self) -> Option<crate::sandbox::SandboxSpec> {
        let workdir = self.workdir.read().ok().and_then(|g| g.clone());
        // 未配置确认策略 → 按默认档位口径（SecurityLevel::default = interact）
        let level = self
            .config_snapshot()
            .confirmation_policy
            .as_ref()
            .map(|p| p.security_level)
            .unwrap_or_default();
        crate::sandbox::sandbox_policy(level, workdir.as_deref())
    }

    /// 获取内部 ToolBus 访问器（供 Supervisor 编排节点为子 Agent 提供共享工具）
    ///
    /// SupervisorNode 构造需要 `Arc<dyn ToolBus>` 来运行被委派的子 Agent，
    /// 从会话 AgentLoop 取出即可与主 Agent 共享同一批工具（terminal/subagent 等）。
    pub fn tool_bus(&self) -> Arc<dyn ToolBus> {
        Arc::clone(&self.tool_bus)
    }

    /// 广播事件
    ///
    /// **锁纪律（2026-09-17 风险点处置）**：先取总线句柄、**释放壳锁**，再运行监听器链——
    /// 链内可安全注册（延后下一轮）/执行 I/O，不阻滞写者，也不会令 `try_read` 型
    /// 转发监听器（`ForwardToAgentBroadcaster` 等）在写者排队时静默丢事件。
    async fn broadcast(&self, event: OrchestratorEvent) {
        self.event_bus_handle().await.emit(&event);
    }

    /// 取出事件总线句柄（短读壳锁；**分发应在取到句柄后于锁外进行**）
    async fn event_bus_handle(&self) -> Arc<crate::event_bus::EventBus> {
        self.broadcaster.read().await.handle()
    }

    /// 中断当前运行
    pub async fn abort(&self) {
        {
            let mut state = self.state.lock().await;
            state.aborted = true;
        }
        // Q1（2026-09-20）：随轮取消待回答提问（先释放 state 锁，广播在锁外进行）——
        // 否则等待中的提问工具永久阻塞，abort 无法生效
        self.cancel_pending_interactions().await;
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

    /// R6 第二部分：把值按追加语义 merge 进「最后一条 assistant 消息」的 meta[key]
    /// （无 assistant 消息则忽略；meta 槽不存在则新建数组）——动作段事件持久化零迁移载体。
    pub async fn merge_last_assistant_meta(&self, key: &str, values: Vec<serde_json::Value>) {
        if values.is_empty() {
            return;
        }
        let mut state = self.state.lock().await;
        if let Some(m) = state
            .messages
            .iter_mut()
            .rev()
            .find(|m| m.role == crate::types::MessageRole::Assistant)
        {
            let meta = m.meta.get_or_insert_with(std::collections::HashMap::new);
            let entry = meta
                .entry(key.to_string())
                .or_insert_with(|| serde_json::Value::Array(Vec::new()));
            if let Some(arr) = entry.as_array_mut() {
                arr.extend(values);
            }
        }
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

        // ── 阶段 2 · A3：运行起始的输入准入（空闲期注入排在本条 user 消息之前）──
        // 与循环内的 pre-step 准入同一实现：保证「提交顺序 = 上下文顺序」
        // （run 起始消费 = 首轮 pre-step 的等价前置；循环内再消费运行中到达的输入）。
        self.consume_admitted_inputs(0).await;

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
            // 新用户消息 = 新任务周期：重置总步骤预算计数与预算通知标志
            state.total_steps_used = 0;
            state.budget_warn_80_notified = false;
            state.budget_warn_95_notified = false;
            state.budget_final_notified = false;
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
                // A5 用户提示路由：可行动错误码附引导语（前端错误分支直接可读）
                // A5 后续：结构化字段（code / retryable / retry_after_ms）随事件下传，
                // 前端可按码分支，不必解析 message 文本
                let mut message = e.to_string();
                let (code, retryable, retry_after_ms) = match e {
                    AgentError::Backend(be) => {
                        if let Some(hint) = be.code().user_hint() {
                            message = format!("{message}（{hint}）");
                        }
                        (
                            Some(be.code().as_str().to_string()),
                            Some(be.code().is_retryable()),
                            be.retry_after_ms(),
                        )
                    }
                    _ => (None, None, None),
                };
                self.broadcast(OrchestratorEvent::Agent(AgentEvent::Error {
                    message,
                    code,
                    retryable,
                    retry_after_ms,
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
    ///
    /// **档位化（A1 丁1）**：召回条数（`top_k`）与注入预算（`max_tokens`）取自
    /// [`AgentLoopConfig::memory_tier`]（装配层按场景 `ScenarioMemoryPolicy::params()`
    /// 注入）；未配置时为 Standard 档 = 既有默认（5 条 / 2000 token），零行为变化。
    async fn run_recall_memory(&self, user_input: &str) {
        let tier = self
            .config
            .read()
            .map(|g| g.memory_tier.unwrap_or_default())
            .unwrap_or_default();
        if let Some(memory) = &self.memory {
            let recall_opts = crate::memory::MemoryRecallOptions {
                top_k: tier.recall_top_k,
                ..Default::default()
            };
            if let Ok(recall_results) = memory
                .recall(user_input.to_string(), Some(recall_opts))
                .await
            {
                if !recall_results.is_empty() {
                    let inject_opts = crate::memory::MemoryInjectOptions {
                        max_tokens: tier.inject_max_tokens,
                        ..Default::default()
                    };
                    if let Ok(injected) = memory.inject(recall_results, Some(inject_opts)).await {
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

    /// [RunPhase::AfterRun 内置] 记忆归档 — record_turn + archive
    ///
    /// 记录本轮对话（供归档前累积）并触发归档；任一环节失败静默跳过，不影响主流程返回。
    ///
    /// **上下文预算压缩已前移**（阶段 3 · A2 补齐①，2026-09-17）：从本阶段挪到
    /// [`Self::run_react_loop`] 每轮 LLM 请求派发之前（见 `enforce_context_budget`）——
    /// 修正前压缩发生在轮次结束后，收益滞后一整轮（本轮请求都已用旧窗口发完）。
    async fn run_memory_archive(&self, user_input: &str, result: &Result<String, AgentError>) {
        if let Some(memory) = &self.memory {
            let assistant_text = match result {
                Ok(text) => text.clone(),
                Err(_) => String::new(),
            };
            let _ = memory.record_turn(user_input.to_string(), assistant_text).await;
            let _ = memory.archive(None).await;
        }
    }

    /// 上下文预算自动裁剪 — 消息历史只进不出的解药
    ///
    /// 此前消息历史只进不出：归档是"增值"而非"腾挪"（archive 的边界被忽略），
    /// 全链路无 token 计量，长会话终将顶爆 LLM 上下文窗口。
    ///
    /// ## 计量口径（A1 丙1，2026-09-11 归一）
    ///
    /// **单位 = 上下文 token**（LLM 上下文窗口占用），**数值由模型窗口推导**。
    /// 修正前的实现按**字节**累加（`content.len()`）并与硬编码 `160_000` 比较——
    /// 那是实现与语义不一致：同为 160_000，全中文内容约合 5.3 万 token、
    /// 全 ASCII 约合 4 万 token，两个方向都有明显偏差。
    ///
    /// **预算口径已补全**（修正前漏算）：除 `state.messages` 外，一并计入
    /// 每轮重拼的 `system_prompt`（系统提示词 + 记忆注入 + 规则 + 管线指引）——
    /// 此前只累加 messages，导致真实窗口占用被系统性低估。
    ///
    /// ## 保留契约（A1 己2①，2026-09-11 接入）
    ///
    /// 触发点 = **四层压缩阶梯的最高层（AutoCompact，归档阈值的 95%）**，是「最后手段」。
    /// 「丢哪些」由 [`RetentionPlan`] 按类型化契约决定，而非此前的「从头部逐条丢」：
    ///
    /// | 等级 | 对象 | 处理 |
    /// |---|---|---|
    /// | `SystemAnchor` | `role = System`（承载系统提示词） | **永不裁剪**——同时修掉「被裁后下一轮重推、落到末尾」的位置漂移 |
    /// | `LatestUserInput` | 最近一条 user 原始输入 | **永不裁剪**——修掉「单轮 ≥6 次工具调用即被挤出保留窗口」的数据丢失 |
    /// | `Pinned(tag)` | 显式打标（A3 白名单：意图/决策/待办/记忆引用） | **永不裁剪** |
    /// | `RecentTurn` | 最近 `keep_recent` 条 | 第二道防线 |
    /// | `Droppable` | 陈旧内容 | 可裁（**工具交换组原子丢弃**，杜绝悬空 `tool_call_id`） |
    ///
    /// 删除手段同步升级为**选择性删除**（[`Self::trim_context_dropping`]）——
    /// 前缀裁剪无法表达「保住更旧的受保护消息、只删中段陈旧内容」。
    ///
    /// ## 语义安全
    ///
    /// 被裁轮次必然已归档进记忆——归档阈值与预算触发点同源（同为窗口比例，
    /// 且触发点在归档阈值之内），预算触发时未归档缓冲只剩最近几轮，保留条数足够覆盖。
    ///
    /// **执行体归一（阶段 3 · 2026-09-17）**：与手动 `/compact` 共用 [`Self::run_compaction`]，
    /// 本方法只保留「触发线判断 + 日志」；压缩过程以 Started/Finished/Failed 三事件
    /// 构成事务括号（A2 补齐②③，见 [`Self::run_compaction`]）。
    async fn enforce_context_budget(&self) {
        // ── 轻量短路（阶段 3 · A2 补齐①：请求派生前检查的成本控制）──
        // 每轮请求派发前都会调用本方法，先做 O(消息数) 的字节比对：若「上次占用 +
        // 新增体量的保守 token 下界（字节 / 4 + 每条结构开销）」仍低于触发线，跳过完整计量。
        // 下界取字节/4：UTF-8 内容（含 CJK 三字节/字）的 token 数都不低于该值 → 跳过不会漏触发。
        let gate_trigger = match self.config.read() {
            Ok(g) => g.context_budget.unwrap_or_default().trim_trigger(),
            Err(_) => {
                warn!("上下文前置检查：config RwLock 中毒，本轮跳过");
                return;
            }
        };
        let (message_count, total_bytes) = self.cheap_context_snapshot().await;
        let short_circuit = match self.compact_check.lock() {
            Ok(guard) => guard.as_ref().is_some_and(|marker| {
                if marker.trigger != gate_trigger {
                    // 模型切换（窗口/触发线变化）→ 基线失效，强制重新计量
                    return false;
                }
                let added_bytes = total_bytes.saturating_sub(marker.total_bytes);
                let added_msgs = message_count.saturating_sub(marker.message_count);
                let lower_bound = marker.total_tokens
                    + added_bytes / 4
                    + added_msgs * MESSAGE_STRUCTURE_OVERHEAD_TOKENS;
                lower_bound < gate_trigger
            }),
            // 基线锁中毒 → 保守走完整计量
            Err(_) => false,
        };
        if short_circuit {
            return;
        }

        // ── 完整计量（与 context_usage / compact_now 同源，见 measure_context）──
        let m = self.measure_context().await;
        let policy = m.policy;
        let history_tokens = m.history_tokens;
        let system_tokens = m.system_tokens;
        let total_tokens = history_tokens + system_tokens;
        let total_msgs = m.message_count;
        let trigger = policy.trim_trigger();

        let (n_system, n_user, n_pinned) = m.plan.protected_counts();
        debug!(
            "上下文占用：历史 {} token + 系统侧 {} token = {} token（触发点 {}，窗口 {}，归档阈值 {}，当前层级 {}）；受保护：System {} / 最新user {} / 打标 {}",
            history_tokens,
            system_tokens,
            total_tokens,
            trigger,
            policy.context_window,
            policy.archive_threshold,
            policy.tier_of(total_tokens),
            n_system,
            n_user,
            n_pinned
        );

        if total_tokens <= trigger || total_msgs == 0 {
            // 本次计量即下次短路基线
            self.record_compact_check(&m, total_tokens, trigger);
            return;
        }

        // 基线先行记录（压缩失败时视图不变 → 该基线仍准确）；成功后以压缩后占用刷新
        self.record_compact_check(&m, total_tokens, trigger);
        match self.run_compaction(m, trigger, "auto").await {
            Ok(outcome) => {
                let (message_count, total_bytes) = self.cheap_context_snapshot().await;
                self.set_compact_check(message_count, total_bytes, outcome.after_tokens, trigger);
            }
            // 失败仅告警不阻断主流程
            Err(e) => warn!("上下文预算裁剪失败: {e}"),
        }
    }

    /// 廉价体量快照（消息条数 / 总体量字节）——O(消息数)，不逐条估算 token
    ///
    /// 总体量 = 消息内容字节 + 系统侧文本字节（系统提示词 / 记忆注入 / 管线指引）。
    /// 供请求派生前压缩的轻量短路使用（见 [`Self::enforce_context_budget`]）。
    async fn cheap_context_snapshot(&self) -> (usize, usize) {
        let (message_count, content_bytes) = {
            let state = self.state.lock().await;
            let bytes: usize = state.messages.iter().map(|m| m.content.len()).sum();
            (state.messages.len(), bytes)
        };
        let system_bytes = {
            let cfg = self
                .config
                .read()
                .map(|g| g.system_prompt.as_ref().map(|s| s.len()).unwrap_or(0))
                .unwrap_or(0);
            let mem = self
                .memory_context
                .read()
                .map(|g| g.as_ref().map(|s| s.len()).unwrap_or(0))
                .unwrap_or(0);
            let pipe = self
                .pipeline_context
                .read()
                .map(|g| g.as_ref().map(|s| s.len()).unwrap_or(0))
                .unwrap_or(0);
            cfg + mem + pipe
        };
        (message_count, content_bytes + system_bytes)
    }

    /// 以一次完整计量刷新短路基线（见 [`Self::enforce_context_budget`]）
    fn record_compact_check(&self, m: &ContextMeasurement, total_tokens: usize, trigger: usize) {
        self.set_compact_check(
            m.message_count,
            m.content_bytes + m.system_bytes,
            total_tokens,
            trigger,
        );
    }

    /// 写入短路基线（锁中毒时静默——下次仍会走完整计量）
    fn set_compact_check(
        &self,
        message_count: usize,
        total_bytes: usize,
        total_tokens: usize,
        trigger: usize,
    ) {
        if let Ok(mut guard) = self.compact_check.lock() {
            *guard = Some(CompactCheckMarker {
                message_count,
                total_bytes,
                total_tokens,
                trigger,
            });
        }
    }

    /// 执行一次上下文压缩 —— 自动预算裁剪 / 手动 `/compact` 的**唯一实现**
    ///
    /// ## 归一（阶段 3 · A2 补齐，2026-09-17）
    ///
    /// 修正前自动（[`Self::enforce_context_budget`]）与手动（[`Self::compact_now`]）
    /// 各持一份几乎相同的「选组 → 折叠/删除 → 回填」逻辑——事件化与事务化若在两条
    /// 路径分别加即成双份（双轨防护）。本方法收口为一份实现，触发条件仍由调用方决定：
    /// - 自动：占用超 [`ContextBudgetPolicy::trim_trigger`]（最高压缩层 = 最后手段）
    /// - 手动：`trigger = 0`（全选可裁组语义）
    ///
    /// ## 事务括号（阶段 3 · A2 补齐②③）
    ///
    /// 以三事件构成括号：`Started` 在**任何副作用之前**（外置写盘 / 视图改写）广播；
    /// `Finished` 在视图改写 + 回填结束且重新计量之后广播；折叠 / 删除失败时先广播
    /// `Failed` 再上抛。压缩事务锁监听器（命令层）依据两个右端事件解锁——崩溃时
    /// 右端缺失即成「孤儿锁」，会话下一次装载时检测（见 05-§2.3 缺口 2/3）。
    ///
    /// 无可裁内容（`drops` 为空）时不构成事务：直接返回 `mode = "none"`，无括号事件。
    async fn run_compaction(
        &self,
        m: ContextMeasurement,
        trigger: usize,
        trigger_src: &str,
    ) -> Result<crate::context_budget::CompactOutcome, AgentError> {
        use crate::context_budget::CompactOutcome;

        let before_tokens = m.history_tokens + m.system_tokens;
        let mut outcome = CompactOutcome {
            before_tokens,
            ..Default::default()
        };

        // trigger=0：全选可裁组（受保护组由 select_drops 自然跳过并计数）
        let drops = m.plan.select_drops(&m.costs, before_tokens, trigger);
        outcome.skipped_protected_groups = drops.skipped_protected_groups;
        if drops.is_empty() {
            debug!(
                "上下文压缩（{trigger_src}）：触发线 {trigger} 但可裁内容已穷尽（受保护组 {} 个），本轮不压缩",
                drops.skipped_protected_groups
            );
            outcome.after_tokens = before_tokens;
            outcome.mode = "none".into();
            return Ok(outcome);
        }

        // ── 括号左端：任何副作用（外置写盘 / 视图改写）之前 ──
        self.broadcast(OrchestratorEvent::ContextCompactStarted {
            trigger: trigger_src.to_string(),
            before_tokens,
            tier: m.policy.tier_of(before_tokens),
        })
        .await;

        let mut backfilled = 0usize;
        // ── A1 §6.2 锚点回填：有外置器 → 「折叠」替代「删除」────────────────
        // 折叠 = 删除的安全升级：把「直接扔掉」改为「原文先外置（硬前提）→
        // 锚点对 + 空容器位占位 → 压缩文本填回」。上下文里保留锚点痕迹与
        // 浓缩版本，原文始终可按坐标取回；外置被拒的组保留原样（宁超线勿丢）。
        //
        // 未注入外置器（测试 / 未配置记忆环境）→ 保持既有「选择性删除」行为。
        if self.raw_context_enabled {
            let groups = m.plan.selected_groups(&drops);
            let folded = match self.fold_context(&groups).await {
                Ok(folded) => folded,
                Err(e) => {
                    // 括号右端—异常：折叠可能已产生外置副作用，右端必须广播（锁据此释放）
                    self.broadcast(OrchestratorEvent::ContextCompactFailed {
                        trigger: trigger_src.to_string(),
                        stage: "fold".into(),
                        error: e.to_string(),
                    })
                    .await;
                    return Err(e);
                }
            };
            let mut skip_note = String::new();
            let mut summarized_groups = 0usize;
            if folded.folded_groups > 0 {
                // 阶段 3 · D4：LLM 摘要生成（失败 / 超预算逐组回退规则浓缩）
                let (fills, summarized) = self.fold_fills_with_summaries(&folded).await;
                summarized_groups = summarized;
                match self.backfill_folds(&fills).await {
                    Ok(n) => backfilled = n,
                    Err(e) => {
                        warn!("锚点回填失败（折叠形停留空容器位，坐标仍在、可回源）: {e}");
                    }
                }
                if folded.skipped_denied > 0 || folded.skipped_embedded > 0 {
                    skip_note = format!(
                        "；跳过 {} 组（外置拒绝 {} / 已折叠 {}，保留原样）",
                        folded.skipped_denied + folded.skipped_embedded,
                        folded.skipped_denied,
                        folded.skipped_embedded
                    );
                }
            } else {
                // 候选组全部未折叠（外置拒绝 / 已是折叠形）——保留原样（宁超线勿丢）
                debug!(
                    "上下文压缩（{trigger_src}）：候选 {} 组均未折叠（外置拒绝 {} / 已折叠 {}），本轮不压缩",
                    groups.len(),
                    folded.skipped_denied,
                    folded.skipped_embedded
                );
            }
            outcome.folded_groups = folded.folded_groups;
            outcome.folded_messages = folded.folded_messages;
            outcome.mode = if folded.folded_groups > 0 { "folded" } else { "none" }.into();
            if folded.folded_groups > 0 {
                info!(
                    "上下文压缩（{trigger_src}）：占用 {} token（历史 {} + 系统侧 {}）超触发线 {}（窗口 {}），已折叠 {} 组（{} 条 → {} 个锚点，回填 {}，LLM 摘要 {} 组）{skip_note}",
                    before_tokens,
                    m.history_tokens,
                    m.system_tokens,
                    trigger,
                    m.policy.context_window,
                    folded.folded_groups,
                    folded.folded_messages,
                    folded.folded_groups,
                    backfilled,
                    summarized_groups
                );
            }
        } else {
            // 未注入外置器：既有「选择性删除」路径（A1 己2①）
            let mask = drops.mask(m.message_count);
            let dropped = match self.trim_context_dropping(&mask).await {
                Ok(dropped) => dropped,
                Err(e) => {
                    self.broadcast(OrchestratorEvent::ContextCompactFailed {
                        trigger: trigger_src.to_string(),
                        stage: "trim".into(),
                        error: e.to_string(),
                    })
                    .await;
                    return Err(e);
                }
            };
            outcome.dropped_messages = dropped;
            outcome.mode = if dropped > 0 { "dropped" } else { "none" }.into();
        }

        // 压缩后重新计量（回填的压缩文本会改变最终占用，须以实测为准）
        let after = self.measure_context().await;
        outcome.after_tokens = after.history_tokens + after.system_tokens;
        outcome.saved_tokens = outcome.before_tokens.saturating_sub(outcome.after_tokens);

        // 括号右端：视图改写 + 回填结束（锁监听器据此解锁）
        self.broadcast(OrchestratorEvent::ContextCompactFinished {
            trigger: trigger_src.to_string(),
            mode: outcome.mode.clone(),
            before_tokens: outcome.before_tokens,
            after_tokens: outcome.after_tokens,
            saved_tokens: outcome.saved_tokens,
            folded_groups: outcome.folded_groups,
            folded_messages: outcome.folded_messages,
            dropped_messages: outcome.dropped_messages,
            skipped_protected_groups: outcome.skipped_protected_groups,
            backfilled,
        })
        .await;

        info!(
            "上下文压缩（{}）：占用 {} → {} token（释放 {}；模式 {}；折叠 {} 组/{} 条，删除 {} 条；受保护跳过 {} 组）",
            trigger_src,
            outcome.before_tokens,
            outcome.after_tokens,
            outcome.saved_tokens,
            outcome.mode,
            outcome.folded_groups,
            outcome.folded_messages,
            outcome.dropped_messages,
            outcome.skipped_protected_groups
        );
        Ok(outcome)
    }

    /// 计量上下文占用（历史 + 系统侧）并产出保留计划 —— 一次持锁取齐
    ///
    /// [丁1 加急] 供三处共用：
    /// - [`Self::enforce_context_budget`]（自动裁剪）
    /// - [`Self::context_usage`]（面板查询）
    /// - [`Self::compact_now`]（手动压缩）
    ///
    /// 「查询所见 = 裁剪所依」由共用本方法保证——三处若各自计量，
    /// 数值漂移会让用户按面板做的决策失去依据。
    async fn measure_context(&self) -> ContextMeasurement {
        let (policy, retention_policy) = match self.config.read() {
            Ok(g) => (
                g.context_budget.unwrap_or_default(),
                g.retention_policy.unwrap_or_default(),
            ),
            Err(_) => {
                warn!("上下文计量：config RwLock 中毒，回退兜底策略");
                (
                    crate::context_budget::ContextBudgetPolicy::default(),
                    crate::retention::RetentionPolicy::default(),
                )
            }
        };

        // 每轮重拼的系统侧文本（系统提示词 + 记忆注入 + 管线指引）——一并计入窗口占用
        // （修正前只累加 messages，真实窗口占用被系统性低估）
        let (system_tokens, system_bytes) = {
            let cfg = self.config.read().map(|g| g.system_prompt.clone()).unwrap_or(None);
            let mem = self.memory_context.read().map(|g| g.clone()).unwrap_or(None);
            let pipe = self.pipeline_context.read().map(|g| g.clone()).unwrap_or(None);
            let bytes = cfg.as_ref().map(|s| s.len()).unwrap_or(0)
                + mem.as_ref().map(|s| s.len()).unwrap_or(0)
                + pipe.as_ref().map(|s| s.len()).unwrap_or(0);
            (
                (self.token_estimator)(&cfg.unwrap_or_default())
                    + (self.token_estimator)(&mem.unwrap_or_default())
                    + (self.token_estimator)(&pipe.unwrap_or_default()),
                bytes,
            )
        };

        // 逐条成本 + 保留契约分类（同一次持锁内取齐，避免两次快照不一致）
        let (plan, costs, history_tokens, message_count, content_bytes) = {
            let state = self.state.lock().await;
            let costs: Vec<usize> = state
                .messages
                .iter()
                .map(|m| (self.token_estimator)(&m.content) + MESSAGE_STRUCTURE_OVERHEAD_TOKENS)
                .collect();
            let history: usize = costs.iter().sum();
            let bytes: usize = state.messages.iter().map(|m| m.content.len()).sum();
            let plan = RetentionPlan::classify(&state.messages, &retention_policy);
            (plan, costs, history, state.messages.len(), bytes)
        };

        ContextMeasurement {
            policy,
            plan,
            costs,
            history_tokens,
            system_tokens,
            message_count,
            content_bytes,
            system_bytes,
        }
    }

    /// 上下文窗口占用快照（丁1 加急：前端「上下文」面板）
    ///
    /// 纯查询、无副作用；计量口径与自动裁剪、手动压缩完全同源。
    pub async fn context_usage(&self) -> crate::context_budget::ContextUsage {
        let m = self.measure_context().await;
        let total_tokens = m.history_tokens + m.system_tokens;
        crate::context_budget::ContextUsage {
            total_tokens,
            history_tokens: m.history_tokens,
            system_tokens: m.system_tokens,
            message_count: m.message_count,
            context_window: m.policy.context_window,
            archive_threshold: m.policy.archive_threshold,
            trim_trigger: m.policy.trim_trigger(),
            tier: m.policy.tier_of(total_tokens),
        }
    }

    /// 手动压缩「一次到底」——忽略触发点，把可裁内容尽量折叠/删除
    ///
    /// 与 [`Self::enforce_context_budget`] 的差别只在**触发条件**：
    /// 自动路径等占用达最高压缩层（归档阈值 95%）才动；本方法由用户发起、
    /// 立即执行（`select_drops` 传入 trigger=0 = 全选可裁组语义）。
    /// 执行体与自动路径共用 [`Self::run_compaction`]（阶段 3 归一，含事务括号事件）。
    ///
    /// - 受保护内容（System / 最新 user / 打标 / 最近 `keep_recent` 条）**永不触碰**
    /// - 注入外置器 → 折叠（原文先外置 → 锚点 + 压缩文本；外置被拒的组保留原样）
    /// - 未注入外置器 → 选择性删除（测试 / 未配置记忆环境的路径）
    /// - 流式进行中拒绝——循环正在写 state，压缩会与主流程竞态
    pub async fn compact_now(&self) -> Result<crate::context_budget::CompactOutcome, AgentError> {
        if self.is_streaming() {
            return Err(AgentError::Other("流式进行中，暂不可压缩上下文".into()));
        }
        let m = self.measure_context().await;
        self.run_compaction(m, 0, "manual").await
    }

    /// A5 · 溢出压缩（provider 判定 `CONTEXT_WINDOW_EXCEEDED` 后的重发前置）
    ///
    /// 与 [`Self::compact_now`] 的差别：
    /// - **不设 `is_streaming` 守卫**——调用点就在主循环内部（请求失败后的重发前），
    ///   state 由本任务独占（守卫的防护对象是外部并发压缩）；
    /// - 压缩后把新视图**重同步给 backend**（主链路请求内容取自 backend 内部视图，
    ///   不重同步则重发仍是压缩前的历史）。
    ///
    /// 触发语义：provider 的溢出判定是上下文计量的**地面真值**（启发式估算漏判时
    /// 的最后一道防线）；`trigger=0` = 全选可裁组（同手动压缩语义）。
    pub(super) async fn compact_for_overflow(
        &self,
    ) -> Result<crate::context_budget::CompactOutcome, AgentError> {
        let m = self.measure_context().await;
        let outcome = self.run_compaction(m, 0, "overflow").await?;
        let view = self.state.lock().await.messages.clone();
        self.backend
            .set_messages(view)
            .await
            .map_err(AgentError::from)?;
        Ok(outcome)
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
                    // A3 取消收口：已交付文本终结 + 中断锚点（先于 Error/AgentEnd 广播）
                    let iteration = state.current_iteration;
                    drop(state);
                    self.finalize_interrupted_turn("user_abort", iteration).await;
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
                    // A3 取消收口：已交付文本终结 + 中断锚点（原「广播 StreamEnd」注释即此意；
                    // 现在由 finalize_interrupted_turn 统一落终稿 + 广播，不再只留注释）
                    // 注意：此处不持久化 cancelled_record，调用方（Tauri 命令层）负责
                    // 通过心跳定时器的 CheckpointFlush tick 或显式 save 落库
                    debug!(
                        "ReAct 循环：任务 {} 已取消（轮次: {}）",
                        record.task_id, record.turn_count
                    );
                }
                let iteration = self.state.lock().await.current_iteration;
                self.finalize_interrupted_turn("cooperative_cancel", iteration)
                    .await;
                return Err(AgentError::Aborted);
            }

            // 总步骤预算检查：软提醒（80%/95%/100% 收尾提示 + StepBudgetWarning 事件），
            // 超过预算（最终收尾步后仍未收敛）→ 熔断返回（错误类型与崩溃/超时可区分）。
            // 计数口径 = 工具调用轮数（Claude Code maxTurns 同款）——每轮含工具调用计 1 步。
            let (used_steps, step_limit) = {
                let mut state = self.state.lock().await;
                state.current_iteration += 1;
                debug!(
                    "ReAct 循环第 {} 轮",
                    state.current_iteration
                );
                (
                    state.total_steps_used,
                    config_snapshot.total_steps.max(1),
                )
            };
            if let Some(exhausted) = self.apply_step_budget(used_steps, step_limit).await {
                error!("总步骤预算耗尽: {used_steps}/{step_limit}");
                return Err(AgentError::TotalStepsReached(exhausted));
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

            // ── 阶段 2 · A3：pre-step 输入准入 ───
            // inbox 三通道（FollowUp / Steer / Inject）在每轮请求构建**之前**统一裁决：
            // waterfall 分发 InputAdmission（监听器可改写/丢弃；不调 next = 否决本轮），
            // 准入项注入 state（随下方 set_messages 对本次请求生效）。压缩在其后计量，
            // 因此注入的上下文同样参与预算判断。
            let iteration = { self.state.lock().await.current_iteration };
            self.consume_admitted_inputs(iteration).await;

            // ── 阶段 3 · A2 补齐①：请求派生前压缩 ───
            // 修正前压缩在 AfterRun（轮次结束后）——收益滞后一整轮；此处位于每轮
            // LLM 请求派发（build_prompt_options / set_messages / prompt）之前，
            // 压缩收益在同一轮请求上生效。轻量短路避免每轮全量计量的成本（见
            // `enforce_context_budget`）。压缩失败仅告警，不阻断本轮请求。
            self.enforce_context_budget().await;

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

            // 阶段 3 · ④：请求快照（派发前采集——命令层监听器经同步分发先落 WAL，
            // 崩溃后可由装载期补齐；视图增量保证任一请求可结构级重建）
            self.capture_request_snapshot("main", &options, None).await;

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

            // 推入 toolResult 消息
            let current_turn_count = {
                let mut state = self.state.lock().await;
                for result in tool_results {
                    state.messages.push(result);
                }
                state.total_steps_used += 1; // 本轮含工具调用 → 计 1 步（工具调用轮数口径）
                state.current_iteration
            };

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
                        None, // 三模式移除（2026-08-31）：无 DeepPhase 当前阶段语义
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
        {
            let mut state = self.state.lock().await;
            state.messages.clear();
            state.current_iteration = 0;
            state.total_steps_used = 0;
            state.budget_warn_80_notified = false;
            state.budget_warn_95_notified = false;
            state.budget_final_notified = false;
            state.aborted = true; // 标记为已销毁，防止后续 run
        }
        self.is_streaming.store(false, Ordering::SeqCst);
        // Q1（2026-09-20）：随轮取消待回答提问（销毁后无人再应答，必须收口防永久阻塞）
        self.cancel_pending_interactions().await;
        // 同步停止长任务心跳定时器，避免泄漏
        self.long_task_manager.stop_heartbeat().await;
        debug!("AgentLoop dispose: 已释放资源");
    }
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
