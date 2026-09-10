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
    /// 会话绑定的工作区根目录（Phase 3 接入本地文件系统；None=不限定）
    #[serde(default)]
    pub workdir: Option<String>,
    /// 会话绑定的 Workspace 实体 id（Phase A；`None`=旧数据缺省，用 workdir 兜底）
    ///
    /// `workdir` 字符串保留做向后兼容展示，`workspace_id` 是新引入的实体引用；
    /// 二者并存时以 `workspace_id` → workspaces.root 为准。
    #[serde(default)]
    pub workspace_id: Option<String>,
    /// 会话归属的项目 id（任务29/D1 锚点；`None`=旧数据/未归属）
    ///
    /// 弱引用前端 ProjectManager 的项目 UUID（Rust 无 projects 表，不校验外键），
    /// 供后续按项目过滤会话/记忆隔离等消费；`workdir`/`workspace_id` 继续承载目录语义。
    #[serde(default)]
    pub project_id: Option<String>,
    /// 会话绑定的场景 id（2026-09-09 场景底座：新会话按 scene 装配；`None`=旧数据缺省 world）
    ///
    /// 场景 = 会话级装配单元（身份 prompt/工具/技能/工作区隔离），会话列表按场景
    /// 过滤实现「场景间会话不互通」。缺省 world（与滑块默认一致；2026-09-10 由
    /// worldbuilding 改名，旧值经迁移 UPDATE 归一）。
    #[serde(default)]
    pub scene_id: Option<String>,
}

/// 目录实体（工作区目录条目，Workdir 表）
///
/// `path` 为目录绝对路径，`label` 为展示用名称；前端目录空间选择器
/// 用它做「目录实体 → 会话」两级树分组的目录条目，会话经 workdir 路径关联。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkdirRecord {
    pub id: String,
    pub path: String,
    pub label: String,
    pub created_at: u64,
}

