//! 会话分叉执行链（S3-c）
//!
//! 设计依据：`docs/plans/2026-09-21-ZCode能力内化方向探究/04-会话模型草案.md`（§2.3/2.6）。
//!
//! - **锚点 = 请求边界**：子会话初始视图 = 父会话在 `request_seq` 派发时的消息视图
//!   （含该请求输入、不含其响应及之后）——由请求快照重建链给出（08 重建链，零新游标）。
//! - **父会话零影响**：父侧唯写入是操作 mark 的短暂存在（成功即清，见下）。
//! - **事务括号**（沿用压缩锁范式）：先落 mark（payload 携带子会话 id）→ 建子会话
//!   （头 + 视图 + 分叉记录）→ 清 mark。任一步失败 mark **故意保留**——装载期
//!   [`crate::session_branch`] 收敛入口据此撤销半成品子会话（未清 mark ⇔ 未提交）。
//! - 不携带工具会话 / 长任务状态（ZD1-5：首批最小面）。
//! 详细见 docs/details/注释/agent-commands/session_store.md（会话族总览 §四）。

use agent_runtime::types::OrchestratorMessage;

use crate::session_branch::SessionForkRecord;
use crate::session_store::{
    reconstruct_request_view, SessionRecord, SessionRepository, SqliteSessionRepository,
};
use crate::CommandError;

/// 分叉结果：子会话头 + 边界视图 + 分叉来源记录
#[derive(Debug, Clone)]
pub struct ForkOutcome {
    /// 子会话头（已落库）
    pub child: SessionRecord,
    /// 子会话初始视图（= 父会话 `request_seq` 边界的消息视图）
    pub view: Vec<OrchestratorMessage>,
    /// 分叉来源记录（`forked_from = { session_id, request_seq }`）
    pub fork: SessionForkRecord,
}

/// 从请求边界分叉会话（端到端执行链；子会话独立追写）。
///
/// 拒绝条件（fail-closed，宁可说"不可重建"也不给错误视图）：父会话不存在 /
/// 快照链缺该序号或不完整。拒绝发生在落 mark 之前——不产生任何残留。
///
/// 入口：`SessionRepository::fork_session`（trait 委托；服务层经 dyn 调用）。
pub(crate) async fn fork_session(
    store: &SqliteSessionRepository,
    parent_id: &str,
    request_seq: i64,
) -> Result<ForkOutcome, CommandError> {
        let parent = store
            .load_sessions()
            .await?
            .into_iter()
            .find(|r| r.id == parent_id)
            .ok_or_else(|| CommandError::session_not_found(parent_id))?;
    let snapshots = store.load_request_snapshots(parent_id, 0, i64::MAX).await?;
        let Some((_, view)) = reconstruct_request_view(&snapshots, request_seq) else {
            return Err(CommandError::invalid_argument(format!(
                "请求边界 {request_seq} 不可重建（快照链缺失或不完整），拒绝分叉"
            )));
        };

    // 子会话头：复制装配面（提示词 / 场景 / 工作区 / 项目），不携带工具会话与长任务状态
    let child_id = uuid::Uuid::new_v4().to_string();
    let now = (chrono::Utc::now().timestamp_millis().max(0) / 1000) as u64;
    let child = SessionRecord {
            id: child_id.clone(),
            system_prompt: parent.system_prompt.clone(),
            prompt_sections: parent.prompt_sections.clone(),
            created_at: now,
            message_count: view.len() as u32,
            updated_at: now,
            title: parent.title.clone(),
            pinned: false,
            kind: parent.kind,
            workdir: parent.workdir.clone(),
            workspace_id: parent.workspace_id.clone(),
            project_id: parent.project_id.clone(),
            scene_id: parent.scene_id.clone(),
        };
    // 事务括号左端：payload 携带子会话 id（装载期收敛按它撤销半成品）
    let payload = serde_json::json!({
        "child_session_id": child_id,
        "request_seq": request_seq,
    })
    .to_string();
    let mark = store.begin_branch_op("fork", parent_id, Some(&payload)).await?;
    store.save_session(&child).await?;
    store.replace_messages(&child_id, &view).await?;
    store.record_fork(&child_id, parent_id, request_seq).await?;
    // 括号右端：清 mark 即提交点（此前任一步失败 → mark 留存 → 装载期撤销）
    store.finish_branch_op(&mark).await?;

    let fork = store.read_fork(&child_id).await?.ok_or_else(|| {
            CommandError::Internal("分叉记录写入后读取为空（不应发生）".into())
    })?;
    Ok(ForkOutcome { child, view, fork })
}

#[cfg(test)]
#[path = "session_fork_tests.rs"]
mod tests;
