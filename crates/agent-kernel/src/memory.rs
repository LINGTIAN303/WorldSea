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

    /// 删除指定会话的全部记忆记录（删除会话时级联清理孤儿记忆）
    ///
    /// 默认实现不做任何事（不支持的访问器视为无孤儿可清理）。
    async fn delete_by_session_id(&self, _session_id: &str) -> Result<(), MemoryError> {
        Ok(())
    }

    // ─── A1 甲1：写入四操作与条目级维护（全部给默认实现，保证既有调用方零破坏）───

    /// 结构化写入（四操作：ADD / UPDATE / DELETE / NOOP）
    ///
    /// 详细语义见 [`MemoryWriteOp`] 与 [A1 记忆系统设计] §4.1。
    ///
    /// **默认实现返回 `Noop(Explicit)`**——未实现写入能力的访问器视为「写不进去」，
    /// 而不是报错（与既有默认方法同一保守取向）。
    ///
    /// [A1 记忆系统设计]: ../../../docs/plans/2026-09-11-A1-记忆系统设计.md
    async fn write(
        &self,
        _entry: MemoryWriteEntry,
        _options: Option<MemoryWriteOptions>,
    ) -> Result<WriteOutcome, MemoryError> {
        Ok(WriteOutcome::Noop { reason: NoopReason::Explicit })
    }

    /// 按 hook_id 删除单条记忆（纠正用；此前只有按会话整删）
    async fn delete_by_hook_id(&self, _hook_id: &str) -> Result<(), MemoryError> {
        Ok(())
    }

    /// 置顶 / 取消置顶（`pinned` 记忆不衰减、不淘汰）
    async fn pin(&self, _hook_id: &str, _pinned: bool) -> Result<(), MemoryError> {
        Ok(())
    }

    /// 访问计数 +1（甲3 淘汰的加权依据）；返回自增后的次数
    async fn touch(&self, _hook_id: &str) -> Result<u32, MemoryError> {
        Ok(0)
    }

    /// 取回外置原文（己1：超长内容外置后按锚点回读）
    ///
    /// 默认实现返回 `Ok(None)`（不支持外置原文的访问器视为无此内容）。
    async fn read_raw_context(
        &self,
        _session_id: &str,
        _hook_id: &str,
    ) -> Result<Option<String>, MemoryError> {
        Ok(None)
    }

    /// 渲染常驻记忆文档 `MEMORY.md`（A1 乙3①）
    ///
    /// 返回 `None` = 无可渲染内容（调用方据此**不产出空文件**——空文件被注入只会
    /// 白占上下文，且会让「文件存在」失去「有常驻记忆」的含义）。
    ///
    /// 默认实现返回 `Ok(None)`——未实现常驻记忆的访问器视为无此产物。
    ///
    /// 语义约束见 [`crate::memory::MEMORY_MD_USAGE`]。
    async fn render_memory_md(&self) -> Result<Option<String>, MemoryError> {
        Ok(None)
    }
}

/// `render_memory_md` 的语义约束（给实现者的契约说明）
///
/// **产出方向是单向的**：从受治理的记忆集合**派生渲染**，不接受自由文本写入口。
/// 这是 A1 乙2 用户留言「以文件为准，但不包含 MEMORY.md 这个特殊记忆文件」的实现落点——
/// 该文件「用户不能涉及 + 不能随意写入」，故没有「编辑文件即编辑记忆」这条路径。
///
/// **内容边界**（乙1② 精选常驻）：只放跨项目的、稳定的、必须每轮在上下文里的少量条目。
/// 它是**每轮常态成本**，与按需召回**不是同一个预算池**（后者是 `agent-memory` 的
/// 「召回注入」预算）。故实现方须设**独立且更紧**的上限，且在超限时给出省略说明而非静默截断。
pub const MEMORY_MD_USAGE: &str = "从受治理的记忆集合派生渲染，无自由文本写入口；内容限跨项目稳定且每轮必需的少量条目";

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

// ─── A1 甲1：写入四操作 ────────────────────────────────

/// 写入操作类型（A1 甲1）
///
/// **四操作缺一即退化为 append-only**——这是 2026 年外部调研的核心结论
/// （Mem0 的扁平结构累积 38% 陈旧率，基准准确率从 93.4% 掉到 49.0% 的主因）。
///
/// 本期实现进度（A1 甲1 分期：先补 NOOP + DELETE，UPDATE 后置）：
///
/// | 操作 | 语义 | 本期状态 |
/// |---|---|---|
/// | [`Add`](Self::Add) | 新增；**写前先去重**（相似度 ≥ 阈值 → 判为 `Noop`） | ✅ 已实现 |
/// | [`Delete`](Self::Delete) | 按 `hook_id` 删除单条（纠正错误记忆） | ✅ 已实现 |
/// | [`Noop`](Self::Noop) | 显式声明「无需写入」 | ✅ 已实现 |
/// | [`Update`](Self::Update) | 原地更新 | 🟡 后置（依赖甲2 矛盾调和策略；当前返回 `Noop`，不静默覆盖） |
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryWriteOp {
    /// 新增（写前检索去重）
    Add,
    /// 原地更新（本期未启用——矛盾不覆盖，走调和链）
    Update,
    /// 按 hook_id 删除
    Delete,
    /// 显式无操作
    Noop,
}

