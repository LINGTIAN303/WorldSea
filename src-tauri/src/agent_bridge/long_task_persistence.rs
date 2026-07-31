//! # 长任务持久化层 — Loop Engineering 批次2
//!
//! 对应 TS 版 `longTaskStore.ts` 的 IndexedDB 持久化，迁移到 SQLite。
//! 与 [`SessionRepository`] 共用 `agent_sessions.db`，新增 `long_tasks` 表。
//!
//! ## 表结构
//! - 标量字段（task_id/task_type/status/时间戳/turn_count 等）独立列，便于 SQL 过滤
//! - 复合字段（checkpoint/meta）存 JSON TEXT
//!
//! ## API
//! - [`LongTaskRepository::save`]: upsert 完整 record（心跳定时器 CheckpointFlush 时调用）
//! - [`LongTaskRepository::load`]: 加载完整 record（断点恢复用）
//! - [`LongTaskRepository::list_running`]: 列出所有 Running 任务（应用启动恢复用）
//! - [`LongTaskRepository::update_heartbeat`]: 轻量心跳更新（仅写 last_heartbeat_at，HeartbeatOnly tick 调用）
//! - [`LongTaskRepository::update_status`]: 轻量状态更新（complete/fail/cancel 时调用）
//! - [`LongTaskRepository::delete`]: 删除任务记录
//!
//! ## 并发模型
//! 复用 `Arc<Mutex<Connection>>` + `tokio::task::spawn_blocking` 模式（与 SessionRepository 一致）。
//!
//! [`SessionRepository`]: super::persistence::SessionRepository

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection};
use tracing::{debug, info};

use agent_runtime::long_task::{
    LongTaskCheckpoint, LongTaskMeta, LongTaskRecord, LongTaskStatus, LongTaskType,
};

// 复用 SessionRepository 的 PersistenceError（NotFound/Sqlite/Json/Poisoned/Join/NotReady）
pub use super::persistence::PersistenceError;

// ─── LongTaskRepository ────────────────────────────────────────────

/// 长任务持久化仓库
///
/// 与 [`SessionRepository`] 共用同一个 SQLite 数据库文件（`agent_sessions.db`），
/// 但持有独立的 `Connection` 实例（SQLite 支持多 Connection 并发访问同一文件）。
///
/// [`SessionRepository`]: super::persistence::SessionRepository
pub struct LongTaskRepository {
    conn: Arc<Mutex<Connection>>,
}

