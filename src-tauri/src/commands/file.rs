//! 文件存储相关命令
//!
//! 拆分自 lib.rs（P0-2 批次2）。
//! 管理项目内的文件元数据与内容（以 JSON Value 形式存储于 SQLite）。

use tauri::State;
use worldsmith_core::error::CoreError;

use crate::state::AppState;

#[tauri::command]
pub fn cmd_get_all_files(state: State<AppState>) -> Result<Vec<serde_json::Value>, CoreError> {
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.get_all_files().map_err(|e| CoreError::storage(e.to_string()))
}

#[tauri::command]
pub fn cmd_get_file(state: State<AppState>, id: String) -> Result<Option<serde_json::Value>, CoreError> {
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.get_file(&id).map_err(|e| CoreError::storage(e.to_string()))
}

#[tauri::command]
pub fn cmd_get_file_by_path(state: State<AppState>, path: String) -> Result<Option<serde_json::Value>, CoreError> {
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.get_file_by_path(&path).map_err(|e| CoreError::storage(e.to_string()))
}

#[tauri::command]
pub fn cmd_get_files_by_entity(state: State<AppState>, entity_id: String) -> Result<Vec<serde_json::Value>, CoreError> {
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.get_files_by_entity(&entity_id).map_err(|e| CoreError::storage(e.to_string()))
}

#[tauri::command]
pub fn cmd_put_file(state: State<AppState>, file_json: String, content_json: String) -> Result<(), CoreError> {
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.put_file(&file_json, &content_json).map_err(|e| CoreError::storage(e.to_string()))
}

#[tauri::command]
pub fn cmd_update_file(state: State<AppState>, id: String, changes_json: String) -> Result<bool, CoreError> {
    let changes: serde_json::Value = serde_json::from_str(&changes_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.update_file(&id, &changes).map_err(|e| CoreError::storage(e.to_string()))
}

#[tauri::command]
pub fn cmd_delete_file(state: State<AppState>, id: String) -> Result<bool, CoreError> {
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.delete_file(&id).map_err(|e| CoreError::storage(e.to_string()))
}

#[tauri::command]
pub fn cmd_get_file_content(state: State<AppState>, id: String) -> Result<Option<serde_json::Value>, CoreError> {
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.get_file_content(&id).map_err(|e| CoreError::storage(e.to_string()))
}
