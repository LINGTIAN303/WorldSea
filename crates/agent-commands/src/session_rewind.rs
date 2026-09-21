//! 会话回滚执行链（S3-d）
//!
//! 设计依据：`docs/plans/2026-09-21-ZCode能力内化方向探究/04-会话模型草案.md`（§2.4/2.6）。
//!
//! - **锚点 = 请求边界**：目标视图 = 该会话在 `request_seq` 派发时的消息视图（含该请求
//!   输入、不含其响应及之后）——与分叉同源坐标（复用 08 重建链，零新游标）。
//! - **日志不删**：回滚 = 向活跃视图追加一条 replace（`replace_messages` 的 append-only
//!   语义：移出视图的消息只解除游标引用、内容留日志）——因此可再回滚到别的边界、可再前行；
//!   重入视图的消息按新版本重新入日志（内容同、坐标新，既有模型行为）。
//! - **默认域 conversation**（ZD1-2/3）：工作区回滚由领域层另立项，内核只提供锚点与事件流。
//! - 事务括号同分叉；**rewind 残留不撤销**（终态自洽：最坏即"回滚已生效但未回报"，
//!   用户可再回滚到任意边界），装载期只清 mark。
//! 详细见 docs/details/注释/agent-commands/session_store.md（会话族总览 §四）。

use agent_runtime::types::OrchestratorMessage;

use crate::session_store::{
    reconstruct_request_view, ReplaceOutcome, SessionRepository, SqliteSessionRepository,
};
use crate::CommandError;

/// 回滚结果：目标边界 + 回滚后视图 + 视图同步三元组
#[derive(Debug, Clone)]
pub struct RewindOutcome {
    /// 回滚到的请求边界
    pub target_seq: i64,
    /// 目标边界的消息视图（= 回滚后的活跃视图）
    pub view: Vec<OrchestratorMessage>,
    /// 视图同步变化（`noop` = 本已在目标边界）
    pub replace: ReplaceOutcome,
}

/// 回滚会话活跃视图到请求边界 `request_seq`（日志不删、可再回退）。
///
/// 拒绝条件（fail-closed，与分叉同源）：会话不存在 / 快照链缺该序号或不完整。
/// 拒绝发生在落 mark 之前——不产生任何残留。
///
/// 入口：`SessionRepository::rewind_session`（trait 委托；服务层经 dyn 调用）。
pub(crate) async fn rewind_session(
    store: &SqliteSessionRepository,
    session_id: &str,
    request_seq: i64,
) -> Result<RewindOutcome, CommandError> {
    let exists = store.load_sessions().await?.iter().any(|r| r.id == session_id);
    if !exists {
        return Err(CommandError::session_not_found(session_id));
    }
    let snapshots = store.load_request_snapshots(session_id, 0, i64::MAX).await?;
    let Some((_, view)) = reconstruct_request_view(&snapshots, request_seq) else {
        return Err(CommandError::invalid_argument(format!(
            "请求边界 {request_seq} 不可重建（快照链缺失或不完整），拒绝回滚"
        )));
    };
    let payload = serde_json::json!({ "request_seq": request_seq }).to_string();
    let mark = store.begin_branch_op("rewind", session_id, Some(&payload)).await?;
    let replace = store.replace_messages(session_id, &view).await?;
    store.finish_branch_op(&mark).await?;
    Ok(RewindOutcome { target_seq: request_seq, view, replace })
}

#[cfg(test)]
#[path = "session_rewind_tests.rs"]
mod tests;
