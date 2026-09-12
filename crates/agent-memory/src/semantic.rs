//! A2 戊1：语义检索装配（混合检索栈）
//!
//! 接线 vendor 既有「混合检索」能力（上游 v2.5 批次 7，WorldSea 此前零接线）：
//!
//! ```text
//! query ─┬─→ Bm25Searcher（jieba 中文分词）──────────────→ kw_results ─┐
//!        └─→ HttpEmbedder（OpenAI 兼容 /v1/embeddings）→ 向量余弦 top-k ┴→ RRF 融合
//! ```
//!
//! ## 索引对象（A1 §7.4 戊1 同步项的口径裁定）
//!
//! **索引文本 = 摘要口径**（`index_text_of`）：摘要标题 | 抽象摘要 | 关键事实 |
//! 关键实体 | 线索锚点 | 真标签。不含原始 turns 原文——索引对象与「召回返回物」
//! （摘要视图）保持一致，避免把全量原文发往 embedding 端点（成本 / 隐私）。
//! 上游 v2.35 的「turns 文本入索引」经验留作 R2 升级项。
//!
//! ## 进程级共享（防多会话索引发散）
//!
//! 同一向量库路径只保留**一个**栈实例（进程内注册表）：多会话各自持有内存索引
//! （BM25 倒排 / 向量缓存）时会互相看不到对方的写入 → 检索结果发散。注册表按
//! 向量库路径去重，配置指纹变化时重建栈（索引数据保留在向量库，BM25 由调用方
//! 重新播种）。
//!
//! ## 降级链（三层，全部不中断主链路）
//!
//! 1. **未配置**：装配层不注入 `SemanticConfig` → 召回走既有关键词路径（零变化）
//! 2. **Embedder 网络失败**：`HybridRetriever` 内建降级 → 仅关键词通道；
//!    叠加 [`GatedEmbedder`] 熔断——连续失败后短窗口内直接拒绝（不发网络请求），
//!    避免每轮召回都吃一次超时
//! 3. **维度变更**：向量库与新模型向量不可比 → 建栈时清空旧向量（重新播种）

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicI64, AtomicU32, AtomicUsize, Ordering};
use std::sync::{Arc, OnceLock, RwLock};

use memory_center_core::bm25::Bm25Searcher;
use memory_center_core::hybrid::HybridRetriever;
use memory_center_core::retrieve::SummaryView;
use memory_center_core::semantic::{Embedder, KeywordSearcher, SearchHit, VectorIndex};
use memory_center_core::sqlite_vector::SqliteVectorIndex;
use memory_center_llm::embedder::{EmbedderConfig, HttpEmbedder};

// ─── 配置 ────────────────────────────────────────────────

/// 语义检索配置（由装配层注入；装配层未注入 = 未启用）
#[derive(Debug, Clone, PartialEq)]
pub struct SemanticConfig {
    /// OpenAI 兼容端点（如 `https://api.siliconflow.cn/v1/embeddings`）
    pub api_url: String,
    /// API Key（Bearer）
    pub api_key: String,
    /// 模型名（如 `BAAI/bge-m3`）
    pub model: String,
    /// 向量维度（如 bge-m3 = 1024）
    pub dim: usize,
    /// 请求超时（秒）
    pub timeout_secs: u64,
}

impl SemanticConfig {
    /// 配置指纹比较（决定注册表内栈实例能否复用）
    ///
    /// 参与比较 = 影响「已产出的向量」或「请求形态」的字段：端点 / 模型 / 维度 /
    /// Key（换 Key 需重建 embedder 实例）。超时不参与（不改变向量语义）。
    pub fn same_fingerprint(&self, other: &Self) -> bool {
        self.api_url == other.api_url
            && self.model == other.model
            && self.dim == other.dim
            && self.api_key == other.api_key
    }

    fn to_embedder_config(&self) -> EmbedderConfig {
        EmbedderConfig {
            api_url: self.api_url.clone(),
            api_key: self.api_key.clone(),
            model: self.model.clone(),
            dim: self.dim,
            timeout_secs: self.timeout_secs,
        }
    }
}

