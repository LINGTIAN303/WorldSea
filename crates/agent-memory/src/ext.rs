//! # 记忆扩展库（memory_ext.db）
//!
//! A1 设计文档 §3.1「甲4 收窄」的落地：**vendor DDL 一字不改**，A1 引入的全部新概念
//! 落在本库。与 `memories.db` 之间以 `memory_id` / `hook_id` 做**软外键**——
//! 跨库不建 DB 级外键，一致性由应用层的写入顺序保证（先写 `memories.db`，再写本库）。
//!
//! 设计依据：`docs/plans/2026-09-11-A1-记忆系统设计.md` §3.1（数据模型）。
//!
//! ## 五张表
//!
//! | 表 | 用途 |
//! |---|---|
//! | `memory_ext` | 补齐 [`MemoryAccessor`](agent_runtime::memory::MemoryAccessor) 声明、但 `memories.db` 中**无落脚处**的 4 个字段 |
//! | `hook_tags` | **真标签**维度（原 `hooks.tags` 列被挪用来存 `output_types`） |
//! | `supersede_chain` | 矛盾**调和链**（不覆盖旧值，只记录新旧与时序） |
//! | `raw_ref` | 外置原文**引用表**（GC 判据来源） |
//! | `ext_meta` | 本库 schema 版本 |
//!
//! ## 两处实现级取舍（与设计文档的对应关系）
//!
//! 1. **连接形态**：设计文档写「独立连接池」，此处实现为 `Mutex<Connection>` 单连接。
//!    理由：本库写入频率低（每轮至多数次）、单进程独占，单连接已足够，且省掉
//!    `r2d2` / `r2d2_sqlite` 两个依赖边。后续若出现并发写压力，替换为连接池是**局部改动**。
//! 2. **`raw_ref.ref_count` 不落列**：设计文档的列清单含 `ref_count`，此处改为
//!    **由 `COUNT` 派生**（主键三元组 `(content_hash, owner_kind, owner_id)` 天然去重）。
//!    理由：存储计数器会与行数据形成**第二个事实源**并可能漂移；派生计数在带索引的
//!    主键上代价可忽略且始终自洽。

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use rusqlite::{Connection, OptionalExtension};

use crate::{Error, Result};

/// 本库 schema 版本（写入 `ext_meta.schema_version`）
///
/// - v1（2026-09-11）：五表初版
/// - v2（2026-09-11）：`supersede_chain` 增 `summary` 列（调和摘要，甲2）
const SCHEMA_VERSION: u32 = 2;

/// 外置引用持有方类型（`raw_ref.owner_kind`）
pub mod owner_kind {
    /// 上下文锚点（条级外置：超长内容在上下文中的前后锚点对）
    pub const CONTEXT_ANCHOR: &str = "context_anchor";
    /// 归档原文（批次级外置：pre_compress_hook 写入的整段未摘要上下文）
    pub const ARCHIVE: &str = "archive";
}

/// 标签来源（`hook_tags.tag_kind`）
pub mod tag_kind {
    /// 用户显式打的标签
    pub const USER: &str = "user";
    /// 系统自动抽取
    pub const AUTO: &str = "auto";
    /// 来自实体记忆的实体引用（甲0② 实体桥接）
    pub const ENTITY: &str = "entity";
    /// 关键词
    pub const KEYWORD: &str = "keyword";
}

/// `memory_ext` 一行：补齐契约声明的 4 个字段
///
/// **键设计（施工期细化，见设计文档 §3.1）**：主键仍是 `memory_id`（对齐上游归档单元），
/// 但**另带 `hook_id` 唯列**——原因是 trait 面以 hook_id 为访问键
/// （`pin(hook_id)` / `touch(hook_id)` / `MemoryRecallResult.hook_id`），
/// 若只有 memory_id 则每次置顶/计数都要先反查，徒增一次跨表查询。
/// 归档流程中 hook ↔ memory 为 1:1（一 MemoryFile 对应一 IndexHook），故不引入歧义。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemoryExt {
    /// 记忆文件 ID（= `memories.memory_id`）
    pub memory_id: String,
    /// 索引钩子 ID（= `hooks.hook_id`；trait 面的访问键）
    pub hook_id: String,
    /// **记忆发生时点**（Unix 毫秒）——区别于 `memories.archived_at`（归档时点）
    pub created_at: i64,
    /// 访问次数（甲3 淘汰的加权依据）
    pub access_count: u32,
    /// 永久保留标记（pinned 记忆不衰减、不淘汰）
    pub pinned: bool,
    /// 摘要生成方式（`llm` / `rule` / `none`，对齐 `SummaryMethod` 的 serde 形态）
    pub summary_method: String,
}

/// `raw_ref` 一行：外置原文的一条引用
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawRef {
    /// 内容寻址哈希（sha256 前 16 位）
    pub content_hash: String,
    /// 持有方类型，见 [`owner_kind`]
    pub owner_kind: String,
    /// 持有方 ID（锚点 ID 或 hook_id）
    pub owner_id: String,
    /// 是否受保护（pinned 引用不参与 GC）
    pub pinned: bool,
    /// 写入时点（Unix 毫秒）
    pub stored_at: i64,
    /// 软删标记时点（Unix 毫秒）；`None` = 有效
    pub deleted_at: Option<i64>,
}

/// `memory_ext` 中的一条置顶引用（供跨会话渲染 `MEMORY.md` 用）
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PinnedEntry {
    /// 索引钩子 ID
    pub hook_id: String,
    /// 记忆文件 ID（可直接喂 `Storage::read_memory` 取正文，无需会话级索引）
    pub memory_id: String,
    /// 记忆发生时点（Unix 毫秒）
    pub created_at: i64,
}

/// `supersede_chain` 一行：一次调和记录
///
/// 对应设计文档 §4.1 的「C 条」——**矛盾不覆盖**的落地凭据：原始双方均保留，
/// 取代关系与时序另立记录。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SupersedeLink {
    /// 被取代的旧条目
    pub old_hook_id: String,
    /// 取代它的新条目
    pub new_hook_id: String,
    /// 机器可读的判定依据（冲突类型名 / `revision`）
    pub reason: String,
    /// 人文可读的调和摘要（`None` = 未生成）
    pub summary: Option<String>,
    /// 判定时点（Unix 毫秒）
    pub decided_at: i64,
}

