//! 请求边界列表（UX-a 前端接线）
//!
//! 背景：分叉 / 回滚命令（S3-e2）的锚点 = `request_seq`，但前端此前**不可达**
//! （turnModel 无 seq 字段、无查询命令——[14-前端UX批施工计划] §一 G1）。
//! 本模块提供**轻量边界列表**（历史抽屉时间轴 + 消息行匹配）：
//! 只出 UI 所需字段、**不带快照本体**——`snapshot_json` 在写入时已摘除
//! `system_prompt` / `tools_json`（去重池还原），这里仅解析出「视图内最后一条
//! User 消息」摘要。
//!
//! 设计依据：[14-前端UX批施工计划] §二 UX-a（Q1 双入口：行内匹配用 `user_text`、
//! 抽屉总览用全字段）。

use agent_runtime::agent::request_snapshot::{RequestSnapshot, ViewUpdate};
use agent_runtime::types::MessageRole;

use crate::session_store::{SessionRepository, SqliteSessionRepository};
use crate::CommandError;

/// 用户消息摘要长度上限（字符）
pub const USER_TEXT_PREVIEW_CHARS: usize = 120;

/// 请求边界 UI 视图（serde camelCase：跨 IPC 边界）
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestBoundaryDto {
    /// 会话内请求序号（分叉 / 回滚锚点）
    pub request_seq: i64,
    /// 采集时点（Unix 毫秒）
    pub captured_at_ms: i64,
    /// 调用用途（`main` / `compaction` / 其他旁路标签）
    pub purpose: String,
    /// 模型 id（展示用）
    pub model_id: String,
    /// 该边界的用户消息摘要（快照视图内最后一条 User 消息，截断见 [`USER_TEXT_PREVIEW_CHARS`]）
    pub user_text: Option<String>,
    /// 该边界上的检查点 id（同 seq 多检查点取最新；无 → None）
    pub checkpoint_id: Option<String>,
    /// 检查点种类（`manual` / `auto`；无检查点 → None）
    pub checkpoint_kind: Option<String>,
}

/// 从瘦身快照 JSON 提取「视图内最后一条 User 消息」摘要。
///
/// 解析失败 / 无 User 消息 / 内容为空 → `None`（UI 侧按「无可匹配文本」处理——
/// 消息行入口不显示，**绝不猜锚点**）。
pub(crate) fn extract_user_text(snapshot_json: &str) -> Option<String> {
    let snapshot: RequestSnapshot = serde_json::from_str(snapshot_json).ok()?;
    let messages = match &snapshot.view_update {
        ViewUpdate::Appended { messages } | ViewUpdate::Full { messages } => messages,
    };
    let text = messages
        .iter()
        .rev()
        .find(|m| m.role == MessageRole::User)?
        .content
        .trim();
    if text.is_empty() {
        return None;
    }
    Some(text.chars().take(USER_TEXT_PREVIEW_CHARS).collect())
}

/// 边界列表（降序；`limit <= 0` 不截断）——查询入口（service 层调用点）。
pub async fn list_request_boundaries(
    store: &dyn SessionRepository,
    session_id: &str,
    limit: i64,
) -> Result<Vec<RequestBoundaryDto>, CommandError> {
    store.recent_request_boundaries(session_id, limit).await
}

/// SQLite 实现（`SessionRepository::recent_request_boundaries` 委托目标）。
///
/// 检查点标注取**同 seq 最新一条**（手动 / 自动可同 seq 并存；两次子查询各取
/// id / kind，保证行数 1:1——不用 JOIN 避免一个边界出多行）。
pub(crate) async fn recent_boundaries(
    store: &SqliteSessionRepository,
    session_id: &str,
    limit: i64,
) -> Result<Vec<RequestBoundaryDto>, CommandError> {
    let rows = sqlx::query_as::<_, (i64, i64, String, String, String, Option<String>, Option<String>)>(
        "SELECT s.request_seq, s.captured_at_ms, s.purpose, s.model_id, s.snapshot_json, \
         (SELECT c.id FROM session_checkpoints c WHERE c.session_id = s.session_id \
          AND c.request_seq = s.request_seq ORDER BY c.created_at DESC LIMIT 1), \
         (SELECT c.kind FROM session_checkpoints c WHERE c.session_id = s.session_id \
          AND c.request_seq = s.request_seq ORDER BY c.created_at DESC LIMIT 1) \
         FROM request_snapshots s WHERE s.session_id = ?1 \
         ORDER BY s.request_seq DESC LIMIT ?2",
    )
    .bind(session_id)
    .bind(if limit > 0 { limit } else { -1_i64 })
    .fetch_all(&store.pool)
    .await
    .map_err(|e| CommandError::Internal(format!("读取请求边界列表失败: {e}")))?;

    Ok(rows
        .into_iter()
        .map(
            |(request_seq, captured_at_ms, purpose, model_id, snapshot_json, checkpoint_id, checkpoint_kind)| {
                RequestBoundaryDto {
                    request_seq,
                    captured_at_ms,
                    purpose,
                    model_id,
                    user_text: extract_user_text(&snapshot_json),
                    checkpoint_id,
                    checkpoint_kind,
                }
            },
        )
        .collect())
}

#[cfg(test)]
#[path = "session_boundaries_tests.rs"]
mod tests;
