//! 扩展模式层：8 个编排扩展模式独立目录 + 共享类型 + 统一编排骨架
//!
//! 划分依据见 docs/details/架构/orchestration-matrix.md（底座能力 5 + 扩展模式 8）。
//! 规则：本层只依赖底座契约与资源服务（crate::node / backend / tool / event / types …），
//! 底座永不反向依赖本层。
//!
//! `orchestrator` 为统一编排骨架（设计 docs/plans/VibeCoding编排模式链路设计.md §3–§4）：
//! OrchestratorNode 单一抽象 + DefaultOrchestrator 唯一执行器，落地路线见
//! docs/plans/VibeCoding编排模式落地执行.md（M1 骨架 → M2 循环层 → M3 框架层适配）。

pub mod got;
pub mod multi_agent;
pub mod orchestrator;
pub mod reflective;
pub mod router;
pub mod shared;
pub mod supervisor;
pub mod tot;