//! 应用全局状态定义
//!
//! 拆分自 lib.rs（P0-2 批次1）。
//! 所有字段 pub：commands 子模块需跨文件访问。
//! AppState 实例只在 lib.rs `manage()` 注册，外部 crate 拿不到实例，
//! 因此字段 pub 不破坏封装边界。

use std::sync::{Mutex, OnceLock};

use notify::RecommendedWatcher;
use portable_pty::MasterPty;
use worldsmith_core::algo::spatial::rtree::SpatialIndex;
use worldsmith_core::retrofit::RetrofitEngine;
use worldsmith_core::schema::SchemaRegistry;
use worldsmith_core::storage::sqlite::SqliteStore;

use crate::agent_bridge::{
    GoTRegistry, LongTaskRepository, LoopControlRegistry, MultiAgentRegistry, RouterRegistry,
    SessionRepository, SupervisorRegistry, ToTRegistry,
};

/// Tauri 全局状态。
///
/// 各 `commands::*` 子模块通过 `State<AppState>` 由 Tauri 自动注入拿到实例，
/// 再通过 `state.db.lock()` 等方式访问字段。
pub struct AppState {
    pub db: Mutex<SqliteStore>,
    pub retrofit: Mutex<RetrofitEngine>,
    pub spatial: Mutex<SpatialIndex>,
    pub schema: Mutex<SchemaRegistry>,
    pub mcp_processes: Mutex<std::collections::HashMap<String, std::process::Child>>,
    pub pty_processes: Mutex<std::collections::HashMap<String, PtyProcess>>,
    /// PTY 输出 channel 接收端，供 cmd_shell_session_exec 读取
    pub pty_output_receivers:
        Mutex<std::collections::HashMap<String, std::sync::mpsc::Receiver<String>>>,
    /// 工作流引擎单例（Phase 2.1+）
    pub wf_engine: std::sync::Arc<crate::workflow::engine::WorkflowEngine>,
    /// 工作流 Sqlite 数据库路径（spawn executor 时用于开新连接）
    pub wf_db_path: std::sync::Mutex<String>,
    pub plugin_node_metas: std::sync::Mutex<
        std::collections::HashMap<String, crate::workflow::node_meta::NodeMetadata>,
    >,
    pub dispatcher_registry: std::sync::Arc<
        std::sync::Mutex<
            std::collections::HashMap<String, std::sync::Arc<crate::workflow::executor::DispatchHandle>>,
        >,
    >,
    /// Agent 实例注册表（阶段 1.5）
    ///
    /// 持有多个 `AgentLoop` 实例，每个会话对应独立 Agent。
    /// 通过 `tokio::sync::RwLock<HashMap>` 实现并发读、互斥写。
    /// commands/agent.rs 通过 `State<AppState>` 注入访问。
    pub agent_registry: std::sync::Arc<crate::agent_bridge::AgentRegistry>,
    /// Supervisor 实例注册表（阶段 2.1）
    ///
    /// 持有多个 `SupervisorNode` 实例，与 `agent_registry` 并列存在
    /// （SupervisorNode 不是 AgentLoop，独立管理）。
    /// 每个 entry 还包含共享的 backend / tool_bus / tool_bridge / state /
    /// abort_flag / broadcaster，供跨命令访问。
    /// commands/supervisor.rs 通过 `State<AppState>` 注入访问。
    pub supervisor_registry: std::sync::Arc<SupervisorRegistry>,
    /// Router 实例注册表（阶段 2.5）
    ///
    /// 持有多个 `RouterNode` 实例，与 `agent_registry` / `supervisor_registry` 并列存在
    /// （RouterNode 是纯决策节点，不持有子 Agent）。
    /// 每个 entry 包含 router / backend / broadcaster / abort_flag / state / created_at，
    /// 供跨命令访问。commands/router.rs 通过 `State<AppState>` 注入访问。
    pub router_registry: std::sync::Arc<RouterRegistry>,
    /// ToT 实例注册表（阶段 2.1 Tree of Thoughts）
    ///
    /// 持有多个 `ToTNode` 实例，与 `agent_registry` / `supervisor_registry` /
    /// `router_registry` 并列存在（ToTNode 是纯探索节点，不执行工具调用，只调用 LLM
    /// 生成思维/评分/目标检查）。
    /// 每个 entry 包含 tot / backend / broadcaster / abort_flag / state / created_at，
    /// 供跨命令访问。commands/tot.rs 通过 `State<AppState>` 注入访问。
    pub tot_registry: std::sync::Arc<ToTRegistry>,
    /// GoT 实例注册表（阶段 2.2 Graph of Thoughts）
    ///
    /// 持有多个 `GoTNode` 实例，与 `agent_registry` / `supervisor_registry` /
    /// `router_registry` / `tot_registry` 并列存在（GoTNode 是纯探索 + 聚合节点，
    /// 不执行工具调用，只调用 LLM 生成思维/评分/目标检查/聚合）。
    /// 每个 entry 包含 got / backend / broadcaster / abort_flag / state / created_at，
    /// 供跨命令访问。commands/got.rs 通过 `State<AppState>` 注入访问。
    pub got_registry: std::sync::Arc<GoTRegistry>,
    /// Multi-Agent 实例注册表（阶段 2.3 Multi-Agent Pattern）
    ///
    /// 持有多个 `MultiAgentNode` 实例，与上述 Registry 并列存在
    /// （MultiAgentNode 是去中心化对等协作节点，内部 N 个 AgentLoop 通过
    /// mpsc 通道 + SharedBlackboard 协作）。
    /// 每个 entry 包含 multi_agent / backend / tool_bus / tool_bridge /
    /// broadcaster / abort_flag / state / created_at，供跨命令访问。
    /// commands/multi_agent.rs 通过 `State<AppState>` 注入访问。
    pub ma_registry: std::sync::Arc<MultiAgentRegistry>,
    /// LoopController 实例注册表（阶段 2.6 Loop Engineering）
    ///
    /// 持有多个 `LoopController` 实例，与上述 Registry 并列存在
    /// （Loop Engineering 是横切关注点，不是独立编排节点）。
    /// 按 `task_id` 索引（与 `LongTaskRecord.task_id` 对齐），一个会话可能有多个
    /// 长任务，每个长任务对应独立的 LoopController。
    /// 每个 entry 包含 controller / config / broadcaster / created_at，
    /// 不持有 backend / tool_bus / tool_bridge（LoopController 不调用 LLM/tool）。
    /// commands/loop_control.rs 通过 `State<AppState>` 注入访问。
    pub loop_control_registry: std::sync::Arc<LoopControlRegistry>,
    /// Agent 会话持久化仓库（阶段 2.5）
    ///
    /// 使用独立的 SQLite 数据库（`agent_sessions.db`）存储会话元数据与消息历史，
    /// 与主项目 db 隔离，避免项目切换时丢失 Agent 会话。
    ///
    /// # 延迟初始化
    /// `OnceLock` 允许在 Tauri `setup` 钩子中拿到 `app_data_dir` 后再初始化，
    /// 避免 lib.rs `manage()` 阶段无法访问 PathResolver 的问题。
    /// 命令层通过 `state.session_repository.get()` 读取，若为 `None` 返回未就绪错误。
    pub session_repository: OnceLock<SessionRepository>,
    /// 长任务持久化仓库（阶段 2.2 Loop Engineering）
    ///
    /// 与 `session_repository` 共用同一 `agent_sessions.db` 文件，但持有独立的
    /// `Connection` 实例（SQLite 支持多 Connection 并发访问同一文件）。
    /// 仅负责 `long_tasks` 表的读写。
    ///
    /// # 延迟初始化
    /// 与 `session_repository` 同模式：在 Tauri `setup` 钩子中拿到 `app_data_dir`
    /// 后初始化。命令层通过 `state.long_task_repository.get()` 读取。
    pub long_task_repository: OnceLock<LongTaskRepository>,
}

/// PTY 进程封装。
///
/// 字段 pub：pty.rs / shell.rs 子模块需访问 master/writer/kill_tx 等。
pub struct PtyProcess {
    pub master: Box<dyn MasterPty + Send>,
    pub writer: Box<dyn std::io::Write + Send>,
    pub _child: Box<dyn portable_pty::Child + Send + Sync>,
    pub kill_tx: std::sync::Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
    /// 输出缓冲 channel sender：持有以保持 channel 存活，receiver 在 pty_output_receivers 中
    #[allow(dead_code)]
    pub output_tx: std::sync::Mutex<Option<std::sync::mpsc::Sender<String>>>,
}

/// 文件监听状态管理
pub struct FsWatcherState {
    pub watchers: Mutex<std::collections::HashMap<String, RecommendedWatcher>>,
}