/// 记忆层级（WorldSea 内部四层命名，A1 甲0② / 丁4②）
///
/// 这是**抽象度 + 作用域**维度，用于 WorldSea 内部表述；
/// 跨项目（与 MemoryCenter）对话时**不得**与生命周期分层
/// （Working → Archived → WeeklyMerged → MonthlyScored → Retained/Evicted）混用。
///
/// 与 `agent-patterns` 的 `MemLayer`（B 轨编排内部四层）是**同族概念但不同载体**：
/// 此处服务于长期记忆的写入归档，`MemLayer` 服务于编排节点视图。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryLayer {
    /// 工作记忆：单任务黑板（不跨会话沉淀）
    Working,
    /// 情景记忆：单会话历史
    #[default]
    Episodic,
    /// 语义记忆：跨会话项目知识
    Semantic,
    /// 程序性记忆：跨会话技能与策略（reflective 产出落此层，见 A1 丁2）
    Procedural,
}

/// 写入条目（A1 甲1）
#[derive(Debug, Clone)]
pub struct MemoryWriteEntry {
    /// 操作类型
    pub op: MemoryWriteOp,
    /// 内容（Add 时为待写入正文；Delete/Update 时用于日志，可空）
    pub content: String,
    /// 层级
    pub layer: MemoryLayer,
    /// 目标钩子 ID（Delete / Update 必填；Add 时忽略）
    pub hook_id: Option<String>,
    /// 关联实体 ID（甲0② 实体记忆桥接；作为召回的过滤面与排序特征）
    pub entity_ids: Vec<String>,
    /// 真标签（落扩展库 `hook_tags`，不用被挪用的 `hooks.tags` 列）
    pub tags: Vec<String>,
}

impl MemoryWriteEntry {
    /// 构造一条 Add 条目
    pub fn add(content: impl Into<String>) -> Self {
        Self {
            op: MemoryWriteOp::Add,
            content: content.into(),
            layer: MemoryLayer::default(),
            hook_id: None,
            entity_ids: Vec::new(),
            tags: Vec::new(),
        }
    }

    /// 构造一条 Delete 条目
    pub fn delete(hook_id: impl Into<String>) -> Self {
        Self {
            op: MemoryWriteOp::Delete,
            content: String::new(),
            layer: MemoryLayer::default(),
            hook_id: Some(hook_id.into()),
            entity_ids: Vec::new(),
            tags: Vec::new(),
        }
    }

    /// 指定层级（链式）
    pub fn with_layer(mut self, layer: MemoryLayer) -> Self {
        self.layer = layer;
        self
    }

    /// 指定标签（链式）
    pub fn with_tags(mut self, tags: Vec<String>) -> Self {
        self.tags = tags;
        self
    }

    /// 指定关联实体（链式）
    pub fn with_entities(mut self, entity_ids: Vec<String>) -> Self {
        self.entity_ids = entity_ids;
        self
    }
}

/// 写入选项（A1 甲1）
#[derive(Debug, Clone)]
pub struct MemoryWriteOptions {
    /// 去重相似度阈值（写前检索命中 ≥ 此值即判为重复 → `Noop`）
    ///
    /// 默认 0.92（对齐 2026 年外部调研的收敛做法）。
    pub dedup_threshold: f32,
    /// 跳过去重检查（强制写入；用于用户显式「记住这个」语义）
    pub skip_dedup: bool,
    /// 触发源（写入记忆的 `archive_reason`）
    pub source: Option<ArchiveSource>,
}

impl Default for MemoryWriteOptions {
    fn default() -> Self {
        Self {
            dedup_threshold: 0.92,
            skip_dedup: false,
            source: None,
        }
    }
}

/// 写入结果（A1 甲1）
#[derive(Debug, Clone, PartialEq)]
pub enum WriteOutcome {
    /// 新增成功
    Added {
        /// 新条目的钩子 ID
        hook_id: String,
    },
    /// 更新既有条目（本期未启用）
    Updated {
        /// 被更新的钩子 ID
        hook_id: String,
    },
    /// 调和：保留新旧双方并记录取代关系（甲2；本期未启用）
    Superseded {
        /// 被取代的旧条目
        old_hook_id: String,
        /// 取代它的新条目
        new_hook_id: String,
    },
    /// 未写入
    Noop {
        /// 未写入的原因
        reason: NoopReason,
    },
}

/// `Noop` 的原因（可解释性：写入为什么没发生）
#[derive(Debug, Clone, PartialEq)]
pub enum NoopReason {
    /// 写前检索命中相似条目
    Duplicate {
        /// 命中的既有条目
        matched_hook_id: String,
        /// 相似度评分
        score: f32,
    },
    /// 调用方显式声明无需写入
    Explicit,
    /// 目标不存在（Delete / Update 未命中）
    NotFound,
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
