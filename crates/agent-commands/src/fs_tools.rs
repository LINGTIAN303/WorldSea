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
use regex::Regex;
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

// ── 任务29/E1：项目数据区写保护（Rust 原生工具组版） ─────────────
//
// 背景：统一根后项目实体真身落盘 `{workdir}/entities/`，平台元数据在
// `{workdir}/.worldsmith/`。Agent 裸写/删除这些文件会经 fs_watch 回流成真实
// 数据丢失——实体变更必须走语义层（FrontendToolBridge 的 entity_* 工具）。
// 注意：本模块与 terminal.rs 的防护是**运行时真实链路**（Rust 主循环的
// FS/terminal 工具组）；packages/agent-runtime 的 TS 版 workspace-boundary
// 仅服务 TS 工具时代/桥路径，两层语义保持对齐。

/// E1 受保护一级子目录名（实体数据区 + 平台元数据区）
pub const PROTECTED_DIR_NAMES: [&str; 2] = ["entities", ".worldsmith"];

/// E1 拒绝消息（引导模型走实体语义层）
pub const PROTECTED_WRITE_ERROR: &str =
    "拒绝：该路径位于项目数据区（entities/ 或 .worldsmith/），Agent 不可直接写入、移动或删除。\
     实体数据请使用语义工具（entity_create / entity_update / entity_delete / content_search）操作。";

/// E1 判定：解析后的路径是否落在 workdir 的受保护一级子目录内（大小写不敏感）
///
/// 受保护目录本身（如 `{workdir}/entities`）同样命中——对目录本身的写/删同样危险。
pub fn is_protected_project_path(workdir: &Path, path: &Path) -> bool {
    let Ok(rel) = path.strip_prefix(workdir) else {
        return false;
    };
    let Some(first) = rel.components().next() else {
        return false;
    };
    let first = first.as_os_str().to_string_lossy().to_lowercase();
    PROTECTED_DIR_NAMES.iter().any(|name| first == *name)
}

/// E1 写守卫：workdir 存在且解析路径命中受保护目录 → 拒绝（写类工具统一入口）
pub fn ensure_not_protected(ctx: &ToolContext, path: &Path) -> Result<(), ToolError> {
    if let Some(workdir) = &ctx.workdir {
        if is_protected_project_path(workdir, path) {
            return Err(ToolError::Execution(PROTECTED_WRITE_ERROR.to_string()));
        }
    }
    Ok(())
}

/// shell 写操作词（覆盖常见 shell/PowerShell 删除/移动/重定向/写入指令）
///
/// 子串匹配（含前后空格语境），非词边界精确——少量误报可接受（宁误拦不错放）。
fn shell_has_write_hint(lower_command: &str) -> bool {
    const WORDS: [&str; 15] = [
        "rm ", "del ", "erase", "rmdir", "remove-item", "move-item", "rename-item", "mv ",
        "set-content", "add-content", "out-file", "new-item", "copy-item", "tee-object", "cp ",
    ];
    WORDS.iter().any(|w| lower_command.contains(w)) || lower_command.contains('>')
}

