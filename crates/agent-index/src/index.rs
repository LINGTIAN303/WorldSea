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

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
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

/// 索引统计（状态展示）
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexStats {
    pub files: usize,
    pub chunks: usize,
    pub vectors: usize,
    pub dim: usize,
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
    keyword: RwLock<Bm25Searcher>,
    /// 向量索引（启用语义检索时）
    vectors: Option<Arc<SqliteVectorIndex>>,
    /// 熔断嵌入器（与记忆侧同一供给面）
    embedder: Option<Arc<dyn Embedder>>,
    dim: usize,
    /// 语义配置指纹（变更时重建实例）
    semantic_key: String,
    last_sync_ms: AtomicI64,
    backfill_running: AtomicBool,
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

        // 关键词索引自 chunks 重建（本地、快；首次打开即完整可用）
        let keyword = Bm25Searcher::new();
        {
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
            for row in rows.flatten() {
                keyword.index(&row.0, &row.1, &row.2);
            }
        }

        Ok(Arc::new(Self {
            db,
            workdir,
            policy,
            conn: StdMutex::new(conn),
            keyword: RwLock::new(keyword),
            vectors,
            embedder,
            dim,
            semantic_key: semantic.map(semantic_key_of).unwrap_or_default(),
            last_sync_ms: AtomicI64::new(0),
            backfill_running: AtomicBool::new(false),
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
        }
    }

    /// 全量重建（清空 → 重新扫描索引；向量由后台补齐）
    pub async fn rebuild(self: &Arc<Self>) -> Result<IndexStats, String> {
        {
            let conn = self.conn.lock().map_err(|_| "索引连接锁中毒".to_string())?;
            conn.execute("DELETE FROM chunks", [])
                .map_err(|e| format!("清空块失败: {e}"))?;
            conn.execute("DELETE FROM files", [])
                .map_err(|e| format!("清空文件表失败: {e}"))?;
        }
        self.keyword.write().map_err(|_| "关键词索引锁中毒".to_string())?.clear();
        if let Some(v) = &self.vectors {
            v.clear();
        }
        self.last_sync_ms.store(0, Ordering::Relaxed);
        let report = self.sync()?;
        tracing::info!(
            workdir = %self.workdir.display(),
            added = report.added,
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

        {
            let conn = self.conn.lock().map_err(|_| "索引连接锁中毒".to_string())?;
            let mut stmt = conn
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
            conn.execute(
                "INSERT OR REPLACE INTO files (path, size, mtime_ms, indexed_at) VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![entry.rel, entry.size as i64, entry.mtime_ms, now_ms()],
            )
            .map_err(|e| format!("写入文件表失败: {e}"))?;
        }

        {
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
    /// `self: &Arc<Self>`：向量补批要 `spawn` 后台任务（需持有 Arc）。
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
        // 增量刷新（3s 去抖；阻塞 IO，规模内可接受）
        let fresh_enough = now_ms() - self.last_sync_ms.load(Ordering::Relaxed) < SYNC_DEBOUNCE_MS;
        if !fresh_enough {
            if let Err(e) = self.sync() {
                tracing::warn!("工作区索引增量同步失败（用现有索引继续）: {e}");
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

    async fn open_idx(root: &Path, with_embedder: Option<Arc<dyn Embedder>>) -> Arc<WorkspaceIndex> {
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
            // 测试注入：重建为带嵌入器的实例（生产路径经 `open` 的 SemanticConfig）
            let idx2 = WorkspaceIndex {
                db: idx.db.clone(),
                workdir: idx.workdir.clone(),
                policy: idx.policy.clone(),
                conn: StdMutex::new(rusqlite::Connection::open(&idx.db).unwrap()),
                keyword: RwLock::new(Bm25Searcher::new()),
                vectors: Some(Arc::new(
                    SqliteVectorIndex::new(idx.db.clone(), 3).unwrap(),
                )),
                embedder: Some(emb),
                dim: 3,
                semantic_key: "test".into(),
                last_sync_ms: AtomicI64::new(0),
                backfill_running: AtomicBool::new(false),
                sync_lock: StdMutex::new(()),
            };
            // 重建关键词索引
            let idx2 = Arc::new(idx2);
            idx2.sync().unwrap();
            return idx2;
        }
        idx
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
        assert!(
            !idx2.search("边界版本", 5, None, None).await.is_empty(),
            "重建后应可检索"
        );
        drop(idx2);

        // 版本一致时重开幂等（不得反复作废）
        let idx3 = WorkspaceIndex::open(db, workdir, IndexPolicy::default(), None).unwrap();
        assert_eq!(idx3.stats().files, 1, "版本一致时重开不应作废索引");
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
}