/// 语义索引统计（状态展示 / 重建结果）
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticStats {
    /// 关键词索引文档数
    pub keyword_len: usize,
    /// 向量索引条数
    pub vector_len: usize,
    /// 向量维度
    pub dim: usize,
}

// ─── 熔断嵌入器 ──────────────────────────────────────────

/// 带熔断的 Embedder 包装
///
/// `recall` 是**每轮都跑**的热路径：后端不可达时若每轮都等一次超时，体感极差。
/// 连续 [`FAIL_THRESHOLD`](Self::FAIL_THRESHOLD) 次失败即开闸（熔断），
/// [`COOLDOWN_MS`](Self::COOLDOWN_MS) 窗口内直接返回错误（零网络开销）→
/// 上游 `HybridRetriever` 顺势降级为仅关键词；窗口过后放行一次探测请求。
pub struct GatedEmbedder {
    inner: HttpEmbedder,
    fail_streak: AtomicU32,
    /// 熔断截止时点（Unix 毫秒；0 = 未熔断）
    open_until_ms: AtomicI64,
    /// 连续失败阈值（达到即熔断）
    threshold: u32,
    /// 冷却窗口（毫秒）
    cooldown_ms: i64,
}

impl GatedEmbedder {
    /// 连续失败阈值（达到即熔断）
    pub const FAIL_THRESHOLD: u32 = 3;
    /// 熔断冷却窗口（毫秒）
    pub const COOLDOWN_MS: i64 = 60_000;

    /// 构造（含默认熔断参数）
    pub fn new(config: EmbedderConfig) -> Self {
        Self::with_params(config, Self::FAIL_THRESHOLD, Self::COOLDOWN_MS)
    }

    /// 自定义熔断参数（测试用）
    pub fn with_params(config: EmbedderConfig, threshold: u32, cooldown_ms: i64) -> Self {
        Self {
            inner: HttpEmbedder::new(config),
            fail_streak: AtomicU32::new(0),
            open_until_ms: AtomicI64::new(0),
            threshold: threshold.max(1),
            cooldown_ms: cooldown_ms.max(0),
        }
    }

    /// 当前是否处于熔断窗口（测试 / 状态展示）
    pub fn is_open(&self) -> bool {
        let until = self.open_until_ms.load(Ordering::Relaxed);
        until > 0 && Self::now_ms() < until
    }

    fn now_ms() -> i64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0)
    }

    /// 熔断闸门：Err = 直接拒绝（不发起网络请求）
    fn gate(&self) -> Result<(), String> {
        let until = self.open_until_ms.load(Ordering::Relaxed);
        if until > 0 && Self::now_ms() < until {
            return Err(format!("Embedder 熔断中（连续失败，冷却至 {until}）"));
        }
        if until > 0 && Self::now_ms() >= until {
            // 冷却结束：清零，放行探测
            self.open_until_ms.store(0, Ordering::Relaxed);
            self.fail_streak.store(0, Ordering::Relaxed);
        }
        Ok(())
    }

    fn record_ok(&self) {
        self.fail_streak.store(0, Ordering::Relaxed);
        self.open_until_ms.store(0, Ordering::Relaxed);
    }

    fn record_fail(&self) {
        let streak = self.fail_streak.fetch_add(1, Ordering::Relaxed) + 1;
        if streak >= self.threshold {
            self.open_until_ms
                .store(Self::now_ms() + self.cooldown_ms, Ordering::Relaxed);
            tracing::warn!(
                streak,
                cooldown_ms = self.cooldown_ms,
                "Embedder 连续失败达阈值，熔断开启（短窗口内跳过语义通道）"
            );
        }
    }
}

#[async_trait::async_trait]
impl Embedder for GatedEmbedder {
    fn dim(&self) -> usize {
        self.inner.dim()
    }

    async fn embed(&self, text: &str) -> memory_center_core::Result<Vec<f32>> {
        self.gate().map_err(memory_center_core::Error::Storage)?;
        match self.inner.embed(text).await {
            Ok(v) => {
                self.record_ok();
                Ok(v)
            }
            Err(e) => {
                self.record_fail();
                Err(e)
            }
        }
    }

