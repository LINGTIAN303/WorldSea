//! MemoryAccessor 适配层（agent-memory）：以 memory-center-core 实现 MemoryAccessor trait，详细见 docs/details/注释/agent-memory/lib.md

#![forbid(unsafe_code)]

pub mod decay;
pub mod evict;
pub mod ext;
pub mod memory_md;
pub mod model_profile;
pub mod raw_store;
pub mod reconcile;
pub mod semantic;

use async_trait::async_trait;
use std::collections::HashSet;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use agent_runtime::memory::{
    ArchiveSource, MemoryAccessor, MemoryArchiveResult, MemoryChunkContent, MemoryChunkMessage,
    MemoryError, MemoryInjectOptions, MemoryOutputType, MemoryRecallOptions, MemoryRecallResult,
    MemoryWriteEntry, MemoryWriteOp, MemoryWriteOptions, NoopReason, SummaryMethod, WriteOutcome,
};
use memory_center_core::archive::Archiver;
use memory_center_core::conflict::{ConflictDetector, ConflictReport};
use memory_center_core::heuristic::HeuristicDetector;
use memory_center_core::model::{
    ArchiveConfig, ArchivePeriod, MemoryFile, MemoryUpdate, MessageContent, MessageTurn, Tag,
};
use memory_center_core::retrieve::{Retriever, SummaryView};
use memory_center_core::sqlite::SqliteStorage;
use memory_center_core::storage::Storage;

use ext::ExtStore;
use reconcile::{ReconcileContext, ReconcilePolicy, ReconcileSide, ReconcileSummarizer};

/// MemoryAccessor 适配层结构体（存储后端 + 检索器 + 归档器），详细见 docs/details/注释/agent-memory/lib.md
pub struct MemoryCenterAccessor {
    /// 检索器（只读，无需锁）
    retriever: Retriever,
    /// 归档器（状态化，需互斥访问）
    archiver: Arc<tokio::sync::Mutex<Archiver>>,
    /// 会话 ID
    session_id: String,
    /// 已归档轮次边界（累计消费的轮次数）
    boundary: AtomicUsize,
    /// 已注入的 hook_id 集合（避免重复注入，`force` 时跳过检查）
    injected_hooks: Arc<Mutex<HashSet<String>>>,
    /// 存储后端引用（按会话删除记忆用，与 retriever/archiver 共享）
    storage: Arc<dyn Storage>,
    /// 项目 ID（按会话删除记忆时按项目定位记忆文件）
    project_id: Option<String>,
    /// 记忆扩展库（A1 甲4；`None`=未启用扩展能力，相关方法降级为 no-op）
    ///
    /// 承载 vendor DDL 无落脚处的字段（`created_at` / `access_count` / `pinned` /
    /// `summary_method`）与 A1 新增概念（真标签 / 调和链 / 外置引用）。
    ext: Option<ExtStore>,
    /// 冲突检测器（A1 甲2；默认 [`HeuristicDetector`]——纯算法、零成本、无网络依赖）
    ///
    /// 作用：为「取代」判定**依据**并丰富调和摘要（不是安全闸门——
    /// 无论检测结果如何，硬规则「矛盾不覆盖」都恒定生效）。
    conflict_detector: Arc<dyn ConflictDetector>,
    /// 调和策略（A1 甲2；默认 `RuleSummary`——零成本摘要 + 记链）
    reconcile_policy: ReconcilePolicy,
    /// LLM 摘要生成器（A1 甲2；`None`=未注入，`LlmSummary` 档自动降级为规则摘要）
    reconcile_summarizer: Option<Arc<dyn ReconcileSummarizer>>,
    /// 常驻文档渲染策略（A1 乙3①；默认 [`memory_md::MemoryMdPolicy::default`]）
    memory_md_policy: memory_md::MemoryMdPolicy,
    /// 语义检索句柄（A2 戊1；`None` = 未接线，召回/去重走既有文本路径）
    ///
    /// 句柄内配置为**共享可写**：装配层改配置后各会话即时生效。
    semantics: Option<semantic::SemanticHandle>,
}

impl MemoryCenterAccessor {
    /// 创建适配层（默认使用 SQLite 存储后端）
    ///
    /// # 参数
    /// - `root`：存储根目录（`{root}/projects/{project_id}/memories.db`）
    /// - `session_id`：当前会话 ID（记忆隔离依据）
    /// - `project_id`：**分片依据**（丁3：真实项目 id；`None` 落 `_default`）——
    ///   `memories.db` / `memory_ext.db` / `memory_vec.db` 三库同分片
    /// - `archive_config`：归档阈值配置（token 阈值 / 强制截断上限）
    ///
    /// 同时打开同目录下的**扩展库** `memory_ext.db`（A1 甲4）；扩展库打开失败时
    /// 降级为 `None`（记忆主链路不受影响，仅 A1 新增能力不可用）。
    /// 装配层应优先用 [`Self::new_sqlite_with_semantics`]（共享语义配置句柄）。
    pub fn new_sqlite(
        root: impl Into<std::path::PathBuf>,
        session_id: impl Into<String>,
        project_id: Option<String>,
        archive_config: ArchiveConfig,
    ) -> crate::Result<Self> {
        Self::new_sqlite_inner(root, session_id, project_id, archive_config, None)
    }

    /// 创建适配层（SQLite 后端 + **共享**语义检索配置句柄）——装配层用
    ///
    /// 与 [`Self::new_sqlite`] 的唯一区别：语义检索的配置句柄由外部注入共享
    /// （保存配置即对所有会话生效）；向量库路径与 `memories.db` **同分片**。
    ///
    /// **丁3（2026-09-12）**：`project_id` 是记忆隔离的唯一分片依据——装配层必须
    /// 传真实项目 id（会话持久化的 `SessionRecord.project_id`）。
    pub fn new_sqlite_with_semantics(
        root: impl Into<std::path::PathBuf>,
        session_id: impl Into<String>,
        project_id: Option<String>,
        archive_config: ArchiveConfig,
        semantic_config: Arc<std::sync::RwLock<Option<semantic::SemanticConfig>>>,
    ) -> crate::Result<Self> {
        Self::new_sqlite_inner(
            root,
            session_id,
            project_id,
            archive_config,
            Some(semantic_config),
        )
    }

    /// 共享实现：打开三库（memories / ext / vec 同分片）并装配语义句柄
    fn new_sqlite_inner(
        root: impl Into<std::path::PathBuf>,
        session_id: impl Into<String>,
        project_id: Option<String>,
        archive_config: ArchiveConfig,
        semantic_config: Option<Arc<std::sync::RwLock<Option<semantic::SemanticConfig>>>>,
    ) -> crate::Result<Self> {
        let root = root.into();
        let storage: Arc<dyn Storage> = Arc::new(SqliteStorage::new(root.clone(), project_id.clone())?);
        let ext = match ExtStore::open(root.clone(), project_id.clone()) {
            Ok(s) => Some(s),
            Err(e) => {
                tracing::warn!("打开记忆扩展库失败（A1 甲4 能力不可用）: {e}");
                None
            }
        };
        // A2 戊1：语义检索句柄（向量库与 memories.db 同分片；配置默认为空=未启用，
        // 共享句柄由装配层经 new_sqlite_with_semantics 注入后即时生效）
        let shard = match &project_id {
            Some(pid) => root.join("projects").join(pid),
            None => root.join("projects").join("_default"),
        };
        let handle = semantic::SemanticHandle::new(
            semantic_config.unwrap_or_else(|| Arc::new(std::sync::RwLock::new(None))),
            shard.join("memory_vec.db"),
        );
        Ok(Self::new_with_ext(storage, session_id, project_id, archive_config, ext)
            .with_semantics(handle))
    }

    /// 创建适配层（可注入任意存储后端）
    ///
    /// 不带扩展库（`ext = None`）——需要 A1 扩展能力的调用方请用
    /// [`Self::new_sqlite`] 或随后调用 [`Self::with_ext_store`]。
    pub fn new(
        storage: Arc<dyn Storage>,
        session_id: impl Into<String>,
        project_id: Option<String>,
        archive_config: ArchiveConfig,
    ) -> Self {
        Self::new_with_ext(storage, session_id, project_id, archive_config, None)
    }

    /// 创建适配层（全参，含扩展库）
    pub fn new_with_ext(
        storage: Arc<dyn Storage>,
        session_id: impl Into<String>,
        project_id: Option<String>,
        archive_config: ArchiveConfig,
        ext: Option<ExtStore>,
    ) -> Self {
        let session_id = session_id.into();
        let retriever = Retriever::new(storage.clone(), session_id.clone(), project_id.clone());
        let archiver = Archiver::new(archive_config, storage.clone(), session_id.clone(), project_id.clone());
        Self {
            retriever,
            archiver: Arc::new(tokio::sync::Mutex::new(archiver)),
            session_id,
            storage,
            project_id,
            ext,
            boundary: AtomicUsize::new(0),
            injected_hooks: Arc::new(Mutex::new(HashSet::new())),
            // A1 甲2：默认启发式检测器（纯算法、零成本、无网络依赖）+ 规则摘要档
            conflict_detector: Arc::new(HeuristicDetector::new()),
            reconcile_policy: ReconcilePolicy::default(),
            reconcile_summarizer: None,
            // A1 乙3①：常驻文档默认策略（1500 字符 / 20 条 / 单条 160 字）
            memory_md_policy: memory_md::MemoryMdPolicy::default(),
            // A2 戊1：语义检索句柄默认未接线（由 new_sqlite / with_semantics 注入）
            semantics: None,
        }
    }

    /// 注入语义检索句柄（链式，A2 戊1）
    ///
    /// 注入后：`recall` 升级为混合检索（BM25 + 向量 + RRF）、写前去重升级为
    /// 语义余弦（失败回退文本近似）、写入/删除同步索引。未注入 = 行为与接线前一致。
    pub fn with_semantics(mut self, handle: semantic::SemanticHandle) -> Self {
        self.semantics = Some(handle);
        self
    }

    /// 注入常驻文档渲染策略（链式，A1 乙3①）
    pub fn with_memory_md_policy(mut self, policy: memory_md::MemoryMdPolicy) -> Self {
        self.memory_md_policy = policy;
        self
    }

    /// 注入调和策略（链式，A1 甲2）
    pub fn with_reconcile_policy(mut self, policy: ReconcilePolicy) -> Self {
        self.reconcile_policy = policy;
        self
    }

    /// 注入冲突检测器（链式，A1 甲2；默认 [`HeuristicDetector`]）
    pub fn with_conflict_detector(mut self, detector: Arc<dyn ConflictDetector>) -> Self {
        self.conflict_detector = detector;
        self
    }

    /// 注入 LLM 调和摘要生成器（链式，A1 甲2）
    ///
    /// 仅 [`ReconcileMode::LlmSummary`] 档消费；未注入时该档自动降级为规则摘要。
    pub fn with_reconcile_summarizer(mut self, summarizer: Arc<dyn ReconcileSummarizer>) -> Self {
        self.reconcile_summarizer = Some(summarizer);
        self
    }

    /// 当前调和策略（只读）
    pub fn reconcile_policy(&self) -> ReconcilePolicy {
        self.reconcile_policy
    }

    /// 注入扩展库（链式）
    pub fn with_ext_store(mut self, ext: ExtStore) -> Self {
        self.ext = Some(ext);
        self
    }

    /// 扩展库引用（`None`=未启用）
    pub fn ext_store(&self) -> Option<&ExtStore> {
        self.ext.as_ref()
    }

    /// 喂入一轮对话（供归档前累积）
    ///
    /// 调用方在每轮对话完成后调用，`Archiver` 内部累计 token 数，
    /// 达到阈值后由 [`MemoryAccessor::archive`] 触发归档。
    pub async fn push_turn(&self, turn: MessageTurn) {
        self.archiver.lock().await.push_turn(turn);
    }

    /// 当前缓冲的待归档轮次数
    pub async fn pending_turns_count(&self) -> usize {
        self.archiver.lock().await.pending_turns_count()
    }
}

impl std::fmt::Debug for MemoryCenterAccessor {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MemoryCenterAccessor")
            .field("session_id", &self.session_id)
            .field("boundary", &self.boundary.load(Ordering::SeqCst))
            .finish()
    }
}

#[async_trait]
impl MemoryAccessor for MemoryCenterAccessor {
    async fn recall(
        &self,
        query: String,
        options: Option<MemoryRecallOptions>,
    ) -> std::result::Result<Vec<MemoryRecallResult>, MemoryError> {
        let opts = options.unwrap_or_default();
        let top_k = opts.top_k.max(1) as usize;

        // A2 戊1：语义通道可用 → 混合检索（BM25 + 向量 + RRF，会话内过滤）；
        // 不可用（未配置 / 建栈失败）→ 既有「关键词预筛选」路径（行为零变化）
        let mut results: Vec<MemoryRecallResult> = 'recall: {
            if let Some(stack) = self.sem_stack().await {
                let summaries = self
                    .retriever
                    .get_summaries()
                    .await
                    .map_err(|e| MemoryError::RecallFailed(e.to_string()))?;
                if summaries.is_empty() {
                    break 'recall Vec::new();
                }
                let stack = self.sem_seed(&stack, &summaries).await;
                let allow: HashSet<String> =
                    summaries.iter().map(|s| s.hook_id.clone()).collect();
                let by_hook: std::collections::HashMap<&str, &SummaryView> = summaries
                    .iter()
                    .map(|s| (s.hook_id.as_str(), s))
                    .collect();
                let hits = stack.search(&query, top_k, &allow).await;
                let mapped: Vec<MemoryRecallResult> = hits
                    .into_iter()
                    .filter_map(|hit| {
                        by_hook.get(hit.hook_id.as_str()).map(|view| {
                            let mut r = summary_to_recall_result(view, &query);
                            // 命中来源为语义/混合时标注（观察语义通道是否生效）
                            let via_vector = matches!(
                                hit.source,
                                memory_center_core::semantic::RetrievalSource::Semantic
                                    | memory_center_core::semantic::RetrievalSource::Hybrid
                            );
                            if via_vector && !r.matched_fields.iter().any(|f| f == "embedding") {
                                r.matched_fields.push("embedding".to_string());
                            }
                            r
                        })
                    })
                    .collect();
                if !mapped.is_empty() {
                    break 'recall mapped; // 混合通道有结果 → 用它
                }
                // 混合通道无结果 → 回退关键词路径（保持原有召回下限）
                let mut kw = self
                    .retriever
                    .filter_hooks_by_keyword(&query)
                    .await
                    .map_err(|e| MemoryError::RecallFailed(e.to_string()))?;
                kw.truncate(top_k);
                break 'recall kw
                    .into_iter()
                    .map(|s| summary_to_recall_result(&s, &query))
                    .collect();
            }

            // 既有路径：关键词预筛选（返回相关度 > 0 的摘要视图，按相关度降序）
            let summaries = self
                .retriever
                .filter_hooks_by_keyword(&query)
                .await
                .map_err(|e| MemoryError::RecallFailed(e.to_string()))?;
            summaries
                .into_iter()
                .map(|s| summary_to_recall_result(&s, &query))
                .collect()
        };

