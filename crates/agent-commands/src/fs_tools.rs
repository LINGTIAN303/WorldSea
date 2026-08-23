//! 文件系统工具（FS tools）：read_file / write_file / list_directory / search_files / edit_file
//!
//! 详细见 docs/details/注释/agent-commands/fs.md
//!
//! # 设计背景
//! 阶段 1.4 之前 Agent 无法直接访问文件系统（只有 `execute_command` 能间接触达）。
//! 本模块用 `std::fs` 原生实现 5 个 FS 工具，并**覆写 [`Tool::execute_with_ctx`]**
//! （而非 `execute`），基于会话绑定的 [`ToolContext::workdir`] 解析相对路径，
//! 实现「工作区默认 cwd、写入越界拒绝」的安全约束。
//!
//! # 安全约束
//! - 读类（`read_file` / `list_directory` / `search_files`）：允许绝对路径，但 `search_files` 必须限定 workdir 内。
//! - 写类（`write_file` / `edit_file`）：解析后若越出 workdir（`!is_within_workdir`）直接拒绝。

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::UNIX_EPOCH;

use agent_runtime::tool::{Tool, ToolError};
use agent_runtime::tool_context::ToolContext;
use async_trait::async_trait;
use serde_json::{json, Value};

/// 默认搜索/列表根目录（未传 path 时使用）
const DEFAULT_ROOT: &str = ".";

// ─── 公共辅助函数 ────────────────────────────────────────────

/// 解析路径：相对路径基于 workdir，绝对路径原样返回
fn resolve_fs_path(ctx: &ToolContext, raw: &str) -> PathBuf {
    ctx.resolve_path(raw)
}

/// 校验路径是否落在 workdir 内（写类工具用；越界则拒绝）
///
/// # 规则
/// - `workdir` 为 `None` 时 `is_within_workdir` 恒为 true（无约束，放行）
/// - 否则解析后的绝对路径经词法归一化后必须 `starts_with(workdir)`
fn ensure_within_workdir(ctx: &ToolContext, path: &Path) -> Result<(), ToolError> {
    let raw = path.to_string_lossy();
    if !ctx.is_within_workdir(&raw) {
        return Err(ToolError::Execution(format!(
            "路径越出工作区，写入被拒绝: {}",
            path.display()
        )));
    }
    Ok(())
}

/// 取文件/目录的元数据大小（目录返回 0）
fn entry_size(meta: &std::fs::Metadata) -> u64 {
    if meta.is_file() {
        meta.len()
    } else {
        0
    }
}

