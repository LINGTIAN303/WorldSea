//! 会话分叉 / 检查点 / 分支操作 mark（S3-b2）
//!
//! 设计依据：`docs/plans/2026-09-21-ZCode能力内化方向探究/04-会话模型草案.md`（§2.3-2.6）。
//! - **锚点 = 请求边界**（`request_seq`，复用请求快照重建链坐标，不新造游标）
//! - `fork`：新会话记录 `forked_from`，父会话零影响（每会话至多一个来源）
//! - `checkpoint`：手动 + 每 N 请求自动；保留策略由 [`SqliteSessionRepository::prune_checkpoints`] 承担
//! - 操作 mark：**事务括号**——先落 mark、成功清 mark；崩溃残留由装载期
//!   [`SqliteSessionRepository::reconcile_branch_ops`] 收敛（对齐压缩锁范式）
//!
//! 存储与收敛原语（S3-b2）；执行链见 `session_fork.rs` / `session_rewind.rs` /
//! `session_checkpoint.rs`，装载期接线见 `lib.rs::restore_sessions`。
//! 详细见 docs/details/注释/agent-commands/session_store.md（会话族总览 §四）。

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::session_store::SqliteSessionRepository;
use crate::CommandError;

/// 分叉记录：`session_id`（派生出的新会话）为主键——每会话至多一个来源。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionForkRecord {
    /// 派生出的新会话 id
    pub session_id: String,
    /// 源会话 id
    pub forked_from_session: String,
    /// 源会话的请求边界（`request_seq`）
    pub forked_from_seq: i64,
    pub created_at: i64,
}

/// 检查点记录（`kind`：manual / auto）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionCheckpointRecord {
    pub id: String,
    pub session_id: String,
    /// 打点所在的请求边界（`request_seq`）
    pub request_seq: i64,
    pub kind: String,
    pub created_at: i64,
}

/// 分支操作 mark（fork / rewind / checkpoint 三类；崩溃残留由装载期收敛）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionBranchOpRecord {
    pub op_id: String,
    pub op: String,
    pub session_id: String,
    pub payload: Option<String>,
    pub created_at: i64,
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// 建表（幂等）——由 `session_store::init` 在装载期调用（S3-b2）。
pub(crate) async fn ensure_schema(pool: &SqlitePool) -> Result<(), CommandError> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS session_forks (
            session_id          TEXT PRIMARY KEY,
            forked_from_session TEXT NOT NULL,
            forked_from_seq     INTEGER NOT NULL,
            created_at          INTEGER NOT NULL,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        )",
    )
    .execute(pool)
    .await
    .map_err(|e| CommandError::Internal(format!("初始化会话分叉表失败: {e}")))?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS session_checkpoints (
            id          TEXT PRIMARY KEY,
            session_id  TEXT NOT NULL,
            request_seq INTEGER NOT NULL,
            kind        TEXT NOT NULL,
            created_at  INTEGER NOT NULL,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        )",
    )
    .execute(pool)
    .await
    .map_err(|e| CommandError::Internal(format!("初始化检查点表失败: {e}")))?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_session_checkpoints_session
         ON session_checkpoints(session_id, request_seq)",
    )
    .execute(pool)
    .await
    .map_err(|e| CommandError::Internal(format!("初始化检查点索引失败: {e}")))?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS session_branch_ops (
            op_id      TEXT PRIMARY KEY,
            op         TEXT NOT NULL,
            session_id TEXT NOT NULL,
            payload    TEXT,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        )",
    )
    .execute(pool)
    .await
    .map_err(|e| CommandError::Internal(format!("初始化分支操作表失败: {e}")))?;

    Ok(())
}

impl SqliteSessionRepository {
    // ─── fork（分叉） ──────────────────────────────────────────

    /// 记录一次分叉（**幂等**：同 `session_id` 重复写入为 no-op——WAL 重放友好，首写为准）。
    pub async fn record_fork(
        &self,
        session_id: &str,
        forked_from_session: &str,
        forked_from_seq: i64,
    ) -> Result<(), CommandError> {
        sqlx::query(
            "INSERT INTO session_forks (session_id, forked_from_session, forked_from_seq, created_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(session_id) DO NOTHING",
        )
        .bind(session_id)
        .bind(forked_from_session)
        .bind(forked_from_seq)
        .bind(now_ms())
        .execute(&self.pool)
        .await
        .map_err(|e| CommandError::Internal(format!("写入分叉记录失败: {e}")))?;
        Ok(())
    }

