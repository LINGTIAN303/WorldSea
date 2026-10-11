//! 文件系统监听命令层（Phase C 收尾：cmd_fs_watch_*）
//!
//! 供 entity-core 的 useFsWatcher 使用：递归监听项目数据目录，
//! 文件变更时通过 Tauri 事件 `fs:change` 推送 `{ watchId, kind, paths }` 给前端，
//! 前端防抖后增量刷新 EntityStore / RelationStore / FileStore。
//!
//! 设计：watchId -> RecommendedWatcher 注册表（模块级 managed state），
//! 事件回调捕获 AppHandle 直接 emit，不做业务过滤（过滤在 Rust 端做掉
//! kv_store.json / files_meta.json 内部元数据，前端还有一层兜底）。

use std::collections::HashMap;
use std::sync::Mutex;

use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

/// 文件监听器注册表：watchId -> 活跃 watcher（managed state）
pub struct FsWatchRegistry(pub Mutex<HashMap<String, RecommendedWatcher>>);

/// `fs:change` 事件 payload（对应前端 useFsWatcher 的 listen 类型）
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsChangePayload {
    pub watch_id: String,
    pub kind: String,
    pub paths: Vec<String>,
}

/// 启动递归监听指定目录，返回 watchId（后续用其停止监听）
#[tauri::command]
pub async fn cmd_fs_watch_start(
    app: AppHandle,
    registry: State<'_, FsWatchRegistry>,
    path: String,
    watch_id: String,
) -> Result<String, String> {
    let app_for_emit = app.clone();
    let id_for_emit = watch_id.clone();

    // notify v8：回调在内部线程执行，需要捕获 AppHandle + watchId 用于 emit
    let mut watcher = RecommendedWatcher::new(
        move |res: Result<Event, notify::Error>| {
            let event = match res {
                Ok(e) => e,
                Err(e) => {
                    tracing::warn!("[FsWatcher] 监听事件错误: {e}");
                    return;
                }
            };

            // Rust 端过滤内部元数据（kv_store.json / files_meta.json），
            // 避免自身写入触发不必要的 reload（前端 isInSelfWriteWindow 兜底）
            let paths: Vec<String> = event
                .paths
                .iter()
                .filter(|p| {
                    let s = p.to_string_lossy().replace('\\', "/");
                    !s.ends_with("/.worldsea/kv_store.json")
                        && !s.ends_with("/.worldsea/files_meta.json")
                })
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .collect();
            if paths.is_empty() {
                return;
            }

            let kind = match event.kind {
                notify::EventKind::Create(_) => "create",
                notify::EventKind::Modify(_) => "modify",
                notify::EventKind::Remove(_) => "remove",
                _ => "other",
            }
            .to_string();

            let _ = app_for_emit.emit(
                "fs:change",
                FsChangePayload {
                    watch_id: id_for_emit.clone(),
                    kind,
                    paths,
                },
            );
        },
        Config::default(),
    )
    .map_err(|e| e.to_string())?;

    watcher
        .watch(std::path::Path::new(&path), RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    registry.0.lock().map_err(|e| e.to_string())?.insert(watch_id.clone(), watcher);
    tracing::info!("[FsWatcher] 开始监听: {path} (watchId={watch_id})");
    Ok(watch_id)
}

/// 停止监听指定 watchId（从注册表移除并 drop watcher）
#[tauri::command]
pub async fn cmd_fs_watch_stop(
    registry: State<'_, FsWatchRegistry>,
    watch_id: String,
) -> Result<(), String> {
    let removed = registry
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&watch_id);
    if removed.is_none() {
        tracing::debug!("[FsWatcher] watcher 不存在（可能已清理）: {watch_id}");
    } else {
        tracing::info!("[FsWatcher] 停止监听: {watch_id}");
    }
    Ok(())
}