/// 记忆扩展库（`{root}/projects/{project_id or "_default"}/memory_ext.db`）
///
/// 路径规则与 `memory-center-core` 的 `SqliteStorage` **完全一致**（同目录、同 project 分片），
/// 便于运维侧一眼看出「一个项目一套记忆 = 两个库 + 一份外置原文」。
pub struct ExtStore {
    /// 数据库文件路径
    db_path: PathBuf,
    /// 单连接（见模块头「实现级取舍 1」）
    conn: Arc<Mutex<Connection>>,
}

impl std::fmt::Debug for ExtStore {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ExtStore").field("db_path", &self.db_path).finish()
    }
}

impl ExtStore {
    /// 打开（不存在则创建）扩展库
    ///
    /// - `root`：记忆存储根目录（与传给 `MemoryCenterAccessor::new_sqlite` 的同源）
    /// - `project_id`：项目 ID；`None` 时落 `_default` 分片
    pub fn open(root: impl Into<PathBuf>, project_id: Option<String>) -> Result<Self> {
        let root = root.into();
        let project_dir = match &project_id {
            Some(pid) => root.join("projects").join(pid),
            None => root.join("projects").join("_default"),
        };
        std::fs::create_dir_all(&project_dir)
            .map_err(|e| Error::Ext(format!("创建项目记忆目录失败 {:?}: {}", project_dir, e)))?;

        let db_path = project_dir.join("memory_ext.db");
        let conn = Connection::open(&db_path)
            .map_err(|e| Error::Ext(format!("打开扩展库失败 {:?}: {}", db_path, e)))?;

        // 与 vendor 同款 PRAGMA；不启用 foreign_keys（跨库无 FK）
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA busy_timeout = 5000;",
        )
        .map_err(|e| Error::Ext(format!("设置扩展库 PRAGMA 失败: {}", e)))?;

