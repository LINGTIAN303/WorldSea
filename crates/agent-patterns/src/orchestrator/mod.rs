//! 统一编排骨架（设计 §3–§4）— M1 骨架
//!
//! 「同一套节点抽象（`OrchestratorNode`）+ 同一个图执行器（`DefaultOrchestrator`）」
//! 覆盖 13 种编排模式的骨架层。模式语义全部落在节点实现与图模板里，
//! 执行器只认 trait，不认模式（设计 1.2 原则 1）。
//!
//! 分阶段落地（设计 §10 表 10-1）：
//! - M1（本模块当前状态）：类型层 + 黑板 + 图 + 执行器 + Single Agent 验收
//! - M2：Tool Use → ReAct → Self-Refine / Reflection / Plan-and-Execute
//! - M3：CompositeNode 与现有 7 模式适配迁入；车道并发 + wait-set
//! - M4：MemoryHandle 四层记忆接入
//! - M5：kernel Backend → LlmHandle 的 GenaiAdapter 适配

pub mod blackboard;
pub mod composite;
pub mod context;
pub mod decision;
pub mod error;
pub mod executor;
pub mod got;
pub mod genai_adapter;
pub mod graph;
pub mod handles;
#[cfg(test)]
mod m2_tests;
#[cfg(test)]
mod m2b_tests;
#[cfg(test)]
mod m3_tests;
#[cfg(test)]
mod m3c_tests;
#[cfg(test)]
mod m4_tests;
#[cfg(test)]
mod s1_adapter_tests;
pub mod multi_agent;
pub mod loop_engineering;
pub mod memory_store;
pub mod node;
pub mod observer;
pub mod plan_execute;
pub mod react;
pub mod reflection;
pub mod router;
pub mod self_refine;
pub mod supervisor;
pub mod single_agent;
#[cfg(test)]
mod tests;
pub mod tool_use;
pub mod tot;
pub mod tools;
pub mod types;

pub use blackboard::{Blackboard, BlackboardError};
pub use composite::CompositeNode;
pub use context::{BudgetView, CancelToken, NodeCtx, SubgraphRequest};
pub use error::{LlmError, MemoryError, NodeError};
pub use executor::{Checkpoint, DefaultOrchestrator, RunConfig, RunReport, StepRecord, TerminalReason};
pub use graph::{Condition, Edge, Graph, GraphError};
pub use handles::{LlmHandle, MemEntry, MemLayer, MemoryHandle, NoopMemory, Request, Response};
pub use genai_adapter::KernelBackendLlm;
pub use got::GotNode;
pub use loop_engineering::{ConvergePolicy, LoopEngineeringNode};
pub use memory_store::LayeredMemoryStore;
pub use multi_agent::MultiAgentNode;
pub use node::OrchestratorNode;
pub use observer::{PhaseStatus, RunObserver};
pub use plan_execute::{Plan, PlanExecuteNode};
pub use router::{AggregateNode, RouteChoice, RouterNode};
pub use supervisor::{SupervisorNode, TaskItem};
pub use react::ReActLoopNode;
pub use reflection::{Issue, ReflectionNode, Review};
pub use self_refine::{ObjectiveSignal, SelfRefineNode, ThresholdObjective};
pub use single_agent::{PromptSpec, SingleAgentNode};
pub use tot::TotNode;
pub use tool_use::ToolUseNode;
pub use tools::{CallRecord, Decision, Observation, ReactStep, ToolCall, ToolHandle, ToolProposal, ToolSpec, ToolSpecSet, TraceEntry};
pub use types::{NodeMeta, NodeResult, NodeSnapshot, Port, ProgressNote, Usage, NodeId};
