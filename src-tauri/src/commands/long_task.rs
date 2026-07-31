//! # 长任务持久化命令层 — Loop Engineering 批次5
//!
//! 阶段 2.2 新增。将 [`LongTaskRepository`] 的能力通过 Tauri 命令暴露给前端，
//! 使前端 `useLongTaskRust` 能在心跳定时器触发时持久化 checkpoint，
//! 并支持应用重启后恢复 Running 任务（断点恢复）。
//!
//! ## 命令一览
//! | 命令 | 对应前端调用场景 | 说明 |
//! |------|------------------|------|
//! | `cmd_long_task_save`              | 心跳定时器 `CheckpointFlush` tick    | 保存或更新长任务（upsert） |
//! | `cmd_long_task_load`              | 断点恢复 `resumeTask(taskId)`        | 加载长任务完整数据 |
//! | `cmd_long_task_list_running`      | 应用启动恢复                         | 列出所有 Running 任务 |
//! | `cmd_long_task_list_all`          | 历史任务面板                         | 列出所有长任务（按 started_at DESC） |
//! | `cmd_long_task_update_heartbeat`  | 心跳定时器 `HeartbeatOnly` tick      | 轻量心跳更新（仅写 last_heartbeat_at） |
//! | `cmd_long_task_update_status`     | `complete`/`fail`/`cancel` 后        | 轻量状态更新（仅写 status + ended_at） |
//! | `cmd_long_task_delete`            | 用户清理历史 / GC                    | 删除指定长任务 |
//!
//! ## 错误处理
//! - 若 `LongTaskRepository` 未就绪（setup 钩子初始化失败）：返回 `PersistenceError::NotReady`
//! - `load` 不存在的 task：返回 `PersistenceError::NotFound`
//! - `update_heartbeat` / `update_status` / `delete` 不存在的 task：返回 `Ok(false)`（幂等）
//!
//! ## 命名约定
//! - Rust 端 `snake_case`（Tauri 自动转 `camelCase` 给前端）
//! - 参数 `task_id` → 前端 `taskId`
//! - 返回类型 `LongTaskRecord` 已用 `#[serde(rename_all = "camelCase")]`，
//!   前端 TypeScript 类型需镜像定义（见 `useLongTaskRust.ts`）

use tauri::State;
use tracing::{debug, info, warn};

use agent_runtime::long_task::{LongTaskRecord, LongTaskStatus};

use crate::agent_bridge::persistence::PersistenceError;
use crate::state::AppState;

/// "LongTaskRepository 未就绪" 的错误消息
const ERR_NOT_READY: &str = "LongTaskRepository 未初始化（setup 钩子失败或 app_data_dir 不可用）";

/// 保存或更新长任务（upsert 语义）
///
/// # 参数
/// - `record`: `LongTaskRecord`（含 task_id / status / checkpoint / meta 等完整字段）
///
/// # 行为
/// - 若 `task_id` 已存在：覆盖所有字段（保留 `started_at` 由 record 自带）
/// - 若不存在：插入新记录
///
/// # 调用时机
/// - 心跳定时器 `CheckpointFlush` tick（脏 checkpoint 持久化）
/// - `start_task` 后首次持久化
/// - `complete_task` / `fail_task` / `cancel_task` 后写入终态 record
///
/// # 返回
/// `()` 表示保存成功
#[tauri::command]
pub async fn cmd_long_task_save(
    state: State<'_, AppState>,
    record: LongTaskRecord,
) -> Result<(), PersistenceError> {
    let repo = state
        .long_task_repository
        .get()
        .ok_or_else(|| PersistenceError::NotReady(ERR_NOT_READY.to_string()))?;

    debug!(
        "cmd_long_task_save: task_id={} status={:?} turn_count={}",
        record.task_id, record.status, record.turn_count
    );
    repo.save(record).await?;
    Ok(())
}