        // 应用 top_k（按相关度降序，取前 N）
        if results.len() > top_k {
            results.truncate(top_k);
        }

        // A1（2026-09-12）两件事一次做完（召回热路径，每轮都跑）：
        //
        // ① **召回命中 = 一次真实访问**（甲3）——计入 `access_count` 并刷新
        //    `last_access_at`。语义：经常被召回的条目应当「返青」，长期无人问津的
        //    条目才走向淘汰；故此处计数不是统计噪声而是**淘汰判据的输入**。
        // ② **补全真实治理字段**（pinned / access_count / 真标签）——vendor 的
        //    `SummaryView` 拿不到这三者（`hooks.tags` 列被挪用存 `output_types`，
        //    三者都在适配层扩展库）。**不补则检索结果会误报**：置顶条目显示
        //    `pinned=false`、真标签丢失——模型与 UI 据此判断都会出错。
        //
        // 失败仅告警：两件事都是增强，不影响本轮召回结果本身。
        if let Some(ext) = &self.ext {
            let now = chrono::Utc::now().timestamp_millis();
            for r in results.iter_mut() {
                match ext.touch_with_meta(&r.hook_id, now).await {
                    Ok(Some(meta)) => {
                        r.access_count = meta.access_count;
                        r.pinned = meta.pinned;
                        if !meta.tags.is_empty() {
                            // 真标签覆盖 vendor 侧（后被挪用的列）
                            r.tags = meta.tags;
                        }
                    }
                    Ok(None) => {} // 未登记（无治理记录）——保持 vendor 侧原值
                    Err(e) => tracing::warn!(hook = %r.hook_id, "召回访问登记失败: {e}"),
                }
            }
        }

