//! # Agent 会话持久化层
//!
//! 提供 SQLite 持久化的会话存储，支持：
//! - save: 保存或更新会话（id, title, messages, provider_config 等）
//! - load: 加载会话完整数据
//! - list: 列出所有会话摘要
//! - delete: 删除会话
//! - update_title: 仅更新标题
//! - toggle_pin: 切换置顶状态
//!
//! ## 数据库位置
//! 独立的 agent_sessions.db（位于 Tauri app_data_dir 下），
//! 与主项目 db 隔离，避免项目切换时丢失 Agent 会话。
//!
//! ## 并发模型
//! - `Arc<Mutex<Connection>>`: 内部用 std::sync::Mutex 保护 rusqlite::Connection
//! - `spawn_blocking`: 所有同步 IO 包装在 tokio::task::spawn_blocking 中，
//!   避免阻塞异步运行时
//!
//! ## API Key 处理
//! ProviderConfig 的 api_key 字段在序列化时被 skip（`#[serde(skip_serializing)]`），
//! 持久化时不存储。加载会话后由前端重新注入 API Key
//! （通过 `cmd_agent_update_model` 命令）。

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tracing::{debug, info};

use agent_runtime::llm::config::ProviderConfig;
use agent_runtime::types::OrchestratorMessage;

// ─── 错误类型 ────────────────────────────────────────────

#[derive(Debug, thiserror::Error)]
pub enum PersistenceError {
    #[error("rusqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("serde json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("session not found: {0}")]
    NotFound(String),
    #[error("database lock poisoned")]
    Poisoned,
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("task join error: {0}")]
    Join(String),
    #[error("session repository not ready: {0}")]
    NotReady(String),
}

impl serde::Serialize for PersistenceError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

// ─── 数据结构 ────────────────────────────────────────────

/// 会话累计 usage 数据（P1-4 新增）
///
/// 对应前端 `totalUsage` ref 的结构，跨会话恢复时用于显示成本统计。
/// 所有字段可选，向前兼容老会话（未保存 usage 时为 None）。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTotalUsage {
    #[serde(default)]
    pub input_tokens: f64,
    #[serde(default)]
    pub output_tokens: f64,
    #[serde(default)]
    pub cache_read_tokens: f64,
    #[serde(default)]
    pub cache_write_tokens: f64,
    #[serde(default)]
    pub total_cost: f64,
}

/// 会话摘要（列表用，不含消息体）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub message_count: i64,
    pub pinned: bool,
}

/// 会话完整数据（含消息体和 provider 配置）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRecord {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub message_count: i64,
    pub pinned: bool,
    /// Provider 配置（api_key 字段在序列化时被 skip，反序列化后为空字符串）
    pub provider_config: ProviderConfig,
    /// 消息历史（Vec<OrchestratorMessage>）
    pub messages: Vec<OrchestratorMessage>,
    /// 思考级别（可选，off/minimal/low/medium/high/xhigh）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking_level: Option<String>,
    /// 系统提示词（可选）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_prompt: Option<String>,
    /// 累计 usage 数据（P1-4 新增，老会话可能为 None）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_usage: Option<SessionTotalUsage>,
}

/// 保存会话的请求参数
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSessionRequest {
    pub id: String,
    pub title: String,
    pub provider_config: ProviderConfig,
    pub messages: Vec<OrchestratorMessage>,
    #[serde(default)]
    pub thinking_level: Option<String>,
    #[serde(default)]
    pub system_prompt: Option<String>,
    #[serde(default)]
    pub pinned: Option<bool>,
    /// 累计 usage（P1-4 新增，可选）
    #[serde(default)]
    pub total_usage: Option<SessionTotalUsage>,
}

// ─── SessionRepository ────────────────────────────────────────────

/// Agent 会话持久化仓库
///
/// 使用独立的 SQLite 数据库存储会话，与主项目 db 隔离。
/// 通过 `Arc<Mutex<Connection>>` 实现线程安全，
/// 所有同步 IO 包装在 `tokio::task::spawn_blocking` 中避免阻塞异步运行时。
pub struct SessionRepository {
    conn: Arc<Mutex<Connection>>,
}

