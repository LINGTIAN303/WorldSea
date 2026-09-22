//! 工作区回滚（W 批 · RewindScope=workspace）
//!
//! 设计依据：[15-工作区回滚批施工计划]（四裁定全按建议）。
//!
//! - **写前快照**：写入类工具（write_file / edit_file / edit_diff）落盘前，经
//!   [`WorkspaceFileOpRecorder`]（kernel `FileOpRecorder` 的按会话实现）把目标文件
//!   现内容存入 `raw_store`（内容寻址），并记一条 `workspace_file_ops`
//!   （归属 = 当前最新请求边界）。
//! - **回滚执行链**：`rewind_workspace` 取 `request_seq >= target` 的 ops **倒序**
//!   逐条撤销（后进先出 → 末态 = 回到该边界派发前的文件状态）：
//!   `before_hash=Some` 写回内容；`None`（当时不存在）删除文件。
//! - **失败不静默**：逐条失败进 [`WorkspaceRewindReport::failed`]（含原因）；
//!   重复回滚同一边界幂等（行保留、重复执行结果相同）。
//!
//! 不做（随批声明）：全工作区快照 / Git 集成 / 三方合并 / terminal 写文件回滚。

use std::path::Path;
use std::sync::Arc;

use async_trait::async_trait;
use sqlx::sqlite::SqlitePool;

use agent_memory::raw_store::RawStore;
use agent_runtime::tool_context::{FileOpRecorder, ToolContext};

use crate::session_store::SessionRepository;
use crate::CommandError;

/// 建表（幂等；由 `SqliteSessionRepository::new` 与测试共用）
pub(crate) async fn ensure_schema(pool: &SqlitePool) -> Result<(), CommandError> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS workspace_file_ops (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id  TEXT NOT NULL,
            request_seq INTEGER NOT NULL,
            path        TEXT NOT NULL,
            before_hash TEXT,
            op          TEXT NOT NULL,
            at_ms       INTEGER NOT NULL,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        )",
    )
    .execute(pool)
    .await
    .map_err(|e| CommandError::Internal(format!("初始化工作区文件操作表失败: {e}")))?;
    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_workspace_file_ops_session
         ON workspace_file_ops(session_id, request_seq)",
    )
    .execute(pool)
    .await
    .map_err(|e| CommandError::Internal(format!("初始化工作区文件操作索引失败: {e}")))?;
    Ok(())
}

/// 文件操作行（**倒序消费**——回滚按后进先出逐条撤销）
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileOp {
    /// 归属请求边界（变更发生时已分配的最新边界；回滚按 `>= target` 过滤）
    pub request_seq: i64,
    /// 文件绝对路径
    pub path: String,
    /// 写入前内容坐标（`None` = 当时不存在 → 回滚删除）
    pub before_hash: Option<String>,
    /// 操作类别（`write` / `edit` / `edit_diff`）
    pub op: String,
    /// 记录时点（Unix 毫秒）
    pub at_ms: i64,
}

/// 回滚失败条目（失败不静默）
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRewindFailure {
    pub path: String,
    pub reason: String,
}

/// 回滚明细报告
#[derive(Debug, Clone, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRewindReport {
    /// 已恢复（before 内容写回）
    pub restored: usize,
    /// 已删除（新建文件回滚）
    pub removed: usize,
    /// 未处理 / 失败清单
    pub failed: Vec<WorkspaceRewindFailure>,
}

// ─── 记录器（装配层按会话构造；契约见 kernel `FileOpRecorder`）────

/// 会话绑定的文件操作记录器
pub struct WorkspaceFileOpRecorder {
    store: Arc<dyn SessionRepository>,
    raw: RawStore,
    session_id: String,
}

impl WorkspaceFileOpRecorder {
    pub fn new(store: Arc<dyn SessionRepository>, raw: RawStore, session_id: impl Into<String>) -> Self {
        Self {
            store,
            raw,
            session_id: session_id.into(),
        }
    }
}

#[async_trait]
impl FileOpRecorder for WorkspaceFileOpRecorder {
    async fn record_before(&self, path: &str, before: Option<&str>, op: &str) {
        // Q4：任何失败仅 warn——增强项不得反噬写入（与「外置失败退回截断」同哲学）
        let before_hash = match before {
            Some(text) => match self.raw.store(text) {
                Some(r) => Some(r.content_hash),
                None => {
                    tracing::warn!(path, "文件快照外置失败（超限/IO）——该次变更将不可回滚");
                    return;
                }
            },
            None => None,
        };
        if let Err(e) = self
            .store
            .record_workspace_op(&self.session_id, path, before_hash.as_deref(), op)
            .await
        {
            tracing::warn!(error = %e, path, "记录工作区文件操作失败（不影响写入）");
        }
    }
}

// ─── 回滚执行链 ────────────────────────────────────────────

/// 把工作区文件回滚到目标请求边界（**含**该边界执行期间产生的变更：撤销 `request_seq >= target`）。
///
/// 前置由调用方保证（运行中拒绝——与服务层 `rewind_session` 守卫同处）；
/// 本函数只触碰 `ops` 记录过的文件（不扫描、不臆测工作区其它文件）。
pub async fn rewind_workspace(
    store: &dyn SessionRepository,
    raw: &RawStore,
    workdir: &Path,
    session_id: &str,
    target_seq: i64,
) -> Result<WorkspaceRewindReport, CommandError> {
    let ops = store.workspace_ops_from(session_id, target_seq).await?; // 倒序（后进先出）
    // 越界守卫：ops.path 若越出工作区（伪造行 / 迁移数据）→ 拒绝恢复（不猜）
    let guard = ToolContext {
        workdir: Some(workdir.to_path_buf()),
        ..Default::default()
    };
    let mut report = WorkspaceRewindReport::default();
    for op in ops {
        if !guard.is_within_workdir(&op.path) {
            report.failed.push(WorkspaceRewindFailure {
                path: op.path,
                reason: "路径越出工作区（拒绝恢复）".into(),
            });
            continue;
        }
        let path = Path::new(&op.path);
        match &op.before_hash {
            Some(hash) => match raw.read(hash) {
                Some(text) => match std::fs::write(path, text.as_bytes()) {
                    Ok(()) => report.restored += 1,
                    Err(e) => report.failed.push(WorkspaceRewindFailure {
                        path: op.path,
                        reason: format!("写回失败: {e}"),
                    }),
                },
                None => report.failed.push(WorkspaceRewindFailure {
                    path: op.path,
                    reason: "快照缺失（原文已不可取回）".into(),
                }),
            },
            // 新建语义：当时不存在 → 删除（已不存在按幂等计成功）
            None => match std::fs::remove_file(path) {
                Ok(()) => report.removed += 1,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => report.removed += 1,
                Err(e) => report.failed.push(WorkspaceRewindFailure {
                    path: op.path,
                    reason: format!("删除失败: {e}"),
                }),
            },
        }
    }
    Ok(report)
}

/// 面板/命令用：某会话的文件操作（降序取最近 `limit` 条；`limit <= 0` 不截断）
pub async fn list_workspace_ops(
    store: &dyn SessionRepository,
    session_id: &str,
    limit: i64,
) -> Result<Vec<WorkspaceFileOp>, CommandError> {
    store.recent_workspace_ops(session_id, limit).await
}

#[cfg(test)]
#[path = "workspace_rewind_tests.rs"]
mod tests;