        let store = Self {
            db_path,
            conn: Arc::new(Mutex::new(conn)),
        };
        store.init_schema()?;
        Ok(store)
    }

    /// 数据库文件路径
    pub fn db_path(&self) -> &Path {
        &self.db_path
    }

    /// 建表（幂等）+ 写入 schema 版本
    fn init_schema(&self) -> Result<()> {
        let guard = self
            .conn
            .lock()
            .map_err(|_| Error::Ext("扩展库连接锁中毒".into()))?;

        guard
            .execute_batch(
                r#"
CREATE TABLE IF NOT EXISTS memory_ext (
    memory_id      TEXT PRIMARY KEY,
    hook_id        TEXT NOT NULL DEFAULT '',
    created_at     INTEGER NOT NULL,
    access_count   INTEGER NOT NULL DEFAULT 0,
    pinned         INTEGER NOT NULL DEFAULT 0,
    summary_method TEXT NOT NULL DEFAULT 'none'
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_ext_hook
    ON memory_ext(hook_id) WHERE hook_id != '';

CREATE TABLE IF NOT EXISTS hook_tags (
    hook_id  TEXT NOT NULL,
    tag      TEXT NOT NULL,
    tag_kind TEXT NOT NULL DEFAULT 'auto',
    PRIMARY KEY (hook_id, tag, tag_kind)
);
CREATE INDEX IF NOT EXISTS idx_hook_tags_tag ON hook_tags(tag);

CREATE TABLE IF NOT EXISTS supersede_chain (
    old_hook_id TEXT NOT NULL,
    new_hook_id TEXT NOT NULL,
    reason      TEXT NOT NULL DEFAULT '',
    summary     TEXT,
    decided_at  INTEGER NOT NULL,
    PRIMARY KEY (old_hook_id, new_hook_id)
);
CREATE INDEX IF NOT EXISTS idx_supersede_new ON supersede_chain(new_hook_id);

CREATE TABLE IF NOT EXISTS raw_ref (
    content_hash TEXT NOT NULL,
    owner_kind   TEXT NOT NULL,
    owner_id     TEXT NOT NULL,
    pinned       INTEGER NOT NULL DEFAULT 0,
    stored_at    INTEGER NOT NULL,
    deleted_at   INTEGER,
    PRIMARY KEY (content_hash, owner_kind, owner_id)
);
CREATE INDEX IF NOT EXISTS idx_raw_ref_hash ON raw_ref(content_hash);

CREATE TABLE IF NOT EXISTS ext_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"#,
            )
            .map_err(|e| Error::Ext(format!("初始化扩展库 schema 失败: {}", e)))?;

        // 版本迁移：v1 → v2（`supersede_chain` 增 `summary` 列）
        // 新建库已带上该列；既有库需 ALTER 补列（旧值 NULL，语义 = 无摘要）
        Self::ensure_column(&guard, "supersede_chain", "summary", "TEXT")?;

        guard
            .execute(
                "INSERT INTO ext_meta (key, value) VALUES ('schema_version', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                rusqlite::params![SCHEMA_VERSION.to_string()],
            )
            .map_err(|e| Error::Ext(format!("写入 schema_version 失败: {}", e)))?;
        guard
            .execute(
                "INSERT INTO ext_meta (key, value) VALUES ('updated_at', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                rusqlite::params![now_ms().to_string()],
            )
            .map_err(|e| Error::Ext(format!("写入 updated_at 失败: {}", e)))?;

        Ok(())
    }

    /// 幂等补列（版本迁移用）
    ///
    /// `CREATE TABLE IF NOT EXISTS` 对**已存在**的表不生效，故新增列必须显式 ALTER。
    /// 先查 `PRAGMA table_info` 判存在，避免重复 ALTER 报错。
    fn ensure_column(
        conn: &Connection,
        table: &str,
        column: &str,
        decl: &str,
    ) -> Result<()> {
        let exists: bool = {
            let mut stmt = conn
                .prepare(&format!("PRAGMA table_info({table})"))
                .map_err(|e| Error::Ext(format!("探测表结构失败: {}", e)))?;
            let names: Vec<String> = stmt
                .query_map([], |r| r.get::<_, String>(1))
                .map_err(|e| Error::Ext(format!("读取表结构失败: {}", e)))?
                .filter_map(|r| r.ok())
                .collect();
            names.iter().any(|n| n == column)
        };
        if !exists {
            conn.execute(&format!("ALTER TABLE {table} ADD COLUMN {column} {decl}"), [])
                .map_err(|e| Error::Ext(format!("补列 {table}.{column} 失败: {}", e)))?;
        }
        Ok(())
    }

    /// 读取本库 schema 版本
    pub async fn schema_version(&self) -> Result<u32> {
        self.with_conn(|conn| {
            let raw: Option<String> = conn
                .query_row("SELECT value FROM ext_meta WHERE key = 'schema_version'", [], |r| {
                    r.get(0)
                })
                .optional()
                .map_err(|e| Error::Ext(format!("读取 schema_version 失败: {}", e)))?;
            Ok(raw.and_then(|v| v.parse().ok()).unwrap_or(0))
        })
        .await
    }

    // ── memory_ext：补齐 4 个死字段 ─────────────────────────

    /// 登记一条记忆的扩展信息（幂等：已存在则**补齐 hook_id 但不覆盖**既有计数与标记）
    ///
    /// - `created_at`：**记忆发生时点**（Unix 毫秒），不是归档时点
    /// - `summary_method`：`llm` / `rule` / `none`
    pub async fn ensure_memory_ext(
        &self,
        memory_id: &str,
        hook_id: &str,
        created_at: i64,
        summary_method: &str,
    ) -> Result<()> {
        let memory_id = memory_id.to_string();
        let hook_id = hook_id.to_string();
        let summary_method = normalize_summary_method(summary_method).to_string();
        self.with_conn(move |conn| {
            conn.execute(
                "INSERT INTO memory_ext
                    (memory_id, hook_id, created_at, access_count, pinned, summary_method)
                 VALUES (?1, ?2, ?3, 0, 0, ?4)
                 ON CONFLICT(memory_id) DO UPDATE SET hook_id = excluded.hook_id
                 WHERE memory_ext.hook_id = ''",
                rusqlite::params![&memory_id, &hook_id, created_at, &summary_method],
            )
            .map_err(|e| Error::Ext(format!("登记 memory_ext 失败: {}", e)))?;
            Ok(())
        })
        .await
    }

    /// 读取一条记忆的扩展信息（按 memory_id）
    pub async fn get_memory_ext(&self, memory_id: &str) -> Result<Option<MemoryExt>> {
        let memory_id = memory_id.to_string();
        self.with_conn(move |conn| {
            conn.query_row(
                "SELECT memory_id, hook_id, created_at, access_count, pinned, summary_method
                 FROM memory_ext WHERE memory_id = ?1",
                rusqlite::params![&memory_id],
                row_to_memory_ext,
            )
            .optional()
            .map_err(|e| Error::Ext(format!("读取 memory_ext 失败: {}", e)))
        })
        .await
    }

    /// 按 hook_id 读取扩展信息（trait 面的访问键；未登记返回 `None`）
    pub async fn get_by_hook(&self, hook_id: &str) -> Result<Option<MemoryExt>> {
        let hook_id = hook_id.to_string();
        self.with_conn(move |conn| {
            conn.query_row(
                "SELECT memory_id, hook_id, created_at, access_count, pinned, summary_method
                 FROM memory_ext WHERE hook_id = ?1",
                rusqlite::params![&hook_id],
                row_to_memory_ext,
            )
            .optional()
            .map_err(|e| Error::Ext(format!("按 hook 读取 memory_ext 失败: {}", e)))
        })
        .await
    }

    /// 访问计数 +1（甲3 淘汰的加权依据），返回自增后的值
    ///
    /// **按 hook_id 定位**——召回路径拿到的是 hook_id（`MemoryRecallResult.hook_id`），
    /// 不该为一次计数反查 memory_id。行不存在时返回 `Ok(0)` 且不建行
    /// （计数只对已登记的记忆生效，避免为幽灵 hook 造行）。
    pub async fn bump_access_count_by_hook(&self, hook_id: &str) -> Result<u32> {
        let hook_id = hook_id.to_string();
        self.with_conn(move |conn| {
            let n = conn
                .execute(
                    "UPDATE memory_ext SET access_count = access_count + 1 WHERE hook_id = ?1",
                    rusqlite::params![&hook_id],
                )
                .map_err(|e| Error::Ext(format!("自增 access_count 失败: {}", e)))?;
            if n == 0 {
                return Ok(0);
            }
            let v: i64 = conn
                .query_row(
                    "SELECT access_count FROM memory_ext WHERE hook_id = ?1",
                    rusqlite::params![&hook_id],
                    |r| r.get(0),
                )
                .map_err(|e| Error::Ext(format!("读取 access_count 失败: {}", e)))?;
            Ok(v.max(0) as u32)
        })
        .await
    }

    /// 置顶 / 取消置顶（按 hook_id；pinned 记忆不衰减、不淘汰）
    ///
    /// 未登记时返回 `Ok(false)`（未命中，不静默造行）。
    pub async fn set_pinned_by_hook(&self, hook_id: &str, pinned: bool) -> Result<bool> {
        let hook_id = hook_id.to_string();
        self.with_conn(move |conn| {
            let n = conn
                .execute(
                    "UPDATE memory_ext SET pinned = ?2 WHERE hook_id = ?1",
                    rusqlite::params![&hook_id, i64::from(pinned)],
                )
                .map_err(|e| Error::Ext(format!("设置 pinned 失败: {}", e)))?;
            Ok(n > 0)
        })
        .await
    }

    /// 列出全部置顶记忆的 hook_id（供「置顶集合」查询与 UI）
    pub async fn pinned_hooks(&self) -> Result<Vec<String>> {
        Ok(self
            .pinned_entries()
            .await?
            .into_iter()
            .map(|e| e.hook_id)
            .collect())
    }

    /// 列出全部置顶条目（含 `memory_id` 与时点）
    ///
    /// **跨会话视图**：本查询**不带会话过滤**——`MEMORY.md` 按设计「贯穿全部会话」
    /// （§3.3），故其数据来源必须跨会话。配合 `Storage::read_memory(memory_id)`
    /// （同样不按会话过滤）即可渲染全局常驻文档，无需依赖会话级索引。
    pub async fn pinned_entries(&self) -> Result<Vec<PinnedEntry>> {
        self.with_conn(|conn| {
            let mut stmt = conn
                .prepare(
                    "SELECT hook_id, memory_id, created_at FROM memory_ext
                     WHERE pinned != 0 AND hook_id != '' AND memory_id != ''
                     ORDER BY created_at",
                )
                .map_err(|e| Error::Ext(format!("准备置顶查询失败: {}", e)))?;
            let rows = stmt
                .query_map([], |r| {
                    Ok(PinnedEntry {
                        hook_id: r.get(0)?,
                        memory_id: r.get(1)?,
                        created_at: r.get(2)?,
                    })
                })
                .map_err(|e| Error::Ext(format!("查询置顶失败: {}", e)))?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
                .map_err(|e| Error::Ext(format!("读取置顶行失败: {}", e)))
        })
        .await
    }

    /// 删除一条扩展记录（随记忆删除级联；跨库无 FK，由调用方显式调用）
    pub async fn delete_memory_ext(&self, memory_id: &str) -> Result<()> {
        let memory_id = memory_id.to_string();
        self.with_conn(move |conn| {
            conn.execute(
                "DELETE FROM memory_ext WHERE memory_id = ?1",
                rusqlite::params![&memory_id],
            )
            .map_err(|e| Error::Ext(format!("删除 memory_ext 失败: {}", e)))?;
            Ok(())
        })
        .await
    }

    // ── hook_tags：真标签维度 ───────────────────────────────

    /// 追加一个标签（幂等）
    pub async fn add_tag(&self, hook_id: &str, tag: &str, kind: &str) -> Result<()> {
        let hook_id = hook_id.to_string();
        let tag = tag.to_string();
        let kind = kind.to_string();
        self.with_conn(move |conn| {
            conn.execute(
                "INSERT OR IGNORE INTO hook_tags (hook_id, tag, tag_kind) VALUES (?1, ?2, ?3)",
                rusqlite::params![&hook_id, &tag, &kind],
            )
            .map_err(|e| Error::Ext(format!("写入 hook_tags 失败: {}", e)))?;
            Ok(())
        })
        .await
    }

    /// 读取某钩子的全部标签（`(tag, tag_kind)`，按 tag 升序）
    pub async fn tags_of(&self, hook_id: &str) -> Result<Vec<(String, String)>> {
        let hook_id = hook_id.to_string();
        self.with_conn(move |conn| {
            let mut stmt = conn
                .prepare("SELECT tag, tag_kind FROM hook_tags WHERE hook_id = ?1 ORDER BY tag")
                .map_err(|e| Error::Ext(format!("准备标签查询失败: {}", e)))?;
            let rows = stmt
                .query_map(rusqlite::params![&hook_id], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
                })
                .map_err(|e| Error::Ext(format!("查询 hook_tags 失败: {}", e)))?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
                .map_err(|e| Error::Ext(format!("读取 hook_tags 行失败: {}", e)))
        })
        .await
    }

    /// 删除某标签（幂等）
    pub async fn remove_tag(&self, hook_id: &str, tag: &str, kind: &str) -> Result<()> {
        let hook_id = hook_id.to_string();
        let tag = tag.to_string();
        let kind = kind.to_string();
        self.with_conn(move |conn| {
            conn.execute(
                "DELETE FROM hook_tags WHERE hook_id = ?1 AND tag = ?2 AND tag_kind = ?3",
                rusqlite::params![&hook_id, &tag, &kind],
            )
            .map_err(|e| Error::Ext(format!("删除 hook_tags 失败: {}", e)))?;
            Ok(())
        })
        .await
    }

    /// 按标签反查持有该标签的全部 hook_id（按写入时点升序）
    ///
    /// 真标签是可检索维度中最直接的一档（如 [`crate::RECONCILE_TAG`] 标出全部调和记忆），
    /// 供 `MEMORY.md` 注入与 UI 侧「按标签筛记忆」消费。
    pub async fn hooks_by_tag(&self, tag: &str) -> Result<Vec<String>> {
        let tag = tag.to_string();
        self.with_conn(move |conn| {
            let mut stmt = conn
                .prepare("SELECT hook_id FROM hook_tags WHERE tag = ?1 ORDER BY hook_id")
                .map_err(|e| Error::Ext(format!("准备标签反查失败: {}", e)))?;
            let rows = stmt
                .query_map(rusqlite::params![&tag], |r| r.get::<_, String>(0))
                .map_err(|e| Error::Ext(format!("标签反查失败: {}", e)))?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
                .map_err(|e| Error::Ext(format!("读取标签反查行失败: {}", e)))
        })
        .await
    }

    // ── supersede_chain：矛盾调和链 ─────────────────────────

    /// 记录一次调和：`new_hook_id` 取代 `old_hook_id`（**不删除旧值**）
    ///
    /// - `reason`：**机器可读**的判定依据（如 `stance_reversal` / `direct_contradict` /
    ///   `revision`），供程序分支与统计
    /// - `summary`：**人文可读**的调和摘要（如「2025-11 前：使用 React；之后（2026-01）：改用 Vue」），
    ///   供 `MEMORY.md` 注入（乙3）与召回展示消费；`None` = 本次未生成
    ///
    /// 幂等：同一 `(old, new)` 对重复记录时**只补摘要**，不覆盖已有 reason（先到者为准）。
    pub async fn add_supersede(
        &self,
        old_hook_id: &str,
        new_hook_id: &str,
        reason: &str,
        summary: Option<&str>,
    ) -> Result<()> {
        let old = old_hook_id.to_string();
        let new = new_hook_id.to_string();
        let reason = reason.to_string();
        let summary = summary.map(|s| s.to_string());
        let now = now_ms();
        self.with_conn(move |conn| {
            conn.execute(
                "INSERT INTO supersede_chain
                    (old_hook_id, new_hook_id, reason, summary, decided_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(old_hook_id, new_hook_id) DO UPDATE SET
                    summary = COALESCE(excluded.summary, summary)",
                rusqlite::params![&old, &new, &reason, &summary, now],
            )
            .map_err(|e| Error::Ext(format!("写入 supersede_chain 失败: {}", e)))?;
            Ok(())
        })
        .await
    }

    /// 读取一条调和链记录（`(old, new)` 精确匹配）
    pub async fn supersede_link(
        &self,
        old_hook_id: &str,
        new_hook_id: &str,
    ) -> Result<Option<SupersedeLink>> {
        let old = old_hook_id.to_string();
        let new = new_hook_id.to_string();
        self.with_conn(move |conn| {
            conn.query_row(
                "SELECT old_hook_id, new_hook_id, reason, summary, decided_at
                 FROM supersede_chain WHERE old_hook_id = ?1 AND new_hook_id = ?2",
                rusqlite::params![&old, &new],
                row_to_supersede_link,
            )
            .optional()
            .map_err(|e| Error::Ext(format!("读取调和链记录失败: {}", e)))
        })
        .await
    }

    /// 列出某条记忆作为**旧值**的全部调和记录（它被谁取代）
    pub async fn superseded_by(&self, old_hook_id: &str) -> Result<Vec<SupersedeLink>> {
        let old = old_hook_id.to_string();
        self.with_conn(move |conn| {
            let mut stmt = conn
                .prepare(
                    "SELECT old_hook_id, new_hook_id, reason, summary, decided_at
                     FROM supersede_chain WHERE old_hook_id = ?1 ORDER BY decided_at",
                )
                .map_err(|e| Error::Ext(format!("准备调和链查询失败: {}", e)))?;
            let rows = stmt
                .query_map(rusqlite::params![&old], row_to_supersede_link)
                .map_err(|e| Error::Ext(format!("查询调和链失败: {}", e)))?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
                .map_err(|e| Error::Ext(format!("读取调和链行失败: {}", e)))
        })
        .await
    }

    /// 列出全部已生成摘要的调和记录（供 `MEMORY.md` 注入按需取用）
    pub async fn supersede_summaries(&self) -> Result<Vec<SupersedeLink>> {
        self.with_conn(|conn| {
            let mut stmt = conn
                .prepare(
                    "SELECT old_hook_id, new_hook_id, reason, summary, decided_at
                     FROM supersede_chain
                     WHERE summary IS NOT NULL AND summary != ''
                     ORDER BY decided_at",
                )
                .map_err(|e| Error::Ext(format!("准备摘要查询失败: {}", e)))?;
            let rows = stmt
                .query_map([], row_to_supersede_link)
                .map_err(|e| Error::Ext(format!("查询调和摘要失败: {}", e)))?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
                .map_err(|e| Error::Ext(format!("读取调和摘要行失败: {}", e)))
        })
        .await
    }

    /// 沿调和链从 `hook_id` 一路向后走，返回被它取代的**后继序列**
    ///
    /// 返回顺序 = 从 `hook_id` 出发逐跳向后。带访问集防环（数据异常时不致死循环）。
    pub async fn supersede_successors(&self, hook_id: &str) -> Result<Vec<String>> {
        let start = hook_id.to_string();
        self.with_conn(move |conn| {
            let mut stmt = conn
                .prepare("SELECT new_hook_id FROM supersede_chain WHERE old_hook_id = ?1")
                .map_err(|e| Error::Ext(format!("准备调和链查询失败: {}", e)))?;

            let mut seen: Vec<String> = vec![start.clone()];
            let mut queue: Vec<String> = vec![start];
            let mut out: Vec<String> = Vec::new();

            while let Some(cur) = queue.pop() {
                let next: Vec<String> = stmt
                    .query_map(rusqlite::params![&cur], |r| r.get::<_, String>(0))
                    .map_err(|e| Error::Ext(format!("查询调和链失败: {}", e)))?
                    .collect::<rusqlite::Result<Vec<_>>>()
                    .map_err(|e| Error::Ext(format!("读取调和链行失败: {}", e)))?;
                for n in next {
                    if !seen.contains(&n) {
                        seen.push(n.clone());
                        out.push(n.clone());
                        queue.push(n);
                    }
                }
            }
            Ok(out)
        })
        .await
    }

    // ── raw_ref：外置原文引用（GC 判据） ─────────────────────

    /// 摄取一条引用（幂等；重复摄取会把软删标记清掉，即「恢复」）
    pub async fn acquire_raw_ref(
        &self,
        content_hash: &str,
        owner_kind: &str,
        owner_id: &str,
        pinned: bool,
    ) -> Result<()> {
        let hash = content_hash.to_string();
        let kind = owner_kind.to_string();
        let id = owner_id.to_string();
        let now = now_ms();
        self.with_conn(move |conn| {
            conn.execute(
                "INSERT INTO raw_ref (content_hash, owner_kind, owner_id, pinned, stored_at, deleted_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, NULL)
                 ON CONFLICT(content_hash, owner_kind, owner_id) DO UPDATE SET
                    pinned = ?4,
                    deleted_at = NULL",
                rusqlite::params![&hash, &kind, &id, i64::from(pinned), now],
            )
            .map_err(|e| Error::Ext(format!("摄取 raw_ref 失败: {}", e)))?;
            Ok(())
        })
        .await
    }

    /// 释放一条引用（物理删除该引用行；不动物理文件，删文件由 GC 判定后执行）
    pub async fn release_raw_ref(&self, content_hash: &str, owner_kind: &str, owner_id: &str) -> Result<()> {
        let hash = content_hash.to_string();
        let kind = owner_kind.to_string();
        let id = owner_id.to_string();
        self.with_conn(move |conn| {
            conn.execute(
                "DELETE FROM raw_ref WHERE content_hash = ?1 AND owner_kind = ?2 AND owner_id = ?3",
                rusqlite::params![&hash, &kind, &id],
            )
            .map_err(|e| Error::Ext(format!("释放 raw_ref 失败: {}", e)))?;
            Ok(())
        })
        .await
    }

    /// 软删某内容的所有引用（入回收站；`deleted_at = now`）
    ///
    /// 对应设计文档 §6.3.2 的**第二档**：软删。硬删在回收站到期后由 GC 执行。
    pub async fn soft_delete_raw_refs(&self, content_hash: &str) -> Result<usize> {
        let hash = content_hash.to_string();
        let now = now_ms();
        self.with_conn(move |conn| {
            let n = conn
                .execute(
                    "UPDATE raw_ref SET deleted_at = ?2 WHERE content_hash = ?1 AND deleted_at IS NULL",
                    rusqlite::params![&hash, now],
                )
                .map_err(|e| Error::Ext(format!("软删 raw_ref 失败: {}", e)))?;
            Ok(n)
        })
        .await
    }

    /// 某内容的有效引用数（`deleted_at IS NULL` 的行数）——**GC 判据的输入**
    pub async fn raw_ref_count(&self, content_hash: &str) -> Result<u32> {
        let hash = content_hash.to_string();
        self.with_conn(move |conn| {
            let n: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM raw_ref WHERE content_hash = ?1 AND deleted_at IS NULL",
                    rusqlite::params![&hash],
                    |r| r.get(0),
                )
                .map_err(|e| Error::Ext(format!("统计 raw_ref 失败: {}", e)))?;
            Ok(n.max(0) as u32)
        })
        .await
    }

    /// GC 判据：某内容是否**可删**（无有效引用且无 pinned）
    ///
    /// 对应设计文档 §6.3.2「GC 判据 = 两处引用都不存在」。**两种引用皆无**即返回 `true`。
    ///
    /// 注意这是**谓词而非枚举**：引用被 [`release_raw_ref`](Self::release_raw_ref) 物理释放后，
    /// 该哈希在 `raw_ref` 中已无行——枚举不出来，但判定依然正确。GC 扫描的对象是
    /// **外置目录下的实际文件**（设计文档 §6.3.3 的 app_data 落点），逐个问本方法即可。
    ///
    /// [`release_raw_ref`]: Self::release_raw_ref
    pub async fn is_gc_eligible(&self, content_hash: &str) -> Result<bool> {
        let hash = content_hash.to_string();
        self.with_conn(move |conn| {
            let live: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM raw_ref WHERE content_hash = ?1 AND deleted_at IS NULL",
                    rusqlite::params![&hash],
                    |r| r.get(0),
                )
                .map_err(|e| Error::Ext(format!("统计有效引用失败: {}", e)))?;
            if live > 0 {
                return Ok(false);
            }
            let pinned: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM raw_ref WHERE content_hash = ?1 AND pinned != 0",
                    rusqlite::params![&hash],
                    |r| r.get(0),
                )
                .map_err(|e| Error::Ext(format!("统计 pinned 引用失败: {}", e)))?;
            Ok(pinned == 0)
        })
        .await
    }

    /// 硬删某内容的全部引用行（回收站到期后调用；**物理文件删除由调用方执行**）
    ///
    /// 顺序要求：先删物理文件、再 `purge` 引用行——反过来一旦删行成功而删文件失败，
    /// 该文件就成了不可追溯的孤儿（设计文档 §6.3.2 的三档顺序）。
    pub async fn purge_raw_refs(&self, content_hash: &str) -> Result<usize> {
        let hash = content_hash.to_string();
        self.with_conn(move |conn| {
            let n = conn
                .execute("DELETE FROM raw_ref WHERE content_hash = ?1", rusqlite::params![&hash])
                .map_err(|e| Error::Ext(format!("硬删 raw_ref 失败: {}", e)))?;
            Ok(n)
        })
        .await
    }

    /// 回收站中已到期的内容哈希（`deleted_at <= cutoff` 且无 pinned）——硬删候选
    pub async fn trash_expired_hashes(&self, cutoff_ms: i64) -> Result<Vec<String>> {
        self.with_conn(move |conn| {
            let mut stmt = conn
                .prepare(
                    "SELECT content_hash FROM raw_ref GROUP BY content_hash
                     HAVING SUM(pinned) = 0
                        AND SUM(CASE WHEN deleted_at IS NOT NULL AND deleted_at <= ?1 THEN 1 ELSE 0 END) > 0
                        AND SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END) = 0
                     ORDER BY content_hash",
                )
                .map_err(|e| Error::Ext(format!("准备回收站查询失败: {}", e)))?;
            let rows = stmt
                .query_map(rusqlite::params![cutoff_ms], |r| r.get::<_, String>(0))
                .map_err(|e| Error::Ext(format!("查询回收站失败: {}", e)))?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
                .map_err(|e| Error::Ext(format!("读取回收站行失败: {}", e)))
        })
        .await
    }

    /// 列出某内容哈希的全部引用行（诊断 / 追溯用）
    pub async fn refs_of(&self, content_hash: &str) -> Result<Vec<RawRef>> {
        let hash = content_hash.to_string();
        self.with_conn(move |conn| {
            let mut stmt = conn
                .prepare(
                    "SELECT content_hash, owner_kind, owner_id, pinned, stored_at, deleted_at
                     FROM raw_ref WHERE content_hash = ?1 ORDER BY owner_kind, owner_id",
                )
                .map_err(|e| Error::Ext(format!("准备引用查询失败: {}", e)))?;
            let rows = stmt
                .query_map(rusqlite::params![&hash], |row| {
                    Ok(RawRef {
                        content_hash: row.get(0)?,
                        owner_kind: row.get(1)?,
                        owner_id: row.get(2)?,
                        pinned: row.get::<_, i64>(3)? != 0,
                        stored_at: row.get(4)?,
                        deleted_at: row.get(5)?,
                    })
                })
                .map_err(|e| Error::Ext(format!("查询 raw_ref 失败: {}", e)))?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
                .map_err(|e| Error::Ext(format!("读取 raw_ref 行失败: {}", e)))
        })
        .await
    }

    // ── 内部：统一走 spawn_blocking，避免阻塞 async 执行器 ──

    /// 在阻塞线程池上执行一次连接操作
    async fn with_conn<T, F>(&self, f: F) -> Result<T>
    where
        F: FnOnce(&Connection) -> Result<T> + Send + 'static,
        T: Send + 'static,
    {
        let conn = Arc::clone(&self.conn);
        tokio::task::spawn_blocking(move || {
            let guard = conn.lock().map_err(|_| Error::Ext("扩展库连接锁中毒".into()))?;
            f(&guard)
        })
        .await
        .map_err(|e| Error::Ext(format!("扩展库阻塞任务失败: {}", e)))?
    }
}

