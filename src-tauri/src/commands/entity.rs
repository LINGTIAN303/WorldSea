//! 实体（Entity）相关命令
//!
//! 拆分自 lib.rs（P0-2 批次2）。
//! 涵盖实体的 CRUD、按类型查询、计数、批量导入与清空。

use tauri::State;
use worldsmith_core::error::CoreError;
use worldsmith_core::models::entity::Entity;

use crate::state::AppState;

#[tauri::command]
pub fn cmd_put_entity(state: State<AppState>, entity_json: String) -> Result<(), CoreError> {
    let entity: Entity = serde_json::from_str(&entity_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.put_entity(&entity)?;
    Ok(())
}

#[tauri::command]
pub fn cmd_get_entity(state: State<AppState>, id: String) -> Result<Option<Entity>, CoreError> {
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.get_entity(&id).map_err(|e| CoreError::storage(e.to_string()))
}

#[tauri::command]
pub fn cmd_get_all_entities(state: State<AppState>) -> Result<Vec<Entity>, CoreError> {
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.get_all_entities().map_err(|e| CoreError::storage(e.to_string()))
}

#[tauri::command]
pub fn cmd_get_entities_by_type(state: State<AppState>, entity_type: String) -> Result<Vec<Entity>, CoreError> {
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.get_entities_by_type(&entity_type).map_err(|e| CoreError::storage(e.to_string()))
}

#[tauri::command]
pub fn cmd_update_entity(state: State<AppState>, id: String, changes_json: String) -> Result<bool, CoreError> {
    let changes: serde_json::Value = serde_json::from_str(&changes_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.update_entity(&id, &changes).map_err(|e| CoreError::storage(e.to_string()))
}

#[tauri::command]
pub fn cmd_delete_entity(state: State<AppState>, id: String) -> Result<bool, CoreError> {
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.delete_entity(&id).map_err(|e| CoreError::storage(e.to_string()))
}

#[tauri::command]
pub fn cmd_count_entities_by_type(state: State<AppState>) -> Result<Vec<(String, usize)>, CoreError> {
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.count_entities_by_type().map_err(|e| CoreError::storage(e.to_string()))
}

#[tauri::command]
pub fn cmd_import_entities(state: State<AppState>, entities_json: String) -> Result<usize, CoreError> {
    let entities: Vec<Entity> = serde_json::from_str(&entities_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.import_entities(&entities).map_err(|e| CoreError::storage(e.to_string()))
}

#[tauri::command]
pub fn cmd_clear_entities(state: State<AppState>) -> Result<(), CoreError> {
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.clear_entities().map_err(|e| CoreError::storage(e.to_string()))
}
