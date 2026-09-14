//! 文件系统命令层（Phase A 迁移：内容插件数据落盘）
//!
//! 供 entity-core 的 FileStorageBackend 使用（JSON 文件落盘存储实体/关系/文件）。
//! 对应前端调用：apps/tauri 内 `packages/entity-core` FileStorageBackend.ts
//! 的 cmd_fs_write / cmd_fs_read / cmd_fs_list / cmd_fs_delete。
//!
//! 设计：纯文件操作，无业务逻辑；路径由前端 FileStorageBackend 内部构造
//! （应用数据目录下），与终端命令层（TerminalService）一样直接暴露。
//!
//! 任务29/M2 定位（兜底防线）：本命令层为**应用层直通**——消费方（项目存储
//! FileStorageBackend、WorkspacePanel、WorkdirSelect）路径来自可信前端，故不做
//! workdir 边界；Agent 工具侧的边界（workdir 词法边界 + E1 受保护目录写守卫）在
//! TS 工具层 packages/agent-runtime/src/tools/workspace-boundary.ts 执行。
//! 本层仅保留敏感目录写防护（sensitive_dir_reason / ensure_write_allowed）作为
//! 全链路最后兜底。已知限制：shell 类工具的内容级写入无法词法拦截（记录于方案文档）。

use base64::Engine;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

/// 判断路径是否命中敏感目录（~/.ssh、~/.gnupg、/etc、/usr、/bin、/sbin）。
/// 组件级前缀匹配，避免 `/etcetera` 误命中 `/etc`。
fn sensitive_dir_reason(p: &Path) -> Option<String> {
    // 用户主目录下的密钥/配置目录
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from);
    if let Some(home) = home {
        for (name, label) in [(".ssh", "~/.ssh"), (".gnupg", "~/.gnupg")] {
            let sensitive = home.join(name);
            if p == sensitive || p.starts_with(&sensitive) {
                return Some(format!("敏感目录 {label}"));
            }
        }
    }
    // 系统目录（绝对路径前缀，Unix 风格）
    for sys in ["/etc", "/usr", "/bin", "/sbin"] {
        let sp = Path::new(sys);
        if p == sp || p.starts_with(sp) {
            return Some(format!("系统目录 {sys}"));
        }
    }
    None
}

/// 写类命令入口防护：命中敏感目录直接拒绝（覆盖 write/mkdir/copy/rename/delete 的源与目标）。
fn ensure_write_allowed(p: &Path) -> Result<(), String> {
    if let Some(reason) = sensitive_dir_reason(p) {
        return Err(format!("拒绝写入{reason}"));
    }
    Ok(())
}

/// 目录条目（对应前端 listDir / search 返回结构）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    /// 最后修改时间（unix 毫秒字符串；元数据不可用时为 None）
    pub modified: Option<String>,
}

/// 文件/目录元数据（对应前端 cmd_fs_stat 期望结构）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsStat {
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub mtime: Option<String>,
}

/// 写入文本文件（可递归创建父目录）
#[tauri::command]
pub async fn cmd_fs_write(
    path: String,
    content: String,
    create_dirs: Option<bool>,
) -> Result<(), String> {
    ensure_write_allowed(Path::new(&path))?;
    if create_dirs.unwrap_or(false) {
        if let Some(parent) = Path::new(&path).parent() {
            if !parent.as_os_str().is_empty() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
        }
    }
    fs::write(&path, content).map_err(|e| e.to_string())
}

/// 读取文件内容
///
/// `encoding`：
/// - `None` / `"utf-8"`：读为文本（`read_to_string`，非法 UTF-8 报错 → 前端判定二进制）
/// - `"base64"`：读为裸 base64 字符串（前端按扩展名拼 `data:{mime};base64,...` 展示图片/二进制）
#[tauri::command]
pub async fn cmd_fs_read(
    path: String,
    encoding: Option<String>,
) -> Result<String, String> {
    if encoding.as_deref() == Some("base64") {
        let bytes = fs::read(&path).map_err(|e| e.to_string())?;
        Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
    } else {
        fs::read_to_string(&path).map_err(|e| e.to_string())
    }
}