/// shell 词法防护：命令串同现写操作词与受保护目录字样 → 判定触碰（E1 盲区收敛）
///
/// - `workdir` 为 `Some`：规则一（相对字样）+ 规则二（`{workdir}/entities|.worldsmith` 子串）
/// - `workdir` 为 `None`：仅规则一（无从锚定绝对路径）
///
/// **非完备声明**：变量间接、别名、子串拼接可绕过——定位是拦截常见误操作并引导
/// 语义层，不能替代用户监督（方案文档 §六 已记录接受该残余风险）。
pub fn shell_command_touches_protected_path(workdir: Option<&Path>, command: &str) -> bool {
    if command.is_empty() {
        return false;
    }
    let lower = command.to_lowercase();
    if !shell_has_write_hint(&lower) {
        return false;
    }
    // 规则一：相对保护目录字样（entities/ 或 .worldsmith/，兼容双分隔符）
    const PROTECTED_HINTS: [&str; 4] = ["entities/", "entities\\", ".worldsmith/", ".worldsmith\\"];
    if PROTECTED_HINTS.iter().any(|h| lower.contains(h)) {
        return true;
    }
    // 规则二：绝对保护路径（workdir 归一 + /entities|.worldsmith 子串）
    if let Some(workdir) = workdir {
        let w = workdir.to_string_lossy().replace('\\', "/").to_lowercase();
        let n = lower.replace('\\', "/");
        if n.contains(&format!("{w}/entities")) || n.contains(&format!("{w}/.worldsmith")) {
            return true;
        }
    }
    false
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

/// 读取文本文件工具（支持按行分页 offset/limit + 大文件自动截断)
pub struct ReadFileTool;

#[async_trait]
impl Tool for ReadFileTool {
    fn name(&self) -> &str {
        "read_file"
    }
    fn description(&self) -> &str {
        "读取指定文本文件的内容。支持绝对路径或相对工作区的路径；可按行分页读取（offset 起始行 / limit 行数），大文件自动截断并提示用 offset 继续。"
    }
    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "要读取的文件路径（绝对或相对工作区）" },
                "offset": { "type": "integer", "description": "从第几行开始读取（0 起计，默认 0）" },
                "limit": { "type": "integer", "description": "最多读取多少行（默认自动截断上限，见 truncated）" }
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
        let offset = args
            .get("offset")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as usize;
        let limit = args.get("limit").and_then(|v| v.as_u64()).map(|n| n as usize);
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
        // 按行分页：offset/limit + 无 limit 时的默认截断上限（大文件保护）
        const DEFAULT_MAX_LINES: usize = 2000;
        let total_lines = content.lines().count();
        let begin = offset.min(total_lines);
        let effective_limit = limit.unwrap_or(DEFAULT_MAX_LINES);
        let end = (begin + effective_limit).min(total_lines);
        // truncated：还有更多行未返回（提示用 offset=end 继续）
        let truncated = end < total_lines;
        let page = content.lines().skip(begin).take(end - begin).collect::<Vec<_>>().join("\n");
        let path = resolved.to_string_lossy().to_string();
        Ok(with_meta(
            json!({
                "content": page,
                "path": path.clone(),
                "offset": begin,
                "lines_returned": end - begin,
                "total_lines": total_lines,
                "truncated": truncated,
            }),
            json!({
                "op": "read",
                "path": path,
                "size": content.len(),
                "lines": total_lines,
                "offset": begin,
                "limit": end - begin,
                "truncated": truncated,
            }),
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
        // 任务29/E1：项目数据区（entities/.worldsmith）裸写拒绝，须经实体语义层
        ensure_not_protected(ctx, &resolved)?;
        // 自动创建父目录
        if let Some(parent) = resolved.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| ToolError::Execution(format!("创建父目录失败 {}: {e}", parent.display())))?;
        }
        std::fs::write(&resolved, content.as_bytes())
            .map_err(|e| ToolError::Execution(format!("写入文件失败 {}: {e}", resolved.display())))?;
        let bytes = content.len() as u64;
        // 2026-09-02 文件变更流事件：write 成功后推送全量新增 diff（绿行；大文件截断到 500 行）
        if let Some(sink) = &ctx.tool_stream {
            let added = content
                .lines()
                .take(500)
                .map(String::from)
                .collect::<Vec<_>>();
            let path = resolved.to_string_lossy().to_string();
            let total_lines = content.lines().count();
            sink.file_change(
                path,
                "write".to_string(),
                serde_json::json!([{ "removed": [], "added": added, "truncated_at": total_lines > 500 }]),
            );
        }
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
        // 任务29/E1：项目数据区（entities/.worldsmith）裸写拒绝，须经实体语义层
        ensure_not_protected(ctx, &resolved)?;
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
        // 2026-09-02 文件变更流事件：edit 成功后推送绿红 diff（不进入 LLM 消息上下文）
        if let Some(sink) = &ctx.tool_stream {
            let removed = old_string.lines().map(String::from).collect::<Vec<_>>();
            let added = new_string.lines().map(String::from).collect::<Vec<_>>();
            let path = path.clone();
            sink.file_change(
                path,
                "edit".to_string(),
                serde_json::json!([{ "removed": removed, "added": added }]),
            );
        }
        Ok(with_meta(
            json!({ "ok": true, "path": path.clone(), "replacements": replacements }),
            json!({ "op": "edit", "path": path, "replacements": replacements, "additions": additions, "deletions": deletions }),
        ))
    }
}

