//! 工作区索引库（元数据 + 块 + 关键词/向量双通道 + 混合检索 + 懒建/增量管线）
//!
//! ## 存储布局（单库文件，落 app_data）
//!
//! ```sql
//! files  (path PK, size, mtime_ms, indexed_at)          -- 增量 diff 依据（size+mtime）
//! chunks (chunk_id PK, path, ordinal, start_line, end_line, text)
//! embeddings (hook_id PK, memory_id, vector)            -- SqliteVectorIndex 自己的表（同库）
//! meta   (key PK, value)                                -- chunk_schema_version（分块版本）
//! ```
//!
//! ## 更新语义
//!
//! - **增量**：`search` 前做一次「重扫 + diff」（纯元数据，3 秒去抖）；只有 size/mtime
//!   变化的文件被重读/重分块；删除的文件移除索引。手动 `rebuild` 清空后全量重建。
//! - **分块版本作废**：打开库时校验 `meta.chunk_schema_version`；与
//!   [`CHUNK_SCHEMA_VERSION`] 不符即整体作废（清块/文件行/向量）→ 下次 `sync()` 全量重建。
//!   **必须有这一层**：`sync()` 只看 `size + mtime`，分块规则变了而文件没变时 diff 会判
//!   「未变更」，索引静默沿用旧分块（无任何外部症状）。
//! - **向量渐进**：关键词索引（本地）即时可用；向量由后台任务分批补齐——首次检索
//!   不等 embedding，先给关键词结果，后续检索逐步转为混合。
//! - **隐私**：仅启用语义检索（配置了端点）时块文本才发往嵌入端点；未配置纯本地。

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex as StdMutex, OnceLock, RwLock};

use memory_center_core::bm25::Bm25Searcher;
use memory_center_core::semantic::{
    Embedder, KeywordSearcher, SearchHit, VectorIndex, rrf_fusion,
};
use memory_center_core::sqlite_vector::SqliteVectorIndex;

use agent_memory::semantic::{GatedEmbedder, SemanticConfig, ensure_vector_dim};

use crate::policy::{IndexPolicy, scan_files};

const INIT_SQL: &str = r#"
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS files (
    path       TEXT PRIMARY KEY,
    size       INTEGER NOT NULL,
    mtime_ms   INTEGER NOT NULL,
    indexed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chunks (
    chunk_id   TEXT PRIMARY KEY,
    path       TEXT NOT NULL,
    ordinal    INTEGER NOT NULL,
    start_line INTEGER NOT NULL,
    end_line   INTEGER NOT NULL,
    text       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chunks_path ON chunks(path);

-- 索引自身的元信息（当前只有分块版本；键值结构，便于后续加标记）
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"#;

/// **分块/索引 schema 版本——分块规则变更时必须递增**
///
/// - `1` = 按行累积 + 重叠（无边界感知）
/// - `2` = 边界感知（Markdown 标题 / 代码列 0 顶层声明；R2-1）
///
/// 索引库是**可重建缓存**：版本不符即整体作废（清块 / 清文件行 / 清向量），
/// 由下次 `sync()` 全量重建。**为什么必须递增**：`sync()` 的增量 diff 依据是
/// `size + mtime`——分块规则变了而文件没变，diff 会判定「未变更」并沿用作废前的
/// 块，检索结果与新规则不一致；且这种偏差**没有任何外部症状**（静默失效）。
const CHUNK_SCHEMA_VERSION: i64 = 2;

/// 向量补批大小（每批 embedding 调用的条数）
const BACKFILL_BATCH: usize = 32;
/// 检索前增量同步的最小间隔（毫秒；避免连续检索重复扫描）
const SYNC_DEBOUNCE_MS: i64 = 3_000;

// ─── meta 键（索引库自述信息；GC 的判定依据）─────────────────
//
// **为什么必须记录 workdir**：库文件名为 `{目录名}-{workdir 路径哈希前 8 位}.db`，
// 哈希**不可反解**——不记 workdir 就无法判断「这个索引库对应的目录还在不在」，
// 只能按 mtime 老化（会误删网络盘/移动盘上暂时不可达的工作区索引）。
const META_WORKDIR: &str = "workdir";
const META_LAST_USED_AT: &str = "last_used_at";

/// 孤儿索引库的默认宽限期（30 天）
///
/// 工作区「不存在」有多种成因：已删除、已改名、移动盘未插入、网络盘离线。
/// **宽限期是这几种情况的安全网**：只有「目录不存在 **且** 30 天未被使用」才删；
/// 误删的代价仅是索引重建（可重建缓存），但频繁重建会浪费 embedding 额度。
pub const DEFAULT_PRUNE_GRACE_MS: i64 = 30 * 24 * 60 * 60 * 1_000;

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 分块版本校验：与 [`CHUNK_SCHEMA_VERSION`] 不符即**整体作废**索引
///
/// 作废三处（缺一即产生「半新半旧」的索引）：块、文件行（增量 diff 的依据）、
/// 向量（chunk_id 随分块规则变化，旧向量会变成孤儿且与新块错配）。
///
/// 无 `meta` 行（本机制引入前建的索引）视为版本未知 → 同样作废一次。
fn ensure_chunk_schema(conn: &rusqlite::Connection, db: &Path) -> Result<(), String> {
    let stored: Option<i64> = conn
        .query_row(
            "SELECT value FROM meta WHERE key = 'chunk_schema_version'",
            [],
            |r| r.get::<_, String>(0),
        )
        .ok()
        .and_then(|v| v.parse().ok());
    if stored == Some(CHUNK_SCHEMA_VERSION) {
        return Ok(());
    }

    conn.execute("DELETE FROM chunks", [])
        .map_err(|e| format!("作废旧索引（清块）失败: {e}"))?;
    conn.execute("DELETE FROM files", [])
        .map_err(|e| format!("作废旧索引（清文件表）失败: {e}"))?;
    // embeddings 表由 SqliteVectorIndex 建（未启用语义检索时不存在）
    let has_embeddings: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'embeddings'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if has_embeddings > 0 {
        conn.execute("DELETE FROM embeddings", [])
            .map_err(|e| format!("作废旧索引（清向量）失败: {e}"))?;
    }
    conn.execute(
        "INSERT OR REPLACE INTO meta (key, value) VALUES ('chunk_schema_version', ?1)",
        [CHUNK_SCHEMA_VERSION.to_string()],
    )
    .map_err(|e| format!("写入分块版本失败: {e}"))?;

    tracing::info!(
        db = %db.display(),
        from = ?stored,
        to = CHUNK_SCHEMA_VERSION,
        "分块规则版本变更，旧索引已作废（下次检索全量重建）"
    );
    Ok(())
}

/// 读 meta 键（缺失/读失败 → `None`）
fn read_meta(conn: &rusqlite::Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM meta WHERE key = ?1", [key], |r| {
        r.get::<_, String>(0)
    })
    .ok()
}

/// 写 meta 键（upsert）
fn write_meta(conn: &rusqlite::Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT OR REPLACE INTO meta (key, value) VALUES (?1, ?2)",
        rusqlite::params![key, value],
    )
    .map_err(|e| format!("写入索引元信息失败: {e}"))?;
    Ok(())
}

/// 索引统计（状态展示）
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexStats {
    pub files: usize,
    pub chunks: usize,
    pub vectors: usize,
    pub dim: usize,
    /// 关键词通道是否已就绪（false = 后台播种中，检索暂只走向量通道）
    pub keyword_ready: bool,
    /// 已播种块数（就绪后等于 `chunks`；就绪前用于进度展示）
    pub keyword_built: usize,
}

/// 一次增量同步的变化量
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SyncReport {
    pub added: usize,
    pub updated: usize,
    pub removed: usize,
    pub unchanged: usize,
}

impl SyncReport {
    pub fn changed(&self) -> bool {
        self.added + self.updated + self.removed > 0
    }
}

/// 一条检索命中（工具返回值）
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceHit {
    /// workdir 相对路径
    pub path: String,
    pub start_line: usize,
    pub end_line: usize,
    /// 片段文本（过长时截断到 ~600 字符）
    pub text: String,
    pub score: f32,
    /// keyword / semantic / hybrid
    pub source: String,
}

/// 工作区索引（进程级共享：同 workdir 一个实例）
pub struct WorkspaceIndex {
    /// 索引库文件（app_data）
    db: PathBuf,
    /// 被索引的工作区根
    workdir: PathBuf,
    policy: IndexPolicy,
    /// 元数据/块读写连接（与向量索引共用同一库文件，各自连接，WAL 并存）
    conn: StdMutex<rusqlite::Connection>,
    /// 关键词索引（内存；从 chunks 重建）
    ///
    /// **⚠ 不在 `open()` 里播种**（2026-09-13 冷启动修正）：2 万块实测播种 **82.8 s**
    /// （占全量建索引的 92%，`scale_benchmark_report`）——放在 open / 检索路径上会让
    /// **首次检索阻塞约 90 s**。改由 [`WorkspaceIndex::ensure_warmup`] 在后台播种；
    /// 就绪前 `search` 跳过关键词通道（见 [`WorkspaceIndex::keyword_ready`]）。
    keyword: RwLock<Bm25Searcher>,
    /// 关键词通道是否已就绪（未就绪 = 本进程尚未完成播种）
    keyword_ready: AtomicBool,
    /// 后台预热是否已启动（单飞标志，防并发触发；成功后保持，失败则复位待重试）
    warmup_started: AtomicBool,
    /// 已播种块数（就绪前用于进度展示）
    keyword_built_chunks: AtomicUsize,
    /// 向量索引（启用语义检索时）
    vectors: Option<Arc<SqliteVectorIndex>>,
    /// 熔断嵌入器（与记忆侧同一供给面）
    embedder: Option<Arc<dyn Embedder>>,
    dim: usize,
    /// 语义配置指纹（变更时重建实例）
    semantic_key: String,
    last_sync_ms: AtomicI64,
    backfill_running: AtomicBool,
    /// 后台增量刷新是否在跑（单飞；重检索只触发不等待）
    sync_running: AtomicBool,
    sync_lock: StdMutex<()>,
}

