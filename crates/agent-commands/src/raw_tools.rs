//! 记忆原文读工具（A1 己1① 的取回面）：`memory_read_raw`
//!
//! 对应 [A1 记忆系统设计](../../../docs/plans/2026-09-11-A1-记忆系统设计.md) §6.3.3。
//!
//! ## 为什么需要这个工具
//!
//! 超长工具结果在**入历史之前**被截断（保头 + 保尾），消息里只留：
//!
//! ```text
//! …[已截断，省略 12345 字节；原文已外置：raw/ab12cd34ef567890]…
//! ```
//!
//! 完整原文已落到 `{记忆根}/raw/{坐标}.txt`。Agent 需要全文时（例如截断的中段
//! 恰好含它要的报错栈），用本工具**按坐标取回**——这就是把「内容丢失」降级为
//! 「位置丢失」的兑现环节。
//!
//! ## 安全边界（设计 §6.3.3 五条硬约束里的三条直接落在这里）
//!
//! | # | 约束 | 本工具的做法 |
//! |---|---|---|
//! | 1 | 目录硬隔离 | 只经 `RawStore` 访问 `{记忆根}/raw/`，**不接任何路径参数**（无路径拼接 = 无穿越面） |
//! | 2 | LLM 只读 | **只有读**。工具集里不存在对应的写工具——Agent 无法篡改原始轨迹 |
//! | 3 | 大小闸门 | 坐标非法 / 内容不存在 / 超过返回上限 → 明确报错，**不返回半截内容** |
//!
//! ## 为什么只接受坐标、不接受路径
//!
//! 若允许传路径，本工具就成了「读取 app_data 任意文件」的后门——那会绕开
//! 工作区权限模型（P0/P1）对文件访问的约束。只接受**16 位十六进制坐标**，
//! 使可读范围被**硬收敛**到外置目录内的内容寻址文件。

use std::sync::Arc;

use agent_runtime::raw_context::parse_externalized_hash;
use agent_runtime::tool::{SideEffectScope, Tool, ToolDescriptor, ToolError};
use async_trait::async_trait;
use serde_json::{json, Value};

use crate::{AgentCommandService, CommandError};

/// 单次返回的字符上限（超过则截断并提示）
///
/// 取值远大于 `clamp_tool_result` 的 12 KB：取回的原文本身还会再经一次工具结果
/// 裁剪（保头 + 保尾）——那是**预期行为**，本上限只防止把 32 MiB 的文件整体灌进
/// 一次工具返回（某些 provider 对单条消息体积有硬限制）。
pub const RAW_READ_MAX_CHARS: usize = 512 * 1024;

/// 一次原文取回的切片结果（工具结果与 Tauri 命令共用同一形状）
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawSlice {
    /// 已解析出的内容坐标（16 位十六进制）
    pub content_hash: String,
    /// 本次返回的内容片段
    pub content: String,
    /// 原文总字符数
    pub total_chars: usize,
    /// 本片段起始字符位
    pub from: usize,
    /// 是否还有后续片段
    pub truncated: bool,
    /// 续读游标（无后续为 None）
    pub next_from: Option<usize>,
}

/// 按坐标取回外置原文（分段）——`memory_read_raw` 工具与 Tauri 命令的**唯一实现**
///
/// 安全边界见模块头：只接受 16 位十六进制坐标（或含标注的整段文本，尽力解析）、
/// 内容不存在即报错（含回收提示，不返回半截内容）、单次上限 [`RAW_READ_MAX_CHARS`]。
pub fn read_raw_paged(
    memory_root: &std::path::Path,
    raw_hash: &str,
    from: Option<u64>,
    max_chars: Option<u64>,
) -> Result<RawSlice, String> {
    let raw_hash = raw_hash.trim();
    // 容错：调用方可能把整段标注贴进来（模型常见行为），此处尽力解析出坐标
    let hash = if agent_memory::raw_store::is_valid_hash(raw_hash) {
        raw_hash.to_string()
    } else if let Some(parsed) = parse_externalized_hash(raw_hash) {
        parsed
    } else {
        return Err(format!("内容坐标非法（应为 16 位十六进制）: {raw_hash}"));
    };

    // 打开外置目录（失败即报错，不静默返回空）
    let store = agent_memory::raw_store::RawStore::open(memory_root)
        .map_err(|e| format!("无法访问记忆原文目录: {e}"))?;

    let full = store.read(&hash).ok_or_else(|| {
        format!("未找到该坐标对应的原文（可能已超出保留期被回收）: {hash}")
    })?;

    let total_chars = full.chars().count();
    let from = from.unwrap_or(0) as usize;
    let max_chars = max_chars
        .map(|v| (v as usize).min(RAW_READ_MAX_CHARS))
        .unwrap_or(RAW_READ_MAX_CHARS);

    let slice: String = full.chars().skip(from).take(max_chars).collect();
    let returned_chars = slice.chars().count();
    let truncated = from + returned_chars < total_chars;

    Ok(RawSlice {
        content_hash: hash,
        content: slice,
        total_chars,
        from,
        truncated,
        next_from: if truncated {
            Some(from + returned_chars)
        } else {
            None
        },
    })
}