    async fn embed_batch(&self, texts: &[&str]) -> memory_center_core::Result<Vec<Vec<f32>>> {
        self.gate().map_err(memory_center_core::Error::Storage)?;
        match self.inner.embed_batch(texts).await {
            Ok(v) => {
                self.record_ok();
                Ok(v)
            }
            Err(e) => {
                self.record_fail();
                Err(e)
            }
        }
    }

    fn is_normalized(&self) -> bool {
        true
    }
}

// ─── 混合检索栈 ──────────────────────────────────────────

/// 混合检索栈（进程级共享；一个向量库路径一个实例）
pub struct SemanticStack {
    config: SemanticConfig,
    /// 关键词索引（jieba 分词 BM25）
    keyword: Arc<Bm25Searcher>,
    /// 向量索引（SQLite BLOB 持久化 + 内存缓存，余弦检索）
    vectors: Arc<SqliteVectorIndex>,
    /// 文本向量化器（生产 = 带熔断的 HTTP 实现；测试可注入假实现）
    embedder: Arc<dyn Embedder>,
    /// RRF 融合检索器（vendor 实现；Embedder 失败自动降级）
    retriever: Arc<HybridRetriever>,
    /// 向量库路径（统计 / 重建命令用）
    vector_db: PathBuf,
    /// 已入向量索引的 hook 集合（增量回填判定用；建栈时从库内读出）
    indexed_hooks: RwLock<HashSet<String>>,
    /// BM25 是否已播种（懒播种：首次检索前用全量摘要灌一次）
    keyword_seeded: AtomicUsize,
}

impl SemanticStack {
    /// 建栈（生产路径）：维度校验 → 打开向量库 → HTTP Embedder（带熔断）→ 组装
    ///
    /// BM25 为空索引，待调用方播种；向量直接复用库内已持久化的部分。
    pub fn build(vector_db: PathBuf, config: SemanticConfig) -> Result<Arc<Self>, String> {
        let embedder: Arc<dyn Embedder> =
            Arc::new(GatedEmbedder::new(config.to_embedder_config()));
        Self::build_with_embedder(vector_db, config, embedder)
    }

    /// 建栈（注入自定义 Embedder；测试与本地模型插拔用）
    pub fn build_with_embedder(
        vector_db: PathBuf,
        config: SemanticConfig,
        embedder: Arc<dyn Embedder>,
    ) -> Result<Arc<Self>, String> {
        ensure_vector_dim(&vector_db, config.dim)?;
        let vectors = Arc::new(
            SqliteVectorIndex::new(vector_db.clone(), config.dim)
                .map_err(|e| format!("打开向量库失败: {e}"))?,
        );
        let indexed = read_indexed_hooks(&vector_db);
        let keyword = Arc::new(Bm25Searcher::new());
        let retriever = Arc::new(HybridRetriever::new(
            keyword.clone(),
            embedder.clone(),
            vectors.clone(),
        ));
        Ok(Arc::new(Self {
            config,
            keyword,
            vectors,
            embedder,
            retriever,
            vector_db,
            indexed_hooks: RwLock::new(indexed),
            keyword_seeded: AtomicUsize::new(0),
        }))
    }

    /// 配置（注册表指纹比较用）
    pub fn config(&self) -> &SemanticConfig {
        &self.config
    }

    /// 向量库路径
    pub fn vector_db(&self) -> &Path {
        &self.vector_db
    }

    /// 统计（关键词 / 向量条数 + 维度）
    pub fn stats(&self) -> SemanticStats {
        SemanticStats {
            keyword_len: self.keyword.len(),
            vector_len: self.vectors.len(),
            dim: self.config.dim,
        }
    }

    /// 该 hook 是否已有向量（增量回填判定）
    pub fn has_vector(&self, hook_id: &str) -> bool {
        self.indexed_hooks
            .read()
            .map(|s| s.contains(hook_id))
            .unwrap_or(false)
    }

    /// BM25 是否已播种
    pub fn keyword_seeded(&self) -> bool {
        self.keyword_seeded.load(Ordering::Acquire) == 1
    }

