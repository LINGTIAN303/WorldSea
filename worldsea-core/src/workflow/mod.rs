//! 工作流核心类型与逻辑
//!
//! 包含定义/校验/解析，与 worldsea-core 共享存储。

pub mod types;
pub mod parser;
pub mod validator;

pub use types::{WorkflowDefinition, NodeDefinition, EdgeDefinition, NodePosition, WorkflowParam, ErrorHandlingConfig, SubGraph};