/// 取修改时间（自 Unix 纪元起的秒数；失败返回 0）
fn entry_mtime(meta: &std::fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// 把 `__meta` 操作元数据合并进结果 value（前端 ToolRow 读它展示语义操作段）
///
/// 原则：`__meta` 是附加字段，不破坏原结果结构。若结果本就是 object 则直接
/// 插入 `__meta` 键；否则（纯字符串）包一层 `{ value: 原值, __meta }` 保持兼容。
/// 见 docs/details/注释/agent-commands/fs.md 与前端 toolSemantics.ts。
fn with_meta(result: Value, meta: Value) -> Value {
    if let Some(obj) = result.as_object() {
        let mut obj = obj.clone();
        obj.insert("__meta".to_string(), meta);
        Value::Object(obj)
    } else {
        json!({ "value": result, "__meta": meta })
    }
}

/// 简单通配符匹配（支持 `*` 匹配任意串、`?` 匹配单字符）
///
/// 用于 `search_files` 的文件名 glob 匹配。无外部 glob 依赖，
/// 采用带回溯的迭代算法（`*` 记住最近一次位置，失配时回退）。
fn wildcard_match(pattern: &str, text: &str) -> bool {
    let p: Vec<char> = pattern.chars().collect();
    let t: Vec<char> = text.chars().collect();
    let (mut pi, mut ti) = (0, 0);
    let (mut star, mut star_ti): (Option<usize>, usize) = (None, 0);
    while ti < t.len() {
        if pi < p.len() && (p[pi] == '?' || p[pi] == t[ti]) {
            pi += 1;
            ti += 1;
        } else if pi < p.len() && p[pi] == '*' {
            star = Some(pi);
            star_ti = ti;
            pi += 1;
        } else if let Some(sp) = star {
            pi = sp + 1;
            star_ti += 1;
            ti = star_ti;
        } else {
            return false;
        }
    }
    while pi < p.len() && p[pi] == '*' {
        pi += 1;
    }
    pi == p.len()
}

// ─── read_file ────────────────────────────────────────────

/// 读取文本文件工具
pub struct ReadFileTool;

#[async_trait]
impl Tool for ReadFileTool {
    fn name(&self) -> &str {
        "read_file"
    }
    fn description(&self) -> &str {
        "读取指定文本文件的内容。支持绝对路径或相对工作区的路径。"
    }
    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "要读取的文件路径（绝对或相对工作区）" }
            },
            "required": ["path"]
        })
    }
    async fn execute(&self, args: Value) -> Result<Value, ToolError> {
        self.execute_with_ctx(&ToolContext::default(), args).await
    }
    async fn execute_with_ctx(&self, ctx: &ToolContext, args: Value) -> Result<Value, ToolError> {
        let path = args
            .get("path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::ArgsParse("缺少 path 参数".into()))?;
        let resolved = resolve_fs_path(ctx, path);
        // 读类收敛：workdir 存在时越界默认拒绝（对齐写类 ensure_within_workdir 语义；
        // workdir 为 None 时 is_within_workdir 恒 true，放行绝对路径，向后兼容）
        let raw = resolved.to_string_lossy();
        if !ctx.is_within_workdir(&raw) {
            return Err(ToolError::Execution(format!(
                "拒绝读取路径在 workspace 之外: {}",
                resolved.display()
            )));
        }
        let content = std::fs::read_to_string(&resolved)
            .map_err(|e| ToolError::Execution(format!("读取文件失败 {}: {e}", resolved.display())))?;
        let path = resolved.to_string_lossy().to_string();
        Ok(with_meta(
            json!({ "content": content.clone(), "path": path.clone() }),
            json!({ "op": "read", "path": path, "size": content.len(), "lines": content.lines().count() }),
        ))
    }
}

// ─── write_file ────────────────────────────────────────────

/// 写入文本文件工具（自动创建父目录）
pub struct WriteFileTool;

#[async_trait]
impl Tool for WriteFileTool {
    fn name(&self) -> &str {
        "write_file"
    }
    fn description(&self) -> &str {
        "写入文本文件，若父目录不存在会自动创建。路径越出工作区会被拒绝。"
    }
    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "要写入的文件路径（绝对或相对工作区）" },
                "content": { "type": "string", "description": "要写入的文本内容" }
            },
            "required": ["path", "content"]
        })
    }
    async fn execute(&self, args: Value) -> Result<Value, ToolError> {
        self.execute_with_ctx(&ToolContext::default(), args).await
    }
    async fn execute_with_ctx(&self, ctx: &ToolContext, args: Value) -> Result<Value, ToolError> {
        let path = args
            .get("path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::ArgsParse("缺少 path 参数".into()))?;
        let content = args
            .get("content")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::ArgsParse("缺少 content 参数".into()))?;
        let resolved = resolve_fs_path(ctx, path);
        // 写入越界直接拒绝（安全约束）
        ensure_within_workdir(ctx, &resolved)?;
        // 自动创建父目录
        if let Some(parent) = resolved.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| ToolError::Execution(format!("创建父目录失败 {}: {e}", parent.display())))?;
        }
        std::fs::write(&resolved, content.as_bytes())
            .map_err(|e| ToolError::Execution(format!("写入文件失败 {}: {e}", resolved.display())))?;
        let bytes = content.len() as u64;
        let path = resolved.to_string_lossy().to_string();
        Ok(with_meta(
            json!({ "ok": true, "path": path.clone(), "bytes": bytes }),
            json!({ "op": "create", "path": path, "size": bytes }),
        ))
    }
}

// ─── list_directory ────────────────────────────────────────────

/// 列目录工具（支持递归）
pub struct ListDirectoryTool;

