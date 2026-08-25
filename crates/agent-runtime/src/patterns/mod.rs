//! 扩展模式层：8 个编排扩展模式独立目录 + 共享类型
//!
//! 划分依据见 docs/details/架构/orchestration-matrix.md（底座能力 5 + 扩展模式 8）。
//! 规则：本层只依赖底座契约与资源服务（crate::node / backend / tool / event / types …），
//! 底座永不反向依赖本层。

pub mod got;
pub mod multi_agent;
pub mod plan_execute;
pub mod reflective;
pub mod router;
pub mod shared;
pub mod supervisor;
pub mod tot;