// ─── grep（内容搜索，ripgrep 风格） ────────────────────────────

/// grep/find 默认跳过目录（产物/隐藏，对齐 rg 默认语义）
const GREP_SKIP_DIRS: [&str; 7] = [".git", "node_modules", "target", "dist", ".idea", ".vscode", ".worldsmith"];

/// 内容搜索工具（ripgrep 风格，2026-09-02 系统工具）
///
/// 支持正则 + include/exclude glob 过滤 + 匹配行输出；默认跳过产物目录，
/// 限定搜索在 workdir 内；`max_results` 上限防结果爆炸。
pub struct GrepTool;

#[async_trait]
impl Tool for GrepTool {
    fn name(&self) -> &str {
        "grep"
    }
    fn description(&self) -> &str {
        "在工作区内按正则搜索文件内容（ripgrep 风格）。pattern 为正则；可传 include/exclude 过滤文件名 glob；output_mode=files 只列命中文件，matching_lines 输出 路径:行号:内容。默认跳过 .git/node_modules/target/dist 等目录。"
    }
    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "pattern": { "type": "string", "description": "正则表达式（Rust regex 语法）" },
                "path": { "type": "string", "description": "可选：搜索起始目录（默认工作区根，必须限定在 workdir 内）" },
                "include": { "type": "array", "items": { "type": "string" }, "description": "可选：仅匹配这些文件名 glob（如 [\"*.rs\", \"*.toml\"]）" },
                "exclude": { "type": "array", "items": { "type": "string" }, "description": "可选：排除这些文件名 glob（如 [\"*.min.js\"]）" },
                "output_mode": { "type": "string", "enum": ["files", "matching_lines"], "description": "files=仅列命中文件（默认）；matching_lines=输出 路径:行号:内容" },
                "max_results": { "type": "integer", "description": "可选：最多返回命中条目数（默认 500）" },
                "case_sensitive": { "type": "boolean", "description": "可选：是否大小写敏感（默认 false）" }
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
        let raw = args
            .get("path")
            .and_then(|v| v.as_str())
            .unwrap_or(DEFAULT_ROOT);
        let include = str_array(args.get("include"));
        let exclude = str_array(args.get("exclude"));
        let output_mode = args
            .get("output_mode")
            .and_then(|v| v.as_str())
            .unwrap_or("files");
        let max_results = args
            .get("max_results")
            .and_then(|v| v.as_u64())
            .unwrap_or(500) as usize;
        let case_sensitive = args
            .get("case_sensitive")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let base = resolve_fs_path(ctx, raw);
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
        // 正则（case_sensitive=false 时加 (?i) 内联，rg 默认智能大小写简化为全程不敏感）
        let final_pattern = if case_sensitive {
            pattern.to_string()
        } else {
            format!("(?i){pattern}")
        };
        let re = Regex::new(&final_pattern)
            .map_err(|e| ToolError::ArgsParse(format!("非法正则 pattern: {e}")))?;

        let mut matches: Vec<Value> = Vec::new();
        grep_walk(
            &base,
            &re,
            &include,
            &exclude,
            output_mode,
            max_results,
            &mut matches,
        )?;
        Ok(with_meta(
            json!({ "matches": matches, "output_mode": output_mode }),
            json!({
                "op": "grep",
                "path": base.to_string_lossy(),
                "pattern": pattern,
                "hits": matches.len(),
                "truncated": matches.len() >= max_results,
            }),
        ))
    }
}

/// 读取 string 数组参数（include/exclude）
fn str_array(v: Option<&Value>) -> Vec<String> {
    v.and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
        .unwrap_or_default()
}

