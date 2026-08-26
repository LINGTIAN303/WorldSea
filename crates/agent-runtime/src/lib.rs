//! Agent Runtime crate — 聚合壳（matrix §8 里程碑 2，2026-08-25）
//!
//! 物理拆分后转发两个子 crate，保持对外路径 `agent_runtime::xxx` 零改动：
//! - `agent_kernel`：底座内核（node/orchestrator/agent/backend/tool/memory/...）
//! - `agent_patterns`：扩展模式（tot/got/plan_execute/reflective/router/supervisor/multi_agent/shared）
//!
//! 底座模块经 `pub use agent_kernel::*` 直达根；扩展模式保留旧路径转发层
//! （`plan`→`plan_execute`、`reflection`→`reflective`、`tree_of_thoughts`→`tot`、
//! `graph_of_thoughts`→`got`），与拆分前对外语义一致。

pub use agent_kernel::*;
pub use agent_patterns::*;

// ─── 扩展模式旧路径转发层（对外兼容 agent_runtime::plan 等）───────────────────
// 同名模块（multi_agent/router/supervisor）经 `pub use agent_patterns::*` 直达根；
// 此处仅映射改名模块：graph_of_thoughts→got、plan→plan_execute、
// reflection→reflective、tree_of_thoughts→tot。
pub mod graph_of_thoughts {
    pub use agent_patterns::got::*;
}
pub mod plan {
    pub use agent_patterns::plan_execute::*;
}
pub mod reflection {
    pub use agent_patterns::reflective::*;
}
pub mod tree_of_thoughts {
    pub use agent_patterns::tot::*;
}

// ─── 公共导出（与拆分前一致，类型来自上述转发/直达路径）───────────────────
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
pub use plan::{
    ExecuteFailurePolicy, ExecuteNode, ExecuteNodeConfig, PlanNode, PlanNodeConfig,
};
pub use reflection::{
    default_dimensions, ReflectionDimension, ReflectionNode, ReflectionNodeConfig, RefineNode,
    RefineNodeConfig,
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
pub use tool_context::ToolContext;
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