        Ok(results)
    }

    /// 重建语义检索索引（A2 戊1）：清空两通道 → 用本会话全部摘要重灌
    ///
    /// 用途：换模型（维度变更已自动清空旧向量）、索引损坏修复、手动「重建索引」。
    /// 返回索引文档数；语义未启用（无配置）时返回错误，调用方据此提示先配置。
    async fn rebuild_semantic_index(&self) -> std::result::Result<usize, MemoryError> {
        let stack = self.sem_stack().await.ok_or_else(|| {
            MemoryError::Other("语义检索未启用（未配置 embedding 端点或端点不可用）".into())
        })?;
        let summaries = self
            .retriever
            .get_summaries()
            .await
            .map_err(|e| MemoryError::RecallFailed(e.to_string()))?;
        let mut docs = Vec::with_capacity(summaries.len());
        for v in &summaries {
            docs.push((
                v.hook_id.clone(),
                v.memory_id.clone(),
                self.index_text_for(v).await,
            ));
        }
        let count = docs.len();
        let stats = stack.rebuild(&docs).await;
        tracing::info!(
            docs = count,
            keyword = stats.keyword_len,
            vector = stats.vector_len,
            "语义索引重建完成（A2 戊1）"
        );
        Ok(count)
    }

    async fn inject(
        &self,
        results: Vec<MemoryRecallResult>,
        options: Option<MemoryInjectOptions>,
    ) -> std::result::Result<String, MemoryError> {
        let opts = options.unwrap_or_default();
        if results.is_empty() {
            return Ok(String::new());
        }

        let mut injected = self
            .injected_hooks
            .lock()
            .map_err(|_| MemoryError::Other("injected_hooks 锁中毒".into()))?;

        let mut out = String::from("# 相关记忆\n\n");
        let mut budget = opts.max_tokens as i64;

        for r in results {
            // 非 force 模式下跳过已注入的钩子，避免重复注入
            if !opts.force && injected.contains(&r.hook_id) {
                continue;
            }

            let title = r.summary.lines().next().unwrap_or("(无标题)").to_string();
            let block = format!(
                "- **{}** (`{}`)\n  {}\n",
                title, r.hook_id, r.summary
            );
            // 粗略 token 估算：CJK 字符约 1 token/字，ASCII 约 1 token/4 字符
            let est = estimate_tokens(&block);
            if budget < est as i64 {
                break;
            }
            budget -= est as i64;

            out.push_str(&block);
            injected.insert(r.hook_id.clone());
        }

        if out == "# 相关记忆\n\n" {
            return Ok(String::new());
        }
        Ok(out)
    }

    async fn archive(
        &self,
        _source: Option<ArchiveSource>,
    ) -> std::result::Result<Option<MemoryArchiveResult>, MemoryError> {
        let mut guard = self.archiver.lock().await;

        // 无缓冲轮次时不触发归档
        if guard.pending_turns_count() == 0 {
            return Ok(None);
        }

        // 未达归档阈值时继续累积（对齐 MemoryCenter 语义：阈值触发归档，
        // 避免每轮对话都落一个记忆文件造成碎片）。超阈值后归档消费全部缓冲。
        if !guard.should_archive() {
            return Ok(None);
        }

        let pending = guard.pending_turns_count();
        let (memory, hook) = guard
            .archive()
            .await
            .map_err(|e| MemoryError::ArchiveFailed(e.to_string()))?;

        // 推进归档边界
        let new_boundary = self.boundary.fetch_add(pending, Ordering::SeqCst) + pending;

        // 摘要生成方式：有结构化摘要（abstract/key_facts）视为 LLM 生成，否则启发式
        let summary_method = if hook.summary.is_rich() {
            SummaryMethod::Llm
        } else {
            SummaryMethod::Rule
        };

        // A1 甲4（2026-09-11）：登记扩展信息——补齐 trait 声明但 vendor 库无落脚处的
        // 四个字段（created_at / access_count / pinned / summary_method）。
        // 失败仅告警：扩展库不可用不应阻断归档主链路。
        if let Some(ext) = &self.ext {
            let hook_id = hook.id.to_string();
            // created_at = 「记忆发生时点」= 首个轮次时间戳（区别于 archived_at 归档时点）
            let created_at = memory
                .turns
                .first()
                .map(|t| t.timestamp.timestamp_millis())
                .unwrap_or_else(|| memory.archived_at.timestamp_millis());
            let method = match summary_method {
                SummaryMethod::Llm => "llm",
                SummaryMethod::Rule => "rule",
                SummaryMethod::None => "none",
            };
            if let Err(e) = ext
                .ensure_memory_ext(&hook.memory_id, &hook_id, created_at, method)
                .await
            {
                tracing::warn!("登记记忆扩展信息失败: {e}");
            }
        }

        Ok(Some(MemoryArchiveResult {
            hook_id: hook.id.to_string(),
            file_id: hook.memory_id,
            token_count: memory.total_tokens as u32,
            chunk_count: memory.turns.len() as u32,
            new_boundary_index: new_boundary,
            summary_method,
        }))
    }

    async fn get_archive_boundary(&self) -> std::result::Result<usize, MemoryError> {
        Ok(self.boundary.load(Ordering::SeqCst))
    }

    async fn delete_by_session_id(
        &self,
        session_id: &str,
    ) -> std::result::Result<(), MemoryError> {
        // 删除该会话全部记忆内容并清理索引钩子：枚举三个存档周期层级，
        // 先删记忆文件（memories），再删索引钩子（hooks），避免留下悬空指针
        // 导致删除后 recall 仍命中幽灵摘要。
        for period in [
            ArchivePeriod::Daily,
            ArchivePeriod::Weekly,
            ArchivePeriod::Monthly,
        ] {
            let memory_ids = self
                .storage
                .list_memories(session_id, self.project_id.as_deref(), period)
                .await
                .map_err(|e| MemoryError::RecallFailed(e.to_string()))?;
            for memory_id in memory_ids {
                self.storage
                    .delete_memory(&memory_id)
                    .await
                    .map_err(|e| MemoryError::Other(e.to_string()))?;
            }
            self.storage
                .delete_index(session_id, self.project_id.as_deref(), period)
                .await
                .map_err(|e| MemoryError::Other(e.to_string()))?;
        }
        // A1 甲3：会话消失 → 其**上下文锚点引用**整体失效（外置文件侧的生命周期收口）
        //
        // 引用释放后，对应外置文件在下一轮 GC 中从「保护期」进入回收站（§6.3.2），
        // 满 `trashRetentionDays` 后由巡检硬删。失败仅告警：释放是后台收敛动作，
        // 不影响会话删除本身的结果。
        if let Some(ext) = &self.ext {
            match ext
                .release_refs_by_owner(ext::owner_kind::CONTEXT_ANCHOR, session_id)
                .await
            {
                Ok(n) if n > 0 => {
                    tracing::info!(session = %session_id, released = n, "已释放该会话的上下文锚点引用")
                }
                Ok(_) => {}
                Err(e) => tracing::warn!("释放会话 {session_id} 锚点引用失败: {e}"),
            }
        }
        Ok(())
    }

    async fn record_turn(
        &self,
        user_message: String,
        assistant_message: String,
    ) -> std::result::Result<(), MemoryError> {
        // 构造 MemoryCenter 的 MessageTurn（纯文本轮次，无附件/工具调用）
        let turn = MessageTurn {
            id: uuid::Uuid::new_v4(),
            user_message: MessageContent {
                text: Some(user_message.clone()),
                attachments: Vec::new(),
                tool_calls: Vec::new(),
                thinking: None,
                file_changes: Vec::new(),
            },
            llm_message: MessageContent {
                text: Some(assistant_message.clone()),
                attachments: Vec::new(),
                tool_calls: Vec::new(),
                thinking: None,
                file_changes: Vec::new(),
            },
            tags: vec![Tag::Text],
            timestamp: chrono::Utc::now(),
            // token 估算：与注入预算共用同一估算函数，保证归档阈值计量口径一致
            token_count: estimate_tokens(&user_message) + estimate_tokens(&assistant_message),
            stop_reason: None,
            cost: None,
        };
        self.push_turn(turn).await;
        Ok(())
    }

    async fn load_chunk(
        &self,
        hook_id: String,
        _chunk_id: String,
    ) -> std::result::Result<Option<MemoryChunkContent>, MemoryError> {
        let memory = self
            .retriever
            .retrieve_memory(&hook_id)
            .await
            .map_err(|e| MemoryError::ChunkNotFound(e.to_string()))?;

        let mut messages = Vec::new();
        for turn in &memory.turns {
            if let Some(text) = &turn.user_message.text {
                messages.push(MemoryChunkMessage {
                    role: "user".into(),
                    content: text.clone(),
                    tool_call_id: None,
                    tool_name: None,
                    timestamp: turn.timestamp.timestamp_millis(),
                });
            }
            if let Some(text) = &turn.llm_message.text {
                messages.push(MemoryChunkMessage {
                    role: "assistant".into(),
                    content: text.clone(),
                    tool_call_id: None,
                    tool_name: None,
                    timestamp: turn.timestamp.timestamp_millis(),
                });
            }
        }

        let title = memory
            .turns
            .iter()
            .find_map(|t| t.user_message.text.clone())
            .unwrap_or_default();

        Ok(Some(MemoryChunkContent {
            chunk_id: memory.id.to_string(),
            title,
            output_type: MemoryOutputType::Text,
            user_message_anchor: String::new(),
            token_count: memory.total_tokens as u32,
            messages,
        }))
    }

    // ─── A1 甲1：写入四操作与条目级维护 ──────────────────────

    /// 结构化写入（四操作）
    ///
    /// - `Add`：写前去重（相似度 ≥ 阈值 → `Noop`）→ 入缓冲 → **立即归档**
    ///   （显式写入是明确意图，不受累计阈值节流）
    /// - `Delete`：按 hook_id 删除（未命中 → `Noop(NotFound)`）
    /// - `Update`：**本期未启用**（A1 甲1 分期；矛盾不覆盖，走甲2 调和链）→ `Noop(Explicit)`
    /// - `Noop`：直接返回 `Noop(Explicit)`
    async fn write(
        &self,
        entry: MemoryWriteEntry,
        options: Option<MemoryWriteOptions>,
    ) -> std::result::Result<WriteOutcome, MemoryError> {
        let opts = options.unwrap_or_default();
        match entry.op {
            MemoryWriteOp::Noop => Ok(WriteOutcome::Noop { reason: NoopReason::Explicit }),

            MemoryWriteOp::Update => {
                // A1 甲2：取代式更新——**矛盾不覆盖**的落地。
                //
                // 语义：`hook_id` 指向的旧条目被 `content` 取代。执行路径：
                //   1. 定位旧条目（读索引）→ 未命中 = NotFound
                //   2. 冲突检测（可关；纯算法）→ 得到判定依据
                //   3. 把「新增新事实 + 废弃旧事实」记进**旧记忆文件的 updates 字段**
                //      （vendor 语义：非破坏性追加，不动 turns）
                //      ★ 副作用收益：旧内容由此进入 vendor 的历史事实集，
                //        后续对同一文件的取代才有检测对照组
                //   4. 新事实作为**新条目**入库（★ 跳过写前去重——见下）
                //   5. 记取代链（old → new + reason + summary）
                //   6. 按策略产出调和摘要，并作为**调和记忆**入库
                //   7. 返回 `Superseded { old, new }`
                let hook_id = entry
                    .hook_id
                    .clone()
                    .ok_or_else(|| MemoryError::Other("Update 操作缺少 hook_id".into()))?;
                let content = entry.content.trim().to_string();
                if content.is_empty() {
                    return Ok(WriteOutcome::Noop { reason: NoopReason::Explicit });
                }

                // 1. 定位旧条目
                let Some(located) = self.locate_hook(&hook_id).await? else {
                    return Ok(WriteOutcome::Noop { reason: NoopReason::NotFound });
                };

                // 2. 冲突检测（以旧记忆文件为对照）
                let conflict = if self.reconcile_policy.detect_conflicts {
                    self.detect_conflict(&content, &located.old_text, &located.memory).await
                } else {
                    None
                };

                // 3. 修订记入旧记忆文件（非破坏性：只追加 updates，不动 turns）
                let update = MemoryUpdate::new()
                    .add_fact(content.clone())
                    .deprecate_fact(located.old_text.clone());
                let report = match conflict.as_ref() {
                    Some(kind) => {
                        let mut r = ConflictReport::empty();
                        r.push(memory_center_core::conflict::ConflictRecord {
                            kind: kind.clone(),
                            severity: memory_center_core::conflict::Severity::Critical,
                            description: format!(
                                "取代式更新：新事实取代旧事实（{}）",
                                kind_display(kind)
                            ),
                            existing_fact: Some(located.old_text.clone()),
                            new_fact: content.clone(),
                        });
                        r
                    }
                    None => ConflictReport::empty(),
                };
                if let Err(e) = self
                    .storage
                    .update_memory_with_conflicts(
                        &located.memory_id,
                        update,
                        report.conflicts.clone(),
                    )
                    .await
                {
                    // 修订记录失败不阻断取代（链与摘要才是主产物）；但必须留痕
                    tracing::warn!("旧记忆的修订记录写入失败（取代仍继续）: {e}");
                }

                // 4. 新事实入库（★ 跳过写前去重）
                //    取代场景下新旧内容天然相似（如「字号偏小」→「字号偏大」），
                //    走去重会被判为重复而返回 Noop → 取代永远无法完成。
                let new_hook_id = match self
                    .write(
                        MemoryWriteEntry {
                            op: MemoryWriteOp::Add,
                            content: content.clone(),
                            layer: entry.layer,
                            hook_id: None,
                            entity_ids: entry.entity_ids.clone(),
                            tags: entry.tags.clone(),
                        },
                        Some(MemoryWriteOptions {
                            skip_dedup: true,
                            ..Default::default()
                        }),
                    )
                    .await?
                {
                    WriteOutcome::Added { hook_id } => hook_id,
                    other => {
                        // Add 分支在 skip_dedup 下不应失败；真发生了也不静默
                        tracing::warn!("取代流程中新事实入库未成功: {other:?}");
                        return Ok(other);
                    }
                };

                // 5. 记取代链 + 6. 调和摘要
                let ctx = ReconcileContext {
                    old: ReconcileSide {
                        hook_id: hook_id.clone(),
                        text: located.old_title.clone(),
                        at_ms: located.old_at_ms,
                    },
                    new: ReconcileSide {
                        hook_id: new_hook_id.clone(),
                        text: content.clone(),
                        at_ms: now_ms(),
                    },
                    conflict,
                };
                let (summary, from_llm) = reconcile::summarize(
                    &self.reconcile_policy,
                    &ctx,
                    self.reconcile_summarizer.as_ref(),
                )
                .await;
                let reason = ctx.reason_name();

                if let Some(ext) = &self.ext {
                    if let Err(e) = ext
                        .add_supersede(&hook_id, &new_hook_id, reason, summary.as_deref())
                        .await
                    {
                        tracing::warn!("写入取代链失败: {e}");
                    }
                } else {
                    tracing::warn!("扩展库未启用，取代链未记录（调和结论会丢失）");
                }

                // 调和摘要作为独立记忆入库（设计文档 ②「生成一条显式记录矛盾与时序的新记忆」）
                if let Some(text) = &summary {
                    let mut summary_entry = MemoryWriteEntry::add(text.clone())
                        .with_layer(entry.layer)
                        .with_tags(vec![RECONCILE_TAG.to_string()]);
                    summary_entry.entity_ids = entry.entity_ids.clone();
                    match self
                        .write(
                            summary_entry,
                            Some(MemoryWriteOptions {
                                skip_dedup: true,
                                ..Default::default()
                            }),
                        )
                        .await
                    {
                        Ok(WriteOutcome::Added { hook_id: summary_hook }) => {
                            tracing::debug!(
                                "调和摘要已入库：hook={summary_hook}（llm={from_llm}）"
                            );
                        }
                        Ok(other) => tracing::warn!("调和摘要入库未成功: {other:?}"),
                        Err(e) => tracing::warn!("调和摘要入库失败: {e}"),
                    }
                }

                tracing::info!(
                    old = %hook_id,
                    new = %new_hook_id,
                    reason,
                    has_summary = summary.is_some(),
                    from_llm,
                    "记忆取代完成（矛盾不覆盖：旧条目保留，取代关系已记链）"
                );
                Ok(WriteOutcome::Superseded { old_hook_id: hook_id, new_hook_id })
            }

            MemoryWriteOp::Delete => {
                let hook_id = entry
                    .hook_id
                    .ok_or_else(|| MemoryError::Other("Delete 操作缺少 hook_id".into()))?;
                if self.delete_hook_inner(&hook_id).await? {
                    Ok(WriteOutcome::Deleted { hook_id })
                } else {
                    Ok(WriteOutcome::Noop { reason: NoopReason::NotFound })
                }
            }

            MemoryWriteOp::Add => {
                let content = entry.content.trim().to_string();
                if content.is_empty() {
                    return Ok(WriteOutcome::Noop { reason: NoopReason::Explicit });
                }

                // 1. 写前去重（NOOP 语义所在：已知道的事不再写第二遍）
                if !opts.skip_dedup {
                    if let Some((matched_hook_id, score)) =
                        self.find_duplicate(&content, opts.dedup_threshold).await?
                    {
                        tracing::debug!(
                            matched = %matched_hook_id, score, "写前去重命中，跳过写入"
                        );
                        return Ok(WriteOutcome::Noop {
                            reason: NoopReason::Duplicate { matched_hook_id, score },
                        });
                    }
                }

                // 2. 落库：构造单轮 MessageTurn 后立即归档
                let turn = MessageTurn {
                    id: uuid::Uuid::new_v4(),
                    user_message: MessageContent {
                        text: Some(content.clone()),
                        attachments: Vec::new(),
                        tool_calls: Vec::new(),
                        thinking: None,
                        file_changes: Vec::new(),
                    },
                    // note：显式写入没有「回复」侧，用空文本占位（摘要取 user 侧首段）
                    llm_message: MessageContent {
                        text: Some(String::new()),
                        attachments: Vec::new(),
                        tool_calls: Vec::new(),
                        thinking: None,
                        file_changes: Vec::new(),
                    },
                    tags: vec![Tag::Text],
                    timestamp: chrono::Utc::now(),
                    token_count: estimate_tokens(&content),
                    stop_reason: Some("explicit_write".into()),
                    cost: None,
                };

                let (memory, hook) = {
                    let mut guard = self.archiver.lock().await;
                    guard.push_turn(turn);
                    guard
                        .archive()
                        .await
                        .map_err(|e| MemoryError::ArchiveFailed(e.to_string()))?
                };

                // 3. 扩展信息：四死字段 + 真标签（甲4；失败仅告警，不阻断写入语义）
                if let Some(ext) = &self.ext {
                    let hook_id = hook.id.to_string();
                    let summary_method = if hook.summary.is_rich() { "llm" } else { "rule" };
                    // created_at 取「记忆发生时点」= 首个轮次的时间戳（非归档时点）
                    let created_at = memory
                        .turns
                        .first()
                        .map(|t| t.timestamp.timestamp_millis())
                        .unwrap_or_else(|| memory.archived_at.timestamp_millis());
                    if let Err(e) = ext
                        .ensure_memory_ext(&hook.memory_id, &hook_id, created_at, summary_method)
                        .await
                    {
                        tracing::warn!("登记记忆扩展信息失败: {e}");
                    }
                    for tag in &entry.tags {
                        if let Err(e) = ext.add_tag(&hook_id, tag, ext::tag_kind::USER).await {
                            tracing::warn!("写入记忆标签失败: {e}");
                        }
                    }
                    for entity in &entry.entity_ids {
                        if let Err(e) = ext.add_tag(&hook_id, entity, ext::tag_kind::ENTITY).await {
                            tracing::warn!("写入实体标签失败: {e}");
                        }
                    }
                }

                // A2 戊1：索引同步（best-effort；失败不影响写入语义）
                // 索引文本 = 摘要口径 + ext 真标签（vendor hooks.tags 列被挪用作废）
                if let Some(stack) = self.sem_stack().await {
                    let view = SummaryView::from(&hook);
                    let text = self.index_text_for(&view).await;
                    stack.index_hook(&view.hook_id, &view.memory_id, &text).await;
                }

                Ok(WriteOutcome::Added { hook_id: hook.id.to_string() })
            }
        }
    }

    /// 按 hook_id 删除单条记忆（软删：删记忆文件 + 索引钩子标记）
    async fn delete_by_hook_id(&self, hook_id: &str) -> std::result::Result<(), MemoryError> {
        self.delete_hook_inner(hook_id).await.map(|_| ())
    }

    /// 置顶 / 取消置顶（落扩展库 `memory_ext.pinned`）
    async fn pin(&self, hook_id: &str, pinned: bool) -> std::result::Result<(), MemoryError> {
        let ext = self
            .ext
            .as_ref()
            .ok_or_else(|| MemoryError::Other("扩展库未启用，无法置顶".into()))?;
        ext.set_pinned_by_hook(hook_id, pinned)
            .await
            .map_err(|e| MemoryError::Other(e.to_string()))?;
        Ok(())
    }

    /// 访问计数 +1（落扩展库 `memory_ext.access_count`）
    async fn touch(&self, hook_id: &str) -> std::result::Result<u32, MemoryError> {
        let Some(ext) = self.ext.as_ref() else {
            return Ok(0);
        };
        ext.bump_access_count_by_hook(hook_id)
            .await
            .map_err(|e| MemoryError::Other(e.to_string()))
    }

    /// 取回外置原文（接线 vendor 既有 `raw_contexts` 能力；A1 己1）
    async fn read_raw_context(
        &self,
        session_id: &str,
        hook_id: &str,
    ) -> std::result::Result<Option<String>, MemoryError> {
        match self.storage.read_raw_context(session_id, hook_id).await {
            Ok(content) => Ok(Some(content)),
            // 缺失是正常态（未接线前所有 hook 都无原文），不视为错误
            Err(memory_center_core::Error::Storage(_)) => Ok(None),
            Err(e) => Err(MemoryError::Other(e.to_string())),
        }
    }

    /// 渲染常驻记忆文档 `MEMORY.md`（A1 乙3①）
    ///
    /// 从受治理的集合**派生**（无自由文本写入口，见 [`crate::memory_md`] 模块文档）：
    ///
    /// | 来源 | 取法 |
    /// |---|---|
    /// | 置顶条目 | 扩展库 `pinned` 标记（甲4）→ 取其正文 |
    /// | 调和结论 | 扩展库取代链上**已生成摘要**的记录（甲2）→ 直接取摘要 |
    ///
    /// 两类都缺 → 返回 `None`（调用方不产出空文件）。
    ///
    /// **扩展库未启用**时返回 `None`——常驻集合的元数据（pinned / 取代链）本身就在扩展库里，
    /// 缺它无从判定「谁够格常驻」；此时退化为不产出，而非用库内全量硬凑
    /// （那会违反乙1②「精选」并把每轮成本推到不可接受）。
    async fn render_memory_md(&self) -> std::result::Result<Option<String>, MemoryError> {
        let Some(ext) = self.ext.as_ref() else {
            return Ok(None);
        };

        let mut entries: Vec<memory_md::CuratedEntry> = Vec::new();

        // ① 调和结论（甲2 产出）
        for link in ext
            .supersede_summaries()
            .await
            .map_err(|e| MemoryError::Other(e.to_string()))?
        {
            entries.push(memory_md::CuratedEntry::from_supersede_link(&link));
        }

        // ② 置顶条目（甲4 产出）—— **跨会话视图**
        //
        // MEMORY.md 按设计「贯穿全部会话」（§3.3），故不走会话级索引 `locate_hook`，
        // 而是用扩展库的 (hook_id, memory_id) 直读记忆文件：`Storage::read_memory`
        // 同样不按会话过滤 → 天然得到全局视角。
        for pin in ext
            .pinned_entries()
            .await
            .map_err(|e| MemoryError::Other(e.to_string()))?
        {
            // 单条失败只跳过该条（不让一条坏数据拖垮整份常驻文档）
            match self.storage.read_memory(&pin.memory_id).await {
                Ok(file) => {
                    let text: String = file
                        .turns
                        .iter()
                        .filter_map(|t| t.user_message.text.as_deref())
                        .collect::<Vec<_>>()
                        .join(" ");
                    if text.trim().is_empty() {
                        tracing::warn!(
                            hook = %pin.hook_id,
                            "置顶记忆正文为空（跳过渲染）"
                        );
                        continue;
                    }
                    entries.push(memory_md::CuratedEntry {
                        kind: memory_md::CuratedKind::Pinned,
                        text,
                        at_ms: pin.created_at,
                    });
                }
                Err(e) => {
                    tracing::warn!(
                        hook = %pin.hook_id,
                        memory_id = %pin.memory_id,
                        "读取置顶记忆失败（跳过渲染）: {e}"
                    );
                }
            }
        }

        Ok(memory_md::render(&entries, &self.memory_md_policy))
    }
}

