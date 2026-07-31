//! 关系（Relation）相关命令
//!
//! 拆分自 lib.rs（P0-2 批次2）。
//! 涵盖关系的 CRUD、按实体查询、批量导入与清空。

use tauri::State;
use worldsmith_core::error::CoreError;
use worldsmith_core::models::relation::Relation;

use crate::state::AppState;

#[tauri::command]
pub fn cmd_put_relation(state: State<AppState>, relation_json: String) -> Result<(), CoreError> {
    let relation: Relation = serde_json::from_str(&relation_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.put_relation(&relation)?;
    Ok(())
}

#[tauri::command]
pub fn cmd_get_all_relations(state: State<AppState>) -> Result<Vec<Relation>, CoreError> {
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.get_all_relations().map_err(|e| CoreError::storage(e.to_string()))
}

#[tauri::command]
pub fn cmd_get_relations_by_entity(state: State<AppState>, entity_id: String) -> Result<Vec<Relation>, CoreError> {
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.get_relations_by_entity(&entity_id).map_err(|e| CoreError::storage(e.to_string()))
}

#[tauri::command]
pub fn cmd_delete_relation(state: State<AppState>, id: String) -> Result<bool, CoreError> {
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.delete_relation(&id).map_err(|e| CoreError::storage(e.to_string()))
}

#[tauri::command]
pub fn cmd_delete_relations_by_entity(state: State<AppState>, entity_id: String) -> Result<usize, CoreError> {
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.delete_relations_by_entity(&entity_id).map_err(|e| CoreError::storage(e.to_string()))
}

#[tauri::command]
pub fn cmd_import_relations(state: State<AppState>, relations_json: String) -> Result<usize, CoreError> {
    let relations: Vec<Relation> = serde_json::from_str(&relations_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.import_relations(&relations).map_err(|e| CoreError::storage(e.to_string()))
}

#[tauri::command]
pub fn cmd_update_relation(state: State<AppState>, id: String, changes_json: String) -> Result<bool, CoreError> {
    let changes: serde_json::Value = serde_json::from_str(&changes_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.update_relation(&id, &changes).map_err(|e| CoreError::storage(e.to_string()))
}

#[tauri::command]
pub fn cmd_clear_relations(state: State<AppState>) -> Result<(), CoreError> {
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.clear_relations().map_err(|e| CoreError::storage(e.to_string()))
}
