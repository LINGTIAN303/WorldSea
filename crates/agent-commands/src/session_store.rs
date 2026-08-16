//! 会话持久化（SQLite）：可选持久化层，启动加载全部会话重建 AgentLoop、会话变更写穿，详细见 docs/details/注释/agent-commands/session_store.md

use std::sync::Arc;

use agent_runtime::types::OrchestratorMessage;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::SqlitePool;

use crate::CommandError;

/// 会话类型：chat=单聊（默认），group=群聊参与者
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SessionKind {
    Chat,
    Group,
}

impl Default for SessionKind {
    fn default() -> Self {
        SessionKind::Chat
    }
}

/// 会话头记录（列表项 + 重建 AgentLoop 所需）
///
/// `system_prompt` 单独落列，便于启动时按原样重建 AgentLoop 配置；
/// 具体消息内容走 [`messages`] 表，经 [`SessionRepository::load_messages`] 恢复。
/// `kind` 区分单聊/群聊参与者会话（群聊侧边栏过滤与恢复定位用，缺省 chat）。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SessionRecord {
    pub id: String,
    pub system_prompt: String,
    pub created_at: u64,
    pub message_count: u32,
    pub updated_at: u64,
    /// 会话标题（默认「新会话」，支持前端重命名）
    pub title: String,
    /// 是否固定到列表顶部
    pub pinned: bool,
    /// 会话类型（chat/group，缺省 chat）
    #[serde(default)]
    pub kind: SessionKind,
    /// A3 四管线路由开关（缺省开启，持久化）
    #[serde(default = "default_true")]
    pub router_enabled: bool,
}

/// SessionRecord.router_enabled 的 serde 缺省值（旧记录/缺省字段视为开启）
fn default_true() -> bool {
    true
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
    /// 更新会话标题（写穿）
    async fn update_title(&self, session_id: &str, title: &str) -> Result<(), CommandError>;
    /// 设置会话固定状态（写穿）
    async fn set_pinned(&self, session_id: &str, pinned: bool) -> Result<(), CommandError>;
    /// 设置会话级四管线路由开关（写穿，A3）
    async fn set_router_enabled(&self, session_id: &str, enabled: bool) -> Result<(), CommandError>;
    /// 保存群聊参与者会话映射（写穿；group_id+participant_id 走 upsert）
    async fn save_group_participant(
        &self,
        group_id: &str,
        participant_id: &str,
        session_id: &str,
    ) -> Result<(), CommandError>;
    /// 按群聊 id 加载参与者会话映射（返回 (participant_id, session_id)）
    async fn load_group_participants(&self, group_id: &str) -> Result<Vec<(String, String)>, CommandError>;
    /// 删除群聊全部参与者会话映射（级联；session 行由 delete_session 处理）
    async fn delete_group_participants(&self, group_id: &str) -> Result<(), CommandError>;
    /// 按会话类型加载会话头（list_sessions 过滤用）
    async fn load_sessions_by_kind(&self, kind: SessionKind) -> Result<Vec<SessionRecord>, CommandError>;
    /// 写穿某会话的 A4 计划（JSON；None=清空计划）
    async fn save_plan(
        &self,
        session_id: &str,
        plan: &Option<Vec<agent_runtime::types::PlanItem>>,
    ) -> Result<(), CommandError>;
    /// 加载某会话的 A4 计划（None=无计划）
    async fn load_plan(&self, session_id: &str) -> Result<Option<Vec<agent_runtime::types::PlanItem>>, CommandError>;
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

    /// 建表（幂等）+ 旧库补列迁移
    async fn init(pool: &SqlitePool) -> Result<(), CommandError> {
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS sessions (
                id            TEXT PRIMARY KEY,
                system_prompt TEXT NOT NULL,
                created_at    INTEGER NOT NULL,
                message_count INTEGER NOT NULL,
                updated_at    INTEGER NOT NULL,
                title         TEXT NOT NULL DEFAULT '新会话',
                pinned        INTEGER NOT NULL DEFAULT 0
            )",
        )
        .execute(pool)
        .await
        .map_err(|e| CommandError::Internal(format!("初始化会话表失败: {e}")))?;

        // 迁移：旧库无 title/pinned 列时补列（幂等，列已存在则 ALTER 报错被忽略）
        let _ = sqlx::query("ALTER TABLE sessions ADD COLUMN title TEXT NOT NULL DEFAULT '新会话'")
            .execute(pool)
            .await;
        let _ = sqlx::query("ALTER TABLE sessions ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0")
            .execute(pool)
            .await;
        // 迁移：会话类型列（chat/group），旧库全为单聊补默认 chat
        let _ = sqlx::query("ALTER TABLE sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat'")
            .execute(pool)
            .await;
        // 迁移：A3 四管线路由开关列，旧库补默认开启
        let _ = sqlx::query(
            "ALTER TABLE sessions ADD COLUMN router_enabled INTEGER NOT NULL DEFAULT 1",
        )
        .execute(pool)
        .await;
        // 迁移：A4 Plan-Exec 计划列（JSON 数组或 NULL），旧库补默认空
        let _ = sqlx::query("ALTER TABLE sessions ADD COLUMN plan TEXT")
            .execute(pool)
            .await;

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

        // 群聊参与者会话映射表：group_id + participant_id → rust_session_id
        // （session 行删除时级联清理映射，保证不残留孤儿关联）
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS group_chat_sessions (
                group_id        TEXT NOT NULL,
                participant_id  TEXT NOT NULL,
                session_id      TEXT NOT NULL,
                PRIMARY KEY (group_id, participant_id),
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            )",
        )
        .execute(pool)
        .await
        .map_err(|e| CommandError::Internal(format!("初始化群聊参与者会话表失败: {e}")))?;
        Ok(())
    }
}