    /// 标记 BM25 已播种
    pub fn mark_keyword_seeded(&self) {
        self.keyword_seeded.store(1, Ordering::Release);
    }

    /// 只灌关键词索引（本地、零网络；播种路径的主体）
    pub fn index_keyword(&self, hook_id: &str, memory_id: &str, text: &str) {
        self.keyword.index(hook_id, memory_id, text);
    }

    /// 增量索引一条（关键词必写；向量尽力——失败留给下次播种补齐）
    ///
    /// 返回向量是否入索引（false = embedding 失败或熔断中）。
    pub async fn index_hook(&self, hook_id: &str, memory_id: &str, text: &str) -> bool {
        self.keyword.index(hook_id, memory_id, text);
        match self.embedder.embed(text).await {
            Ok(vector) => {
                self.vectors.add(hook_id, memory_id, vector);
                if let Ok(mut set) = self.indexed_hooks.write() {
                    set.insert(hook_id.to_string());
                }
                true
            }
            Err(e) => {
                tracing::warn!(hook = %hook_id, "记忆索引向量化失败（留待下次播种补齐）: {e}");
                false
            }
        }
    }

    /// 移除索引（删除 / 淘汰时同步）
    pub fn remove(&self, hook_id: &str) {
        self.keyword.remove(hook_id);
        self.vectors.remove(hook_id);
        if let Ok(mut set) = self.indexed_hooks.write() {
            set.remove(hook_id);
        }
    }

    /// 混合检索（带会话过滤：仅保留 `allow` 集合内的 hook）
    ///
    /// **为什么过滤**：向量库/BM25 是**项目级**共享（多会话同库），而召回语义是
    /// **会话级**（与现有关键词路径一致）——检索后按本会话摘要集合过滤，
    /// 并对上游多取一点（3×top_k）避免过滤后不足。
    pub async fn search(
        &self,
        query: &str,
        top_k: usize,
        allow: &HashSet<String>,
    ) -> Vec<SearchHit> {
        use memory_center_core::semantic::SemanticRetriever;
        let over = top_k.saturating_mul(3).max(top_k);
        let hits = match self.retriever.search(query, over).await {
            Ok(h) => h,
            Err(e) => {
                tracing::warn!("混合检索失败，按空结果处理: {e}");
                Vec::new()
            }
        };
        hits.into_iter()
            .filter(|h| allow.contains(&h.hook_id))
            .take(top_k)
            .collect()
    }

    /// 语义相似度查询（写前去重用）：文本向量化 → 与候选向量比余弦，取最高分
    ///
    /// - 返回 `Some((hook_id, 余弦分))`：已有可比对候选（**是否算重复由调用方按阈值判**）
    /// - 返回 `None`：向量化失败/熔断中（调用方应回退文本近似路径）
    ///
    /// `allow` = 会话内 hook 集合（与召回同一过滤口径：去重只看本会话记忆）。
    pub async fn find_similar(
        &self,
        text: &str,
        top_k: usize,
        allow: &HashSet<String>,
    ) -> Option<(String, f32)> {
        let vector = match self.embedder.embed(text).await {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!("写前去重向量化失败（回退文本近似）: {e}");
                return None;
            }
        };
        self.vectors
            .search(&vector, top_k)
            .into_iter()
            .filter(|h| allow.contains(&h.hook_id))
            .next()
            .map(|h| (h.hook_id, h.score))
    }

    /// 全量重建：清空两通道 → 逐条索引（关键词同步；向量批量嵌入）
    ///
    /// 返回重建后的统计。embedding 失败时向量通道留空（关键词仍完整）——
    /// 与上游 `SearchIndexer` 的「Embedder 失败不影响关键词索引」同哲学。
    pub async fn rebuild(&self, docs: &[(String, String, String)]) -> SemanticStats {
        self.keyword.clear();
        self.vectors.clear();
        if let Ok(mut set) = self.indexed_hooks.write() {
            set.clear();
        }

        for (hook_id, memory_id, text) in docs {
            self.keyword.index(hook_id, memory_id, text);
        }
        self.mark_keyword_seeded();

        // 向量：分批嵌入（顺带利用 batch 省 QPS；失败整体降级为留待下次）
        const BATCH: usize = 16;
        for chunk in docs.chunks(BATCH) {
            let texts: Vec<&str> = chunk.iter().map(|(_, _, t)| t.as_str()).collect();
            match self.embedder.embed_batch(&texts).await {
                Ok(vectors) => {
                    for ((hook_id, memory_id, _), vector) in chunk.iter().zip(vectors.into_iter()) {
                        self.vectors.add(hook_id, memory_id, vector);
                        if let Ok(mut set) = self.indexed_hooks.write() {
                            set.insert(hook_id.clone());
                        }
                    }
                }
                Err(e) => {
                    tracing::warn!(
                        batch = chunk.len(),
                        "重建：批量向量化失败，本批仅保留关键词索引: {e}"
                    );
                    break;
                }
            }
        }
        self.stats()
    }
}