/// Workspace 实体（Workspace 表）
///
/// `root` 为工作区根目录绝对路径（与 `scene_id` 复合唯一，2026-09-10 方案A）；
/// `label` 为展示用名称；会话经 `workspace_id` 引用本实体。与 [`WorkdirRecord`] 的定位差异：
/// `workdir` 是「路径字符串」兼容层，`WorkspaceRecord` 是「实体化」后的一等公民
/// （带 id/生命周期），本阶段 Phase A 引入，供 Session 真正「绑定一个 Workspace」。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRecord {
    pub id: String,
    pub root: String,
    pub label: String,
    /// 绑定场景 id（2026-09-10 方案A：工作区身份 =（root × scene）；NULL=旧数据/未限定）
    pub scene_id: Option<String>,
    pub created_at: u64,
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
    /// 物理清理空会话（启动恢复时调用），返回清理条数。
    ///
    /// 判定 = 无任何消息行 && 非固定 && chat 类型——按 `messages` 表实况判定，
    /// 不依赖不可靠的 message_count 列（X1：该列仅创建期写入）；有消息的会话绝不命中。
    /// 群聊参与者会话（kind=group）排除在外，保证群聊映射恢复不受影响。
    async fn purge_empty_sessions(&self) -> Result<u64, CommandError>;
    /// 更新会话标题（写穿）
    async fn update_title(&self, session_id: &str, title: &str) -> Result<(), CommandError>;
    /// 设置会话固定状态（写穿）
    async fn set_pinned(&self, session_id: &str, pinned: bool) -> Result<(), CommandError>;
    /// 更新会话的工作区目录绑定（写穿；None=不限定，两参一并清空）。
    ///
    /// `workdir` 与 `workspace_id` 是同一绑定的两面（目录字符串 / Workspace 实体引用），
    /// 必须同步写：切目录时命令层先 `ensure_workspace` 取新实体 id 再一并落库，否则
    /// `workspace_id` 残留旧目录实体，重启恢复（restore_sessions 优先 workspace_id→root）
    /// 会回退旧目录（2026-09-10 断链修复）。
    async fn update_workdir(
        &self,
        session_id: &str,
        workdir: Option<&str>,
        workspace_id: Option<&str>,
    ) -> Result<(), CommandError>;
    /// 更新会话 system prompt（写穿；H5 风险点③ 动态刷新——技能/规则中途变更旧会话生效）
    async fn update_system_prompt(
        &self,
        session_id: &str,
        system_prompt: Option<&str>,
    ) -> Result<(), CommandError>;
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
    /// 写入/覆盖一个目录实体（按 path UNIQUE 去重，返回 upsert 后的记录）
    async fn upsert_workdir(&self, path: &str, label: &str) -> Result<WorkdirRecord, CommandError>;
    /// 列出全部目录实体（前端目录选择器 / 会话树分组用）
    async fn list_workdirs(&self) -> Result<Vec<WorkdirRecord>, CommandError>;
    /// 删除一个目录实体（按 id）
    async fn delete_workdir(&self, id: &str) -> Result<(), CommandError>;
    /// 写入/覆盖一个 Workspace 实体（按 (root, scene_id) 复合去重；已存在复用原 id/created_at 仅更新 label）
    async fn upsert_workspace(
        &self,
        root: &str,
        label: &str,
        scene_id: Option<&str>,
    ) -> Result<WorkspaceRecord, CommandError>;
    /// 列出全部 Workspace 实体
    async fn list_workspaces(&self) -> Result<Vec<WorkspaceRecord>, CommandError>;
    /// 按 id 查 Workspace 实体（None=不存在）
    async fn get_workspace_by_id(&self, id: &str) -> Result<Option<WorkspaceRecord>, CommandError>;
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
        // 迁移：session 级路由开关列——列物理保留（历史数据兼容），不再读写（FIX-4：开关废弃，指令化）
        let _ = sqlx::query(
            "ALTER TABLE sessions ADD COLUMN router_enabled INTEGER NOT NULL DEFAULT 1",
        )
        .execute(pool)
        .await;
        // 迁移：A4 Plan-Exec 计划列（JSON 数组或 NULL），旧库补默认空
        let _ = sqlx::query("ALTER TABLE sessions ADD COLUMN plan TEXT")
            .execute(pool)
            .await;
        // 迁移：会话工作区根目录列（Phase 3 接入本地文件系统），旧库补默认空
        let _ = sqlx::query("ALTER TABLE sessions ADD COLUMN workdir TEXT")
            .execute(pool)
            .await;
        // 迁移：会话 Workspace 实体引用列（Phase A），旧库补默认空
        let _ = sqlx::query("ALTER TABLE sessions ADD COLUMN workspace_id TEXT")
            .execute(pool)
            .await;
        // 迁移：会话归属项目 id 列（任务29/D1 锚点，弱引用前端项目 UUID），旧库补默认空
        let _ = sqlx::query("ALTER TABLE sessions ADD COLUMN project_id TEXT")
            .execute(pool)
            .await;
        // 迁移：会话场景 id 列（2026-09-09 场景底座；会话按场景装配/隔离），旧库补默认空
        let _ = sqlx::query("ALTER TABLE sessions ADD COLUMN scene_id TEXT")
            .execute(pool)
            .await;
        // 迁移：世界场景 id 改名（2026-09-10 worldbuilding→world），幂等 UPDATE，
        // 保证既有会话在新 registry（id=world）下仍能按 scene_id 重装配
        let _ = sqlx::query("UPDATE sessions SET scene_id = 'world' WHERE scene_id = 'worldbuilding'")
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

        // 目录实体表（Workdir）：path UNIQUE 按路径去重，id 供前端树形分组定位；
        // 会话仍存 workdir 路径字符串，经路径与本表目录条目关联（Phase 2 目录实体）。
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS workdirs (
                id         TEXT PRIMARY KEY,
                path       TEXT UNIQUE NOT NULL,
                label      TEXT NOT NULL,
                created_at INTEGER NOT NULL
            )",
        )
        .execute(pool)
        .await
        .map_err(|e| CommandError::Internal(format!("初始化目录实体表失败: {e}")))?;

        // Workspace 实体表：id 供 sessions.workspace_id 引用；会话经 workspace_id →
        // 本表 root 还原工作区目录（Phase A 实体化）。
        // 2026-09-10 方案A（场景根主权拍板）：工作区身份 =（root × scene_id）——用户打开的
        // 项目目录在不同场景下属于「新项目目录」，同一目录跨场景各自独立工作区。
        // 旧表 root UNIQUE 无法承载复合身份 → 检测到旧形态（无 scene_id 列）时重建。
        let workspaces_exists: i64 =
            sqlx::query_as::<_, (i64,)>(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'workspaces'",
            )
            .fetch_one(pool)
            .await
            .map_err(|e| CommandError::Internal(format!("检查 workspaces 表失败: {e}")))?
            .0;
        if workspaces_exists > 0 {
            let has_scene_id: i64 =
                sqlx::query_as::<_, (i64,)>(
                    "SELECT COUNT(*) FROM pragma_table_info('workspaces') WHERE name = 'scene_id'",
                )
                .fetch_one(pool)
                .await
                .map_err(|e| CommandError::Internal(format!("检查 workspaces.scene_id 列失败: {e}")))?
                .0;
            if has_scene_id == 0 {
                sqlx::query(
                    "CREATE TABLE workspaces_new (
                        id         TEXT PRIMARY KEY,
                        root       TEXT NOT NULL,
                        label      TEXT NOT NULL,
                        scene_id   TEXT,
                        created_at INTEGER NOT NULL
                    )",
                )
                .execute(pool)
                .await
                .map_err(|e| CommandError::Internal(format!("重建 workspaces 表失败: {e}")))?;
                sqlx::query(
                    "INSERT INTO workspaces_new (id, root, label, scene_id, created_at)
                     SELECT id, root, label, NULL, created_at FROM workspaces",
                )
                .execute(pool)
                .await
                .map_err(|e| CommandError::Internal(format!("迁移 workspaces 旧数据失败: {e}")))?;
                sqlx::query("DROP TABLE workspaces")
                    .execute(pool)
                    .await
                    .map_err(|e| CommandError::Internal(format!("移除旧 workspaces 表失败: {e}")))?;
                sqlx::query("ALTER TABLE workspaces_new RENAME TO workspaces")
                    .execute(pool)
                    .await
                    .map_err(|e| CommandError::Internal(format!("重命名 workspaces 表失败: {e}")))?;
            }
        }
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS workspaces (
                id         TEXT PRIMARY KEY,
                root       TEXT NOT NULL,
                label      TEXT NOT NULL,
                scene_id   TEXT,
                created_at INTEGER NOT NULL
            )",
        )
        .execute(pool)
        .await
        .map_err(|e| CommandError::Internal(format!("初始化 Workspace 实体表失败: {e}")))?;
        // (root, scene_id) 复合唯一索引（方案A 身份）；scene_id 为 NULL 的行互不冲突（SQLite 语义）
        let _ = sqlx::query(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_root_scene ON workspaces(root, scene_id)",
        )
        .execute(pool)
        .await;
        // 旧场景根工作区回填场景 id（根目录末段 = workspace_hint；幂等）。
        // 注：项目目录名恰与 hint 同名时被回填亦自洽——该场景会话本就以 (root, 该场景) 为身份。
        for (scene, hint) in [
            ("world", "worldbuilding"),
            ("novel", "novel"),
            ("general", "general"),
            ("coding", "coding"),
            ("design", "design"),
        ] {
            let _ = sqlx::query(
                "UPDATE workspaces SET scene_id = ?1 WHERE scene_id IS NULL AND (root LIKE ?2 OR root LIKE ?3)",
            )
            .bind(scene)
            .bind(format!("%\\{hint}"))
            .bind(format!("%/{hint}"))
            .execute(pool)
            .await;
        }
        Ok(())
    }
}

