//! 原生文件系统 API 命令
//!
//! 拆分自 lib.rs（P0-2 批次5）。
//! 涵盖文件读写、目录列举、文件监听等不依赖 Shell 的原生 FS 命令。
//! 文件监听命令通过 `FsWatcherState` 注入获取全局 watchers map。

use std::sync::mpsc;

use notify::{
    Config as WatcherConfig, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher,
};
use serde::Serialize;
use tauri::{Emitter, Manager};

use worldsmith_core::error::CoreError;

use crate::state::FsWatcherState;

/// 文件目录条目
#[derive(Serialize)]
pub struct FsEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: Option<String>,
}

/// 文件 stat 信息
#[derive(Serialize)]
pub struct FsStat {
    pub exists: bool,
    pub is_dir: bool,
    pub is_file: bool,
    pub size: u64,
    pub modified: Option<String>,
    pub created: Option<String>,
    pub readonly: bool,
}

/// 文件变更事件（发送到前端）
#[derive(Clone, Serialize)]
pub struct FsChangeEvent {
    /// 变更类型：create / modify / remove / other
    pub kind: String,
    /// 受影响的文件路径列表
    pub paths: Vec<String>,
}

#[tauri::command]
pub fn cmd_fs_read(path: String, encoding: Option<String>) -> Result<String, CoreError> {
    let enc = encoding.unwrap_or_else(|| "utf-8".to_string());
    if enc.to_lowercase() == "base64" {
        let bytes = std::fs::read(&path)
            .map_err(|e| CoreError::storage(format!("Failed to read file '{}': {}", path, e)))?;
        Ok(base64_encode(&bytes))
    } else {
        std::fs::read_to_string(&path)
            .map_err(|e| CoreError::storage(format!("Failed to read file '{}': {}", path, e)))
    }
}

#[tauri::command]
pub fn cmd_fs_read_binary(path: String) -> Result<Vec<u8>, CoreError> {
    std::fs::read(&path)
        .map_err(|e| CoreError::storage(format!("Failed to read file '{}': {}", path, e)))
}

#[tauri::command]
pub fn cmd_fs_write(
    path: String,
    content: String,
    create_dirs: Option<bool>,
) -> Result<(), CoreError> {
    if create_dirs.unwrap_or(false) {
        if let Some(parent) = std::path::Path::new(&path).parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| CoreError::storage(format!("Failed to create dirs for '{}': {}", path, e)))?;
        }
    }
    std::fs::write(&path, &content)
        .map_err(|e| CoreError::storage(format!("Failed to write file '{}': {}", path, e)))
}

#[tauri::command]
pub fn cmd_fs_write_binary(
    path: String,
    data: Vec<u8>,
    create_dirs: Option<bool>,
) -> Result<(), CoreError> {
    if create_dirs.unwrap_or(false) {
        if let Some(parent) = std::path::Path::new(&path).parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| CoreError::storage(format!("Failed to create dirs for '{}': {}", path, e)))?;
        }
    }
    std::fs::write(&path, &data)
        .map_err(|e| CoreError::storage(format!("Failed to write file '{}': {}", path, e)))
}

#[tauri::command]
pub fn cmd_fs_list(path: String, recursive: Option<bool>) -> Result<Vec<FsEntry>, CoreError> {
    let rec = recursive.unwrap_or(false);
    let root = std::path::Path::new(&path);
    if !root.is_dir() {
        return Err(CoreError::storage(format!("Not a directory: {}", path)));
    }
    let mut entries = Vec::new();
    let walker = if rec {
        walkdir::WalkDir::new(&path).max_depth(3)
    } else {
        walkdir::WalkDir::new(&path).max_depth(1)
    };
    for entry in walker.into_iter().filter_map(|e| e.ok()) {
        let p = entry.path();
        if p == root {
            continue;
        }
        let meta = entry.metadata().ok();
        entries.push(FsEntry {
            name: p
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default(),
            path: p.to_string_lossy().to_string(),
            is_dir: entry.file_type().is_dir(),
            size: meta.as_ref().map(|m| m.len()).unwrap_or(0),
            modified: meta
                .as_ref()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs().to_string()),
        });
    }
    Ok(entries)
}

#[tauri::command]
pub fn cmd_fs_mkdir(path: String, recursive: Option<bool>) -> Result<(), CoreError> {
    if recursive.unwrap_or(true) {
        std::fs::create_dir_all(&path)
            .map_err(|e| CoreError::storage(format!("Failed to create directory '{}': {}", path, e)))
    } else {
        std::fs::create_dir(&path)
            .map_err(|e| CoreError::storage(format!("Failed to create directory '{}': {}", path, e)))
    }
}

