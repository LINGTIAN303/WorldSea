//! 底座内核（Agent Execution Kernel）— 必备，可独立运行
//!
//! 划分依据见 docs/details/架构/orchestration-matrix.md §2.2（底座五项）：
//! ① 执行契约 node.rs · ② 宿主引擎 orchestrator.rs · ③ 最小闭环 agent/
//! ④ 资源服务 backend/tool/memory/event/types/confirmation/llm · ⑤ 工程横切 loop_control/long_task
//! 其余 infra（alias/mcp/a2ui/scenario）同属底座，为「可承载其他类层」的锚点。
//! 规则：本层永不反向依赖 patterns/（matrix §2.3 判定线）。

pub mod a2ui;
pub mod agent;
pub mod alias;
pub mod backend;
pub mod confirmation;
pub mod event;
pub mod llm;
pub mod long_task;
pub mod loop_control;
pub mod mcp;
pub mod memory;
pub mod node;
pub mod orchestrator;
pub mod pipeline;
pub mod router_decider;
pub mod scenario;
pub mod sub_agent_pool;
pub mod tool;
pub mod tool_context;
pub mod tool_hook;
pub mod types;