    /// 读取会话的分叉来源（非分叉会话为 `None`）。
    pub async fn read_fork(&self, session_id: &str) -> Result<Option<SessionForkRecord>, CommandError> {
        let row = sqlx::query_as::<_, (String, String, i64, i64)>(
            "SELECT session_id, forked_from_session, forked_from_seq, created_at
             FROM session_forks WHERE session_id = ?1",
        )
        .bind(session_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| CommandError::Internal(format!("读取分叉记录失败: {e}")))?;
        Ok(row.map(|(session_id, forked_from_session, forked_from_seq, created_at)| SessionForkRecord {
            session_id,
            forked_from_session,
            forked_from_seq,
            created_at,
        }))
    }

    /// 反查：该会话派生出的全部子会话（按创建序）。
    pub async fn list_forks_of(&self, source_session: &str) -> Result<Vec<SessionForkRecord>, CommandError> {
        let rows = sqlx::query_as::<_, (String, String, i64, i64)>(
            "SELECT session_id, forked_from_session, forked_from_seq, created_at
             FROM session_forks WHERE forked_from_session = ?1 ORDER BY created_at ASC",
        )
        .bind(source_session)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| CommandError::Internal(format!("反查分叉记录失败: {e}")))?;
        Ok(rows
            .into_iter()
            .map(|(session_id, forked_from_session, forked_from_seq, created_at)| SessionForkRecord {
                session_id,
                forked_from_session,
                forked_from_seq,
                created_at,
            })
            .collect())
    }

    // ─── checkpoint（检查点） ─────────────────────────────────

    /// 打一个检查点（返回 id）。`kind`：`manual` / `auto`。
    pub async fn create_checkpoint(
        &self,
        session_id: &str,
        request_seq: i64,
        kind: &str,
    ) -> Result<String, CommandError> {
        let id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO session_checkpoints (id, session_id, request_seq, kind, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
        )
        .bind(&id)
        .bind(session_id)
        .bind(request_seq)
        .bind(kind)
        .bind(now_ms())
        .execute(&self.pool)
        .await
        .map_err(|e| CommandError::Internal(format!("写入检查点失败: {e}")))?;
        Ok(id)
    }

    /// 列出检查点（最新在前，`limit` 截断）。
    pub async fn list_checkpoints(
        &self,
        session_id: &str,
        limit: i64,
    ) -> Result<Vec<SessionCheckpointRecord>, CommandError> {
        let rows = sqlx::query_as::<_, (String, String, i64, String, i64)>(
            "SELECT id, session_id, request_seq, kind, created_at
             FROM session_checkpoints WHERE session_id = ?1
             ORDER BY request_seq DESC, created_at DESC LIMIT ?2",
        )
        .bind(session_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| CommandError::Internal(format!("列出检查点失败: {e}")))?;
        Ok(rows
            .into_iter()
            .map(|(id, session_id, request_seq, kind, created_at)| SessionCheckpointRecord {
                id,
                session_id,
                request_seq,
                kind,
                created_at,
            })
            .collect())
    }

    /// 保留最近 `keep` 个检查点，返回被删除数量（保留策略，ZD1-4 细则）。
    pub async fn prune_checkpoints(&self, session_id: &str, keep: i64) -> Result<u64, CommandError> {
        let result = sqlx::query(
            "DELETE FROM session_checkpoints
             WHERE session_id = ?1
               AND id NOT IN (
                   SELECT id FROM session_checkpoints WHERE session_id = ?1
                   ORDER BY request_seq DESC, created_at DESC LIMIT ?2
               )",
        )
        .bind(session_id)
        .bind(keep)
        .execute(&self.pool)
        .await
        .map_err(|e| CommandError::Internal(format!("清理检查点失败: {e}")))?;
        Ok(result.rows_affected())
    }

    // ─── 操作 mark（事务括号） ────────────────────────────────

    /// 落一个操作 mark（事务括号左端）——返回 `op_id`，成功路径以 [`Self::finish_branch_op`] 清除。
    /// 崩溃残留由装载期 [`Self::reconcile_branch_ops`] 收敛。
    pub async fn begin_branch_op(
        &self,
        op: &str,
        session_id: &str,
        payload: Option<&str>,
    ) -> Result<String, CommandError> {
        let op_id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO session_branch_ops (op_id, op, session_id, payload, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
        )
        .bind(&op_id)
        .bind(op)
        .bind(session_id)
        .bind(payload)
        .bind(now_ms())
        .execute(&self.pool)
        .await
        .map_err(|e| CommandError::Internal(format!("写入操作 mark 失败: {e}")))?;
        Ok(op_id)
    }

    /// 清除操作 mark（事务括号右端；幂等——不存在也为成功）。
    pub async fn finish_branch_op(&self, op_id: &str) -> Result<(), CommandError> {
        sqlx::query("DELETE FROM session_branch_ops WHERE op_id = ?1")
            .bind(op_id)
            .execute(&self.pool)
            .await
            .map_err(|e| CommandError::Internal(format!("清除操作 mark 失败: {e}")))?;
        Ok(())
    }

    /// 装载期收敛：检出并清理该会话的全部残留 mark，返回被检出项（供调用方 warn 留档）。
    /// 保守语义：mark 只在进程存活期间有意义，装载时一律视为崩溃残留并清空。
    /// **只清 mark、不撤销数据**——带撤销的全量入口见 [`reconcile_residue`]。
    pub async fn reconcile_branch_ops(&self, session_id: &str) -> Result<Vec<SessionBranchOpRecord>, CommandError> {
        let rows = sqlx::query_as::<_, (String, String, String, Option<String>, i64)>(
            "SELECT op_id, op, session_id, payload, created_at
             FROM session_branch_ops WHERE session_id = ?1 ORDER BY created_at ASC",
        )
        .bind(session_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| CommandError::Internal(format!("读取操作 mark 失败: {e}")))?;
        if rows.is_empty() {
            return Ok(Vec::new());
        }
        sqlx::query("DELETE FROM session_branch_ops WHERE session_id = ?1")
            .bind(session_id)
            .execute(&self.pool)
            .await
            .map_err(|e| CommandError::Internal(format!("清理操作 mark 失败: {e}")))?;
        Ok(rows
            .into_iter()
            .map(|(op_id, op, session_id, payload, created_at)| SessionBranchOpRecord {
                op_id,
                op,
                session_id,
                payload,
                created_at,
            })
            .collect())
    }
}