impl WorkspaceIndex {
    /// 打开（或创建）一个 workdir 的索引库
    pub fn open(
        db: PathBuf,
        workdir: PathBuf,
        policy: IndexPolicy,
        semantic: Option<&SemanticConfig>,
    ) -> Result<Arc<Self>, String> {
        if let Some(parent) = db.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("创建索引目录失败: {e}"))?;
        }
        let conn = rusqlite::Connection::open(&db).map_err(|e| format!("打开索引库失败: {e}"))?;
        conn.execute_batch(INIT_SQL)
            .map_err(|e| format!("初始化索引表失败: {e}"))?;
        // 分块版本校验（必须在建向量索引 / 播种 BM25 **之前**：作废要连向量一起清，
        // 否则向量索引的内存缓存会把旧 chunk_id 的向量继续带进检索）
        ensure_chunk_schema(&conn, &db)?;
        // 自述信息（GC 判定依据）：记录工作区绝对路径 + 本次使用时刻。
        // canonicalize 失败（目录已不存在）时退回原路径——GC 正是要识别这类库。
        let recorded = workdir.canonicalize().unwrap_or_else(|_| workdir.to_path_buf());
        write_meta(&conn, META_WORKDIR, &recorded.to_string_lossy())?;
        write_meta(&conn, META_LAST_USED_AT, &now_ms().to_string())?;

        // 向量与嵌入器（启用语义检索时；维度变更自动清旧向量）
        let (vectors, embedder, dim): (Option<Arc<SqliteVectorIndex>>, Option<Arc<dyn Embedder>>, usize) =
            match semantic {
                Some(cfg) => {
                    ensure_vector_dim(&db, cfg.dim)?;
                    let vi = Arc::new(
                        SqliteVectorIndex::new(db.clone(), cfg.dim)
                            .map_err(|e| format!("打开向量索引失败: {e}"))?,
                    );
                    let emb: Arc<dyn Embedder> =
                        Arc::new(GatedEmbedder::new(cfg.to_embedder_config()));
                    (Some(vi), Some(emb), cfg.dim)
                }
                None => (None, None, 0),
            };

        // 关键词索引**保持为空**（**不在 open 里播种**）：全量播种 2 万块 ≈ 83 s，
        // 放在这里就让「打开索引」= 卡 83 s。改由 `ensure_warmup` 后台播种。
        let keyword = Bm25Searcher::new();

        Ok(Arc::new(Self {
            db,
            workdir,
            policy,
            conn: StdMutex::new(conn),
            keyword: RwLock::new(keyword),
            keyword_ready: AtomicBool::new(false),
            warmup_started: AtomicBool::new(false),
            keyword_built_chunks: AtomicUsize::new(0),
            vectors,
            embedder,
            dim,
            semantic_key: semantic.map(semantic_key_of).unwrap_or_default(),
            last_sync_ms: AtomicI64::new(0),
            backfill_running: AtomicBool::new(false),
            sync_running: AtomicBool::new(false),
            sync_lock: StdMutex::new(()),
        }))
    }

    /// 索引库路径
    pub fn db_path(&self) -> &Path {
        &self.db
    }

    /// 被索引的工作区根
    pub fn workdir(&self) -> &Path {
        &self.workdir
    }

    /// 关键词通道是否已就绪
    ///
    /// **未就绪时 `search` 只走向量通道且毫不犹豫等待**：全量播种 2 万块 ≈ 83 s，
    /// 在这里等就等于把冷启动阻塞从 `open` 搬到检索（那正是本次修正要消除的东西）。
    pub fn keyword_ready(&self) -> bool {
        self.keyword_ready.load(Ordering::Acquire)
    }

    /// 后台播种进度 `(已播种块数, 总块数)`（就绪后两者相等）
    pub fn keyword_progress(&self) -> (usize, usize) {
        let built = self.keyword_built_chunks.load(Ordering::Acquire);
        let total = self
            .conn
            .lock()
            .ok()
            .and_then(|c| {
                c.query_row("SELECT COUNT(*) FROM chunks", [], |r| r.get::<_, i64>(0))
                    .ok()
            })
            .unwrap_or(0) as usize;
        (built, total)
    }

    /// 触发后台预热（**增量同步 → 关键词播种**；幂等单飞）
    ///
    /// **调用方不 await**：两阶段都完成后 `keyword_ready` 翻真，后续检索自动转为
    /// 全量混合通道。失败会复位单飞标志，下一次检索可重试。
    ///
    /// **为什么是两阶段**：`sync` 负责把磁盘内容落库（首次 ≈ 全量写，
    /// 但**不写关键词**——见 [`WorkspaceIndex::index_file`] 的说明），`播种` 再一次性
    /// 从库全量构建倒排。二者分开，首建就不会把 83 s 的分词跑两遍。
    pub fn ensure_warmup(self: &Arc<Self>) {
        if self.keyword_ready() || self.warmup_started.swap(true, Ordering::SeqCst) {
            return;
        }
        let this = Arc::clone(self);
        tokio::spawn(async move {
            let started = std::time::Instant::now();
            // 阶段一：同步（把磁盘内容落库；未就绪时只写 DB，不写关键词）
            let sync_res = tokio::task::spawn_blocking({
                let this = Arc::clone(&this);
                move || this.sync()
            })
            .await;
            match sync_res {
                Ok(Ok(r)) => tracing::info!(
                    workdir = %this.workdir.display(),
                    added = r.added,
                    updated = r.updated,
                    removed = r.removed,
                    "工作区索引预热：同步阶段完成"
                ),
                Ok(Err(e)) => {
                    this.warmup_started.store(false, Ordering::SeqCst);
                    tracing::warn!("工作区索引预热：同步失败（下次检索重试）: {e}");
                    return;
                }
                Err(e) => {
                    this.warmup_started.store(false, Ordering::SeqCst);
                    tracing::warn!("工作区索引预热：同步任务异常（下次检索重试）: {e}");
                    return;
                }
            }
            // 阶段二：播种关键词（全量）
            let res = tokio::task::spawn_blocking({
                let this = Arc::clone(&this);
                move || this.build_keyword_blocking()
            })
            .await;
            match res {
                Ok(Ok(n)) => tracing::info!(
                    workdir = %this.workdir.display(),
                    chunks = n,
                    ms = started.elapsed().as_millis(),
                    "工作区索引后台预热完成（冷启动修正）"
                ),
                Ok(Err(e)) => {
                    this.warmup_started.store(false, Ordering::SeqCst);
                    tracing::warn!("关键词索引播种失败（下次检索重试）: {e}");
                }
                Err(e) => {
                    this.warmup_started.store(false, Ordering::SeqCst);
                    tracing::warn!("关键词索引播种任务异常（下次检索重试）: {e}");
                }
            }
        });
    }

    /// 同步预热（**阻塞**；测试、`rebuild`、需要「立即可用」语义的调用方共用）
    ///
    /// = [`sync`](Self::sync)（落库）+ [`build_keyword_blocking`](Self::build_keyword_blocking)
    /// （播种）。返回播种块数。
    pub fn warmup_blocking(&self) -> Result<usize, String> {
        self.sync()?;
        self.build_keyword_blocking()
    }

    /// 触发后台增量刷新（单飞；**不阻塞调用方**）
    ///
    /// 检索路径在「已就绪且去抖过期」时调用：本次检索用现有索引（可能落后于磁盘最新的
    /// 几秒变更），刷新完成后下次检索即可见。**为什么不等待**：与冷启动同一个理由——
    /// 大批量变更（`git pull`）时的同步刷新会把「卡顿」原样搬回检索路径。
    fn spawn_sync(self: &Arc<Self>) {
        if self.sync_running.swap(true, Ordering::SeqCst) {
            return;
        }
        let this = Arc::clone(self);
        tokio::spawn(async move {
            let sync_owner = Arc::clone(&this);
            let res = tokio::task::spawn_blocking(move || sync_owner.sync()).await;
            this.sync_running.store(false, Ordering::SeqCst);
            match res {
                Ok(Ok(r)) if r.changed() => tracing::debug!(
                    added = r.added,
                    updated = r.updated,
                    removed = r.removed,
                    "工作区索引后台刷新完成"
                ),
                Ok(Ok(_)) => {}
                Ok(Err(e)) => tracing::warn!("工作区索引后台刷新失败（下次检索重试）: {e}"),
                Err(e) => tracing::warn!("工作区索引后台刷新任务异常: {e}"),
            }
        });
    }

    /// 全量播种关键词索引（**阻塞**；后台预热、`rebuild` 与测试共用）
    ///
    /// 返回播种块数。重复调用安全（整表替换，不会与已有内容叠加）。
    ///
    /// **三处并发约束**：
    /// 1. **全程持 `sync_lock`**——否则「读快照 → 替换」这段窗口里若有增量 `sync`
    ///    插入，它的写入会被整表替换抹掉（快照读的是更早的库状态），造成
    ///    「块在库里、关键词里没有」的永久漏检。
    /// 2. **锁外构建、锁内替换**——若全程持关键词**写锁**，83 s 的播种会挡住所有并发
    ///    检索（`search` 取读锁即等待）。改为先在锁外建好新索引，最后用写锁**瞬间替换**：
    ///    并发的 `search` 最多等一次赋值的时间。
    /// 3. **不与 `search` 的读取冲突**：检索期间要么读到旧索引（未就绪时为空的空索引），
    ///    要么读到新索引，不存在「读一半」。
    pub fn build_keyword_blocking(&self) -> Result<usize, String> {
        let _guard = self.sync_lock.lock().map_err(|_| "同步锁中毒".to_string())?;
        let rows: Vec<(String, String, String)> = {
            let conn = self.conn.lock().map_err(|_| "索引连接锁中毒".to_string())?;
            let mut stmt = conn
                .prepare("SELECT chunk_id, path, text FROM chunks")
                .map_err(|e| format!("准备块查询失败: {e}"))?;
            let rows = stmt
                .query_map([], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                    ))
                })
                .map_err(|e| format!("查询块失败: {e}"))?;
            rows.flatten().collect()
        };
        // 锁外构建新索引（83 s 的大头；其间检索仍可读旧索引，不被阻塞）
        let fresh = Bm25Searcher::new();
        for (id, path, text) in &rows {
            fresh.index(id, path, text);
        }
        // 锁内瞬间替换
        {
            let mut kw = self
                .keyword
                .write()
                .map_err(|_| "关键词索引锁中毒".to_string())?;
            *kw = fresh;
        }
        self.keyword_built_chunks
            .store(rows.len(), Ordering::Release);
        self.keyword_ready.store(true, Ordering::Release);
        Ok(rows.len())
    }

    /// 统计
    pub fn stats(&self) -> IndexStats {
        let (files, chunks) = {
            let conn = match self.conn.lock() {
                Ok(c) => c,
                Err(_) => return IndexStats::default(),
            };
            let f: usize = conn
                .query_row("SELECT COUNT(*) FROM files", [], |r| r.get::<_, i64>(0))
                .map(|v| v as usize)
                .unwrap_or(0);
            let c: usize = conn
                .query_row("SELECT COUNT(*) FROM chunks", [], |r| r.get::<_, i64>(0))
                .map(|v| v as usize)
                .unwrap_or(0);
            (f, c)
        };
        IndexStats {
            files,
            chunks,
            vectors: self.vectors.as_ref().map(|v| v.len()).unwrap_or(0),
            dim: self.dim,
            keyword_ready: self.keyword_ready(),
            keyword_built: self.keyword_built_chunks.load(Ordering::Acquire),
        }
    }

    /// 全量重建（清空 → 重新扫描索引 → 播种关键词；向量由后台补齐）
    ///
    /// 关键词通道**在这里同步重建**（不用后台）：重建本就是用户显式发起的一次性动作，
    /// 「点了重建 → 索引立刻可用」比「稍后再可用」更符合预期。
    pub async fn rebuild(self: &Arc<Self>) -> Result<IndexStats, String> {
        {
            let conn = self.conn.lock().map_err(|_| "索引连接锁中毒".to_string())?;
            conn.execute("DELETE FROM chunks", [])
                .map_err(|e| format!("清空块失败: {e}"))?;
            conn.execute("DELETE FROM files", [])
                .map_err(|e| format!("清空文件表失败: {e}"))?;
        }
        self.keyword.write().map_err(|_| "关键词索引锁中毒".to_string())?.clear();
        // 复位就绪标志：`sync` 在未就绪时只写 DB，播放在下方显式做完
        self.keyword_ready.store(false, Ordering::Release);
        self.keyword_built_chunks.store(0, Ordering::Release);
        if let Some(v) = &self.vectors {
            v.clear();
        }
        self.last_sync_ms.store(0, Ordering::Relaxed);
        let report = self.sync()?;
        // 关键词通道全量播种（阻塞，但重建是显式动作；用 spawn_blocking 不占 async worker）
        let this = Arc::clone(self);
        let chunks = tokio::task::spawn_blocking(move || this.build_keyword_blocking())
            .await
            .map_err(|e| format!("关键词重建任务异常: {e}"))??;
        tracing::info!(
            workdir = %self.workdir.display(),
            added = report.added,
            chunks,
            "工作区索引重建完成（A2-2）"
        );
        self.spawn_backfill();
        Ok(self.stats())
    }

    /// 增量同步：重扫 + diff（size+mtime）+ 变更文件重分块（阻塞 IO，调用方按 3s 去抖）
    pub fn sync(&self) -> Result<SyncReport, String> {
        let _guard = self.sync_lock.lock().map_err(|_| "同步锁中毒".to_string())?;
        let entries = scan_files(&self.workdir, &self.policy);
        let mut report = SyncReport::default();

        let known: HashMap<String, (u64, i64)> = {
            let conn = self.conn.lock().map_err(|_| "索引连接锁中毒".to_string())?;
            let mut stmt = conn
                .prepare("SELECT path, size, mtime_ms FROM files")
                .map_err(|e| format!("准备文件表查询失败: {e}"))?;
            let rows = stmt
                .query_map([], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, i64>(1)?,
                        r.get::<_, i64>(2)?,
                    ))
                })
                .map_err(|e| format!("查询文件表失败: {e}"))?;
            rows.flatten()
                .map(|(p, s, m)| (p, (s as u64, m)))
                .collect()
        };

        let entry_map: HashMap<&str, &crate::policy::FileEntry> =
            entries.iter().map(|e| (e.rel.as_str(), e)).collect();

        // 删除：库里有、磁盘没有
        for (path, _) in known.iter() {
            if !entry_map.contains_key(path.as_str()) {
                self.forget_path(path)?;
                report.removed += 1;
            }
        }

        // 新增 / 变更
        for entry in entries.iter() {
            match known.get(&entry.rel) {
                Some((size, mtime)) if *size == entry.size && *mtime == entry.mtime_ms => {
                    report.unchanged += 1;
                }
                Some(_) => {
                    self.index_file(entry)?;
                    report.updated += 1;
                }
                None => {
                    self.index_file(entry)?;
                    report.added += 1;
                }
            }
        }

        let now = now_ms();
        self.last_sync_ms.store(now, Ordering::Relaxed);
        // 刷新使用时刻（GC 宽限期依据；写失败不影响同步本身）
        if let Ok(conn) = self.conn.lock() {
            let _ = write_meta(&conn, META_LAST_USED_AT, &now.to_string());
        }
        if report.changed() {
            tracing::debug!(
                added = report.added,
                updated = report.updated,
                removed = report.removed,
                "工作区索引增量同步（A2-2）"
            );
        }
        Ok(report)
    }

    /// 索引单个文件（重读 → 重分块 → 覆盖块 + 关键词；向量留给后台补批）
    fn index_file(&self, entry: &crate::policy::FileEntry) -> Result<(), String> {
        let content = match std::fs::read_to_string(&entry.abs) {
            Ok(c) => c,
            Err(e) => {
                tracing::debug!(path = %entry.rel, "读取文件失败（跳过）: {e}");
                return Ok(());
            }
        };
        // 边界感知分块（R2）：按扩展名选结构边界规则（未识别类型 = v1 行为）
        let chunks = crate::chunker::chunk_text_for(
            &content,
            &self.policy.chunk,
            self.policy.boundary_hint(&entry.abs),
        );

        // 先清该文件旧块（三处：SQL / 关键词 / 向量）
        self.forget_path(&entry.rel)?;

        // **单文件一个事务**：逐条 `INSERT` 各自成为一个隐式事务时，WAL 模式会**每行
        // fsync 一次**——规模实测（2 万块）显示这是建索引耗时的大头（`scale_benchmark_report`）。
        // 一个文件的块一次性提交，语义不变（要么整文件入索引，要么整文件不落）。
        {
            let mut conn = self.conn.lock().map_err(|_| "索引连接锁中毒".to_string())?;
            let tx = conn
                .transaction()
                .map_err(|e| format!("开启索引事务失败: {e}"))?;
            {
                let mut stmt = tx
                    .prepare(
                        "INSERT INTO chunks (chunk_id, path, ordinal, start_line, end_line, text) \
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    )
                    .map_err(|e| format!("准备块写入失败: {e}"))?;
                for c in &chunks {
                    let chunk_id = format!("{}#{}", entry.rel, c.ordinal);
                    stmt.execute(rusqlite::params![
                        chunk_id,
                        entry.rel,
                        c.ordinal as i64,
                        c.start_line as i64,
                        c.end_line as i64,
                        c.text
                    ])
                    .map_err(|e| format!("写入块失败: {e}"))?;
                }
            }
            tx.execute(
                "INSERT OR REPLACE INTO files (path, size, mtime_ms, indexed_at) VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![entry.rel, entry.size as i64, entry.mtime_ms, now_ms()],
            )
            .map_err(|e| format!("写入文件表失败: {e}"))?;
            tx.commit().map_err(|e| format!("提交索引事务失败: {e}"))?;
        }

        // 关键词索引：**仅在已就绪时增量写入**（2026-09-13 冷启动修正）
        //
        // 未就绪 = 本进程尚未完成全量播种，此刻写进去的内容注定被播种的 `clear()`
        // 覆盖；而首建场景（sync 全量 `added`）若在此逐块分词，**83 s 的分词会白跑
        // 两遍**（sync 一遍 + 播种一遍）→ 首建总耗时翻倍。故跳过，交给播种一次性建。
        //
        // 一致性由 `build_keyword_blocking` 全程持 `sync_lock` 保证：本函数要么在
        // 播种前/后完整执行，要么被挡在播种之外——不会出现「快照之后写入、被 clear 抹掉」。
        if self.keyword_ready() {
            let kw = self.keyword.write().map_err(|_| "关键词索引锁中毒".to_string())?;
            for c in &chunks {
                let chunk_id = format!("{}#{}", entry.rel, c.ordinal);
                kw.index(&chunk_id, &entry.rel, &c.text);
            }
        }
        Ok(())
    }

    /// 移除某路径的全部痕迹（SQL 块 + 文件行 + 关键词 + 向量）
    fn forget_path(&self, path: &str) -> Result<(), String> {
        let chunk_ids: Vec<String> = {
            let conn = self.conn.lock().map_err(|_| "索引连接锁中毒".to_string())?;
            let mut stmt = conn
                .prepare("SELECT chunk_id FROM chunks WHERE path = ?1")
                .map_err(|e| format!("准备块查询失败: {e}"))?;
            let rows = stmt
                .query_map([path], |r| r.get::<_, String>(0))
                .map_err(|e| format!("查询块失败: {e}"))?;
            let ids: Vec<String> = rows.flatten().collect();
            conn.execute("DELETE FROM chunks WHERE path = ?1", [path])
                .map_err(|e| format!("删除块失败: {e}"))?;
            conn.execute("DELETE FROM files WHERE path = ?1", [path])
                .map_err(|e| format!("删除文件行失败: {e}"))?;
            ids
        };
        if let Ok(kw) = self.keyword.write() {
            for id in &chunk_ids {
                kw.remove(id);
            }
        }
        if let Some(v) = &self.vectors {
            for id in &chunk_ids {
                v.remove(id);
            }
        }
        Ok(())
    }

    /// 检索（关键词即时 + 向量尽力；RRF 融合；scope/type 过滤）
    ///
    /// `self: &Arc<Self>`：预热与向量补批都要 `spawn` 后台任务（需持有 Arc）。
    ///
    /// ## 冷启动不阻塞（2026-09-13 修正）
    ///
    /// 本函数**从不等待索引构建**：
    /// - **未就绪**（本进程尚未播种关键词）→ 触发后台预热并立即继续；此时关键词通道
    ///   为空，结果来自向量通道（若有），下一次检索即可用全量混合。
    /// - **已就绪** → 若增量去抖过期，触发**后台**刷新（不等待）：本次用现有索引，
    ///   新变更在下次检索可见。
    ///
    /// 上层的呈现契约见 [`WorkspaceIndex::keyword_ready`] / [`WorkspaceIndex::stats`]：
    /// 调用方（`workspace_search` 工具 / 面板）应据此如实告知「索引正在构建」。
    pub async fn search(
        self: &Arc<Self>,
        query: &str,
        top_k: usize,
        scope: Option<&str>,
        ext: Option<&str>,
    ) -> Vec<WorkspaceHit> {
        if query.trim().is_empty() {
            return Vec::new();
        }
        // 冷启动：关键词通道未就绪 → 后台预热（同步 + 播种），**不等待**
        if !self.keyword_ready() {
            self.ensure_warmup();
        } else {
            // 热路径：增量刷新转后台（不等待；大批量变更时不把卡顿搬回检索路径）
            let fresh_enough =
                now_ms() - self.last_sync_ms.load(Ordering::Relaxed) < SYNC_DEBOUNCE_MS;
            if !fresh_enough {
                self.spawn_sync();
            }
        }
        // 向量后台补齐（不等它）
        self.spawn_backfill();

        let over = top_k.saturating_mul(3).max(top_k);
        let kw_hits = self
            .keyword
            .read()
            .map(|kw| kw.search(query, over))
            .unwrap_or_default();

        let sem_hits: Vec<SearchHit> = match (&self.embedder, &self.vectors) {
            (Some(embedder), Some(vectors)) => match embedder.embed(query).await {
                Ok(vec) => vectors.search(&vec, over),
                Err(e) => {
                    tracing::warn!("检索向量化失败（本轮关键词通道）: {e}");
                    Vec::new()
                }
            },
            _ => Vec::new(),
        };

        let fused: Vec<SearchHit> = match (kw_hits.is_empty(), sem_hits.is_empty()) {
            (false, true) => kw_hits,
            (true, false) => sem_hits,
            (true, true) => Vec::new(),
            (false, false) => rrf_fusion(&[kw_hits, sem_hits], over, 60),
        };

        let scope_norm = scope.map(|s| s.replace('\\', "/"));
        let ext_norm = ext.map(|e| e.trim_start_matches('.').to_ascii_lowercase());

        let mut out: Vec<WorkspaceHit> = Vec::with_capacity(top_k);
        for hit in fused {
            if let Some(scope) = &scope_norm {
                if !hit.memory_id.starts_with(scope.as_str()) {
                    continue; // memory_id = 文件相对路径
                }
            }
            if let Some(ext) = &ext_norm {
                if !hit.memory_id.to_ascii_lowercase().ends_with(&format!(".{ext}")) {
                    continue;
                }
            }
            if let Some(row) = self.read_chunk(&hit.hook_id) {
                out.push(WorkspaceHit {
                    path: row.0,
                    start_line: row.1,
                    end_line: row.2,
                    text: truncate_chars(&row.3, 600),
                    score: hit.score,
                    source: match hit.source {
                        memory_center_core::semantic::RetrievalSource::Keyword => "keyword",
                        memory_center_core::semantic::RetrievalSource::Semantic => "semantic",
                        memory_center_core::semantic::RetrievalSource::Hybrid => "hybrid",
                    }
                    .to_string(),
                });
            }
            if out.len() >= top_k {
                break;
            }
        }
        out
    }

    /// 读一条块（path/start/end/text）
    fn read_chunk(&self, chunk_id: &str) -> Option<(String, usize, usize, String)> {
        let conn = self.conn.lock().ok()?;
        conn.query_row(
            "SELECT path, start_line, end_line, text FROM chunks WHERE chunk_id = ?1",
            [chunk_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)? as usize,
                    r.get::<_, i64>(2)? as usize,
                    r.get::<_, String>(3)?,
                ))
            },
        )
        .ok()
    }

    /// 后台补向量（幂等单飞；无嵌入器时为空操作）
    ///
    /// 首批立即执行（小库首次检索后很快具备语义通道），批次间让出调度。
    /// 嵌入失败即停（熔断器兜底，避免连续撞墙）；剩余留待下次检索或重建。
    pub fn spawn_backfill(self: &Arc<Self>) {
        let (Some(_), Some(_)) = (&self.embedder, &self.vectors) else {
            return;
        };
        if self.backfill_running.swap(true, Ordering::SeqCst) {
            return;
        }
        let this = Arc::clone(self);
        tokio::spawn(async move {
            loop {
                let batch = this.next_missing(BACKFILL_BATCH);
                if batch.is_empty() {
                    break;
                }
                let Some(embedder) = this.embedder.clone() else { break };
                let Some(vectors) = this.vectors.clone() else { break };
                let texts: Vec<&str> = batch.iter().map(|(_, _, t)| t.as_str()).collect();
                match embedder.embed_batch(&texts).await {
                    Ok(vecs) => {
                        for ((chunk_id, path, _), vec) in batch.iter().zip(vecs.into_iter()) {
                            vectors.add(chunk_id, path, vec);
                        }
                    }
                    Err(e) => {
                        tracing::warn!("工作区向量补批失败（剩余留待下次）: {e}");
                        break;
                    }
                }
            }
            this.backfill_running.store(false, Ordering::SeqCst);
        });
    }

    /// 取下一批尚无向量的块（chunk_id, path, text）
    fn next_missing(&self, limit: usize) -> Vec<(String, String, String)> {
        let Ok(conn) = self.conn.lock() else {
            return Vec::new();
        };
        let Ok(mut stmt) = conn.prepare(
            "SELECT c.chunk_id, c.path, c.text FROM chunks c \
             LEFT JOIN embeddings e ON e.hook_id = c.chunk_id \
             WHERE e.hook_id IS NULL LIMIT ?1",
        ) else {
            return Vec::new();
        };
        stmt.query_map([limit as i64], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .map(|rows| rows.flatten().collect())
        .unwrap_or_default()
    }
}

