//! # Agent Bridge — agent-runtime 与 Tauri 之间的适配层
//!
//! 阶段 1.5 新增。本模块负责：
//! 1. 将 `agent_runtime::OrchestratorEvent` 转换为前端友好的 `AgentEventPayload`
//! 2. 提供 Tauri 命令封装（`commands/agent.rs` 调用）
//! 3. 管理 Agent 实例注册表（`AgentRegistry`）
//!
//! ## 架构位置
//! ```text
//! ┌──────────────────────────────────────────────┐
//! │  前端 Vue (useAgentRust.ts)                  │
//! │    ↓ invoke + Channel<AgentEventPayload>     │
//! ├──────────────────────────────────────────────┤
//! │  Tauri 命令层 (commands/agent.rs)            │
//! │    ↓ 调用                                     │
//! ├──────────────────────────────────────────────┤
//! │  agent_bridge (本模块)                        │
//! │    - payload: 事件扁平化                      │
//! │    - registry: Agent 实例管理                 │
//! │    - converter: OrchestratorEvent → Payload  │
//! ├──────────────────────────────────────────────┤
//! │  agent-runtime (AgentLoop + Backend)         │
//! └──────────────────────────────────────────────┘
//! ```

pub mod long_task_persistence;
pub mod native_tools;
pub mod payload;
pub mod persistence;
pub mod registry;
pub mod router_registry;
pub mod supervisor_registry;
pub mod tot_registry;
pub mod got_registry;
pub mod ma_registry;
// 阶段 2.6：Loop Engineering 实例管理（横切关注点，按 task_id 索引）
pub mod loop_control_registry;
pub mod tool_bridge;

#[allow(unused_imports)]
pub use native_tools::register_default_tools;
#[allow(unused_imports)]
pub use payload::{AgentEventPayload, ToolCallInfo, UsageInfo};
#[allow(unused_imports)]
pub use persistence::{
    PersistenceError, SaveSessionRequest, SessionRecord, SessionRepository, SessionSummary,
};
#[allow(unused_imports)]
pub use long_task_persistence::LongTaskRepository;
#[allow(unused_imports)]
pub use registry::{AgentEntry, AgentRegistry, AgentRegistryError, SharedMessageId};
// 阶段 2.1：Supervisor 实例管理（与 AgentRegistry 并列存在）
#[allow(unused_imports)]
pub use supervisor_registry::{
    SupervisorAbortCheck, SupervisorEmitter, SupervisorEntry, SupervisorRegistry,
    SupervisorRegistryError,
};
// 阶段 2.5：Router 实例管理（与 AgentRegistry / SupervisorRegistry 并列存在）
#[allow(unused_imports)]
pub use router_registry::{
    RouterAbortCheck, RouterEmitter, RouterEntry, RouterRegistry, RouterRegistryError,
};
// 阶段 2.1：ToT 实例管理（与 AgentRegistry / SupervisorRegistry / RouterRegistry 并列存在）
#[allow(unused_imports)]
pub use tot_registry::{
    ToTAbortCheck, ToTEmitter, ToTEntry, ToTRegistry, ToTRegistryError, ToTTreeSnapshot,
};
// 阶段 2.2：GoT 实例管理（与 AgentRegistry / SupervisorRegistry / RouterRegistry / ToTRegistry 并列存在）
#[allow(unused_imports)]
pub use got_registry::{
    GoTAbortCheck, GoTEmitter, GoTEntry, GoTGraphSnapshot, GoTRegistry, GoTRegistryError,
};
// 阶段 2.3：Multi-Agent 实例管理（与上述 Registry 并列存在）
#[allow(unused_imports)]
pub use ma_registry::{
    MultiAgentAbortCheck, MultiAgentEmitter, MultiAgentEntry, MultiAgentRegistry,
    MultiAgentRegistryError,
};
// 阶段 2.6：Loop Engineering 实例管理（横切关注点，按 task_id 索引）
#[allow(unused_imports)]
pub use loop_control_registry::{
    LoopControlEntry, LoopControlRegistry, LoopControlRegistryError, LoopControlStatus,
};
#[allow(unused_imports)]
pub use tool_bridge::{FrontendTool, FrontendToolBridge, ToolCallRequest, ToolCallResult};
