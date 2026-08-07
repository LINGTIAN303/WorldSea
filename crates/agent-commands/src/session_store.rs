//! 会话持久化（SQLite）：可选持久化层，启动加载全部会话重建 AgentLoop、会话变更写穿，详细见 docs/details/注释/agent-commands/session_store.md

use std::sync::Arc;

use agent_runtime::types::OrchestratorMessage;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::SqlitePool;

use crate::CommandError;

/// 会话头记录（列表项 + 重建 AgentLoop 所需）
///
/// `system_prompt` 单独落列，便于启动时按原样重建 AgentLoop 配置；
/// 具体消息内容走 [`messages`] 表，经 [`SessionRepository::load_messages`] 恢复。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SessionRecord {
    pub id: String,
    pub system_prompt: String,
    pub created_at: u64,
    pub message_count: u32,
    pub updated_at: u64,
}

/// 会话持久化存储抽象
///
/// 独立为 trait 便于：单测用内存实现验证业务逻辑，不经真实 DB；真实场景用
/// [`SqliteSessionRepository`]。
#[async_trait::async_trait]
pub trait SessionRepository: Send + Sync {
    /// 写入/覆盖一条会话头（写穿；同名 id 走 upsert）
    async fn save_session(&self, record: &SessionRecord) -> Result<(), CommandError>;
    /// 加载全部会话头（启动时重建 AgentLoop 用）
    async fn load_sessions(&self) -> Result<Vec<SessionRecord>, CommandError>;
    /// 整体替换某会话的消息（写穿；先清该会话旧消息再写入）
    async fn replace_messages(
        &self,
        session_id: &str,
        messages: &[OrchestratorMessage],
    ) -> Result<(), CommandError>;
    /// 加载某会话的全部消息（按 seq 升序）
    async fn load_messages(&self, session_id: &str) -> Result<Vec<OrchestratorMessage>, CommandError>;
    /// 删除会话及其消息（级联）
    async fn delete_session(&self, session_id: &str) -> Result<(), CommandError>;
}

/// SQLite 实现：`sessions` 表存会话头，`messages` 表按会话存消息 JSON 行
pub struct SqliteSessionRepository {
    pool: SqlitePool,
}

impl SqliteSessionRepository {
    /// 打开（不存在则创建）数据库文件并建表（幂等，可重复调用）
    ///
    /// 用 WAL 日志模式：读写不互斥，适合"低频写 + 高频读"的会话列表场景。
    pub async fn new(path: &str) -> Result<Arc<Self>, CommandError> {
        let opts = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal);
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(opts)
            .await
            .map_err(|e| CommandError::Internal(format!("打开会话数据库失败: {e}")))?;
        Self::init(&pool).await?;
        Ok(Arc::new(Self { pool }))
    }

    /// 内存数据库（单测用）
    ///
    /// `sqlite::memory:` 每个连接独立，故限定 `max_connections = 1`，
    /// 保证同一 Pool 内数据跨多次查询可见（模拟"重启后仍能读到"）。
    pub async fn new_in_memory() -> Result<Arc<Self>, CommandError> {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .map_err(|e| CommandError::Internal(format!("打开内存会话库失败: {e}")))?;
        Self::init(&pool).await?;
        Ok(Arc::new(Self { pool }))
    }

    /// 建表（幂等）
    async fn init(pool: &SqlitePool) -> Result<(), CommandError> {
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS sessions (
                id            TEXT PRIMARY KEY,
                system_prompt TEXT NOT NULL,
                created_at    INTEGER NOT NULL,
                message_count INTEGER NOT NULL,
                updated_at    INTEGER NOT NULL
            )",
        )
        .execute(pool)
        .await
        .map_err(|e| CommandError::Internal(format!("初始化会话表失败: {e}")))?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS messages (
                session_id TEXT NOT NULL,
                seq        INTEGER NOT NULL,
                msg_json   TEXT NOT NULL,
                PRIMARY KEY (session_id, seq),
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            )",
        )
        .execute(pool)
        .await
        .map_err(|e| CommandError::Internal(format!("初始化会话消息表失败: {e}")))?;
        Ok(())
    }
}

#[async_trait::async_trait]
impl SessionRepository for SqliteSessionRepository {
    async fn save_session(&self, record: &SessionRecord) -> Result<(), CommandError> {
        sqlx::query(
            "INSERT INTO sessions (id, system_prompt, created_at, message_count, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET
                system_prompt = ?2, created_at = ?3, message_count = ?4, updated_at = ?5",
        )
        .bind(&record.id)
        .bind(&record.system_prompt)
        .bind(record.created_at as i64)
        .bind(record.message_count as i64)
        .bind(record.updated_at as i64)
        .execute(&self.pool)
        .await
        .map_err(|e| CommandError::Internal(format!("写入会话失败: {e}")))?;
        Ok(())
    }

    async fn load_sessions(&self) -> Result<Vec<SessionRecord>, CommandError> {
        let rows: Vec<(String, String, i64, i64, i64)> =
            sqlx::query_as("SELECT id, system_prompt, created_at, message_count, updated_at FROM sessions")
                .fetch_all(&self.pool)
                .await
                .map_err(|e| CommandError::Internal(format!("读取会话列表失败: {e}")))?;
        Ok(rows
            .into_iter()
            .map(|(id, system_prompt, created_at, message_count, updated_at)| SessionRecord {
                id,
                system_prompt,
                created_at: created_at as u64,
                message_count: message_count as u32,
                updated_at: updated_at as u64,
            })
            .collect())
    }

    async fn replace_messages(
        &self,
        session_id: &str,
        messages: &[OrchestratorMessage],
    ) -> Result<(), CommandError> {
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| CommandError::Internal(format!("开启消息事务失败: {e}")))?;