// ─── A1 甲2：内部实现 ────────────────────────────────

/// 调和摘要条目的标签（便于按标签筛出调和记忆，供 `MEMORY.md` 注入消费）
pub const RECONCILE_TAG: &str = "调和";

/// 定位结果（旧条目的读取结果）
struct LocatedHook {
    /// 旧条目的记忆文件 ID
    memory_id: String,
    /// 旧条目的完整记忆文件（冲突检测的对照物）
    memory: MemoryFile,
    /// 旧条目的正文（`turns` 的 user 侧文本拼接；冲突检测用）
    old_text: String,
    /// 旧条目的摘要标题（调和摘要展示用；比正文短且更"标题化"）
    old_title: String,
    /// 旧条目的时点（Unix 毫秒；优先 `created_at`，缺则取记忆归档时间）
    old_at_ms: i64,
}

/// 冲突类型的中文名（取引用——`ConflictKind` 非 `Copy`）
fn kind_display(kind: &memory_center_core::conflict::ConflictKind) -> &'static str {
    use memory_center_core::conflict::ConflictKind;
    match kind {
        ConflictKind::DirectContradict => "直接矛盾",
        ConflictKind::StanceReversal => "立场反转",
        ConflictKind::SelfContradict => "自我矛盾",
    }
}

/// 当前 Unix 毫秒
fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

impl MemoryCenterAccessor {
    /// 按 hook_id 定位旧条目（遍历三个归档周期读索引）
    ///
    /// 同时取出：记忆文件（检测对照）、正文、摘要标题、时点。
    async fn locate_hook(&self, hook_id: &str) -> std::result::Result<Option<LocatedHook>, MemoryError> {
        for period in [
            ArchivePeriod::Daily,
            ArchivePeriod::Weekly,
            ArchivePeriod::Monthly,
        ] {
            let doc = self
                .storage
                .read_index(&self.session_id, self.project_id.as_deref(), period)
                .await
                .map_err(|e| MemoryError::Other(e.to_string()))?;
            let Some(doc) = doc else { continue };
            let Some(hook) = doc.hooks.iter().find(|h| h.id.to_string() == hook_id) else {
                continue;
            };

            let memory = self
                .storage
                .read_memory(&hook.memory_id)
                .await
                .map_err(|e| MemoryError::Other(format!("读取旧记忆失败: {e}")))?;

            let old_text: String = memory
                .turns
                .iter()
                .filter_map(|t| t.user_message.text.as_deref())
                .collect::<Vec<_>>()
                .join("\n");

            // 时点：优先扩展库的「记忆发生时点」，缺则退回记忆文件的归档时间
            let old_at_ms = match &self.ext {
                Some(ext) => match ext.get_by_hook(hook_id).await {
                    Ok(Some(row)) => row.created_at,
                    _ => memory.archived_at.timestamp_millis(),
                },
                None => memory.archived_at.timestamp_millis(),
            };

            return Ok(Some(LocatedHook {
                memory_id: hook.memory_id.clone(),
                memory,
                old_text,
                old_title: hook.summary.title.clone(),
                old_at_ms,
            }));
        }
        Ok(None)
    }

    /// 冲突检测：新内容 vs 旧内容
    ///
    /// 构造 vendor 语义的 [`MemoryUpdate`]（`add_fact(新)` + `deprecate_fact(旧)`）——
    /// 这是「取代」在 vendor 模型里的精确表达。检测器返回的冲突里，取
    /// **严重度最高**的一条作为判定依据（Critical 优先于 Warning）。
    ///
    /// ## 两处已核实的边界（实测得出，非推测）
    ///
    /// 1. **`SelfContradict` 是构造性误报，须剔除**——vendor 的维度 1 比较的是
    ///    「同一批 update 内 added 与 deprecated 的相似度」。我们的 update 按定义
    ///    总是「新增新事实 + 废弃旧事实」，而取代场景下新旧内容天然相似
    ///    （如「字号偏小」→「字号偏大」）→ 维度 1 必然命中。它对**取代**这个用法
    ///    不携带任何信息，保留它会让每一条取代都被标成「自我矛盾」。
    /// 2. **首次取代检不出冲突**——vendor 的 [`HeuristicDetector`] 只从
    ///    `memory.updates` 提取历史事实集（不看 `turns`），故第一次取代时对照组为空，
    ///    维度 2/3 无从命中，判为 `revision`（修订）。第二次起（旧内容已由
    ///    [`MemoryCenterAccessor::write`] 的 Update 分支写进 `updates`）才有对照组。
    ///
    /// 这两点都**不影响安全**：硬规则「矛盾不覆盖」与检测结果无关，
    /// 检测只影响判定依据与摘要的质量。
    async fn detect_conflict(
        &self,
        new_content: &str,
        old_text: &str,
        old_memory: &MemoryFile,
    ) -> Option<memory_center_core::conflict::ConflictKind> {
        use memory_center_core::conflict::ConflictKind;
        let update = MemoryUpdate::new()
            .add_fact(new_content)
            .deprecate_fact(old_text);
        let report = self.conflict_detector.detect(&update, old_memory).await;
        report
            .conflicts
            .iter()
            .filter(|c| c.kind != ConflictKind::SelfContradict)
            .max_by_key(|c| c.severity)
            .map(|c| c.kind.clone())
    }
}

impl MemoryCenterAccessor {
    /// 解析语义栈（未启用 / 建栈失败 → `None`；不播种）
    ///
    /// 建栈开销：向量库加载（本地）+ BM25 空索引；配置指纹不变时命中注册表复用。
    async fn sem_stack(&self) -> Option<Arc<semantic::SemanticStack>> {
        let handle = self.semantics.as_ref()?;
        let config = handle.current()?;
        match semantic::get_or_build(handle.vector_db(), &config).await {
            Ok(stack) => Some(stack),
            Err(e) => {
                tracing::warn!("语义检索栈构建失败（本轮降级为关键词通道）: {e}");
                None
            }
        }
    }

    /// 索引文本（摘要口径 + ext 真标签；vendor `hooks.tags` 列被挪用不作来源）
    async fn index_text_for(&self, view: &SummaryView) -> String {
        let ext_tags: Vec<String> = match &self.ext {
            Some(ext) => ext
                .tags_of(&view.hook_id)
                .await
                .map(|rows| rows.into_iter().map(|(t, _)| t).collect())
                .unwrap_or_default(),
            None => Vec::new(),
        };
        semantic::index_text_of(view, &ext_tags)
    }

    /// 播种（召回路径用）：关键词一次性全量 + 向量仅补缺失
    ///
    /// 向量补齐**失败即停**：避免在同一轮里连续撞网络超时（熔断器会兜底，但没必要
    /// 连撞）；剩余条目留待下次召回或手动重建补齐。
    async fn sem_seed(
        &self,
        stack: &Arc<semantic::SemanticStack>,
        views: &[SummaryView],
    ) -> Arc<semantic::SemanticStack> {
        if !stack.keyword_seeded() {
            for v in views {
                let text = self.index_text_for(v).await;
                stack.index_keyword(&v.hook_id, &v.memory_id, &text);
            }
            stack.mark_keyword_seeded();
        }
        for v in views {
            if stack.has_vector(&v.hook_id) {
                continue;
            }
            let text = self.index_text_for(v).await;
            if !stack.index_hook(&v.hook_id, &v.memory_id, &text).await {
                break;
            }
        }
        stack.clone()
    }

    /// 写前去重：**两条通道各自定额**，判定口径不混用
    ///
    /// 1. **语义通道（首选）**：内容向量化 → 与已有摘要向量比余弦，取最高分；
    ///    阈值 = `cosine_threshold`（默认 `COSINE_DEDUP_THRESHOLD_DEFAULT` = 0.75，实测标定）。
    /// 2. **文本近似回退**（语义未配置 / 向量化失败）：候选来自关键词检索，相似度用
    ///    字符二元组 Jaccard，阈值 = [`JACCARD_DEDUP_THRESHOLD`]（0.92）。
    ///
    /// **为什么回退不看 `cosine_threshold`**：Jaccard 与余弦**不同量纲**——同一句 26 字文本
    /// 的 Jaccard ≈ 0.926，而真实同义改写的余弦只有 0.813–0.887；共用一个数必有一侧失效
    /// （这正是 2026-09-12 修掉的问题）。
    ///
    /// **语义通道可用时不回退**：两条通道判定口径不同，混用会引入假阳性/假阴性交织。
    /// 语义通道给出「无超阈候选」即是结论，只有**向量化失败**才落到回退。
    ///
    /// **保守取向**：候选为空即判「不重复」——宁可重复写入，不可误判吞掉一条新记忆。
    async fn find_duplicate(
        &self,
        content: &str,
        cosine_threshold: f32,
    ) -> std::result::Result<Option<(String, f32)>, MemoryError> {
        // A2 戊1：语义通道优先（候选 = 本会话已有摘要向量）
        if let Some(stack) = self.sem_stack().await {
            let summaries = self
                .retriever
                .get_summaries()
                .await
                .map_err(|e| MemoryError::RecallFailed(e.to_string()))?;
            let allow: HashSet<String> = summaries.iter().map(|s| s.hook_id.clone()).collect();
            if !allow.is_empty() {
                match stack.find_similar(content, 5, &allow).await {
                    Some((hook_id, score)) if score >= cosine_threshold => {
                        return Ok(Some((hook_id, score)));
                    }
                    // 语义通道可用且无超阈候选 → 判定不重复（不再回退文本近似：
                    // 两条通道判定口径不同，混用会引入假阳性/假阴性交织）
                    Some(_) => return Ok(None),
                    // 向量化失败 → 回退文本近似
                    None => {}
                }
            }
        }

        // 回退路径：字符二元组 Jaccard 文本近似
        // 阈值**独立于** cosine_threshold（不同量纲）——见 JACCARD_DEDUP_THRESHOLD 的说明
        // 探测词：取内容前 64 字符（摘要标题取首条消息前 80 字符，二者量级对齐）
        let probe: String = content.chars().take(64).collect();
        let candidates = self
            .retriever
            .filter_hooks_by_keyword(&probe)
            .await
            .map_err(|e| MemoryError::RecallFailed(e.to_string()))?;
        if candidates.is_empty() {
            return Ok(None);
        }

        let mut best: Option<(String, f32)> = None;
        for c in &candidates {
            // 候选侧文本 = 摘要标题 +（若有）抽象摘要
            let mut hay = c.summary_title.clone();
            if let Some(abs) = &c.abstract_text {
                hay.push_str(abs);
            }
            let score = bigram_jaccard(content, &hay);
            if score >= JACCARD_DEDUP_THRESHOLD
                && best.as_ref().map(|(_, s)| score > *s).unwrap_or(true)
            {
                best = Some((c.hook_id.clone(), score));
            }
        }
        Ok(best)
    }

    /// 删除单条记忆（内部，返回是否命中）
    ///
    /// 实现路径：遍历三个归档周期 → 读索引 → 找到目标钩子 → 删记忆文件。
    /// `SqliteStorage` 下 `hooks` 表对 `memories` 有 `ON DELETE CASCADE`，
    /// 删除记忆行即连带清理索引钩子；`LocalStorage` 下则调用完整删除（含软删标记）。
    async fn delete_hook_inner(&self, hook_id: &str) -> std::result::Result<bool, MemoryError> {
        for period in [
            ArchivePeriod::Daily,
            ArchivePeriod::Weekly,
            ArchivePeriod::Monthly,
        ] {
            let doc = self
                .storage
                .read_index(&self.session_id, self.project_id.as_deref(), period)
                .await
                .map_err(|e| MemoryError::Other(e.to_string()))?;
            let Some(doc) = doc else { continue };
            let Some(hook) = doc.hooks.iter().find(|h| h.id.to_string() == hook_id) else {
                continue;
            };
            self.storage
                .delete_memory_complete(
                    &hook.memory_id,
                    hook_id,
                    &self.session_id,
                    self.project_id.as_deref(),
                    period,
                )
                .await
                .map_err(|e| MemoryError::Other(e.to_string()))?;
            // 扩展记录随删（跨库无 FK，须显式）
            if let Some(ext) = &self.ext {
                if let Err(e) = ext.delete_memory_ext(&hook.memory_id).await {
                    tracing::warn!("清理记忆扩展记录失败: {e}");
                }
            }
            // A2 戊1：索引同步（删除即移出两通道；失败仅告警）
            if let Some(stack) = self.sem_stack().await {
                stack.remove(hook_id);
            }
            return Ok(true);
        }
        Ok(false)
    }
}

// ─── 辅助函数 ────────────────────────────────────

