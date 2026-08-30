//! MCP Tauri 命令层（H2 重建 P2，2026-08-30 · Rust 原生 rmcp 路线）
//!
//! - 连接管理走 [`McpHub`]（rmcp，连接生命周期 = 应用生命周期）
//! - 配置持久化 = SQLite（`app_data/worldsmith/mcp.db`，拍板：不再用 localStorage）
//! - 前端 McpPanel 经 invoke 调用本层（旧 localStorage 伪状态作废）

use std::sync::Arc;

use std::str::FromStr;

use serde::{Deserialize, Serialize};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use tauri::Manager;

use crate::mcp_client::{McpConnectionConfig, McpHub, McpStatusEntry};
use agent_commands::AgentCommandService;
use agent_runtime::mcp::McpToolInfo;

/// MCP 全局状态（setup 时构造，tauri State 共享）
pub struct McpState {
    pub hub: Arc<McpHub>,
    pub pool: SqlitePool,
}

/// 初始化：打开 mcp.db（app_data/worldsmith/）并建表；返回 State 给 lib.rs manage
pub async fn init_state(app: &tauri::AppHandle) -> Result<McpState, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取 app data 目录失败: {e}"))?;
    let db_dir = data_dir.join("worldsmith");
    std::fs::create_dir_all(&db_dir).map_err(|e| format!("创建数据目录失败: {e}"))?;
    let db_url = format!("sqlite://{}?mode=rwc", db_dir.join("mcp.db").to_string_lossy());

    let pool = SqlitePoolOptions::new()
        .max_connections(2)
        .connect_with(
            SqliteConnectOptions::from_str(&db_url)
                .map_err(|e| format!("mcp.db 连接串解析失败: {e}"))?,
        )
        .await
        .map_err(|e| format!("打开 mcp.db 失败: {e}"))?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS mcp_connections (\
         id TEXT PRIMARY KEY, \
         config_json TEXT NOT NULL)",
    )
    .execute(&pool)
    .await
    .map_err(|e| format!("建表失败: {e}"))?;

    Ok(McpState {
        hub: Arc::new(McpHub::new()),
        pool,
    })
}

/// 保存连接配置并连接（幂等：同 id 重连）。返回发现的工具清单。
///
/// 连接成功后执行 MCP 工具热注入：把工具快照注册进所有活跃会话的 tool_bus，
/// 使当前会话立即可用（v1 冷策略只对新会话生效，此处弥补）。
#[tauri::command]
pub async fn cmd_mcp_connect(
    state: tauri::State<'_, McpState>,
    svc: tauri::State<'_, AgentCommandService>,
    config: McpConnectionConfig,
) -> Result<Vec<McpToolInfo>, String> {
    let tools = state.hub.connect(config.clone()).await?;
    let config_json =
        serde_json::to_string(&config).map_err(|e| format!("配置序列化失败: {e}"))?;
    sqlx::query("INSERT INTO mcp_connections (id, config_json) VALUES (?, ?) \
                 ON CONFLICT(id) DO UPDATE SET config_json = excluded.config_json")
        .bind(&config.id)
        .bind(&config_json)
        .execute(&state.pool)
        .await
        .map_err(|e| format!("持久化连接配置失败: {e}"))?;
    // 热注入失败不阻断连接结果（工具已发现并持久化，最差新会话仍能拿到）
    let injected = svc.hot_inject_mcp_tools().await;
    if injected > 0 {
        tracing::info!("MCP「{}」已连接，热注入 {} 个工具到活跃会话", config.name, injected);
    }
    Ok(tools)
}

/// 断开连接（持久化配置保留，便于重连）
#[tauri::command]
pub async fn cmd_mcp_disconnect(state: tauri::State<'_, McpState>, id: String) -> Result<(), String> {
    state.hub.disconnect(&id).await
}

/// 活跃连接状态列表（前端面板渲染）
#[tauri::command]
pub async fn cmd_mcp_status(state: tauri::State<'_, McpState>) -> Result<Vec<McpStatusEntry>, String> {
    Ok(state.hub.status().await)
}

/// 查询某连接的工具清单
#[tauri::command]
pub async fn cmd_mcp_list_tools(
    state: tauri::State<'_, McpState>,
    id: String,
) -> Result<Vec<McpToolInfo>, String> {
    state
        .hub
        .tools_of(&id)
        .await
        .ok_or_else(|| format!("MCP 连接不存在: {id}"))
}

/// 保存连接配置（不连接——预配置场景）
#[tauri::command]
pub async fn cmd_mcp_save(
    state: tauri::State<'_, McpState>,
    config: McpConnectionConfig,
) -> Result<(), String> {
    let config_json =
        serde_json::to_string(&config).map_err(|e| format!("配置序列化失败: {e}"))?;
    sqlx::query("INSERT INTO mcp_connections (id, config_json) VALUES (?, ?) \
                 ON CONFLICT(id) DO UPDATE SET config_json = excluded.config_json")
        .bind(&config.id)
        .bind(&config_json)
        .execute(&state.pool)
        .await
        .map_err(|e| format!("持久化连接配置失败: {e}"))?;
    Ok(())
}

/// 删除连接配置（同时断开活跃连接）
#[tauri::command]
pub async fn cmd_mcp_delete(state: tauri::State<'_, McpState>, id: String) -> Result<(), String> {
    let _ = state.hub.disconnect(&id).await;
    sqlx::query("DELETE FROM mcp_connections WHERE id = ?")
        .bind(&id)
        .execute(&state.pool)
        .await
        .map_err(|e| format!("删除连接配置失败: {e}"))?;
    Ok(())
}

/// 已保存的连接配置列表（启动时前端回显）
#[tauri::command]
pub async fn cmd_mcp_saved(state: tauri::State<'_, McpState>) -> Result<Vec<McpConnectionConfig>, String> {
    #[derive(sqlx::FromRow)]
    struct Row {
        config_json: String,
    }
    let rows: Vec<Row> = sqlx::query_as("SELECT config_json FROM mcp_connections ORDER BY id")
        .fetch_all(&state.pool)
        .await
        .map_err(|e| format!("读取连接配置失败: {e}"))?;
    Ok(rows
        .into_iter()
        .filter_map(|r| serde_json::from_str(&r.config_json).ok())
        .collect())
}

/// 启动时自动重连 enabled 的已保存连接（尽力而为，失败静默）
pub async fn auto_connect_all(state: &McpState) {
    // 直接查库（命令包装层的 State 参数不可在内部复用）
    let rows: Vec<(String,)> = match sqlx::query_as("SELECT config_json FROM mcp_connections ORDER BY id")
        .fetch_all(&state.pool)
        .await
    {
        Ok(rows) => rows,
        Err(_) => return,
    };
    for (config_json,) in rows {
        let cfg: McpConnectionConfig = match serde_json::from_str(&config_json) {
            Ok(c) => c,
            Err(_) => continue,
        };
        if cfg.enabled {
            let _ = state.hub.connect(cfg).await;
        }
    }
}