impl std::fmt::Debug for WorkspaceIndex {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WorkspaceIndex")
            .field("db", &self.db)
            .field("workdir", &self.workdir)
            .field("dim", &self.dim)
            .finish()
    }
}

/// 语义配置指纹（变更即重建实例——嵌入器/维度都必须随配置）
fn semantic_key_of(cfg: &SemanticConfig) -> String {
    format!(
        "{}|{}|{}|{}",
        cfg.api_url, cfg.model, cfg.dim, cfg.api_key
    )
}

/// workdir → 索引库路径（`{index_root}/{目录名}-{指纹8}.db`；目录名净化防非法字符）
pub fn db_path_for(index_root: &Path, workdir: &Path) -> PathBuf {
    use sha2::{Digest, Sha256};
    let canon = workdir
        .canonicalize()
        .unwrap_or_else(|_| workdir.to_path_buf());
    let mut hasher = Sha256::new();
    hasher.update(canon.to_string_lossy().as_bytes());
    let hash = hasher.finalize();
    let fp: String = hash.iter().take(4).map(|b| format!("{b:02x}")).collect();
    let raw_name = workdir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let slug: String = raw_name
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
        .take(32)
        .collect();
    let slug = if slug.is_empty() { "ws".to_string() } else { slug };
    index_root.join(format!("{slug}-{fp}.db"))
}