impl SessionRepository {
    /// 打开或创建指定路径的 SQLite 数据库
    ///
    /// 如果父目录不存在会自动创建。
    pub fn open(db_path: PathBuf) -> Result<Self, PersistenceError> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(db_path)?;
        Self::init_schema(&conn)?;
        info!("SessionRepository 初始化完成");
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

    /// 初始化数据库 schema（幂等）
    ///
    /// # 向前兼容
    /// - 新数据库：CREATE TABLE 直接包含 total_usage 列
    /// - 老数据库（P1-4 之前）：通过 ALTER TABLE 添加 total_usage 列
    ///   使用 PRAGMA table_info 检查字段是否存在，避免重复 ALTER 报错
    fn init_schema(conn: &Connection) -> Result<(), PersistenceError> {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                message_count INTEGER NOT NULL DEFAULT 0,
                pinned INTEGER NOT NULL DEFAULT 0,
                provider_config TEXT NOT NULL,
                messages TEXT NOT NULL,
                thinking_level TEXT,
                system_prompt TEXT,
                total_usage TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_sessions_pinned ON sessions(pinned DESC, updated_at DESC);
            "#,
        )?;

        // 老数据库迁移：若 total_usage 列不存在则添加
        Self::ensure_column(conn, "total_usage", "TEXT")?;

