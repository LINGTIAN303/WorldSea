//! 文件系统命令层（Phase A 迁移：内容插件数据落盘）
//!
//! 供 entity-core 的 FileStorageBackend 使用（JSON 文件落盘存储实体/关系/文件）。
//! 对应前端调用：apps/tauri 内 `packages/entity-core` FileStorageBackend.ts
//! 的 cmd_fs_write / cmd_fs_read / cmd_fs_list / cmd_fs_delete。
//!
//! 设计：纯文件操作，无业务逻辑；路径由前端 FileStorageBackend 内部构造
//! （应用数据目录下），与终端命令层（TerminalService）一样直接暴露。

use serde::Serialize;
use std::fs;
use std::path::Path;

/// 目录条目（对应前端 listDir 返回结构）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
}

/// 写入文本文件（可递归创建父目录）
#[tauri::command]
pub async fn cmd_fs_write(
    path: String,
    content: String,
    create_dirs: Option<bool>,
) -> Result<(), String> {
    if create_dirs.unwrap_or(false) {
        if let Some(parent) = Path::new(&path).parent() {
            if !parent.as_os_str().is_empty() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
        }
    }
    fs::write(&path, content).map_err(|e| e.to_string())
}

/// 读取文本文件（utf-8）
#[tauri::command]
pub async fn cmd_fs_read(
    path: String,
    _encoding: Option<String>,
) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
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
        let size = if is_dir {
            0
        } else {
            entry.metadata().map(|m| m.len()).unwrap_or(0)
        };
        out.push(FsEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: entry_display,
            is_dir,
            size,
        });
        if recursive && is_dir {
            collect_entries(root, &entry_path.to_string_lossy(), recursive, out)?;
        }
    }
    Ok(())
}
