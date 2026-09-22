//! 工作区检索工具（A2-2）：`workspace_search`
//!
//! 对应 [千万字级检索方案评定](../../../docs/plans/2026-08-30-千万字级检索方案评定.md) R1 的
//! 文件侧出口：把会话工作区（workdir）下的文本/代码文件索引为可检索的块，提供
//! **混合检索**（BM25-jieba 关键词 + 向量语义 → RRF 融合）。
//!
//! ## 与既有两个工具的分工
//!
//! | 工具 | 通道 | 适用 |
//! |---|---|---|
//! | `grep` | 纯文本正则 | 精确符号 / 字面定位（保留不动） |
//! | `content_search`（前端桥） | 实体库 / 知识条目 | 结构化实体与知识 |
//! | **`workspace_search`** | 全文索引 + 语义 | 「这段资料在哪」/「谁讲过类似的话」/ 散文与代码的非精确检索 |
//!
//! ## 安全与隐私
//!
//! - **只读**：工具只检索，不写工作区任何文件。
//! - **范围收敛**：只读 workdir 下白名单扩展名（`IndexPolicy`；隐藏/构建/缓存目录与
//!   二进制一律跳过）；索引库落 app_data（不污染工作区）。
//! - **外发边界**：仅当启用语义检索（配置了 embedding 端点）时块文本才发往端点；
//!   未配置时纯本地 BM25（零外发）。向量通道不可用时自动降级关键词（含后台补齐提示）。

use std::path::PathBuf;
use std::sync::{Arc, RwLock};

use agent_index::{IndexPolicy, WorkspaceIndex, get_or_open};
use agent_memory::semantic::SemanticConfig;
use agent_runtime::tool::{SideEffectScope, Tool, ToolDescriptor, ToolError};
use agent_runtime::tool_context::ToolContext;
use async_trait::async_trait;
use serde_json::{Value, json};

use crate::AgentCommandService;

/// 单次返回的默认命中数 / 上限
const DEFAULT_TOP_K: usize = 8;
const MAX_TOP_K: usize = 20;

/// 工作区混合检索工具
pub struct WorkspaceSearchTool {
    /// 索引根（app_data；每 workdir 一个库文件）
    index_root: PathBuf,
    /// 共享语义配置（A2-1 同一供给面；`None` = 纯关键词模式）
    semantic: Arc<RwLock<Option<SemanticConfig>>>,
}

impl WorkspaceSearchTool {
    pub fn new(
        index_root: PathBuf,
        semantic: Arc<RwLock<Option<SemanticConfig>>>,
    ) -> Self {
        Self {
            index_root,
            semantic,
        }
    }

    /// 解析/打开会话 workdir 对应的索引
    async fn index_for(&self, ctx: &ToolContext) -> Result<Arc<WorkspaceIndex>, ToolError> {
        let workdir = ctx.workdir.clone().ok_or_else(|| {
            ToolError::Execution(
                "当前会话未绑定工作区（workdir），无法检索工作区文件。请先在项目/工作区模式下使用。"
                    .into(),
            )
        })?;
        let semantic = self
            .semantic
            .read()
            .ok()
            .and_then(|guard| guard.clone());
        get_or_open(&self.index_root, &workdir, IndexPolicy::default(), semantic)
            .await
            .map_err(ToolError::Execution)
    }
}

#[async_trait]
impl Tool for WorkspaceSearchTool {
    fn name(&self) -> &str {
        "workspace_search"
    }

