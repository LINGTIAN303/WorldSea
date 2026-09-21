//! MCP Tauri 命令层（H2 重建 P2，2026-08-30 · Rust 原生 rmcp 路线）
//!
//! - 连接管理走 [`McpHub`]（rmcp，连接生命周期 = 应用生命周期）
//! - 配置持久化（2026-08-30 拍板 H6-③）：**全局单份 JSON 配置文件**
//!   `<app_data>/worldsea/mcp.json`——用户与 Agent 均可直接编辑，
//!   官方预设已全部移除（配置文件是唯一事实源）；原 SQLite mcp.db 废弃
//!   （仅冒烟数据，无迁移价值）。
//! - 文件格式（Claude Code 生态兼容风格，id 为键）：
//!   `{ "mcpServers": { "<id>": { "name": ..., "transport": "stdio", ... } } }`
//! - 前端 McpPanel 经 invoke 调用本层；Agent 侧由写边界白名单精确放行本文件
//!   （workspace-boundary.ts extraWritablePaths，见 useAgentRust 注入）

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::mcp_client::{McpConnectionConfig, McpHub, McpStatusEntry};
use agent_commands::AgentCommandService;
use agent_runtime::mcp::McpToolInfo;

/// 配置文件名（全局单份，单一事实源）
const CONFIG_FILE_NAME: &str = "mcp.json";

/// MCP 全局状态（setup 时构造，tauri State 共享）
pub struct McpState {
    pub hub: Arc<McpHub>,
    /// 全局配置文件绝对路径（`<app_data>/worldsea/mcp.json`）
    pub config_path: PathBuf,
    /// 配置文件读改写串行锁（防并发命令的读-改-写交错覆盖）
    pub config_lock: Mutex<()>,
}

/// 配置文件根结构（`mcpServers` 键对齐 Claude Code / Cursor 生态习惯）
#[derive(Debug, Serialize, Deserialize, Default)]
struct McpConfigFile {
    #[serde(default, rename = "mcpServers")]
    mcp_servers: BTreeMap<String, McpConnectionConfig>,
}

/// 计算全局配置文件路径（`<app_data>/worldsea/mcp.json`；与旧 mcp.db 同目录）
pub fn config_path_of(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取 app data 目录失败: {e}"))?;
    Ok(data_dir.join("worldsea").join(CONFIG_FILE_NAME))
}

/// 初始化：确保配置目录存在并返回 State 给 lib.rs manage（无数据库）
pub async fn init_state(app: &tauri::AppHandle) -> Result<McpState, String> {
    let config_path = config_path_of(app)?;
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {e}"))?;
    }
    Ok(McpState {
        hub: Arc::new(McpHub::new()),
        config_path,
        config_lock: Mutex::new(()),
    })
}

// ─── 配置文件读写（同步小文件 IO，命令内串行锁保护） ──────────────

/// 读取配置 map（文件不存在 → 空 map；解析失败 → Err 带路径，便于用户修复）
fn load_map(path: &Path) -> Result<BTreeMap<String, McpConnectionConfig>, String> {
    if !path.exists() {
        return Ok(BTreeMap::new());
    }
    let raw = std::fs::read_to_string(path)
        .map_err(|e| format!("读取 MCP 配置失败（{}）: {e}", path.display()))?;
    if raw.trim().is_empty() {
        return Ok(BTreeMap::new());
    }
    let file: McpConfigFile = serde_json::from_str(&raw)
        .map_err(|e| format!("MCP 配置解析失败（{}）: {e}", path.display()))?;
    Ok(file.mcp_servers)
}

/// 全量写回配置 map（pretty JSON，UTF-8；父目录不存在时补建）
fn store_map(path: &Path, map: &BTreeMap<String, McpConnectionConfig>) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {e}"))?;
    }
    let file = McpConfigFile {
        mcp_servers: map.clone(),
    };
    let json = serde_json::to_string_pretty(&file).map_err(|e| format!("配置序列化失败: {e}"))?;
    std::fs::write(path, json + "\n").map_err(|e| format!("写入 MCP 配置失败: {e}"))
}

/// upsert 单条配置（读-改-写，调用方需持有 config_lock）
fn upsert_config(path: &Path, config: &McpConnectionConfig) -> Result<(), String> {
    let mut map = load_map(path)?;
    map.insert(config.id.clone(), config.clone());
    store_map(path, &map)
}

/// 删除单条配置（读-改-写，调用方需持有 config_lock）
fn remove_config(path: &Path, id: &str) -> Result<(), String> {
    let mut map = load_map(path)?;
    if map.remove(id).is_some() {
        store_map(path, &map)?;
    }
    Ok(())
}

// ─── Tauri 命令（签名与 HTTP 桥 rpc.rs 注册保持一致，桥接层零改动） ──────────────

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
    {
        let _guard = state
            .config_lock
            .lock()
            .map_err(|e| format!("配置锁不可用: {e}"))?;
        upsert_config(&state.config_path, &config)?;
    }
    // 热注入失败不阻断连接结果（工具已发现并持久化，最差新会话仍能拿到）
    let injected = svc.hot_inject_mcp_tools().await;
    if injected > 0 {
        tracing::info!("MCP「{}」已连接，热注入 {} 个工具到活跃会话", config.name, injected);
    }
    Ok(tools)
}