#[async_trait]
impl Tool for ListDirectoryTool {
    fn name(&self) -> &str {
        "list_directory"
    }
    fn description(&self) -> &str {
        "列出指定目录的内容。path 缺省为工作区根目录；recursive 为 true 时递归列出所有子项。"
    }
    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "要列出的目录路径（可选，默认工作区根目录）" },
                "recursive": { "type": "boolean", "description": "是否递归列出子目录（默认 false）" }
            }
        })
    }
    async fn execute(&self, args: Value) -> Result<Value, ToolError> {
        self.execute_with_ctx(&ToolContext::default(), args).await
    }
    async fn execute_with_ctx(&self, ctx: &ToolContext, args: Value) -> Result<Value, ToolError> {
        let raw = args
            .get("path")
            .and_then(|v| v.as_str())
            .unwrap_or(DEFAULT_ROOT);
        let recursive = args
            .get("recursive")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let resolved = resolve_fs_path(ctx, raw);
        // 读类收敛：workdir 存在时越界默认拒绝（拒绝递归列出外部目录；
        // workdir 为 None 时 is_within_workdir 恒 true，放行绝对路径，向后兼容）
        let resolved_raw = resolved.to_string_lossy();
        if !ctx.is_within_workdir(&resolved_raw) {
            return Err(ToolError::Execution(format!(
                "拒绝列出 workspace 之外的目录: {}",
                resolved.display()
            )));
        }
        if !resolved.is_dir() {
            return Err(ToolError::Execution(format!(
                "目录不存在或不是目录: {}",
                resolved.display()
            )));
        }
        let mut entries: Vec<Value> = Vec::new();
        collect_entries(&resolved, &resolved, recursive, &mut entries)?;
        let path = resolved.to_string_lossy().to_string();
        Ok(with_meta(
            json!({ "path": path.clone(), "entries": entries }),
            json!({ "op": "read", "path": path, "size": collect_entries_size(&resolved) }),
        ))
    }
}

/// 递归统计目录条目总数（供 list_directory 的 __meta 数量提示）
fn collect_entries_size(dir: &Path) -> usize {
    std::fs::read_dir(dir)
        .map(|rd| rd.flatten().map(|_| 1).sum())
        .unwrap_or(0)
}

/// 递归收集目录条目（base 用于计算相对路径；recursive=false 时只列当前层）
fn collect_entries(
    dir: &Path,
    base: &Path,
    recursive: bool,
    out: &mut Vec<Value>,
) -> Result<(), ToolError> {
    let rd = std::fs::read_dir(dir)
        .map_err(|e| ToolError::Execution(format!("读取目录失败 {}: {e}", dir.display())))?;
    for entry in rd {
        let entry = entry.map_err(|e| ToolError::Execution(format!("读取目录项失败: {e}")))?;
        let path = entry.path();
        let rel = path
            .strip_prefix(base)
            .unwrap_or(&path)
            .to_string_lossy()
            .to_string();
        let meta = entry
            .metadata()
            .map_err(|e| ToolError::Execution(format!("读取元数据失败 {}: {e}", path.display())))?;
        let ftype = if meta.is_dir() { "dir" } else { "file" };
        out.push(json!({
            "name": rel,
            "type": ftype,
            "size": entry_size(&meta),
            "mtime": entry_mtime(&meta),
        }));
        if recursive && meta.is_dir() {
            collect_entries(&path, base, recursive, out)?;
        }
    }
    Ok(())
}

// ─── search_files ────────────────────────────────────────────

/// 按文件名/内容搜索文件工具（限定 workdir 内）
pub struct SearchFilesTool;

#[async_trait]
impl Tool for SearchFilesTool {
    fn name(&self) -> &str {
        "search_files"
    }
    fn description(&self) -> &str {
        "在工作区内按文件名（glob，支持 * 和 ?）或文件内容子串搜索文件。搜索结果限定在 workdir 内。"
    }
    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "pattern": { "type": "string", "description": "文件名匹配模式（glob，支持 * 和 ?）" },
                "query": { "type": "string", "description": "可选：文件内容子串匹配（有值时额外按内容搜索）" },
                "path": { "type": "string", "description": "可选：搜索起始目录（默认工作区根目录，必须限定在 workdir 内）" }
            },
            "required": ["pattern"]
        })
    }
    async fn execute(&self, args: Value) -> Result<Value, ToolError> {
        self.execute_with_ctx(&ToolContext::default(), args).await
    }
    async fn execute_with_ctx(&self, ctx: &ToolContext, args: Value) -> Result<Value, ToolError> {
        let pattern = args
            .get("pattern")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::ArgsParse("缺少 pattern 参数".into()))?;
        let query = args.get("query").and_then(|v| v.as_str());
        let raw = args
            .get("path")
            .and_then(|v| v.as_str())
            .unwrap_or(DEFAULT_ROOT);
        let base = resolve_fs_path(ctx, raw);
        // 搜索必须限定 workdir 内（越界返回错误）
        let base_raw = base.to_string_lossy();
        if !ctx.is_within_workdir(&base_raw) {
            return Err(ToolError::Execution(format!(
                "搜索路径越出工作区，已被拒绝: {}",
                base.display()
            )));
        }
        if !base.is_dir() {
            return Err(ToolError::Execution(format!(
                "目录不存在或不是目录: {}",
                base.display()
            )));
        }
        let mut matches: Vec<Value> = Vec::new();
        search_walk(&base, pattern, query, &mut matches)?;
        Ok(with_meta(
            json!({ "matches": matches }),
            json!({ "op": "search", "path": base.to_string_lossy(), "pattern": pattern, "hits": matches.len() }),
        ))
    }
}