/// 在系统文件资源管理器中打开指定路径（目录或文件）—— 「打开项目文件夹」/「用默认程序打开」
///
/// Windows 用 `explorer`（无需等待退出）；macOS 用 `open`；Linux 用 `xdg-open`。
/// 传文件路径时由系统按默认关联程序打开（pptx 等无内置渲染器的格式走此降级出口）。
///
/// 接受**正斜杠**路径：Windows 的 explorer 对 `/` 解析异常，故在此统一归一化为反斜杠
/// （此前由调用方各自 replace 兜底，集中到本命令后调用方可直接传前端统一格式）。
#[tauri::command]
pub async fn cmd_open_in_explorer(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let native = path.replace('/', "\\");
        std::process::Command::new("explorer")
            .arg(&native)
            .spawn()
            .map_err(|e| format!("打开系统文件夹失败: {e}"))?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("打开系统文件夹失败: {e}"))?;
        Ok(())
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("打开系统文件夹失败: {e}"))?;
        Ok(())
    }
}

/// 列出目录内容（支持递归）
#[tauri::command]
pub async fn cmd_fs_list(
    path: String,
    recursive: Option<bool>,
) -> Result<Vec<FsEntry>, String> {
    list_dir_inner(&path, recursive.unwrap_or(false)).map_err(|e| e.to_string())
}

/// 删除文件或目录（目录递归删除）
#[tauri::command]
pub async fn cmd_fs_delete(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    ensure_write_allowed(p)?;
    if p.is_dir() {
        fs::remove_dir_all(p).map_err(|e| e.to_string())
    } else {
        fs::remove_file(p).map_err(|e| e.to_string())
    }
}

/// 递归收集目录条目
fn list_dir_inner(dir: &str, recursive: bool) -> std::io::Result<Vec<FsEntry>> {
    let mut entries = Vec::new();
    collect_entries(dir, dir, recursive, &mut entries)?;
    Ok(entries)
}

/// 深度优先收集目录条目（根目录自身不返回，仅其内容）
fn collect_entries(
    root: &str,
    current: &str,
    recursive: bool,
    out: &mut Vec<FsEntry>,
) -> std::io::Result<()> {
    let current_path = Path::new(current);
    for entry in fs::read_dir(current_path)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let is_dir = file_type.is_dir();
        let entry_path = entry.path();
        let entry_display = entry_path.to_string_lossy().replace('\\', "/");
        let metadata = entry.metadata().ok();
        let size = if is_dir {
            0
        } else {
            metadata.as_ref().map(|m| m.len()).unwrap_or(0)
        };
        out.push(FsEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: entry_display,
            is_dir,
            size,
            modified: metadata.as_ref().and_then(meta_to_mtime),
        });
        if recursive && is_dir {
            collect_entries(root, &entry_path.to_string_lossy(), recursive, out)?;
        }
    }
    Ok(())
}

/// 获取元数据的最后修改时间（unix 毫秒字符串；不可用时为 None）
fn meta_to_mtime(meta: &fs::Metadata) -> Option<String> {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis().to_string())
}

/// 获取文件/目录元数据（元数据命令，供前端工作区面板 stat 使用）
#[tauri::command]
pub async fn cmd_fs_stat(path: String) -> Result<FsStat, String> {
    let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    let is_dir = meta.is_dir();
    let size = if is_dir { 0 } else { meta.len() };
    Ok(FsStat {
        path,
        is_dir,
        size,
        mtime: meta_to_mtime(&meta),
    })
}