#[async_trait::async_trait]
impl SessionRepository for SqliteSessionRepository {
    async fn save_session(&self, record: &SessionRecord) -> Result<(), CommandError> {
        sqlx::query(
            "INSERT INTO sessions (id, system_prompt, created_at, message_count, updated_at, title, pinned, kind, router_enabled)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(id) DO UPDATE SET
                system_prompt = ?2, created_at = ?3, message_count = ?4, updated_at = ?5,
                title = ?6, pinned = ?7, kind = ?8, router_enabled = ?9",
        )
        .bind(&record.id)
        .bind(&record.system_prompt)
        .bind(record.created_at as i64)
        .bind(record.message_count as i64)
        .bind(record.updated_at as i64)
        .bind(&record.title)
        .bind(record.pinned as i64)
        .bind(kind_to_str(record.kind))
        .bind(record.router_enabled as i64)
        .execute(&self.pool)
        .await
        .map_err(|e| CommandError::Internal(format!("写入会话失败: {e}")))?;
        Ok(())
    }

    async fn load_sessions(&self) -> Result<Vec<SessionRecord>, CommandError> {
        let rows: Vec<(String, String, i64, i64, i64, String, i64, String, i64)> = sqlx::query_as(
            "SELECT id, system_prompt, created_at, message_count, updated_at, title, pinned, kind, router_enabled FROM sessions",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| CommandError::Internal(format!("读取会话列表失败: {e}")))?;
        Ok(rows
            .into_iter()
            .map(record_from_row)
            .collect())
    }

