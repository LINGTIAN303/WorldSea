//! # 记忆访问器
//!
//! 对应 TS 版 `MemoryAccessor` 接口。
//! 节点通过此 trait 访问长期记忆系统（memory-archive）。
//!
//! 三类记忆：
//! - **短期记忆**：`OrchestratorState.messages`，由 `ShortTermMemoryHelper` 管理 trim 策略
//! - **工作记忆**：`OrchestratorState.extra["workingMemory"]`，存储 ReAct 循环内的观察缓冲
//! - **长期记忆**：通过本 trait 检索/注入/归档

use async_trait::async_trait;

// ─── 记忆访问器 trait ────────────────────────────────────

/// 记忆访问器 — 节点通过此接口访问记忆系统
///
/// 设计原则：
/// - **解耦**：不直接依赖 memory-archive，接口可适配任何记忆系统
/// - **可迁移**：接口设计可直接映射到 Rust trait
/// - **轻量**：只暴露节点需要的核心操作（recall/inject/archive）
#[async_trait]
pub trait MemoryAccessor: Send + Sync {
    /// 检索长期记忆
    ///
    /// # 参数
    /// - `query`：检索查询（用户原话或节点生成的关键词）
    /// - `options`：检索选项
    ///
    /// # 返回
    /// 检索结果列表（按相关度降序）
    async fn recall(
        &self,
        query: String,
        options: Option<MemoryRecallOptions>,
    ) -> Result<Vec<MemoryRecallResult>, MemoryError>;

    /// 注入记忆摘要到 system prompt，详细见 docs/details/注释/agent-runtime/memory.md
    async fn inject(
        &self,
        results: Vec<MemoryRecallResult>,
        options: Option<MemoryInjectOptions>,
    ) -> Result<String, MemoryError>;

    /// 触发归档（将当前会话消息归档为长期记忆）
    ///
    /// # 参数
    /// - `source`：触发源
    ///
    /// # 返回
    /// 归档结果，未触发归档时返回 `None`
    async fn archive(
        &self,
        source: Option<ArchiveSource>,
    ) -> Result<Option<MemoryArchiveResult>, MemoryError>;

    /// 获取当前归档边界（已归档消息的结束索引）
    ///
    /// 节点可用此判断 `state.messages` 中哪些是"新消息"，哪些已被归档。
    async fn get_archive_boundary(&self) -> Result<usize, MemoryError>;

    /// 加载记忆块完整内容（按需加载片段）
    ///
    /// 默认实现返回 `None`（不支持按需加载）。
    async fn load_chunk(
        &self,
        _hook_id: String,
        _chunk_id: String,
    ) -> Result<Option<MemoryChunkContent>, MemoryError> {
        Ok(None)
    }

    /// 记录一轮对话（供归档前累积），详细见 docs/details/注释/agent-runtime/memory.md
    async fn record_turn(
        &self,
        _user_message: String,
        _assistant_message: String,
    ) -> Result<(), MemoryError> {
        Ok(())
    }
}

// ─── 检索选项与结果 ────────────────────────────────────

/// 记忆检索选项
#[derive(Debug, Clone)]
pub struct MemoryRecallOptions {
    /// 检索模式（默认 hybrid）
    pub mode: RecallMode,
    /// 返回结果数（默认 5）
    pub top_k: u32,
    /// 最低相似度（默认 0.25）
    pub min_score: f32,
    /// 时间范围过滤（Unix 毫秒）
    pub date_range: Option<(i64, i64)>,
    /// 输出类型过滤
    pub output_types: Vec<MemoryOutputType>,
}

impl Default for MemoryRecallOptions {
    fn default() -> Self {
        Self {
            mode: RecallMode::Hybrid,
            top_k: 5,
            min_score: 0.25,
            date_range: None,
            output_types: Vec::new(),
        }
    }
}

/// 检索模式
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecallMode {
    Keyword,
    Semantic,
    Hybrid,
    List,
}

/// 记忆检索结果
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MemoryRecallResult {
    /// 钩子 ID
    pub hook_id: String,
    /// 摘要（LLM 生成，2K-5K）
    pub summary: String,
    /// 相关度评分（0.0-1.0）
    pub score: f32,
    /// 匹配字段（keywords/summary/embedding 等）
    pub matched_fields: Vec<String>,
    /// 归档时间戳（Unix 毫秒）
    pub created_at: i64,
    /// 访问次数
    pub access_count: u32,
    /// 关键词标签
    pub keywords: Vec<String>,
    /// 用户标签
    pub tags: Vec<String>,
    /// 永久保留标记
    pub pinned: bool,
}

// ─── 注入选项 ────────────────────────────────────

/// 记忆注入选项
#[derive(Debug, Clone)]
pub struct MemoryInjectOptions {
    /// 注入最大 token 数（默认 2000）
    pub max_tokens: u32,
    /// 是否强制重新注入（默认 false，复用已注入摘要）
    pub force: bool,
}

impl Default for MemoryInjectOptions {
    fn default() -> Self {
        Self {
            max_tokens: 2000,
            force: false,
        }
    }
}

// ─── 归档 ────────────────────────────────────

/// 归档触发源
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArchiveSource {
    Threshold,
    SessionEnd,
    Manual,
}

/// 记忆归档结果
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MemoryArchiveResult {
    /// 钩子 ID
    pub hook_id: String,
    /// 记忆文件 ID
    pub file_id: String,
    /// 归档的 token 数
    pub token_count: u32,
    /// 归档的分块数
    pub chunk_count: u32,
    /// 归档后新的边界索引
    pub new_boundary_index: usize,
    /// 摘要生成方式
    pub summary_method: SummaryMethod,
}

/// 摘要生成方式
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SummaryMethod {
    Llm,
    Rule,
    None,
}

/// 记忆块完整内容
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MemoryChunkContent {
    /// 块 ID
    pub chunk_id: String,
    /// 主题标题
    pub title: String,
    /// 输出类型
    pub output_type: MemoryOutputType,
    /// 用户消息锚点
    pub user_message_anchor: String,
    /// token 数
    pub token_count: u32,
    /// 完整消息快照
    pub messages: Vec<MemoryChunkMessage>,
}

/// 记忆块消息
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MemoryChunkMessage {
    pub role: String,
    pub content: String,
    pub tool_call_id: Option<String>,
    pub tool_name: Option<String>,
    pub timestamp: i64,
}

// ─── 输出类型 ────────────────────────────────────

/// Agent 输出类型（与 memory-archive 对齐，但解耦）
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryOutputType {
    Text,
    ToolCall,
    EntityOp,
    Code,
    Analysis,
    Creative,
    Other,
}

// ─── 错误 ────────────────────────────────────

/// 记忆系统错误
#[derive(Debug, thiserror::Error)]
pub enum MemoryError {
    #[error("记忆系统不可用")]
    Unavailable,

    #[error("检索失败: {0}")]
    RecallFailed(String),

    #[error("注入失败: {0}")]
    InjectFailed(String),

    #[error("归档失败: {0}")]
    ArchiveFailed(String),

    #[error("记忆块不存在: {0}")]
    ChunkNotFound(String),

    #[error("其他错误: {0}")]
    Other(String),
}
