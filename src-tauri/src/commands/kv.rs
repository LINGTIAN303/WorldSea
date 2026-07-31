//! 键值存储（KV）相关命令
//!
//! 拆分自 lib.rs（P0-2 批次2）。
//! 简单的 key-value 持久化，用于插件配置、缓存等场景。

use tauri::State;
use worldsmith_core::error::CoreError;

use crate::state::AppState;

#[tauri::command]
pub fn cmd_kv_get(state: State<AppState>, key: String) -> Result<Option<String>, CoreError> {
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.kv_get(&key).map_err(|e| CoreError::storage(e.to_string()))
}

#[tauri::command]
pub fn cmd_kv_set(state: State<AppState>, key: String, value: String) -> Result<(), CoreError> {
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.kv_set(&key, &value).map_err(|e| CoreError::storage(e.to_string()))
}

#[tauri::command]
pub fn cmd_kv_get_all(state: State<AppState>) -> Result<Vec<(String, String)>, CoreError> {
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.kv_get_all().map_err(|e| CoreError::storage(e.to_string()))
}

#[tauri::command]
pub fn cmd_kv_delete(state: State<AppState>, key: String) -> Result<(), CoreError> {
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.kv_delete(&key).map_err(|e| CoreError::storage(e.to_string()))
}

#[tauri::command]
pub fn cmd_kv_clear(state: State<AppState>) -> Result<(), CoreError> {
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.kv_clear().map_err(|e| CoreError::storage(e.to_string()))
}