/// 记忆原文读工具
pub struct MemoryReadRawTool {
    /// 记忆根目录（`{app_data}/worldsea/memory`）
    ///
    /// 直接用根而非 `RawStore` 实例：工具的构造发生在装配层，而 `RawStore::open`
    /// 可能失败（目录不可写）。此处存根、在调用时打开——**打开失败即报错**，
    /// 不会静默返回空内容（那会让 Agent 误以为「原文是空的」）。
    memory_root: std::path::PathBuf,
}

impl MemoryReadRawTool {
    /// 构造（记忆根）
    pub fn new(memory_root: impl Into<std::path::PathBuf>) -> Self {
        Self {
            memory_root: memory_root.into(),
        }
    }
}

#[async_trait]
impl Tool for MemoryReadRawTool {
    fn name(&self) -> &str {
        "memory_read_raw"
    }

    fn description(&self) -> &str {
        "取回被截断内容的完整原文。当工具结果中出现「原文已外置：raw/<坐标>」标注时，\
         用该坐标调用本工具可读回被截断的完整内容（标注里的中段因体积原因未进入上下文，\
         但原文已完整保存）。只读，不可修改。"
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "content_hash": {
                    "type": "string",
                    "description": "内容坐标：截断标注中 `原文已外置：raw/` 之后的 16 位十六进制串"
                },
                "from": {
                    "type": "integer",
                    "description": "可选：从第几个字符开始返回（默认 0）。用于分段读取超长原文"
                },
                "max_chars": {
                    "type": "integer",
                    "description": "可选：本次最多返回多少字符（默认全部，上限 524288）"
                }
            },
            "required": ["content_hash"]
        })
    }
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor::read_only(self.name(), "memory", self.description(), SideEffectScope::Session)
            .with_input_schema(self.parameters())
    }

    async fn execute(&self, args: Value) -> Result<Value, ToolError> {
        let raw_hash = args
            .get("content_hash")
            .and_then(|v| v.as_str())
            .map(|s| s.trim())
            .ok_or_else(|| ToolError::Execution("缺少参数 content_hash".into()))?;
        let from = args.get("from").and_then(|v| v.as_u64());
        let max_chars = args.get("max_chars").and_then(|v| v.as_u64());

        let slice = read_raw_paged(&self.memory_root, raw_hash, from, max_chars)
            .map_err(ToolError::Execution)?;

        Ok(json!({
            "content_hash": slice.content_hash,
            "content": slice.content,
            "total_chars": slice.total_chars,
            "from": slice.from,
            "truncated": slice.truncated,
            "next_from": slice.next_from,
            "__meta": { "op": "memory_read_raw", "readonly": true },
        }))
    }
}

impl AgentCommandService {
    /// 注册记忆原文读工具（有记忆根时；幂等）
    ///
    /// 与 terminal / fs 工具组同层：都是「会话可见的原生工具」，但本工具**只读**，
    /// 且作用域被收敛到外置原文目录（见模块头「安全边界」）。
    pub(crate) async fn register_memory_raw_tools(&self, bus: &dyn agent_runtime::tool::ToolBus) {
        if let Some(root) = &self.memory_root {
            bus.register(Arc::new(MemoryReadRawTool::new(root.clone())))
                .await;
        }
    }