#[tauri::command]
pub fn cmd_fs_stat(path: String) -> Result<FsStat, CoreError> {
    let _p = std::path::Path::new(&path);
    match std::fs::metadata(&path) {
        Ok(meta) => Ok(FsStat {
            exists: true,
            is_dir: meta.is_dir(),
            is_file: meta.is_file(),
            size: meta.len(),
            modified: meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs().to_string()),
            created: meta
                .created()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs().to_string()),
            readonly: meta.permissions().readonly(),
        }),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(FsStat {
            exists: false,
            is_dir: false,
            is_file: false,
            size: 0,
            modified: None,
            created: None,
            readonly: false,
        }),
        Err(e) => Err(CoreError::storage(format!("Failed to stat '{}': {}", path, e))),
    }
}

#[tauri::command]
pub fn cmd_fs_copy(source: String, destination: String) -> Result<(), CoreError> {
    let src = std::path::Path::new(&source);
    if src.is_dir() {
        copy_dir_recursive(src, std::path::Path::new(&destination))
    } else {
        std::fs::copy(&source, &destination).map_err(|e| {
            CoreError::storage(format!("Failed to copy '{}' to '{}': {}", source, destination, e))
        })?;
        Ok(())
    }
}

#[tauri::command]
pub fn cmd_fs_rename(source: String, destination: String) -> Result<(), CoreError> {
    std::fs::rename(&source, &destination).map_err(|e| {
        CoreError::storage(format!("Failed to rename '{}' to '{}': {}", source, destination, e))
    })
}

#[tauri::command]
pub fn cmd_fs_delete(path: String, recursive: Option<bool>) -> Result<(), CoreError> {
    let p = std::path::Path::new(&path);
    if p.is_dir() {
        if recursive.unwrap_or(false) {
            std::fs::remove_dir_all(&path)
                .map_err(|e| CoreError::storage(format!("Failed to delete directory '{}': {}", path, e)))
        } else {
            std::fs::remove_dir(&path)
                .map_err(|e| CoreError::storage(format!("Failed to delete directory '{}': {}", path, e)))
        }
    } else {
        std::fs::remove_file(&path)
            .map_err(|e| CoreError::storage(format!("Failed to delete file '{}': {}", path, e)))
    }
}

#[tauri::command]
pub fn cmd_fs_search(
    path: String,
    pattern: String,
    search_type: Option<String>,
) -> Result<Vec<FsEntry>, CoreError> {
    let stype = search_type.unwrap_or_else(|| "glob".to_string());
    let mut results = Vec::new();
    if stype == "content" {
        // Search file contents - return files that contain the pattern
        for entry in walkdir::WalkDir::new(&path)
            .max_depth(5)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            if entry.file_type().is_file() {
                if let Ok(content) = std::fs::read_to_string(entry.path()) {
                    if content.contains(&pattern) {
                        let meta = entry.metadata().ok();
                        results.push(FsEntry {
                            name: entry.file_name().to_string_lossy().to_string(),
                            path: entry.path().to_string_lossy().to_string(),
                            is_dir: false,
                            size: meta.as_ref().map(|m| m.len()).unwrap_or(0),
                            modified: meta
                                .as_ref()
                                .and_then(|m| m.modified().ok())
                                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                                .map(|d| d.as_secs().to_string()),
                        });
                        if results.len() >= 30 {
                            break;
                        }
                    }
                }
            }
        }
    } else {
        // Glob search by filename
        for entry in walkdir::WalkDir::new(&path)
            .max_depth(5)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            let name = entry.file_name().to_string_lossy();
            if glob_match(&pattern, &name) {
                let meta = entry.metadata().ok();
                results.push(FsEntry {
                    name: name.to_string(),
                    path: entry.path().to_string_lossy().to_string(),
                    is_dir: entry.file_type().is_dir(),
                    size: meta.as_ref().map(|m| m.len()).unwrap_or(0),
                    modified: meta
                        .as_ref()
                        .and_then(|m| m.modified().ok())
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs().to_string()),
                });
                if results.len() >= 50 {
                    break;
                }
            }
        }
    }
    Ok(results)
}

