//! 会话检查点策略（S3-d）
//!
//! 设计依据：`docs/plans/2026-09-21-ZCode能力内化方向探究/04-会话模型草案.md`（§2.5/2.6，ZD1-4）。
//!
//! - 检查点 = **请求边界指针** + 保留策略；内容由不可变日志与请求快照链承载（检查点本身不存数据）。
//! - **双轨**：手动打点（命令层接入随 S3-e）+ 每 [`AUTO_CHECKPOINT_INTERVAL`] 个请求自动打点
//!   （由 `append_request_snapshot` 在**分配请求序号成功后**触发——旁路调用同计入序号，同为边界）。
//! - 写入走事务括号（04 §2.6 三类操作统一范式）；**checkpoint 残留不撤销**（单行插入、终态自洽），
//!   装载期只清 mark。
//! - 保留策略：手动 + 自动**合并计数**，保留最近 [`CHECKPOINT_KEEP`] 个（每行仅为指针，成本可忽略；
//!   数量可调——阈值类参数，随实测再收紧）。
//! 详细见 docs/details/注释/agent-commands/session_store.md（会话族总览 §四）。

use crate::session_store::SqliteSessionRepository;
use crate::CommandError;

/// 自动检查点间隔：每 N 个请求边界打一个 auto 检查点（ZD1-4 裁定 N=10）
pub const AUTO_CHECKPOINT_INTERVAL: i64 = 10;

/// 检查点保留上限（手动 + 自动合并；超出按 (request_seq, created_at) 淘汰最旧）
pub const CHECKPOINT_KEEP: i64 = 50;

/// 打一个检查点（括号版；`kind`：`manual` / `auto`）。返回检查点 id。
pub(crate) async fn checkpoint_now(
    store: &SqliteSessionRepository,
    session_id: &str,
    request_seq: i64,
    kind: &str,
) -> Result<String, CommandError> {
    let payload = serde_json::json!({ "request_seq": request_seq, "kind": kind }).to_string();
    let mark = store.begin_branch_op("checkpoint", session_id, Some(&payload)).await?;
    let id = store.create_checkpoint(session_id, request_seq, kind).await?;
    store.prune_checkpoints(session_id, CHECKPOINT_KEEP).await?;
    store.finish_branch_op(&mark).await?;
    Ok(id)
}

/// 请求落库后的自动打点（每 N 个请求一次；返回本次是否打点）。
///
/// 由 `append_request_snapshot` 在分配请求序号成功后调用；失败由调用方降级为 warn
/// （辅助操作不得反噬主操作——快照落库优先）。
pub(crate) async fn auto_checkpoint_after_request(
    store: &SqliteSessionRepository,
    session_id: &str,
    request_seq: i64,
) -> Result<bool, CommandError> {
    if (request_seq + 1) % AUTO_CHECKPOINT_INTERVAL != 0 {
        return Ok(false);
    }
    checkpoint_now(store, session_id, request_seq, "auto").await?;
    Ok(true)
}

#[cfg(test)]
#[path = "session_checkpoint_tests.rs"]
mod tests;