    fn description(&self) -> &str {
        "检索当前工作区的文本/代码文件（混合检索：关键词 + 语义）。适用于「哪份资料讲过 X」\
         「谁提到过类似设定」「相关背景资料在哪」这类非精确检索——精确符号/字面定位请继续用 \
         grep（更快更准）。返回命中文件路径 + 行号区间 + 片段。只读；首次检索会建立/更新索引。"
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "检索意图（自然语言或关键词均可，如「曲率引擎的设定」）"
                },
                "scope": {
                    "type": "string",
                    "description": "可选：限定相对路径前缀（如 `考据/` 或 `src/`）"
                },
                "type": {
                    "type": "string",
                    "description": "可选：按扩展名限定（如 `md` / `rs`；不含点）"
                },
                "top_k": {
                    "type": "integer",
                    "description": "可选：返回条数（默认 8，上限 20）"
                }
            },
            "required": ["query"]
        })
    }
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor::read_only(self.name(), "search", self.description(), SideEffectScope::Workspace)
            .with_input_schema(self.parameters())
    }

    async fn execute(&self, args: Value) -> Result<Value, ToolError> {
        // 无上下文的直接调用：给明确指引（工具注册为带 ctx 版本，此分支仅防御）
        self.execute_with_ctx(&ToolContext::default(), args).await
    }

    async fn execute_with_ctx(
        &self,
        ctx: &ToolContext,
        args: Value,
    ) -> Result<Value, ToolError> {
        let query = args
            .get("query")
            .and_then(|v| v.as_str())
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| ToolError::Execution("缺少参数 query".into()))?
            .to_string();
        let scope = args
            .get("scope")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().trim_matches('/').to_string())
            .filter(|s| !s.is_empty());
        let ext = args
            .get("type")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let top_k = args
            .get("top_k")
            .and_then(|v| v.as_u64())
            .map(|v| (v as usize).clamp(1, MAX_TOP_K))
            .unwrap_or(DEFAULT_TOP_K);

        let index = self.index_for(ctx).await?;
        let hits = index
            .search(&query, top_k, scope.as_deref(), ext.as_deref())
            .await;
        let stats = index.stats();

        let mut out = json!({
            "query": query,
            "index": {
                "files": stats.files,
                "chunks": stats.chunks,
                "vectors": stats.vectors,
                "dim": stats.dim,
                "keywordReady": stats.keyword_ready,
                "keywordBuilt": stats.keyword_built,
            },
            "results": hits,
            "__meta": { "op": "workspace_search", "readonly": true },
        });
        // 提示的**优先级**：先报「索引未就绪」（冷启动，2026-09-13），再报空结果与向量补齐。
        // 模型据此知道「不是没有内容，是索引还在建」——避免误判工作区为空。
        if !stats.keyword_ready {
            out["note"] = json!(if hits.is_empty() {
                format!(
                    "工作区索引正在后台构建（已就绪 {}/{} 块）——首次检索需要一次全量构建，\
                     本次暂无结果，请稍后重试同一查询。",
                    stats.keyword_built, stats.chunks
                )
            } else {
                format!(
                    "工作区索引正在后台构建（已就绪 {}/{} 块）——本次结果来自语义通道，\
                     可能不完整；稍后重试可获得更全的结果。",
                    stats.keyword_built, stats.chunks
                )
            });
        } else if hits.is_empty() {
            let hint = if stats.files == 0 {
                "工作区内未发现可索引的文本/代码文件（或均被白名单/排除清单跳过）。"
            } else {
                "索引已就绪但无命中：可换关键词、放宽 scope/type，或确认目标内容是否在索引范围内。"
            };
            out["note"] = json!(hint);
        } else if stats.vectors == 0 && stats.dim > 0 {
            // 已启用语义但向量尚在后台补齐：本轮可能只走了关键词通道
            out["note"] = json!("语义向量索引正在后台建立，本次结果以关键词通道为主。");
        }
        Ok(out)
    }
}

impl AgentCommandService {
    /// 注册工作区检索工具（需索引根；幂等）
    ///
    /// 与记忆工具同策略：**注册无条件、可见性靠场景白名单**（`SYSTEM_BASE_TOOLS`
    /// 已含 `workspace_search`——跨场景通用检索能力）。无索引根时不注册。
    pub(crate) async fn register_workspace_tools(&self, bus: &dyn agent_runtime::tool::ToolBus) {
        if let Some(root) = &self.workspace_index_root {
            bus.register(Arc::new(WorkspaceSearchTool::new(
                root.clone(),
                self.semantic_config.clone(),
            )))
            .await;
        }
    }
}
