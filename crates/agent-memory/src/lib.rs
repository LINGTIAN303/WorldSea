//! MemoryAccessor 适配层（agent-memory）：以 memory-center-core 实现 MemoryAccessor trait，详细见 docs/details/注释/agent-memory/lib.md

#![forbid(unsafe_code)]

use async_trait::async_trait;
use std::collections::HashSet;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use agent_runtime::memory::{
    ArchiveSource, MemoryAccessor, MemoryArchiveResult, MemoryChunkContent, MemoryChunkMessage,
    MemoryError, MemoryInjectOptions, MemoryOutputType, MemoryRecallOptions, MemoryRecallResult,
    SummaryMethod,
};
use memory_center_core::archive::Archiver;
use memory_center_core::model::{ArchiveConfig, MessageContent, MessageTurn, Tag};
use memory_center_core::retrieve::{Retriever, SummaryView};
use memory_center_core::sqlite::SqliteStorage;
use memory_center_core::storage::Storage;

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
}

impl MemoryCenterAccessor {
    /// 创建适配层（默认使用 SQLite 存储后端）
    ///
    /// # 参数
    /// - `root`：存储根目录（`{root}/projects/{project_id}/memories.db`）
    /// - `session_id`：当前会话 ID（记忆隔离依据）
    /// - `project_id`：项目 ID（可选，跨会话聚合检索）
    /// - `archive_config`：归档阈值配置（token 阈值 / 强制截断上限）
    pub fn new_sqlite(
        root: impl Into<std::path::PathBuf>,
        session_id: impl Into<String>,
        project_id: Option<String>,
        archive_config: ArchiveConfig,
    ) -> crate::Result<Self> {
        let storage: Arc<dyn Storage> = Arc::new(SqliteStorage::new(root, project_id.clone())?);
        Ok(Self::new(storage, session_id, project_id, archive_config))
    }

    /// 创建适配层（可注入任意存储后端）
    pub fn new(
        storage: Arc<dyn Storage>,
        session_id: impl Into<String>,
        project_id: Option<String>,
        archive_config: ArchiveConfig,
    ) -> Self {
        let session_id = session_id.into();
        let retriever = Retriever::new(storage.clone(), session_id.clone(), project_id.clone());
        let archiver = Archiver::new(archive_config, storage.clone(), session_id.clone(), project_id);
        Self {
            retriever,
            archiver: Arc::new(tokio::sync::Mutex::new(archiver)),
            session_id,
            boundary: AtomicUsize::new(0),
            injected_hooks: Arc::new(Mutex::new(HashSet::new())),
        }
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

// ─── 错误类型 ────────────────────────────────────

/// agent-memory crate 级错误
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// MemoryCenter 核心错误（存储/检索/归档）
    #[error("MemoryCenter 错误: {0}")]
    Core(String),
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
}