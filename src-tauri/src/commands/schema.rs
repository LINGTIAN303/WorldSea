//! Schema（实体类型注册表）相关命令
//!
//! 拆分自 lib.rs（P0-2 批次5）。
//! 涵盖实体类型的注册/注销/查询/更新/验证规则/视图声明等命令。
//! 所有命令通过 `State<AppState>` 注入获取全局 schema registry。

use tauri::State;
use worldsmith_core::error::CoreError;

use crate::state::AppState;

#[tauri::command]
pub fn cmd_schema_register_entity_type(
    state: State<AppState>,
    schema_json: String,
) -> Result<String, CoreError> {
    let schema: worldsmith_core::schema::EntityTypeSchema = serde_json::from_str(&schema_json)
        .map_err(|e| CoreError::SchemaError(format!("Invalid schema JSON: {}", e)))?;
    let mut reg = state
        .schema
        .lock()
        .map_err(|e| CoreError::SchemaError(e.to_string()))?;
    reg.register(schema.clone())
        .map_err(CoreError::SchemaError)?;
    serde_json::to_string(&schema).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
pub fn cmd_schema_unregister_entity_type(
    state: State<AppState>,
    type_key: String,
) -> Result<(), CoreError> {
    let mut reg = state
        .schema
        .lock()
        .map_err(|e| CoreError::SchemaError(e.to_string()))?;
    reg.unregister(&type_key);
    Ok(())
}

#[tauri::command]
pub fn cmd_schema_get_entity_type(
    state: State<AppState>,
    type_key: String,
) -> Result<String, CoreError> {
    let reg = state
        .schema
        .lock()
        .map_err(|e| CoreError::SchemaError(e.to_string()))?;
    let schema = reg
        .get(&type_key)
        .ok_or_else(|| CoreError::SchemaError(format!("Entity type '{}' not found", type_key)))?;
    serde_json::to_string(schema).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
pub fn cmd_schema_list_entity_types(state: State<AppState>) -> Result<String, CoreError> {
    let reg = state
        .schema
        .lock()
        .map_err(|e| CoreError::SchemaError(e.to_string()))?;
    let list = reg.list_all();
    serde_json::to_string(&list).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
pub fn cmd_schema_update_entity_type(
    state: State<AppState>,
    type_key: String,
    updates_json: String,
) -> Result<String, CoreError> {
    let updates: worldsmith_core::schema::EntityTypeSchema = serde_json::from_str(&updates_json)
        .map_err(|e| CoreError::SchemaError(format!("Invalid updates JSON: {}", e)))?;
    let mut reg = state
        .schema
        .lock()
        .map_err(|e| CoreError::SchemaError(e.to_string()))?;
    reg.unregister(&type_key);
    reg.register(updates.clone())
        .map_err(CoreError::SchemaError)?;
    serde_json::to_string(&updates).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
pub fn cmd_schema_register_validation(
    state: State<AppState>,
    type_key: String,
    rule_json: String,
) -> Result<(), CoreError> {
    let rule: worldsmith_core::schema::ValidationRule = serde_json::from_str(&rule_json)
        .map_err(|e| CoreError::SchemaError(format!("Invalid rule JSON: {}", e)))?;
    let mut reg = state
        .schema
        .lock()
        .map_err(|e| CoreError::SchemaError(e.to_string()))?;
    reg.add_validation(&type_key, rule)
        .map_err(CoreError::SchemaError)
}

#[tauri::command]
pub fn cmd_schema_register_view(
    state: State<AppState>,
    type_key: String,
    view_json: String,
) -> Result<(), CoreError> {
    let view: worldsmith_core::schema::ViewDeclaration = serde_json::from_str(&view_json)
        .map_err(|e| CoreError::SchemaError(format!("Invalid view JSON: {}", e)))?;
    let mut reg = state
        .schema
        .lock()
        .map_err(|e| CoreError::SchemaError(e.to_string()))?;
    reg.add_view(&type_key, view)
        .map_err(CoreError::SchemaError)
}
