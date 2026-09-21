//! 会话持久化（SQLite）：可选持久化层，启动加载全部会话重建 AgentLoop、会话变更写穿，详细见 docs/details/注释/agent-commands/session_store.md

use std::sync::Arc;

use agent_runtime::agent::request_snapshot::RequestSnapshot;
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
    /// 静态注入带段 JSON（A4 双端收口；`None`=旧数据/群聊 legacy——恢复走文本单段）
    #[serde(default)]
    pub prompt_sections: Option<String>,
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
    /// 会话绑定的工作区根目录 —— **派生缓存列**（W2②，2026-09-18 工作区与环境对齐 dsh）
    ///
    /// 事实源 = `workspaces.root`（经 `workspace_id` 关联）。本列只作缓存/展示：
    /// 写路径恒与实体双写（建会话 / 切目录）、读路径恒实体优先（`list_sessions` / `restore_sessions`）、
    /// 启动期对不一致的存量做**写穿矫正**（`restore_sessions`）；`None`=无实体可解析时的不限定态。
    #[serde(default)]
    pub workdir: Option<String>,
    /// 会话绑定的 Workspace 实体 id（Phase A；`None`=旧数据缺省，用 workdir 兜底）
    ///
    /// **唯一事实源**：`workdir` 列的取值由本 id → `workspaces.root` 派生，
    /// 二者不一致时一律以实体为准（矫正规则见上）。
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

// ─── A1 丙2 阶段 B：不可变会话日志 ───────────────────────────

/// 不可变会话日志中的一条记录
///
/// **`log_offset` 是稳定坐标**：每条消息版本在整个会话生命周期内只分配一次、
/// 永不复用、永不修改 —— 这是己1 锚点机制可落地的前提（`messages` 表式的
/// 全量替换快照里，同一个位置在不同时刻指向不同消息，坐标不成立）。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionLogEntry {
    /// 稳定坐标（会话内单调递增，从 0 起）
    pub log_offset: i64,
    /// 消息本体（原样 JSON 反序列化）
    pub message: OrchestratorMessage,
    /// 入日志时点（Unix 秒）
    pub recorded_at: u64,
}

/// 会话日志统计（面板与健康检查用）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionLogStats {
    /// 日志总量（历次写入过的消息版本总数）
    pub log_len: i64,
    /// 当前活跃视图条数
    pub live_len: i64,
    /// 已移出视图的条数（= 日志中被"裁掉"但内容仍保留的部分）
    pub dropped_len: i64,
    /// 事件条数（历次同步次数）
    pub event_count: i64,
}

/// 一次视图同步事件（`session_events` 行）
///
/// 事件流是「压缩可见性」的**留痕**：每次同步（含裁剪 / 修订 / 无变化）追加一条，
/// 记录规模三元组与类型。日志面板据此呈现「检查点」（何时、以什么方式改变了上下文）。
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionEventRecord {
    /// 事件坐标（会话内单调递增，从 0 起）
    pub event_seq: i64,
    /// 事件类型：`initial` / `append` / `trim` / `revise` / `noop`
    pub event_kind: String,
    /// 本次新进日志的条数
    pub added: i64,
    /// 本次移出活跃视图的条数（内容保留在日志）
    pub dropped: i64,
    /// 视图最终条数
    pub kept: i64,
    /// 事件时点（Unix 秒）
    pub created_at: u64,
}

/// 一次视图同步的变化三元组
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceOutcome {
    /// 本次新进日志的条数（含被就地修订而重新记录的消息）
    pub added: i64,
    /// 本次移出活跃视图的条数（内容仍留在日志中）
    pub dropped: i64,
    /// 视图最终条数
    pub kept: i64,
    /// 本次事件的坐标
    pub event_seq: i64,
}

impl ReplaceOutcome {
    /// 本次是否发生实质变化
    pub fn is_noop(&self) -> bool {
        self.added == 0 && self.dropped == 0
    }
}

// ─── 请求快照（阶段 3 · ④）────────────────────────

/// 一条请求快照记录（大对象已从去重池还原）
#[derive(Debug, Clone, PartialEq)]
pub struct RequestSnapshotRecord {
    /// 会话内请求序号（单调递增，从 0 起；含旁路调用）
    pub request_seq: i64,
    /// 快照本体（`system_prompt` / `tools_json` 已由 `request_blobs` 还原）
    pub snapshot: RequestSnapshot,
}

/// 依据请求快照序列重建目标请求派发时的消息视图（**结构级等值**，D10 (b)）
///
/// 规则：按序号升序——`Full` 重置基底、`Appended` 拼接增量；目标条为 `Full` 时
/// 直接得到其视图。**链不完整**（增量先于任何全量）→ `None`：拒绝重建，
/// 绝不给出错误结果（宁可说"重建不了"）。
pub fn reconstruct_request_view(
    records: &[RequestSnapshotRecord],
    target_seq: i64,
) -> Option<(RequestSnapshotRecord, Vec<OrchestratorMessage>)> {
    use agent_runtime::agent::request_snapshot::ViewUpdate;
    let target = records.iter().find(|r| r.request_seq == target_seq)?.clone();
    let mut base: Option<Vec<OrchestratorMessage>> = None;
    for record in records.iter().filter(|r| r.request_seq <= target_seq) {
        match &record.snapshot.view_update {
            ViewUpdate::Full { messages } => base = Some(messages.clone()),
            ViewUpdate::Appended { messages } => {
                let Some(current) = base.as_mut() else {
                    return None; // 链不完整：增量先于全量
                };
                current.extend(messages.iter().cloned());
            }
        }
    }
    Some((target, base?))
}

// ─── 定时器记录（批次 C·S1，2026-09-20） ─────────────────────

/// 会话级一次性定时器记录（`session_timers` 表；随会话存储 + 级联删除）
///
/// 状态机（一次性，无周期）：`pending` → `fired`（到点认领触发）/ `cancelled`（用户取消）。
/// 「认领」= `claim_timer_fired` 的原子 UPDATE（`WHERE status='pending'`）——重启补投
/// 与重放不会重复触发。
#[derive(Debug, Clone, PartialEq)]
pub struct SessionTimerRecord {
    /// 定时器 id（`timer-{uuid}`）
    pub id: String,
    /// 归属会话 id（FK sessions.id，ON DELETE CASCADE）
    pub session_id: String,
    /// 触发时点（Unix 毫秒）
    pub fire_at: i64,
    /// 提醒事项（可空；到点唤醒载荷携带）
    pub note: Option<String>,
    /// 监视的 PTY 会话 id 列表（空 = 不捕获后台输出）
    pub watch: Vec<String>,
    /// 设定时各 watch 会话的输出游标（PTY 会话 id → `SessionOutputBuf::end()` 绝对偏移）
    pub cursors: std::collections::HashMap<String, i64>,
    /// 状态
    pub status: SessionTimerStatus,
    /// 创建时点（Unix 毫秒）
    pub created_at: i64,
    /// 触发时点（`fired` 时写入）
    pub fired_at: Option<i64>,
}

/// 定时器状态（一次性流转）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionTimerStatus {
    /// 未到期（等待触发）
    Pending,
    /// 已触发（认领成功）
    Fired,
    /// 已取消（用户撤销）
    Cancelled,
}

impl SessionTimerStatus {
    /// 落库字符串口径
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Fired => "fired",
            Self::Cancelled => "cancelled",
        }
    }

    /// 解析落库字符串（未知按 Pending——保守不丢待触发项）
    pub fn parse(raw: &str) -> Self {
        match raw {
            "fired" => Self::Fired,
            "cancelled" => Self::Cancelled,
            _ => Self::Pending,
        }
    }
}