    /// 按坐标取回外置原文（分段）—— R3 会话日志面板「查看原文」的命令入口
    ///
    /// 与 [`MemoryReadRawTool`] 共用 [`read_raw_paged`] 唯一实现：安全边界
    /// （坐标白名单 / 不存在即报错 / 上限）与工具完全一致，不给 UI 开后门。
    pub fn read_raw_content(
        &self,
        raw_hash: &str,
        from: Option<u64>,
        max_chars: Option<u64>,
    ) -> Result<RawSlice, CommandError> {
        let Some(root) = &self.memory_root else {
            return Err(CommandError::Internal(
                "记忆根目录未配置，无法取回原文".into(),
            ));
        };
        read_raw_paged(root, raw_hash, from, max_chars).map_err(CommandError::Internal)
    }
}

// ─── 测试 ────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn reads_back_externalized_content_by_hash() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_path_buf();
        let store = agent_memory::raw_store::RawStore::open(&root).unwrap();
        let original = "被截断的完整原文：中段内容在这里".repeat(50);
        let hash = store.store(&original).unwrap().content_hash;

        let tool = MemoryReadRawTool::new(root);
        let out = tool
            .execute(json!({ "content_hash": hash }))
            .await
            .expect("应能读回");

        assert_eq!(out["content"].as_str().unwrap(), original);
        assert_eq!(out["total_chars"].as_u64().unwrap() as usize, original.chars().count());
        assert_eq!(out["truncated"], false);
        assert!(out["next_from"].is_null());
        assert_eq!(out["__meta"]["readonly"], true);
    }

    #[tokio::test]
    async fn accepts_full_marker_text_not_just_bare_hash() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_path_buf();
        let store = agent_memory::raw_store::RawStore::open(&root).unwrap();
        let hash = store.store("内容").unwrap().content_hash;

        let tool = MemoryReadRawTool::new(root);
        // 模型常把整段标注贴进来 —— 应能容错解析
        let pasted = format!("…[已截断，省略 99 字节；原文已外置：raw/{hash}]…");
        let out = tool.execute(json!({ "content_hash": pasted })).await.unwrap();
        assert_eq!(out["content"].as_str().unwrap(), "内容");
    }

    #[tokio::test]
    async fn paging_returns_slices_with_next_cursor() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_path_buf();
        let store = agent_memory::raw_store::RawStore::open(&root).unwrap();
        let original = "0123456789".repeat(20); // 200 字符
        let hash = store.store(&original).unwrap().content_hash;
        let tool = MemoryReadRawTool::new(root);

        let p1 = tool
            .execute(json!({ "content_hash": hash, "max_chars": 80 }))
            .await
            .unwrap();
        assert_eq!(p1["content"].as_str().unwrap().chars().count(), 80);
        assert_eq!(p1["truncated"], true);
        assert_eq!(p1["next_from"], 80);

        let p2 = tool
            .execute(json!({ "content_hash": hash, "from": 80, "max_chars": 80 }))
            .await
            .unwrap();
        assert_eq!(p2["from"], 80);
        // 两段拼接应还原原文前缀
        let joined = format!(
            "{}{}",
            p1["content"].as_str().unwrap(),
            p2["content"].as_str().unwrap()
        );
        assert!(original.starts_with(&joined));
    }

    #[tokio::test]
    async fn rejects_invalid_hash_and_missing_content() {
        let dir = tempfile::tempdir().unwrap();
        let tool = MemoryReadRawTool::new(dir.path().to_path_buf());

        // 路径形态的输入必须被拒（防穿越）
        let err = tool
            .execute(json!({ "content_hash": "../../etc/passwd" }))
            .await
            .unwrap_err();
        assert!(err.to_string().contains("非法"), "应报坐标非法: {err}");

        // 合法但不存在
        let err = tool
            .execute(json!({ "content_hash": "0123456789abcdef" }))
            .await
            .unwrap_err();
        assert!(err.to_string().contains("未找到"), "应报未找到: {err}");

        // 缺参数
        let err = tool.execute(json!({})).await.unwrap_err();
        assert!(err.to_string().contains("content_hash"));
    }

    #[test]
    fn tool_metadata_declares_readonly_scope() {
        let tool = MemoryReadRawTool::new(".");
        assert_eq!(tool.name(), "memory_read_raw");
        assert!(tool.description().contains("只读"), "描述须明示只读");
        let params = tool.parameters();
        assert_eq!(params["required"][0], "content_hash");
        // 参数里**没有任何路径类字段**（安全边界的结构性保证）
        let props = params["properties"].as_object().unwrap();
        assert!(props.contains_key("content_hash"));
        assert_eq!(props.len(), 3, "只应有 content_hash/from/max_chars");
    }
}
