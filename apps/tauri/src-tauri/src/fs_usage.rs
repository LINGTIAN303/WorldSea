//! 目录占用统计与整目录复制（原 fs_commands.rs 的 usage/copy_dir 子系统，为控制该文件规模迁出）。
//!
//! 两者共用同一套递归遍历（文件数 + 字节数），放一起避免重复实现。
//! 写类入口保留 fs_commands 的敏感目录守卫（`ensure_write_allowed`）。

use std::fs;
use std::path::Path;
use serde::Serialize;

use crate::fs_commands::ensure_write_allowed;

/// 目录占用分项（存储概览「磁盘占用」；只读，无写守卫）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsUsageEntry {
    pub name: String,
    pub file_count: u64,
    pub size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsUsage {
    pub file_count: u64,
    pub total_size: u64,
    pub entries: Vec<FsUsageEntry>,
}

/// 递归统计目录内文件总大小与文件数
fn walk_usage(dir: &Path) -> std::io::Result<(u64, u64)> {
    let mut size = 0u64;
    let mut count = 0u64;
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let meta = entry.metadata()?;
        if meta.is_dir() {
            let (s, c) = walk_usage(&entry.path())?;
            size += s;
            count += c;
        } else if meta.is_file() {
            size += meta.len();
            count += 1;
        }
    }
    Ok((size, count))
}

/// 目录占用统计：总大小/文件数 + 一级子目录分项（按大小降序；根目录散落文件归入「(根目录文件)」项）
#[tauri::command]
pub async fn cmd_fs_usage(dir: String) -> Result<FsUsage, String> {
    let root = Path::new(&dir);
    if !root.is_dir() {
        return Err(format!("目录不存在或不是目录: {}", dir));
    }
    let mut entries: Vec<FsUsageEntry> = Vec::new();
    let mut total_size = 0u64;
    let mut total_count = 0u64;
    let mut loose_size = 0u64;
    let mut loose_count = 0u64;
    let rd = fs::read_dir(root).map_err(|e| e.to_string())?;
    for entry in rd {
        let entry = entry.map_err(|e| e.to_string())?;
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        if meta.is_dir() {
            let (s, c) = walk_usage(&entry.path()).map_err(|e| e.to_string())?;
            entries.push(FsUsageEntry {
                name: entry.file_name().to_string_lossy().into_owned(),
                file_count: c,
                size: s,
            });
            total_size += s;
            total_count += c;
        } else if meta.is_file() {
            loose_size += meta.len();
            loose_count += 1;
        }
    }
    if loose_count > 0 {
        entries.push(FsUsageEntry {
            name: "(根目录文件)".to_string(),
            file_count: loose_count,
            size: loose_size,
        });
        total_size += loose_size;
        total_count += loose_count;
    }
    entries.sort_by(|a, b| b.size.cmp(&a.size));
    Ok(FsUsage { file_count: total_count, total_size, entries })
}

/// 递归复制目录（项目备份用；目标父目录自动创建；返回复制文件数与字节数）
fn copy_dir_recursive(src: &Path, dest: &Path) -> std::io::Result<(u64, u64)> {
    fs::create_dir_all(dest)?;
    let mut files = 0u64;
    let mut bytes = 0u64;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let meta = entry.metadata()?;
        if meta.is_dir() {
            let (f, b) = copy_dir_recursive(&entry.path(), &dest.join(entry.file_name()))?;
            files += f;
            bytes += b;
        } else if meta.is_file() {
            bytes += fs::copy(entry.path(), dest.join(entry.file_name()))?;
            files += 1;
        }
    }
    Ok((files, bytes))
}

/// 递归复制目录（项目备份；源须为目录且目标不得已存在；返回复制量）
#[tauri::command]
pub async fn cmd_fs_copy_dir(src: String, dest: String) -> Result<FsUsage, String> {
    let sp = Path::new(&src);
    if !sp.is_dir() {
        return Err(format!("源目录不存在或不是目录: {}", src));
    }
    ensure_write_allowed(Path::new(&src))?;
    ensure_write_allowed(Path::new(&dest))?;
    let dp = Path::new(&dest);
    if dp.exists() {
        return Err(format!("目标目录已存在: {}", dest));
    }
    let (file_count, total_size) = copy_dir_recursive(sp, dp).map_err(|e| e.to_string())?;
    Ok(FsUsage { file_count, total_size, entries: Vec::new() })
}