/// 归一化摘要生成方式为 `llm` / `rule` / `none`
///
/// 与 `agent_runtime::memory::SummaryMethod` 的 serde 形态（`rename_all = "lowercase"`）对齐；
/// 非法输入一律降级为 `none`（不报错，避免污染写入路径）。
pub fn normalize_summary_method(raw: &str) -> &'static str {
    match raw.trim().to_ascii_lowercase().as_str() {
        "llm" => "llm",
        "rule" => "rule",
        _ => "none",
    }
}

/// 当前 Unix 毫秒时间戳
fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// 行 → [`SupersedeLink`]（列序：old_hook_id, new_hook_id, reason, summary, decided_at）
fn row_to_supersede_link(row: &rusqlite::Row<'_>) -> rusqlite::Result<SupersedeLink> {
    Ok(SupersedeLink {
        old_hook_id: row.get(0)?,
        new_hook_id: row.get(1)?,
        reason: row.get(2)?,
        summary: row.get(3)?,
        decided_at: row.get(4)?,
    })
}

/// 行 → [`MemoryExt`]（列序：memory_id, hook_id, created_at, access_count, pinned, summary_method）
fn row_to_memory_ext(row: &rusqlite::Row<'_>) -> rusqlite::Result<MemoryExt> {
    Ok(MemoryExt {
        memory_id: row.get(0)?,
        hook_id: row.get(1)?,
        created_at: row.get(2)?,
        access_count: row.get::<_, i64>(3)?.max(0) as u32,
        pinned: row.get::<_, i64>(4)? != 0,
        summary_method: row.get(5)?,
    })
}