    async fn load_sessions_by_kind(&self, kind: SessionKind) -> Result<Vec<SessionRecord>, CommandError> {
        let rows: Vec<(String, String, i64, i64, i64, String, i64, String, i64)> = sqlx::query_as(
            "SELECT id, system_prompt, created_at, message_count, updated_at, title, pinned, kind, router_enabled FROM sessions WHERE kind = ?1",
        )
        .bind(kind_to_str(kind))
        .fetch_all(&self.pool)
        .await
        .map_err(|e| CommandError::Internal(format!("按类型读取会话列表失败: {e}")))?;
        Ok(rows.into_iter().map(record_from_row).collect())
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

    async fn update_title(&self, session_id: &str, title: &str) -> Result<(), CommandError> {
        let updated_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        sqlx::query("UPDATE sessions SET title = ?1, updated_at = ?2 WHERE id = ?3")
            .bind(title)
            .bind(updated_at as i64)
            .bind(session_id)
            .execute(&self.pool)
            .await
            .map_err(|e| CommandError::Internal(format!("更新会话标题失败: {e}")))?;
        Ok(())
    }

    async fn set_pinned(&self, session_id: &str, pinned: bool) -> Result<(), CommandError> {
        sqlx::query("UPDATE sessions SET pinned = ?1 WHERE id = ?2")
            .bind(pinned as i64)
            .bind(session_id)
            .execute(&self.pool)
            .await
            .map_err(|e| CommandError::Internal(format!("更新会话固定状态失败: {e}")))?;
        Ok(())
    }

    async fn set_router_enabled(
        &self,
        session_id: &str,
        enabled: bool,
    ) -> Result<(), CommandError> {
        sqlx::query("UPDATE sessions SET router_enabled = ?1 WHERE id = ?2")
            .bind(enabled as i64)
            .bind(session_id)
            .execute(&self.pool)
            .await
            .map_err(|e| CommandError::Internal(format!("更新会话路由开关失败: {e}")))?;
        Ok(())
    }

    async fn save_group_participant(
        &self,
        group_id: &str,
        participant_id: &str,
        session_id: &str,
    ) -> Result<(), CommandError> {
        sqlx::query(
            "INSERT INTO group_chat_sessions (group_id, participant_id, session_id)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(group_id, participant_id) DO UPDATE SET session_id = ?3",
        )
        .bind(group_id)
        .bind(participant_id)
        .bind(session_id)
        .execute(&self.pool)
        .await
        .map_err(|e| CommandError::Internal(format!("写入群聊参与者会话映射失败: {e}")))?;
        Ok(())
    }

    async fn load_group_participants(&self, group_id: &str) -> Result<Vec<(String, String)>, CommandError> {
        let rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT participant_id, session_id FROM group_chat_sessions WHERE group_id = ?1",
        )
        .bind(group_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| CommandError::Internal(format!("读取群聊参与者会话映射失败: {e}")))?;
        Ok(rows)
    }

    async fn delete_group_participants(&self, group_id: &str) -> Result<(), CommandError> {
        sqlx::query("DELETE FROM group_chat_sessions WHERE group_id = ?1")
            .bind(group_id)
            .execute(&self.pool)
            .await
            .map_err(|e| CommandError::Internal(format!("删除群聊参与者会话映射失败: {e}")))?;
        Ok(())
    }

    async fn save_plan(
        &self,
        session_id: &str,
        plan: &Option<Vec<agent_runtime::types::PlanItem>>,
    ) -> Result<(), CommandError> {
        let plan_json = plan
            .as_ref()
            .map(|p| serde_json::to_string(p).unwrap_or_else(|_| "[]".into()));
        sqlx::query("UPDATE sessions SET plan = ?1 WHERE id = ?2")
            .bind(plan_json)
            .bind(session_id)
            .execute(&self.pool)
            .await
            .map_err(|e| CommandError::Internal(format!("写穿会话计划失败: {e}")))?;
        Ok(())
    }

    async fn load_plan(&self, session_id: &str) -> Result<Option<Vec<agent_runtime::types::PlanItem>>, CommandError> {
        let plan_json: Option<String> = sqlx::query_scalar("SELECT plan FROM sessions WHERE id = ?1")
            .bind(session_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| CommandError::Internal(format!("读取会话计划失败: {e}")))?
            .flatten();
        match plan_json {
            None => Ok(None),
            Some(json) if json.trim().is_empty() => Ok(None),
            Some(json) => {
                let items: Vec<agent_runtime::types::PlanItem> = serde_json::from_str(&json)
                    .map_err(|e| CommandError::Internal(format!("解析会话计划失败: {e}")))?;
                // 空数组/空计划视为无计划，统一返回 None
                Ok(if items.is_empty() { None } else { Some(items) })
            }
        }
    }
}