/// 装载期检出的一条分支残留（`SessionRepository::reconcile_branch_residue` 返回，供调用方 warn 留档）
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BranchResidue {
    /// 检出并已清除的 mark
    pub op: SessionBranchOpRecord,
    /// fork 残留撤销掉的半成品子会话 id（非 fork / 子会话不存在时为 None）
    pub undone_child: Option<String>,
}

/// 装载期分支残留收敛（S3-c 冷修复；由 `SessionRepository::reconcile_branch_residue` 委托）。
///
/// 语义：**mark 未清 ⇔ 操作未提交**（调用方从未收到成功）——`fork` 残留即撤销半成品
/// 子会话（内容可由父快照重放，删除无信息损失；留存则会成为无来源记录的幽灵会话）；
/// `rewind` / `checkpoint` 残留**不撤销数据**（S3-d 裁定：终态自洽——视图回退无损且可再回滚、
/// 检查点为单行插入，撤销反而引入新风险），只清 mark + warn 留档。收敛幂等。
pub(crate) async fn reconcile_residue(
    store: &SqliteSessionRepository,
) -> Result<Vec<BranchResidue>, CommandError> {
    let rows = sqlx::query_as::<_, (String, String, String, Option<String>, i64)>(
        "SELECT op_id, op, session_id, payload, created_at FROM session_branch_ops ORDER BY created_at ASC",
    )
    .fetch_all(&store.pool)
    .await
    .map_err(|e| CommandError::Internal(format!("读取分支操作残留失败: {e}")))?;
    if rows.is_empty() {
        return Ok(Vec::new());
    }
    let mut out = Vec::with_capacity(rows.len());
    for (op_id, op, session_id, payload, created_at) in rows {
        let mut undone_child = None;
        if op == "fork" {
            if let Some(child) = child_id_of(payload.as_deref()) {
                // 级联清理子会话的日志 / 视图 / 分叉记录（FK ON DELETE CASCADE）；
                // 行不存在 = 崩溃点在建子会话之前，无需撤销
                let deleted = sqlx::query("DELETE FROM sessions WHERE id = ?1")
                    .bind(&child)
                    .execute(&store.pool)
                    .await
                    .map_err(|e| CommandError::Internal(format!("撤销半成品子会话失败: {e}")))?
                    .rows_affected();
                if deleted > 0 {
                    undone_child = Some(child);
                }
            }
        }
        out.push(BranchResidue {
            op: SessionBranchOpRecord { op_id, op, session_id, payload, created_at },
            undone_child,
        });
    }
    sqlx::query("DELETE FROM session_branch_ops")
        .execute(&store.pool)
        .await
        .map_err(|e| CommandError::Internal(format!("清理分支操作残留失败: {e}")))?;
    Ok(out)
}

/// 从 fork mark 的 payload 取子会话 id（坏 payload 视为无子会话，不阻断收敛）
fn child_id_of(payload: Option<&str>) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(payload?).ok()?;
    value.get("child_session_id")?.as_str().map(str::to_string)
}

#[cfg(test)]
#[path = "session_branch_tests.rs"]
mod tests;