#[async_trait::async_trait]
impl SessionRepository for SqliteSessionRepository {
    async fn save_session(&self, record: &SessionRecord) -> Result<(), CommandError> {
        // 注：sessions.router_enabled 列物理保留（历史数据兼容）但不再读写（FIX-4：开关废弃，指令化）
        sqlx::query(
            "INSERT INTO sessions (id, system_prompt, created_at, message_count, updated_at, title, pinned, kind, workdir, workspace_id, project_id, scene_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
             ON CONFLICT(id) DO UPDATE SET
                system_prompt = ?2, created_at = ?3, message_count = ?4, updated_at = ?5,
                title = ?6, pinned = ?7, kind = ?8, workdir = ?9, workspace_id = ?10, project_id = ?11, scene_id = ?12",
        )
        .bind(&record.id)
        .bind(&record.system_prompt)
        .bind(record.created_at as i64)
        .bind(record.message_count as i64)
        .bind(record.updated_at as i64)
        .bind(&record.title)
        .bind(record.pinned as i64)
        .bind(kind_to_str(record.kind))
        .bind(&record.workdir)
        .bind(&record.workspace_id)
        .bind(&record.project_id)
        .bind(&record.scene_id)
        .execute(&self.pool)
        .await
        .map_err(|e| CommandError::Internal(format!("写入会话失败: {e}")))?;
        Ok(())
    }

