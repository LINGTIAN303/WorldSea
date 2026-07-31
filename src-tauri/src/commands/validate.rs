//! 验证（Validation）与诊断（Diagnostics）相关命令
//!
//! 拆分自 lib.rs（P0-2 批次3）。
//! 涵盖实体/Pack 校验、引用检查、版本迁移、存储健康、插件健康等。
//! `MigrateOutput` 随 `cmd_migrate` 一并迁移至此。

use serde::{Deserialize, Serialize};
use tauri::State;

use worldsmith_core::error::CoreError;
use worldsmith_core::models::entity::Entity;
use worldsmith_core::models::pack::WorldSmithPack;
use worldsmith_core::models::relation::Relation;
use worldsmith_core::models::plugin::{PluginManifest, validate_manifest};
use worldsmith_core::validate::entity::{validate_entity, ValidationReport};
use worldsmith_core::validate::pack::validate_pack;
use worldsmith_core::validate::reference::check_references_report;
use worldsmith_core::migrate::engine::migrate_pack;
use worldsmith_core::doctor::diagnostics::run_diagnostics;
use worldsmith_core::doctor::storage::check_storage_health;
use worldsmith_core::doctor::plugin::check_plugin_health;

use crate::state::AppState;

#[tauri::command]
pub fn cmd_validate_entity(
    entity_json: String,
    schema_json: Option<String>,
) -> Result<ValidationReport, CoreError> {
    let entity: Entity = serde_json::from_str(&entity_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let schema = schema_json
        .as_deref()
        .and_then(|s| serde_json::from_str::<worldsmith_core::models::entity::EntityTypeSchema>(s).ok());
    Ok(validate_entity(&entity, schema.as_ref()))
}

#[tauri::command]
pub fn cmd_validate_entities(
    entities_json: String,
    schemas_json: Option<String>,
) -> Result<ValidationReport, CoreError> {
    let entities: Vec<Entity> = serde_json::from_str(&entities_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let schemas: Vec<worldsmith_core::models::entity::EntityTypeSchema> = schemas_json
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();
    let schema_map: std::collections::HashMap<String, worldsmith_core::models::entity::EntityTypeSchema> = schemas
        .iter()
        .map(|s| (s.type_name.clone(), s.clone()))
        .collect();
    let mut combined = ValidationReport::new();
    for entity in &entities {
        let schema = schema_map.get(&entity.entity_type);
        let report = validate_entity(entity, schema);
        combined.errors.extend(report.errors);
        if !report.valid {
            combined.valid = false;
        }
    }
    Ok(combined)
}

#[tauri::command]
pub fn cmd_validate_pack(pack_json: String) -> Result<ValidationReport, CoreError> {
    let pack: WorldSmithPack = serde_json::from_str(&pack_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    Ok(validate_pack(&pack))
}

#[tauri::command]
pub fn cmd_check_references(
    entities_json: String,
    relations_json: String,
) -> Result<ValidationReport, CoreError> {
    let entities: Vec<Entity> = serde_json::from_str(&entities_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let relations: Vec<Relation> = serde_json::from_str(&relations_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    Ok(check_references_report(&entities, &relations))
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrateOutput {
    pub result: worldsmith_core::migrate::engine::MigrationResult,
    pub data: serde_json::Value,
}

#[tauri::command]
pub fn cmd_migrate(pack_json: String, from_version: u32) -> Result<MigrateOutput, CoreError> {
    let mut pack_data: serde_json::Value = serde_json::from_str(&pack_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let result = migrate_pack(&mut pack_data, from_version);
    Ok(MigrateOutput { result, data: pack_data })
}

#[tauri::command]
pub fn cmd_run_diagnostics(
    entities_json: String,
    relations_json: String,
    schemas_json: Option<String>,
) -> Result<worldsmith_core::doctor::diagnostics::DiagnosticSummary, CoreError> {
    let entities: Vec<Entity> = serde_json::from_str(&entities_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let relations: Vec<Relation> = serde_json::from_str(&relations_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let schemas: Vec<worldsmith_core::models::entity::EntityTypeSchema> = schemas_json
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();
    Ok(run_diagnostics(&entities, &relations, Some(&schemas)))
}

#[tauri::command]
pub fn cmd_check_storage_health(state: State<AppState>) -> Result<worldsmith_core::doctor::storage::StorageHealthReport, CoreError> {
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    Ok(check_storage_health(&*db))
}

#[tauri::command]
pub fn cmd_validate_plugin_manifest(manifest_json: String) -> Result<worldsmith_core::models::plugin::ManifestValidationResult, CoreError> {
    let manifest: PluginManifest = serde_json::from_str(&manifest_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    Ok(validate_manifest(&manifest))
}

#[tauri::command]
pub fn cmd_check_plugin_health(
    manifests_json: String,
    active_ids_json: String,
) -> Result<worldsmith_core::doctor::plugin::PluginHealthReport, CoreError> {
    let manifests: Vec<PluginManifest> = serde_json::from_str(&manifests_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let active_ids: Vec<String> = serde_json::from_str(&active_ids_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    Ok(check_plugin_health(&manifests, &active_ids))
}