        sqlx::query("DELETE FROM messages WHERE session_id = ?1")
            .bind(session_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| CommandError::Internal(format!("清空旧消息失败: {e}")))?;

        for (seq, msg) in messages.iter().enumerate() {
            let json = serde_json::to_string(msg)
                .map_err(|e| CommandError::Internal(format!("序列化消息失败: {e}")))?;
            sqlx::query("INSERT INTO messages (session_id, seq, msg_json) VALUES (?1, ?2, ?3)")
                .bind(session_id)
                .bind(seq as i64)
                .bind(&json)
                .execute(&mut *tx)
                .await
                .map_err(|e| CommandError::Internal(format!("写入消息失败: {e}")))?;
        }

        tx.commit()
            .await
            .map_err(|e| CommandError::Internal(format!("提交消息事务失败: {e}")))?;
        Ok(())
    }

    async fn load_messages(&self, session_id: &str) -> Result<Vec<OrchestratorMessage>, CommandError> {
        let rows: Vec<(String,)> =
            sqlx::query_as("SELECT msg_json FROM messages WHERE session_id = ?1 ORDER BY seq")
                .bind(session_id)
                .fetch_all(&self.pool)
                .await
                .map_err(|e| CommandError::Internal(format!("读取会话消息失败: {e}")))?;
        let mut messages = Vec::with_capacity(rows.len());
        for (json,) in rows {
            let msg: OrchestratorMessage = serde_json::from_str(&json)
                .map_err(|e| CommandError::Internal(format!("解析会话消息失败: {e}")))?;
            messages.push(msg);
        }
        Ok(messages)
    }

    async fn delete_session(&self, session_id: &str) -> Result<(), CommandError> {
        // messages 表有 ON DELETE CASCADE，删 sessions 行即级联清除消息
        sqlx::query("DELETE FROM sessions WHERE id = ?1")
            .bind(session_id)
            .execute(&self.pool)
            .await
            .map_err(|e| CommandError::Internal(format!("删除会话失败: {e}")))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use agent_runtime::types::MessageRole;

    fn msg(role: MessageRole, content: &str) -> OrchestratorMessage {
        OrchestratorMessage {
            role,
            content: content.into(),
            tool_calls: Vec::new(),
            tool_call_id: None,
            meta: None,
        }
    }

    fn record(id: &str, count: u32) -> SessionRecord {
        SessionRecord {
            id: id.into(),
            system_prompt: format!("系统提示 {id}"),
            created_at: 100,
            message_count: count,
            updated_at: 100,
        }
    }

    #[tokio::test]
    async fn save_load_roundtrip() {
        let store = SqliteSessionRepository::new_in_memory().await.unwrap();
        assert!(store.load_sessions().await.unwrap().is_empty());

        store.save_session(&record("s1", 0)).await.unwrap();
        store.save_session(&record("s2", 0)).await.unwrap();
        let all = store.load_sessions().await.unwrap();
        assert_eq!(all.len(), 2);
        assert!(all.iter().any(|r| r.id == "s1"));

        // 同名 id 覆盖不产生重复
        let mut r = record("s1", 3);
        r.updated_at = 200;
        store.save_session(&r).await.unwrap();
        let all = store.load_sessions().await.unwrap();
        assert_eq!(all.len(), 2);
        assert!(all.iter().any(|x| x.id == "s1" && x.message_count == 3));
    }

    #[tokio::test]
    async fn replace_messages_roundtrip() {
        let store = SqliteSessionRepository::new_in_memory().await.unwrap();
        store.save_session(&record("s1", 2)).await.unwrap();

        let messages = vec![
            msg(MessageRole::User, "你好"),
            msg(MessageRole::Assistant, "你好！"),
        ];
        store.replace_messages("s1", &messages).await.unwrap();
        let loaded = store.load_messages("s1").await.unwrap();
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].content, "你好");
        assert_eq!(loaded[1].role, MessageRole::Assistant);

        // 整体替换：先清旧再写新
        store.replace_messages("s1", &messages[..1]).await.unwrap();
        let loaded = store.load_messages("s1").await.unwrap();
        assert_eq!(loaded.len(), 1, "替换后应只剩新列表");
    }

    #[tokio::test]
    async fn delete_cascades_messages() {
        let store = SqliteSessionRepository::new_in_memory().await.unwrap();
        store.save_session(&record("s1", 1)).await.unwrap();
        store
            .replace_messages("s1", &[msg(MessageRole::User, "hi")])
            .await
            .unwrap();

        store.delete_session("s1").await.unwrap();
        assert!(store.load_sessions().await.unwrap().is_empty());
        assert!(store.load_messages("s1").await.unwrap().is_empty(), "级联删除消息");
    }

    #[tokio::test]
    async fn persists_across_restart() {
        // 用临时文件模拟真实数据库；drop 掉旧 store（关闭连接池）后新建，
        // 模拟"应用重启"——数据应仍可加载。
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("sessions.db");
        let path = db_path.to_str().unwrap().to_string();

        {
            let store = SqliteSessionRepository::new(&path).await.unwrap();
            store.save_session(&record("s1", 1)).await.unwrap();
            store
                .replace_messages("s1", &[msg(MessageRole::User, "hi")])
                .await
                .unwrap();
        } // drop store → 连接池关闭

        let store = SqliteSessionRepository::new(&path).await.unwrap();
        let all = store.load_sessions().await.unwrap();
        assert_eq!(all.len(), 1, "重启后应能加载已持久化的会话");
        assert_eq!(store.load_messages("s1").await.unwrap().len(), 1);
    }
}