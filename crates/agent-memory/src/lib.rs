//! MemoryAccessor 适配层（agent-memory）：以 memory-center-core 实现 MemoryAccessor trait，详细见 docs/details/注释/agent-memory/lib.md

#![forbid(unsafe_code)]

pub mod ext;
pub mod model_profile;

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
use memory_center_core::model::{ArchiveConfig, ArchivePeriod, MessageContent, MessageTurn, Tag};
use memory_center_core::retrieve::{Retriever, SummaryView};
use memory_center_core::sqlite::SqliteStorage;
use memory_center_core::storage::Storage;

use ext::ExtStore;

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
}

impl MemoryCenterAccessor {
    /// 创建适配层（默认使用 SQLite 存储后端）
    ///
    /// # 参数
    /// - `root`：存储根目录（`{root}/projects/{project_id}/memories.db`）
    /// - `session_id`：当前会话 ID（记忆隔离依据）
    /// - `project_id`：项目 ID（可选，跨会话聚合检索）
    /// - `archive_config`：归档阈值配置（token 阈值 / 强制截断上限）
    ///
    /// 同时打开同目录下的**扩展库** `memory_ext.db`（A1 甲4）；扩展库打开失败时
    /// 降级为 `None`（记忆主链路不受影响，仅 A1 新增能力不可用）。
    pub fn new_sqlite(
        root: impl Into<std::path::PathBuf>,
        session_id: impl Into<String>,
        project_id: Option<String>,
        archive_config: ArchiveConfig,
    ) -> crate::Result<Self> {
        let root = root.into();
        let storage: Arc<dyn Storage> = Arc::new(SqliteStorage::new(root.clone(), project_id.clone())?);
        let ext = match ExtStore::open(root, project_id.clone()) {
            Ok(s) => Some(s),
            Err(e) => {
                tracing::warn!("打开记忆扩展库失败（A1 甲4 能力不可用）: {e}");
                None
            }
        };
        Ok(Self::new_with_ext(storage, session_id, project_id, archive_config, ext))
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
        }
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

        // 关键词预筛选：返回相关度 > 0 的摘要视图（按相关度降序）
        let summaries = self
            .retriever
            .filter_hooks_by_keyword(&query)
            .await
            .map_err(|e| MemoryError::RecallFailed(e.to_string()))?;

        let mut results: Vec<MemoryRecallResult> = summaries
            .into_iter()
            .map(|s| summary_to_recall_result(&s, &query))
            .collect();

        // 应用 top_k（按相关度降序，取前 N）
        let top_k = opts.top_k.max(1) as usize;
        if results.len() > top_k {
            results.truncate(top_k);
        }

        Ok(results)
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
                // A1 甲1 分期：UPDATE 依赖甲2 矛盾调和策略，本期不启用。
                // 关键取向：**不静默覆盖**——宁可什么都不做，也不制造静默的信息丢失。
                tracing::warn!(
                    layer = ?entry.layer,
                    "记忆 Update 操作尚未启用（A1 甲1 分期后置）；矛盾一律走调和链，本期不覆盖"
                );
                Ok(WriteOutcome::Noop { reason: NoopReason::Explicit })
            }

            MemoryWriteOp::Delete => {
                let hook_id = entry
                    .hook_id
                    .ok_or_else(|| MemoryError::Other("Delete 操作缺少 hook_id".into()))?;
                if self.delete_hook_inner(&hook_id).await? {
                    Ok(WriteOutcome::Updated { hook_id })
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
}

// ─── A1 甲1：内部实现 ────────────────────────────────

impl MemoryCenterAccessor {
    /// 写前去重：候选来自关键词检索，相似度用「字符二元组 Jaccard」近似
    ///
    /// **这是 A2 语义检索落地前的占位实现**——上游 2026 年调研里「相似度 > 0.92」
    /// 指的是 embedding 余弦相似度，而当前检索器只有关键词通道。故此处：
    /// 1. 用内容前缀作为探测词取得候选（与摘要标题的产生方式一致：首段文本）；
    /// 2. 对候选的摘要文本做字符二元组 Jaccard，与阈值比较。
    ///
    /// **保守取向**：候选为空即判「不重复」——宁可重复写入，不可误判吞掉一条新记忆。
    /// A2 落地后本函数体可整体替换（签名与语义不变）。
    async fn find_duplicate(
        &self,
        content: &str,
        threshold: f32,
    ) -> std::result::Result<Option<(String, f32)>, MemoryError> {
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
            if score >= threshold && best.as_ref().map(|(_, s)| score > *s).unwrap_or(true) {
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

/// 字符二元组 Jaccard 相似度（0.0–1.0）
///
/// 用于 [`MemoryCenterAccessor::find_duplicate`] 的写前去重近似。
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
        // 阈值取 40：单轮 make_turn 默认 60 tokens，确保 push 1 轮即可触发归档，
        // 与 test_archive_and_recall 的多轮累积断言（110 >= 40）也兼容。
        let config = ArchiveConfig::from_threshold(40);
        MemoryCenterAccessor::new_sqlite(root, "sess-agent-memory", None, config).unwrap()
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
        assert_eq!(row.access_count, 0);
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
                assert!(score >= 0.92, "重复判定的相似度应达阈值，实际 {score}");
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
        assert!(matches!(deleted, WriteOutcome::Updated { .. }), "删除应命中");

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

    /// Update 本期后置：返回 Noop 而非静默覆盖（不制造信息丢失）
    #[tokio::test]
    async fn write_update_is_deferred_not_silently_overwriting() {
        let accessor = make_accessor();
        let mut entry = MemoryWriteEntry::add("被更新的内容");
        entry.op = MemoryWriteOp::Update;
        let outcome = accessor.write(entry, None).await.unwrap();
        assert!(
            matches!(outcome, WriteOutcome::Noop { .. }),
            "Update 后置期应返回 Noop，绝不静默覆盖，实际 {outcome:?}"
        );
    }
}