// ─── 装配层工具 ──────────────────────────────────────────

/// 语义检索句柄（装配层注入适配层的载体）
///
/// - `config` 用**共享** `Arc<RwLock<…>>`：装配层保存新配置后，所有会话的适配层
///   即时看到新配置（注册表按指纹自动重建栈）——避免「改配置要重启会话」
/// - `vector_db`：`{root}/projects/{pid|_default}/memory_vec.db`（与 memories.db
///   同分片，项目级共享）
#[derive(Clone)]
pub struct SemanticHandle {
    config: Arc<RwLock<Option<SemanticConfig>>>,
    vector_db: PathBuf,
}

impl SemanticHandle {
    /// 构造句柄
    pub fn new(config: Arc<RwLock<Option<SemanticConfig>>>, vector_db: PathBuf) -> Self {
        Self { config, vector_db }
    }

    /// 当前配置快照（`None` = 未启用）
    pub fn current(&self) -> Option<SemanticConfig> {
        self.config
            .read()
            .ok()
            .and_then(|guard| guard.clone())
    }

    /// 向量库路径
    pub fn vector_db(&self) -> &Path {
        &self.vector_db
    }
}

/// 索引文本（摘要口径，戊1 同步项裁定）
///
/// `ext_tags` = 扩展库真标签（vendor `hooks.tags` 列在 WorldSea 被挪用，
/// 不能作为标签来源）。空段自动跳过，以 ` | ` 连接。
pub fn index_text_of(view: &SummaryView, ext_tags: &[String]) -> String {
    let mut parts: Vec<String> = Vec::new();
    let push = |parts: &mut Vec<String>, s: &str| {
        let t = s.trim();
        if !t.is_empty() {
            parts.push(t.to_string());
        }
    };
    push(&mut parts, &view.summary_title);
    if let Some(abs) = &view.abstract_text {
        push(&mut parts, abs);
    }
    if !view.key_facts.is_empty() {
        push(&mut parts, &view.key_facts.join(" "));
    }
    if !view.key_entities.is_empty() {
        push(&mut parts, &view.key_entities.join(" "));
    }
    if !view.clue_anchors.is_empty() {
        push(&mut parts, &view.clue_anchors.join(" "));
    }
    let tag_str: Vec<&str> = ext_tags
        .iter()
        .map(|t| t.trim())
        .filter(|t| !t.is_empty())
        .collect();
    if !tag_str.is_empty() {
        parts.push(tag_str.join(" "));
    }
    parts.join(" | ")
}

/// 维度校验：向量库内旧向量与新配置维度不一致时清空
///
/// 不同模型的向量不可比，混在一起检索会得到无意义结果。维度变更 = 换模型
/// = 全量重嵌（清空后由播种补齐）。表不存在（首次）视为通过。
pub fn ensure_vector_dim(db: &Path, dim: usize) -> Result<(), String> {
    if !db.exists() {
        return Ok(());
    }
    let conn = rusqlite::Connection::open(db).map_err(|e| format!("打开向量库失败: {e}"))?;
    let table_exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'embeddings'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if table_exists == 0 {
        return Ok(());
    }
    let first_len: Option<i64> = conn
        .query_row("SELECT length(vector) FROM embeddings LIMIT 1", [], |r| {
            r.get(0)
        })
        .ok();
    if let Some(bytes) = first_len {
        if bytes as usize != dim * 4 {
            conn.execute("DELETE FROM embeddings", [])
                .map_err(|e| format!("清空旧维度向量失败: {e}"))?;
            tracing::info!(
                old_bytes = bytes,
                new_dim = dim,
                "向量维度已变更，旧向量已清空（将由播种重新嵌入）"
            );
        }
    }
    Ok(())
}