/// 递归搜索目录：按文件名 pattern 匹配；有 query 时再按内容子串匹配
fn search_walk(
    dir: &Path,
    pattern: &str,
    query: Option<&str>,
    matches: &mut Vec<Value>,
) -> Result<(), ToolError> {
    let rd = std::fs::read_dir(dir)
        .map_err(|e| ToolError::Execution(format!("读取目录失败 {}: {e}", dir.display())))?;
    for entry in rd {
        let entry = entry.map_err(|e| ToolError::Execution(format!("读取目录项失败: {e}")))?;
        let path = entry.path();
        let meta = entry
            .metadata()
            .map_err(|e| ToolError::Execution(format!("读取元数据失败 {}: {e}", path.display())))?;
        let is_dir = meta.is_dir();
        let ftype = if is_dir { "dir" } else { "file" };
        let fname = entry.file_name().to_string_lossy().to_string();
        // 1) 文件名 glob 匹配
        let mut matched = wildcard_match(pattern, &fname);
        // 2) 文件名未命中且带内容查询时，按文件内容子串匹配
        if !matched {
            if let Some(q) = query {
                if !is_dir {
                    if let Ok(content) = std::fs::read_to_string(&path) {
                        if content.contains(q) {
                            matched = true;
                        }
                    }
                }
            }
        }
        if matched {
            matches.push(json!({ "path": path.to_string_lossy(), "type": ftype }));
        }
        if is_dir {
            search_walk(&path, pattern, query, matches)?;
        }
    }
    Ok(())
}

// ─── edit_file ────────────────────────────────────────────

/// 编辑文件工具：读 → 精确替换 → 写回
pub struct EditFileTool;

#[async_trait]
impl Tool for EditFileTool {
    fn name(&self) -> &str {
        "edit_file"
    }
    fn description(&self) -> &str {
        "读取文本文件，将 old_string 精确替换为 new_string 后写回。路径越出工作区会被拒绝。"
    }
    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "要编辑的文件路径（绝对或相对工作区）" },
                "old_string": { "type": "string", "description": "要被替换的原始文本" },
                "new_string": { "type": "string", "description": "替换后的新文本" }
            },
            "required": ["path", "old_string", "new_string"]
        })
    }
    async fn execute(&self, args: Value) -> Result<Value, ToolError> {
        self.execute_with_ctx(&ToolContext::default(), args).await
    }
    async fn execute_with_ctx(&self, ctx: &ToolContext, args: Value) -> Result<Value, ToolError> {
        let path = args
            .get("path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::ArgsParse("缺少 path 参数".into()))?;
        let old_string = args
            .get("old_string")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::ArgsParse("缺少 old_string 参数".into()))?;
        let new_string = args
            .get("new_string")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::ArgsParse("缺少 new_string 参数".into()))?;
        let resolved = resolve_fs_path(ctx, path);
        // 写入越界直接拒绝（安全约束）
        ensure_within_workdir(ctx, &resolved)?;
        let content = std::fs::read_to_string(&resolved)
            .map_err(|e| ToolError::Execution(format!("读取文件失败 {}: {e}", resolved.display())))?;
        // 找不到 old_string 时返回错误，避免静默无操作
        if !content.contains(old_string) {
            return Err(ToolError::Execution(format!(
                "未在文件 {} 中找到要替换的 old_string",
                resolved.display()
            )));
        }
        let replacements = content.matches(old_string).count();
        let new_content = content.replace(old_string, new_string);
        std::fs::write(&resolved, new_content.as_bytes())
            .map_err(|e| ToolError::Execution(format!("写入文件失败 {}: {e}", resolved.display())))?;
        let path = resolved.to_string_lossy().to_string();
        let additions = new_string.matches('\n').count() as u64;
        let deletions = old_string.matches('\n').count() as u64;
        Ok(with_meta(
            json!({ "ok": true, "path": path.clone(), "replacements": replacements }),
            json!({ "op": "edit", "path": path, "replacements": replacements, "additions": additions, "deletions": deletions }),
        ))
    }
}

