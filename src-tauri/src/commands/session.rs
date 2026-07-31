//! # Agent 会话持久化命令层
//!
//! 阶段 2.5 新增。将 `SessionRepository` 的能力通过 Tauri 命令暴露给前端，
//! 使前端 `useAgentRustAdapter` 能在 `switchSession`/`newSession`/`dispose` 时
//! 持久化与恢复会话数据。
//!
//! ## 命令一览
//! | 命令 | 对应前端调用场景 | 说明 |
//! |------|------------------|------|
//! | `cmd_session_save`              | `dispose` / 切换前           | 保存或更新会话（upsert） |
//! | `cmd_session_load`              | `switchSession(id)`          | 加载会话完整数据 |
//! | `cmd_session_list`              | 侧边栏会话列表               | 列出所有会话摘要 |
//! | `cmd_session_delete`            | 用户主动删除会话             | 删除指定会话 |
//! | `cmd_session_update_title`      | 会话首条消息后自动重命名      | 仅更新标题（保留其他字段） |
//! | `cmd_session_toggle_pin`        | 用户置顶/取消置顶             | 切换 pinned 状态 |
//!
//! ## 错误处理
//! - 若 `SessionRepository` 未就绪（setup 钩子初始化失败）：返回 `PersistenceError::NotReady`
//! - `load` 不存在的 session：返回 `PersistenceError::NotFound`
//!
//! ## 命名约定
//! - Rust 端 `snake_case`（Tauri 自动转 `camelCase` 给前端）
//! - 参数 `session_id` → 前端 `sessionId`
//! - 返回类型 `SessionRecord` / `SessionSummary` 已用 `#[serde(rename_all = "camelCase")]`

use tauri::State;
use tracing::{debug, info, warn};

use crate::agent_bridge::persistence::{
    PersistenceError, SaveSessionRequest, SessionRecord, SessionSummary,
};
use crate::state::AppState;

/// "SessionRepository 未就绪" 的错误消息
const ERR_NOT_READY: &str = "SessionRepository 未初始化（setup 钩子失败或 app_data_dir 不可用）";

/// 保存或更新会话（upsert 语义）
///
/// # 参数
/// - `req`: SaveSessionRequest（id, title, provider_config, messages, ...）
///
/// # 行为
/// - 若 `id` 已存在：更新所有字段，保留 `created_at`
/// - 若不存在：插入新记录，`created_at = 当前时间`
///
/// # 返回
/// 保存后的完整 `SessionRecord`（含 `created_at` / `updated_at`）
#[tauri::command]
pub async fn cmd_session_save(
    state: State<'_, AppState>,
    req: SaveSessionRequest,
) -> Result<SessionRecord, PersistenceError> {
    let repo = state
        .session_repository
        .get()
        .ok_or_else(|| PersistenceError::NotReady(ERR_NOT_READY.to_string()))?;

    debug!(
        "cmd_session_save: id={} title={} messages={}",
        req.id,
        req.title,
        req.messages.len()
    );
    let record = repo.save(req).await?;
    Ok(record)
}

/// 加载会话完整数据
///
/// # 参数
/// - `session_id`: 会话 ID
///
/// # 返回
/// `SessionRecord`（含 messages / provider_config / thinking_level 等）
///
/// # 错误
/// - `NotFound`: session_id 不存在
#[tauri::command]
pub async fn cmd_session_load(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<SessionRecord, PersistenceError> {
    let repo = state
        .session_repository
        .get()
        .ok_or_else(|| PersistenceError::NotReady(ERR_NOT_READY.to_string()))?;

    debug!("cmd_session_load: id={}", session_id);
    let record = repo.load(session_id).await?;
    Ok(record)
}

/// 列出所有会话摘要（按 pinned DESC, updated_at DESC 排序）
///
/// # 返回
/// `Vec<SessionSummary>`（不含 messages 体，仅元数据）
#[tauri::command]
pub async fn cmd_session_list(
    state: State<'_, AppState>,
) -> Result<Vec<SessionSummary>, PersistenceError> {
    let repo = state
        .session_repository
        .get()
        .ok_or_else(|| PersistenceError::NotReady(ERR_NOT_READY.to_string()))?;

    let list = repo.list().await?;
    debug!("cmd_session_list: count={}", list.len());
    Ok(list)
}

/// 删除会话
///
/// # 返回
/// - `Ok(true)`: 删除成功
/// - `Ok(false)`: session_id 不存在（幂等，不报错）
#[tauri::command]
pub async fn cmd_session_delete(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<bool, PersistenceError> {
    let repo = state
        .session_repository
        .get()
        .ok_or_else(|| PersistenceError::NotReady(ERR_NOT_READY.to_string()))?;

    let deleted = repo.delete(session_id).await?;
    if deleted {
        info!("cmd_session_delete: 已删除 session");
    } else {
        warn!("cmd_session_delete: session 不存在（幂等忽略）");
    }
    Ok(deleted)
}

/// 仅更新标题（保留其他字段）
///
/// 用于会话首条消息后自动重命名场景，避免重写完整 messages。
///
/// # 返回
/// - `Ok(true)`: 更新成功
/// - `Ok(false)`: session_id 不存在
#[tauri::command]
pub async fn cmd_session_update_title(
    state: State<'_, AppState>,
    session_id: String,
    title: String,
) -> Result<bool, PersistenceError> {
    let repo = state
        .session_repository
        .get()
        .ok_or_else(|| PersistenceError::NotReady(ERR_NOT_READY.to_string()))?;

    let updated = repo.update_title(session_id, title).await?;
    Ok(updated)
}

/// 切换 pinned 状态
///
/// # 参数
/// - `pinned`: true=置顶, false=取消置顶
///
/// # 返回
/// - `Ok(true)`: 更新成功
/// - `Ok(false)`: session_id 不存在
#[tauri::command]
pub async fn cmd_session_toggle_pin(
    state: State<'_, AppState>,
    session_id: String,
    pinned: bool,
) -> Result<bool, PersistenceError> {
    let repo = state
        .session_repository
        .get()
        .ok_or_else(|| PersistenceError::NotReady(ERR_NOT_READY.to_string()))?;

    let updated = repo.toggle_pin(session_id, pinned).await?;
    Ok(updated)
}