/// 读向量库内的 hook 集合（增量播种判定；库/表不存在返回空集）
fn read_indexed_hooks(db: &Path) -> HashSet<String> {
    let mut set = HashSet::new();
    if !db.exists() {
        return set;
    }
    let Ok(conn) = rusqlite::Connection::open(db) else {
        return set;
    };
    let Ok(mut stmt) = conn.prepare("SELECT hook_id FROM embeddings") else {
        return set;
    };
    let rows = stmt.query_map([], |r| r.get::<_, String>(0));
    if let Ok(rows) = rows {
        for row in rows.flatten() {
            set.insert(row);
        }
    }
    set
}

// ─── 进程级注册表 ────────────────────────────────────────

/// 向量库路径 → 栈实例（进程内唯一；避免多会话内存索引发散）
static REGISTRY: OnceLock<tokio::sync::Mutex<HashMap<PathBuf, Arc<SemanticStack>>>> = OnceLock::new();

/// 取或建栈（同路径 + 同配置指纹复用；配置变更则重建）
///
/// 重建不丢数据：向量库持久化在原路径，新栈建好后调用方的播种逻辑会补齐
/// 关键词索引（`keyword_seeded` 归零）。
pub async fn get_or_build(
    vector_db: &Path,
    config: &SemanticConfig,
) -> Result<Arc<SemanticStack>, String> {
    let registry = REGISTRY.get_or_init(|| tokio::sync::Mutex::new(HashMap::new()));
    let mut map = registry.lock().await;
    if let Some(existing) = map.get(vector_db) {
        if existing.config().same_fingerprint(config) {
            return Ok(existing.clone());
        }
        tracing::info!("语义检索配置指纹变化，重建检索栈（向量库数据保留）");
    }
    let stack = SemanticStack::build(vector_db.to_path_buf(), config.clone())?;
    map.insert(vector_db.to_path_buf(), stack.clone());
    Ok(stack)
}

/// 从注册表移除某向量库的栈（测试隔离 / 配置停用时用）
pub async fn drop_stack(vector_db: &Path) {
    let registry = REGISTRY.get_or_init(|| tokio::sync::Mutex::new(HashMap::new()));
    let mut map = registry.lock().await;
    map.remove(vector_db);
}

/// 直接注册一个栈实例（仅测试：注入假 Embedder 走完整接入路径）
#[cfg(test)]
pub(crate) async fn register_stack_for_test(vector_db: &Path, stack: Arc<SemanticStack>) {
    let registry = REGISTRY.get_or_init(|| tokio::sync::Mutex::new(HashMap::new()));
    let mut map = registry.lock().await;
    map.insert(vector_db.to_path_buf(), stack);
}