/// 截断到 n 字符（超出加省略号）
fn truncate_chars(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        return s.to_string();
    }
    let mut out: String = s.chars().take(n).collect();
    out.push('…');
    out
}

// ─── 进程级注册表（同 workdir 共享一实例；避免重复打开/重建索引）─────────

static REGISTRY: OnceLock<tokio::sync::Mutex<HashMap<PathBuf, Arc<WorkspaceIndex>>>> = OnceLock::new();

/// 取或建某 workdir 的索引（语义配置指纹变化时重建实例）
pub async fn get_or_open(
    index_root: &Path,
    workdir: &Path,
    policy: IndexPolicy,
    semantic: Option<SemanticConfig>,
) -> Result<Arc<WorkspaceIndex>, String> {
    let db = db_path_for(index_root, workdir);
    let registry = REGISTRY.get_or_init(|| tokio::sync::Mutex::new(HashMap::new()));
    let mut map = registry.lock().await;
    if let Some(existing) = map.get(&db) {
        let key = semantic.as_ref().map(semantic_key_of).unwrap_or_default();
        if existing.semantic_key == key {
            return Ok(existing.clone());
        }
        tracing::info!("语义配置变化，重建工作区索引实例（索引数据保留：{})", db.display());
    }
    let idx = WorkspaceIndex::open(db.clone(), workdir.to_path_buf(), policy, semantic.as_ref())?;
    map.insert(db, idx.clone());
    Ok(idx)
}