/// 创建目录（可递归创建多级目录；已存在时幂等成功）
#[tauri::command]
pub async fn cmd_fs_mkdir(path: String) -> Result<(), String> {
    ensure_write_allowed(Path::new(&path))?;
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

/// 复制文件（目标父目录需已存在；暂不支持复制目录）
#[tauri::command]
pub async fn cmd_fs_copy(src: String, dest: String) -> Result<(), String> {
    ensure_write_allowed(Path::new(&dest))?;
    let sp = Path::new(&src);
    if sp.is_dir() {
        return Err("暂不支持复制目录".to_string());
    }
    fs::copy(sp, &dest).map_err(|e| e.to_string())?;
    Ok(())
}

/// 重命名/移动文件或目录（同盘移动为原子操作）
#[tauri::command]
pub async fn cmd_fs_rename(src: String, dest: String) -> Result<(), String> {
    ensure_write_allowed(Path::new(&src))?;
    ensure_write_allowed(Path::new(&dest))?;
    fs::rename(&src, &dest).map_err(|e| e.to_string())
}

/// 目录内按文件名（glob，支持 * 和 ?）或文件内容子串搜索文件，递归子目录
#[tauri::command]
pub async fn cmd_fs_search(
    path: String,
    pattern: String,
    search_type: Option<String>,
    max_results: Option<usize>,
) -> Result<Vec<FsEntry>, String> {
    let base = Path::new(&path);
    if !base.is_dir() {
        return Err(format!("目录不存在或不是目录: {}", path));
    }
    let limit = max_results.unwrap_or(30);
    let is_content = search_type.as_deref() == Some("content");
    let mut out = Vec::new();
    search_walk(base, &pattern, is_content, limit, &mut out).map_err(|e| e.to_string())?;
    Ok(out)
}

/// 递归搜索目录：按文件名 pattern 匹配；is_content 时再按文件内容子串匹配
fn search_walk(
    dir: &Path,
    pattern: &str,
    is_content: bool,
    limit: usize,
    out: &mut Vec<FsEntry>,
) -> std::io::Result<()> {
    if out.len() >= limit {
        return Ok(());
    }
    for entry in fs::read_dir(dir)? {
        if out.len() >= limit {
            break;
        }
        let entry = entry?;
        let path = entry.path();
        let meta = entry.metadata()?;
        let is_dir = meta.is_dir();
        let name = entry.file_name().to_string_lossy().into_owned();
        let mut matched = glob_match(pattern, &name);
        if !matched && is_content && !is_dir {
            if let Ok(content) = fs::read_to_string(&path) {
                if content.contains(pattern) {
                    matched = true;
                }
            }
        }
        if matched {
            out.push(FsEntry {
                name,
                path: path.to_string_lossy().replace('\\', "/"),
                is_dir,
                size: if is_dir { 0 } else { meta.len() },
                modified: meta_to_mtime(&meta),
            });
        }
        if is_dir {
            search_walk(&path, pattern, is_content, limit, out)?;
        }
    }
    Ok(())
}

/// 文件名匹配：含通配符（* ?）时走简易 glob，否则按子串包含匹配
fn glob_match(pattern: &str, name: &str) -> bool {
    if pattern.contains('*') || pattern.contains('?') {
        simple_glob(pattern, name)
    } else {
        name.contains(pattern)
    }
}

/// 简易通配符匹配（* 匹配任意长度，? 匹配单个字符）
fn simple_glob(pattern: &str, text: &str) -> bool {
    let p: Vec<char> = pattern.chars().collect();
    let t: Vec<char> = text.chars().collect();
    let (mut pi, mut ti) = (0usize, 0usize);
    let mut star: Option<usize> = None;
    let mut star_ti = 0usize;
    while ti < t.len() {
        if pi < p.len() && (p[pi] == '?' || p[pi] == t[ti]) {
            pi += 1;
            ti += 1;
        } else if pi < p.len() && p[pi] == '*' {
            star = Some(pi);
            pi += 1;
            star_ti = ti;
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