/// Simple glob matching: supports * and ? wildcards
fn glob_match(pattern: &str, text: &str) -> bool {
    let p: Vec<char> = pattern.chars().collect();
    let t: Vec<char> = text.chars().collect();
    let mut dp = vec![vec![false; t.len() + 1]; p.len() + 1];
    dp[0][0] = true;
    for i in 1..=p.len() {
        if p[i - 1] == '*' {
            dp[i][0] = dp[i - 1][0];
        }
    }
    for i in 1..=p.len() {
        for j in 1..=t.len() {
            if p[i - 1] == '*' {
                dp[i][j] = dp[i - 1][j] || dp[i][j - 1];
            } else if p[i - 1] == '?' || p[i - 1] == t[j - 1] {
                dp[i][j] = dp[i - 1][j - 1];
            }
        }
    }
    dp[p.len()][t.len()]
}

/// 启动项目目录监听。
/// 变更事件通过 Tauri event `fs:change` 推送到前端。
#[tauri::command]
pub fn cmd_fs_watch_start(
    app: tauri::AppHandle,
    path: String,
    watch_id: String,
) -> Result<String, CoreError> {
    let (tx, rx) = mpsc::channel();

    let mut watcher: RecommendedWatcher = notify::Watcher::new(
        move |res: Result<Event, notify::Error>| {
            if let Ok(event) = res {
                // 过滤高频自身写入的内部元数据单文件，减少 IPC 噪音
                // kv_store.json / files_meta.json 由 app 频繁写入，
                // 前端有自身写入静默期保护，外部修改无意义。
                // files_content/ 保留转发，支持外部编辑触发 reload。
                let has_relevant = event.paths.iter().any(|p| {
                    let s = p.to_string_lossy().replace('\\', "/");
                    !s.ends_with("/.worldsmith/kv_store.json")
                        && !s.ends_with("/.worldsmith/files_meta.json")
                });
                if has_relevant {
                    let _ = tx.send(event);
                }
            }
        },
        WatcherConfig::default(),
    )
    .map_err(|e| CoreError::storage(format!("Failed to create watcher: {}", e)))?;

    watcher
        .watch(std::path::Path::new(&path), RecursiveMode::Recursive)
        .map_err(|e| CoreError::storage(format!("Failed to watch '{}': {}", path, e)))?;

    // 将 watcher 存入 app state
    let state = app.state::<FsWatcherState>();
    let mut watchers = state
        .watchers
        .lock()
        .map_err(|e| CoreError::storage(format!("Watcher state lock poisoned: {}", e)))?;
    watchers.insert(watch_id.clone(), watcher);

    // 在后台线程中转发事件到前端
    let app_handle = app.clone();
    let wid = watch_id.clone();
    std::thread::spawn(move || {
        while let Ok(event) = rx.recv() {
            let kind = match event.kind {
                EventKind::Create(_) => "create",
                EventKind::Modify(_) => "modify",
                EventKind::Remove(_) => "remove",
                _ => "other",
            };
            let paths: Vec<String> = event
                .paths
                .iter()
                .map(|p| p.to_string_lossy().to_string())
                .collect();
            let change = FsChangeEvent {
                kind: kind.to_string(),
                paths,
            };
            let _ = app_handle.emit(
                "fs:change",
                serde_json::json!({
                    "watchId": wid,
                    "kind": change.kind,
                    "paths": change.paths,
                }),
            );
        }
    });

    Ok(watch_id)
}

/// 停止目录监听
#[tauri::command]
pub fn cmd_fs_watch_stop(app: tauri::AppHandle, watch_id: String) -> Result<(), CoreError> {
    let state = app.state::<FsWatcherState>();
    let mut watchers = state
        .watchers
        .lock()
        .map_err(|e| CoreError::storage(format!("Watcher state lock poisoned: {}", e)))?;
    if watchers.remove(&watch_id).is_some() {
        Ok(())
    } else {
        Err(CoreError::storage(format!("Watcher '{}' not found", watch_id)))
    }
}

/// Copy directory recursively
fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> Result<(), CoreError> {
    std::fs::create_dir_all(dst)
        .map_err(|e| CoreError::storage(format!("Failed to create directory '{}': {}", dst.display(), e)))?;
    for entry in std::fs::read_dir(src)
        .map_err(|e| CoreError::storage(format!("Failed to read directory '{}': {}", src.display(), e)))?
    {
        let entry =
            entry.map_err(|e| CoreError::storage(format!("Failed to read entry: {}", e)))?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path)
                .map_err(|e| CoreError::storage(format!("Failed to copy '{}': {}", src_path.display(), e)))?;
        }
    }
    Ok(())
}

/// Base64 encode helper (avoid importing base64 crate)
fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::new();
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;
        result.push(CHARS[((triple >> 18) & 0x3F) as usize] as char);
        result.push(CHARS[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            result.push(CHARS[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
        if chunk.len() > 2 {
            result.push(CHARS[(triple & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
    }
    result
}