/// 清空注册表（测试隔离用）
pub async fn registry_clear() {
    let registry = REGISTRY.get_or_init(|| tokio::sync::Mutex::new(HashMap::new()));
    registry.lock().await.clear();
}

// ─── 索引库 GC（孤儿清理）────────────────────────────────

/// 索引库 GC 报告
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PruneReport {
    /// 扫描到的索引库文件数
    pub scanned: usize,
    /// 实际删除数
    pub removed: usize,
    /// 工作区仍存在 → 保留
    pub kept_alive: usize,
    /// 在宽限期内 → 保留
    pub kept_recent: usize,
    /// 缺 workdir / last_used_at 记录（本机制引入前建的库）→ 保守保留
    pub skipped_unknown: usize,
    /// 本进程活跃实例占用 → 保留
    pub skipped_active: usize,
    /// 打开或删除失败（含被占用）→ 保留
    pub failed: usize,
}

impl PruneReport {
    /// 本轮是否有实际清理动作
    pub fn did_something(&self) -> bool {
        self.removed > 0
    }
}

/// 清理孤儿索引库（**保守三重条件，全部满足才删**）
///
/// 1. 库内 meta 记录了 workdir，且该目录**不存在**（已删除 / 已改名 / 移动盘未插入 / 网络盘离线）；
/// 2. `now_ms - last_used_at >= grace_ms`（默认 30 天，见 [`DEFAULT_PRUNE_GRACE_MS`]）；
/// 3. 不是本进程的活跃实例（`active` 由调用方经 [`active_index_paths`] 取）。
///
/// **宽限期为何必需**：条件 1 会把「暂时不可达」（移动盘 / 网络盘）误判成「已删除」，
/// 宽限期是这层误判的安全网——真删错了代价也可接受（索引是可重建缓存），
/// 但反复重建会白耗 embedding 额度。
///
/// **保守取向的代价**：本机制引入前建的库（无 meta 记录）**永不删**——宁可留一个死库，
/// 不可删错一个活库；清理它们的唯一途径是手动删除索引目录（见 crate 文档）。
pub fn prune_orphans(
    index_root: &Path,
    now_ms: i64,
    grace_ms: i64,
    active: &HashSet<PathBuf>,
) -> PruneReport {
    let mut report = PruneReport::default();
    let Ok(entries) = std::fs::read_dir(index_root) else {
        return report; // 索引根不存在 = 无库可清
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        // 只认主库文件（跳过 -wal / -shm 伴生文件）
        if !name.ends_with(".db") || !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        report.scanned += 1;

        if active.contains(&path) {
            report.skipped_active += 1;
            continue;
        }

        // 只读打开：GC 不应写 WAL、也不应改库 mtime
        let conn = match rusqlite::Connection::open_with_flags(
            &path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        ) {
            Ok(c) => c,
            Err(_) => {
                report.failed += 1;
                continue;
            }
        };
        let workdir = read_meta(&conn, META_WORKDIR);
        let last_used = read_meta(&conn, META_LAST_USED_AT).and_then(|v| v.parse::<i64>().ok());
        let (Some(workdir), Some(last_used)) = (workdir, last_used) else {
            report.skipped_unknown += 1;
            continue;
        };
        drop(conn);

        if Path::new(&workdir).exists() {
            report.kept_alive += 1;
            continue;
        }
        if now_ms - last_used < grace_ms {
            report.kept_recent += 1;
            continue;
        }

        // 删除：主库 + 伴生文件（伴生文件不存在即跳过）
        let mut ok = std::fs::remove_file(&path).is_ok();
        for suffix in ["-wal", "-shm"] {
            let side = PathBuf::from(format!("{}{suffix}", path.display()));
            if side.exists() {
                ok &= std::fs::remove_file(&side).is_ok();
            }
        }
        if ok {
            report.removed += 1;
            tracing::info!(
                db = %path.display(),
                workdir = %workdir,
                "孤儿索引库已清理（工作区不存在且超宽限期）"
            );
        } else {
            report.failed += 1;
        }
    }
    report
}

/// 当前进程活跃的索引库路径（GC 排除依据）
pub async fn active_index_paths() -> HashSet<PathBuf> {
    let registry = REGISTRY.get_or_init(|| tokio::sync::Mutex::new(HashMap::new()));
    registry.lock().await.keys().cloned().collect()
}