/// 断开连接（持久化配置保留，便于重连）
///
/// 断开后同步注销该服务器在**所有活跃会话** tool_bus 中的工具（T09①，
/// 2026-09-01：此前 v1 取舍断开后旧工具留存至重启，本次收口）。注销失败
/// 不阻断断开（最差旧工具残留至重启，功能不受损）。
#[tauri::command]
pub async fn cmd_mcp_disconnect(
    state: tauri::State<'_, McpState>,
    svc: tauri::State<'_, AgentCommandService>,
    id: String,
) -> Result<usize, String> {
    state.hub.disconnect(&id).await?;
    let removed = svc.remove_mcp_server_tools(&id).await;
    // M7：最后一个 server 断开时，一并移除枢纽级 resources 工具
    if state.hub.connected_count().await == 0 {
        let _ = svc
            .remove_mcp_server_tools(agent_runtime::mcp::MCP_HUB_TOOL_GROUP)
            .await;
    }
    Ok(removed)
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

/// 保存连接配置（不连接——预配置场景；BTreeMap 保证文件内 id 有序）
#[tauri::command]
pub async fn cmd_mcp_save(
    state: tauri::State<'_, McpState>,
    config: McpConnectionConfig,
) -> Result<(), String> {
    let _guard = state
        .config_lock
        .lock()
        .map_err(|e| format!("配置锁不可用: {e}"))?;
    upsert_config(&state.config_path, &config)
}

/// 删除连接配置（同时断开活跃连接并注销会话中的工具，T09①）
#[tauri::command]
pub async fn cmd_mcp_delete(
    state: tauri::State<'_, McpState>,
    svc: tauri::State<'_, AgentCommandService>,
    id: String,
) -> Result<(), String> {
    let _ = state.hub.disconnect(&id).await;
    let _ = svc.remove_mcp_server_tools(&id).await;
    // M7：最后一个 server 移除时，一并移除枢纽级 resources 工具
    if state.hub.connected_count().await == 0 {
        let _ = svc
            .remove_mcp_server_tools(agent_runtime::mcp::MCP_HUB_TOOL_GROUP)
            .await;
    }
    let _guard = state
        .config_lock
        .lock()
        .map_err(|e| format!("配置锁不可用: {e}"))?;
    remove_config(&state.config_path, &id)
}

/// 已保存的连接配置列表（前端面板回显；BTreeMap 遍历天然按 id 有序）
#[tauri::command]
pub async fn cmd_mcp_saved(state: tauri::State<'_, McpState>) -> Result<Vec<McpConnectionConfig>, String> {
    let _guard = state
        .config_lock
        .lock()
        .map_err(|e| format!("配置锁不可用: {e}"))?;
    let map = load_map(&state.config_path)?;
    Ok(map.into_values().collect())
}

/// 启动时自动重连 enabled 的已保存连接（尽力而为，失败静默）
pub async fn auto_connect_all(state: &McpState) {
    // 配置文件读取失败（如用户手改出语法错误）时静默跳过，不阻断启动
    let map = match load_map(&state.config_path) {
        Ok(m) => m,
        Err(e) => {
            tracing::warn!("MCP 配置文件读取失败，跳过自动重连: {e}");
            return;
        }
    };
    for (_, cfg) in map {
        if cfg.enabled {
            let _ = state.hub.connect(cfg).await;
        }
    }
}

// ─── 单测（配置文件 round-trip；不依赖 Tauri 运行时） ──────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_config_path(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "ws-mcp-cfg-test-{}-{tag}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        dir.join(CONFIG_FILE_NAME)
    }

    fn sample_config(id: &str, enabled: bool) -> McpConnectionConfig {
        McpConnectionConfig {
            id: id.to_string(),
            name: format!("Server {id}"),
            transport: "stdio".into(),
            command: Some("npx".into()),
            args: vec!["-y".into(), "some-server".into()],
            url: None,
            headers: Vec::new(),
            enabled,
        }
    }

    #[test]
    fn missing_file_loads_empty() {
        let p = temp_config_path("missing");
        let _ = std::fs::remove_file(&p);
        assert!(load_map(&p).unwrap().is_empty());
    }

    #[test]
    fn upsert_then_load_round_trip() {
        let p = temp_config_path("roundtrip");
        upsert_config(&p, &sample_config("b", true)).unwrap();
        upsert_config(&p, &sample_config("a", false)).unwrap();
        // 同 id 覆盖
        upsert_config(&p, &sample_config("b", false)).unwrap();
        let map = load_map(&p).unwrap();
        assert_eq!(map.len(), 2);
        // BTreeMap 有序：首个为 a
        let first = map.values().next().unwrap();
        assert_eq!(first.id, "a");
        assert!(!map.get("b").unwrap().enabled);
        let _ = std::fs::remove_dir_all(p.parent().unwrap());
    }

    #[test]
    fn remove_config_deletes_entry() {
        let p = temp_config_path("remove");
        upsert_config(&p, &sample_config("x", true)).unwrap();
        remove_config(&p, "x").unwrap();
        assert!(load_map(&p).unwrap().is_empty());
        // 删除不存在的 id：幂等成功
        remove_config(&p, "nope").unwrap();
        let _ = std::fs::remove_dir_all(p.parent().unwrap());
    }

    #[test]
    fn malformed_file_returns_error_with_path() {
        let p = temp_config_path("malformed");
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, "{ not json").unwrap();
        let err = load_map(&p).unwrap_err();
        assert!(err.contains(p.to_string_lossy().as_ref()) || err.contains("mcp.json"));
        let _ = std::fs::remove_dir_all(p.parent().unwrap());
    }

    #[test]
    fn file_keeps_mcp_servers_key_shape() {
        let p = temp_config_path("shape");
        upsert_config(&p, &sample_config("s", true)).unwrap();
        let raw = std::fs::read_to_string(&p).unwrap();
        assert!(raw.contains("\"mcpServers\""));
        let _ = std::fs::remove_dir_all(p.parent().unwrap());
    }
}