/// kind 枚举 → SQL 存储字符串（与 sessions.kind 列 TEXT 一致）
fn kind_to_str(kind: SessionKind) -> &'static str {
    match kind {
        SessionKind::Chat => "chat",
        SessionKind::Group => "group",
    }
}

/// SQL 行 → SessionRecord（kind 列转枚举，未知值回退 chat）
fn record_from_row(
    (id, system_prompt, created_at, message_count, updated_at, title, pinned, kind, router_enabled): (
        String,
        String,
        i64,
        i64,
        i64,
        String,
        i64,
        String,
        i64,
    ),
) -> SessionRecord {
    SessionRecord {
        id,
        system_prompt,
        created_at: created_at as u64,
        message_count: message_count as u32,
        updated_at: updated_at as u64,
        title,
        pinned: pinned != 0,
        kind: match kind.as_str() {
            "group" => SessionKind::Group,
            _ => SessionKind::Chat,
        },
        router_enabled: router_enabled != 0,
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
            title: "新会话".into(),
            pinned: false,
            kind: SessionKind::Chat,
            router_enabled: true,
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

    #[tokio::test]
    async fn router_enabled_roundtrip_and_persist() {
        // 用临时文件模拟持久化：设置开关后关闭 store，再重新打开验证已落库
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("router.db");
        let path = db_path.to_str().unwrap().to_string();

        {
            let store = SqliteSessionRepository::new(&path).await.unwrap();
            let mut r = record("s1", 0);
            r.router_enabled = false;
            store.save_session(&r).await.unwrap();
            // set_router_enabled 写穿更新
            store.set_router_enabled("s1", false).await.unwrap();
            let loaded = store.load_sessions().await.unwrap();
            assert_eq!(loaded[0].router_enabled, false);
        } // drop store → 连接池关闭（模拟重启）

        let store = SqliteSessionRepository::new(&path).await.unwrap();
        let loaded = store.load_sessions().await.unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].router_enabled, false, "重启后应保留关闭状态");
    }

    #[tokio::test]
    async fn plan_roundtrip_and_persist() {
        // 用临时文件模拟持久化：save_plan 后关闭 store 再重新打开，验证计划已落库
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("plan.db");
        let path = db_path.to_str().unwrap().to_string();

        let items = vec![
            agent_runtime::types::PlanItem {
                id: "plan-item-1-0".into(),
                title: "第一步".into(),
                description: Some("调研".into()),
                status: agent_runtime::types::PlanItemStatus::Pending,
                order: 0,
                output: None,
            },
            agent_runtime::types::PlanItem {
                id: "plan-item-1-1".into(),
                title: "第二步".into(),
                description: None,
                status: agent_runtime::types::PlanItemStatus::InProgress,
                order: 1,
                output: None,
            },
        ];

        {
            let store = SqliteSessionRepository::new(&path).await.unwrap();
            store.save_session(&record("s1", 0)).await.unwrap();
            store.save_plan("s1", &Some(items.clone())).await.unwrap();
            // 即时读取验证内存往返
            let loaded = store.load_plan("s1").await.unwrap().unwrap();
            assert_eq!(loaded.len(), 2);
            assert_eq!(loaded[0].title, "第一步");
            assert_eq!(loaded[0].status, agent_runtime::types::PlanItemStatus::Pending);
            assert_eq!(loaded[1].status, agent_runtime::types::PlanItemStatus::InProgress);
        } // drop store → 连接池关闭（模拟重启）

        let store = SqliteSessionRepository::new(&path).await.unwrap();
        let loaded = store.load_plan("s1").await.unwrap().unwrap();
        assert_eq!(loaded.len(), 2, "重启后应恢复计划");
        assert_eq!(loaded[0].title, "第一步");
        assert_eq!(loaded[1].status, agent_runtime::types::PlanItemStatus::InProgress);
    }

    #[tokio::test]
    async fn plan_clear_and_none_for_missing_session() {
        let store = SqliteSessionRepository::new_in_memory().await.unwrap();
        // 无会话 → 无计划
        assert!(store.load_plan("missing").await.unwrap().is_none());

        store.save_session(&record("s1", 0)).await.unwrap();
        store.save_plan("s1", &Some(vec![])).await.unwrap();
        // 空数组 → 视为无计划
        assert!(store.load_plan("s1").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn kind_roundtrip_and_filter() {
        let store = SqliteSessionRepository::new_in_memory().await.unwrap();

        // 单聊会话（kind 缺省 chat）
        let mut chat = record("chat1", 0);
        chat.kind = SessionKind::Chat;
        store.save_session(&chat).await.unwrap();
        // 群聊参与者会话（kind = group）
        let mut group = record("group1", 0);
        group.kind = SessionKind::Group;
        store.save_session(&group).await.unwrap();

        // 全量加载保留 kind
        let all = store.load_sessions().await.unwrap();
        assert_eq!(all.len(), 2);
        assert!(all.iter().any(|r| r.id == "group1" && r.kind == SessionKind::Group));
        assert!(all.iter().any(|r| r.id == "chat1" && r.kind == SessionKind::Chat));

        // 按 kind 过滤
        let chats = store.load_sessions_by_kind(SessionKind::Chat).await.unwrap();
        assert_eq!(chats.len(), 1);
        assert_eq!(chats[0].id, "chat1");
        let groups = store.load_sessions_by_kind(SessionKind::Group).await.unwrap();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].id, "group1");
    }

    #[tokio::test]
    async fn group_participant_mapping_roundtrip_and_cascade() {
        let store = SqliteSessionRepository::new_in_memory().await.unwrap();
        let mut g1 = record("g1", 0);
        g1.kind = SessionKind::Group;
        let mut g2 = record("g2", 0);
        g2.kind = SessionKind::Group;
        store.save_session(&g1).await.unwrap();
        store.save_session(&g2).await.unwrap();

        store.save_group_participant("grp-a", "p1", "g1").await.unwrap();
        store.save_group_participant("grp-a", "p2", "g2").await.unwrap();
        store.save_group_participant("grp-b", "p1", "g1").await.unwrap();

        let a = store.load_group_participants("grp-a").await.unwrap();
        assert_eq!(a.len(), 2);
        assert!(a.contains(&("p1".to_string(), "g1".to_string())));
        assert!(a.contains(&("p2".to_string(), "g2".to_string())));

        // upsert：同 group_id+participant_id 覆盖
        let mut g3 = record("g3", 0);
        g3.kind = SessionKind::Group;
        store.save_session(&g3).await.unwrap();
        store.save_group_participant("grp-a", "p1", "g3").await.unwrap();
        let a = store.load_group_participants("grp-a").await.unwrap();
        assert_eq!(a.len(), 2);
        assert!(a.contains(&("p1".to_string(), "g3".to_string())));

        // 删除会话行 → 映射级联清理（外键 ON DELETE CASCADE）
        store.delete_session("g3").await.unwrap();
        let a = store.load_group_participants("grp-a").await.unwrap();
        assert!(!a.iter().any(|(_, sid)| sid == "g3"), "删除会话后映射应级联清理");

        // delete_group_participants 清空某群聊全部映射
        store.delete_group_participants("grp-a").await.unwrap();
        let a = store.load_group_participants("grp-a").await.unwrap();
        assert!(a.is_empty());
        let b = store.load_group_participants("grp-b").await.unwrap();
        assert_eq!(b.len(), 1, "grp-b 映射不受影响");
    }
}