        Ok(())
    }

    /// 检查并添加列（若不存在）
    ///
    /// 用于向前兼容老数据库 schema。使用 PRAGMA table_info 检查字段是否存在。
    fn ensure_column(conn: &Connection, column_name: &str, column_type: &str) -> Result<(), PersistenceError> {
        let mut stmt = conn.prepare(&format!("PRAGMA table_info(sessions)"))?;
        let rows = stmt.query_map([], |row| {
            let name: String = row.get(1)?;
            Ok(name)
        })?;
        let mut exists = false;
        for row in rows {
            if row? == column_name {
                exists = true;
                break;
            }
        }
        if !exists {
            let sql = format!("ALTER TABLE sessions ADD COLUMN {} {}", column_name, column_type);
            conn.execute(&sql, [])?;
            info!(column = column_name, "persistence: 已通过 ALTER TABLE 添加列");
        }
        Ok(())
    }

    /// 保存或更新会话（upsert 语义）
    ///
    /// - 若 session_id 已存在：更新所有字段，保留 created_at
    /// - 若不存在：插入新记录，created_at = 当前时间
    ///
    /// 返回保存后的完整 SessionRecord
    pub async fn save(&self, req: SaveSessionRequest) -> Result<SessionRecord, PersistenceError> {
        let conn = self.conn.clone();
        let result = tokio::task::spawn_blocking(move || -> Result<SessionRecord, PersistenceError> {
            let conn = conn.lock().map_err(|_| PersistenceError::Poisoned)?;

            let now: DateTime<Utc> = Utc::now();
            let now_str = now.to_rfc3339();
            let message_count = req.messages.len() as i64;
            let pinned_int = if req.pinned.unwrap_or(false) { 1 } else { 0 };
            let provider_json = serde_json::to_string(&req.provider_config)?;
            let messages_json = serde_json::to_string(&req.messages)?;
            // total_usage 序列化为 JSON 字符串存储；None 存 NULL
            let total_usage_json: Option<String> = match &req.total_usage {
                Some(u) => Some(serde_json::to_string(u)?),
                None => None,
            };

            // 检查是否存在（决定 created_at 是否保留）
            let existing_created_at: Option<String> = conn
                .query_row(
                    "SELECT created_at FROM sessions WHERE id = ?1",
                    params![req.id],
                    |row| row.get(0),
                )
                .optional()?;

            let created_at = existing_created_at.unwrap_or_else(|| now_str.clone());

            conn.execute(
                r#"
                INSERT INTO sessions (id, title, created_at, updated_at, message_count, pinned, provider_config, messages, thinking_level, system_prompt, total_usage)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
                ON CONFLICT(id) DO UPDATE SET
                    title = excluded.title,
                    updated_at = excluded.updated_at,
                    message_count = excluded.message_count,
                    pinned = excluded.pinned,
                    provider_config = excluded.provider_config,
                    messages = excluded.messages,
                    thinking_level = excluded.thinking_level,
                    system_prompt = excluded.system_prompt,
                    total_usage = excluded.total_usage
                "#,
                params![
                    req.id,
                    req.title,
                    created_at,
                    now_str,
                    message_count,
                    pinned_int,
                    provider_json,
                    messages_json,
                    req.thinking_level,
                    req.system_prompt,
                    total_usage_json,
                ],
            )?;

            debug!(
                "SessionRepository.save: id={} messages={} has_usage={}",
                req.id, message_count, req.total_usage.is_some()
            );

            Ok(SessionRecord {
                id: req.id,
                title: req.title,
                created_at,
                updated_at: now_str,
                message_count,
                pinned: pinned_int != 0,
                provider_config: req.provider_config,
                messages: req.messages,
                thinking_level: req.thinking_level,
                system_prompt: req.system_prompt,
                total_usage: req.total_usage,
            })
        })
        .await
        .map_err(|e| PersistenceError::Join(e.to_string()))??;

        Ok(result)
    }

    /// 加载会话完整数据
    ///
    /// # 错误
    /// - `NotFound`: session_id 不存在
    pub async fn load(&self, session_id: String) -> Result<SessionRecord, PersistenceError> {
        let conn = self.conn.clone();
        let result = tokio::task::spawn_blocking(move || -> Result<SessionRecord, PersistenceError> {
            let conn = conn.lock().map_err(|_| PersistenceError::Poisoned)?;

            let mut stmt = conn.prepare(
                "SELECT id, title, created_at, updated_at, message_count, pinned, provider_config, messages, thinking_level, system_prompt, total_usage FROM sessions WHERE id = ?1"
            )?;

            let record = stmt.query_row(params![session_id], |row| {
                let id: String = row.get(0)?;
                let title: String = row.get(1)?;
                let created_at: String = row.get(2)?;
                let updated_at: String = row.get(3)?;
                let message_count: i64 = row.get(4)?;
                let pinned_int: i64 = row.get(5)?;
                let provider_json: String = row.get(6)?;
                let messages_json: String = row.get(7)?;
                let thinking_level: Option<String> = row.get(8)?;
                let system_prompt: Option<String> = row.get(9)?;
                let total_usage_json: Option<String> = row.get(10)?;

                Ok((
                    id, title, created_at, updated_at, message_count, pinned_int,
                    provider_json, messages_json, thinking_level, system_prompt, total_usage_json,
                ))
            });

            match record {
                Ok((
                    id, title, created_at, updated_at, message_count, pinned_int,
                    provider_json, messages_json, thinking_level, system_prompt, total_usage_json,
                )) => {
                    let provider_config: ProviderConfig = serde_json::from_str(&provider_json)?;
                    let messages: Vec<OrchestratorMessage> = serde_json::from_str(&messages_json)?;
                    // total_usage 反序列化；NULL 或解析失败均为 None（向前兼容老数据）
                    let total_usage: Option<SessionTotalUsage> = match total_usage_json {
                        Some(json) => serde_json::from_str(&json).unwrap_or(None),
                        None => None,
                    };
                    Ok(SessionRecord {
                        id,
                        title,
                        created_at,
                        updated_at,
                        message_count,
                        pinned: pinned_int != 0,
                        provider_config,
                        messages,
                        thinking_level,
                        system_prompt,
                        total_usage,
                    })
                }
                Err(rusqlite::Error::QueryReturnedNoRows) => {
                    Err(PersistenceError::NotFound(session_id))
                }
                Err(e) => Err(e.into()),
            }
        })
        .await
        .map_err(|e| PersistenceError::Join(e.to_string()))??;

        Ok(result)
    }

    /// 列出所有会话摘要（按 pinned DESC, updated_at DESC 排序）
    pub async fn list(&self) -> Result<Vec<SessionSummary>, PersistenceError> {
        let conn = self.conn.clone();
        let result = tokio::task::spawn_blocking(move || -> Result<Vec<SessionSummary>, PersistenceError> {
            let conn = conn.lock().map_err(|_| PersistenceError::Poisoned)?;

            let mut stmt = conn.prepare(
                "SELECT id, title, created_at, updated_at, message_count, pinned FROM sessions ORDER BY pinned DESC, updated_at DESC"
            )?;

            let summaries = stmt.query_map([], |row| {
                let id: String = row.get(0)?;
                let title: String = row.get(1)?;
                let created_at: String = row.get(2)?;
                let updated_at: String = row.get(3)?;
                let message_count: i64 = row.get(4)?;
                let pinned_int: i64 = row.get(5)?;
                Ok(SessionSummary {
                    id,
                    title,
                    created_at,
                    updated_at,
                    message_count,
                    pinned: pinned_int != 0,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

            Ok(summaries)
        })
        .await
        .map_err(|e| PersistenceError::Join(e.to_string()))??;

        Ok(result)
    }

    /// 删除会话
    ///
    /// 返回 true 表示删除成功，false 表示 session_id 不存在
    pub async fn delete(&self, session_id: String) -> Result<bool, PersistenceError> {
        let conn = self.conn.clone();
        let result = tokio::task::spawn_blocking(move || -> Result<bool, PersistenceError> {
            let conn = conn.lock().map_err(|_| PersistenceError::Poisoned)?;
            let affected = conn.execute("DELETE FROM sessions WHERE id = ?1", params![session_id])?;
            Ok(affected > 0)
        })
        .await
        .map_err(|e| PersistenceError::Join(e.to_string()))??;

        Ok(result)
    }

    /// 仅更新标题（保留其他字段）
    pub async fn update_title(
        &self,
        session_id: String,
        title: String,
    ) -> Result<bool, PersistenceError> {
        let conn = self.conn.clone();
        let result = tokio::task::spawn_blocking(move || -> Result<bool, PersistenceError> {
            let conn = conn.lock().map_err(|_| PersistenceError::Poisoned)?;
            let now = Utc::now().to_rfc3339();
            let affected = conn.execute(
                "UPDATE sessions SET title = ?1, updated_at = ?2 WHERE id = ?3",
                params![title, now, session_id],
            )?;
            Ok(affected > 0)
        })
        .await
        .map_err(|e| PersistenceError::Join(e.to_string()))??;

        Ok(result)
    }

    /// 切换 pinned 状态
    pub async fn toggle_pin(
        &self,
        session_id: String,
        pinned: bool,
    ) -> Result<bool, PersistenceError> {
        let conn = self.conn.clone();
        let result = tokio::task::spawn_blocking(move || -> Result<bool, PersistenceError> {
            let conn = conn.lock().map_err(|_| PersistenceError::Poisoned)?;
            let now = Utc::now().to_rfc3339();
            let pinned_int = if pinned { 1 } else { 0 };
            let affected = conn.execute(
                "UPDATE sessions SET pinned = ?1, updated_at = ?2 WHERE id = ?3",
                params![pinned_int, now, session_id],
            )?;
            Ok(affected > 0)
        })
        .await
        .map_err(|e| PersistenceError::Join(e.to_string()))??;

        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use agent_runtime::llm::config::{LocalApiType, ProviderConfig};
    use agent_runtime::types::MessageRole;

    fn make_test_provider() -> ProviderConfig {
        ProviderConfig::Local {
            endpoint: "http://localhost:11434".into(),
            api_type: LocalApiType::Ollama,
            model_id: "llama3".into(),
        }
    }

    #[tokio::test]
    async fn test_save_load_session() {
        let repo = SessionRepository::open_in_memory().unwrap();
        let provider = make_test_provider();
        let req = SaveSessionRequest {
            id: "test-1".into(),
            title: "Test Session".into(),
            provider_config: provider.clone(),
            messages: vec![OrchestratorMessage {
                role: MessageRole::User,
                content: "hello".into(),
                tool_calls: vec![],
                tool_call_id: None,
                meta: None,
            }],
            thinking_level: Some("medium".into()),
            system_prompt: Some("You are a test".into()),
            pinned: Some(true),
            total_usage: None,
        };

        let saved = repo.save(req).await.unwrap();
        assert_eq!(saved.title, "Test Session");
        assert_eq!(saved.message_count, 1);
        assert!(saved.pinned);

        let loaded = repo.load("test-1".into()).await.unwrap();
        assert_eq!(loaded.title, "Test Session");
        assert_eq!(loaded.messages.len(), 1);
        assert_eq!(loaded.messages[0].content, "hello");
        assert!(loaded.pinned);
        assert_eq!(loaded.thinking_level.as_deref(), Some("medium"));
    }

    #[tokio::test]
    async fn test_list_sessions_order() {
        let repo = SessionRepository::open_in_memory().unwrap();
        let provider = make_test_provider();

        for i in 0..3 {
            let req = SaveSessionRequest {
                id: format!("test-{}", i),
                title: format!("Session {}", i),
                provider_config: provider.clone(),
                messages: vec![],
                thinking_level: None,
                system_prompt: None,
                pinned: Some(i == 0),
                total_usage: None,
            };
            repo.save(req).await.unwrap();
            // 短暂延迟确保 updated_at 不同
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }

        let list = repo.list().await.unwrap();
        assert_eq!(list.len(), 3);
        // pinned 优先，test-0 应排在最前
        assert_eq!(list[0].id, "test-0");
        assert!(list[0].pinned);
    }

    #[tokio::test]
    async fn test_delete_session() {
        let repo = SessionRepository::open_in_memory().unwrap();
        let provider = make_test_provider();
        let req = SaveSessionRequest {
            id: "del-1".into(),
            title: "To Delete".into(),
            provider_config: provider,
            messages: vec![],
            thinking_level: None,
            system_prompt: None,
            pinned: None,
            total_usage: None,
        };
        repo.save(req).await.unwrap();

        let deleted = repo.delete("del-1".into()).await.unwrap();
        assert!(deleted);

        let result = repo.load("del-1".into()).await;
        assert!(matches!(result, Err(PersistenceError::NotFound(_))));
    }

    #[tokio::test]
    async fn test_update_title_preserves_created_at() {
        let repo = SessionRepository::open_in_memory().unwrap();
        let provider = make_test_provider();
        let req = SaveSessionRequest {
            id: "upd-1".into(),
            title: "Old Title".into(),
            provider_config: provider,
            messages: vec![],
            thinking_level: None,
            system_prompt: None,
            pinned: None,
            total_usage: None,
        };
        let saved = repo.save(req).await.unwrap();
        let original_created = saved.created_at.clone();

        // 等 10ms 后更新标题
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        repo.update_title("upd-1".into(), "New Title".into()).await.unwrap();

        let loaded = repo.load("upd-1".into()).await.unwrap();
        assert_eq!(loaded.title, "New Title");
        // created_at 应保持不变
        assert_eq!(loaded.created_at, original_created);
        // updated_at 应更新
        assert_ne!(loaded.updated_at, original_created);
    }

    #[tokio::test]
    async fn test_toggle_pin() {
        let repo = SessionRepository::open_in_memory().unwrap();
        let provider = make_test_provider();
        let req = SaveSessionRequest {
            id: "pin-1".into(),
            title: "Pin Test".into(),
            provider_config: provider,
            messages: vec![],
            thinking_level: None,
            system_prompt: None,
            pinned: Some(false),
            total_usage: None,
        };
        repo.save(req).await.unwrap();

        repo.toggle_pin("pin-1".into(), true).await.unwrap();
        let loaded = repo.load("pin-1".into()).await.unwrap();
        assert!(loaded.pinned);

        repo.toggle_pin("pin-1".into(), false).await.unwrap();
        let loaded = repo.load("pin-1".into()).await.unwrap();
        assert!(!loaded.pinned);
    }

    #[tokio::test]
    async fn test_save_load_total_usage() {
        let repo = SessionRepository::open_in_memory().unwrap();
        let provider = make_test_provider();
        let usage = SessionTotalUsage {
            input_tokens: 1500.0,
            output_tokens: 800.0,
            cache_read_tokens: 200.0,
            cache_write_tokens: 100.0,
            total_cost: 0.0234,
        };
        let req = SaveSessionRequest {
            id: "usage-1".into(),
            title: "Usage Test".into(),
            provider_config: provider,
            messages: vec![],
            thinking_level: None,
            system_prompt: None,
            pinned: None,
            total_usage: Some(usage.clone()),
        };
        repo.save(req).await.unwrap();

        let loaded = repo.load("usage-1".into()).await.unwrap();
        let u = loaded.total_usage.expect("total_usage 应存在");
        assert_eq!(u.input_tokens, 1500.0);
        assert_eq!(u.output_tokens, 800.0);
        assert_eq!(u.cache_read_tokens, 200.0);
        assert_eq!(u.cache_write_tokens, 100.0);
        assert!((u.total_cost - 0.0234).abs() < 1e-9);
    }
}
