//! # 长任务持久化（SQLite）
//!
//! 端分离迁移前位于 `src-tauri/src/agent_bridge/long_task_persistence.rs`，
//! 迁移后按架构约定落到本 crate。对应 TS 版 `longTaskStore.ts` 的 IndexedDB
//! 持久化，改为 SQLite（sqlx，与 [`crate::subagent_store`] 同一套持久化基建）。
//!
//! ## 表结构
//! - 标量字段（task_id / task_type / status / 时间戳 / turn_count 等）独立列，
//!   便于 SQL 过滤（`list_running` 按 status 过滤）
//! - 复合字段（checkpoint / meta）存 JSON TEXT
//!
//! ## API
//! - [`LongTaskRepository::save`]：upsert 完整 record（心跳定时器 CheckpointFlush 时调用）
//! - [`LongTaskRepository::load`]：加载完整 record（断点恢复用）
//! - [`LongTaskRepository::list_running`]：列出所有 Running 任务（应用启动恢复用）
//! - [`LongTaskRepository::list_all`]：列出所有长任务（按 started_at DESC）
//! - [`LongTaskRepository::update_heartbeat`]：轻量心跳更新（HeartbeatOnly tick 调用）
//! - [`LongTaskRepository::update_status`]：轻量状态更新（complete/fail/cancel 时调用）
//! - [`LongTaskRepository::delete`]：删除任务记录

use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::{Row, SqlitePool};

use agent_runtime::long_task::{
    LongTaskCheckpoint, LongTaskMeta, LongTaskRecord, LongTaskStatus, LongTaskType,
};

use crate::CommandError;

/// 长任务持久化仓库
///
/// 独立数据库文件（`long_tasks.db`），单表 `long_tasks`。
/// `SqlitePool` 可 Clone，直接以 `State<LongTaskRepository>` 供 Tauri manage。
pub struct LongTaskRepository {
    pool: SqlitePool,
}

/// 枚举的 serde 字符串表示（`"main-agent"` / `"running"` 等，无引号）
///
/// `LongTaskType`/`LongTaskStatus` 均 derive Serialize，但 `serde_json::to_string`
/// 会给字符串加引号。这里取 `to_value` 的字符串值作为 SQL 列存储值，
/// 便于 `WHERE status = ?` 直接过滤。
fn serde_str<T: Serialize>(v: &T) -> String {
    serde_json::to_value(v)
        .ok()
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_default()
}

/// 从存储字符串解析枚举
fn parse_type(s: &str) -> Result<LongTaskType, CommandError> {
    serde_json::from_str(&format!("\"{s}\""))
        .map_err(|e| CommandError::Internal(format!("解析任务类型失败: {e}")))
}

fn parse_status(s: &str) -> Result<LongTaskStatus, CommandError> {
    serde_json::from_str(&format!("\"{s}\""))
        .map_err(|e| CommandError::Internal(format!("解析任务状态失败: {e}")))
}