// ─── 测试 ────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;

    fn write(dir: &Path, name: &str, content: &str) {
        let p = dir.join(name);
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(p, content).unwrap();
    }

    /// 特征假嵌入器（与 agent-memory 测试同款思路）：命中触发词给对应向量，否则零向量
    struct FeatureEmbedder {
        triggers: Vec<(String, Vec<f32>)>,
    }

    #[async_trait::async_trait]
    impl Embedder for FeatureEmbedder {
        fn dim(&self) -> usize {
            3
        }
        async fn embed(&self, text: &str) -> memory_center_core::Result<Vec<f32>> {
            for (kw, v) in &self.triggers {
                if text.contains(kw.as_str()) {
                    return Ok(v.clone());
                }
            }
            Ok(vec![0.0, 0.0, 0.0])
        }
    }

    /// 确定性哈希嵌入器（**规模压测用**）
    ///
    /// 只保证「非零 + 归一化」——目的是让向量通道参与索引与检索、把规模与延迟测出来，
    /// **不评语义质量**（语义质量由 `tests/eval_retrieval.rs` 用真实端点评）。
    /// 用假嵌入器做规模测试的好处：可重复、零 API 成本、不受网络抖动干扰。
    struct HashEmbedder {
        dim: usize,
    }

    #[async_trait::async_trait]
    impl Embedder for HashEmbedder {
        fn dim(&self) -> usize {
            self.dim
        }
        async fn embed(&self, text: &str) -> memory_center_core::Result<Vec<f32>> {
            let mut v = vec![0.0f32; self.dim];
            for (i, c) in text.chars().enumerate() {
                v[(c as usize).wrapping_add(i) % self.dim] += 1.0;
            }
            let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
            if norm > 0.0 {
                for x in &mut v {
                    *x /= norm;
                }
            }
            Ok(v)
        }
    }

    /// 打开带「注入嵌入器 + 指定维度」的索引（测试专用；生产路径经 `open` 的 SemanticConfig）
    ///
    /// **返回前完成预热**（同步 + 播种）：让既有测试保持「open 之后即可检索」的假设
    /// （空库时预热近零开销）。生产路径不这样做——那正是冷启动修正要消除的阻塞。
    async fn open_idx_with(
        root: &Path,
        with_embedder: Option<Arc<dyn Embedder>>,
        dim: usize,
    ) -> Arc<WorkspaceIndex> {
        let db = root.join("index").join("ws.db");
        let workdir = root.join("ws");
        std::fs::create_dir_all(&workdir).unwrap();
        let idx = WorkspaceIndex::open(
            db,
            workdir,
            IndexPolicy::default(),
            None, // 语义走注入（见下）
        )
        .unwrap();
        if let Some(emb) = with_embedder {
            let idx2 = WorkspaceIndex {
                db: idx.db.clone(),
                workdir: idx.workdir.clone(),
                policy: idx.policy.clone(),
                conn: StdMutex::new(rusqlite::Connection::open(&idx.db).unwrap()),
                keyword: RwLock::new(Bm25Searcher::new()),
                keyword_ready: AtomicBool::new(false),
                warmup_started: AtomicBool::new(false),
                keyword_built_chunks: AtomicUsize::new(0),
                vectors: Some(Arc::new(
                    SqliteVectorIndex::new(idx.db.clone(), dim).unwrap(),
                )),
                embedder: Some(emb),
                dim,
                semantic_key: "test".into(),
                last_sync_ms: AtomicI64::new(0),
                backfill_running: AtomicBool::new(false),
                sync_running: AtomicBool::new(false),
                sync_lock: StdMutex::new(()),
            };
            let idx2 = Arc::new(idx2);
            idx2.warmup_blocking().unwrap();
            return idx2;
        }
        idx.warmup_blocking().unwrap();
        idx
    }

    async fn open_idx(root: &Path, with_embedder: Option<Arc<dyn Embedder>>) -> Arc<WorkspaceIndex> {
        open_idx_with(root, with_embedder, 3).await
    }

    #[tokio::test]
    async fn sync_indexes_and_keyword_search_finds_expected_file() {
        let dir = tempfile::tempdir().unwrap();
        let idx = open_idx(dir.path(), None).await;
        let ws = idx.workdir().to_path_buf();
        write(&ws, "考据/星际航行.md", "曲率引擎的核心是时空折叠理论。\n航行日志。");
        write(&ws, "笔记/日常.md", "今天讨论了角色设定。");
        write(&ws, "src/main.rs", "fn main() { println!(\"hello\"); }");

        let report = idx.sync().unwrap();
        assert_eq!(report.added, 3, "应新增三个文件: {report:?}");
        let stats = idx.stats();
        assert_eq!(stats.files, 3);
        assert!(stats.chunks >= 3);

        let hits = idx.search("曲率引擎", 5, None, None).await;
        assert!(!hits.is_empty(), "关键词应命中");
        assert_eq!(hits[0].path, "考据/星际航行.md");
        assert_eq!(hits[0].source, "keyword");
        assert!(hits[0].start_line >= 1);
    }

    #[tokio::test]
    async fn incremental_sync_updates_and_removes() {
        let dir = tempfile::tempdir().unwrap();
        let idx = open_idx(dir.path(), None).await;
        let ws = idx.workdir().to_path_buf();
        // 注意：新旧内容刻意「分词不重叠」（jieba 下共享词元会造成误报，如 甲方案/乙方案 共享「方案」）
        write(&ws, "a.md", "银河勘测：曲速航图");
        write(&ws, "b.md", "将被丢弃的文稿");
        idx.sync().unwrap();

        // 改 a（内容变了）→ updated = 1；b 未动 → unchanged = 1
        std::thread::sleep(std::time::Duration::from_millis(20));
        write(&ws, "a.md", "深海生物：荧光图谱");
        let r2 = idx.sync().unwrap();
        assert_eq!((r2.updated, r2.unchanged), (1, 1), "{r2:?}");
        assert!(
            idx.search("银河勘测", 5, None, None).await.is_empty(),
            "旧内容应已从索引移除"
        );
        assert!(!idx.search("深海生物", 5, None, None).await.is_empty());

        // 删 b
        std::fs::remove_file(ws.join("b.md")).unwrap();
        let r3 = idx.sync().unwrap();
        assert_eq!(r3.removed, 1, "{r3:?}");
        assert!(idx.search("将被丢弃", 5, None, None).await.is_empty());
        assert_eq!(idx.stats().files, 1);
    }

    #[tokio::test]
    async fn scope_and_ext_filters_apply() {
        let dir = tempfile::tempdir().unwrap();
        let idx = open_idx(dir.path(), None).await;
        let ws = idx.workdir().to_path_buf();
        write(&ws, "考据/设定集.md", "共同关键词 星环");
        write(&ws, "草稿/设定草.md", "共同关键词 星环");
        write(&ws, "脚本/设定.py", "# 共同关键词 星环");
        idx.sync().unwrap();

        let all = idx.search("星环", 10, None, None).await;
        assert_eq!(all.len(), 3, "无过滤应三条都命中: {all:?}");
        let scoped = idx.search("星环", 10, Some("考据"), None).await;
        assert_eq!(scoped.len(), 1);
        assert_eq!(scoped[0].path, "考据/设定集.md");
        let typed = idx.search("星环", 10, None, Some("py")).await;
        assert_eq!(typed.len(), 1);
        assert!(typed[0].path.ends_with(".py"));
    }

    #[tokio::test]
    async fn exclusions_and_limits_are_respected() {
        let dir = tempfile::tempdir().unwrap();
        let idx = open_idx(dir.path(), None).await;
        let ws = idx.workdir().to_path_buf();
        write(&ws, ".git/config.md", "排除词 网格");
        write(&ws, "node_modules/lib/readme.md", "排除词 网格");
        write(&ws, "agent-tmp/scratch.md", "排除词 网格");
        write(&ws, "binary.bin", "排除词 网格");
        write(&ws, "保留.md", "排除词 网格");
        idx.sync().unwrap();
        assert_eq!(idx.stats().files, 1, "只有白名单内的普通文件应入索引");
        let hits = idx.search("网格", 10, None, None).await;
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].path, "保留.md");
    }

    #[tokio::test]
    async fn rebuild_clears_and_reindexes() {
        let dir = tempfile::tempdir().unwrap();
        let idx = open_idx(dir.path(), None).await;
        let ws = idx.workdir().to_path_buf();
        write(&ws, "a.md", "回环测试 内容一");
        idx.sync().unwrap();
        assert!(idx.stats().chunks > 0);

        // 手工把库清空（模拟索引损坏）→ rebuild 应恢复
        {
            let conn = idx.conn.lock().unwrap();
            conn.execute("DELETE FROM chunks", []).unwrap();
        }
        assert!(idx.search("回环测试", 5, None, None).await.is_empty());
        let stats = idx.rebuild().await.unwrap();
        assert!(stats.chunks > 0, "重建后块应恢复: {stats:?}");
        assert!(!idx.search("回环测试", 5, None, None).await.is_empty());
    }

    #[tokio::test]
    async fn markdown_headings_are_not_split_across_chunks() {
        // R2 接线验证：索引管线按扩展名启用边界感知（.md → Markdown 提示）
        let dir = tempfile::tempdir().unwrap();
        let idx = open_idx(dir.path(), None).await;
        let ws = idx.workdir().to_path_buf();
        let body = "测".repeat(300); // 单行 300 字 → 节内累计已过半个块（250）
        write(
            &ws,
            "考据/长文.md",
            &format!("## 第一节\n{body}\n## 第二节\n{body}\n"),
        );
        idx.sync().unwrap();

        let spans: Vec<(i64, i64)> = {
            let conn = idx.conn.lock().unwrap();
            let mut stmt = conn
                .prepare("SELECT start_line, end_line FROM chunks WHERE path = ?1 ORDER BY ordinal")
                .unwrap();
            let rows = stmt
                .query_map(["考据/长文.md"], |r| {
                    Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?))
                })
                .unwrap();
            rows.flatten().collect()
        };
        assert!(!spans.is_empty(), "应切出块");
        let starts: Vec<i64> = spans.iter().map(|(s, _)| *s).collect();
        assert!(
            starts.contains(&3),
            "第 3 行（`## 第二节`）应成为某块起点（若走 Plain 则不会）: {spans:?}"
        );
        assert!(
            spans.iter().all(|(s, e)| !(*s < 3 && *e >= 3)),
            "标题边界不应被跨块切开: {spans:?}"
        );
    }

    #[tokio::test]
    async fn stale_chunk_schema_purges_index_and_rebuilds() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("index").join("ws.db");
        let workdir = dir.path().join("ws");
        std::fs::create_dir_all(&workdir).unwrap();
        write(&workdir, "a.md", "边界版本 校验内容");

        // 建库并登记当前分块版本
        {
            let idx = WorkspaceIndex::open(
                db.clone(),
                workdir.clone(),
                IndexPolicy::default(),
                None,
            )
            .unwrap();
            idx.sync().unwrap();
            assert_eq!(idx.stats().files, 1);
            let conn = idx.conn.lock().unwrap();
            let v: String = conn
                .query_row(
                    "SELECT value FROM meta WHERE key = 'chunk_schema_version'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(v, CHUNK_SCHEMA_VERSION.to_string(), "打开时应登记当前分块版本");
            // 伪造「升级前的旧索引」
            conn.execute(
                "UPDATE meta SET value = '1' WHERE key = 'chunk_schema_version'",
                [],
            )
            .unwrap();
        }

        // 版本不符 → 整体作废（`stats()` 直接读库，不触发懒同步）
        let idx2 =
            WorkspaceIndex::open(db.clone(), workdir.clone(), IndexPolicy::default(), None)
                .unwrap();
        assert_eq!(idx2.stats().files, 0, "旧版本索引应整体作废");
        assert_eq!(idx2.stats().chunks, 0);

        // 作废是**懒重建**：下一次同步即按新分块全量重建
        let report = idx2.sync().unwrap();
        assert_eq!(report.added, 1, "旧索引作废后应全量重建: {report:?}");
        assert_eq!(idx2.stats().files, 1);
        // 关键词通道在未就绪时不随 sync 写入，显式播种（生产由后台预热完成）
        idx2.build_keyword_blocking().unwrap();
        assert!(
            !idx2.search("边界版本", 5, None, None).await.is_empty(),
            "重建后应可检索"
        );
        drop(idx2);

        // 版本一致时重开幂等（不得反复作废）
        let idx3 = WorkspaceIndex::open(db, workdir, IndexPolicy::default(), None).unwrap();
        assert_eq!(idx3.stats().files, 1, "版本一致时重开不应作废索引");
    }

    // ─── 冷启动修正（2026-09-13）──────────────────────────

    /// 冷启动修正：首次检索**不阻塞**建索引；后台预热完成后自动转为可用
    #[tokio::test]
    async fn cold_search_returns_promptly_then_recovers_after_warmup() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("index").join("ws.db");
        let ws = dir.path().join("ws");
        std::fs::create_dir_all(&ws).unwrap();
        write(&ws, "a.md", "冷启动 语义内容 关键词");
        // 直接 open（不预热）——模拟生产冷启动路径
        let idx = WorkspaceIndex::open(db, ws, IndexPolicy::default(), None).unwrap();
        assert!(!idx.keyword_ready(), "刚 open 时应未就绪");

        // 冷检索：立即返回（触发后台预热但不等待），无关键词结果
        let t = std::time::Instant::now();
        let hits = idx.search("冷启动", 5, None, None).await;
        let elapsed = t.elapsed().as_millis();
        assert!(hits.is_empty(), "首建完成前不应有关键词结果");
        assert!(
            elapsed < 500,
            "冷检索不得阻塞建索引（全量播种实测 83 s 级；实际 {elapsed} ms）"
        );

        // 等后台预热（小库很快）
        let mut ready = false;
        for _ in 0..200 {
            if idx.keyword_ready() {
                ready = true;
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
        assert!(ready, "后台预热应在合理时间内完成");
        let hits = idx.search("冷启动", 5, None, None).await;
        assert!(!hits.is_empty(), "预热完成后应能检索到: {hits:?}");
        // 预热是幂等的：重复触发不再改变状态
        idx.ensure_warmup();
        assert!(idx.keyword_ready());
    }

    /// 已就绪后的文件变更由**后台**增量刷新吸收：检索不阻塞、随后可见
    #[tokio::test]
    async fn ready_search_refreshes_in_background() {
        let dir = tempfile::tempdir().unwrap();
        let idx = open_idx(dir.path(), None).await; // 预热过（就绪）
        assert!(idx.keyword_ready());
        let ws = idx.workdir().to_path_buf();
        write(&ws, "new.md", "崭新主题 灯塔守则");

        // 拨旧去抖时间戳，确保本次检索会触发后台刷新
        idx.last_sync_ms.store(0, Ordering::Relaxed);
        let t = std::time::Instant::now();
        let _ = idx.search("灯塔守则", 5, None, None).await;
        assert!(
            t.elapsed().as_millis() < 500,
            "检索不应等待后台刷新（实际 {} ms）",
            t.elapsed().as_millis()
        );

        // 轮询：后台刷新完成后新文件应可被检索
        let mut found = false;
        for _ in 0..300 {
            if !idx.search("灯塔守则", 5, None, None).await.is_empty() {
                found = true;
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
        assert!(found, "后台刷新完成后新文件应可被检索");
    }

    #[tokio::test]
    async fn vector_channel_participates_after_backfill() {
        let dir = tempfile::tempdir().unwrap();
        let embedder: Arc<dyn Embedder> = Arc::new(FeatureEmbedder {
            triggers: vec![
                ("城市设定".to_string(), vec![1.0f32, 0.0, 0.0]),
                ("赛博朋克".to_string(), vec![1.0f32, 0.0, 0.0]),
            ],
        });
        let idx = open_idx(dir.path(), Some(embedder)).await;
        let ws = idx.workdir().to_path_buf();
        write(&ws, "设定.md", "赛博朋克 城市设定：霓虹与雨夜。");
        write(&ws, "无关.md", "烹饪食谱：红烧肉。");
        idx.sync().unwrap();

        // 首次检索触发后台补向量
        let _ = idx.search("城市设定", 5, None, None).await;
        for _ in 0..50 {
            if idx.stats().vectors > 0 {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        assert!(idx.stats().vectors > 0, "后台应补齐向量: {:?}", idx.stats());

        // 纯语义查询：查询词与文档无字面重叠（BM25 无命中），命中靠向量通道
        let hits = idx.search("城市设定问询", 5, None, None).await;
        assert!(
            hits.iter().any(|h| h.path == "设定.md"),
            "向量通道应命中: {hits:?}"
        );
    }

    // ─── 索引库 GC（孤儿清理）────────────────────────────

    /// `open` 必须写下 workdir 与使用时刻——GC 的判定依据
    #[tokio::test]
    async fn open_records_workdir_and_last_used_at() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("index").join("ws.db");
        let workdir = dir.path().join("ws");
        std::fs::create_dir_all(&workdir).unwrap();
        let idx =
            WorkspaceIndex::open(db, workdir.clone(), IndexPolicy::default(), None).unwrap();
        let expected = workdir.canonicalize().unwrap().to_string_lossy().to_string();
        let conn = idx.conn.lock().unwrap();
        assert_eq!(
            read_meta(&conn, META_WORKDIR).as_deref(),
            Some(expected.as_str()),
            "应记录工作区绝对路径（库名的路径哈希不可反解）"
        );
        assert!(read_meta(&conn, META_LAST_USED_AT).is_some(), "应记录使用时刻");
    }

    /// GC：只删「工作区不存在 + 超宽限期」；三种保护各验一次
    #[tokio::test]
    async fn prune_removes_only_stale_orphans() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("index");
        std::fs::create_dir_all(&root).unwrap();

        // 1) 孤儿 + 超期 → 应删
        let orphan_ws = dir.path().join("gone");
        std::fs::create_dir_all(&orphan_ws).unwrap();
        let orphan_db = root.join("gone-aaaaaaaa.db");
        {
            let _ = WorkspaceIndex::open(
                orphan_db.clone(),
                orphan_ws.clone(),
                IndexPolicy::default(),
                None,
            )
            .unwrap();
        }
        std::fs::remove_dir_all(&orphan_ws).unwrap(); // 工作区消失
        // 把使用时刻回拨到宽限期之外（刚建的库当然还在宽限期内）
        {
            let conn = rusqlite::Connection::open(&orphan_db).unwrap();
            write_meta(
                &conn,
                META_LAST_USED_AT,
                &(now_ms() - DEFAULT_PRUNE_GRACE_MS - 1).to_string(),
            )
            .unwrap();
        }

        // 2) 工作区仍在 → 保留
        let live_ws = dir.path().join("alive");
        std::fs::create_dir_all(&live_ws).unwrap();
        let live_db = root.join("alive-bbbbbbbb.db");
        let _live =
            WorkspaceIndex::open(live_db.clone(), live_ws, IndexPolicy::default(), None).unwrap();

        // 3) 孤儿但在宽限期内 → 保留
        let recent_ws = dir.path().join("recent");
        std::fs::create_dir_all(&recent_ws).unwrap();
        let recent_db = root.join("recent-cccccccc.db");
        {
            let _ = WorkspaceIndex::open(
                recent_db.clone(),
                recent_ws.clone(),
                IndexPolicy::default(),
                None,
            )
            .unwrap();
        }
        std::fs::remove_dir_all(&recent_ws).unwrap();

        let now = now_ms();
        let report = prune_orphans(&root, now, DEFAULT_PRUNE_GRACE_MS, &HashSet::new());
        assert_eq!(report.scanned, 3, "{report:?}");
        assert_eq!(report.removed, 1, "只有超期孤儿应被删: {report:?}");
        assert_eq!(report.kept_alive, 1);
        assert_eq!(report.kept_recent, 1);
        assert!(!orphan_db.exists(), "超期孤儿库应已删除");
        assert!(live_db.exists(), "工作区仍存在的库不得删");
        assert!(recent_db.exists(), "宽限期内的库不得删");

        // 宽限期 0 → 宽限期内的孤儿也超期 → 删
        let report2 = prune_orphans(&root, now, 0, &HashSet::new());
        assert_eq!(report2.removed, 1, "{report2:?}");
        assert!(!recent_db.exists());
        assert!(live_db.exists(), "工作区仍存在的库始终不得删");
    }

    /// GC：活跃实例与「无 meta 记录的老库」都必须保留（保守取向）
    #[tokio::test]
    async fn prune_skips_active_and_unknown() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("index");
        std::fs::create_dir_all(&root).unwrap();

        // 活跃实例：连它的工作区也「消失」，仍不得删
        let ws = dir.path().join("busy");
        std::fs::create_dir_all(&ws).unwrap();
        let db = root.join("busy-dddddddd.db");
        let _idx =
            WorkspaceIndex::open(db.clone(), ws.clone(), IndexPolicy::default(), None).unwrap();
        std::fs::remove_dir_all(&ws).unwrap();
        let mut active = HashSet::new();
        active.insert(db.clone());
        let report = prune_orphans(&root, now_ms(), 0, &active);
        assert_eq!(report.skipped_active, 1, "{report:?}");
        assert!(db.exists(), "活跃实例不得删");

        // 无 meta 记录的老库（本机制引入前建的）→ 保守保留
        let legacy = root.join("legacy-eeeeeeee.db");
        {
            let conn = rusqlite::Connection::open(&legacy).unwrap();
            conn.execute_batch("CREATE TABLE files (path TEXT PRIMARY KEY);")
                .unwrap();
        }
        let report2 = prune_orphans(&root, now_ms(), 0, &HashSet::new());
        assert_eq!(report2.skipped_unknown, 1, "{report2:?}");
        assert!(legacy.exists(), "无 meta 记录的老库不得自动删（需手动清索引目录）");
    }

    /// `active_index_paths` 应反映注册表内容（GC 排除依据）
    #[tokio::test]
    async fn active_index_paths_reflects_registry() {
        registry_clear().await;
        let dir = tempfile::tempdir().unwrap();
        let ws = dir.path().join("ws");
        std::fs::create_dir_all(&ws).unwrap();
        let idx = get_or_open(&dir.path().join("index"), &ws, IndexPolicy::default(), None)
            .await
            .unwrap();
        let active = active_index_paths().await;
        assert!(active.contains(idx.db_path()), "活跃库应出现在排除集合: {active:?}");
        registry_clear().await;
        assert!(active_index_paths().await.is_empty(), "清空后应为空");
    }

    // ─── 规模压测（默认忽略）──────────────────────────────

    /// 「2 万 chunk 量级」的建索引与检索延迟实测
    ///
    /// 文档里「2 万 chunk 落在 `SqliteVectorIndex` 内存暴力甜点区」此前只是**测算**；
    /// 本测试把它变成**实测**。用确定性假嵌入器（不调端点）→ 可重复、零成本；
    /// 只测**规模与延迟**，不评语义质量（语义由 `tests/eval_retrieval.rs` 真端点评）。
    ///
    /// 运行：`cargo test --offline --lib -- --ignored --nocapture scale_benchmark`
    #[tokio::test]
    #[ignore = "规模压测（IO 密集，数分钟）：cargo test --offline --lib -- --ignored --nocapture"]
    async fn scale_benchmark_report() {
        use std::time::Instant;

        const FILES: usize = 500;
        const BLOCKS_PER_FILE: usize = 40; // 每块 ≈ 1 行 ≈ 1 chunk（max_chars=500）
        const BLOCK_CHARS: usize = 450;
        const QUERIES: usize = 20;
        const DIM: usize = 1024; // 对齐 bge-m3

        let dir = tempfile::tempdir().unwrap();
        let ws = dir.path().join("ws");
        std::fs::create_dir_all(&ws).unwrap();

        // 语料：500 × 40 ≈ 2 万块（约 27 MB UTF-8）
        let t = Instant::now();
        for f in 0..FILES {
            let mut body = String::new();
            for b in 0..BLOCKS_PER_FILE {
                body.push_str(&format!(
                    "文档{f} 段落{b} {} 关键词{} 星门 灵能 遗迹 命名\n",
                    "测".repeat(BLOCK_CHARS - 40),
                    b % 17
                ));
            }
            std::fs::write(ws.join(format!("doc{f:04}.md")), body).unwrap();
        }
        println!(
            "[规模压测] 合成语料 {FILES} 文件 × {BLOCKS_PER_FILE} 块 ≈ {} 块，生成 {} ms",
            FILES * BLOCKS_PER_FILE,
            t.elapsed().as_millis()
        );

        // 分阶段计时：定位「扫描 / 读+分块 / 落库+BM25」各占多少
        let policy = IndexPolicy::default();
        let t = Instant::now();
        let entries = scan_files(&ws, &policy);
        let scan_ms = t.elapsed().as_millis();
        let t = Instant::now();
        let mut total_chunks = 0usize;
        for e in &entries {
            if let Ok(c) = std::fs::read_to_string(&e.abs) {
                total_chunks +=
                    crate::chunker::chunk_text_for(&c, &policy.chunk, policy.boundary_hint(&e.abs))
                        .len();
            }
        }
        let chunk_ms = t.elapsed().as_millis();
        println!(
            "[规模压测] 分阶段: 扫描 {scan_ms} ms / 读+分块 {chunk_ms} ms（{total_chunks} 块）\
             → 余下即落库 + BM25 分词"
        );

        // 首建总耗时（新口径·冷启动修正后）：open 不再阻塞，但 `open_idx_with` 会调
        // `warmup_blocking`（= 同步 + 播种，即生产后台预热的同一路径）→ 这里量到的
        // 就是「后台预热」的真实成本。**关键差异**：生产里它发生在后台，检索不再等它。
        let embedder: Arc<dyn Embedder> = Arc::new(HashEmbedder { dim: DIM });
        let t = Instant::now();
        let idx = open_idx_with(dir.path(), Some(embedder), DIM).await;
        let first_build_ms = t.elapsed().as_millis();
        let stats = idx.stats();
        println!(
            "[规模压测] 首建总耗时（同步+播种，后台路径）: {first_build_ms} ms → 文件 {} / 块 {}",
            stats.files, stats.chunks
        );
        assert!(idx.keyword_ready(), "预热后关键词通道应就绪");

        // BM25 单独计时（**含 jieba 分词 + 倒排表构建**）——把 86 s 的归属钉死
        // （黑盒计时：不依赖 jieba 依赖，走 vendor 的 `KeywordSearcher::index`）
        let t = Instant::now();
        let kw_probe = Bm25Searcher::new();
        let mut bm25_rows = 0usize;
        {
            let conn = idx.conn.lock().unwrap();
            let mut stmt = conn
                .prepare("SELECT chunk_id, path, text FROM chunks")
                .unwrap();
            let rows = stmt
                .query_map([], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                    ))
                })
                .unwrap();
            for (id, path, text) in rows.flatten() {
                KeywordSearcher::index(&kw_probe, &id, &path, &text);
                bm25_rows += 1;
            }
        }
        let bm25_ms = t.elapsed().as_millis();
        println!(
            "[规模压测] BM25 单独计时（jieba + 倒排）: {bm25_ms} ms（{bm25_rows} 块 → \
             {} 个词元条目）；首建其余 {} ms 归「扫描+分块+落库」",
            kw_probe.len(),
            first_build_ms.saturating_sub(bm25_ms)
        );

        // 向量补齐（含 SQLite BLOB 写入）
        let t = Instant::now();
        idx.spawn_backfill();
        for _ in 0..6000 {
            if idx.stats().vectors >= idx.stats().chunks {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
        let stats = idx.stats();
        println!(
            "[规模压测] 向量补齐: {} ms → {} 条（dim {DIM}，约 {} MB BLOB）",
            t.elapsed().as_millis(),
            stats.vectors,
            stats.vectors * DIM * 4 / (1024 * 1024)
        );

        // 检索延迟（关键词通道 / 混合通道）
        let queries: Vec<String> = (0..QUERIES)
            .map(|i| format!("关键词{} 星门 灵界{i}", i % 17))
            .collect();
        let (mut kw, mut hy) = (Vec::new(), Vec::new());
        for q in &queries {
            let t = Instant::now();
            let _ = idx.keyword.read().map(|k| k.search(q, 8));
            kw.push(t.elapsed().as_secs_f64() * 1000.0);
            let t = Instant::now();
            let _ = idx.search(q, 8, None, None).await;
            hy.push(t.elapsed().as_secs_f64() * 1000.0);
        }
        let avg = |v: &[f64]| v.iter().sum::<f64>() / v.len() as f64;
        let p95 = |v: &[f64]| {
            let mut s = v.to_vec();
            s.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
            s[((s.len() as f64 * 0.95) as usize).min(s.len() - 1)]
        };
        println!(
            "[规模压测] 检索延迟（{QUERIES} 次）: 关键词 avg {:.1} ms / p95 {:.1} ms ｜ \
             混合（含查询向量化 + 余弦 + RRF）avg {:.1} ms / p95 {:.1} ms",
            avg(&kw),
            p95(&kw),
            avg(&hy),
            p95(&hy)
        );

        // 块数取决于分块器打包（每块约 2 行 ≈ 900 字，`max_chars` 是软目标），
        // 故只校验量级而不是精确值
        assert_eq!(stats.files, FILES, "文件应全部入索引");
        assert!(
            stats.chunks >= FILES * BLOCKS_PER_FILE / 2,
            "块数应达万级，实际 {}",
            stats.chunks
        );
        assert_eq!(stats.vectors, stats.chunks, "向量应全部补齐");
    }
}