/// 将 MemoryCenter 的 [`SummaryView`] 映射为 [`MemoryRecallResult`]
fn summary_to_recall_result(s: &SummaryView, query: &str) -> MemoryRecallResult {
    // 摘要文本：有抽象摘要则拼接标题，否则仅标题
    let summary = match &s.abstract_text {
        Some(abs) if !abs.is_empty() => format!("{}\n{}", s.summary_title, abs),
        _ => s.summary_title.clone(),
    };

    // 关键词：关键实体 + 线索锚点
    let mut keywords = Vec::with_capacity(s.key_entities.len() + s.clue_anchors.len());
    keywords.extend(s.key_entities.iter().cloned());
    keywords.extend(s.clue_anchors.iter().cloned());

    // 相关度评分：基于查询词与摘要/标签的命中率
    let score = compute_score(query, &summary, &s.tags);

    // 匹配字段
    let mut matched_fields = Vec::new();
    if s.summary_title.to_lowercase().contains(&query.to_lowercase()) {
        matched_fields.push("summary_title".to_string());
    }
    if s.tags.iter().any(|t| t.to_lowercase().contains(&query.to_lowercase())) {
        matched_fields.push("tags".to_string());
    }
    if keywords.iter().any(|k| k.to_lowercase().contains(&query.to_lowercase())) {
        matched_fields.push("keywords".to_string());
    }
    if matched_fields.is_empty() && !query.trim().is_empty() {
        matched_fields.push("summary".to_string());
    }

    MemoryRecallResult {
        hook_id: s.hook_id.clone(),
        summary,
        score,
        matched_fields,
        // archived_at 为 RFC3339，转为 Unix 毫秒；解析失败降级为 0
        created_at: chrono::DateTime::parse_from_rfc3339(&s.archived_at)
            .map(|dt| dt.timestamp_millis())
            .unwrap_or(0),
        access_count: 0,
        keywords,
        tags: s.tags.clone(),
        pinned: false,
    }
}

/// 计算查询词与记忆字段的命中率评分（0.0-1.0）
fn compute_score(query: &str, summary: &str, tags: &[String]) -> f32 {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return 1.0;
    }

    let q = trimmed.to_lowercase();
    let hay = format!("{} {}", summary.to_lowercase(), tags.join(" ").to_lowercase());

    let terms: Vec<&str> = q.split_whitespace().collect();
    let hits = terms
        .iter()
        .filter(|t| hay.contains(**t))
        .count();
    if hits == 0 {
        0.0
    } else {
        (hits as f32 / terms.len() as f32).min(1.0)
    }
}

/// 粗略 token 估算（CJK 约 1 token/字，ASCII 约 1 token/4 字符）
///
/// **注意**：这是**注入预算 / 归档计量的兜底近似**。上下文窗口预算的统一计量
/// （A1 丙1）由装配层注入的真实分词器负责（`agent-kernel::context_budget::TokenEstimator`），
/// 两者口径一致（同为上下文 token），但精度不同。
fn estimate_tokens(text: &str) -> usize {
    let mut cjk = 0usize;
    let mut ascii = 0usize;
    for ch in text.chars() {
        if ch.is_ascii() {
            ascii += 1;
        } else {
            cjk += 1;
        }
    }
    cjk + ascii / 4 + 1
}

/// **文本近似回退通道**的去重阈值（**字符二元组 Jaccard** 量纲）
///
/// 与语义余弦阈值（`agent_kernel::memory::COSINE_DEDUP_THRESHOLD_DEFAULT` = 0.75）
/// **不同量纲，绝不可共用**：
///
/// | 度量 | 同一句文本 | 真实同义改写 | 同主题新事实 |
/// |---|---|---|---|
/// | 字符二元组 Jaccard | ≈ 0.926（26 字） | 视改写幅度剧烈波动 | 低 |
/// | embedding 余弦（bge-m3） | ≈ 1.0 | **0.813–0.887** | ≤ 0.691 |
///
/// 故 0.92 只对 Jaccard 成立、对余弦偏高约 0.11（实测使真重复全部漏判）。
/// 回退通道是**降级路径**（语义通道未配置 / 向量化失败），单独定额即可，不对外暴露旋钮。
pub const JACCARD_DEDUP_THRESHOLD: f32 = 0.92;

/// 字符二元组 Jaccard 相似度（0.0–1.0）
///
/// 用于 [`MemoryCenterAccessor::find_duplicate`] 的写前去重近似（**回退路径**）。
///
/// ## 为什么用二元组而不是分词
///
/// 中文没有空格分词，且当前 crate 未引入分词器（`jieba` 只在 vendor 侧、用于 BM25）。
/// 字符二元组对中英混排都成立，且无需依赖：**中文靠字的组合、英文靠字母组合**，
/// 对「同一事实换个说法」这类近似重复有基本辨识力。
///
/// 边界：任一侧二元组集合为空（长度 < 2）时返回 0.0——**保守判为不相似**，
/// 避免把短内容误判成重复而吞掉一条新记忆。
fn bigram_jaccard(a: &str, b: &str) -> f32 {
    fn bigrams(s: &str) -> HashSet<(char, char)> {
        let chars: Vec<char> = s.chars().filter(|c| !c.is_whitespace()).collect();
        chars.windows(2).map(|w| (w[0], w[1])).collect()
    }
    let (sa, sb) = (bigrams(a), bigrams(b));
    if sa.is_empty() || sb.is_empty() {
        return 0.0;
    }
    let inter = sa.intersection(&sb).count() as f32;
    let union = sa.union(&sb).count() as f32;
    if union == 0.0 {
        0.0
    } else {
        inter / union
    }
}

// ─── 错误类型 ────────────────────────────────────

/// agent-memory crate 级错误
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// MemoryCenter 核心错误（存储/检索/归档）
    #[error("MemoryCenter 错误: {0}")]
    Core(String),

    /// 记忆扩展库错误（memory_ext.db，A1 甲4 引入）
    #[error("记忆扩展库错误: {0}")]
    Ext(String),
}

/// Crate 级 Result 别名
pub type Result<T> = std::result::Result<T, Error>;

impl From<memory_center_core::Error> for Error {
    fn from(e: memory_center_core::Error) -> Self {
        Error::Core(e.to_string())
    }
}

