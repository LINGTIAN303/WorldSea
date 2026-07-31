//! MCP（Model Context Protocol）进程管理命令
//!
//! 拆分自 lib.rs（P0-2 批次5）。
//! 涵盖 MCP 服务器子进程的启动/停止/列表命令。
//! 所有命令通过 `State<AppState>` 注入获取全局 mcp_processes map。

use tauri::State;
use worldsmith_core::error::CoreError;

use crate::state::AppState;

#[tauri::command]
pub fn cmd_mcp_spawn(
    state: State<AppState>,
    server_id: String,
    command: String,
    args: Vec<String>,
) -> Result<(), CoreError> {
    let child = std::process::Command::new(&command)
        .args(&args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| CoreError::InvalidArgument(format!("Failed to spawn MCP server: {}", e)))?;
    let mut processes = state
        .mcp_processes
        .lock()
        .map_err(|e| CoreError::Lock(e.to_string()))?;
    processes.insert(server_id, child);
    Ok(())
}

#[tauri::command]
pub fn cmd_mcp_kill(state: State<AppState>, server_id: String) -> Result<(), CoreError> {
    let mut processes = state
        .mcp_processes
        .lock()
        .map_err(|e| CoreError::Lock(e.to_string()))?;
    if let Some(mut child) = processes.remove(&server_id) {
        let _ = child.kill();
    }
    Ok(())
}

#[tauri::command]
pub fn cmd_mcp_list(state: State<AppState>) -> Result<Vec<String>, CoreError> {
    let processes = state
        .mcp_processes
        .lock()
        .map_err(|e| CoreError::Lock(e.to_string()))?;
    Ok(processes.keys().cloned().collect())
}