impl LongTaskRepository {
    /// 打开（不存在则创建）数据库文件并建表（幂等，可重复调用）
    pub async fn new(path: &str) -> Result<Self, CommandError> {
        let opts = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal);
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(opts)
            .await
            .map_err(|e| CommandError::Internal(format!("打开长任务数据库失败: {e}")))?;
        Self::init(&pool).await?;
        Ok(Self { pool })
    }

    /// 内存数据库（单测用）
    pub async fn new_in_memory() -> Result<Self, CommandError> {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .map_err(|e| CommandError::Internal(format!("打开内存长任务库失败: {e}")))?;
        Self::init(&pool).await?;
        Ok(Self { pool })
    }

    /// 建表（幂等）
    async fn init(pool: &SqlitePool) -> Result<(), CommandError> {
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS long_tasks (
                task_id            TEXT PRIMARY KEY,
                task_type          TEXT NOT NULL,
                status             TEXT NOT NULL,
                started_at         TEXT NOT NULL,
                last_heartbeat_at  TEXT NOT NULL,
                ended_at           TEXT,
                turn_count         INTEGER NOT NULL DEFAULT 0,
                current_tool       TEXT,
                current_phase      TEXT,
                checkpoint         TEXT NOT NULL,
                meta               TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_long_tasks_status ON long_tasks(status);
            CREATE INDEX IF NOT EXISTS idx_long_tasks_heartbeat ON long_tasks(last_heartbeat_at DESC);",
        )
        .execute(pool)
        .await
        .map_err(|e| CommandError::Internal(format!("初始化长任务表失败: {e}")))?;
        Ok(())
    }

    /// 保存或更新长任务（upsert 语义）
    ///
    /// 心跳定时器 `CheckpointFlush` tick 时调用，写入完整 record。
    /// 若 task_id 已存在则覆盖所有字段。
    pub async fn save(&self, record: LongTaskRecord) -> Result<(), CommandError> {
        let checkpoint_json = serde_json::to_string(&record.checkpoint)
            .map_err(|e| CommandError::Internal(format!("序列化 checkpoint 失败: {e}")))?;
        let meta_json = serde_json::to_string(&record.meta)
            .map_err(|e| CommandError::Internal(format!("序列化 meta 失败: {e}")))?;
        let started_at = record.started_at.to_rfc3339();
        let last_heartbeat_at = record.last_heartbeat_at.to_rfc3339();
        let ended_at = record.ended_at.map(|t| t.to_rfc3339());

        sqlx::query(
            "INSERT INTO long_tasks (
                task_id, task_type, status, started_at, last_heartbeat_at, ended_at,
                turn_count, current_tool, current_phase, checkpoint, meta
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
            ON CONFLICT(task_id) DO UPDATE SET
                task_type = excluded.task_type,
                status = excluded.status,
                started_at = excluded.started_at,
                last_heartbeat_at = excluded.last_heartbeat_at,
                ended_at = excluded.ended_at,
                turn_count = excluded.turn_count,
                current_tool = excluded.current_tool,
                current_phase = excluded.current_phase,
                checkpoint = excluded.checkpoint,
                meta = excluded.meta",
        )
        .bind(&record.task_id)
        .bind(serde_str(&record.task_type))
        .bind(serde_str(&record.status))
        .bind(started_at)
        .bind(last_heartbeat_at)
        .bind(ended_at)
        .bind(record.turn_count as i64)
        .bind(&record.current_tool)
        .bind(&record.current_phase)
        .bind(checkpoint_json)
        .bind(meta_json)
        .execute(&self.pool)
        .await
        .map_err(|e| CommandError::Internal(format!("保存长任务失败: {e}")))?;
        Ok(())
    }

    /// 加载完整长任务记录
    ///
    /// 断点恢复时调用：应用启动 → `list_running` → 对每个 Running 任务 `load` →
    /// `LongTaskManager::resume_task` → 重建 AgentLoop messages。
    ///
    /// # 错误
    /// task_id 不存在时返回 [`CommandError::NotFound`]（与 TS 版 `loadTask`
    /// catch 后返回 null 的语义对齐）。
    pub async fn load(&self, task_id: &str) -> Result<LongTaskRecord, CommandError> {
        let row = sqlx::query(
            "SELECT task_id, task_type, status, started_at, last_heartbeat_at, ended_at, \
             turn_count, current_tool, current_phase, checkpoint, meta \
             FROM long_tasks WHERE task_id = ?1",
        )
        .bind(task_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| CommandError::Internal(format!("加载长任务失败: {e}")))?;

        match row {
            Some(row) => Self::row_to_record(row),
            None => Err(CommandError::NotFound(task_id.to_string())),
        }
    }

    /// 列出所有 Running 任务（应用启动恢复用，按 started_at ASC）
    pub async fn list_running(&self) -> Result<Vec<LongTaskRecord>, CommandError> {
        self.list_by_status(LongTaskStatus::Running).await
    }

    /// 列出所有长任务（按 started_at DESC 排序，最近的在前）
    pub async fn list_all(&self) -> Result<Vec<LongTaskRecord>, CommandError> {
        let rows = sqlx::query(
            "SELECT task_id, task_type, status, started_at, last_heartbeat_at, ended_at, \
             turn_count, current_tool, current_phase, checkpoint, meta \
             FROM long_tasks ORDER BY started_at DESC",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| CommandError::Internal(format!("列出长任务失败: {e}")))?;

        rows.into_iter().map(Self::row_to_record).collect()
    }

    /// 轻量心跳更新（仅写 last_heartbeat_at）
    ///
    /// 心跳定时器 `HeartbeatOnly` tick 时调用，避免全量 save 的 JSON 序列化开销。
    /// 返回 true 表示更新成功，false 表示 task_id 不存在（幂等）。
    pub async fn update_heartbeat(
        &self,
        task_id: &str,
        last_heartbeat_at: DateTime<Utc>,
    ) -> Result<bool, CommandError> {
        let res = sqlx::query("UPDATE long_tasks SET last_heartbeat_at = ?1 WHERE task_id = ?2")
            .bind(last_heartbeat_at.to_rfc3339())
            .bind(task_id)
            .execute(&self.pool)
            .await
            .map_err(|e| CommandError::Internal(format!("更新心跳失败: {e}")))?;
        Ok(res.rows_affected() > 0)
    }

    /// 轻量状态更新（complete/fail/cancel 时调用）
    ///
    /// 仅更新 status + ended_at，不触碰 checkpoint/meta（避免 JSON 序列化开销）。
    /// 返回 true 表示更新成功，false 表示 task_id 不存在（幂等）。
    pub async fn update_status(
        &self,
        task_id: &str,
        status: LongTaskStatus,
        ended_at: DateTime<Utc>,
    ) -> Result<bool, CommandError> {
        let res = sqlx::query(
            "UPDATE long_tasks SET status = ?1, ended_at = ?2 WHERE task_id = ?3",
        )
        .bind(serde_str(&status))
        .bind(ended_at.to_rfc3339())
        .bind(task_id)
        .execute(&self.pool)
        .await
        .map_err(|e| CommandError::Internal(format!("更新任务状态失败: {e}")))?;
        Ok(res.rows_affected() > 0)
    }

    /// 删除长任务记录
    ///
    /// 返回 true 表示删除成功，false 表示 task_id 不存在（幂等）。
    pub async fn delete(&self, task_id: &str) -> Result<bool, CommandError> {
        let res = sqlx::query("DELETE FROM long_tasks WHERE task_id = ?1")
            .bind(task_id)
            .execute(&self.pool)
            .await
            .map_err(|e| CommandError::Internal(format!("删除长任务失败: {e}")))?;
        Ok(res.rows_affected() > 0)
    }

    // ── 内部辅助 ────────────────────────────────────────────

    /// 按状态过滤列表（list_running 复用）
    async fn list_by_status(
        &self,
        status: LongTaskStatus,
    ) -> Result<Vec<LongTaskRecord>, CommandError> {
        let rows = sqlx::query(
            "SELECT task_id, task_type, status, started_at, last_heartbeat_at, ended_at, \
             turn_count, current_tool, current_phase, checkpoint, meta \
             FROM long_tasks WHERE status = ?1 ORDER BY started_at ASC",
        )
        .bind(serde_str(&status))
        .fetch_all(&self.pool)
        .await
        .map_err(|e| CommandError::Internal(format!("按状态列出长任务失败: {e}")))?;

        rows.into_iter().map(Self::row_to_record).collect()
    }

    /// 数据库行 → LongTaskRecord
    fn row_to_record(row: sqlx::sqlite::SqliteRow) -> Result<LongTaskRecord, CommandError> {
        let task_id: String = row.get(0);
        let task_type_str: String = row.get(1);
        let status_str: String = row.get(2);
        let started_at_str: String = row.get(3);
        let last_heartbeat_at_str: String = row.get(4);
        let ended_at_str: Option<String> = row.get(5);
        let turn_count: i64 = row.get(6);
        let current_tool: Option<String> = row.get(7);
        let current_phase: Option<String> = row.get(8);
        let checkpoint_json: String = row.get(9);
        let meta_json: String = row.get(10);

        let task_type = parse_type(&task_type_str)?;
        let status = parse_status(&status_str)?;
        let started_at = parse_rfc3339(&started_at_str)?;
        let last_heartbeat_at = parse_rfc3339(&last_heartbeat_at_str)?;
        let ended_at = match ended_at_str {
            Some(s) => Some(parse_rfc3339(&s)?),
            None => None,
        };
        let checkpoint: LongTaskCheckpoint = serde_json::from_str(&checkpoint_json)
            .map_err(|e| CommandError::Internal(format!("解析 checkpoint JSON 失败: {e}")))?;
        let meta: LongTaskMeta = serde_json::from_str(&meta_json)
            .map_err(|e| CommandError::Internal(format!("解析 meta JSON 失败: {e}")))?;

        Ok(LongTaskRecord {
            task_id,
            task_type,
            status,
            started_at,
            last_heartbeat_at,
            ended_at,
            turn_count: turn_count as u32,
            current_tool,
            current_phase,
            checkpoint,
            meta,
        })
    }
}