// ─── 测试 ────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// 建一个临时库（`_default` 分片）
    fn temp_store(dir: &tempfile::TempDir) -> ExtStore {
        ExtStore::open(dir.path().to_path_buf(), None).expect("打开扩展库")
    }

    #[tokio::test]
    async fn schema_is_created_and_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let s = temp_store(&dir);
        assert_eq!(s.schema_version().await.unwrap(), SCHEMA_VERSION);
        assert!(s.db_path().ends_with("memory_ext.db"));
        assert!(s.db_path().to_string_lossy().contains("_default"));

        // 重复 open 不报错（建表幂等）
        let s2 = ExtStore::open(dir.path().to_path_buf(), None).unwrap();
        assert_eq!(s2.schema_version().await.unwrap(), SCHEMA_VERSION);
    }

    /// v1 → v2 迁移：既有库（无 `summary` 列）被 `open` 自动补列
    #[tokio::test]
    async fn schema_migrates_v1_database_to_v2() {
        let dir = tempfile::tempdir().unwrap();
        let project_dir = dir.path().join("projects").join("_default");
        std::fs::create_dir_all(&project_dir).unwrap();
        let db = project_dir.join("memory_ext.db");

        // 手工造一个 v1 形态的库（supersede_chain 无 summary 列）
        {
            let conn = rusqlite::Connection::open(&db).unwrap();
            conn.execute_batch(
                "CREATE TABLE supersede_chain (
                     old_hook_id TEXT NOT NULL,
                     new_hook_id TEXT NOT NULL,
                     reason      TEXT NOT NULL DEFAULT '',
                     decided_at  INTEGER NOT NULL,
                     PRIMARY KEY (old_hook_id, new_hook_id)
                 );",
            )
            .unwrap();
        }

        // open 时自动迁移
        let s = ExtStore::open(dir.path().to_path_buf(), None).unwrap();
        assert_eq!(s.schema_version().await.unwrap(), SCHEMA_VERSION);
        // 补列后读写正常
        s.add_supersede("A", "B", "revision", Some("迁移后的摘要"))
            .await
            .unwrap();
        assert_eq!(
            s.supersede_link("A", "B").await.unwrap().unwrap().summary.as_deref(),
            Some("迁移后的摘要")
        );
    }

    #[tokio::test]
    async fn memory_ext_roundtrip_and_access_count() {
        let dir = tempfile::tempdir().unwrap();
        let s = temp_store(&dir);

        s.ensure_memory_ext("m1", "h1", 1_700_000_000_000, "LLM").await.unwrap();
        let e = s.get_memory_ext("m1").await.unwrap().expect("应存在");
        assert_eq!(e.hook_id, "h1");
        assert_eq!(e.created_at, 1_700_000_000_000);
        assert_eq!(e.access_count, 0);
        assert!(!e.pinned);
        assert_eq!(e.summary_method, "llm", "摘要方式应归一为小写");
        // 按 hook 也能取到（trait 面访问键）
        assert_eq!(s.get_by_hook("h1").await.unwrap().unwrap().memory_id, "m1");
        assert!(s.get_by_hook("不存在").await.unwrap().is_none());

        // 幂等：重复登记不覆盖已有值；但空 hook_id 会被补齐
        s.ensure_memory_ext("m1", "h1-新", 999, "rule").await.unwrap();
        let e = s.get_memory_ext("m1").await.unwrap().unwrap();
        assert_eq!(e.created_at, 1_700_000_000_000, "已存在的记录不被覆盖");
        assert_eq!(e.hook_id, "h1", "hook_id 非空时不覆盖");
        assert_eq!(e.summary_method, "llm");

        // 计数（按 hook）
        assert_eq!(s.bump_access_count_by_hook("h1").await.unwrap(), 1);
        assert_eq!(s.bump_access_count_by_hook("h1").await.unwrap(), 2);
        // 幽灵 hook 不建行
        assert_eq!(s.bump_access_count_by_hook("幽灵").await.unwrap(), 0);
        assert!(s.get_by_hook("幽灵").await.unwrap().is_none());

        // 置顶（按 hook）
        assert!(s.set_pinned_by_hook("h1", true).await.unwrap());
        assert!(s.get_memory_ext("m1").await.unwrap().unwrap().pinned);
        assert_eq!(s.pinned_hooks().await.unwrap(), vec!["h1".to_string()]);
        assert!(!s.set_pinned_by_hook("幽灵", true).await.unwrap(), "未登记不命中");

        // 级联删除
        s.delete_memory_ext("m1").await.unwrap();
        assert!(s.get_memory_ext("m1").await.unwrap().is_none());
        assert!(s.pinned_hooks().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn hook_tags_are_deduped_and_queryable() {
        let dir = tempfile::tempdir().unwrap();
        let s = temp_store(&dir);

        s.add_tag("h1", "记忆系统", tag_kind::USER).await.unwrap();
        s.add_tag("h1", "记忆系统", tag_kind::USER).await.unwrap(); // 幂等
        s.add_tag("h1", "实体:角色A", tag_kind::ENTITY).await.unwrap();

        let tags = s.tags_of("h1").await.unwrap();
        assert_eq!(tags.len(), 2);
        assert!(tags.contains(&("记忆系统".to_string(), tag_kind::USER.to_string())));
        assert!(tags.contains(&("实体:角色A".to_string(), tag_kind::ENTITY.to_string())));

        s.remove_tag("h1", "记忆系统", tag_kind::USER).await.unwrap();
        assert_eq!(s.tags_of("h1").await.unwrap().len(), 1);
        // 幂等删除
        s.remove_tag("h1", "记忆系统", tag_kind::USER).await.unwrap();
    }

    #[tokio::test]
    async fn supersede_chain_walks_and_is_cycle_safe() {
        let dir = tempfile::tempdir().unwrap();
        let s = temp_store(&dir);

        // A → B → C（B 取代 A，C 取代 B）
        s.add_supersede("A", "B", "时点转移", Some("A 之后：B"))
            .await
            .unwrap();
        s.add_supersede("B", "C", "方案升级", None).await.unwrap();
        let mut got = s.supersede_successors("A").await.unwrap();
        got.sort();
        assert_eq!(got, vec!["B".to_string(), "C".to_string()]);

        // 旧值未被删除：A 仍可查到后继（调和 = 只增不删）
        assert!(!s.supersede_successors("A").await.unwrap().is_empty());

        // 逐跳记录可读回（含摘要）
        let link = s.supersede_link("A", "B").await.unwrap().expect("应有记录");
        assert_eq!(link.reason, "时点转移");
        assert_eq!(link.summary.as_deref(), Some("A 之后：B"));
        assert!(link.decided_at > 0);
        assert!(s.supersede_link("A", "C").await.unwrap().is_none());
        assert!(s.supersede_link("B", "C").await.unwrap().unwrap().summary.is_none());

        // 被谁取代
        let by = s.superseded_by("B").await.unwrap();
        assert_eq!(by.len(), 1);
        assert_eq!(by[0].new_hook_id, "C");

        // 全部带摘要的记录（供 MEMORY.md 注入）
        let with_summary = s.supersede_summaries().await.unwrap();
        assert_eq!(with_summary.len(), 1);
        assert_eq!(with_summary[0].old_hook_id, "A");

        // 环：X → Y → X 不应死循环
        s.add_supersede("X", "Y", "", None).await.unwrap();
        s.add_supersede("Y", "X", "", None).await.unwrap();
        let got = s.supersede_successors("X").await.unwrap();
        assert_eq!(got, vec!["Y".to_string()]);

        assert!(s.supersede_successors("无后继").await.unwrap().is_empty());
    }

    /// 幂等：同 `(old, new)` 重复记录只补摘要，不覆盖已有 reason
    #[tokio::test]
    async fn supersede_record_is_idempotent_with_summary_backfill() {
        let dir = tempfile::tempdir().unwrap();
        let s = temp_store(&dir);

        s.add_supersede("A", "B", "revision", None).await.unwrap();
        s.add_supersede("A", "B", "另一个理由", Some("补上的摘要"))
            .await
            .unwrap();

        let link = s.supersede_link("A", "B").await.unwrap().unwrap();
        assert_eq!(link.reason, "revision", "reason 先到者为准，不被覆盖");
        assert_eq!(link.summary.as_deref(), Some("补上的摘要"), "摘要可补齐");

        // 已有摘要不被 None 抹掉
        s.add_supersede("A", "B", "revision", None).await.unwrap();
        assert!(s
            .supersede_link("A", "B")
            .await
            .unwrap()
            .unwrap()
            .summary
            .is_some());
    }

    #[tokio::test]
    async fn raw_ref_gc_judgement_covers_both_reference_faces() {
        let dir = tempfile::tempdir().unwrap();
        let s = temp_store(&dir);

        // 同一内容被两处引用：上下文锚点 + 归档
        s.acquire_raw_ref("hash1", owner_kind::CONTEXT_ANCHOR, "anchor-1", false)
            .await
            .unwrap();
        s.acquire_raw_ref("hash1", owner_kind::ARCHIVE, "hook-1", false)
            .await
            .unwrap();
        // 幂等摄取
        s.acquire_raw_ref("hash1", owner_kind::ARCHIVE, "hook-1", false)
            .await
            .unwrap();

        assert_eq!(s.raw_ref_count("hash1").await.unwrap(), 2);
        assert!(!s.is_gc_eligible("hash1").await.unwrap(), "有引用不该可删");

        // 释放一处 → 仍有引用，不可删
        s.release_raw_ref("hash1", owner_kind::CONTEXT_ANCHOR, "anchor-1")
            .await
            .unwrap();
        assert_eq!(s.raw_ref_count("hash1").await.unwrap(), 1);
        assert!(!s.is_gc_eligible("hash1").await.unwrap());

        // 释放其余 → 无引用；**即使引用行已全部消失，判定依然正确**（谓词而非枚举）
        s.release_raw_ref("hash1", owner_kind::ARCHIVE, "hook-1").await.unwrap();
        assert_eq!(s.raw_ref_count("hash1").await.unwrap(), 0);
        assert!(s.is_gc_eligible("hash1").await.unwrap());
        assert!(s.refs_of("hash1").await.unwrap().is_empty(), "引用行已物理释放");
        assert!(
            s.is_gc_eligible("从未登记过的哈希").await.unwrap(),
            "无引用即无保护"
        );
    }

    #[tokio::test]
    async fn pinned_raw_ref_never_becomes_gc_candidate() {
        let dir = tempfile::tempdir().unwrap();
        let s = temp_store(&dir);

        s.acquire_raw_ref("h-pin", owner_kind::ARCHIVE, "hook-pin", true)
            .await
            .unwrap();
        s.soft_delete_raw_refs("h-pin").await.unwrap();

        assert_eq!(s.raw_ref_count("h-pin").await.unwrap(), 0, "软删后有效引用为 0");
        assert!(
            !s.is_gc_eligible("h-pin").await.unwrap(),
            "pinned 内容即便无有效引用也不得判为可删"
        );
        // 硬删候选同样排除 pinned
        let expired = s.trash_expired_hashes(now_ms()).await.unwrap();
        assert!(expired.is_empty(), "pinned 不入硬删候选");
    }

    #[tokio::test]
    async fn purge_removes_all_ref_rows() {
        let dir = tempfile::tempdir().unwrap();
        let s = temp_store(&dir);

        s.acquire_raw_ref("h-gone", owner_kind::ARCHIVE, "hook-a", false)
            .await
            .unwrap();
        s.acquire_raw_ref("h-gone", owner_kind::CONTEXT_ANCHOR, "anchor-a", false)
            .await
            .unwrap();
        s.soft_delete_raw_refs("h-gone").await.unwrap();

        assert_eq!(s.purge_raw_refs("h-gone").await.unwrap(), 2);
        assert!(s.refs_of("h-gone").await.unwrap().is_empty());
        assert!(s.is_gc_eligible("h-gone").await.unwrap(), "硬删后判定仍为可删");
        // 幂等
        assert_eq!(s.purge_raw_refs("h-gone").await.unwrap(), 0);
    }

    #[tokio::test]
    async fn trash_expiry_selects_only_unreferenced_and_expired() {
        let dir = tempfile::tempdir().unwrap();
        let s = temp_store(&dir);

        s.acquire_raw_ref("h-old", owner_kind::ARCHIVE, "hook-old", false)
            .await
            .unwrap();
        s.soft_delete_raw_refs("h-old").await.unwrap();

        s.acquire_raw_ref("h-live", owner_kind::ARCHIVE, "hook-live", false)
            .await
            .unwrap();

        // 未到期（cutoff 早于软删时点）→ 不该入选
        let none = s.trash_expired_hashes(0).await.unwrap();
        assert!(none.is_empty());

        // 已到期 → 仅 h-old 入选
        let expired = s.trash_expired_hashes(now_ms()).await.unwrap();
        assert_eq!(expired, vec!["h-old".to_string()]);

        // 恢复（重新摄取）后不再是无引用态
        s.acquire_raw_ref("h-old", owner_kind::ARCHIVE, "hook-old", false)
            .await
            .unwrap();
        assert!(s.trash_expired_hashes(now_ms()).await.unwrap().is_empty());

        let refs = s.refs_of("h-old").await.unwrap();
        assert_eq!(refs.len(), 1);
        assert!(refs[0].deleted_at.is_none(), "重新摄取应清除软删标记");
    }

    #[test]
    fn summary_method_normalization() {
        assert_eq!(normalize_summary_method("LLM"), "llm");
        assert_eq!(normalize_summary_method(" rule "), "rule");
        assert_eq!(normalize_summary_method("None"), "none");
        assert_eq!(normalize_summary_method("乱写"), "none");
    }
}