// ─── 测试 ────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use agent_runtime::memory::MemoryRecallOptions;
    use memory_center_core::model::{MessageContent, Tag};

    /// 构造测试用 MessageTurn
    fn make_turn(text: &str, token_count: usize) -> MessageTurn {
        MessageTurn {
            id: uuid::Uuid::new_v4(),
            user_message: MessageContent {
                text: Some(text.into()),
                attachments: Vec::new(),
                tool_calls: Vec::new(),
                thinking: None,
                file_changes: Vec::new(),
            },
            llm_message: MessageContent {
                text: Some("LLM 回复".into()),
                attachments: Vec::new(),
                tool_calls: Vec::new(),
                thinking: None,
                file_changes: Vec::new(),
            },
            tags: vec![Tag::Text],
            timestamp: chrono::Utc::now(),
            token_count,
            stop_reason: None,
            cost: None,
        }
    }

    /// 用 SQLite 临时后端创建 accessor
    fn make_accessor() -> MemoryCenterAccessor {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_path_buf();
        // 显式交出临时目录所有权：`TempDir` 析构会尝试删目录，而库文件仍被
        // 持有的连接打开（Windows 下删除会失败，行为依赖平台）；`forget` 让
        // 「目录存活到进程结束」成为确定语义，而非依赖文件锁的副作用。
        std::mem::forget(dir);
        make_accessor_in(&root)
    }

    /// 在指定根目录建适配层（需要自己掌握目录生命周期时使用）
    fn make_accessor_in(root: &std::path::Path) -> MemoryCenterAccessor {
        make_accessor_with_session(root, "sess-agent-memory")
    }

    /// 在指定根目录 + 指定会话 ID 建适配层
    ///
    /// 用于**跨会话**用例：同一 `root` 下不同 `session_id`，记忆库（`_default` 分片）
    /// 与扩展库同源，仅 hooks/memories 的会话过滤不同。
    fn make_accessor_with_session(
        root: &std::path::Path,
        session_id: &str,
    ) -> MemoryCenterAccessor {
        // 阈值取 40：单轮 make_turn 默认 60 tokens，确保 push 1 轮即可触发归档，
        // 与 test_archive_and_recall 的多轮累积断言（110 >= 40）也兼容。
        let config = ArchiveConfig::from_threshold(40);
        MemoryCenterAccessor::new_sqlite(
            root.to_path_buf(),
            session_id,
            None,
            config,
        )
        .unwrap()
    }

    #[tokio::test]
    async fn test_archive_and_recall() {
        let accessor = make_accessor();

        accessor.push_turn(make_turn("讨论 Rust 记忆库设计", 60)).await;
        accessor.push_turn(make_turn("确定三级归档周期", 50)).await;

        // 归档：应返回 Some
        let result = accessor.archive(None).await.unwrap();
        assert!(result.is_some());
        let result = result.unwrap();
        assert_eq!(result.chunk_count, 2);
        assert_eq!(result.token_count, 110);
        assert_eq!(result.new_boundary_index, 2);

        // 边界：已归档 2 轮
        assert_eq!(accessor.get_archive_boundary().await.unwrap(), 2);

        // 再次归档：无缓冲轮次，返回 None
        assert!(accessor.archive(None).await.unwrap().is_none());

        // 检索：命中包含 "Rust" 的记忆
        let results = accessor
            .recall("Rust".to_string(), None)
            .await
            .unwrap();
        assert!(!results.is_empty());
        let r = &results[0];
        assert!(r.summary.contains("记忆库"));
        assert!(r.hook_id.len() >= 8);
    }

    #[tokio::test]
    async fn test_recall_top_k() {
        let accessor = make_accessor();

        for i in 0..5 {
            accessor
                .push_turn(make_turn(&format!("话题 {}", i), 60))
                .await;
            accessor.archive(None).await.unwrap();
        }

        let opts = MemoryRecallOptions {
            top_k: 2,
            ..Default::default()
        };
        let results = accessor
            .recall("话题".to_string(), Some(opts))
            .await
            .unwrap();
        assert!(results.len() <= 2, "top_k=2 应最多返回 2 条，实际 {}", results.len());
    }

    #[tokio::test]
    async fn test_inject_dedup() {
        let accessor = make_accessor();

        accessor.push_turn(make_turn("注入去重测试", 60)).await;
        accessor.archive(None).await.unwrap();

        let results = accessor.recall("注入".to_string(), None).await.unwrap();
        assert!(!results.is_empty());

        // 首次注入：应包含内容
        let first = accessor.inject(results.clone(), None).await.unwrap();
        assert!(!first.is_empty());

        // 二次注入（非 force）：应去重返回空
        let second = accessor.inject(results.clone(), None).await.unwrap();
        assert!(second.is_empty(), "非 force 二次注入应去重");

        // force 注入：应重新注入
        let forced = accessor
            .inject(
                results,
                Some(agent_runtime::memory::MemoryInjectOptions {
                    force: true,
                    ..Default::default()
                }),
            )
            .await
            .unwrap();
        assert!(!forced.is_empty());
    }

    #[tokio::test]
    async fn test_load_chunk() {
        let accessor = make_accessor();

        accessor.push_turn(make_turn("块加载测试内容", 60)).await;
        let result = accessor.archive(None).await.unwrap().unwrap();

        let chunk = accessor
            .load_chunk(result.hook_id.clone(), String::new())
            .await
            .unwrap();
        assert!(chunk.is_some());
        let chunk = chunk.unwrap();
        assert_eq!(chunk.chunk_id.len(), 36); // UUID
        assert!(chunk.messages.iter().any(|m| m.content.contains("块加载测试内容")));
    }

    /// 阶段 3：record_turn（trait 方法）喂入轮次 → 达到阈值 → archive → recall 闭环
    ///
    /// 模拟 ReAct 循环内每轮对话结束调用 `record_turn`，累积到 token 阈值后
    /// `archive` 落盘，后续 `recall` 能检索到该轮记忆。
    #[tokio::test]
    async fn test_record_turn_archive_recall_closed_loop() {
        let accessor = make_accessor();

        // 未达阈值（单轮 token 估算远小于 40）→ archive 返回 None（继续累积）
        // 注意：启发式摘要取首条消息前 80 字符作 title（未注入 LLM 生成器），
        // 故首条也须包含检索关键词 "Rust"，否则后续 recall 无法命中。
        accessor
            .record_turn("Rust 笔记".to_string(), "你好！我是助手".to_string())
            .await
            .unwrap();
        assert!(accessor.archive(None).await.unwrap().is_none());

        // 累积多轮后达到阈值 → 触发归档（阈值 40，此处喂入多轮）
        for i in 0..8 {
            accessor
                .record_turn(
                    format!("讨论主题 {i} 的 Rust 实现细节"),
                    format!("主题 {i} 的回复内容"),
                )
                .await
                .unwrap();
        }
        let result = accessor.archive(None).await.unwrap();
        assert!(result.is_some(), "达到阈值后应触发归档");

        // 归档后可被 recall 检索（关键词命中归档轮次的摘要）
        let results = accessor
            .recall("Rust".to_string(), None)
            .await
            .unwrap();
        assert!(!results.is_empty(), "归档后应能检索到记忆");

        // 归档边界已推进
        assert!(accessor.get_archive_boundary().await.unwrap() > 0);
    }

    /// 孤儿记忆清理：先归档产生记忆，再按会话删除，确认检索命中为空。
    #[tokio::test]
    async fn test_delete_by_session_id_removes_memories() {
        let accessor = make_accessor();

        // 归档多轮产生记忆
        for i in 0..8 {
            accessor
                .record_turn(
                    format!("待清理主题 {i} 的 Rust 细节"),
                    format!("主题 {i} 的回复"),
                )
                .await
                .unwrap();
        }
        assert!(accessor.archive(None).await.unwrap().is_some());

        // 删除前可检索命中
        let before = accessor.recall("Rust".to_string(), None).await.unwrap();
        assert!(!before.is_empty(), "删除前应能检索到记忆");

        // 按会话删除
        accessor
            .delete_by_session_id(&accessor.session_id)
            .await
            .unwrap();

        // 删除后检索应命中为空
        let after = accessor.recall("Rust".to_string(), None).await.unwrap();
        assert!(after.is_empty(), "删除后应检索不到记忆");
    }

    /// A1 甲3：会话删除 → 该会话的**上下文锚点引用**整体释放（外置文件生命周期收口）
    ///
    /// 释放后对应外置文件在下一轮 GC 中从「保护期」进入回收站；此处只验证释放本身
    /// （GC 侧的行为由 `evict::tests` 覆盖）。
    #[tokio::test]
    async fn delete_by_session_id_releases_context_anchor_refs() {
        let accessor = make_accessor();
        let ext = accessor.ext_store().expect("扩展库应已打开");
        let session = accessor.session_id.clone();

        // 两条锚点引用（本会话）+ 一条别的会话（不应被误伤）
        ext.acquire_raw_ref(
            "aaaaaaaaaaaaaaaa",
            crate::ext::owner_kind::CONTEXT_ANCHOR,
            &session,
            false,
        )
        .await
        .unwrap();
        ext.acquire_raw_ref(
            "bbbbbbbbbbbbbbbb",
            crate::ext::owner_kind::CONTEXT_ANCHOR,
            &session,
            false,
        )
        .await
        .unwrap();
        ext.acquire_raw_ref(
            "cccccccccccccccc",
            crate::ext::owner_kind::CONTEXT_ANCHOR,
            "其他会话",
            false,
        )
        .await
        .unwrap();

        accessor.delete_by_session_id(&session).await.unwrap();

        assert_eq!(
            ext.raw_ref_count("aaaaaaaaaaaaaaaa").await.unwrap(),
            0,
            "本会话引用应释放"
        );
        assert_eq!(ext.raw_ref_count("bbbbbbbbbbbbbbbb").await.unwrap(), 0);
        assert_eq!(
            ext.raw_ref_count("cccccccccccccccc").await.unwrap(),
            1,
            "其他会话的引用不得被误伤"
        );
        // 释放后即可 GC（无有效引用）
        assert!(ext.is_gc_eligible("aaaaaaaaaaaaaaaa").await.unwrap());
    }

    // ─── A1 甲1：写入四操作与条目级维护 ──────────────────

    /// `write(Add)` 落库 → 可召回 → 扩展信息已登记（甲4 闭环）
    #[tokio::test]
    async fn write_add_persists_memory_and_ext() {
        let accessor = make_accessor();

        let outcome = accessor
            .write(
                MemoryWriteEntry::add("用户偏好深色主题，界面字号偏小")
                    .with_tags(vec!["偏好".into()]),
                None,
            )
            .await
            .unwrap();
        let hook_id = match outcome {
            WriteOutcome::Added { hook_id } => hook_id,
            other => panic!("应新增成功，实际 {other:?}"),
        };
        assert!(!hook_id.is_empty());

        // 可召回（关键词命中）
        let hits = accessor.recall("深色主题".to_string(), None).await.unwrap();
        assert!(!hits.is_empty(), "写入后应能召回");

        // 扩展信息已登记（含真标签）——A1 甲4 的闭环验证
        let ext = accessor.ext_store().expect("扩展库应已打开");
        let row = ext.get_by_hook(&hook_id).await.unwrap().expect("应有扩展行");
        // ★ A1 甲3：上一次 recall 命中 = 一次真实访问 → 计数与访问时点都应更新
        assert_eq!(row.access_count, 1, "召回命中应计入访问");
        assert!(row.last_access_at > 0, "访问时点应被记录（衰减 recency 依据）");
        assert_eq!(row.summary_method, "rule", "无 LLM 摘要器时应为启发式");
        assert!(
            row.created_at > 0,
            "created_at 应取记忆发生时点（非 0）"
        );
        let tags = ext.tags_of(&hook_id).await.unwrap();
        assert!(tags.iter().any(|(t, _)| t == "偏好"), "真标签应已落库");
    }

    /// 写前去重：同一事实写两遍，第二次判为重复（NOOP 语义）
    #[tokio::test]
    async fn write_dedup_detects_repeat() {
        let accessor = make_accessor();

        let text = "项目使用 Rsproxy 作为 cargo 镜像源，直连可用";
        let first = accessor
            .write(MemoryWriteEntry::add(text), None)
            .await
            .unwrap();
        assert!(matches!(first, WriteOutcome::Added { .. }));

        let second = accessor
            .write(MemoryWriteEntry::add(text), None)
            .await
            .unwrap();
        match second {
            WriteOutcome::Noop { reason: NoopReason::Duplicate { score, .. } } => {
                assert!(
                    score >= JACCARD_DEDUP_THRESHOLD,
                    "重复判定的相似度应达 Jaccard 阈值，实际 {score}"
                );
            }
            other => panic!("重复内容应判为 Noop(Duplicate)，实际 {other:?}"),
        }

        // skip_dedup 可强制写入（用户显式「记住这个」语义）
        let forced = accessor
            .write(
                MemoryWriteEntry::add(text),
                Some(MemoryWriteOptions { skip_dedup: true, ..Default::default() }),
            )
            .await
            .unwrap();
        assert!(matches!(forced, WriteOutcome::Added { .. }), "跳过去重后应写入");
    }

    /// 阈值契约（2026-09-12 标定）：余弦阈值必须落在实测可分区间内，且为默认值
    #[test]
    fn cosine_dedup_threshold_fits_measured_band() {
        use agent_runtime::memory::COSINE_DEDUP_THRESHOLD_DEFAULT as COSINE;
        // 实测（tests/eval_semantic.rs·bge-m3）：同义改写余弦下界 0.8131 / 同主题新事实上界 0.6910
        assert!(
            COSINE > 0.6910 && COSINE < 0.8131,
            "余弦去重阈值必须落在实测可分区间 (0.691, 0.813) 内，实际 {COSINE}"
        );
        assert_eq!(
            MemoryWriteOptions::default().dedup_threshold,
            COSINE,
            "默认写入选项应使用该常量（防默认值漂移）"
        );
        // 两条通道不同量纲：Jaccard 阈值必须显著高于余弦阈值
        assert!(
            JACCARD_DEDUP_THRESHOLD > COSINE,
            "Jaccard 与余弦不同量纲，阈值不应相同（{JACCARD_DEDUP_THRESHOLD} vs {COSINE}）"
        );
    }

    /// 回退通道（Jaccard）**不使用**余弦阈值——两条通道各自定额
    ///
    /// 这是「度量与阈值不可跨度量共用」的可执行契约：若回退错误沿用 `dedup_threshold`，
    /// 调用方传一个偏高的值就会**意外关掉文本近似去重**（反之传偏低值则会误并）。
    #[tokio::test]
    async fn fallback_dedup_ignores_cosine_threshold() {
        let accessor = make_accessor(); // 无语义配置 → 只走回退路径
        let text = "项目使用 Rsproxy 作为 cargo 镜像源，直连可用";
        let first = accessor.write(MemoryWriteEntry::add(text), None).await.unwrap();
        assert!(matches!(first, WriteOutcome::Added { .. }), "{first:?}");

        // 传一个远高于 Jaccard 合理区的「余弦阈值」（0.999）
        let opts = MemoryWriteOptions {
            dedup_threshold: 0.999,
            ..Default::default()
        };
        let again = accessor
            .write(MemoryWriteEntry::add(text), Some(opts))
            .await
            .unwrap();
        assert!(
            matches!(
                again,
                WriteOutcome::Noop {
                    reason: NoopReason::Duplicate { .. },
                    ..
                }
            ),
            "回退通道不应沿用余弦阈值（否则该参数会意外关掉文本近似去重）: {again:?}"
        );
    }

    /// `write(Delete)` 按 hook_id 删除；重复删除判为未命中
    #[tokio::test]
    async fn write_delete_removes_single_memory() {
        let accessor = make_accessor();

        let added = accessor
            .write(MemoryWriteEntry::add("待删除的记忆条目，含关键词 Zed"), None)
            .await
            .unwrap();
        let hook_id = match added {
            WriteOutcome::Added { hook_id } => hook_id,
            other => panic!("应新增成功，实际 {other:?}"),
        };
        assert!(!accessor.recall("Zed".to_string(), None).await.unwrap().is_empty());

        let deleted = accessor
            .write(MemoryWriteEntry::delete(hook_id.clone()), None)
            .await
            .unwrap();
        assert!(matches!(deleted, WriteOutcome::Deleted { .. }), "删除应命中");

        // 再删同一 hook：未命中
        let again = accessor
            .write(MemoryWriteEntry::delete(hook_id), None)
            .await
            .unwrap();
        assert!(matches!(again, WriteOutcome::Noop { reason: NoopReason::NotFound }));
    }

    /// `pin` / `touch`：置顶与访问计数落扩展库（甲3/甲4）
    #[tokio::test]
    async fn pin_and_touch_go_through_ext_store() {
        let accessor = make_accessor();

        let hook_id = match accessor
            .write(MemoryWriteEntry::add("置顶与计数测试，关键词 Qilin"), None)
            .await
            .unwrap()
        {
            WriteOutcome::Added { hook_id } => hook_id,
            other => panic!("应新增成功，实际 {other:?}"),
        };

        accessor.pin(&hook_id, true).await.unwrap();
        let row = accessor
            .ext_store()
            .unwrap()
            .get_by_hook(&hook_id)
            .await
            .unwrap()
            .unwrap();
        assert!(row.pinned, "应已置顶");

        assert_eq!(accessor.touch(&hook_id).await.unwrap(), 1);
        assert_eq!(accessor.touch(&hook_id).await.unwrap(), 2);

        accessor.pin(&hook_id, false).await.unwrap();
        assert!(!accessor
            .ext_store()
            .unwrap()
            .get_by_hook(&hook_id)
            .await
            .unwrap()
            .unwrap()
            .pinned);
    }

    /// A1「Agent 记忆工具」批：召回结果补全**真实治理字段**
    ///
    /// vendor 的 `SummaryView` 拿不到 pinned / access_count / 真标签（三者都在
    /// 适配层扩展库）。若不补，工具输出与 UI 会**误报**（置顶条目显示 `pinned=false`、
    /// 真标签丢失）——模型据此判断会出错。
    #[tokio::test]
    async fn recall_enriches_pinned_access_count_and_real_tags() {
        let accessor = make_accessor();

        let hook_id = match accessor
            .write(
                MemoryWriteEntry::add("召回补全测试，关键词 Fenghuang").with_tags(vec!["真标签A".into()]),
                None,
            )
            .await
            .unwrap()
        {
            WriteOutcome::Added { hook_id } => hook_id,
            other => panic!("应新增成功，实际 {other:?}"),
        };
        accessor.pin(&hook_id, true).await.unwrap();

        // 召回即一次访问（甲3）＋ 补全真实字段
        let hits = accessor.recall("Fenghuang".to_string(), None).await.unwrap();
        let hit = hits.iter().find(|h| h.hook_id == hook_id).expect("应命中");

        assert!(hit.pinned, "置顶状态必须真实反映（vendor 侧恒 false）");
        assert_eq!(hit.access_count, 1, "召回应计入访问计数");
        assert!(
            hit.tags.iter().any(|t| t == "真标签A"),
            "真标签应覆盖 vendor 侧被挪用的列，实际: {:?}",
            hit.tags
        );

        // 再来一次：计数递增（淘汰判据「返青」的输入）
        let again = accessor.recall("Fenghuang".to_string(), None).await.unwrap();
        let hit2 = again.iter().find(|h| h.hook_id == hook_id).unwrap();
        assert_eq!(hit2.access_count, 2);
    }

    /// `read_raw_context`：未接线时返回 None（不视为错误）；写入后可回读
    #[tokio::test]
    async fn read_raw_context_returns_none_when_absent_and_content_when_present() {
        let accessor = make_accessor();

        // 未写入 → None（缺失是正常态，非错误）
        assert!(accessor
            .read_raw_context("sess-agent-memory", "不存在的hook")
            .await
            .unwrap()
            .is_none());

        // 经 vendor 既有能力写入 → 可回读（A1 己1 的接线验证）
        let path = accessor
            .storage
            .write_raw_context("sess-agent-memory", "hook-raw-1", "完整原始上下文")
            .await
            .unwrap();
        assert!(!path.is_empty(), "应返回虚拟路径");
        assert_eq!(
            accessor
                .read_raw_context("sess-agent-memory", "hook-raw-1")
                .await
                .unwrap()
                .as_deref(),
            Some("完整原始上下文")
        );
    }

    /// Update 未命中目标 → `Noop(NotFound)`（不静默吞掉、也不误建）
    #[tokio::test]
    async fn write_update_on_unknown_hook_is_not_found() {
        let accessor = make_accessor();
        let mut entry = MemoryWriteEntry::add("替代内容");
        entry.op = MemoryWriteOp::Update;
        entry.hook_id = Some("不存在的-hook".into());
        let outcome = accessor.write(entry, None).await.unwrap();
        assert!(
            matches!(outcome, WriteOutcome::Noop { reason: NoopReason::NotFound }),
            "未命中应返回 Noop(NotFound)，实际 {outcome:?}"
        );
    }

    // ─── A1 甲2：矛盾调和（取代式更新） ──────────────────

    /// 写一条记忆并返回其 hook_id
    async fn seed(accessor: &MemoryCenterAccessor, text: &str) -> String {
        match accessor
            .write(MemoryWriteEntry::add(text), None)
            .await
            .unwrap()
        {
            WriteOutcome::Added { hook_id } => hook_id,
            other => panic!("播种失败: {other:?}"),
        }
    }

    /// 取代一条记忆（Update），返回结果
    async fn supersede(
        accessor: &MemoryCenterAccessor,
        hook_id: &str,
        new_text: &str,
    ) -> WriteOutcome {
        let mut entry = MemoryWriteEntry::add(new_text);
        entry.op = MemoryWriteOp::Update;
        entry.hook_id = Some(hook_id.to_string());
        accessor.write(entry, None).await.unwrap()
    }

    /// ★ 核心契约：取代不覆盖——旧条目保留、新条目独立、取代链记录完整
    #[tokio::test]
    async fn update_supersedes_without_overwriting_old_entry() {
        let accessor = make_accessor();
        let old_hook = seed(&accessor, "项目使用 React 作为前端框架").await;

        let outcome = supersede(&accessor, &old_hook, "项目已改用 Vue 作为前端框架").await;
        let new_hook = match outcome {
            WriteOutcome::Superseded { old_hook_id, new_hook_id } => {
                assert_eq!(old_hook_id, old_hook);
                assert_ne!(new_hook_id, old_hook, "新条目必须是独立条目");
                new_hook_id
            }
            other => panic!("应返回 Superseded，实际 {other:?}"),
        };

        // ① 旧条目仍在（未被覆盖、未被删除）——可召回
        let hits = accessor.recall("React".to_string(), None).await.unwrap();
        assert!(
            hits.iter().any(|h| h.hook_id == old_hook),
            "旧条目必须保留（矛盾不覆盖）"
        );
        // ② 新条目独立入库——可召回
        let hits = accessor.recall("Vue".to_string(), None).await.unwrap();
        assert!(
            hits.iter().any(|h| h.hook_id == new_hook),
            "新条目应独立入库"
        );
        // ③ 取代链已记录
        let ext = accessor.ext_store().unwrap();
        let link = ext
            .supersede_link(&old_hook, &new_hook)
            .await
            .unwrap()
            .expect("取代链应存在");
        assert_eq!(link.reason, "revision", "首次取代无对照组 → 判为修订");
        assert!(link.summary.is_some(), "默认档应产出调和摘要");
        // ④ 链条可向后走
        assert_eq!(
            ext.supersede_successors(&old_hook).await.unwrap(),
            vec![new_hook.clone()]
        );
    }

    /// ★ 关键陷阱：取代必须**跳过写前去重**
    ///
    /// 新旧内容天然相似（同一事实的修正），若走去重会被判重复而返回 Noop，
    /// 取代永远无法完成。此测试锁住该行为。
    ///
    /// **内容长度说明**：回退通道去重用的「字符二元组 Jaccard」对内容长度敏感——
    /// 摘要标题恒带 `...` 后缀会稀释相似度，故短内容（约 36 字以下）即使完全
    /// 相同也达不到 `JACCARD_DEDUP_THRESHOLD`（0.92；实测 15 字 → 0.875）。用例因此选
    /// 足够长的文本，使对照组**确定性地**触发去重，从而证明「Update 确实绕开了它」。
    ///
    /// 注：该长度敏感性只在**回退路径**存在；语义通道（余弦）对长度不敏感。
    #[tokio::test]
    async fn update_skips_dedup_so_similar_content_can_supersede() {
        let accessor = make_accessor();
        let old = "项目早期采用 React 作为前端框架并配套 Vite 构建工具链，后期团队评估后决定整体迁移";
        let old_hook = seed(&accessor, old).await;

        // 新内容与旧内容高度相似（仅结尾「迁移」→「重写」）
        let new = "项目早期采用 React 作为前端框架并配套 Vite 构建工具链，后期团队评估后决定整体重写";
        let outcome = supersede(&accessor, &old_hook, new).await;
        assert!(
            matches!(outcome, WriteOutcome::Superseded { .. }),
            "相似内容也应能完成取代（不得被写前去重拦截），实际 {outcome:?}"
        );

        // 对照：同内容走普通 Add 会被去重拦截（long 文本确定性触发，见上方说明）
        let dup = accessor
            .write(MemoryWriteEntry::add(old), None)
            .await
            .unwrap();
        assert!(
            matches!(dup, WriteOutcome::Noop { reason: NoopReason::Duplicate { .. } }),
            "对照组：普通 Add 应被去重拦截，实际 {dup:?}"
        );
    }

    /// 调和摘要按设计文档 ② 作为独立记忆入库，并带「调和」标签
    #[tokio::test]
    async fn update_writes_reconciliation_summary_as_memory() {
        let accessor = make_accessor();
        let old_hook = seed(&accessor, "用户 2025 年使用 React").await;
        let outcome = supersede(&accessor, &old_hook, "用户 2026 年改用 Vue").await;
        let new_hook = match outcome {
            WriteOutcome::Superseded { new_hook_id, .. } => new_hook_id,
            other => panic!("应取代成功: {other:?}"),
        };

        let ext = accessor.ext_store().unwrap();
        let summary = ext
            .supersede_link(&old_hook, &new_hook)
            .await
            .unwrap()
            .unwrap()
            .summary
            .expect("应有摘要");

        // 摘要含时序信息（两侧日期）与判定依据
        assert!(summary.contains("前：") && summary.contains("之后（"), "摘要含时序: {summary}");
        assert_eq!(summary.matches("20").count() >= 2, true, "摘要含两侧时点: {summary}");

        // 摘要作为独立记忆入库：带「调和」标签，且既不是旧条目也不是新条目
        let tagged = ext.hooks_by_tag(RECONCILE_TAG).await.unwrap();
        assert_eq!(tagged.len(), 1, "应恰有一条调和记忆，实际 {tagged:?}");
        assert_ne!(tagged[0], old_hook);
        assert_ne!(tagged[0], new_hook);

        // 汇总查询：全部带摘要的调和记录
        let all = ext.supersede_summaries().await.unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].old_hook_id, old_hook);
    }

    /// 取代**不**误报「自我矛盾」（构造性误报须剔除，见 `detect_conflict` 文档）
    #[tokio::test]
    async fn supersede_does_not_misreport_self_contradiction() {
        let accessor = make_accessor();
        let old_hook = seed(&accessor, "偏好：深色主题，字号偏小").await;
        let new_hook = match supersede(&accessor, &old_hook, "偏好：深色主题，字号偏大").await {
            WriteOutcome::Superseded { new_hook_id, .. } => new_hook_id,
            other => panic!("{other:?}"),
        };
        let link = accessor
            .ext_store()
            .unwrap()
            .supersede_link(&old_hook, &new_hook)
            .await
            .unwrap()
            .unwrap();
        assert_ne!(
            link.reason, "self_contradict",
            "add(新)+deprecate(旧) 的构造必然触发 vendor 维度1，对取代无语义，须剔除"
        );
        assert_eq!(link.reason, "revision");
    }

    /// `ChainOnly` 档：只记链不产摘要（R1 成本开关）
    #[tokio::test]
    async fn chain_only_mode_records_link_without_summary() {
        let dir = tempfile::tempdir().unwrap();
        let accessor = make_accessor_in(dir.path()).with_reconcile_policy(
            crate::reconcile::ReconcilePolicy {
                mode: crate::reconcile::ReconcileMode::ChainOnly,
                ..Default::default()
            },
        );

        let old_hook = seed(&accessor, "旧方案：方案甲").await;
        let outcome = supersede(&accessor, &old_hook, "新方案：方案乙").await;
        let new_hook = match outcome {
            WriteOutcome::Superseded { new_hook_id, .. } => new_hook_id,
            other => panic!("应取代成功: {other:?}"),
        };

        let link = accessor
            .ext_store()
            .unwrap()
            .supersede_link(&old_hook, &new_hook)
            .await
            .unwrap()
            .unwrap();
        assert!(link.summary.is_none(), "ChainOnly 档不应产出摘要");
        assert_eq!(link.reason, "revision", "仍记判定依据");

        // 不产摘要 → 汇总查询为空
        assert!(accessor
            .ext_store()
            .unwrap()
            .supersede_summaries()
            .await
            .unwrap()
            .is_empty());
    }

    /// `LlmSummary` 档注入生成器 → 摘要用 LLM 文本
    #[tokio::test]
    async fn llm_mode_uses_injected_summarizer() {
        struct Fake;
        #[async_trait]
        impl crate::reconcile::ReconcileSummarizer for Fake {
            async fn summarize(
                &self,
                _ctx: &crate::reconcile::ReconcileContext,
            ) -> crate::Result<String> {
                Ok("LLM 改写过的调和摘要".to_string())
            }
        }

        let dir = tempfile::tempdir().unwrap();
        let accessor = make_accessor_in(dir.path())
            .with_reconcile_policy(crate::reconcile::ReconcilePolicy {
                mode: crate::reconcile::ReconcileMode::LlmSummary,
                ..Default::default()
            })
            .with_reconcile_summarizer(Arc::new(Fake));

        let old_hook = seed(&accessor, "旧事实 A").await;
        let new_hook = match supersede(&accessor, &old_hook, "新事实 B").await {
            WriteOutcome::Superseded { new_hook_id, .. } => new_hook_id,
            other => panic!("应取代成功: {other:?}"),
        };
        let link = accessor
            .ext_store()
            .unwrap()
            .supersede_link(&old_hook, &new_hook)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(link.summary.as_deref(), Some("LLM 改写过的调和摘要"));
    }

    /// 检测关闭时仍完成取代（安全性不依赖检测）
    #[tokio::test]
    async fn update_works_with_detection_disabled() {
        let dir = tempfile::tempdir().unwrap();
        let accessor = make_accessor_in(dir.path()).with_reconcile_policy(
            crate::reconcile::ReconcilePolicy {
                detect_conflicts: false,
                ..Default::default()
            },
        );
        let old_hook = seed(&accessor, "关闭检测：旧值").await;
        let new_hook = match supersede(&accessor, &old_hook, "关闭检测：新值").await {
            WriteOutcome::Superseded { new_hook_id, .. } => new_hook_id,
            other => panic!("检测关闭也应完成取代: {other:?}"),
        };
        let link = accessor
            .ext_store()
            .unwrap()
            .supersede_link(&old_hook, &new_hook)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(link.reason, "revision", "关闭检测 → 一律判为修订");
    }

    /// 多级取代链：A→B→C，A 可走到 C（保留全部历史）
    #[tokio::test]
    async fn chained_supersede_keeps_full_history() {        let accessor = make_accessor();
        let a = seed(&accessor, "第一代方案：甲").await;
        let b = match supersede(&accessor, &a, "第二代方案：乙").await {
            WriteOutcome::Superseded { new_hook_id, .. } => new_hook_id,
            other => panic!("{other:?}"),
        };
        let c = match supersede(&accessor, &b, "第三代方案：丙").await {
            WriteOutcome::Superseded { new_hook_id, .. } => new_hook_id,
            other => panic!("{other:?}"),
        };

        let ext = accessor.ext_store().unwrap();
        let mut chain = ext.supersede_successors(&a).await.unwrap();
        chain.sort();
        let mut expected = vec![b.clone(), c.clone()];
        expected.sort();
        assert_eq!(chain, expected, "A 应能走到 B 与 C");
        // 三代内容全部保留（可召回）
        for (kw, hook) in [("甲", &a), ("乙", &b), ("丙", &c)] {
            let hits = accessor.recall(kw.to_string(), None).await.unwrap();
            assert!(
                hits.iter().any(|h| &h.hook_id == hook),
                "第 {kw} 代条目应保留"
            );
        }
    }

    // ─── A1 乙3①：MEMORY.md 派生渲染 ──────────────────────

    /// 空库不产出文件（避免空文件被注入白占上下文）
    #[tokio::test]
    async fn render_memory_md_is_none_when_nothing_curated() {
        let accessor = make_accessor();
        // 库里有普通记忆，但既未置顶也无调和结论 → 无资格进精选常驻
        let _ = seed(&accessor, "一条普通记忆，未置顶").await;
        assert!(
            accessor.render_memory_md().await.unwrap().is_none(),
            "无精选常驻条目时应返回 None（不产空文件）"
        );
    }

    /// 置顶条目进入「长期有效」组
    #[tokio::test]
    async fn render_memory_md_includes_pinned_entries() {
        let accessor = make_accessor();
        let hook = seed(&accessor, "用户偏好：界面字号偏大，深色主题").await;
        accessor.pin(&hook, true).await.unwrap();

        let md = accessor.render_memory_md().await.unwrap().expect("应产出内容");
        assert!(md.contains("长期有效"), "应有置顶分组: {md}");
        assert!(md.contains("深色主题"), "应含置顶条目正文: {md}");
        assert!(md.contains("自动维护"), "抬头应声明由记忆系统维护");
        assert!(md.contains("用户不可直接编辑"), "抬头应声明用户只读");
    }

    /// ★ 调和结论自动进入「已知更正」组（甲2 与乙3 的咬合点）
    ///
    /// 设计原话：「调和结论正是最该进 MEMORY.md 的那类内容」——本测试锁住这条自动通路：
    /// 一次取代式更新之后，无需任何额外操作，MEMORY.md 就应包含该更正。
    #[tokio::test]
    async fn render_memory_md_includes_reconcile_summaries_automatically() {
        let accessor = make_accessor();
        let old_hook = seed(&accessor, "用户偏好：界面字号偏小").await;
        let _ = supersede(&accessor, &old_hook, "用户偏好：界面字号偏大").await;

        let md = accessor.render_memory_md().await.unwrap().expect("应产出内容");
        assert!(md.contains("已知更正"), "应有更正分组: {md}");
        assert!(md.contains("前：") && md.contains("之后（"), "应含时序调和摘要: {md}");
    }

    /// 置顶 + 更正并存时的完整形态与组序
    #[tokio::test]
    async fn render_memory_md_full_shape_orders_reconcile_first() {
        let accessor = make_accessor();
        let pinned = seed(&accessor, "长期设定：主角名为林昭").await;
        accessor.pin(&pinned, true).await.unwrap();
        let old = seed(&accessor, "主角设定：主角名为林川").await;
        let _ = supersede(&accessor, &old, "主角设定：主角名为林昭").await;

        let md = accessor.render_memory_md().await.unwrap().unwrap();
        let i_reconcile = md.find("## 已知更正").expect("更正组");
        let i_pinned = md.find("## 长期有效").expect("长期有效组");
        assert!(i_reconcile < i_pinned, "更正组在前（先纠偏再给稳定认知）: {md}");
        assert!(md.contains("林昭"), "含置顶设定");
    }

    /// 取消置顶后条目退出常驻（集合可增减）
    #[tokio::test]
    async fn render_memory_md_drops_entry_after_unpin() {
        let accessor = make_accessor();
        let hook = seed(&accessor, "临时置顶的内容").await;
        accessor.pin(&hook, true).await.unwrap();
        assert!(accessor.render_memory_md().await.unwrap().is_some());

        accessor.pin(&hook, false).await.unwrap();
        assert!(
            accessor.render_memory_md().await.unwrap().is_none(),
            "取消置顶后应回到无内容态"
        );
    }

    /// 扩展库不可用时返回 None 而非用全量硬凑（守住乙1②「精选」）
    #[tokio::test]
    async fn render_memory_md_is_none_without_ext_store() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_path_buf();
        // Windows 下 TempDir 析构会尝试删目录，而库文件仍被打开 → 交所有权给进程
        std::mem::forget(dir);
        let storage: Arc<dyn Storage> =
            Arc::new(SqliteStorage::new(root, None).unwrap());
        let accessor = MemoryCenterAccessor::new(
            storage,
            "sess-agent-memory",
            None,
            ArchiveConfig::from_threshold(40),
        );

        // 库里放点东西，但无扩展库 → 无法判定「谁够格常驻」→ 不产出
        let mut entry = MemoryWriteEntry::add("未置顶的普通记忆");
        entry.hook_id = None;
        let _ = accessor.write(entry, None).await.unwrap();
        assert!(accessor.ext_store().is_none());
        assert!(
            accessor.render_memory_md().await.unwrap().is_none(),
            "无扩展库时应退化为不产出，而非用库内全量硬凑"
        );
    }

    /// ★ 跨会话：A 会话的置顶与更正，应出现在 B 会话视角的 MEMORY.md 中
    ///
    /// 设计依据：MEMORY.md「**贯穿全部会话**」（§3.3）。故其渲染必须跨会话——
    /// 若误用会话级索引（`locate_hook` 按 session 读 hooks），A 会话的置顶在 B 视角下
    /// 会定位失败而被静默跳过，文档就退化成「只反映当前会话」，与设计不符。
    #[tokio::test]
    async fn render_memory_md_is_cross_session() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_path_buf();
        std::mem::forget(dir);

        // A 会话：置顶一条 + 产生一次更正
        let a = make_accessor_with_session(&root, "sess-A");
        let pinned = seed(&a, "跨会话设定：世界名为九霄").await;
        a.pin(&pinned, true).await.unwrap();
        let old = seed(&a, "旧的势力设定：三宗并立").await;
        let _ = supersede(&a, &old, "新的势力设定：五宗并立").await;

        // B 会话（同一记忆根）：应看到 A 的全部常驻内容
        let b = make_accessor_with_session(&root, "sess-B");
        let md = b
            .render_memory_md()
            .await
            .unwrap()
            .expect("B 会话视角也应有常驻内容");

        assert!(md.contains("九霄"), "A 会话的置顶应跨会话可见: {md}");
        assert!(md.contains("五宗并立"), "A 会话的更正应跨会话可见: {md}");
        assert!(md.contains("## 已知更正") && md.contains("## 长期有效"));
    }

    /// 同一状态下两次渲染逐字节一致（调用方据此避免无意义写盘）
    #[tokio::test]
    async fn render_memory_md_is_stable_across_calls() {
        let accessor = make_accessor();
        let a = seed(&accessor, "置顶甲").await;
        accessor.pin(&a, true).await.unwrap();
        let b = seed(&accessor, "将被取代的乙").await;
        let _ = supersede(&accessor, &b, "取代后的丙").await;

        let first = accessor.render_memory_md().await.unwrap().unwrap();
        let second = accessor.render_memory_md().await.unwrap().unwrap();
        assert_eq!(first, second, "同状态两次渲染须逐字节一致");
        assert!(first.ends_with('\n'));
    }

    // ─── A2 戊1：语义检索接入（混合召回 / 语义去重 / 索引同步）────────

    /// 特征假 Embedder：文本包含触发词 → 对应向量；否则零向量（不参与语义通道）
    ///
    /// 零向量是刻意的：向量检索对长度为 0 的向量返回空，等价于「该通道不发声」。
    struct FeatureEmbedder {
        triggers: Vec<(String, Vec<f32>)>,
    }

    #[async_trait]
    impl memory_center_core::semantic::Embedder for FeatureEmbedder {
        fn dim(&self) -> usize {
            3
        }
        async fn embed(&self, text: &str) -> memory_center_core::Result<Vec<f32>> {
            for (keyword, vector) in &self.triggers {
                if text.contains(keyword.as_str()) {
                    return Ok(vector.clone());
                }
            }
            Ok(vec![0.0, 0.0, 0.0])
        }
    }

    /// 建「语义已接线」的 accessor：注册表预置假向量栈 + 注入共享配置句柄
    ///
    /// 返回 `(accessor, stack)` —— stack 供索引进度断言（写入/删除同步）。
    async fn make_semantic_accessor(
        root: &std::path::Path,
        session: &str,
        triggers: Vec<(&str, [f32; 3])>,
        enabled: bool,
    ) -> (MemoryCenterAccessor, Arc<semantic::SemanticStack>) {
        let vec_db = root
            .join("projects")
            .join("_default")
            .join("memory_vec.db");
        let config = semantic::SemanticConfig {
            api_url: "http://127.0.0.1:9/v1/embeddings".into(),
            api_key: "k".into(),
            model: "test-model".into(),
            dim: 3,
            timeout_secs: 1,
        };
        let embedder: Arc<dyn memory_center_core::semantic::Embedder> =
            Arc::new(FeatureEmbedder {
                triggers: triggers
                    .into_iter()
                    .map(|(k, v)| (k.to_string(), v.to_vec()))
                    .collect(),
            });
        let stack =
            semantic::SemanticStack::build_with_embedder(vec_db.clone(), config.clone(), embedder)
                .unwrap();
        semantic::register_stack_for_test(&vec_db, stack.clone()).await;
        let cfg = Arc::new(std::sync::RwLock::new(if enabled { Some(config) } else { None }));
        let accessor = MemoryCenterAccessor::new_sqlite(
            root.to_path_buf(),
            session,
            None,
            ArchiveConfig::from_threshold(40),
        )
        .unwrap()
        .with_semantics(semantic::SemanticHandle::new(cfg, vec_db));
        (accessor, stack)
    }

    /// ★ 混合召回：与记忆**无字面重叠**的查询，靠语义通道命中（并标注 embedding）
    #[tokio::test]
    async fn semantic_recall_hits_without_lexical_overlap() {
        let dir = tempfile::tempdir().unwrap();
        let (accessor, _stack) = make_semantic_accessor(
            dir.path(),
            "sess-sem",
            vec![
                ("偏好使用 vim", [1.0, 0.0, 0.0]),
                ("编辑器设置", [1.0, 0.0, 0.0]),
            ],
            true,
        )
        .await;

        accessor
            .write(MemoryWriteEntry::add("偏好使用 vim 编辑代码"), None)
            .await
            .unwrap();

        // 查询词与记忆无字面重叠（BM25 无从命中）→ 语义通道必须把它捞回来
        let hits = accessor
            .recall("编辑器设置".to_string(), None)
            .await
            .unwrap();
        assert!(!hits.is_empty(), "语义通道应命中无字面重叠的记忆");
        assert!(
            hits[0].matched_fields.iter().any(|f| f == "embedding"),
            "命中来源应标注 embedding: {:?}",
            hits[0].matched_fields
        );
    }

    /// 语义未启用 → 保持既有行为（无 embedding 标注；无字面重叠则命中不到）
    #[tokio::test]
    async fn semantic_disabled_keeps_legacy_recall() {
        let dir = tempfile::tempdir().unwrap();
        let (accessor, _stack) = make_semantic_accessor(
            dir.path(),
            "sess-off",
            vec![
                ("偏好使用 vim", [1.0, 0.0, 0.0]),
                ("编辑器设置", [1.0, 0.0, 0.0]),
            ],
            false,
        )
        .await;

        accessor
            .write(MemoryWriteEntry::add("偏好使用 vim 编辑代码"), None)
            .await
            .unwrap();

        let hits = accessor.recall("vim".to_string(), None).await.unwrap();
        assert!(!hits.is_empty(), "字面命中仍应生效（既有路径）");
        assert!(
            !hits.iter().any(|r| r.matched_fields.iter().any(|f| f == "embedding")),
            "未接线时不得出现 embedding 标注"
        );
        let miss = accessor
            .recall("编辑器设置".to_string(), None)
            .await
            .unwrap();
        assert!(
            miss.is_empty(),
            "未启用语义时无字面重叠命中不到（与接线前一致）: {miss:?}"
        );
    }

    /// ★ 语义去重：向量近重复（余弦 ≥ 阈值）→ Noop(Duplicate)；异主题正常写入
    #[tokio::test]
    async fn semantic_dedup_blocks_near_duplicate() {
        let dir = tempfile::tempdir().unwrap();
        let (accessor, _stack) = make_semantic_accessor(
            dir.path(),
            "sess-dup",
            vec![
                ("内容甲", [1.0, 0.0, 0.0]),
                ("内容乙", [1.0, 0.0, 0.0]),
                ("内容丙", [0.0, 1.0, 0.0]),
            ],
            true,
        )
        .await;

        let first = accessor
            .write(MemoryWriteEntry::add("内容甲：项目采用单文件存储"), None)
            .await
            .unwrap();
        assert!(matches!(first, WriteOutcome::Added { .. }), "{first:?}");

        // 换一种说法但向量相同 → 判重（语义通道，阈值 COSINE_DEDUP_THRESHOLD_DEFAULT = 0.75）
        let dup = accessor
            .write(MemoryWriteEntry::add("内容乙：换个说法的同一件事"), None)
            .await
            .unwrap();
        assert!(
            matches!(
                dup,
                WriteOutcome::Noop {
                    reason: NoopReason::Duplicate { .. },
                    ..
                }
            ),
            "向量近重复应判重复: {dup:?}"
        );

        // 异主题（正交向量）→ 正常写入
        let other = accessor
            .write(MemoryWriteEntry::add("内容丙：完全不同的主题"), None)
            .await
            .unwrap();
        assert!(matches!(other, WriteOutcome::Added { .. }), "{other:?}");
    }

    /// 写入/删除同步索引（关键词 + 向量两通道）
    #[tokio::test]
    async fn write_and_delete_sync_semantic_index() {
        let dir = tempfile::tempdir().unwrap();
        let (accessor, stack) = make_semantic_accessor(
            dir.path(),
            "sess-sync",
            vec![("同步验证", [1.0, 0.0, 0.0])],
            true,
        )
        .await;

        let outcome = accessor
            .write(MemoryWriteEntry::add("同步验证：写入即索引"), None)
            .await
            .unwrap();
        let hook_id = match outcome {
            WriteOutcome::Added { hook_id } => hook_id,
            other => panic!("应新增成功: {other:?}"),
        };
        let st = stack.stats();
        assert!(st.keyword_len >= 1, "写入后关键词索引应有序条目: {st:?}");
        assert!(st.vector_len >= 1, "写入后向量索引应有条目: {st:?}");
        assert!(stack.has_vector(&hook_id), "该 hook 应有向量");

        // 删除 → 两通道同步移除
        let del = accessor
            .write(MemoryWriteEntry::delete(&hook_id), None)
            .await
            .unwrap();
        assert!(matches!(del, WriteOutcome::Deleted { .. }), "{del:?}");
        assert!(!stack.has_vector(&hook_id), "删除后向量应移除");
        assert_eq!(stack.stats().vector_len, 0);
        assert_eq!(stack.stats().keyword_len, 0);
    }

    /// 召回路径的懒播种：首次检索把既有记忆灌入两通道（关键词一次性 + 向量补缺）
    #[tokio::test]
    async fn recall_seeds_pre_existing_memories() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_path_buf();
        // 先以「未接线」身份写入一条既有记忆（模拟接线前的存量数据）
        let plain = make_accessor_with_session(&root, "sess-seed");
        plain
            .write(MemoryWriteEntry::add("存量记忆：赛季规则草案"), None)
            .await
            .unwrap();

        // 再接语义（同一 root / 会话）：首次 recall 应自动播种
        let (accessor, stack) = make_semantic_accessor(
            &root,
            "sess-seed",
            vec![
                ("赛季规则", [1.0, 0.0, 0.0]),
                ("赛制问询", [1.0, 0.0, 0.0]),
            ],
            true,
        )
        .await;
        assert_eq!(stack.stats().keyword_len, 0, "接线前索引为空");

        let hits = accessor.recall("赛制问询".to_string(), None).await.unwrap();
        assert!(!hits.is_empty(), "播种后无字面重叠的语义查询应命中");
        assert!(stack.keyword_seeded(), "首次召回后应标记已播种");
        assert!(stack.stats().vector_len >= 1, "向量应补齐");
    }
}