/// 加载长任务完整数据
///
/// # 参数
/// - `task_id`: 任务 ID
///
/// # 返回
/// `LongTaskRecord`（含 checkpoint / meta，可断点恢复）
///
/// # 错误
/// - `NotFound`: task_id 不存在
///
/// # 调用时机
/// 应用启动 → `cmd_long_task_list_running` → 对每个 Running 任务 `cmd_long_task_load`
/// → 重建 AgentLoop messages → `LongTaskManager::resume_task`
#[tauri::command]
pub async fn cmd_long_task_load(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<LongTaskRecord, PersistenceError> {
    let repo = state
        .long_task_repository
        .get()
        .ok_or_else(|| PersistenceError::NotReady(ERR_NOT_READY.to_string()))?;

    debug!("cmd_long_task_load: task_id={}", task_id);
    let record = repo.load(task_id).await?;
    Ok(record)
}

/// 列出所有 Running 任务（应用启动恢复用）
///
/// # 返回
/// `Vec<LongTaskRecord>`（含完整 checkpoint，按 started_at ASC 排序）
///
/// # 调用时机
/// 应用启动时调用一次，恢复所有未完成的长任务
#[tauri::command]
pub async fn cmd_long_task_list_running(
    state: State<'_, AppState>,
) -> Result<Vec<LongTaskRecord>, PersistenceError> {
    let repo = state
        .long_task_repository
        .get()
        .ok_or_else(|| PersistenceError::NotReady(ERR_NOT_READY.to_string()))?;

    let list = repo.list_running().await?;
    debug!("cmd_long_task_list_running: count={}", list.len());
    Ok(list)
}

/// 列出所有长任务（按 started_at DESC 排序，最近的在前）
///
/// # 返回
/// `Vec<LongTaskRecord>`（含已完成/失败/取消的历史任务）
///
/// # 调用时机
/// 前端历史任务面板加载时调用
#[tauri::command]
pub async fn cmd_long_task_list_all(
    state: State<'_, AppState>,
) -> Result<Vec<LongTaskRecord>, PersistenceError> {
    let repo = state
        .long_task_repository
        .get()
        .ok_or_else(|| PersistenceError::NotReady(ERR_NOT_READY.to_string()))?;

    let list = repo.list_all().await?;
    debug!("cmd_long_task_list_all: count={}", list.len());
    Ok(list)
}

/// 轻量心跳更新（仅写 last_heartbeat_at）
///
/// # 参数
/// - `task_id`: 任务 ID
/// - `last_heartbeat_at`: 新的心跳时间（RFC3339 字符串，前端用 `new Date().toISOString()` 生成）
///
/// # 返回
/// - `Ok(true)`: 更新成功
/// - `Ok(false)`: task_id 不存在（幂等，不报错）
///
/// # 调用时机
/// 心跳定时器 `HeartbeatOnly` tick（无脏 checkpoint 时的轻量写入）
#[tauri::command]
pub async fn cmd_long_task_update_heartbeat(
    state: State<'_, AppState>,
    task_id: String,
    last_heartbeat_at: chrono::DateTime<chrono::Utc>,
) -> Result<bool, PersistenceError> {
    let repo = state
        .long_task_repository
        .get()
        .ok_or_else(|| PersistenceError::NotReady(ERR_NOT_READY.to_string()))?;

    let updated = repo.update_heartbeat(task_id, last_heartbeat_at).await?;
    if !updated {
        warn!("cmd_long_task_update_heartbeat: task 不存在（幂等忽略）");
    }
    Ok(updated)
}

/// 轻量状态更新（complete/fail/cancel 时调用）
///
/// # 参数
/// - `task_id`: 任务 ID
/// - `status`: 新状态（`Completed` / `Failed` / `Cancelled`）
/// - `ended_at`: 结束时间（RFC3339）
///
/// # 返回
/// - `Ok(true)`: 更新成功
/// - `Ok(false)`: task_id 不存在
///
/// # 调用时机
/// `LongTaskManager.complete_task` / `fail_task` / `cancel_task` 后调用，
/// 仅更新 status + ended_at，不触碰 checkpoint/meta（避免 JSON 序列化开销）
#[tauri::command]
pub async fn cmd_long_task_update_status(
    state: State<'_, AppState>,
    task_id: String,
    status: LongTaskStatus,
    ended_at: chrono::DateTime<chrono::Utc>,
) -> Result<bool, PersistenceError> {
    let repo = state
        .long_task_repository
        .get()
        .ok_or_else(|| PersistenceError::NotReady(ERR_NOT_READY.to_string()))?;

    let updated = repo.update_status(task_id, status, ended_at).await?;
    if updated {
        info!("cmd_long_task_update_status: 已更新任务状态");
    } else {
        warn!("cmd_long_task_update_status: task 不存在（幂等忽略）");
    }
    Ok(updated)
}

/// 删除长任务记录
///
/// # 返回
/// - `Ok(true)`: 删除成功
/// - `Ok(false)`: task_id 不存在（幂等，不报错）
///
/// # 调用时机
/// - 用户主动清理历史任务
/// - GC 策略清理过老的已完成任务（参考 `LongTaskRepository::cleanup_finished_before`）
#[tauri::command]
pub async fn cmd_long_task_delete(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<bool, PersistenceError> {
    let repo = state
        .long_task_repository
        .get()
        .ok_or_else(|| PersistenceError::NotReady(ERR_NOT_READY.to_string()))?;

    let deleted = repo.delete(task_id).await?;
    if deleted {
        info!("cmd_long_task_delete: 已删除长任务");
    } else {
        warn!("cmd_long_task_delete: task 不存在（幂等忽略）");
    }
    Ok(deleted)
}