/// 递归执行 grep：跳过默认目录 → 文件名过滤 → 逐行正则匹配
fn grep_walk(
    dir: &Path,
    re: &Regex,
    include: &[String],
    exclude: &[String],
    output_mode: &str,
    max_results: usize,
    matches: &mut Vec<Value>,
) -> Result<(), ToolError> {
    if matches.len() >= max_results {
        return Ok(());
    }
    let rd = std::fs::read_dir(dir)
        .map_err(|e| ToolError::Execution(format!("读取目录失败 {}: {e}", dir.display())))?;
    for entry in rd {
        let entry = entry.map_err(|e| ToolError::Execution(format!("读取目录项失败: {e}")))?;
        let path = entry.path();
        let meta = entry
            .metadata()
            .map_err(|e| ToolError::Execution(format!("读取元数据失败 {}: {e}", path.display())))?;
        let fname = entry.file_name().to_string_lossy().to_string();
        if meta.is_dir() {
            if GREP_SKIP_DIRS.contains(&fname.as_str()) {
                continue;
            }
            grep_walk(&path, re, include, exclude, output_mode, max_results, matches)?;
            continue;
        }
        // 文件名 glob 过滤
        if !include.is_empty() && !include.iter().any(|g| wildcard_match(g, &fname)) {
            continue;
        }
        if exclude.iter().any(|g| wildcard_match(g, &fname)) {
            continue;
        }
        // 文本读取失败（二进制等）跳过
        let Ok(content) = std::fs::read_to_string(&path) else {
            continue;
        };
        // 逐行匹配
        let mut file_count = 0usize;
        for (idx, line) in content.lines().enumerate() {
            if re.is_match(line) {
                file_count += 1;
                if output_mode == "matching_lines" {
                    if matches.len() >= max_results {
                        break;
                    }
                    matches.push(json!({
                        "path": path.to_string_lossy(),
                        "line": idx + 1,
                        "text": line.to_string(),
                    }));
                }
            }
        }
        if file_count > 0 && output_mode != "matching_lines" {
            matches.push(json!({
                "path": path.to_string_lossy(),
                "count": file_count,
            }));
        }
    }
    Ok(())
}

// ─── find（文件查找，文件名/路径过滤） ────────────────────────────

/// 文件查找工具（2026-09-02 系统工具）
///
/// 按文件名通配（glob * ?）递归查找；支持 type（file/dir）与 max_depth 过滤。
pub struct FindTool;

#[async_trait]
impl Tool for FindTool {
    fn name(&self) -> &str {
        "find"
    }
    fn description(&self) -> &str {
        "在工作区内按文件名（glob，支持 * 和 ?）查找文件或目录。可选 type（file/dir）与 max_depth 限制；默认跳过 .git/node_modules/target/dist 等目录。"
    }
    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "pattern": { "type": "string", "description": "文件名匹配模式（glob，如 *.md、main*、?.rs）" },
                "path": { "type": "string", "description": "可选：查找起始目录（默认工作区根，必须限定在 workdir 内）" },
                "type": { "type": "string", "enum": ["file", "dir"], "description": "可选：仅匹配文件或目录" },
                "max_depth": { "type": "integer", "description": "可选：最大递归深度（默认不限制；根为 0）" },
                "max_results": { "type": "integer", "description": "可选：最多返回条目数（默认 500）" }
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
        let raw = args
            .get("path")
            .and_then(|v| v.as_str())
            .unwrap_or(DEFAULT_ROOT);
        let want_type = args.get("type").and_then(|v| v.as_str());
        let max_depth = args.get("max_depth").and_then(|v| v.as_u64()).map(|n| n as usize);
        let max_results = args
            .get("max_results")
            .and_then(|v| v.as_u64())
            .unwrap_or(500) as usize;

