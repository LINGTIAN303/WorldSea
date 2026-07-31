//! # Agent Runtime — Agent 编排框架 Rust 版
//!
//! 阶段 1.3：AgentLoop + ToolBus + GenaiBackend 已落地，ReAct 循环可用。
//! 阶段 2.1：Tree of Thoughts 已落地（ToTNode + BeamSearchStrategy + LLM 评分/目标检查）。
//! 阶段 2.4：Supervisor Pattern 已落地（SupervisorNode + LlmAssignmentStrategy）。
//! 阶段 2.5：Router Pattern 已落地（RouterNode + LlmRoutingStrategy / KeywordRoutingStrategy）。
//!
//! 本 crate 对应 `packages/agent-core/src/orchestrator/` 的 TS 实现，
//! 提供 Rust trait 映射与具体实现。
//!
//! ## 三层架构位置
//! ```text
//! ┌────────────────────────────────────────────┐
//! │  编排框架层（ToT/GoT/Multi-Agent/...）      │  ← 阶段 2 实现
//! ├────────────────────────────────────────────┤
//! │  Agent loop 层（ReAct/Plan/Reflection）     │  ← 本 crate 提供 trait + AgentLoop
//! ├────────────────────────────────────────────┤
//! │  LLM 通信层（genai / 自研）                 │  ← 阶段 1.2 实现（GenaiBackend）
//! └────────────────────────────────────────────┘
//!           Memory Pattern 横切所有层
//! ```
//!
//! ## 模块组织
//! - [`types`]：核心数据结构（State/Message/PlanItem/...）
//! - [`backend`]：LLM 后端访问器 trait（`NodeBackendAccessor`）+ `PromptResponse`
//! - [`memory`]：记忆访问器 trait（`MemoryAccessor`）
//! - [`node`]：节点接口（`OrchestratorNode` trait、`NodeContext`、`NodeResult`）
//! - [`event`]：编排事件枚举（`OrchestratorEvent`）
//! - [`orchestrator`]：编排器接口（`Orchestrator` trait、`OrchestratorEdge`、运行选项/结果）
//! - [`tool`]：工具与工具总线（`Tool` trait、`ToolBus` trait、`SimpleToolBus`）— 阶段 1.3
//! - [`agent`]：AgentLoop ReAct 循环实现 — 阶段 1.3
//! - [`supervisor`]：Supervisor Pattern（SupervisorNode/SubAgentSpec/AssignmentStrategy）— 阶段 2.4
//! - [`router`]：Router Pattern（RouterNode/RoutingStrategy/LlmRoutingStrategy）— 阶段 2.5
//! - [`tree_of_thoughts`]：Tree of Thoughts（ToTNode/BeamSearchStrategy/ScoringStrategy）— 阶段 2.1
//! - [`llm`]：genai 通信层（`GenaiBackend`、`stream_simple`、`get_model`）— 阶段 1.2（feature `llm-genai`）
//!
//! ## 设计原则
//! - **轻量**：核心只定义 trait，具体实现按需启用 feature
//! - **可迁移**：接口设计直接映射阶段 0 的 TS 接口
//! - **解耦**：不依赖 pi-agent-core，可包装任何 LLM 后端
//! - **异步优先**：所有 trait 方法使用 `async_trait`，为 ToT/GoT 并行做准备

pub mod agent;
pub mod alias;
pub mod a2ui;
pub mod backend;
pub mod deep_phases;
pub mod event;
pub mod graph_of_thoughts;
#[cfg(feature = "llm-genai")]
pub mod llm;
pub mod long_task;
pub mod loop_control;
pub mod mcp;
pub mod memory;
pub mod multi_agent;
pub mod node;
pub mod orchestrator;
pub mod router;
pub mod supervisor;
pub mod tool;
pub mod tree_of_thoughts;
pub mod types;

// ─── 公共导出 ────────────────────────────────────────────
pub use agent::{AgentError, AgentLoop, AgentLoopConfig, AgentState, AgentStateSnapshot};
pub use backend::{NodeBackendAccessor, PromptCallOptions, PromptResponse, ThinkingLevel};
pub use deep_phases::{classify_tool, all_phase_labels, all_phase_tools, DEEP_PHASES, OTHER_PHASE_LABEL, OTHER_PHASE_INDEX};
pub use event::OrchestratorEvent;
pub use graph_of_thoughts::{
    AggregationPromptTemplate, AggregationStrategy, GoTConfig, GoTNode, LlmAggregationStrategy,
};
pub use multi_agent::{
    AgentMessage, AgentRole, AgentSpec, CollectingEmitter, ConvergenceReason, ConvergenceStrategy,
    EventEmitterSafe, GoalCheckMAPromptTemplate, GoalCheckStrategyMA, LlmGoalCheckStrategyMA,
    LlmSynthesisStrategy, MultiAgentConfig, MultiAgentError, MultiAgentNode,
    SharedBlackboard, SynthesisPromptTemplate, SynthesisStrategy, Topology,
};
pub use long_task::{
    CheckpointProvider, HeartbeatStatus, HeartbeatTick, LongTaskCheckpoint, LongTaskManager,
    LongTaskMeta, LongTaskRecord, LongTaskStatus, LongTaskType, PipelineContext,
    HEARTBEAT_DEAD_THRESHOLD, HEARTBEAT_INTERVAL, HEARTBEAT_STALE_THRESHOLD,
};
pub use loop_control::{
    LoopControlCheck, LoopControlConfig, LoopController, RateLimitConfig, RateLimitExceeded,
    RateLimiter, RetryConfig, RetryPolicy, SoftTimeout, SoftTimeoutConfig, SoftTimeoutLevel,
    Watchdog, WatchdogAlert, WatchdogConfig,
};
pub use memory::{
    MemoryAccessor, MemoryArchiveResult, MemoryChunkContent, MemoryInjectOptions,
    MemoryOutputType, MemoryRecallOptions, MemoryRecallResult,
};
pub use node::{NodeContext, NodeResult, NodeType, OrchestratorNode};
pub use orchestrator::{
    DefaultOrchestrator, Orchestrator, OrchestratorEdge, OrchestratorResult, OrchestratorRunOptions,
};
pub use router::{
    KeywordRoutingStrategy, LlmRoutingStrategy, RouteResult, RouteTarget, RouterConfig, RouterNode,
    RoutingError, RoutingPromptTemplate, RoutingStrategy,
};
pub use supervisor::{
    AssignmentError, AssignmentPromptTemplate, AssignmentResult, AssignmentStrategy,
    LlmAssignmentStrategy, SubAgentSpec, SupervisorConfig, SupervisorNode,
};
pub use tool::{SimpleToolBus, Tool, ToolBus, ToolDefinition, ToolError};
pub use tree_of_thoughts::{
    BeamSearchStrategy, ExplorationPromptTemplate, ExplorationStrategy, GoalCheckPromptTemplate,
    GoalCheckStrategy, LlmGoalCheckStrategy, LlmScoringStrategy, ScoringPromptTemplate,
    ScoringStrategy, ThoughtNode, ThoughtNodeStatus, ToTConfig, ToTError, ToTNode,
    ToTTerminationReason,
};
pub use types::{
    OrchestratorMessage, OrchestratorState, PlanItem, PlanItemStatus, ReflectionIssue,
    ReflectionResult, ReflectionSeverity, ToolCall, WorkingMemoryEntry, WorkingMemorySnapshot,
};