impl LongTaskRepository {
    /// 打开或创建指定路径的 SQLite 数据库
    ///
    /// 与 SessionRepository 共用同一 db 文件，本仓库只负责 `long_tasks` 表。
    pub fn open(db_path: PathBuf) -> Result<Self, PersistenceError> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(db_path)?;
        Self::init_schema(&conn)?;
        info!("LongTaskRepository 初始化完成");
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    /// 内存数据库（用于测试）
    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self, PersistenceError> {
        let conn = Connection::open_in_memory()?;
        Self::init_schema(&conn)?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    /// 初始化 long_tasks 表 schema（幂等）
    ///
    /// # 表结构设计
    /// - 标量字段独立列：task_id/task_type/status/时间戳/turn_count/current_tool/current_phase
    /// - 复合字段 JSON：checkpoint/meta
    /// - 索引：status（用于 list_running）/ last_heartbeat_at（用于按时间排序）
    fn init_schema(conn: &Connection) -> Result<(), PersistenceError> {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS long_tasks (
                task_id TEXT PRIMARY KEY,
                task_type TEXT NOT NULL,
                status TEXT NOT NULL,
                started_at TEXT NOT NULL,
                last_heartbeat_at TEXT NOT NULL,
                ended_at TEXT,
                turn_count INTEGER NOT NULL DEFAULT 0,
                current_tool TEXT,
                current_phase TEXT,
                checkpoint TEXT NOT NULL,
                meta TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_long_tasks_status ON long_tasks(status);
            CREATE INDEX IF NOT EXISTS idx_long_tasks_heartbeat ON long_tasks(last_heartbeat_at DESC);
            "#,
        )?;
        Ok(())
    }

    /// 保存或更新长任务（upsert 语义）
    ///
    /// 心跳定时器 `CheckpointFlush` tick 时调用，写入完整 record。
    /// 若 task_id 已存在则覆盖所有字段（保留 started_at 由 record 自带）。
    pub async fn save(&self, record: LongTaskRecord) -> Result<(), PersistenceError> {
        let conn = self.conn.clone();
        tokio::task::spawn_blocking(move || -> Result<(), PersistenceError> {
            let conn = conn.lock().map_err(|_| PersistenceError::Poisoned)?;

            let task_type_str = serde_json::to_string(&record.task_type)?;
            let status_str = serde_json::to_string(&record.status)?;
            let checkpoint_json = serde_json::to_string(&record.checkpoint)?;
            let meta_json = serde_json::to_string(&record.meta)?;
            let started_at_str = record.started_at.to_rfc3339();
            let last_heartbeat_at_str = record.last_heartbeat_at.to_rfc3339();
            let ended_at_str = record.ended_at.map(|t| t.to_rfc3339());

            conn.execute(
                r#"
                INSERT INTO long_tasks (
                    task_id, task_type, status, started_at, last_heartbeat_at, ended_at,
                    turn_count, current_tool, current_phase, checkpoint, meta
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
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
                    meta = excluded.meta
                "#,
                params![
                    record.task_id,
                    task_type_str,
                    status_str,
                    started_at_str,
                    last_heartbeat_at_str,
                    ended_at_str,
                    record.turn_count as i64,
                    record.current_tool,
                    record.current_phase,
                    checkpoint_json,
                    meta_json,
                ],
            )?;

            debug!(
                "LongTaskRepository.save: task_id={} status={} turn_count={}",
                record.task_id, status_str, record.turn_count
            );
            Ok(())
        })
        .await
        .map_err(|e| PersistenceError::Join(e.to_string()))??;
        Ok(())
    }

    /// 加载完整长任务记录
    ///
    /// 断点恢复时调用：应用启动 → `list_running` → 对每个 Running 任务 `load` →
    /// `LongTaskManager::resume_task` → 重建 AgentLoop messages。
    pub async fn load(&self, task_id: String) -> Result<LongTaskRecord, PersistenceError> {
        let conn = self.conn.clone();
        let result = tokio::task::spawn_blocking(
            move || -> Result<LongTaskRecord, PersistenceError> {
                let conn = conn.lock().map_err(|_| PersistenceError::Poisoned)?;

                let row = conn.query_row(
                    "SELECT task_type, status, started_at, last_heartbeat_at, ended_at, \
                     turn_count, current_tool, current_phase, checkpoint, meta \
                     FROM long_tasks WHERE task_id = ?1",
                    params![task_id],
                    |row| {
                        let task_type_str: String = row.get(0)?;
                        let status_str: String = row.get(1)?;
                        let started_at_str: String = row.get(2)?;
                        let last_heartbeat_at_str: String = row.get(3)?;
                        let ended_at_str: Option<String> = row.get(4)?;
                        let turn_count: i64 = row.get(5)?;
                        let current_tool: Option<String> = row.get(6)?;
                        let current_phase: Option<String> = row.get(7)?;
                        let checkpoint_json: String = row.get(8)?;
                        let meta_json: String = row.get(9)?;
                        Ok((
                            task_type_str,
                            status_str,
                            started_at_str,
                            last_heartbeat_at_str,
                            ended_at_str,
                            turn_count,
                            current_tool,
                            current_phase,
                            checkpoint_json,
                            meta_json,
                        ))
                    },
                );

                match row {
                    Ok((
                        task_type_str,
                        status_str,
                        started_at_str,
                        last_heartbeat_at_str,
                        ended_at_str,
                        turn_count,
                        current_tool,
                        current_phase,
                        checkpoint_json,
                        meta_json,
                    )) => {
                        let task_type: LongTaskType = serde_json::from_str(&task_type_str)?;
                        let status: LongTaskStatus = serde_json::from_str(&status_str)?;
                        let started_at = DateTime::parse_from_rfc3339(&started_at_str)
                            .map_err(|e| PersistenceError::NotReady(e.to_string()))?
                            .with_timezone(&Utc);
                        let last_heartbeat_at =
                            DateTime::parse_from_rfc3339(&last_heartbeat_at_str)
                                .map_err(|e| PersistenceError::NotReady(e.to_string()))?
                                .with_timezone(&Utc);
                        let ended_at = match ended_at_str {
                            Some(s) => Some(
                                DateTime::parse_from_rfc3339(&s)
                                    .map_err(|e| PersistenceError::NotReady(e.to_string()))?
                                    .with_timezone(&Utc),
                            ),
                            None => None,
                        };
                        let checkpoint: LongTaskCheckpoint =
                            serde_json::from_str(&checkpoint_json)?;
                        let meta: LongTaskMeta = serde_json::from_str(&meta_json)?;

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
                    Err(rusqlite::Error::QueryReturnedNoRows) => {
                        Err(PersistenceError::NotFound(task_id))
                    }
                    Err(e) => Err(e.into()),
                }
            },
        )
        .await
        .map_err(|e| PersistenceError::Join(e.to_string()))??;

        Ok(result)
    }

    /// 列出所有 Running 任务（应用启动恢复用）
    ///
    /// 返回的 record 含完整 checkpoint，供 `LongTaskManager::resume_task` 重建状态。
    pub async fn list_running(&self) -> Result<Vec<LongTaskRecord>, PersistenceError> {
        self.list_by_status(LongTaskStatus::Running).await
    }

    /// 按状态过滤任务列表
    pub async fn list_by_status(
        &self,
        status: LongTaskStatus,
    ) -> Result<Vec<LongTaskRecord>, PersistenceError> {
        let conn = self.conn.clone();
        let status_str = serde_json::to_string(&status)?;
        let result = tokio::task::spawn_blocking(
            move || -> Result<Vec<LongTaskRecord>, PersistenceError> {
                let conn = conn.lock().map_err(|_| PersistenceError::Poisoned)?;

                let mut stmt = conn.prepare(
                    "SELECT task_id, task_type, status, started_at, last_heartbeat_at, ended_at, \
                     turn_count, current_tool, current_phase, checkpoint, meta \
                     FROM long_tasks WHERE status = ?1 ORDER BY started_at ASC",
                )?;

                let rows = stmt.query_map(params![status_str], |row| {
                    let task_id: String = row.get(0)?;
                    let task_type_str: String = row.get(1)?;
                    let status_str: String = row.get(2)?;
                    let started_at_str: String = row.get(3)?;
                    let last_heartbeat_at_str: String = row.get(4)?;
                    let ended_at_str: Option<String> = row.get(5)?;
                    let turn_count: i64 = row.get(6)?;
                    let current_tool: Option<String> = row.get(7)?;
                    let current_phase: Option<String> = row.get(8)?;
                    let checkpoint_json: String = row.get(9)?;
                    let meta_json: String = row.get(10)?;
                    Ok((
                        task_id,
                        task_type_str,
                        status_str,
                        started_at_str,
                        last_heartbeat_at_str,
                        ended_at_str,
                        turn_count,
                        current_tool,
                        current_phase,
                        checkpoint_json,
                        meta_json,
                    ))
                })?;

                let mut records = Vec::new();
                for row in rows {
                    let (
                        task_id,
                        task_type_str,
                        status_str,
                        started_at_str,
                        last_heartbeat_at_str,
                        ended_at_str,
                        turn_count,
                        current_tool,
                        current_phase,
                        checkpoint_json,
                        meta_json,
                    ) = row?;

                    let task_type: LongTaskType = serde_json::from_str(&task_type_str)?;
                    let status: LongTaskStatus = serde_json::from_str(&status_str)?;
                    let started_at = DateTime::parse_from_rfc3339(&started_at_str)
                        .map_err(|e| PersistenceError::NotReady(e.to_string()))?
                        .with_timezone(&Utc);
                    let last_heartbeat_at =
                        DateTime::parse_from_rfc3339(&last_heartbeat_at_str)
                            .map_err(|e| PersistenceError::NotReady(e.to_string()))?
                            .with_timezone(&Utc);
                    let ended_at = match ended_at_str {
                        Some(s) => Some(
                            DateTime::parse_from_rfc3339(&s)
                                .map_err(|e| PersistenceError::NotReady(e.to_string()))?
                                .with_timezone(&Utc),
                        ),
                        None => None,
                    };
                    let checkpoint: LongTaskCheckpoint =
                        serde_json::from_str(&checkpoint_json)?;
                    let meta: LongTaskMeta = serde_json::from_str(&meta_json)?;

                    records.push(LongTaskRecord {
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
                    });
                }
                Ok(records)
            },
        )
        .await
        .map_err(|e| PersistenceError::Join(e.to_string()))??;

        Ok(result)
    }

    /// 列出所有长任务（按 started_at DESC 排序，最近的在前）
    pub async fn list_all(&self) -> Result<Vec<LongTaskRecord>, PersistenceError> {
        let conn = self.conn.clone();
        let result = tokio::task::spawn_blocking(
            move || -> Result<Vec<LongTaskRecord>, PersistenceError> {
                let conn = conn.lock().map_err(|_| PersistenceError::Poisoned)?;

                let mut stmt = conn.prepare(
                    "SELECT task_id, task_type, status, started_at, last_heartbeat_at, ended_at, \
                     turn_count, current_tool, current_phase, checkpoint, meta \
                     FROM long_tasks ORDER BY started_at DESC",
                )?;

                let rows = stmt.query_map([], |row| {
                    let task_id: String = row.get(0)?;
                    let task_type_str: String = row.get(1)?;
                    let status_str: String = row.get(2)?;
                    let started_at_str: String = row.get(3)?;
                    let last_heartbeat_at_str: String = row.get(4)?;
                    let ended_at_str: Option<String> = row.get(5)?;
                    let turn_count: i64 = row.get(6)?;
                    let current_tool: Option<String> = row.get(7)?;
                    let current_phase: Option<String> = row.get(8)?;
                    let checkpoint_json: String = row.get(9)?;
                    let meta_json: String = row.get(10)?;
                    Ok((
                        task_id,
                        task_type_str,
                        status_str,
                        started_at_str,
                        last_heartbeat_at_str,
                        ended_at_str,
                        turn_count,
                        current_tool,
                        current_phase,
                        checkpoint_json,
                        meta_json,
                    ))
                })?;

                let mut records = Vec::new();
                for row in rows {
                    let (
                        task_id,
                        task_type_str,
                        status_str,
                        started_at_str,
                        last_heartbeat_at_str,
                        ended_at_str,
                        turn_count,
                        current_tool,
                        current_phase,
                        checkpoint_json,
                        meta_json,
                    ) = row?;

                    let task_type: LongTaskType = serde_json::from_str(&task_type_str)?;
                    let status: LongTaskStatus = serde_json::from_str(&status_str)?;
                    let started_at = DateTime::parse_from_rfc3339(&started_at_str)
                        .map_err(|e| PersistenceError::NotReady(e.to_string()))?
                        .with_timezone(&Utc);
                    let last_heartbeat_at =
                        DateTime::parse_from_rfc3339(&last_heartbeat_at_str)
                            .map_err(|e| PersistenceError::NotReady(e.to_string()))?
                            .with_timezone(&Utc);
                    let ended_at = match ended_at_str {
                        Some(s) => Some(
                            DateTime::parse_from_rfc3339(&s)
                                .map_err(|e| PersistenceError::NotReady(e.to_string()))?
                                .with_timezone(&Utc),
                        ),
                        None => None,
                    };
                    let checkpoint: LongTaskCheckpoint =
                        serde_json::from_str(&checkpoint_json)?;
                    let meta: LongTaskMeta = serde_json::from_str(&meta_json)?;

                    records.push(LongTaskRecord {
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
                    });
                }
                Ok(records)
            },
        )
        .await
        .map_err(|e| PersistenceError::Join(e.to_string()))??;

        Ok(result)
    }

    /// 轻量心跳更新（仅写 last_heartbeat_at）
    ///
    /// 心跳定时器 `HeartbeatOnly` tick 时调用，避免全量 save 的 JSON 序列化开销。
    /// 返回 true 表示更新成功，false 表示 task_id 不存在。
    pub async fn update_heartbeat(
        &self,
        task_id: String,
        last_heartbeat_at: DateTime<Utc>,
    ) -> Result<bool, PersistenceError> {
        let conn = self.conn.clone();
        let result = tokio::task::spawn_blocking(move || -> Result<bool, PersistenceError> {
            let conn = conn.lock().map_err(|_| PersistenceError::Poisoned)?;
            let last_heartbeat_at_str = last_heartbeat_at.to_rfc3339();
            let affected = conn.execute(
                "UPDATE long_tasks SET last_heartbeat_at = ?1 WHERE task_id = ?2",
                params![last_heartbeat_at_str, task_id],
            )?;
            Ok(affected > 0)
        })
        .await
        .map_err(|e| PersistenceError::Join(e.to_string()))??;

        Ok(result)
    }

    /// 轻量状态更新（complete/fail/cancel 时调用）
    ///
    /// 仅更新 status + ended_at，不触碰 checkpoint/meta（避免 JSON 序列化开销）。
    /// 返回 true 表示更新成功，false 表示 task_id 不存在。
    pub async fn update_status(
        &self,
        task_id: String,
        status: LongTaskStatus,
        ended_at: DateTime<Utc>,
    ) -> Result<bool, PersistenceError> {
        let conn = self.conn.clone();
        let status_str = serde_json::to_string(&status)?;
        let result = tokio::task::spawn_blocking(move || -> Result<bool, PersistenceError> {
            let conn = conn.lock().map_err(|_| PersistenceError::Poisoned)?;
            let ended_at_str = ended_at.to_rfc3339();
            let affected = conn.execute(
                "UPDATE long_tasks SET status = ?1, ended_at = ?2 WHERE task_id = ?3",
                params![status_str, ended_at_str, task_id],
            )?;
            Ok(affected > 0)
        })
        .await
        .map_err(|e| PersistenceError::Join(e.to_string()))??;

        Ok(result)
    }

    /// 删除长任务记录
    ///
    /// 返回 true 表示删除成功，false 表示 task_id 不存在。
    pub async fn delete(&self, task_id: String) -> Result<bool, PersistenceError> {
        let conn = self.conn.clone();
        let result = tokio::task::spawn_blocking(move || -> Result<bool, PersistenceError> {
            let conn = conn.lock().map_err(|_| PersistenceError::Poisoned)?;
            let affected = conn.execute("DELETE FROM long_tasks WHERE task_id = ?1", params![task_id])?;
            Ok(affected > 0)
        })
        .await
        .map_err(|e| PersistenceError::Join(e.to_string()))??;

        Ok(result)
    }

    /// 清理已结束任务（completed/failed/cancelled）
    ///
    /// 用于定期清理历史任务，保留最近 N 天的记录。
    /// 返回删除的行数。
    pub async fn cleanup_finished_before(
        &self,
        before: DateTime<Utc>,
    ) -> Result<u64, PersistenceError> {
        let conn = self.conn.clone();
        let result = tokio::task::spawn_blocking(move || -> Result<u64, PersistenceError> {
            let conn = conn.lock().map_err(|_| PersistenceError::Poisoned)?;
            let before_str = before.to_rfc3339();
            let affected = conn.execute(
                "DELETE FROM long_tasks \
                 WHERE status IN ('\"completed\"', '\"failed\"', '\"cancelled\"') \
                 AND ended_at IS NOT NULL AND ended_at < ?1",
                params![before_str],
            )?;
            Ok(affected as u64)
        })
        .await
        .map_err(|e| PersistenceError::Join(e.to_string()))??;

        if result > 0 {
            info!("LongTaskRepository.cleanup_finished_before: 清理 {} 条历史任务", result);
        } else {
            debug!("LongTaskRepository.cleanup_finished_before: 无历史任务需清理");
        }
        Ok(result)
    }
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
    async fn test_save_load_roundtrip() {
        let repo = LongTaskRepository::open_in_memory().unwrap();
        let record = make_test_record("task-1");
        repo.save(record.clone()).await.unwrap();

        let loaded = repo.load("task-1".into()).await.unwrap();
        assert_eq!(loaded.task_id, "task-1");
        assert_eq!(loaded.task_type, LongTaskType::MainAgent);
        assert_eq!(loaded.status, LongTaskStatus::Running);
        assert_eq!(loaded.meta.prompt, "test prompt");
        assert_eq!(loaded.checkpoint.last_user_text, "test prompt");
        assert_eq!(loaded.checkpoint.agent_messages.len(), 1);
    }

    #[tokio::test]
    async fn test_save_upsert_preserves_task_id() {
        let repo = LongTaskRepository::open_in_memory().unwrap();
        let mut record = make_test_record("task-2");
        record.turn_count = 1;
        repo.save(record.clone()).await.unwrap();

        // 第二次 save：更新 turn_count
        let mut updated = record.clone();
        updated.turn_count = 5;
        updated.current_tool = Some("echo".into());
        repo.save(updated).await.unwrap();

        let loaded = repo.load("task-2".into()).await.unwrap();
        assert_eq!(loaded.turn_count, 5);
        assert_eq!(loaded.current_tool.as_deref(), Some("echo"));
    }

    #[tokio::test]
    async fn test_load_not_found() {
        let repo = LongTaskRepository::open_in_memory().unwrap();
        let result = repo.load("nonexistent".into()).await;
        assert!(matches!(result, Err(PersistenceError::NotFound(_))));
    }

    #[tokio::test]
    async fn test_list_running_filters_by_status() {
        let repo = LongTaskRepository::open_in_memory().unwrap();

        // 2 个 running + 1 个 completed
        let r1 = make_test_record("running-1");
        repo.save(r1).await.unwrap();

        let r2 = make_test_record("running-2");
        repo.save(r2).await.unwrap();

        let mut r3 = make_test_record("completed-1");
        r3.status = LongTaskStatus::Completed;
        r3.ended_at = Some(Utc::now());
        repo.save(r3).await.unwrap();

        let running = repo.list_running().await.unwrap();
        assert_eq!(running.len(), 2);
        for r in &running {
            assert_eq!(r.status, LongTaskStatus::Running);
        }
    }

    #[tokio::test]
    async fn test_update_heartbeat_lightweight() {
        let repo = LongTaskRepository::open_in_memory().unwrap();
        let record = make_test_record("hb-1");
        repo.save(record).await.unwrap();

        let new_hb = Utc::now() + chrono::Duration::seconds(60);
        let ok = repo.update_heartbeat("hb-1".into(), new_hb).await.unwrap();
        assert!(ok);

        let loaded = repo.load("hb-1".into()).await.unwrap();
        // 比较 timestamp（RFC3339 序列化可能有微小精度损失，用秒级比较）
        assert_eq!(loaded.last_heartbeat_at.timestamp(), new_hb.timestamp());
    }

    #[tokio::test]
    async fn test_update_status_lightweight() {
        let repo = LongTaskRepository::open_in_memory().unwrap();
        let record = make_test_record("status-1");
        repo.save(record).await.unwrap();

        let ended_at = Utc::now();
        let ok = repo
            .update_status("status-1".into(), LongTaskStatus::Completed, ended_at)
            .await
            .unwrap();
        assert!(ok);

        let loaded = repo.load("status-1".into()).await.unwrap();
        assert_eq!(loaded.status, LongTaskStatus::Completed);
        assert!(loaded.ended_at.is_some());
        assert_eq!(loaded.ended_at.unwrap().timestamp(), ended_at.timestamp());
        // checkpoint/meta 应保持不变
        assert_eq!(loaded.meta.prompt, "test prompt");
    }

    #[tokio::test]
    async fn test_delete_task() {
        let repo = LongTaskRepository::open_in_memory().unwrap();
        let record = make_test_record("del-1");
        repo.save(record).await.unwrap();

        let ok = repo.delete("del-1".into()).await.unwrap();
        assert!(ok);

        let result = repo.load("del-1".into()).await;
        assert!(matches!(result, Err(PersistenceError::NotFound(_))));
    }

    #[tokio::test]
    async fn test_cleanup_finished_before() {
        let repo = LongTaskRepository::open_in_memory().unwrap();

        // 1 个 old completed（应被清理）
        let mut old = make_test_record("old-completed");
        old.status = LongTaskStatus::Completed;
        old.ended_at = Some(Utc::now() - chrono::Duration::days(10));
        repo.save(old).await.unwrap();

        // 1 个 recent completed（应保留）
        let mut recent = make_test_record("recent-completed");
        recent.status = LongTaskStatus::Completed;
        recent.ended_at = Some(Utc::now() - chrono::Duration::hours(1));
        repo.save(recent).await.unwrap();

        // 1 个 running（应保留，即使 started_at 很久以前）
        let running = make_test_record("running-keep");
        repo.save(running).await.unwrap();

        let cutoff = Utc::now() - chrono::Duration::days(1);
        let deleted = repo.cleanup_finished_before(cutoff).await.unwrap();
        assert_eq!(deleted, 1);

        let remaining = repo.list_all().await.unwrap();
        assert_eq!(remaining.len(), 2);
    }
}
