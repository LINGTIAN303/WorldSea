//! Agent Runtime crate 入口（模块组织/三层架构/设计原则），详细见 docs/details/注释/agent-runtime/lib.md

pub mod agent;
pub mod alias;
pub mod a2ui;
pub mod backend;
pub mod confirmation;
pub mod deep_phases;
pub mod event;
pub mod graph_of_thoughts;
// llm 模块整体开放：config/manifest/model/error 为纯数据，供 backend.rs 的
// NodeBackendAccessor 接口引用（不依赖 genai）；仅 genai_backend / stream
// 子模块在内部按 feature "llm-genai" 门控。
pub mod llm;
pub mod long_task;
pub mod loop_control;
pub mod mcp;
pub mod memory;
pub mod multi_agent;
pub mod node;
pub mod orchestrator;
pub mod router;
pub mod scenario;
pub mod supervisor;
pub mod tool;
pub mod tree_of_thoughts;
pub mod types;

// ─── 公共导出 ────────────────────────────────────────────
pub use agent::{AgentError, AgentLoop, AgentLoopConfig, AgentState, AgentStateSnapshot};
pub use backend::{NodeBackendAccessor, PromptCallOptions, PromptResponse, ThinkingLevel};
pub use confirmation::{ConfirmationBroker, ConfirmationPolicy};
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
    extract_force_pipeline, pipeline_targets, KeywordRoutingStrategy, LlmRoutingStrategy, Pipeline,
    PipelineRoutingStrategy, RouteResult, RouteTarget, RouterConfig, RouterNode, RoutingError,
    RoutingPromptTemplate, RoutingStrategy,
};
pub use scenario::{
    Scenario, ScenarioContext, ScenarioEntityProvider, ScenarioRegistry, WorldbuildingScenario,
};
pub use supervisor::{
    AssignmentError, AssignmentPromptTemplate, AssignmentResult, AssignmentStrategy,
    LlmAssignmentStrategy, SubAgentSpec, SupervisorConfig, SupervisorNode,
};
pub use tool::{SimpleToolBus, Tool, ToolBus, ToolDefinition, ToolError, WhitelistToolBus};
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