    async fn load_sessions(&self) -> Result<Vec<SessionRecord>, CommandError> {
        let rows: Vec<(
            String,
            String,
            i64,
            i64,
            i64,
            String,
            i64,
            String,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
        )> =
            sqlx::query_as(
                "SELECT id, system_prompt, created_at, message_count, updated_at, title, pinned, kind, workdir, workspace_id, project_id, scene_id FROM sessions",
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
        let rows: Vec<(
            String,
            String,
            i64,
            i64,
            i64,
            String,
            i64,
            String,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
        )> =
            sqlx::query_as(
                "SELECT id, system_prompt, created_at, message_count, updated_at, title, pinned, kind, workdir, workspace_id, project_id, scene_id FROM sessions WHERE kind = ?1",
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

    async fn purge_empty_sessions(&self) -> Result<u64, CommandError> {
        // 按消息表实况判定：无任何消息行的 chat 会话且未固定 → 物理删除
        //（messages 级联无需处理——子查询保证无消息行；group_chat_sessions 映射仅挂 group 会话，不命中）
        let result = sqlx::query(
            "DELETE FROM sessions WHERE kind = 'chat' AND pinned = 0 \
             AND id NOT IN (SELECT DISTINCT session_id FROM messages)",
        )
        .execute(&self.pool)
        .await
        .map_err(|e| CommandError::Internal(format!("清理空会话失败: {e}")))?;
        Ok(result.rows_affected())
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

    async fn update_workdir(
        &self,
        session_id: &str,
        workdir: Option<&str>,
        workspace_id: Option<&str>,
    ) -> Result<(), CommandError> {
        sqlx::query("UPDATE sessions SET workdir = ?1, workspace_id = ?2 WHERE id = ?3")
            .bind(workdir)
            .bind(workspace_id)
            .bind(session_id)
            .execute(&self.pool)
            .await
            .map_err(|e| CommandError::Internal(format!("更新会话工作区目录失败: {e}")))?;
        Ok(())
    }

    async fn update_system_prompt(
        &self,
        session_id: &str,
        system_prompt: Option<&str>,
    ) -> Result<(), CommandError> {
        sqlx::query("UPDATE sessions SET system_prompt = ?1 WHERE id = ?2")
            .bind(system_prompt)
            .bind(session_id)
            .execute(&self.pool)
            .await
            .map_err(|e| CommandError::Internal(format!("更新会话 system prompt 失败: {e}")))?;
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

    async fn upsert_workdir(&self, path: &str, label: &str) -> Result<WorkdirRecord, CommandError> {
        // 按 path 去重：已存在则复用原 id 仅更新 label；不存在则新建 id
        let existing: Option<(String, i64)> =
            sqlx::query_as("SELECT id, created_at FROM workdirs WHERE path = ?1")
                .bind(path)
                .fetch_optional(&self.pool)
                .await
                .map_err(|e| CommandError::Internal(format!("查询目录实体失败: {e}")))?;
        if let Some((id, created_at)) = existing {
            sqlx::query("UPDATE workdirs SET label = ?1 WHERE id = ?2")
                .bind(label)
                .bind(&id)
                .execute(&self.pool)
                .await
                .map_err(|e| CommandError::Internal(format!("更新目录实体失败: {e}")))?;
            Ok(WorkdirRecord {
                id,
                path: path.to_string(),
                label: label.to_string(),
                created_at: created_at as u64,
            })
        } else {
            let id = uuid::Uuid::new_v4().to_string();
            let created_at = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            sqlx::query(
                "INSERT INTO workdirs (id, path, label, created_at) VALUES (?1, ?2, ?3, ?4)",
            )
            .bind(&id)
            .bind(path)
            .bind(label)
            .bind(created_at as i64)
            .execute(&self.pool)
            .await
            .map_err(|e| CommandError::Internal(format!("写入目录实体失败: {e}")))?;
            Ok(WorkdirRecord {
                id,
                path: path.to_string(),
                label: label.to_string(),
                created_at,
            })
        }
    }

    async fn list_workdirs(&self) -> Result<Vec<WorkdirRecord>, CommandError> {
        let rows: Vec<(String, String, String, i64)> = sqlx::query_as(
            "SELECT id, path, label, created_at FROM workdirs ORDER BY created_at",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| CommandError::Internal(format!("读取目录实体列表失败: {e}")))?;
        Ok(rows.into_iter().map(workdir_from_row).collect())
    }

    async fn delete_workdir(&self, id: &str) -> Result<(), CommandError> {
        sqlx::query("DELETE FROM workdirs WHERE id = ?1")
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| CommandError::Internal(format!("删除目录实体失败: {e}")))?;
        Ok(())
    }

    async fn upsert_workspace(
        &self,
        root: &str,
        label: &str,
        scene_id: Option<&str>,
    ) -> Result<WorkspaceRecord, CommandError> {
        // 方案A 复合去重：同 (root, scene_id) 复用原 id/created_at 仅更新 label；否则新建 id。
        // `scene_id IS ?2` 使 NULL 键参与匹配（SQLite IS 支持绑定 NULL）。
        let existing: Option<(String, i64)> =
            sqlx::query_as("SELECT id, created_at FROM workspaces WHERE root = ?1 AND scene_id IS ?2")
                .bind(root)
                .bind(scene_id)
                .fetch_optional(&self.pool)
                .await
                .map_err(|e| CommandError::Internal(format!("查询 Workspace 实体失败: {e}")))?;
        if let Some((id, created_at)) = existing {
            sqlx::query("UPDATE workspaces SET label = ?1 WHERE id = ?2")
                .bind(label)
                .bind(&id)
                .execute(&self.pool)
                .await
                .map_err(|e| CommandError::Internal(format!("更新 Workspace 实体失败: {e}")))?;
            Ok(WorkspaceRecord {
                id,
                root: root.to_string(),
                label: label.to_string(),
                scene_id: scene_id.map(|s| s.to_string()),
                created_at: created_at as u64,
            })
        } else {
            let id = uuid::Uuid::new_v4().to_string();
            let created_at = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            sqlx::query(
                "INSERT INTO workspaces (id, root, label, scene_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            )
            .bind(&id)
            .bind(root)
            .bind(label)
            .bind(scene_id)
            .bind(created_at as i64)
            .execute(&self.pool)
            .await
            .map_err(|e| CommandError::Internal(format!("写入 Workspace 实体失败: {e}")))?;
            Ok(WorkspaceRecord {
                id,
                root: root.to_string(),
                label: label.to_string(),
                scene_id: scene_id.map(|s| s.to_string()),
                created_at,
            })
        }
    }

    async fn list_workspaces(&self) -> Result<Vec<WorkspaceRecord>, CommandError> {
        let rows: Vec<(String, String, String, Option<String>, i64)> = sqlx::query_as(
            "SELECT id, root, label, scene_id, created_at FROM workspaces ORDER BY created_at",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| CommandError::Internal(format!("读取 Workspace 实体列表失败: {e}")))?;
        Ok(rows.into_iter().map(workspace_from_row).collect())
    }

    async fn get_workspace_by_id(&self, id: &str) -> Result<Option<WorkspaceRecord>, CommandError> {
        let row: Option<(String, String, String, Option<String>, i64)> = sqlx::query_as(
            "SELECT id, root, label, scene_id, created_at FROM workspaces WHERE id = ?1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| CommandError::Internal(format!("按 id 读取 Workspace 实体失败: {e}")))?;
        Ok(row.map(workspace_from_row))
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
    (
        id,
        system_prompt,
        created_at,
        message_count,
        updated_at,
        title,
        pinned,
        kind,
        workdir,
        workspace_id,
        project_id,
        scene_id,
    ): (
        String,
        String,
        i64,
        i64,
        i64,
        String,
        i64,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
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
        workdir,
        workspace_id,
        project_id,
        scene_id,
    }
}

/// SQL 行 → WorkdirRecord
fn workdir_from_row((id, path, label, created_at): (String, String, String, i64)) -> WorkdirRecord {
    WorkdirRecord {
        id,
        path,
        label,
        created_at: created_at as u64,
    }
}

/// SQL 行 → WorkspaceRecord
fn workspace_from_row(
    (id, root, label, scene_id, created_at): (String, String, String, Option<String>, i64),
) -> WorkspaceRecord {
    WorkspaceRecord {
        id,
        root,
        label,
        scene_id,
        created_at: created_at as u64,
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
            workdir: None,
            workspace_id: None,
            project_id: None,
            scene_id: None,
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
    async fn workdir_roundtrip_and_persist() {
        // 用临时文件模拟持久化：写入 workdir 后关闭 store 再重新打开，验证已落库
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("workdir.db");
        let path = db_path.to_str().unwrap().to_string();

        {
            let store = SqliteSessionRepository::new(&path).await.unwrap();
            let mut r = record("s1", 0);
            r.workdir = Some("D:/workspaces/proj-a".into());
            store.save_session(&r).await.unwrap();
            let loaded = store.load_sessions().await.unwrap();
            assert_eq!(loaded[0].workdir.as_deref(), Some("D:/workspaces/proj-a"));
        } // drop store → 连接池关闭（模拟重启）

        let store = SqliteSessionRepository::new(&path).await.unwrap();
        let loaded = store.load_sessions().await.unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].workdir.as_deref(), Some("D:/workspaces/proj-a"), "重启后应保留 workdir");
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

    #[tokio::test]
    async fn workdir_upsert_list_delete() {
        let store = SqliteSessionRepository::new_in_memory().await.unwrap();
        assert!(store.list_workdirs().await.unwrap().is_empty());

        // 新建目录实体
        let w = store
            .upsert_workdir("D:/workspaces/proj-a", "项目 A")
            .await
            .unwrap();
        assert!(!w.id.is_empty());
        assert_eq!(w.path, "D:/workspaces/proj-a");
        assert_eq!(w.label, "项目 A");

        // 按 path 去重：同 path 再 upsert 只更新 label，id/created_at 保持
        let w2 = store
            .upsert_workdir("D:/workspaces/proj-a", "项目 A 改名")
            .await
            .unwrap();
        assert_eq!(w2.id, w.id, "同 path 复用原 id");
        assert_eq!(w2.created_at, w.created_at, "同 path 保留原 created_at");
        assert_eq!(w2.label, "项目 A 改名");

        // 不同 path 新增为独立条目
        store
            .upsert_workdir("D:/workspaces/proj-b", "项目 B")
            .await
            .unwrap();
        let all = store.list_workdirs().await.unwrap();
        assert_eq!(all.len(), 2);

        // 删除按 id
        store.delete_workdir(&w.id).await.unwrap();
        let all = store.list_workdirs().await.unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].path, "D:/workspaces/proj-b");
    }

    #[tokio::test]
    async fn workspace_upsert_list_get() {
        let store = SqliteSessionRepository::new_in_memory().await.unwrap();
        assert!(store.list_workspaces().await.unwrap().is_empty());
        assert!(store.get_workspace_by_id("missing").await.unwrap().is_none());

        // 新建 Workspace 实体
        let w = store
            .upsert_workspace("D:/workspaces/proj-a", "项目 A", None)
            .await
            .unwrap();
        assert!(!w.id.is_empty());
        assert_eq!(w.root, "D:/workspaces/proj-a");
        assert_eq!(w.label, "项目 A");

        // 复合去重：同 (root, scene_id) 再 upsert 只更新 label，id/created_at 保持
        let w2 = store
            .upsert_workspace("D:/workspaces/proj-a", "项目 A 改名", None)
            .await
            .unwrap();
        assert_eq!(w2.id, w.id, "同 (root, scene) 复用原 id");
        assert_eq!(w2.created_at, w.created_at, "同 (root, scene) 保留原 created_at");
        assert_eq!(w2.label, "项目 A 改名");

        // 不同 root 新增为独立条目
        store
            .upsert_workspace("D:/workspaces/proj-b", "项目 B", None)
            .await
            .unwrap();
        assert_eq!(store.list_workspaces().await.unwrap().len(), 2);

        // 按 id 查询
        let got = store.get_workspace_by_id(&w.id).await.unwrap().unwrap();
        assert_eq!(got.root, "D:/workspaces/proj-a");
        assert_eq!(got.label, "项目 A 改名");
    }

    #[tokio::test]
    async fn workspace_scene_composite_dedupe() {
        // 方案A（2026-09-10 场景根主权）：工作区身份 =（root × scene）——
        // 同一项目目录在不同场景下属于「新项目目录」，各自独立工作区实体
        let store = SqliteSessionRepository::new_in_memory().await.unwrap();
        let w_world = store
            .upsert_workspace("D:/proj/a", "项目 A", Some("world"))
            .await
            .unwrap();
        let w_coding = store
            .upsert_workspace("D:/proj/a", "项目 A", Some("coding"))
            .await
            .unwrap();
        assert_ne!(w_world.id, w_coding.id, "同目录不同场景应为两个独立工作区");
        assert_eq!(w_world.scene_id.as_deref(), Some("world"));
        assert_eq!(w_coding.scene_id.as_deref(), Some("coding"));

        // 同 (root, scene) 复用
        let w_world2 = store
            .upsert_workspace("D:/proj/a", "项目 A 改名", Some("world"))
            .await
            .unwrap();
        assert_eq!(w_world2.id, w_world.id, "同目录同场景复用原 id");
        assert_eq!(w_world2.label, "项目 A 改名");

        // 列表 2 条（world/coding 各一），按 id 查回场景
        assert_eq!(store.list_workspaces().await.unwrap().len(), 2);
        let got = store.get_workspace_by_id(&w_coding.id).await.unwrap().unwrap();
        assert_eq!(got.scene_id.as_deref(), Some("coding"));
    }

    #[tokio::test]
    async fn purge_empty_sessions_keeps_meaningful_rows() {
        // 空会话清理（2026-09-10 症状①）：仅清「无消息行 && 非固定 && chat」；
        // 有消息、固定、group 类型均保留（群聊映射恢复依赖 group 会话行）
        let store = SqliteSessionRepository::new_in_memory().await.unwrap();

        let mut empty = record("empty", 0); // 0 消息 chat 非固定 → 清
        empty.message_count = 5; // 列值虚高（X1：不可靠）也不影响判定
        store.save_session(&empty).await.unwrap();
        let mut with_msg = record("with-msg", 0); // 有消息 → 保留
        store.save_session(&with_msg).await.unwrap();
        let mut pinned = record("pinned", 0); // 固定空会话 → 保留
        pinned.pinned = true;
        store.save_session(&pinned).await.unwrap();
        let mut group = record("group", 0); // group 类型 → 保留
        group.kind = SessionKind::Group;
        store.save_session(&group).await.unwrap();

        store
            .replace_messages("with-msg", &[msg(MessageRole::User, "hi")])
            .await
            .unwrap();

        let purged = store.purge_empty_sessions().await.unwrap();
        assert_eq!(purged, 1, "仅清掉 1 条空会话");
        let left: Vec<String> = store
            .load_sessions()
            .await
            .unwrap()
            .into_iter()
            .map(|r| r.id)
            .collect();
        assert!(!left.contains(&"empty".to_string()), "空会话应被清理");
        for kept in ["with-msg", "pinned", "group"] {
            assert!(left.contains(&kept.to_string()), "{kept} 应保留");
        }

        // 幂等：再跑一次无新增删除
        assert_eq!(store.purge_empty_sessions().await.unwrap(), 0);
    }

    #[tokio::test]
    async fn workspace_id_roundtrip_and_persist() {
        // 用临时文件模拟持久化：写入 workspace_id 后关闭 store 再重新打开，验证已落库
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("workspace_session.db");
        let path = db_path.to_str().unwrap().to_string();

        let ws_id;
        {
            let store = SqliteSessionRepository::new(&path).await.unwrap();
            let ws = store
                .upsert_workspace("D:/workspaces/proj-a", "项目 A", None)
                .await
                .unwrap();
            ws_id = ws.id.clone();
            let mut r = record("s1", 0);
            r.workdir = Some("D:/workspaces/proj-a".into());
            r.workspace_id = Some(ws.id);
            store.save_session(&r).await.unwrap();
            let loaded = store.load_sessions().await.unwrap();
            assert_eq!(loaded[0].workspace_id.as_deref(), Some(ws_id.as_str()));
            // 重启后仍可还原 workdir root
            let got = store.get_workspace_by_id(&ws_id).await.unwrap().unwrap();
            assert_eq!(got.root, "D:/workspaces/proj-a");
        } // drop store → 连接池关闭（模拟重启）

        let store = SqliteSessionRepository::new(&path).await.unwrap();
        let loaded = store.load_sessions().await.unwrap();
        assert_eq!(loaded.len(), 1);
        assert!(loaded[0].workspace_id.is_some(), "workspace_id 重启后应保留");

        // 用 workdir 兜底退化路径：旧数据无 workspace_id 时不影响加载
        let mut old = record("s-old", 0);
        old.workdir = Some("D:/legacy".into());
        old.workspace_id = None;
        store.save_session(&old).await.unwrap();
        assert_eq!(store.load_sessions().await.unwrap().len(), 2);
    }
}