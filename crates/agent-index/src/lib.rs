//! # agent-index：工作区文件检索索引（A2-2）
//!
//! [千万字级检索方案评定](../../../docs/plans/2026-08-30-千万字级检索方案评定.md) R1 的文件侧落地：
//! 把 workdir 下的文本/代码文件变成可被 `workspace_search` 混合检索的索引。
//!
//! ## 结构
//!
//! ```text
//! 扫描（scan_files） → 增量 diff（size+mtime） → 分块（chunk_text_for，按行累积+重叠+边界感知）
//!   → 关键词索引（Bm25Searcher，jieba 中文分词；内存）
//!   → 向量索引（SqliteVectorIndex，BLOB 持久化；后台渐进补齐）
//!   → 检索（关键词 ∪ 向量 → rrf_fusion，按 scope/type 过滤）
//! ```
//!
//! **边界感知分块**（R2 质量档）：按扩展名选择结构边界——Markdown 的 `#` 标题、
//! 代码的列 0 顶层声明（`fn` / `def` / `class` / `impl` / `export` …）——让切分点
//! 落在结构边界上而非固定字数处；**未识别类型退回 `Plain`，即 v1 行为不变**。
//!
//! ## 落点与隐私边界
//!
//! - **索引库落 app_data**（`{index_root}/{目录名}-{workdir 指纹}.db`）——不污染用户工作区，
//!   也不随工作区被提交/同步；删除索引目录即彻底清除。
//! - **内容外发边界**：仅「白名单扩展名 + 排除目录 + 单文件上限」内的文件文本会被分块，
//!   且**仅当启用语义检索（配置了 embedding 端点）时**块文本才会发往端点（向量通道）；
//!   未配置时纯本地 BM25（零外发）。
//!
//! ## 与 A2-1 的关系
//!
//! 复用同一语义供给面（`agent_memory::semantic::{SemanticConfig, GatedEmbedder}`）与同一
//! vendor 检索原语（BM25 / SqliteVectorIndex / rrf_fusion）——记忆侧与文件侧**同一套检索哲学**。

pub mod chunker;
pub mod index;
pub mod policy;

pub use chunker::{BoundaryHint, ChunkParams, RawChunk, chunk_text, chunk_text_for};
pub use index::{
    IndexStats, SyncReport, WorkspaceHit, WorkspaceIndex, get_or_open, registry_clear,
};
pub use policy::{FileEntry, IndexPolicy, scan_files};
