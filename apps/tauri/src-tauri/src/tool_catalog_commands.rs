//! R 批 R-0：工具目录命令（前端对话区行段分派基座）
//!
//! 与 `commands::cmd_agent_tool_names`（诊断用，仅名字数组）并列：本命令返回
//! descriptor 投影（category / readOnly / destructive / mcpServer / aliases），
//! 供前端 `useToolCatalog` 建立三层分派的第 ① 层。
//!
//! 设计见 docs/plans/2026-09-21-ZCode能力内化方向探究/18-对话区行段渲染批草案.md §5.1。

use agent_commands::AgentCommandService;
use agent_runtime::tool::ToolCatalogEntry;
use tauri::State;

/// 列出指定会话的工具目录（R-0 分派基座）
#[tauri::command]
pub async fn cmd_agent_tool_catalog(
    state: State<'_, AgentCommandService>,
    session_id: String,
) -> Result<Vec<ToolCatalogEntry>, String> {
    state
        .tool_catalog(&session_id)
        .await
        .map_err(|e| e.to_string())
}
