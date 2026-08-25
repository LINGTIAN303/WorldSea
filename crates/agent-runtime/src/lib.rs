//! Agent Runtime crate 入口（kernel 内核 + patterns 扩展层），详细见 docs/details/注释/agent-runtime/lib.md
//!
//! 布局：`kernel/`（底座内核，可独立运行）+ `patterns/`（8 扩展模式独立目录）。
//! 下方转发层仅作对外路径兼容的公共门面（matrix §8 阶段 A/B 迁移后保持），
//! 内部实现一律在 kernel/ 与 patterns/ 中。

pub mod kernel;
pub mod patterns;

// ─── 底座内核转发层（kernel/，对外路径兼容）─────────────────────
pub mod agent {
    pub use crate::kernel::agent::*;
}
pub mod alias {
    pub use crate::kernel::alias::*;
}
pub mod a2ui {
    pub use crate::kernel::a2ui::*;
}
pub mod backend {
    pub use crate::kernel::backend::*;
}
pub mod confirmation {
    pub use crate::kernel::confirmation::*;
}
pub mod deep_phases {
    pub use crate::kernel::deep_phases::*;
}
pub mod event {
    pub use crate::kernel::event::*;
}
// llm 模块整体开放：config/manifest/model/error 为纯数据，供 backend.rs 的
// NodeBackendAccessor 接口引用（不依赖 genai）；仅 genai_backend / stream
// 子模块在内部按 feature "llm-genai" 门控。
pub mod llm {
    pub use crate::kernel::llm::*;
}
pub mod long_task {
    pub use crate::kernel::long_task::*;
}
pub mod loop_control {
    pub use crate::kernel::loop_control::*;
}
pub mod mcp {
    pub use crate::kernel::mcp::*;
}
pub mod memory {
    pub use crate::kernel::memory::*;
}
pub mod node {
    pub use crate::kernel::node::*;
}
pub mod orchestrator {
    pub use crate::kernel::orchestrator::*;
}
pub mod scenario {
    pub use crate::kernel::scenario::*;
}
pub mod tool {
    pub use crate::kernel::tool::*;
}
pub mod tool_context {
    pub use crate::kernel::tool_context::*;
}
pub mod tool_hook {
    pub use crate::kernel::tool_hook::*;
}
pub mod types {
    pub use crate::kernel::types::*;
}

// ─── 扩展模式转发层（patterns/，对外路径兼容）───────────────────
// graph_of_thoughts 已物理迁移至 patterns/got/
pub mod graph_of_thoughts {
    pub use crate::patterns::got::*;
}
// multi_agent 已物理迁移至 patterns/multi_agent/
pub mod multi_agent {
    pub use crate::patterns::multi_agent::*;
}
// plan 已物理迁移至 patterns/plan_execute/
pub mod plan {
    pub use crate::patterns::plan_execute::*;
}
// reflection 已物理迁移至 patterns/reflective/
pub mod reflection {
    pub use crate::patterns::reflective::*;
}
// router 已物理迁移至 patterns/router/
pub mod router {
    pub use crate::patterns::router::*;
}
// supervisor 已物理迁移至 patterns/supervisor/
pub mod supervisor {
    pub use crate::patterns::supervisor::*;
}
// tree_of_thoughts 已物理迁移至 patterns/tot/
pub mod tree_of_thoughts {
    pub use crate::patterns::tot::*;
}

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
