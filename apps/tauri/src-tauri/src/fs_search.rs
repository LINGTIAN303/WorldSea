//! 文件搜索命令（原 fs_commands.rs 的搜索子系统，为控制该文件规模迁出）。
//!
//! 两个搜索维度：文件名 glob（`*` / `?`）与文件内容子串；均递归子目录。
//! 结果上限由调用方给（缺省 30），到达上限即停——搜索是「找得到就行」的场景，
//! 不需要全量收集后再截断。
//!
//! 复用 `fs_commands` 的 `FsEntry` 与 `meta_to_mtime`（同层模块，`pub(crate)` 可见）。

use std::fs;
use std::path::Path;

use crate::fs_commands::{meta_to_mtime, FsEntry};

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