/// 行 → 定时器记录（JSON 列容错解析：坏数据退化为空集合，不阻断读取）
fn timer_from_row(row: &sqlx::sqlite::SqliteRow) -> SessionTimerRecord {
    use sqlx::Row;
    let watch_json: String = row.try_get("watch_json").unwrap_or_else(|_| "[]".to_string());
    let cursors_json: String = row.try_get("cursors_json").unwrap_or_else(|_| "{}".to_string());
    SessionTimerRecord {
        id: row.try_get("id").unwrap_or_default(),
        session_id: row.try_get("session_id").unwrap_or_default(),
        fire_at: row.try_get("fire_at").unwrap_or(0),
        note: row.try_get::<Option<String>, _>("note").ok().flatten(),
        watch: serde_json::from_str(&watch_json).unwrap_or_default(),
        cursors: serde_json::from_str(&cursors_json).unwrap_or_default(),
        status: SessionTimerStatus::parse(&row.try_get::<String, _>("status").unwrap_or_default()),
        created_at: row.try_get("created_at").unwrap_or(0),
        fired_at: row.try_get::<Option<i64>, _>("fired_at").ok().flatten(),
    }
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
    /// 同步会话的消息视图（**不可变追加语义**，A1 丙2 阶段 B）
    ///
    /// 传入选中的「当前视图」快照；实现须保证：
    /// 1. **新消息追加进不可变日志**（`session_log`，每条版本只写一次、永不更新删除）
    /// 2. **移出视图的消息只解除活跃引用**，其日志条目与内容**完整保留**
    /// 3. 追加一条事件记录（`session_events`）说明本次变化的规模
    ///
    /// 返回本次变化的三元组，便于调用方观测与测试断言。
    async fn replace_messages(
        &self,
        session_id: &str,
        messages: &[OrchestratorMessage],
    ) -> Result<ReplaceOutcome, CommandError>;
    /// 加载某会话当前活跃视图（按视图位置升序）
    async fn load_messages(&self, session_id: &str) -> Result<Vec<OrchestratorMessage>, CommandError>;
    /// 新增定时器记录（批次 C·S1；默认空实现 = 不支持持久化定时器的后端）
    async fn insert_timer(&self, _record: &SessionTimerRecord) -> Result<(), CommandError> {
        Ok(())
    }
    /// 列出会话未到期定时器（status = pending，按 fire_at 升序）
    async fn list_pending_timers(
        &self,
        _session_id: &str,
    ) -> Result<Vec<SessionTimerRecord>, CommandError> {
        Ok(Vec::new())
    }
    /// 认领到点定时器（**原子**：pending → fired）；`true` = 本次认领成功（唯一触发者）
    async fn claim_timer_fired(&self, _id: &str) -> Result<bool, CommandError> {
        Ok(false)
    }
    /// 取消定时器（pending → cancelled，仅限本会话）；`true` = 命中并取消
    async fn cancel_timer(&self, _session_id: &str, _id: &str) -> Result<bool, CommandError> {
        Ok(false)
    }
    /// 读取不可变日志片段（按日志坐标升序）—— 供 session 日志面板 / 审计 / 锚点回填
    ///
    /// 默认返回空（不支持日志的后端视为无日志可读）。
    async fn load_session_log(
        &self,
        _session_id: &str,
        _from_offset: i64,
        _limit: i64,
    ) -> Result<Vec<SessionLogEntry>, CommandError> {
        Ok(Vec::new())
    }
    /// 按日志坐标读单条（**锚点解析**：锚点 = `(session_id, log_offset)`）
    ///
    /// 默认返回 `None`。
    async fn read_log_entry(
        &self,
        _session_id: &str,
        _log_offset: i64,
    ) -> Result<Option<SessionLogEntry>, CommandError> {
        Ok(None)
    }
    /// 日志统计（总量 / 活跃 / 已移出视图 / 事件数）—— 供面板与健康检查
    ///
    /// 默认返回全零。
    async fn session_log_stats(&self, _session_id: &str) -> Result<SessionLogStats, CommandError> {
        Ok(SessionLogStats::default())
    }
    /// 读取事件流片段（按事件坐标升序）—— 供日志面板呈现「检查点」
    ///
    /// 默认返回空（不支持事件的后端视为无事件可读）。
    async fn load_session_events(
        &self,
        _session_id: &str,
        _from_seq: i64,
        _limit: i64,
    ) -> Result<Vec<SessionEventRecord>, CommandError> {
        Ok(Vec::new())
    }
    /// 读取活跃视图当前引用的日志坐标集合（按视图位置排列，非坐标数值排序）
    ///
    /// 供面板标记每条日志「活跃 / 已移出视图」——不含在集合中的坐标即内容仍
    /// 保留、但已不在模型上下文里。默认返回空。
    async fn load_live_offsets(&self, _session_id: &str) -> Result<Vec<i64>, CommandError> {
        Ok(Vec::new())
    }
    /// 追加一条请求快照（阶段 3 · ④；**幂等**——WAL 重放按内容摘要去重）
    ///
    /// 返回落库的请求序号（会话内单调递增）；重复内容返回 `None`（已存在）。
    /// 默认无操作（不支持的后端视为无快照可存）。
    async fn append_request_snapshot(
        &self,
        _session_id: &str,
        _snapshot: &RequestSnapshot,
    ) -> Result<Option<i64>, CommandError> {
        Ok(None)
    }
    /// 按序号升序读取请求快照（重建用）——须从 0 起读全（缺链时重建会拒绝）
    ///
    /// 默认返回空。
    async fn load_request_snapshots(
        &self,
        _session_id: &str,
        _from_seq: i64,
        _limit: i64,
    ) -> Result<Vec<RequestSnapshotRecord>, CommandError> {
        Ok(Vec::new())
    }
    /// 删除会话及其全部持久化痕迹（级联：视图 / 日志 / 事件）
    async fn delete_session(&self, session_id: &str) -> Result<(), CommandError>;
    /// 物理清理空会话（启动恢复时调用），返回清理条数。
    ///
    /// 判定 = 无任何活跃消息 && 非固定 && chat 类型——按**活跃视图**实况判定，
    /// 不依赖不可靠的 message_count 列（X1：该列仅创建期写入）；有活跃消息的会话绝不命中。
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
    /// 更新会话提示（写穿；H5 风险点③ 动态刷新 + A4 双端收口——技能/规则中途变更旧会话生效）
    ///
    /// `system_prompt` = 静态合集缓存文本；`prompt_sections` = 段 JSON（A4；None=清空/legacy）。
    async fn update_prompt(
        &self,
        session_id: &str,
        system_prompt: Option<&str>,
        prompt_sections: Option<&str>,
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
    pub(crate) pool: SqlitePool,
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

    /// 从请求快照去重池还原一个大对象（系统提示词 / 工具集）
    async fn load_request_blob(&self, content_hash: &str) -> Result<Option<String>, CommandError> {
        let row: Option<(String,)> =
            sqlx::query_as("SELECT content FROM request_blobs WHERE content_hash = ?1")
                .bind(content_hash)
                .fetch_optional(&self.pool)
                .await
                .map_err(|e| CommandError::Internal(format!("读取请求快照去重池失败: {e}")))?;
        Ok(row.map(|(content,)| content))
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
        // 迁移：A4 双端收口——静态注入带段 JSON 列（可空；旧库/群聊 legacy 为 NULL）
        let _ = sqlx::query("ALTER TABLE sessions ADD COLUMN prompt_sections TEXT")
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

        // ─── A1 丙2 阶段 B：不可变会话日志 ───────────────────────────
        //
        // 设计依据：docs/plans/2026-09-11-A1-记忆系统设计.md §5.5
        //
        // 此前 `messages` 表是**可变快照**：`replace_messages` = DELETE 全表 + 逐条
        // INSERT → 被裁消息**物理删除、不可恢复**，且坐标不稳定（同一位置在不同
        // 时刻指向不同消息）→ 锚点机制无底座。
        //
        // 改为「**不可变追加日志 + 活跃视图**」双层：
        //
        //   session_log   —— 只增不改不删；每条消息**版本**只写一次，带稳定坐标 log_offset
        //   session_live  —— 活跃视图：当前上下文中的消息按位置指向日志坐标（游标，可重写）
        //   session_events—— 每次同步追加一条事件（规模三元组），供日志面板与审计
        //
        // 关键区分：**日志不可变，视图可变**。「裁剪」= 从视图解除引用，日志内容不动。
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS session_log (
                session_id  TEXT NOT NULL,
                log_offset  INTEGER NOT NULL,
                msg_json    TEXT NOT NULL,
                recorded_at INTEGER NOT NULL,
                PRIMARY KEY (session_id, log_offset),
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            )",
        )
        .execute(pool)
        .await
        .map_err(|e| CommandError::Internal(format!("初始化会话日志表失败: {e}")))?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS session_live (
                session_id TEXT NOT NULL,
                position   INTEGER NOT NULL,
                log_offset INTEGER NOT NULL,
                PRIMARY KEY (session_id, position),
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            )",
        )
        .execute(pool)
        .await
        .map_err(|e| CommandError::Internal(format!("初始化活跃视图表失败: {e}")))?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS session_events (
                session_id TEXT NOT NULL,
                event_seq  INTEGER NOT NULL,
                event_kind TEXT NOT NULL,
                added      INTEGER NOT NULL,
                dropped    INTEGER NOT NULL,
                kept       INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                PRIMARY KEY (session_id, event_seq),
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            )",
        )
        .execute(pool)
        .await
        .map_err(|e| CommandError::Internal(format!("初始化会话事件表失败: {e}")))?;

        // 阶段 3 · ④（请求快照，D9-D14 裁定）：请求头快照 + 内容寻址去重池。
        // 快照 = 除消息以外的一切 + 视图增量（Appended/Full）——与 session_log 配合
        // 使任一请求可（结构级）重建；`request_blobs` 按内容哈希去重系统提示词与工具 schema。
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS request_snapshots (
                session_id     TEXT NOT NULL,
                request_seq    INTEGER NOT NULL,
                captured_at_ms INTEGER NOT NULL,
                purpose        TEXT NOT NULL,
                provider       TEXT NOT NULL,
                model_id       TEXT NOT NULL,
                snapshot_digest TEXT NOT NULL,
                snapshot_json  TEXT NOT NULL,
                system_hash    TEXT,
                tools_hash     TEXT,
                PRIMARY KEY (session_id, request_seq),
                UNIQUE (session_id, snapshot_digest),
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            )",
        )
        .execute(pool)
        .await
        .map_err(|e| CommandError::Internal(format!("初始化请求快照表失败: {e}")))?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS request_blobs (
                content_hash TEXT PRIMARY KEY,
                kind         TEXT NOT NULL,
                content      TEXT NOT NULL,
                created_at   INTEGER NOT NULL
            )",
        )
        .execute(pool)
        .await
        .map_err(|e| CommandError::Internal(format!("初始化请求快照去重池失败: {e}")))?;

        crate::session_branch::ensure_schema(pool).await?; // S3-b2：分叉 / 检查点 / 操作 mark 建表（幂等）

        // 迁移：旧库的 `messages` 快照 → 日志 + 视图（**一次性、幂等**）
        //
        // 迁移后 `messages` 表**保留但不再读写**（历史兼容留痕，不再作为事实源）；
        // 判定「是否已迁移」= `messages` 表存在 **且** 日志表为空（避免重复迁移把
        // 旧快照又灌一遍）。
        let legacy_exists: i64 = sqlx::query_as::<_, (i64,)>(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'messages'",
        )
        .fetch_one(pool)
        .await
        .map_err(|e| CommandError::Internal(format!("检查 messages 表失败: {e}")))?
        .0;
        if legacy_exists > 0 {
            let log_len: i64 = sqlx::query_as::<_, (i64,)>("SELECT COUNT(*) FROM session_log")
                .fetch_one(pool)
                .await
                .map_err(|e| CommandError::Internal(format!("统计会话日志失败: {e}")))?
                .0;
            if log_len == 0 {
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs() as i64)
                    .unwrap_or(0);
                // 旧快照的每条消息成为一条日志记录，坐标沿用原 seq；
                // 视图按相同位置铺满（迁移前的视图 = 全部消息）
                sqlx::query(
                    "INSERT INTO session_log (session_id, log_offset, msg_json, recorded_at)
                     SELECT session_id, seq, msg_json, ?1 FROM messages",
                )
                .bind(now)
                .execute(pool)
                .await
                .map_err(|e| CommandError::Internal(format!("迁移消息到会话日志失败: {e}")))?;
                sqlx::query(
                    "INSERT INTO session_live (session_id, position, log_offset)
                     SELECT session_id, seq, seq FROM messages",
                )
                .execute(pool)
                .await
                .map_err(|e| CommandError::Internal(format!("迁移消息到活跃视图失败: {e}")))?;
                // 为每个曾被写入过消息的会话补一条 initial 事件
                sqlx::query(
                    "INSERT INTO session_events (session_id, event_seq, event_kind, added, dropped, kept, created_at)
                     SELECT session_id, 0, 'initial', COUNT(*), 0, COUNT(*), ?1
                     FROM messages GROUP BY session_id",
                )
                .bind(now)
                .execute(pool)
                .await
                .map_err(|e| CommandError::Internal(format!("迁移会话事件失败: {e}")))?;
            }
        }

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

        // 定时器表（批次 C·S1，2026-09-20）：会话级一次性定时器——持久化 + 到期补投；
        // FK 级联（随会话删除，与 messages/session_log 同口径）。
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS session_timers (
                id           TEXT PRIMARY KEY,
                session_id   TEXT NOT NULL,
                fire_at      INTEGER NOT NULL,
                note         TEXT,
                watch_json   TEXT NOT NULL DEFAULT '[]',
                cursors_json TEXT NOT NULL DEFAULT '{}',
                status       TEXT NOT NULL DEFAULT 'pending',
                created_at   INTEGER NOT NULL,
                fired_at     INTEGER,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            )",
        )
        .execute(pool)
        .await
        .map_err(|e| CommandError::Internal(format!("建表 session_timers 失败: {e}")))?;
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_session_timers_session ON session_timers(session_id)",
        )
        .execute(pool)
        .await
        .map_err(|e| CommandError::Internal(format!("建索引 idx_session_timers_session 失败: {e}")))?;
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_session_timers_status ON session_timers(status)",
        )
        .execute(pool)
        .await
        .map_err(|e| CommandError::Internal(format!("建索引 idx_session_timers_status 失败: {e}")))?;

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
    // ─── 定时器（批次 C·S1，2026-09-20） ─────────────────────────

    async fn insert_timer(&self, record: &SessionTimerRecord) -> Result<(), CommandError> {
        sqlx::query(
            "INSERT INTO session_timers
                (id, session_id, fire_at, note, watch_json, cursors_json, status, created_at, fired_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        )
        .bind(&record.id)
        .bind(&record.session_id)
        .bind(record.fire_at)
        .bind(&record.note)
        .bind(serde_json::to_string(&record.watch).unwrap_or_else(|_| "[]".to_string()))
        .bind(serde_json::to_string(&record.cursors).unwrap_or_else(|_| "{}".to_string()))
        .bind(record.status.as_str())
        .bind(record.created_at)
        .bind(record.fired_at)
        .execute(&self.pool)
        .await
        .map_err(|e| CommandError::Internal(format!("写入定时器失败: {e}")))?;
        Ok(())
    }

    async fn list_pending_timers(
        &self,
        session_id: &str,
    ) -> Result<Vec<SessionTimerRecord>, CommandError> {
        let rows = sqlx::query(
            "SELECT id, session_id, fire_at, note, watch_json, cursors_json, status, created_at, fired_at
             FROM session_timers
             WHERE session_id = ?1 AND status = 'pending'
             ORDER BY fire_at ASC",
        )
        .bind(session_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| CommandError::Internal(format!("读取定时器失败: {e}")))?;
        Ok(rows.iter().map(timer_from_row).collect())
    }

    async fn claim_timer_fired(&self, id: &str) -> Result<bool, CommandError> {
        let fired_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        let res = sqlx::query(
            "UPDATE session_timers SET status = 'fired', fired_at = ?2
             WHERE id = ?1 AND status = 'pending'",
        )
        .bind(id)
        .bind(fired_at)
        .execute(&self.pool)
        .await
        .map_err(|e| CommandError::Internal(format!("认领定时器失败: {e}")))?;
        Ok(res.rows_affected() == 1)
    }

    async fn cancel_timer(&self, session_id: &str, id: &str) -> Result<bool, CommandError> {
        let res = sqlx::query(
            "UPDATE session_timers SET status = 'cancelled'
             WHERE id = ?1 AND session_id = ?2 AND status = 'pending'",
        )
        .bind(id)
        .bind(session_id)
        .execute(&self.pool)
        .await
        .map_err(|e| CommandError::Internal(format!("取消定时器失败: {e}")))?;
        Ok(res.rows_affected() == 1)
    }

    async fn save_session(&self, record: &SessionRecord) -> Result<(), CommandError> {
        // 注：sessions.router_enabled 列物理保留（历史数据兼容）但不再读写（FIX-4：开关废弃，指令化）
        sqlx::query(
            "INSERT INTO sessions (id, system_prompt, prompt_sections, created_at, message_count, updated_at, title, pinned, kind, workdir, workspace_id, project_id, scene_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
             ON CONFLICT(id) DO UPDATE SET
                system_prompt = ?2, prompt_sections = ?3, created_at = ?4, message_count = ?5, updated_at = ?6,
                title = ?7, pinned = ?8, kind = ?9, workdir = ?10, workspace_id = ?11, project_id = ?12, scene_id = ?13",
        )
        .bind(&record.id)
        .bind(&record.system_prompt)
        .bind(&record.prompt_sections)
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
            Option<String>,
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
                "SELECT id, system_prompt, prompt_sections, created_at, message_count, updated_at, title, pinned, kind, workdir, workspace_id, project_id, scene_id FROM sessions",
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
            Option<String>,
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
                "SELECT id, system_prompt, prompt_sections, created_at, message_count, updated_at, title, pinned, kind, workdir, workspace_id, project_id, scene_id FROM sessions WHERE kind = ?1",
            )
            .bind(kind_to_str(kind))
            .fetch_all(&self.pool)
            .await
            .map_err(|e| CommandError::Internal(format!("按类型读取会话列表失败: {e}")))?;
        Ok(rows.into_iter().map(record_from_row).collect())
    }

    /// 同步消息视图（不可变追加语义，A1 丙2 阶段 B）
    ///
    /// ## 对齐算法（旧视图 → 新视图）
    ///
    /// 调用方送来的是「当前完整视图」，本实现须推断出三类变化。按**首尾夹逼**对齐：
    ///
    /// 1. **公共前缀**：从头逐条 JSON 相等 → 保持原日志坐标（内容未变）
    /// 2. **公共后缀**：从尾逐条 JSON 相等（不与前缀重叠）→ 保持原日志坐标
    /// 3. **中段**：旧独有 = 移出视图（**只解除引用**）；新独有 = 追加日志（分配新坐标）
    ///
    /// 该算法覆盖真实调用形态：整段不变（全前缀命中）、尾部追加（全前缀命中）、
    /// 头部裁剪（全后缀命中）、就地修订尾部消息（末条进入"新独有"→ 旧版本留日志、
    /// 新版本重新记录）。
    ///
    /// **为何要首尾夹逼而不是只比前缀**：裁剪发生在**头部**，只比前缀会把
    /// 「保留的尾部」全部误判为「新增」→ 日志每次裁剪都翻倍膨胀，且尾部消息
    /// 的坐标不断漂移（锚点失效）。
    async fn replace_messages(
        &self,
        session_id: &str,
        messages: &[OrchestratorMessage],
    ) -> Result<ReplaceOutcome, CommandError> {
        // 1. 读当前视图（含各自日志坐标）
        let prev: Vec<(i64, String)> = sqlx::query_as(
            "SELECT l.log_offset, l.msg_json FROM session_live v \
             JOIN session_log l ON l.session_id = v.session_id AND l.log_offset = v.log_offset \
             WHERE v.session_id = ?1 ORDER BY v.position",
        )
        .bind(session_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| CommandError::Internal(format!("读取活跃视图失败: {e}")))?;

        // 2. 新视图序列化（一次，后面复用）
        let next_json: Vec<String> = messages
            .iter()
            .map(|m| serde_json::to_string(m))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| CommandError::Internal(format!("序列化消息失败: {e}")))?;

        // 3. 首尾夹逼对齐
        let (prev_len, next_len) = (prev.len(), next_json.len());
        let mut head = 0usize;
        while head < prev_len && head < next_len && prev[head].1 == next_json[head] {
            head += 1;
        }
        let mut tail = 0usize;
        while tail < (prev_len - head)
            && tail < (next_len - head)
            && prev[prev_len - 1 - tail].1 == next_json[next_len - 1 - tail]
        {
            tail += 1;
        }

        // 4. 计算新视图的坐标序列
        //    前缀段沿用旧坐标；后缀段沿用旧坐标；中段新增 → 新分配坐标
        let mut offsets: Vec<i64> = Vec::with_capacity(next_len);
        for i in 0..head {
            offsets.push(prev[i].0);
        }
        let mut new_added = 0i64;
        for i in head..(next_len - tail) {
            let _ = i;
            offsets.push(-1); // 占位，事务内分配
            new_added += 1;
        }
        for t in (0..tail).rev() {
            offsets.push(prev[prev_len - 1 - t].0);
        }

        let dropped = (prev_len - head - tail) as i64;
        let kept = next_len as i64;

        // 5. 单事务落库：分配坐标 → 追加日志 → 重写视图游标 → 追加事件
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| CommandError::Internal(format!("开启消息事务失败: {e}")))?;

        if new_added > 0 {
            let max_offset: i64 = sqlx::query_as::<_, (Option<i64>,)>(
                "SELECT MAX(log_offset) FROM session_log WHERE session_id = ?1",
            )
            .bind(session_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| CommandError::Internal(format!("查询日志末坐标失败: {e}")))?
            .0
            .unwrap_or(-1);

            let mut cursor = max_offset + 1;
            for (i, off) in offsets.iter_mut().enumerate() {
                if *off != -1 {
                    continue;
                }
                let json = &next_json[i];
                sqlx::query(
                    "INSERT INTO session_log (session_id, log_offset, msg_json, recorded_at) VALUES (?1, ?2, ?3, ?4)",
                )
                .bind(session_id)
                .bind(cursor)
                .bind(json)
                .bind(now)
                .execute(&mut *tx)
                .await
                .map_err(|e| CommandError::Internal(format!("追加会话日志失败: {e}")))?;
                *off = cursor;
                cursor += 1;
            }
        }

        // 重写视图游标（**这是游标不是日志**：日志内容不受影响）
        sqlx::query("DELETE FROM session_live WHERE session_id = ?1")
            .bind(session_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| CommandError::Internal(format!("清理旧视图游标失败: {e}")))?;
        for (position, off) in offsets.iter().enumerate() {
            sqlx::query(
                "INSERT INTO session_live (session_id, position, log_offset) VALUES (?1, ?2, ?3)",
            )
            .bind(session_id)
            .bind(position as i64)
            .bind(off)
            .execute(&mut *tx)
            .await
            .map_err(|e| CommandError::Internal(format!("写入视图游标失败: {e}")))?;
        }

        // 追加事件（不可变；event_seq 单调递增）
        let event_seq: i64 = sqlx::query_as::<_, (Option<i64>,)>(
            "SELECT MAX(event_seq) FROM session_events WHERE session_id = ?1",
        )
        .bind(session_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| CommandError::Internal(format!("查询事件末序号失败: {e}")))?
        .0
        .map(|v| v + 1)
        .unwrap_or(0);

        let kind = match (new_added > 0, dropped > 0) {
            (true, true) => "revise",
            (true, false) => {
                if prev_len == 0 {
                    "initial"
                } else {
                    "append"
                }
            }
            (false, true) => "trim",
            (false, false) => "noop",
        };
        sqlx::query(
            "INSERT INTO session_events (session_id, event_seq, event_kind, added, dropped, kept, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )
        .bind(session_id)
        .bind(event_seq)
        .bind(kind)
        .bind(new_added)
        .bind(dropped)
        .bind(kept)
        .bind(now)
        .execute(&mut *tx)
        .await
        .map_err(|e| CommandError::Internal(format!("追加会话事件失败: {e}")))?;

        tx.commit()
            .await
            .map_err(|e| CommandError::Internal(format!("提交消息事务失败: {e}")))?;

        if dropped > 0 {
            tracing::info!(
                session = %session_id,
                added = new_added,
                dropped,
                kept,
                kind,
                "会话视图已同步：{dropped} 条移出活跃视图（**内容保留在不可变日志中**，坐标不变）"
            );
        }

        Ok(ReplaceOutcome {
            added: new_added,
            dropped,
            kept,
            event_seq,
        })
    }

    async fn load_messages(&self, session_id: &str) -> Result<Vec<OrchestratorMessage>, CommandError> {
        let rows: Vec<(String,)> = sqlx::query_as(
            "SELECT l.msg_json FROM session_live v \
             JOIN session_log l ON l.session_id = v.session_id AND l.log_offset = v.log_offset \
             WHERE v.session_id = ?1 ORDER BY v.position",
        )
        .bind(session_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| CommandError::Internal(format!("读取活跃视图失败: {e}")))?;
        rows.into_iter()
            .map(|(json,)| {
                serde_json::from_str(&json)
                    .map_err(|e| CommandError::Internal(format!("解析会话消息失败: {e}")))
            })
            .collect()
    }

    async fn load_session_log(
        &self,
        session_id: &str,
        from_offset: i64,
        limit: i64,
    ) -> Result<Vec<SessionLogEntry>, CommandError> {
        let rows: Vec<(i64, String, i64)> = sqlx::query_as(
            "SELECT log_offset, msg_json, recorded_at FROM session_log \
             WHERE session_id = ?1 AND log_offset >= ?2 ORDER BY log_offset LIMIT ?3",
        )
        .bind(session_id)
        .bind(from_offset)
        .bind(limit)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| CommandError::Internal(format!("读取会话日志失败: {e}")))?;
        rows.into_iter()
            .map(|(log_offset, json, ts)| {
                Ok(SessionLogEntry {
                    log_offset,
                    message: serde_json::from_str(&json)
                        .map_err(|e| CommandError::Internal(format!("解析日志消息失败: {e}")))?,
                    recorded_at: ts as u64,
                })
            })
            .collect()
    }

    async fn read_log_entry(
        &self,
        session_id: &str,
        log_offset: i64,
    ) -> Result<Option<SessionLogEntry>, CommandError> {
        let row: Option<(String, i64)> = sqlx::query_as(
            "SELECT msg_json, recorded_at FROM session_log WHERE session_id = ?1 AND log_offset = ?2",
        )
        .bind(session_id)
        .bind(log_offset)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| CommandError::Internal(format!("读取日志条目失败: {e}")))?;
        match row {
            None => Ok(None),
            Some((json, ts)) => Ok(Some(SessionLogEntry {
                log_offset,
                message: serde_json::from_str(&json)
                    .map_err(|e| CommandError::Internal(format!("解析日志消息失败: {e}")))?,
                recorded_at: ts as u64,
            })),
        }
    }

    async fn session_log_stats(&self, session_id: &str) -> Result<SessionLogStats, CommandError> {
        let log_len: i64 = sqlx::query_as::<_, (i64,)>(
            "SELECT COUNT(*) FROM session_log WHERE session_id = ?1",
        )
        .bind(session_id)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| CommandError::Internal(format!("统计日志失败: {e}")))?
        .0;
        let live_len: i64 = sqlx::query_as::<_, (i64,)>(
            "SELECT COUNT(*) FROM session_live WHERE session_id = ?1",
        )
        .bind(session_id)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| CommandError::Internal(format!("统计视图失败: {e}")))?
        .0;
        let event_count: i64 = sqlx::query_as::<_, (i64,)>(
            "SELECT COUNT(*) FROM session_events WHERE session_id = ?1",
        )
        .bind(session_id)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| CommandError::Internal(format!("统计事件失败: {e}")))?
        .0;
        Ok(SessionLogStats {
            log_len,
            live_len,
            dropped_len: (log_len - live_len).max(0),
            event_count,
        })
    }

    async fn load_session_events(
        &self,
        session_id: &str,
        from_seq: i64,
        limit: i64,
    ) -> Result<Vec<SessionEventRecord>, CommandError> {
        let rows: Vec<(i64, String, i64, i64, i64, i64)> = sqlx::query_as(
            "SELECT event_seq, event_kind, added, dropped, kept, created_at FROM session_events \
             WHERE session_id = ?1 AND event_seq >= ?2 ORDER BY event_seq LIMIT ?3",
        )
        .bind(session_id)
        .bind(from_seq)
        .bind(limit)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| CommandError::Internal(format!("读取会话事件失败: {e}")))?;
        Ok(rows
            .into_iter()
            .map(
                |(event_seq, event_kind, added, dropped, kept, created_at)| SessionEventRecord {
                    event_seq,
                    event_kind,
                    added,
                    dropped,
                    kept,
                    created_at: created_at as u64,
                },
            )
            .collect())
    }

    async fn load_live_offsets(&self, session_id: &str) -> Result<Vec<i64>, CommandError> {
        let rows: Vec<(i64,)> = sqlx::query_as(
            "SELECT log_offset FROM session_live WHERE session_id = ?1 ORDER BY position",
        )
        .bind(session_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| CommandError::Internal(format!("读取活跃坐标失败: {e}")))?;
        Ok(rows.into_iter().map(|(offset,)| offset).collect())
    }

    async fn append_request_snapshot(
        &self,
        session_id: &str,
        snapshot: &RequestSnapshot,
    ) -> Result<Option<i64>, CommandError> {
        // 大对象入去重池（内容寻址：同系统提示词 / 同工具集只存一份）
        let system_hash = snapshot
            .system_prompt
            .as_ref()
            .map(|s| agent_memory::raw_store::hash_of(s));
        let tools_hash = snapshot
            .tools_json
            .as_ref()
            .map(|s| agent_memory::raw_store::hash_of(s));
        // 行内 JSON：大对象摘除（读取时由去重池还原）
        let mut slim = snapshot.clone();
        slim.system_prompt = None;
        slim.tools_json = None;
        let snapshot_json = serde_json::to_string(&slim)
            .map_err(|e| CommandError::Internal(format!("序列化请求快照失败: {e}")))?;
        // 幂等键：整条快照的内容摘要（WAL 重放时去重；同毫秒同内容视为同一条）
        let digest = agent_memory::raw_store::hash_of(&format!(
            "{session_id}|{}|{snapshot_json}",
            snapshot.captured_at_ms
        ));

        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| CommandError::Internal(format!("请求快照事务开启失败: {e}")))?;
        if let Some(system) = &snapshot.system_prompt {
            sqlx::query(
                "INSERT OR IGNORE INTO request_blobs (content_hash, kind, content, created_at) \
                 VALUES (?1, 'system', ?2, ?3)",
            )
            .bind(system_hash.as_deref())
            .bind(system)
            .bind(snapshot.captured_at_ms as i64)
            .execute(&mut *tx)
            .await
            .map_err(|e| CommandError::Internal(format!("写入系统提示词去重池失败: {e}")))?;
        }
        if let Some(tools) = &snapshot.tools_json {
            sqlx::query(
                "INSERT OR IGNORE INTO request_blobs (content_hash, kind, content, created_at) \
                 VALUES (?1, 'tools', ?2, ?3)",
            )
            .bind(tools_hash.as_deref())
            .bind(tools)
            .bind(snapshot.captured_at_ms as i64)
            .execute(&mut *tx)
            .await
            .map_err(|e| CommandError::Internal(format!("写入工具集去重池失败: {e}")))?;
        }

        // 序号 = 会话内 MAX+1；重复内容被 UNIQUE 约束忽略（不占用新序号）
        let seq: i64 = sqlx::query_as::<_, (Option<i64>,)>(
            "SELECT MAX(request_seq) FROM request_snapshots WHERE session_id = ?1",
        )
        .bind(session_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| CommandError::Internal(format!("查询请求快照末序号失败: {e}")))?
        .0
        .map(|v| v + 1)
        .unwrap_or(0);

        let affected = sqlx::query(
            "INSERT OR IGNORE INTO request_snapshots \
             (session_id, request_seq, captured_at_ms, purpose, provider, model_id, \
              snapshot_digest, snapshot_json, system_hash, tools_hash) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        )
        .bind(session_id)
        .bind(seq)
        .bind(snapshot.captured_at_ms as i64)
        .bind(&snapshot.purpose)
        .bind(&snapshot.provider)
        .bind(&snapshot.model_id)
        .bind(&digest)
        .bind(&snapshot_json)
        .bind(system_hash.as_deref())
        .bind(tools_hash.as_deref())
        .execute(&mut *tx)
        .await
        .map_err(|e| CommandError::Internal(format!("写入请求快照失败: {e}")))?
        .rows_affected();

        tx.commit()
            .await
            .map_err(|e| CommandError::Internal(format!("请求快照事务提交失败: {e}")))?;
        Ok(if affected > 0 { Some(seq) } else { None })
    }

    async fn load_request_snapshots(
        &self,
        session_id: &str,
        from_seq: i64,
        limit: i64,
    ) -> Result<Vec<RequestSnapshotRecord>, CommandError> {
        let rows = sqlx::query_as::<_, (i64, String, Option<String>, Option<String>)>(
            "SELECT request_seq, snapshot_json, system_hash, tools_hash FROM request_snapshots \
             WHERE session_id = ?1 AND request_seq >= ?2 ORDER BY request_seq ASC LIMIT ?3",
        )
        .bind(session_id)
        .bind(from_seq)
        .bind(limit)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| CommandError::Internal(format!("读取请求快照失败: {e}")))?;

        let mut out = Vec::with_capacity(rows.len());
        for (request_seq, snapshot_json, system_hash, tools_hash) in rows {
            let mut snapshot: RequestSnapshot = serde_json::from_str(&snapshot_json)
                .map_err(|e| CommandError::Internal(format!("解析请求快照失败: {e}")))?;
            if let Some(hash) = system_hash {
                snapshot.system_prompt = self.load_request_blob(&hash).await?;
            }
            if let Some(hash) = tools_hash {
                snapshot.tools_json = self.load_request_blob(&hash).await?;
            }
            out.push(RequestSnapshotRecord {
                request_seq,
                snapshot,
            });
        }
        Ok(out)
    }

    async fn delete_session(&self, session_id: &str) -> Result<(), CommandError> {
        // session_log / session_live / session_events 均有 ON DELETE CASCADE，删 sessions 行即级联清除
        sqlx::query("DELETE FROM sessions WHERE id = ?1")
            .bind(session_id)
            .execute(&self.pool)
            .await
            .map_err(|e| CommandError::Internal(format!("删除会话失败: {e}")))?;
        Ok(())
    }

    async fn purge_empty_sessions(&self) -> Result<u64, CommandError> {
        // 按**活跃视图**实况判定：无任何活跃消息的 chat 会话且未固定 → 物理删除
        //（子表级联无需处理——子查询保证无活跃视图；group_chat_sessions 映射仅挂 group 会话，不命中）
        let result = sqlx::query(
            "DELETE FROM sessions WHERE kind = 'chat' AND pinned = 0 \
             AND id NOT IN (SELECT DISTINCT session_id FROM session_live)",
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

    async fn update_prompt(
        &self,
        session_id: &str,
        system_prompt: Option<&str>,
        prompt_sections: Option<&str>,
    ) -> Result<(), CommandError> {
        sqlx::query("UPDATE sessions SET system_prompt = ?1, prompt_sections = ?2 WHERE id = ?3")
            .bind(system_prompt)
            .bind(prompt_sections)
            .bind(session_id)
            .execute(&self.pool)
            .await
            .map_err(|e| CommandError::Internal(format!("更新会话提示段失败: {e}")))?;
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
        prompt_sections,
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
        Option<String>,
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
        prompt_sections,
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
            prompt_sections: None,
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

    /// A4 双端收口：段 JSON 列往返（Some 保真、None=legacy 形态保真）
    #[tokio::test]
    async fn save_load_roundtrip_with_prompt_sections() {
        let store = SqliteSessionRepository::new_in_memory().await.unwrap();

        let mut with_sections = record("s-sections", 0);
        with_sections.prompt_sections =
            Some(r#"[{"name":"worldsea","order":200,"text":"系统说明"}]"#.to_string());
        store.save_session(&with_sections).await.unwrap();
        store.save_session(&record("s-legacy", 0)).await.unwrap();

        let all = store.load_sessions().await.unwrap();
        let loaded = all.iter().find(|r| r.id == "s-sections").unwrap();
        assert_eq!(
            loaded.prompt_sections.as_deref(),
            Some(r#"[{"name":"worldsea","order":200,"text":"系统说明"}]"#),
        );
        let legacy = all.iter().find(|r| r.id == "s-legacy").unwrap();
        assert_eq!(legacy.prompt_sections, None, "legacy 会话段列为 NULL");
    }

    /// A4 双端收口：update_prompt 双列写穿（缓存文本 + 段 JSON）
    #[tokio::test]
    async fn update_prompt_writes_both_columns() {
        let store = SqliteSessionRepository::new_in_memory().await.unwrap();
        store.save_session(&record("s1", 0)).await.unwrap();

        store
            .update_prompt(
                "s1",
                Some("缓存文本"),
                Some(r#"[{"name":"worldsea","order":200,"text":"系统说明"}]"#),
            )
            .await
            .unwrap();

        let all = store.load_sessions().await.unwrap();
        let r = all.iter().find(|x| x.id == "s1").unwrap();
        assert_eq!(r.system_prompt, "缓存文本");
        assert_eq!(
            r.prompt_sections.as_deref(),
            Some(r#"[{"name":"worldsea","order":200,"text":"系统说明"}]"#),
        );
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

    // ─── 定时器（批次 C·S1，2026-09-20） ─────────────────────

    fn timer(id: &str, session: &str, fire_at: i64) -> SessionTimerRecord {
        SessionTimerRecord {
            id: id.into(),
            session_id: session.into(),
            fire_at,
            note: Some("到点提醒".into()),
            watch: vec!["session-abc".into()],
            cursors: std::collections::HashMap::from([("session-abc".to_string(), 42i64)]),
            status: SessionTimerStatus::Pending,
            created_at: 100,
            fired_at: None,
        }
    }

    /// 状态机 + 原子认领：pending → fired 仅一次成功（重启补投/重放不重复触发）
    #[tokio::test]
    async fn timer_state_machine_and_atomic_claim() {
        let store = SqliteSessionRepository::new_in_memory().await.unwrap();
        store.save_session(&record("s1", 0)).await.unwrap();
        store.insert_timer(&timer("t1", "s1", 1000)).await.unwrap();
        let pending = store.list_pending_timers("s1").await.unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].id, "t1");
        assert_eq!(pending[0].watch, vec!["session-abc".to_string()]);
        assert_eq!(pending[0].cursors.get("session-abc"), Some(&42));
        // 认领：首次 true、二次 false
        assert!(store.claim_timer_fired("t1").await.unwrap());
        assert!(!store.claim_timer_fired("t1").await.unwrap());
        assert!(store.list_pending_timers("s1").await.unwrap().is_empty());
    }

    /// 取消的会话作用域 + 会话删除级联清理（FK 与既有子表同口径）
    #[tokio::test]
    async fn timer_cancel_scope_and_cascade_delete() {
        let store = SqliteSessionRepository::new_in_memory().await.unwrap();
        store.save_session(&record("s1", 0)).await.unwrap();
        store.save_session(&record("s2", 0)).await.unwrap();
        store.insert_timer(&timer("t1", "s1", 1000)).await.unwrap();
        // 跨会话取消 → 不命中
        assert!(!store.cancel_timer("s2", "t1").await.unwrap());
        assert_eq!(store.list_pending_timers("s1").await.unwrap().len(), 1);
        // 本会话取消 → 命中；已取消不可再认领
        assert!(store.cancel_timer("s1", "t1").await.unwrap());
        assert!(!store.claim_timer_fired("t1").await.unwrap());
        assert!(store.list_pending_timers("s1").await.unwrap().is_empty());
        // 会话删除 → 定时器随级联清理（列表按 session_id 直查，空 = 行确已删除）
        store.insert_timer(&timer("t2", "s1", 2000)).await.unwrap();
        store.delete_session("s1").await.unwrap();
        assert!(store.list_pending_timers("s1").await.unwrap().is_empty());
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

    // ─── A1 丙2 阶段 B：不可变会话日志 ───────────────────────

    /// ★ 核心契约：裁剪**不丢内容**——移出视图的消息完整保留在不可变日志中
    ///
    /// 这修正了改造前的行为（`replace_messages` = DELETE 全表 + INSERT →
    /// 被裁消息物理删除、不可恢复）。
    #[tokio::test]
    async fn trim_keeps_dropped_content_in_immutable_log() {
        let store = SqliteSessionRepository::new_in_memory().await.unwrap();
        store.save_session(&record("s1", 4)).await.unwrap();

        let full = vec![
            msg(MessageRole::User, "第一轮提问"),
            msg(MessageRole::Assistant, "第一轮回答"),
            msg(MessageRole::User, "第二轮提问"),
            msg(MessageRole::Assistant, "第二轮回答"),
        ];
        store.replace_messages("s1", &full).await.unwrap();

        // 头部裁掉前两条（典型上下文裁剪）
        let trimmed = vec![full[2].clone(), full[3].clone()];
        let outcome = store.replace_messages("s1", &trimmed).await.unwrap();
        assert_eq!(outcome.dropped, 2, "应移出视图 2 条");
        assert_eq!(outcome.added, 0, "被保留的尾部不应重新入日志（坐标复用）");
        assert_eq!(outcome.kept, 2);

        // 视图只剩后两条
        let loaded = store.load_messages("s1").await.unwrap();
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].content, "第二轮提问");

        // ★ 但日志里有全部 4 条（前两条内容未丢）
        let log = store.load_session_log("s1", 0, 100).await.unwrap();
        assert_eq!(log.len(), 4, "日志应保留全部 4 个消息版本");
        assert_eq!(log[0].message.content, "第一轮提问");
        assert_eq!(log[1].message.content, "第一轮回答");

        // 统计口径自洽
        let stats = store.session_log_stats("s1").await.unwrap();
        assert_eq!(stats.log_len, 4);
        assert_eq!(stats.live_len, 2);
        assert_eq!(stats.dropped_len, 2, "已移出视图 2 条");
    }

    /// ★ 稳定坐标：尾部消息在多次头部裁剪后 **log_offset 不变**（锚点可寻址）
    ///
    /// 这是「锚点 = 稳定坐标」的最小验证——改造前 `messages.seq` 每轮全量重写，
    /// 同一 seq 在不同时刻指向不同消息，坐标不成立。
    #[tokio::test]
    async fn log_offsets_are_stable_across_repeated_trims() {
        let store = SqliteSessionRepository::new_in_memory().await.unwrap();
        store.save_session(&record("s1", 6)).await.unwrap();

        let full: Vec<_> = (0..6)
            .map(|i| msg(MessageRole::User, &format!("消息{i}")))
            .collect();
        store.replace_messages("s1", &full).await.unwrap();

        // 记录「消息5」的坐标
        let anchor = {
            let log = store.load_session_log("s1", 0, 100).await.unwrap();
            let entry = log.iter().find(|e| e.message.content == "消息5").unwrap();
            entry.log_offset
        };

        // 连续三次头部裁剪
        for cut in [1usize, 2, 3] {
            let kept: Vec<_> = full[cut..].to_vec();
            store.replace_messages("s1", &kept).await.unwrap();
        }

        // ★ 锚点仍指向同一条消息
        let resolved = store.read_log_entry("s1", anchor).await.unwrap().unwrap();
        assert_eq!(
            resolved.message.content, "消息5",
            "锚点坐标必须稳定：多次裁剪后仍指向同一条消息"
        );

        // 且日志没有因裁剪而膨胀（尾部坐标复用，未重复入日志）
        let stats = store.session_log_stats("s1").await.unwrap();
        assert_eq!(stats.log_len, 6, "裁剪不应新增日志条目（坐标复用）");
        assert_eq!(stats.live_len, 3);
    }

    /// 增量追加：只把新消息写进日志
    #[tokio::test]
    async fn append_only_records_new_messages() {
        let store = SqliteSessionRepository::new_in_memory().await.unwrap();
        store.save_session(&record("s1", 3)).await.unwrap();

        let v1 = vec![msg(MessageRole::User, "A")];
        let o1 = store.replace_messages("s1", &v1).await.unwrap();
        assert_eq!((o1.added, o1.dropped, o1.kept), (1, 0, 1), "首次写入");

        let v2 = vec![
            msg(MessageRole::User, "A"),
            msg(MessageRole::Assistant, "B"),
        ];
        let o2 = store.replace_messages("s1", &v2).await.unwrap();
        assert_eq!((o2.added, o2.dropped, o2.kept), (1, 0, 2), "仅新增 1 条");

        let v3 = vec![
            msg(MessageRole::User, "A"),
            msg(MessageRole::Assistant, "B"),
            msg(MessageRole::User, "C"),
        ];
        let o3 = store.replace_messages("s1", &v3).await.unwrap();
        assert_eq!((o3.added, o3.dropped, o3.kept), (1, 0, 3));

        let stats = store.session_log_stats("s1").await.unwrap();
        assert_eq!(stats.log_len, 3, "日志 = 3 个版本（无重复记录）");
        assert_eq!(stats.event_count, 3);
    }

    /// 就地修订尾部消息：**旧版本留日志、新版本重新记录**（编辑不抹除历史）
    #[tokio::test]
    async fn in_place_revision_preserves_previous_version() {
        let store = SqliteSessionRepository::new_in_memory().await.unwrap();
        store.save_session(&record("s1", 2)).await.unwrap();

        let v1 = vec![
            msg(MessageRole::User, "提问"),
            msg(MessageRole::Assistant, "初版回答"),
        ];
        store.replace_messages("s1", &v1).await.unwrap();

        // 模拟 merge_last_assistant_meta：最后一条 assistant 内容被改写
        let v2 = vec![
            msg(MessageRole::User, "提问"),
            msg(MessageRole::Assistant, "补充元数据后的回答"),
        ];
        let o2 = store.replace_messages("s1", &v2).await.unwrap();
        assert_eq!(o2.added, 1, "修订版应作为新版本入日志");
        assert_eq!(o2.dropped, 1, "旧版本移出视图");

        // 视图是最新版
        let loaded = store.load_messages("s1").await.unwrap();
        assert_eq!(loaded[1].content, "补充元数据后的回答");

        // 日志里两个版本都在（历史不被抹除）
        let log = store.load_session_log("s1", 0, 100).await.unwrap();
        assert_eq!(log.len(), 3, "1(user) + 2(assistant 两版)");
        assert!(log.iter().any(|e| e.message.content == "初版回答"));
        assert!(log.iter().any(|e| e.message.content == "补充元数据后的回答"));
    }

    /// 无变化同步：不产生新日志条目，事件类型标记为 noop（幂等）
    #[tokio::test]
    async fn identical_resync_is_noop() {
        let store = SqliteSessionRepository::new_in_memory().await.unwrap();
        store.save_session(&record("s1", 2)).await.unwrap();

        let v = vec![
            msg(MessageRole::User, "A"),
            msg(MessageRole::Assistant, "B"),
        ];
        store.replace_messages("s1", &v).await.unwrap();
        let before = store.session_log_stats("s1").await.unwrap();

        let o = store.replace_messages("s1", &v).await.unwrap();
        assert!(o.is_noop(), "同内容同步应无变化: {o:?}");

        let after = store.session_log_stats("s1").await.unwrap();
        assert_eq!(after.log_len, before.log_len, "日志不应增长");
        assert_eq!(after.event_count, before.event_count + 1, "但事件仍留痕（审计）");
    }

    /// 清空历史 = 视图清空；**日志仍保留全部内容**（可回溯）
    #[tokio::test]
    async fn clear_history_empties_view_but_keeps_log() {
        let store = SqliteSessionRepository::new_in_memory().await.unwrap();
        store.save_session(&record("s1", 2)).await.unwrap();

        let v = vec![
            msg(MessageRole::User, "将被清空 A"),
            msg(MessageRole::Assistant, "将被清空 B"),
        ];
        store.replace_messages("s1", &v).await.unwrap();

        let o = store.replace_messages("s1", &[]).await.unwrap();
        assert_eq!(o.dropped, 2);
        assert!(store.load_messages("s1").await.unwrap().is_empty(), "视图已清空");

        let stats = store.session_log_stats("s1").await.unwrap();
        assert_eq!(stats.log_len, 2, "清空历史不应销毁日志");
        assert_eq!(stats.live_len, 0);
    }

    /// 锚点解析：未知坐标返回 None（不 panic、不误指）
    #[tokio::test]
    async fn unknown_anchor_resolves_to_none() {
        let store = SqliteSessionRepository::new_in_memory().await.unwrap();
        store.save_session(&record("s1", 1)).await.unwrap();
        store
            .replace_messages("s1", &[msg(MessageRole::User, "A")])
            .await
            .unwrap();

        assert!(store.read_log_entry("s1", 999).await.unwrap().is_none());
        assert!(store.read_log_entry("s1", -1).await.unwrap().is_none());
        // 跨会话不串味
        store.save_session(&record("s2", 1)).await.unwrap();
        assert!(store.read_log_entry("s2", 0).await.unwrap().is_none());
    }

    /// 日志分段读取（供前端日志面板分页）
    #[tokio::test]
    async fn log_can_be_paged() {
        let store = SqliteSessionRepository::new_in_memory().await.unwrap();
        store.save_session(&record("s1", 5)).await.unwrap();
        let v: Vec<_> = (0..5)
            .map(|i| msg(MessageRole::User, &format!("m{i}")))
            .collect();
        store.replace_messages("s1", &v).await.unwrap();

        let page1 = store.load_session_log("s1", 0, 2).await.unwrap();
        assert_eq!(page1.len(), 2);
        assert_eq!(page1[0].log_offset, 0);
        let page2 = store.load_session_log("s1", 2, 2).await.unwrap();
        assert_eq!(page2[0].log_offset, 2);
        assert_eq!(page2[0].message.content, "m2");
        // 分页不重不漏
        let rest = store.load_session_log("s1", 4, 10).await.unwrap();
        assert_eq!(rest.len(), 1);
    }

    /// 事件流（检查点留痕）：类型与规模三元组逐条落账，可分页读取
    #[tokio::test]
    async fn event_trail_records_kind_and_scale() {
        let store = SqliteSessionRepository::new_in_memory().await.unwrap();
        store.save_session(&record("s1", 2)).await.unwrap();
        let a = msg(MessageRole::User, "A");
        let b = msg(MessageRole::Assistant, "B");
        let c = msg(MessageRole::User, "C");

        // 四种事件类型各走一次：initial → append → trim → revise
        store.replace_messages("s1", &[a.clone(), b.clone()]).await.unwrap();
        store
            .replace_messages("s1", &[a, b.clone(), c.clone()])
            .await
            .unwrap();
        store.replace_messages("s1", &[b, c.clone()]).await.unwrap();
        store
            .replace_messages("s1", &[msg(MessageRole::Assistant, "B2"), c])
            .await
            .unwrap();

        let events = store.load_session_events("s1", 0, 100).await.unwrap();
        let kinds: Vec<&str> = events.iter().map(|e| e.event_kind.as_str()).collect();
        assert_eq!(kinds, vec!["initial", "append", "trim", "revise"]);
        assert_eq!((events[0].added, events[0].dropped, events[0].kept), (2, 0, 2));
        assert_eq!((events[1].added, events[1].dropped, events[1].kept), (1, 0, 3));
        assert_eq!((events[2].added, events[2].dropped, events[2].kept), (0, 1, 2));
        assert_eq!((events[3].added, events[3].dropped, events[3].kept), (1, 1, 2));
        assert_eq!(events[0].event_seq, 0);
        assert!(events[0].created_at > 0, "事件须带时点");
        for w in events.windows(2) {
            assert!(w[1].event_seq > w[0].event_seq, "事件坐标必须单调递增");
        }

        // 分页：不重不漏
        let page = store.load_session_events("s1", 2, 1).await.unwrap();
        assert_eq!(page.len(), 1);
        assert_eq!(page[0].event_kind, "trim");

        // 跨会话不串味
        store.save_session(&record("s2", 0)).await.unwrap();
        assert!(store.load_session_events("s2", 0, 10).await.unwrap().is_empty());
    }

    /// 活跃坐标集合与视图一致：移出视图的坐标消失、修订后的新坐标出现
    #[tokio::test]
    async fn live_offsets_reflect_current_view() {
        let store = SqliteSessionRepository::new_in_memory().await.unwrap();
        store.save_session(&record("s1", 3)).await.unwrap();
        let a = msg(MessageRole::User, "A");
        let b = msg(MessageRole::Assistant, "B");
        let c = msg(MessageRole::User, "C");

        store.replace_messages("s1", &[a, b.clone(), c.clone()]).await.unwrap();
        assert_eq!(store.load_live_offsets("s1").await.unwrap(), vec![0, 1, 2]);

        // 头部裁剪：坐标 0 移出视图（内容仍在日志）
        store.replace_messages("s1", &[b, c.clone()]).await.unwrap();
        assert_eq!(store.load_live_offsets("s1").await.unwrap(), vec![1, 2]);

        // 就地修订 B → B2：旧坐标 1 移出、新坐标 3 进入
        store
            .replace_messages("s1", &[msg(MessageRole::Assistant, "B2"), c])
            .await
            .unwrap();
        let live = store.load_live_offsets("s1").await.unwrap();
        assert_eq!(live, vec![3, 2], "按视图位置排列（修订的新版本在前）");
        assert!(!live.contains(&1), "旧版本坐标必须已移出活跃集合");
    }

    /// 删除会话：日志 / 视图 / 事件一并级联清除（不留孤儿）
    #[tokio::test]
    async fn delete_session_cascades_log_and_events() {
        let store = SqliteSessionRepository::new_in_memory().await.unwrap();
        store.save_session(&record("s1", 2)).await.unwrap();
        store
            .replace_messages("s1", &[msg(MessageRole::User, "A"), msg(MessageRole::Assistant, "B")])
            .await
            .unwrap();

        store.delete_session("s1").await.unwrap();
        let stats = store.session_log_stats("s1").await.unwrap();
        assert_eq!(stats, SessionLogStats::default(), "删除后应无任何残留: {stats:?}");
    }

    /// 旧库迁移：既有 `messages` 快照 → 日志 + 视图（幂等，不重复灌）
    #[tokio::test]
    async fn legacy_messages_snapshot_migrates_to_log() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("sessions.db");
        let path = db_path.to_str().unwrap().to_string();

        // ① 先造一个「改造前形态」的旧库：只有 sessions + messages 两表且有数据。
        //    直接用 sqlx 建（不经仓储），模拟历史版本留下的库文件。
        {
            let opts = sqlx::sqlite::SqliteConnectOptions::new()
                .filename(&path)
                .create_if_missing(true);
            let pool = sqlx::SqlitePool::connect_with(opts).await.unwrap();
            sqlx::query(
                "CREATE TABLE sessions (
                    id            TEXT PRIMARY KEY,
                    system_prompt TEXT NOT NULL,
                    created_at    INTEGER NOT NULL,
                    message_count INTEGER NOT NULL,
                    updated_at    INTEGER NOT NULL
                )",
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                "CREATE TABLE messages (
                    session_id TEXT NOT NULL,
                    seq        INTEGER NOT NULL,
                    msg_json   TEXT NOT NULL,
                    PRIMARY KEY (session_id, seq),
                    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
                )",
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO sessions (id, system_prompt, created_at, message_count, updated_at)
                 VALUES ('s1', 'sys', 1, 2, 1)",
            )
            .execute(&pool)
            .await
            .unwrap();
            for (seq, m) in [
                (0_i64, msg(MessageRole::User, "旧消息A")),
                (1_i64, msg(MessageRole::Assistant, "旧消息B")),
            ] {
                sqlx::query("INSERT INTO messages (session_id, seq, msg_json) VALUES (?1, ?2, ?3)")
                    .bind("s1")
                    .bind(seq)
                    .bind(serde_json::to_string(&m).unwrap())
                    .execute(&pool)
                    .await
                    .unwrap();
            }
            pool.close().await;
        }

        // ② 打开仓储（init 触发迁移）
        let store = SqliteSessionRepository::new(&path).await.unwrap();
        let loaded = store.load_messages("s1").await.unwrap();
        assert_eq!(loaded.len(), 2, "旧快照应迁移进活跃视图");
        assert_eq!(loaded[0].content, "旧消息A");

        let log = store.load_session_log("s1", 0, 100).await.unwrap();
        assert_eq!(log.len(), 2, "旧快照应迁移进日志");
        assert_eq!(log[1].message.content, "旧消息B");

        let stats = store.session_log_stats("s1").await.unwrap();
        assert_eq!(stats.event_count, 1, "应补一条 initial 事件");
        assert_eq!(stats.dropped_len, 0);

        // ③ 迁移后仍可正常增量写入（坐标从旧 seq 之后继续）
        let o = store
            .replace_messages(
                "s1",
                &[
                    msg(MessageRole::User, "旧消息A"),
                    msg(MessageRole::Assistant, "旧消息B"),
                    msg(MessageRole::User, "新消息C"),
                ],
            )
            .await
            .unwrap();
        assert_eq!(o.added, 1, "仅新增第三条");
        assert_eq!(
            store.load_session_log("s1", 0, 100).await.unwrap().len(),
            3
        );

        // ④ 幂等：再开一次不重复迁移
        let store2 = SqliteSessionRepository::new(&path).await.unwrap();
        let stats2 = store2.session_log_stats("s1").await.unwrap();
        assert_eq!(stats2.log_len, 3, "重复打开不应重复迁移");
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
        let with_msg = record("with-msg", 0); // 有消息 → 保留
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

    // ─── 请求快照（阶段 3 · ④）────────────

    fn snapshot_with(view: Vec<OrchestratorMessage>, full: bool, captured_at_ms: u64) -> RequestSnapshot {
        use agent_runtime::agent::request_snapshot::ViewUpdate;
        RequestSnapshot {
            captured_at_ms,
            purpose: "main".into(),
            provider: "deepseek".into(),
            model_id: "deepseek-v4-flash".into(),
            temperature: Some(0.7),
            max_tokens: None,
            top_p: None,
            top_k: None,
            thinking_mode: None,
            thinking_level: None,
            silent: false,
            system_prompt: Some("系统提示词（大对象）".into()),
            tools_json: Some(r#"[{"name":"echo"}]"#.into()),
            tools_names: vec!["echo".into()],
            material_ref: None,
            view_update: if full {
                ViewUpdate::Full { messages: view }
            } else {
                ViewUpdate::Appended { messages: view }
            },
        }
    }

    /// 往返 + 重建：全量 + 增量链可还原目标请求视图；大对象经去重池保真
    #[tokio::test]
    async fn request_snapshot_roundtrip_and_reconstruction() {
        let store = SqliteSessionRepository::new_in_memory().await.unwrap();
        store.save_session(&record("s-snap", 0)).await.unwrap();

        // seq0 全量（带大对象）；seq1 增量（同系统提示词 → 去重）；seq2 无大对象
        let s0 = snapshot_with(vec![msg(MessageRole::User, "你好")], true, 1_000);
        let s1 = snapshot_with(vec![msg(MessageRole::Assistant, "回答一")], false, 1_001);
        let mut s2 = snapshot_with(vec![msg(MessageRole::User, "继续")], false, 1_002);
        s2.system_prompt = None;
        s2.tools_json = None;
        s2.tools_names = Vec::new();

        assert_eq!(
            store.append_request_snapshot("s-snap", &s0).await.unwrap(),
            Some(0)
        );
        assert_eq!(
            store.append_request_snapshot("s-snap", &s1).await.unwrap(),
            Some(1)
        );
        assert_eq!(
            store.append_request_snapshot("s-snap", &s2).await.unwrap(),
            Some(2)
        );

        let records = store.load_request_snapshots("s-snap", 0, 100).await.unwrap();
        assert_eq!(records.len(), 3);
        // 大对象还原保真
        assert_eq!(
            records[0].snapshot.system_prompt.as_deref(),
            Some("系统提示词（大对象）")
        );
        assert_eq!(
            records[1].snapshot.system_prompt.as_deref(),
            Some("系统提示词（大对象）"),
            "去重池还原应保真"
        );
        assert!(records[2].snapshot.system_prompt.is_none());
        assert_eq!(
            records[0].snapshot.tools_json.as_deref(),
            Some(r#"[{"name":"echo"}]"#)
        );

        // 重建任意请求：全量基底 + 其后增量
        let (target, view) = reconstruct_request_view(&records, 2).expect("应可重建");
        assert_eq!(target.request_seq, 2);
        let contents: Vec<&str> = view.iter().map(|m| m.content.as_str()).collect();
        assert_eq!(contents, vec!["你好", "回答一", "继续"]);
        let (_, view0) = reconstruct_request_view(&records, 0).expect("应可重建");
        assert_eq!(view0.len(), 1, "目标为全量时直接返回其视图");
    }

    /// 去重池只存一份大对象；重复快照（WAL 重放）幂等；缺链拒绝重建
    #[tokio::test]
    async fn request_snapshot_dedupes_blobs_and_replay() {
        let store = SqliteSessionRepository::new_in_memory().await.unwrap();
        store.save_session(&record("s-dedup", 0)).await.unwrap();

        let a = snapshot_with(vec![msg(MessageRole::User, "A")], true, 2_000);
        let b = snapshot_with(vec![msg(MessageRole::Assistant, "B")], false, 2_001);
        assert_eq!(
            store.append_request_snapshot("s-dedup", &a).await.unwrap(),
            Some(0)
        );
        assert_eq!(
            store.append_request_snapshot("s-dedup", &b).await.unwrap(),
            Some(1)
        );
        // WAL 重放同一条 → 幂等忽略（不重复入库、不占新序号）
        assert_eq!(store.append_request_snapshot("s-dedup", &b).await.unwrap(), None);

        let blob_count: i64 = sqlx::query_as::<_, (i64,)>("SELECT COUNT(*) FROM request_blobs")
            .fetch_one(&store.pool)
            .await
            .unwrap()
            .0;
        assert_eq!(blob_count, 2, "系统提示词 + 工具集各一份（内容寻址去重）");
        let row_count: i64 =
            sqlx::query_as::<_, (i64,)>("SELECT COUNT(*) FROM request_snapshots")
                .fetch_one(&store.pool)
                .await
                .unwrap()
                .0;
        assert_eq!(row_count, 2, "重放不应新增行");

        // 缺全量基底（只读到增量）→ 拒绝重建
        let partial = store.load_request_snapshots("s-dedup", 1, 10).await.unwrap();
        assert!(
            reconstruct_request_view(&partial, 1).is_none(),
            "链不完整应拒绝重建（绝不给错误结果）"
        );
    }
}