/// RFC3339 字符串 → DateTime<Utc>
fn parse_rfc3339(s: &str) -> Result<DateTime<Utc>, CommandError> {
    DateTime::parse_from_rfc3339(s)
        .map(|dt| dt.with_timezone(&Utc))
        .map_err(|e| CommandError::Internal(format!("解析时间戳 {s:?} 失败: {e}")))
}

// ─── 测试 ────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use agent_runtime::types::{MessageRole, OrchestratorMessage};

    fn make_test_checkpoint() -> LongTaskCheckpoint {
        LongTaskCheckpoint {
            agent_messages: vec![OrchestratorMessage {
                role: MessageRole::User,
                content: "test".into(),
                tool_calls: vec![],
                tool_call_id: None,
                meta: None,
            }],
            last_user_text: "test prompt".into(),
            skill_names: None,
            chat_mode: None,
            locked_chat_mode: None,
        }
    }

    fn make_test_record(task_id: &str) -> LongTaskRecord {
        LongTaskRecord {
            task_id: task_id.into(),
            task_type: LongTaskType::MainAgent,
            status: LongTaskStatus::Running,
            started_at: Utc::now(),
            last_heartbeat_at: Utc::now(),
            ended_at: None,
            turn_count: 0,
            current_tool: None,
            current_phase: None,
            checkpoint: make_test_checkpoint(),
            meta: LongTaskMeta {
                prompt: "test prompt".into(),
                ..Default::default()
            },
        }
    }

    #[tokio::test]
    async fn save_load_roundtrip() {
        let repo = LongTaskRepository::new_in_memory().await.unwrap();
        let record = make_test_record("task-1");
        repo.save(record.clone()).await.unwrap();

        let loaded = repo.load("task-1").await.unwrap();
        assert_eq!(loaded.task_id, "task-1");
        assert_eq!(loaded.task_type, LongTaskType::MainAgent);
        assert_eq!(loaded.status, LongTaskStatus::Running);
        assert_eq!(loaded.meta.prompt, "test prompt");
        assert_eq!(loaded.checkpoint.last_user_text, "test prompt");
        assert_eq!(loaded.checkpoint.agent_messages.len(), 1);
    }

    #[tokio::test]
    async fn save_upsert_preserves_task_id() {
        let repo = LongTaskRepository::new_in_memory().await.unwrap();
        let mut record = make_test_record("task-2");
        record.turn_count = 1;
        repo.save(record.clone()).await.unwrap();

        let mut updated = record.clone();
        updated.turn_count = 5;
        updated.current_tool = Some("echo".into());
        repo.save(updated).await.unwrap();

        let loaded = repo.load("task-2").await.unwrap();
        assert_eq!(loaded.turn_count, 5);
        assert_eq!(loaded.current_tool.as_deref(), Some("echo"));
    }

    #[tokio::test]
    async fn load_not_found() {
        let repo = LongTaskRepository::new_in_memory().await.unwrap();
        let result = repo.load("nonexistent").await;
        assert!(matches!(result, Err(CommandError::NotFound(_))));
    }

    #[tokio::test]
    async fn list_running_filters_by_status() {
        let repo = LongTaskRepository::new_in_memory().await.unwrap();
        repo.save(make_test_record("running-1")).await.unwrap();
        repo.save(make_test_record("running-2")).await.unwrap();

        let mut completed = make_test_record("completed-1");
        completed.status = LongTaskStatus::Completed;
        completed.ended_at = Some(Utc::now());
        repo.save(completed).await.unwrap();

        let running = repo.list_running().await.unwrap();
        assert_eq!(running.len(), 2);
        assert!(running.iter().all(|r| r.status == LongTaskStatus::Running));
    }

    #[tokio::test]
    async fn update_heartbeat_lightweight() {
        let repo = LongTaskRepository::new_in_memory().await.unwrap();
        repo.save(make_test_record("hb-1")).await.unwrap();

        let new_hb = Utc::now() + chrono::Duration::seconds(60);
        let ok = repo.update_heartbeat("hb-1", new_hb).await.unwrap();
        assert!(ok);

        let loaded = repo.load("hb-1").await.unwrap();
        assert_eq!(loaded.last_heartbeat_at.timestamp(), new_hb.timestamp());
    }

    #[tokio::test]
    async fn update_status_lightweight() {
        let repo = LongTaskRepository::new_in_memory().await.unwrap();
        repo.save(make_test_record("status-1")).await.unwrap();

        let ended_at = Utc::now();
        let ok = repo
            .update_status("status-1", LongTaskStatus::Completed, ended_at)
            .await
            .unwrap();
        assert!(ok);

        let loaded = repo.load("status-1").await.unwrap();
        assert_eq!(loaded.status, LongTaskStatus::Completed);
        assert!(loaded.ended_at.is_some());
        assert_eq!(loaded.ended_at.unwrap().timestamp(), ended_at.timestamp());
        // checkpoint/meta 应保持不变
        assert_eq!(loaded.meta.prompt, "test prompt");
    }

    #[tokio::test]
    async fn delete_task() {
        let repo = LongTaskRepository::new_in_memory().await.unwrap();
        repo.save(make_test_record("del-1")).await.unwrap();

        assert!(repo.delete("del-1").await.unwrap());
        assert!(repo.load("del-1").await.is_err());
    }

    #[tokio::test]
    async fn update_missing_task_is_idempotent_false() {
        let repo = LongTaskRepository::new_in_memory().await.unwrap();
        assert!(!repo.update_heartbeat("nope", Utc::now()).await.unwrap());
        assert!(!repo.delete("nope").await.unwrap());
    }
}