// ─── 测试 ────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;

    /// 确定性假 Embedder：查表给向量；`fail` 时全部报错（模拟端点不可达）
    struct TestEmbedder {
        dim: usize,
        map: StdMutex<HashMap<String, Vec<f32>>>,
        fail: bool,
    }

    impl TestEmbedder {
        fn new(dim: usize, map: Vec<(&str, Vec<f32>)>, fail: bool) -> Arc<Self> {
            Arc::new(Self {
                dim,
                map: StdMutex::new(
                    map.into_iter().map(|(k, v)| (k.to_string(), v)).collect(),
                ),
                fail,
            })
        }
    }

    #[async_trait::async_trait]
    impl Embedder for TestEmbedder {
        fn dim(&self) -> usize {
            self.dim
        }
        async fn embed(&self, text: &str) -> memory_center_core::Result<Vec<f32>> {
            if self.fail {
                return Err(memory_center_core::Error::Storage("test embedder down".into()));
            }
            Ok(self
                .map
                .lock()
                .unwrap()
                .get(text)
                .cloned()
                .unwrap_or_else(|| vec![0.0; self.dim]))
        }
    }

    fn test_config(dim: usize) -> SemanticConfig {
        SemanticConfig {
            api_url: "http://127.0.0.1:9/v1/embeddings".into(),
            api_key: "k".into(),
            model: "test-model".into(),
            dim,
            timeout_secs: 1,
        }
    }

    fn view_of(hook_id: &str, title: &str) -> SummaryView {
        SummaryView {
            hook_id: hook_id.into(),
            memory_id: format!("m-{hook_id}"),
            summary_title: title.into(),
            abstract_text: None,
            key_facts: Vec::new(),
            key_entities: Vec::new(),
            clue_anchors: Vec::new(),
            tags: Vec::new(),
            archived_at: "2026-09-12T00:00:00Z".into(),
            period: "daily".into(),
            token_count: 10,
            is_rich: false,
        }
    }

    #[test]
    fn index_text_joins_summary_fields_and_ext_tags() {
        let mut v = view_of("h1", "标题");
        v.abstract_text = Some("摘要".into());
        v.key_facts = vec!["事实一".into(), "事实二".into()];
        v.key_entities = vec!["实体".into()];
        v.clue_anchors = vec!["锚点".into()];
        let text = index_text_of(&v, &["真标签".to_string(), "  ".to_string()]);
        assert_eq!(text, "标题 | 摘要 | 事实一 事实二 | 实体 | 锚点 | 真标签");
        // 空段跳过、空标签不产生尾分隔
        assert_eq!(index_text_of(&view_of("h2", "仅标题"), &[]), "仅标题");
    }

    #[tokio::test]
    async fn ensure_vector_dim_clears_mismatched_vectors() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("memory_vec.db");
        {
            let index = SqliteVectorIndex::new(&db, 2).unwrap();
            index.add("h1", "m1", vec![1.0, 0.0]);
            assert_eq!(index.len(), 1);
        }
        // 维度变更（2 → 4）：旧向量被清空
        ensure_vector_dim(&db, 4).unwrap();
        let reopened = SqliteVectorIndex::new(&db, 4).unwrap();
        assert_eq!(reopened.len(), 0, "旧维度向量必须清空（不同模型向量不可比）");
    }

    #[tokio::test]
    async fn search_fuses_and_filters_by_session() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("memory_vec.db");
        let q = "记忆检索";
        let embedder = TestEmbedder::new(
            3,
            vec![
                (q, vec![1.0, 0.0, 0.0]),
                ("命中语义", vec![1.0, 0.0, 0.0]),
                ("同会话关键词", vec![0.0, 1.0, 0.0]),
                ("他会话", vec![1.0, 0.0, 0.0]),
            ],
            false,
        );
        let stack = SemanticStack::build_with_embedder(db.clone(), test_config(3), embedder).unwrap();
        for (hook, title) in [
            ("h-sem", "命中语义"),
            ("h-kw", "同会话关键词"),
            ("h-other", "他会话"),
        ] {
            stack.index_hook(hook, "m", title).await;
        }
        // 会话过滤：仅 h-sem / h-kw 可见
        let allow: HashSet<String> = ["h-sem".to_string(), "h-kw".to_string()].into();
        let hits = stack.search(q, 5, &allow).await;
        let ids: Vec<&str> = hits.iter().map(|h| h.hook_id.as_str()).collect();
        assert!(ids.contains(&"h-sem"), "向量通道应命中: {ids:?}");
        assert!(!ids.contains(&"h-other"), "他会话条目必须被过滤: {ids:?}");
    }

    #[tokio::test]
    async fn embedder_failure_degrades_to_keyword_channel() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("memory_vec.db");
        let embedder = TestEmbedder::new(3, vec![], true); // 全失败
        let stack = SemanticStack::build_with_embedder(db, test_config(3), embedder).unwrap();
        stack.index_keyword("h-kw", "m", "记忆检索 关键词命中");
        let allow: HashSet<String> = ["h-kw".to_string()].into();
        let hits = stack.search("记忆检索", 5, &allow).await;
        assert_eq!(hits.len(), 1, "Embedder 失败时 HybridRetriever 应降级为关键词");
        assert_eq!(hits[0].hook_id, "h-kw");
    }

    #[tokio::test]
    async fn find_similar_returns_best_cosine_within_allow() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("memory_vec.db");
        let embedder = TestEmbedder::new(
            3,
            vec![
                ("新内容", vec![1.0, 0.0, 0.0]),
                ("旧内容A", vec![0.99, 0.1, 0.0]),
                ("旧内容B", vec![0.0, 1.0, 0.0]),
            ],
            false,
        );
        let stack = SemanticStack::build_with_embedder(db, test_config(3), embedder).unwrap();
        stack.index_hook("h-a", "m", "旧内容A").await;
        stack.index_hook("h-b", "m", "旧内容B").await;
        let allow: HashSet<String> = ["h-a".to_string(), "h-b".to_string()].into();
        let hit = stack.find_similar("新内容", 5, &allow).await.unwrap();
        assert_eq!(hit.0, "h-a", "应命中余弦最高的旧内容A");
        assert!(hit.1 > 0.9, "余弦应高于阈值区间（0.92 判定由调用方做）: {}", hit.1);
    }

    #[tokio::test]
    async fn rebuild_indexes_both_channels() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("memory_vec.db");
        let embedder = TestEmbedder::new(
            3,
            vec![("标题一", vec![1.0, 0.0, 0.0]), ("标题二", vec![0.0, 1.0, 0.0])],
            false,
        );
        let stack = SemanticStack::build_with_embedder(db, test_config(3), embedder).unwrap();
        let docs = vec![
            ("h1".to_string(), "m1".to_string(), "标题一".to_string()),
            ("h2".to_string(), "m2".to_string(), "标题二".to_string()),
        ];
        let stats = stack.rebuild(&docs).await;
        assert_eq!(stats.keyword_len, 2);
        assert_eq!(stats.vector_len, 2);
        assert_eq!(stats.dim, 3);
        let allow: HashSet<String> = ["h1".to_string(), "h2".to_string()].into();
        let hits = stack.search("标题一", 5, &allow).await;
        assert!(!hits.is_empty());
    }

    #[tokio::test]
    async fn registry_shares_stack_and_rebuilds_on_fingerprint_change() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("memory_vec.db");
        let cfg = test_config(3);
        let a = get_or_build(&db, &cfg).await.unwrap();
        let b = get_or_build(&db, &cfg).await.unwrap();
        assert!(Arc::ptr_eq(&a, &b), "同配置同路径应复用同一栈实例");

        let mut cfg2 = cfg.clone();
        cfg2.model = "another-model".into();
        let c = get_or_build(&db, &cfg2).await.unwrap();
        assert!(!Arc::ptr_eq(&a, &c), "配置指纹变化应重建栈");
        drop_stack(&db).await;
    }

    #[tokio::test]
    async fn gated_embedder_opens_circuit_after_consecutive_failures() {
        let gate = GatedEmbedder::with_params(
            EmbedderConfig {
                api_url: "http://127.0.0.1:9/v1/embeddings".into(),
                api_key: "k".into(),
                model: "m".into(),
                dim: 3,
                timeout_secs: 1,
            },
            2,
            60_000,
        );
        // 前两次真失败（端口 9 = discard，连接立即被拒）
        let _ = gate.embed("x").await;
        let _ = gate.embed("x").await;
        assert!(gate.is_open(), "连续失败达阈值应熔断");
        // 熔断后：快速失败且错误信息标明熔断（不再发起网络请求）
        let err = gate.embed("x").await.unwrap_err();
        assert!(err.to_string().contains("熔断"), "应返回熔断态: {err}");
    }

    #[test]
    fn config_fingerprint_ignores_timeout() {
        let a = test_config(3);
        let mut b = a.clone();
        b.timeout_secs = 99;
        assert!(a.same_fingerprint(&b), "超时不参与指纹（不改变向量语义）");
        let mut c = a.clone();
        c.dim = 1024;
        assert!(!a.same_fingerprint(&c), "维度变化必须触发重建");
    }
}
