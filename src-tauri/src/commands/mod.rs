//! Tauri 命令模块集合
//!
//! 拆分自 lib.rs（P0-2）。
//! 每个子模块按领域划分，包含若干 `#[tauri::command]` 函数。
//! 各命令通过 `State<AppState>` 注入获取全局状态。

// 批次1：skeleton + secure + project
pub mod secure;
pub mod project;

// 批次2：entity + relation + kv + file
pub mod entity;
pub mod relation;
pub mod kv;
pub mod file;

// 批次3：validate + retrofit + spatial
pub mod validate;
pub mod retrofit;
pub mod spatial;

// 批次4：algo（单文件保留，59 命令）
pub mod algo;

// 批次5：schema + mcp + font + skills + fs + pty + shell
pub mod schema;
pub mod mcp;
pub mod font;
pub mod skills;
pub mod fs;
pub mod pty;
pub mod shell;

// 批次6：agent（阶段 1.5 Tauri 集成）
pub mod agent;

// 批次7：session（阶段 2.5 会话持久化）
pub mod session;

// 批次8：long_task（阶段 2.2 Loop Engineering 长任务持久化）
pub mod long_task;

// 批次9：supervisor（阶段 2.1 Supervisor Pattern Tauri 命令层）
pub mod supervisor;

// 批次10：router（阶段 2.5 Router Pattern Tauri 命令层）
pub mod router;

// 批次11：tot（阶段 2.1 Tree of Thoughts Pattern Tauri 命令层）
pub mod tot;

// 批次12：got（阶段 2.2 Graph of Thoughts Pattern Tauri 命令层）
pub mod got;

// 批次13：multi_agent（阶段 2.3 Multi-Agent Pattern Tauri 命令层）
pub mod multi_agent;

// 批次14：loop_control（阶段 2.6 Loop Engineering Tauri 命令层）
pub mod loop_control;