// ─── 注册入口 ────────────────────────────────────────────

/// 构建并注册全部文件系统工具到工具总线
///
/// 调用方：`AgentCommandService::new_agent`，在注册 terminal 工具之后调用。
/// 全部工具覆写 `execute_with_ctx`，基于 `ToolContext.workdir` 解析相对路径。
pub async fn register_fs_tools(bus: &dyn agent_runtime::tool::ToolBus) {
    bus.register(Arc::new(ReadFileTool)).await;
    bus.register(Arc::new(WriteFileTool)).await;
    bus.register(Arc::new(ListDirectoryTool)).await;
    bus.register(Arc::new(SearchFilesTool)).await;
    bus.register(Arc::new(EditFileTool)).await;
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 构造一个指向临时目录的 ToolContext
    fn ctx_for(dir: &Path) -> ToolContext {
        ToolContext {
            workdir: Some(dir.to_path_buf()),
            project_id: None,
            workspace_id: None,
        }
    }

    #[test]
    fn wildcard_matches() {
        assert!(wildcard_match("*.rs", "main.rs"));
        assert!(wildcard_match("a?c", "abc"));
        assert!(!wildcard_match("*.rs", "main.txt"));
        assert!(wildcard_match("*", "anything"));
    }

    #[tokio::test]
    async fn write_then_read_file() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = ctx_for(dir.path());
        let tool = WriteFileTool;
        let res = tool
            .execute_with_ctx(&ctx, json!({ "path": "sub/a.txt", "content": "hello" }))
            .await
            .unwrap();
        assert_eq!(res["ok"], true);
        assert_eq!(res["bytes"], 5);

        let read = ReadFileTool
            .execute_with_ctx(&ctx, json!({ "path": "sub/a.txt" }))
            .await
            .unwrap();
        assert_eq!(read["content"], "hello");
    }

    #[tokio::test]
    async fn write_outside_workdir_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = ctx_for(dir.path());
        let outside = dir.path().parent().unwrap().join("outside.txt");
        let res = WriteFileTool
            .execute_with_ctx(&ctx, json!({ "path": outside.to_string_lossy(), "content": "x" }))
            .await;
        assert!(res.is_err());
    }

    #[tokio::test]
    async fn read_absolute_outside_workdir_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = ctx_for(dir.path());
        // 写一个外部文件再用绝对路径读 → 读类越界默认拒绝
        let outside = dir.path().parent().unwrap().join("outside_read.txt");
        std::fs::write(&outside, "secret").unwrap();
        let res = ReadFileTool
            .execute_with_ctx(&ctx, json!({ "path": outside.to_string_lossy() }))
            .await;
        assert!(res.is_err(), "workdir 存在时绝对路径越界读取应被拒绝");
        let _ = std::fs::remove_file(&outside);
    }

    #[tokio::test]
    async fn read_absolute_allowed_when_no_workdir() {
        // 向后兼容：workdir 为 None 时放行绝对路径读取
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("compat.txt");
        std::fs::write(&f, "hi").unwrap();
        let ctx = ToolContext::default();
        let res = ReadFileTool
            .execute_with_ctx(&ctx, json!({ "path": f.to_string_lossy() }))
            .await;
        assert!(res.is_ok(), "workdir 为 None 时应放行绝对路径读取");
        assert_eq!(res.unwrap()["content"], "hi");
    }

    #[tokio::test]
    async fn list_absolute_outside_workdir_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = ctx_for(dir.path());
        let outside = dir.path().parent().unwrap();
        let res = ListDirectoryTool
            .execute_with_ctx(&ctx, json!({ "path": outside.to_string_lossy() }))
            .await;
        assert!(res.is_err(), "workdir 存在时列出外部目录应被拒绝");
    }

    #[tokio::test]
    async fn list_directory_non_recursive() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.txt"), "a").unwrap();
        std::fs::create_dir(dir.path().join("sub")).unwrap();
        let ctx = ctx_for(dir.path());
        let res = ListDirectoryTool
            .execute_with_ctx(&ctx, json!({ "path": "." }))
            .await
            .unwrap();
        let entries = res["entries"].as_array().unwrap();
        assert!(entries.iter().any(|e| e["name"] == "a.txt" && e["type"] == "file"));
        assert!(entries.iter().any(|e| e["name"] == "sub" && e["type"] == "dir"));
    }

    #[tokio::test]
    async fn search_files_by_name() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("main.rs"), "fn main() {}").unwrap();
        std::fs::write(dir.path().join("main.txt"), "hello").unwrap();
        let ctx = ctx_for(dir.path());
        let res = SearchFilesTool
            .execute_with_ctx(&ctx, json!({ "pattern": "*.rs" }))
            .await
            .unwrap();
        let matches = res["matches"].as_array().unwrap();
        assert_eq!(matches.len(), 1);
        assert!(matches[0]["path"].as_str().unwrap().ends_with("main.rs"));
    }

    #[tokio::test]
    async fn search_files_by_content() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("note.md"), "TODO fix bug").unwrap();
        let ctx = ctx_for(dir.path());
        let res = SearchFilesTool
            .execute_with_ctx(&ctx, json!({ "pattern": "nonexistent", "query": "TODO" }))
            .await
            .unwrap();
        let matches = res["matches"].as_array().unwrap();
        assert_eq!(matches.len(), 1);
    }

    #[tokio::test]
    async fn edit_file_replaces() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("b.txt"), "foo bar foo").unwrap();
        let ctx = ctx_for(dir.path());
        let res = EditFileTool
            .execute_with_ctx(&ctx, json!({ "path": "b.txt", "old_string": "foo", "new_string": "baz" }))
            .await
            .unwrap();
        assert_eq!(res["replacements"], 2);
        let content = std::fs::read_to_string(dir.path().join("b.txt")).unwrap();
        assert_eq!(content, "baz bar baz");
    }

    #[tokio::test]
    async fn edit_file_not_found_returns_error() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("c.txt"), "hello").unwrap();
        let ctx = ctx_for(dir.path());
        let res = EditFileTool
            .execute_with_ctx(&ctx, json!({ "path": "c.txt", "old_string": "missing", "new_string": "x" }))
            .await;
        assert!(res.is_err());
    }

    #[tokio::test]
    async fn results_attach_meta_without_breaking_fields() {
        // 事件流丰富化：写/读/编辑/搜索结果都带 __meta（op/path/效果字段），且原字段不被破坏
        let dir = tempfile::tempdir().unwrap();
        let ctx = ctx_for(dir.path());

        // 写：__meta.op == create，原字段 ok/bytes 保留
        let w = WriteFileTool
            .execute_with_ctx(&ctx, json!({ "path": "meta.txt", "content": "hello\nworld" }))
            .await
            .unwrap();
        assert_eq!(w["ok"], true);
        assert_eq!(w["bytes"], 11);
        assert_eq!(w["__meta"]["op"], "create");
        assert!(w["__meta"]["path"].as_str().unwrap().ends_with("meta.txt"));

        // 读：__meta.op == read，带 lines，原字段 content 保留
        let r = ReadFileTool
            .execute_with_ctx(&ctx, json!({ "path": "meta.txt" }))
            .await
            .unwrap();
        assert_eq!(r["content"], "hello\nworld");
        assert_eq!(r["__meta"]["op"], "read");
        assert_eq!(r["__meta"]["lines"], 2);

        // 编辑：__meta.op == edit，带 replacements，原字段保留
        let e = EditFileTool
            .execute_with_ctx(&ctx, json!({ "path": "meta.txt", "old_string": "world", "new_string": "x\ny" }))
            .await
            .unwrap();
        assert_eq!(e["replacements"], 1);
        assert_eq!(e["__meta"]["op"], "edit");
        assert_eq!(e["__meta"]["additions"], 1);
        assert_eq!(e["__meta"]["deletions"], 0);

        // 搜索：__meta.op == search，带 hits，原字段 matches 保留
        let s = SearchFilesTool
            .execute_with_ctx(&ctx, json!({ "pattern": "*.txt" }))
            .await
            .unwrap();
        assert!(s["matches"].as_array().unwrap().len() >= 1);
        assert_eq!(s["__meta"]["op"], "search");
        assert!(s["__meta"]["hits"].as_u64().unwrap() >= 1);
    }
}