        let base = resolve_fs_path(ctx, raw);
        let base_raw = base.to_string_lossy();
        if !ctx.is_within_workdir(&base_raw) {
            return Err(ToolError::Execution(format!(
                "查找路径越出工作区，已被拒绝: {}",
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
        find_walk(&base, pattern, want_type, max_depth, max_results, &mut matches, 0)?;
        Ok(with_meta(
            json!({ "matches": matches }),
            json!({ "op": "find", "path": base.to_string_lossy(), "pattern": pattern, "hits": matches.len() }),
        ))
    }
}

/// 递归查找：文件名通配 + type 过滤 + max_depth 限制
fn find_walk(
    dir: &Path,
    pattern: &str,
    want_type: Option<&str>,
    max_depth: Option<usize>,
    max_results: usize,
    matches: &mut Vec<Value>,
    depth: usize,
) -> Result<(), ToolError> {
    if matches.len() >= max_results {
        return Ok(());
    }
    if let Some(max) = max_depth {
        if depth > max {
            return Ok(());
        }
    }
    let rd = std::fs::read_dir(dir)
        .map_err(|e| ToolError::Execution(format!("读取目录失败 {}: {e}", dir.display())))?;
    for entry in rd {
        let entry = entry.map_err(|e| ToolError::Execution(format!("读取目录项失败: {e}")))?;
        let path = entry.path();
        let meta = entry
            .metadata()
            .map_err(|e| ToolError::Execution(format!("读取元数据失败 {}: {e}", path.display())))?;
        let is_dir = meta.is_dir();
        let fname = entry.file_name().to_string_lossy().to_string();
        if is_dir && GREP_SKIP_DIRS.contains(&fname.as_str()) {
            continue;
        }
        if wildcard_match(pattern, &fname) {
            let ftype = if is_dir { "dir" } else { "file" };
            if want_type.map(|t| t == ftype).unwrap_or(true) {
                matches.push(json!({
                    "path": path.to_string_lossy(),
                    "type": ftype,
                    "depth": depth,
                    "size": if is_dir { Value::Null } else { json!(meta.len()) },
                }));
            }
        }
        if is_dir {
            find_walk(&path, pattern, want_type, max_depth, max_results, matches, depth + 1)?;
        }
    }
    Ok(())
}

// ─── edit_diff（Diff 编辑：多块原子替换） ────────────────────────────

/// 单块替换定义
const EDIT_DIFF_MAX_BLOCKS: usize = 20;

/// Diff 编辑工具（2026-09-02 系统工具，对齐 Claude Code MultiEdit 语义）
///
/// 一次提交多个替换块（每块 old_string/new_string 精确替换）。
/// 先整体校验：任一 old_string 未找到或多处命中（未显式 replace_all）→ 拒绝且不写盘（原子性）。
pub struct EditDiffTool;

#[async_trait]
impl Tool for EditDiffTool {
    fn name(&self) -> &str {
        "edit_diff"
    }
    fn description(&self) -> &str {
        "对同一文件一次性应用多个精确字符串替换（diff 编辑）。edits 数组每项 {old_string, new_string, replace_all?}；任一旧串未找到或多处命中都会拒写（原子），适合需要一次改多处、且旧串需唯一定位的场景。"
    }
    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "要编辑的文件路径（绝对或相对工作区）" },
                "edits": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "old_string": { "type": "string", "description": "要被替换的原始文本" },
                            "new_string": { "type": "string", "description": "替换后的新文本" },
                            "replace_all": { "type": "boolean", "description": "可选：true=替换所有出现位置（默认 false 要求唯一命中）" }
                        },
                        "required": ["old_string", "new_string"]
                    },
                    "description": "替换块列表（最多 20 块）"
                }
            },
            "required": ["path", "edits"]
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
        let edits = args
            .get("edits")
            .and_then(|v| v.as_array())
            .ok_or_else(|| ToolError::ArgsParse("缺少 edits 参数".into()))?;
        if edits.is_empty() || edits.len() > EDIT_DIFF_MAX_BLOCKS {
            return Err(ToolError::ArgsParse(format!(
                "edits 数量需在 1~{} 之间",
                EDIT_DIFF_MAX_BLOCKS
            )));
        }
        let resolved = resolve_fs_path(ctx, path);
        ensure_within_workdir(ctx, &resolved)?;
        ensure_not_protected(ctx, &resolved)?;
        let content = std::fs::read_to_string(&resolved)
            .map_err(|e| ToolError::Execution(format!("读取文件失败 {}: {e}", resolved.display())))?;

        // 解析替换块
        struct Block<'a> {
            old: &'a str,
            new: &'a str,
            replace_all: bool,
        }
        let mut blocks: Vec<Block> = Vec::with_capacity(edits.len());
        for (i, ed) in edits.iter().enumerate() {
            let old = ed
                .get("old_string")
                .and_then(|v| v.as_str())
                .ok_or_else(|| ToolError::ArgsParse(format!("edits[{i}] 缺少 old_string")))?;
            let new = ed
                .get("new_string")
                .and_then(|v| v.as_str())
                .ok_or_else(|| ToolError::ArgsParse(format!("edits[{i}] 缺少 new_string")))?;
            let replace_all = ed
                .get("replace_all")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            blocks.push(Block { old, new, replace_all });
        }

        // 第一遍校验（原子性：任一块不满足即拒写）
        let mut replacements: Vec<Value> = Vec::new();
        for (i, b) in blocks.iter().enumerate() {
            let count = content.matches(b.old).count();
            if count == 0 {
                return Err(ToolError::Execution(format!(
                    "edits[{i}] 的 old_string 未在文件 {} 中找到",
                    resolved.display()
                )));
            }
            if count > 1 && !b.replace_all {
                return Err(ToolError::Execution(format!(
                    "edits[{i}] 的 old_string 在文件 {} 中出现 {count} 次，请提供更精确的上下文或设置 replace_all=true",
                    resolved.display()
                )));
            }
            replacements.push(json!({ "index": i, "occurrences": count, "replace_all": b.replace_all }));
        }

        // 第二遍应用（顺序替换）
        let mut new_content = content.clone();
        for b in &blocks {
            new_content = if b.replace_all {
                new_content.replace(b.old, b.new)
            } else {
                new_content.replacen(b.old, b.new, 1)
            };
        }
        std::fs::write(&resolved, new_content.as_bytes())
            .map_err(|e| ToolError::Execution(format!("写入文件失败 {}: {e}", resolved.display())))?;
        let path = resolved.to_string_lossy().to_string();
        // 2026-09-02 文件变更流事件：edit_diff 成功后逐块推送绿红 diff（不进入 LLM 消息上下文）
        if let Some(sink) = &ctx.tool_stream {
            let hunks = blocks
                .iter()
                .map(|b| {
                    serde_json::json!({
                        "removed": b.old.lines().map(String::from).collect::<Vec<_>>(),
                        "added": b.new.lines().map(String::from).collect::<Vec<_>>(),
                    })
                })
                .collect::<Vec<_>>();
            sink.file_change(path.clone(), "edit_diff".to_string(), serde_json::Value::Array(hunks));
        }
        Ok(with_meta(
            json!({ "ok": true, "path": path.clone(), "blocks": blocks.len(), "replacements": replacements }),
            json!({ "op": "edit_diff", "path": path, "blocks": blocks.len(), "replacements": replacements }),
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
    // 2026-09-02 系统工具（batc 1）：grep / find / edit_diff
    bus.register(Arc::new(GrepTool)).await;
    bus.register(Arc::new(FindTool)).await;
    bus.register(Arc::new(EditDiffTool)).await;
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
            tool_stream: None,
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

    // ── 任务29/E1：项目数据区写保护 ──

    #[test]
    fn protected_path_detection() {
        let wd = Path::new("C:/proj");
        assert!(is_protected_project_path(wd, Path::new("C:/proj/entities/a.json")));
        assert!(is_protected_project_path(wd, Path::new("C:/proj/.worldsmith/kv.json")));
        assert!(is_protected_project_path(wd, Path::new("C:/proj/Entities/x.json")));
        assert!(is_protected_project_path(wd, Path::new("C:/proj/entities")));
        assert!(!is_protected_project_path(wd, Path::new("C:/proj/notes.md")));
        assert!(!is_protected_project_path(wd, Path::new("C:/other/entities/x.json")));
    }

    #[test]
    fn shell_guard_detection() {
        let wd = Path::new("C:/proj");
        // 写操作词 × 相对保护目录
        assert!(shell_command_touches_protected_path(Some(wd), "rm entities/a.json"));
        assert!(shell_command_touches_protected_path(Some(wd), "echo x > .worldsmith/kv.json"));
        // 写操作词 × 绝对保护路径
        assert!(shell_command_touches_protected_path(Some(wd), "rm C:/proj/entities/a.json"));
        // 纯读命令不拦（E1 只保护写）
        assert!(!shell_command_touches_protected_path(Some(wd), "cat entities/a.json"));
        // 写操作但无保护目录字样
        assert!(!shell_command_touches_protected_path(Some(wd), "echo hi > log.txt"));
        // 无写操作词
        assert!(!shell_command_touches_protected_path(Some(wd), "ls entities/"));
        assert!(!shell_command_touches_protected_path(Some(wd), ""));
    }

    #[tokio::test]
    async fn write_into_entities_rejected_by_e1() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = ctx_for(dir.path());
        // write_file：Err + 引导语义层
        let res = WriteFileTool
            .execute_with_ctx(
                &ctx,
                json!({ "path": "entities/hero_abc.json", "content": "{}" }),
            )
            .await;
        let err = res.err().map(|e| e.to_string()).unwrap_or_default();
        assert!(err.contains("项目数据区"), "意外响应: {err}");
        // edit_file：同样拒绝
        let dir2 = tempfile::tempdir().unwrap();
        let ctx2 = ctx_for(dir2.path());
        let target = dir2.path().join("entities").join("x.json");
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::write(&target, "{}").unwrap();
        let res2 = EditFileTool
            .execute_with_ctx(
                &ctx2,
                json!({ "path": target.to_string_lossy(), "old_string": "{", "new_string": "[]" }),
            )
            .await;
        assert!(res2.is_err());
        // 受保护目录之外的写入不受影响
        let ok = WriteFileTool
            .execute_with_ctx(&ctx, json!({ "path": "notes/ok.txt", "content": "fine" }))
            .await
            .unwrap();
        assert_eq!(ok["ok"], true);
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

    // ── 2026-09-02 系统工具（批 1）：read 分页 / grep / find / edit_diff ──

    #[tokio::test]
    async fn read_file_pagination_offset_limit() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = ctx_for(dir.path());
        // 10 行文件（行 0..9）
        let content = (0..10).map(|i| format!("line-{i}")).collect::<Vec<_>>().join("\n");
        WriteFileTool
            .execute_with_ctx(&ctx, json!({ "path": "paged.txt", "content": content }))
            .await
            .unwrap();

        // 无参全读：total_lines=10，不截断
        let full = ReadFileTool
            .execute_with_ctx(&ctx, json!({ "path": "paged.txt" }))
            .await
            .unwrap();
        assert_eq!(full["total_lines"], 10);
        assert_eq!(full["truncated"], false);

        // offset=5 limit=3 → 行 5,6,7
        let page = ReadFileTool
            .execute_with_ctx(&ctx, json!({ "path": "paged.txt", "offset": 5, "limit": 3 }))
            .await
            .unwrap();
        assert_eq!(page["offset"], 5);
        assert_eq!(page["lines_returned"], 3);
        assert_eq!(page["content"], "line-5\nline-6\nline-7");

        // offset 越界 → 空页 + truncated=false
        let over = ReadFileTool
            .execute_with_ctx(&ctx, json!({ "path": "paged.txt", "offset": 100 }))
            .await
            .unwrap();
        assert_eq!(over["content"], "");
    }

    #[tokio::test]
    async fn grep_matches_content_with_include_filter() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = ctx_for(dir.path());
        WriteFileTool
            .execute_with_ctx(&ctx, json!({ "path": "a.txt", "content": "Hello World\nsecond line" }))
            .await
            .unwrap();
        WriteFileTool
            .execute_with_ctx(&ctx, json!({ "path": "b.md", "content": "world is here" }))
            .await
            .unwrap();

        // 默认大小写不敏感，matching_lines 命中两文件
        let lines = GrepTool
            .execute_with_ctx(&ctx, json!({ "pattern": "world", "output_mode": "matching_lines" }))
            .await
            .unwrap();
        let arr = lines["matches"].as_array().unwrap();
        assert_eq!(arr.len(), 2, "应命中 a.txt 与 b.md，实际: {arr:?}");
        assert_eq!(arr[0]["line"], 1);

        // include=*.txt 仅命中 a.txt（files 模式）
        let files = GrepTool
            .execute_with_ctx(&ctx, json!({ "pattern": "world", "include": ["*.txt"] }))
            .await
            .unwrap();
        let arr2 = files["matches"].as_array().unwrap();
        assert_eq!(arr2.len(), 1);
        assert!(arr2[0]["path"].as_str().unwrap().ends_with("a.txt"));
    }

    #[tokio::test]
    async fn find_by_name_and_type() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = ctx_for(dir.path());
        WriteFileTool
            .execute_with_ctx(&ctx, json!({ "path": "src/main.rs", "content": "" }))
            .await
            .unwrap();
        WriteFileTool
            .execute_with_ctx(&ctx, json!({ "path": "notes.md", "content": "" }))
            .await
            .unwrap();

        // 文件名 glob *.rs → src/main.rs（路径分隔符归一化后再断言，兼容 Windows 反斜杠）
        let found = FindTool
            .execute_with_ctx(&ctx, json!({ "pattern": "*.rs" }))
            .await
            .unwrap();
        let arr = found["matches"].as_array().unwrap();
        assert_eq!(arr.len(), 1);
        let p = arr[0]["path"].as_str().unwrap().replace('\\', "/");
        assert!(p.ends_with("src/main.rs"), "实际路径: {p}");
        assert_eq!(arr[0]["type"], "file");

        // type=dir 匹配 src 目录
        let dirs = FindTool
            .execute_with_ctx(&ctx, json!({ "pattern": "src", "type": "dir" }))
            .await
            .unwrap();
        let darr = dirs["matches"].as_array().unwrap();
        assert_eq!(darr.len(), 1);
        assert_eq!(darr[0]["type"], "dir");
    }

    #[tokio::test]
    async fn edit_diff_atomic_multiblock_and_uniqueness() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = ctx_for(dir.path());
        WriteFileTool
            .execute_with_ctx(&ctx, json!({ "path": "d.txt", "content": "aa bb cc\ndd bb ee" }))
            .await
            .unwrap();

        // 多块替换：aa→AA、cc→CC（各唯一）
        let ok = EditDiffTool
            .execute_with_ctx(&ctx, json!({
                "path": "d.txt",
                "edits": [
                    { "old_string": "aa", "new_string": "AA" },
                    { "old_string": "cc", "new_string": "CC" }
                ]
            }))
            .await
            .unwrap();
        assert_eq!(ok["ok"], true);
        assert_eq!(ok["blocks"], 2);
        let after = std::fs::read_to_string(dir.path().join("d.txt")).unwrap();
        assert_eq!(after, "AA bb CC\ndd bb ee");

        // 多处命中且未 replace_all → 原子拒绝（不写盘）
        let err = EditDiffTool
            .execute_with_ctx(&ctx, json!({
                "path": "d.txt",
                "edits": [{ "old_string": "bb", "new_string": "BB" }]
            }))
            .await;
        assert!(err.is_err(), "多处命中未 replace_all 应拒绝");
        // 文件未被修改
        let unchanged = std::fs::read_to_string(dir.path().join("d.txt")).unwrap();
        assert_eq!(unchanged, "AA bb CC\ndd bb ee");

        // replace_all=true 全部替换
        let ok2 = EditDiffTool
            .execute_with_ctx(&ctx, json!({
                "path": "d.txt",
                "edits": [{ "old_string": "bb", "new_string": "BB", "replace_all": true }]
            }))
            .await
            .unwrap();
        assert_eq!(ok2["ok"], true);
        let after2 = std::fs::read_to_string(dir.path().join("d.txt")).unwrap();
        assert_eq!(after2, "AA BB CC\ndd BB ee");
    }
}
