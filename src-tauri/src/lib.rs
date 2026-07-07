use std::sync::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::io::{BufRead, BufReader, Write};
use tauri::Emitter;
use tauri::Manager;

use serde::{Deserialize, Serialize};
use tauri::State;
use worldsmith_core::error::CoreError;
use worldsmith_core::models::entity::Entity;
use worldsmith_core::models::pack::WorldSmithPack;
use worldsmith_core::models::relation::Relation;
use worldsmith_core::models::plugin::{PluginManifest, validate_manifest};
use worldsmith_core::storage::sqlite::SqliteStore;
use worldsmith_core::validate::entity::{validate_entity, ValidationReport};
use worldsmith_core::validate::pack::validate_pack;
use worldsmith_core::validate::reference::check_references_report;
use worldsmith_core::migrate::engine::migrate_pack;
use worldsmith_core::doctor::diagnostics::run_diagnostics;
use worldsmith_core::doctor::storage::check_storage_health;
use worldsmith_core::doctor::plugin::check_plugin_health;
use worldsmith_core::retrofit::RetrofitEngine;
use worldsmith_core::retrofit::catalog::CapabilityCatalog;
use worldsmith_core::retrofit::executor::ConflictReport;
use worldsmith_core::retrofit::guard::SafetyReport;
use worldsmith_core::retrofit::intent::RetrofitIntent;
use worldsmith_core::retrofit::session::SessionPhase;
use worldsmith_core::retrofit::{ConfirmResult, ApplyResult};
use worldsmith_core::retrofit::patch::{JsonPatch, JsonPatchDiff};
use worldsmith_core::algo::spatial::rtree::{SpatialIndex, SpatialItem, PointItem};
use worldsmith_core::algo::geometry::line::{Point2D, Segment2D, find_all_intersections};
use worldsmith_core::algo::geometry::polygon::{Polygon2D, point_in_polygon, convex_hull, chaikin_smooth, find_shared_edges, find_line_polygon_intersections, polygon_split, polygon_augment};
use worldsmith_core::algo::geometry::bbox::{AABB2D, OBB2D};
use worldsmith_core::algo::graph::pathfind::{WeightedGraph, dijkstra, dijkstra_path, astar, k_shortest_paths};
use worldsmith_core::algo::graph::topology::{topological_sort, connected_components, tarjan_scc, find_dangling_references};
use worldsmith_core::algo::graph::layout::{
  force_directed_layout, ForceLayoutConfig,
  grid_layout, GridLayoutConfig,
  radial_layout, RadialLayoutConfig,
  tree_layout, TreeLayoutConfig,
  compute_layout, LayoutAlgorithm,
};
use worldsmith_core::algo::collab::crdt::{LWWRegister, ORSet, RGA, VectorClock};
use worldsmith_core::algo::terrain::terrain::{NoiseConfig, HeightMap, value_noise_2d, marching_squares};
use worldsmith_core::algo::draft::constraint::ConstraintSystem;
use worldsmith_core::algo::draft::dxf_io;
use worldsmith_core::algo::geometry::boolean;
use worldsmith_core::algo::graph::community;
use worldsmith_core::algo::terrain::erosion;

// ── 安全存储 API（系统 Keyring） ──

const KEYRING_SERVICE: &str = "com.worldsmith.app";
const KEYRING_USERNAME: &str = "api_keys";

/// 获取 keyring 条目 — 统一 service/username，用 key 名作为条目后缀
fn keyring_entry(key: &str) -> Result<keyring::Entry, String> {
    let service = format!("{}:{}", KEYRING_SERVICE, key);
    keyring::Entry::new(&service, KEYRING_USERNAME).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_secure_store(key: String, value: String) -> Result<(), String> {
    if value.is_empty() {
        // 空值等同于删除
        let entry = keyring_entry(&key)?;
        let _ = entry.delete_credential();
        return Ok(());
    }
    let entry = keyring_entry(&key)?;
    entry.set_password(&value).map_err(|e| {
        eprintln!("[keyring] set_password 失败 for key={key}: {e}");
        e.to_string()
    })
}

#[tauri::command]
fn cmd_secure_load(key: String) -> Result<String, String> {
    let entry = keyring_entry(&key)?;
    match entry.get_password() {
        Ok(password) => Ok(password),
        Err(keyring::Error::NoEntry) => Ok(String::new()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn cmd_secure_delete(key: String) -> Result<(), String> {
    let entry = keyring_entry(&key)?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn cmd_secure_exists(key: String) -> Result<bool, String> {
    let entry = keyring_entry(&key)?;
    match entry.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}

pub mod workflow;

pub struct AppState {
    db: Mutex<SqliteStore>,
    retrofit: Mutex<RetrofitEngine>,
    spatial: Mutex<SpatialIndex>,
    schema: Mutex<worldsmith_core::schema::SchemaRegistry>,
    mcp_processes: Mutex<std::collections::HashMap<String, std::process::Child>>,
    pty_processes: Mutex<std::collections::HashMap<String, PtyProcess>>,
    /// PTY 输出 channel 接收端，供 cmd_shell_session_exec 读取
    pty_output_receivers: Mutex<std::collections::HashMap<String, std::sync::mpsc::Receiver<String>>>,
    /// 工作流引擎单例（Phase 2.1+）
    wf_engine: std::sync::Arc<crate::workflow::engine::WorkflowEngine>,
    /// 工作流 Sqlite 数据库路径（spawn executor 时用于开新连接）
    wf_db_path: std::sync::Mutex<String>,
    plugin_node_metas: std::sync::Mutex<std::collections::HashMap<String, crate::workflow::node_meta::NodeMetadata>>,
    dispatcher_registry: std::sync::Arc<std::sync::Mutex<std::collections::HashMap<String, std::sync::Arc<crate::workflow::executor::DispatchHandle>>>>,
}

struct PtyProcess {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn std::io::Write + Send>,
    _child: Box<dyn portable_pty::Child + Send + Sync>,
    kill_tx: std::sync::Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
    /// 输出缓冲 channel sender：持有以保持 channel 存活，receiver 在 pty_output_receivers 中
    #[allow(dead_code)]
    output_tx: std::sync::Mutex<Option<std::sync::mpsc::Sender<String>>>,
}

#[tauri::command]
fn cmd_init_db(state: State<AppState>, path: String) -> Result<(), CoreError> {
    let store = SqliteStore::open(&path)?;
    *state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))? = store;
    Ok(())
}

/// 切换项目数据库。根据 project_id 在 app data 目录下创建/打开对应的 SQLite 文件。
#[tauri::command]
fn cmd_switch_project(app: tauri::AppHandle, state: State<AppState>, project_id: String) -> Result<String, CoreError> {
    let data_dir = app.path().app_data_dir()
        .map_err(|e| CoreError::storage(format!("获取 app data 目录失败: {e}")))?;
    let projects_dir = data_dir.join("projects");
    std::fs::create_dir_all(&projects_dir)
        .map_err(|e| CoreError::storage(format!("创建 projects 目录失败: {e}")))?;
    let db_path = projects_dir.join(format!("{}.db", project_id));
    let path_str = db_path.to_string_lossy().to_string();
    let store = SqliteStore::open(&path_str)?;
    *state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))? = store;
    Ok(path_str)
}

/// 删除项目数据库文件。
#[tauri::command]
fn cmd_delete_project_db(app: tauri::AppHandle, project_id: String) -> Result<(), CoreError> {
    let data_dir = app.path().app_data_dir()
        .map_err(|e| CoreError::storage(format!("获取 app data 目录失败: {e}")))?;
    let db_path = data_dir.join("projects").join(format!("{}.db", project_id));
    if db_path.exists() {
        std::fs::remove_file(&db_path)
            .map_err(|e| CoreError::storage(format!("删除项目数据库失败: {e}")))?;
    }
    Ok(())
}

#[tauri::command]
fn cmd_put_entity(state: State<AppState>, entity_json: String) -> Result<(), CoreError> {
    let entity: Entity = serde_json::from_str(&entity_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.put_entity(&entity)?;
    Ok(())
}

#[tauri::command]
fn cmd_get_entity(state: State<AppState>, id: String) -> Result<Option<Entity>, CoreError> {
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.get_entity(&id).map_err(|e| CoreError::storage(e.to_string()))
}

#[tauri::command]
fn cmd_get_all_entities(state: State<AppState>) -> Result<Vec<Entity>, CoreError> {
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.get_all_entities().map_err(|e| CoreError::storage(e.to_string()))
}

#[tauri::command]
fn cmd_get_entities_by_type(state: State<AppState>, entity_type: String) -> Result<Vec<Entity>, CoreError> {
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.get_entities_by_type(&entity_type).map_err(|e| CoreError::storage(e.to_string()))
}

#[tauri::command]
fn cmd_update_entity(state: State<AppState>, id: String, changes_json: String) -> Result<bool, CoreError> {
    let changes: serde_json::Value = serde_json::from_str(&changes_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.update_entity(&id, &changes).map_err(|e| CoreError::storage(e.to_string()))
}

#[tauri::command]
fn cmd_delete_entity(state: State<AppState>, id: String) -> Result<bool, CoreError> {
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.delete_entity(&id).map_err(|e| CoreError::storage(e.to_string()))
}

#[tauri::command]
fn cmd_count_entities_by_type(state: State<AppState>) -> Result<Vec<(String, usize)>, CoreError> {
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.count_entities_by_type().map_err(|e| CoreError::storage(e.to_string()))
}

#[tauri::command]
fn cmd_put_relation(state: State<AppState>, relation_json: String) -> Result<(), CoreError> {
    let relation: Relation = serde_json::from_str(&relation_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.put_relation(&relation)?;
    Ok(())
}

#[tauri::command]
fn cmd_get_all_relations(state: State<AppState>) -> Result<Vec<Relation>, CoreError> {
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.get_all_relations().map_err(|e| CoreError::storage(e.to_string()))
}

#[tauri::command]
fn cmd_get_relations_by_entity(state: State<AppState>, entity_id: String) -> Result<Vec<Relation>, CoreError> {
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.get_relations_by_entity(&entity_id).map_err(|e| CoreError::storage(e.to_string()))
}

#[tauri::command]
fn cmd_delete_relation(state: State<AppState>, id: String) -> Result<bool, CoreError> {
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.delete_relation(&id).map_err(|e| CoreError::storage(e.to_string()))
}

#[tauri::command]
fn cmd_delete_relations_by_entity(state: State<AppState>, entity_id: String) -> Result<usize, CoreError> {
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.delete_relations_by_entity(&entity_id).map_err(|e| CoreError::storage(e.to_string()))
}

#[tauri::command]
fn cmd_import_entities(state: State<AppState>, entities_json: String) -> Result<usize, CoreError> {
    let entities: Vec<Entity> = serde_json::from_str(&entities_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.import_entities(&entities).map_err(|e| CoreError::storage(e.to_string()))
}

#[tauri::command]
fn cmd_import_relations(state: State<AppState>, relations_json: String) -> Result<usize, CoreError> {
    let relations: Vec<Relation> = serde_json::from_str(&relations_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.import_relations(&relations).map_err(|e| CoreError::storage(e.to_string()))
}

#[tauri::command]
fn cmd_update_relation(state: State<AppState>, id: String, changes_json: String) -> Result<bool, CoreError> {
    let changes: serde_json::Value = serde_json::from_str(&changes_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.update_relation(&id, &changes).map_err(|e| CoreError::storage(e.to_string()))
}

#[tauri::command]
fn cmd_clear_entities(state: State<AppState>) -> Result<(), CoreError> {
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.clear_entities().map_err(|e| CoreError::storage(e.to_string()))
}

#[tauri::command]
fn cmd_clear_relations(state: State<AppState>) -> Result<(), CoreError> {
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.clear_relations().map_err(|e| CoreError::storage(e.to_string()))
}

#[tauri::command]
fn cmd_kv_get(state: State<AppState>, key: String) -> Result<Option<String>, CoreError> {
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.kv_get(&key).map_err(|e| CoreError::storage(e.to_string()))
}

#[tauri::command]
fn cmd_kv_set(state: State<AppState>, key: String, value: String) -> Result<(), CoreError> {
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.kv_set(&key, &value).map_err(|e| CoreError::storage(e.to_string()))
}

#[tauri::command]
fn cmd_kv_get_all(state: State<AppState>) -> Result<Vec<(String, String)>, CoreError> {
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.kv_get_all().map_err(|e| CoreError::storage(e.to_string()))
}

#[tauri::command]
fn cmd_kv_delete(state: State<AppState>, key: String) -> Result<(), CoreError> {
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.kv_delete(&key).map_err(|e| CoreError::storage(e.to_string()))
}

#[tauri::command]
fn cmd_kv_clear(state: State<AppState>) -> Result<(), CoreError> {
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.kv_clear().map_err(|e| CoreError::storage(e.to_string()))
}

// ── 文件存储命令 ──────────────────────────────────────────

#[tauri::command]
fn cmd_get_all_files(state: State<AppState>) -> Result<Vec<serde_json::Value>, CoreError> {
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.get_all_files().map_err(|e| CoreError::storage(e.to_string()))
}

#[tauri::command]
fn cmd_get_file(state: State<AppState>, id: String) -> Result<Option<serde_json::Value>, CoreError> {
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.get_file(&id).map_err(|e| CoreError::storage(e.to_string()))
}

#[tauri::command]
fn cmd_get_file_by_path(state: State<AppState>, path: String) -> Result<Option<serde_json::Value>, CoreError> {
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.get_file_by_path(&path).map_err(|e| CoreError::storage(e.to_string()))
}

#[tauri::command]
fn cmd_get_files_by_entity(state: State<AppState>, entity_id: String) -> Result<Vec<serde_json::Value>, CoreError> {
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.get_files_by_entity(&entity_id).map_err(|e| CoreError::storage(e.to_string()))
}

#[tauri::command]
fn cmd_put_file(state: State<AppState>, file_json: String, content_json: String) -> Result<(), CoreError> {
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.put_file(&file_json, &content_json).map_err(|e| CoreError::storage(e.to_string()))
}

#[tauri::command]
fn cmd_update_file(state: State<AppState>, id: String, changes_json: String) -> Result<bool, CoreError> {
    let changes: serde_json::Value = serde_json::from_str(&changes_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.update_file(&id, &changes).map_err(|e| CoreError::storage(e.to_string()))
}

#[tauri::command]
fn cmd_delete_file(state: State<AppState>, id: String) -> Result<bool, CoreError> {
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.delete_file(&id).map_err(|e| CoreError::storage(e.to_string()))
}

#[tauri::command]
fn cmd_get_file_content(state: State<AppState>, id: String) -> Result<Option<serde_json::Value>, CoreError> {
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    db.get_file_content(&id).map_err(|e| CoreError::storage(e.to_string()))
}

#[tauri::command]
fn cmd_validate_entity(
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
fn cmd_validate_entities(
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
fn cmd_validate_pack(pack_json: String) -> Result<ValidationReport, CoreError> {
    let pack: WorldSmithPack = serde_json::from_str(&pack_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    Ok(validate_pack(&pack))
}

#[tauri::command]
fn cmd_check_references(
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
struct MigrateOutput {
    result: worldsmith_core::migrate::engine::MigrationResult,
    data: serde_json::Value,
}

#[tauri::command]
fn cmd_migrate(pack_json: String, from_version: u32) -> Result<MigrateOutput, CoreError> {
    let mut pack_data: serde_json::Value = serde_json::from_str(&pack_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let result = migrate_pack(&mut pack_data, from_version);
    Ok(MigrateOutput { result, data: pack_data })
}

#[tauri::command]
fn cmd_run_diagnostics(
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
fn cmd_check_storage_health(state: State<AppState>) -> Result<worldsmith_core::doctor::storage::StorageHealthReport, CoreError> {
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    Ok(check_storage_health(&*db))
}

#[tauri::command]
fn cmd_validate_plugin_manifest(manifest_json: String) -> Result<worldsmith_core::models::plugin::ManifestValidationResult, CoreError> {
    let manifest: PluginManifest = serde_json::from_str(&manifest_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    Ok(validate_manifest(&manifest))
}

#[tauri::command]
fn cmd_check_plugin_health(
    manifests_json: String,
    active_ids_json: String,
) -> Result<worldsmith_core::doctor::plugin::PluginHealthReport, CoreError> {
    let manifests: Vec<PluginManifest> = serde_json::from_str(&manifests_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let active_ids: Vec<String> = serde_json::from_str(&active_ids_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    Ok(check_plugin_health(&manifests, &active_ids))
}

#[tauri::command]
fn cmd_retrofit_begin_session(
    state: State<AppState>,
    session_id: String,
    catalog_json: Option<String>,
) -> Result<(), CoreError> {
    let catalog = catalog_json
        .as_deref()
        .and_then(|s| serde_json::from_str::<CapabilityCatalog>(s).ok())
        .unwrap_or_else(CapabilityCatalog::permissive);
    let mut engine = state.retrofit.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    engine.begin_session(&session_id, catalog)?;
    Ok(())
}

#[tauri::command]
fn cmd_retrofit_submit_intent(
    state: State<AppState>,
    intent_json: String,
) -> Result<SafetyReport, CoreError> {
    let intent: RetrofitIntent = serde_json::from_str(&intent_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let mut engine = state.retrofit.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    engine.submit_intent(intent)
}

#[tauri::command]
fn cmd_retrofit_confirm_and_stage(
    state: State<AppState>,
) -> Result<ConfirmResult, CoreError> {
    let mut engine = state.retrofit.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    engine.confirm_and_stage()
}

#[tauri::command]
fn cmd_retrofit_apply_next(
    state: State<AppState>,
    before_json: String,
    after_json: String,
) -> Result<Option<ApplyResult>, CoreError> {
    let before: serde_json::Value = serde_json::from_str(&before_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let after: serde_json::Value = serde_json::from_str(&after_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let db = state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    let mut engine = state.retrofit.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    let mut storage_exec = worldsmith_core::retrofit::executor::StorageExecutor::new(&*db as &dyn worldsmith_core::storage::StorageBackend);
    engine.apply_next_with_executor(&mut storage_exec, before, after)
}

#[tauri::command]
fn cmd_retrofit_verify_and_accept(
    state: State<AppState>,
    entity_count: usize,
    relation_count: usize,
) -> Result<worldsmith_core::retrofit::RetrofitResult, CoreError> {
    let mut engine = state.retrofit.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    engine.verify_and_accept(entity_count, relation_count)
}

#[tauri::command]
fn cmd_retrofit_request_repair(
    state: State<AppState>,
    message: String,
) -> Result<(), CoreError> {
    let mut engine = state.retrofit.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    engine.request_repair(&message)
}

#[tauri::command]
fn cmd_retrofit_redirect(
    state: State<AppState>,
    message: String,
) -> Result<(), CoreError> {
    let mut engine = state.retrofit.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    engine.redirect(&message)
}

#[tauri::command]
fn cmd_retrofit_rollback_last(
    state: State<AppState>,
) -> Result<Option<String>, CoreError> {
    let mut engine = state.retrofit.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    engine.rollback_last()
}

#[tauri::command]
fn cmd_retrofit_abort(
    state: State<AppState>,
) -> Result<Vec<String>, CoreError> {
    let mut engine = state.retrofit.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    engine.abort()
}

#[tauri::command]
fn cmd_retrofit_session_phase(
    state: State<AppState>,
) -> Result<Option<SessionPhase>, CoreError> {
    let engine = state.retrofit.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    Ok(engine.session().map(|s| s.phase))
}

#[tauri::command]
fn cmd_retrofit_patch_diff(
    before_json: String,
    after_json: String,
) -> Result<serde_json::Value, CoreError> {
    let before: serde_json::Value = serde_json::from_str(&before_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let after: serde_json::Value = serde_json::from_str(&after_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let patch = JsonPatchDiff::diff(&before, &after);
    let estimate = JsonPatchDiff::estimate_token_saving(&before, &after);
    Ok(serde_json::json!({
        "operations": patch.operations,
        "tokenEstimate": estimate,
    }))
}

#[tauri::command]
fn cmd_retrofit_patch_apply(
    doc_json: String,
    patch_json: String,
) -> Result<String, CoreError> {
    let doc: serde_json::Value = serde_json::from_str(&doc_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let patch: JsonPatch = serde_json::from_str(&patch_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let result = patch.apply(&doc)?;
    serde_json::to_string(&result).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
fn cmd_retrofit_detect_conflicts(
    state: State<AppState>,
) -> Result<Option<ConflictReport>, CoreError> {
    let engine = state.retrofit.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    Ok(engine.detect_conflicts())
}

#[tauri::command]
fn cmd_retrofit_end_session(
    state: State<AppState>,
) -> Result<bool, CoreError> {
    let mut engine = state.retrofit.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    Ok(engine.end_session().is_some())
}

// ── 空间索引命令 ──

#[tauri::command]
fn cmd_spatial_insert_rect(
    state: State<AppState>,
    item_json: String,
) -> Result<(), CoreError> {
    let item: SpatialItem = serde_json::from_str(&item_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let mut idx = state.spatial.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    idx.insert_rect(item);
    Ok(())
}

#[tauri::command]
fn cmd_spatial_insert_point(
    state: State<AppState>,
    item_json: String,
) -> Result<(), CoreError> {
    let item: PointItem = serde_json::from_str(&item_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let mut idx = state.spatial.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    idx.insert_point(item);
    Ok(())
}

#[tauri::command]
fn cmd_spatial_query_range(
    state: State<AppState>,
    min_json: String,
    max_json: String,
) -> Result<Vec<SpatialItem>, CoreError> {
    let min: [f64; 2] = serde_json::from_str(&min_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let max: [f64; 2] = serde_json::from_str(&max_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let idx = state.spatial.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    Ok(idx.query_rect_in_range(min, max).into_iter().cloned().collect())
}

#[tauri::command]
fn cmd_spatial_query_at_point(
    state: State<AppState>,
    point_json: String,
) -> Result<Vec<SpatialItem>, CoreError> {
    let point: [f64; 2] = serde_json::from_str(&point_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let idx = state.spatial.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    Ok(idx.query_rect_at_point(point).into_iter().cloned().collect())
}

#[tauri::command]
fn cmd_spatial_nearest_point(
    state: State<AppState>,
    query_json: String,
) -> Result<Option<PointItem>, CoreError> {
    let query: [f64; 2] = serde_json::from_str(&query_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let idx = state.spatial.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    Ok(idx.nearest_point(query).cloned())
}

#[tauri::command]
fn cmd_spatial_k_nearest(
    state: State<AppState>,
    query_json: String,
    k: usize,
) -> Result<Vec<PointItem>, CoreError> {
    let query: [f64; 2] = serde_json::from_str(&query_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let idx = state.spatial.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    Ok(idx.k_nearest_points(query, k).into_iter().cloned().collect())
}

#[tauri::command]
fn cmd_spatial_query_by_category(
    state: State<AppState>,
    category: String,
) -> Result<Vec<SpatialItem>, CoreError> {
    let idx = state.spatial.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    Ok(idx.query_rects_by_category(&category).into_iter().cloned().collect())
}

#[tauri::command]
fn cmd_spatial_remove_rect(
    state: State<AppState>,
    item_json: String,
) -> Result<bool, CoreError> {
    let item: SpatialItem = serde_json::from_str(&item_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let mut idx = state.spatial.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    Ok(idx.remove_rect(&item))
}

#[tauri::command]
fn cmd_spatial_clear(state: State<AppState>) -> Result<(), CoreError> {
    let mut idx = state.spatial.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    idx.clear();
    Ok(())
}

#[tauri::command]
fn cmd_spatial_counts(state: State<AppState>) -> Result<serde_json::Value, CoreError> {
    let idx = state.spatial.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    Ok(serde_json::json!({
        "rectCount": idx.rect_count(),
        "pointCount": idx.point_count(),
    }))
}

// ── 几何算法命令（无状态） ──

#[tauri::command]
fn cmd_algo_segment_intersect(
    seg1_json: String,
    seg2_json: String,
) -> Result<bool, CoreError> {
    let s1: Segment2D = serde_json::from_str(&seg1_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let s2: Segment2D = serde_json::from_str(&seg2_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    Ok(s1.intersects(s2))
}

#[tauri::command]
fn cmd_algo_segment_intersection_point(
    seg1_json: String,
    seg2_json: String,
) -> Result<Option<Point2D>, CoreError> {
    let s1: Segment2D = serde_json::from_str(&seg1_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let s2: Segment2D = serde_json::from_str(&seg2_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    Ok(s1.intersection_point(s2))
}

#[tauri::command]
fn cmd_algo_find_all_intersections(
    segments_json: String,
) -> Result<serde_json::Value, CoreError> {
    let segments: Vec<Segment2D> = serde_json::from_str(&segments_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let results = find_all_intersections(&segments);
    Ok(serde_json::to_value(&results).map_err(|e| CoreError::serialize(e.to_string()))?)
}

#[tauri::command]
fn cmd_algo_point_in_polygon(
    point_json: String,
    vertices_json: String,
) -> Result<bool, CoreError> {
    let point: Point2D = serde_json::from_str(&point_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let vertices: Vec<Point2D> = serde_json::from_str(&vertices_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    Ok(point_in_polygon(point, &vertices))
}

#[tauri::command]
fn cmd_algo_polygon_area(vertices_json: String) -> Result<f64, CoreError> {
    let poly: Polygon2D = serde_json::from_str(&vertices_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    Ok(poly.area())
}

#[tauri::command]
fn cmd_algo_polygon_centroid(vertices_json: String) -> Result<Option<Point2D>, CoreError> {
    let poly: Polygon2D = serde_json::from_str(&vertices_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    Ok(poly.centroid())
}

#[tauri::command]
fn cmd_algo_convex_hull(points_json: String) -> Result<Vec<Point2D>, CoreError> {
    let points: Vec<Point2D> = serde_json::from_str(&points_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    Ok(convex_hull(&points))
}

#[tauri::command]
fn cmd_algo_aabb_intersects(
    a_json: String,
    b_json: String,
) -> Result<bool, CoreError> {
    let a: AABB2D = serde_json::from_str(&a_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let b: AABB2D = serde_json::from_str(&b_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    Ok(a.intersects(b))
}

#[tauri::command]
fn cmd_algo_obb_intersects(
    a_json: String,
    b_json: String,
) -> Result<bool, CoreError> {
    let a: OBB2D = serde_json::from_str(&a_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let b: OBB2D = serde_json::from_str(&b_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    Ok(a.intersects(b))
}

// ── 图算法命令（无状态） ──

#[tauri::command]
fn cmd_algo_dijkstra(
    graph_json: String,
    source: String,
) -> Result<serde_json::Value, CoreError> {
    let graph: WeightedGraph = serde_json::from_str(&graph_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let result = dijkstra(&graph, &source);
    serde_json::to_value(&result).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
fn cmd_algo_dijkstra_path(
    graph_json: String,
    source: String,
    target: String,
) -> Result<serde_json::Value, CoreError> {
    let graph: WeightedGraph = serde_json::from_str(&graph_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let result = dijkstra_path(&graph, &source, &target);
    serde_json::to_value(&result).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
fn cmd_algo_astar(
    graph_json: String,
    source: String,
    target: String,
    heuristic_json: String,
) -> Result<serde_json::Value, CoreError> {
    let graph: WeightedGraph = serde_json::from_str(&graph_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let heuristic_map: std::collections::HashMap<String, f64> = serde_json::from_str(&heuristic_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let result = astar(&graph, &source, &target, |node| {
        heuristic_map.get(node).copied().unwrap_or(f64::INFINITY)
    });
    serde_json::to_value(&result).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
fn cmd_algo_k_shortest_paths(
    graph_json: String,
    source: String,
    target: String,
    k: usize,
) -> Result<serde_json::Value, CoreError> {
    let graph: WeightedGraph = serde_json::from_str(&graph_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let result = k_shortest_paths(&graph, &source, &target, k);
    serde_json::to_value(&result).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
fn cmd_algo_topological_sort(
    graph_json: String,
) -> Result<serde_json::Value, CoreError> {
    let graph: WeightedGraph = serde_json::from_str(&graph_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let result = topological_sort(&graph);
    serde_json::to_value(&result).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
fn cmd_algo_connected_components(
    graph_json: String,
) -> Result<serde_json::Value, CoreError> {
    let graph: WeightedGraph = serde_json::from_str(&graph_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let result = connected_components(&graph);
    serde_json::to_value(&result).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
fn cmd_algo_tarjan_scc(
    graph_json: String,
) -> Result<serde_json::Value, CoreError> {
    let graph: WeightedGraph = serde_json::from_str(&graph_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let result = tarjan_scc(&graph);
    serde_json::to_value(&result).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
fn cmd_algo_find_dangling(
    graph_json: String,
) -> Result<serde_json::Value, CoreError> {
    let graph: WeightedGraph = serde_json::from_str(&graph_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let result = find_dangling_references(&graph);
    serde_json::to_value(&result).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
fn cmd_algo_force_layout(
    graph_json: String,
    config_json: Option<String>,
) -> Result<serde_json::Value, CoreError> {
    let graph: WeightedGraph = serde_json::from_str(&graph_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let config: ForceLayoutConfig = config_json
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();
    let result = force_directed_layout(&graph, &config);
    serde_json::to_value(&result).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
fn cmd_algo_grid_layout(
    graph_json: String,
    config_json: Option<String>,
) -> Result<serde_json::Value, CoreError> {
    let graph: WeightedGraph = serde_json::from_str(&graph_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let config: GridLayoutConfig = config_json
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();
    let result = grid_layout(&graph, &config);
    serde_json::to_value(&result).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
fn cmd_algo_radial_layout(
    graph_json: String,
    config_json: Option<String>,
) -> Result<serde_json::Value, CoreError> {
    let graph: WeightedGraph = serde_json::from_str(&graph_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let config: RadialLayoutConfig = config_json
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();
    let result = radial_layout(&graph, &config);
    serde_json::to_value(&result).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
fn cmd_algo_tree_layout(
    graph_json: String,
    config_json: String,
) -> Result<serde_json::Value, CoreError> {
    let graph: WeightedGraph = serde_json::from_str(&graph_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let config: TreeLayoutConfig = serde_json::from_str(&config_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let result = tree_layout(&graph, &config)
        .map_err(|e| CoreError::storage(e.to_string()))?;
    serde_json::to_value(&result).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
fn cmd_algo_layout_unified(
    graph_json: String,
    algorithm_json: String,
) -> Result<serde_json::Value, CoreError> {
    let graph: WeightedGraph = serde_json::from_str(&graph_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let algorithm: LayoutAlgorithm = serde_json::from_str(&algorithm_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let result = compute_layout(&graph, &algorithm)
        .map_err(|e| CoreError::storage(e.to_string()))?;
    serde_json::to_value(&result).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
fn cmd_algo_crdt_lww_new(
    value: String,
    node_id: String,
) -> Result<String, CoreError> {
    let reg = LWWRegister::new(value, node_id);
    serde_json::to_string(&reg).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
fn cmd_algo_crdt_lww_set(
    register_json: String,
    value: String,
    timestamp: u64,
) -> Result<String, CoreError> {
    let mut reg: LWWRegister<String> = serde_json::from_str(&register_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    reg.set(value, timestamp);
    serde_json::to_string(&reg).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
fn cmd_algo_crdt_lww_merge(
    register_json: String,
    other_json: String,
) -> Result<String, CoreError> {
    let mut reg: LWWRegister<String> = serde_json::from_str(&register_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let other: LWWRegister<String> = serde_json::from_str(&other_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    reg.merge(&other);
    serde_json::to_string(&reg).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
fn cmd_algo_crdt_orset_new(
    node_id: String,
) -> Result<String, CoreError> {
    let set = ORSet::<String>::new(node_id);
    serde_json::to_string(&set).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
fn cmd_algo_crdt_orset_add(
    set_json: String,
    element: String,
) -> Result<String, CoreError> {
    let mut set: ORSet<String> = serde_json::from_str(&set_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    set.add(element);
    serde_json::to_string(&set).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
fn cmd_algo_crdt_orset_remove(
    set_json: String,
    element: String,
) -> Result<String, CoreError> {
    let mut set: ORSet<String> = serde_json::from_str(&set_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    set.remove(&element);
    serde_json::to_string(&set).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
fn cmd_algo_crdt_orset_merge(
    set_json: String,
    other_json: String,
) -> Result<String, CoreError> {
    let mut set: ORSet<String> = serde_json::from_str(&set_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let other: ORSet<String> = serde_json::from_str(&other_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    set.merge(&other);
    serde_json::to_string(&set).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
fn cmd_algo_crdt_orset_elements(
    set_json: String,
) -> Result<serde_json::Value, CoreError> {
    let set: ORSet<String> = serde_json::from_str(&set_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let elements: Vec<&String> = set.elements();
    serde_json::to_value(&elements).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
fn cmd_algo_crdt_rga_new(
    node_id: String,
) -> Result<String, CoreError> {
    let rga = RGA::new(node_id);
    serde_json::to_string(&rga).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
fn cmd_algo_crdt_rga_insert(
    rga_json: String,
    index: usize,
    content: String,
) -> Result<serde_json::Value, CoreError> {
    let mut rga: RGA = serde_json::from_str(&rga_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let inserted_id = rga.insert(index, content);
    Ok(serde_json::json!({
        "rga": rga,
        "insertedId": inserted_id,
    }))
}

#[tauri::command]
fn cmd_algo_crdt_rga_delete(
    rga_json: String,
    id: String,
) -> Result<String, CoreError> {
    let mut rga: RGA = serde_json::from_str(&rga_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    rga.delete(&id);
    serde_json::to_string(&rga).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
fn cmd_algo_crdt_rga_merge(
    rga_json: String,
    other_json: String,
) -> Result<String, CoreError> {
    let mut rga: RGA = serde_json::from_str(&rga_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let other: RGA = serde_json::from_str(&other_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    rga.merge(&other);
    serde_json::to_string(&rga).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
fn cmd_algo_crdt_rga_text(
    rga_json: String,
) -> Result<String, CoreError> {
    let rga: RGA = serde_json::from_str(&rga_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    Ok(rga.text())
}

#[tauri::command]
fn cmd_algo_crdt_vc_compare(
    clock_a_json: String,
    clock_b_json: String,
) -> Result<serde_json::Value, CoreError> {
    let a: VectorClock = serde_json::from_str(&clock_a_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let b: VectorClock = serde_json::from_str(&clock_b_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    Ok(serde_json::json!({
        "happensBefore": a.happens_before(&b),
        "isConcurrent": a.is_concurrent(&b),
    }))
}

#[tauri::command]
fn cmd_algo_terrain_noise(
    x: f64,
    y: f64,
    config_json: Option<String>,
) -> Result<f64, CoreError> {
    let config: NoiseConfig = config_json
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();
    Ok(value_noise_2d(x, y, &config))
}

#[tauri::command]
fn cmd_algo_terrain_heightmap_generate(
    config_json: Option<String>,
    width: usize,
    height: usize,
    offset_x: f64,
    offset_y: f64,
) -> Result<String, CoreError> {
    let config: NoiseConfig = config_json
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();
    let map = HeightMap::generate(&config, width, height, offset_x, offset_y);
    serde_json::to_string(&map).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
fn cmd_algo_terrain_heightmap_slope(
    heightmap_json: String,
    x: usize,
    y: usize,
) -> Result<serde_json::Value, CoreError> {
    let map: HeightMap = serde_json::from_str(&heightmap_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let (dx, dy) = map.slope_at(x, y);
    let magnitude = map.slope_magnitude_at(x, y);
    Ok(serde_json::json!({
        "dx": dx,
        "dy": dy,
        "magnitude": magnitude,
    }))
}

#[tauri::command]
fn cmd_algo_terrain_heightmap_aspect(
    heightmap_json: String,
    x: usize,
    y: usize,
) -> Result<f64, CoreError> {
    let map: HeightMap = serde_json::from_str(&heightmap_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    Ok(map.aspect_at(x, y))
}

#[tauri::command]
fn cmd_algo_terrain_marching_squares(
    heightmap_json: String,
    levels_json: String,
) -> Result<serde_json::Value, CoreError> {
    let map: HeightMap = serde_json::from_str(&heightmap_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let levels: Vec<f64> = serde_json::from_str(&levels_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let contours = marching_squares(&map, &levels);
    serde_json::to_value(&contours).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
fn cmd_algo_constraint_solve(
    system_json: String,
    max_iterations: usize,
    tolerance: f64,
) -> Result<serde_json::Value, CoreError> {
    let mut system: ConstraintSystem = serde_json::from_str(&system_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let result = system.solve(max_iterations, tolerance);
    Ok(serde_json::json!({
        "result": result,
        "system": system,
    }))
}

#[tauri::command]
fn cmd_algo_dxf_parse(content: String) -> Result<serde_json::Value, CoreError> {
    let result = dxf_io::parse_dxf(&content).map_err(|e| CoreError::deserialize(e.to_string()))?;
    serde_json::to_value(&result).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
fn cmd_algo_dxf_generate(entities_json: String) -> Result<String, CoreError> {
    let entities: Vec<dxf_io::DxfEntity> = serde_json::from_str(&entities_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    dxf_io::generate_dxf(&entities).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
fn cmd_algo_dxf_extract_constraints(system_json: String) -> Result<serde_json::Value, CoreError> {
    let system: worldsmith_core::algo::draft::constraint::ConstraintSystem = serde_json::from_str(&system_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let constraints = dxf_io::extract_horizontal_vertical_constraints(&system);
    serde_json::to_value(&constraints).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
fn cmd_algo_polygon_boolean(op: String, a_json: String, b_json: String) -> Result<serde_json::Value, CoreError> {
    let boolean_op = match op.as_str() {
        "union" => boolean::BooleanOp::Union,
        "intersection" => boolean::BooleanOp::Intersection,
        "difference" => boolean::BooleanOp::Difference,
        "xor" => boolean::BooleanOp::Xor,
        _ => return Err(CoreError::deserialize("op must be union/intersection/difference/xor".to_string())),
    };
    let a: boolean::Polygon2DResult = serde_json::from_str(&a_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let b: boolean::Polygon2DResult = serde_json::from_str(&b_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let result = boolean::polygon_boolean_op(&boolean_op, &a.exterior, &a.interiors, &b.exterior, &b.interiors);
    serde_json::to_value(&result).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
fn cmd_algo_polygon_offset(polygon_json: String, delta: f64) -> Result<String, CoreError> {
    let poly: boolean::Polygon2DResult = serde_json::from_str(&polygon_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let result = boolean::polygon_offset(&poly.exterior, &poly.interiors, delta);
    serde_json::to_string(&result).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
fn cmd_algo_polygon_simplify(polygon_json: String, epsilon: f64) -> Result<String, CoreError> {
    let poly: boolean::Polygon2DResult = serde_json::from_str(&polygon_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let result = boolean::polygon_simplify(&poly.exterior, &poly.interiors, epsilon);
    serde_json::to_string(&result).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
fn cmd_algo_line_length(points_json: String) -> Result<f64, CoreError> {
    let points: Vec<worldsmith_core::algo::geometry::line::Point2D> = serde_json::from_str(&points_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    Ok(boolean::line_length(&points))
}

#[tauri::command]
fn cmd_algo_pagerank(graph_json: String, damping: f64, max_iterations: usize, tolerance: f64) -> Result<serde_json::Value, CoreError> {
    let graph = serde_json::from_str::<worldsmith_core::algo::graph::pathfind::WeightedGraph>(&graph_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let result = community::pagerank(&graph, damping, max_iterations, tolerance);
    serde_json::to_value(&result).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
fn cmd_algo_community_detection(graph_json: String) -> Result<serde_json::Value, CoreError> {
    let graph = serde_json::from_str::<worldsmith_core::algo::graph::pathfind::WeightedGraph>(&graph_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let result = community::louvain_communities(&graph);
    serde_json::to_value(&result).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
fn cmd_algo_betweenness_centrality(graph_json: String) -> Result<serde_json::Value, CoreError> {
    let graph = serde_json::from_str::<worldsmith_core::algo::graph::pathfind::WeightedGraph>(&graph_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let result = community::betweenness_centrality(&graph);
    serde_json::to_value(&result).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
fn cmd_algo_hydraulic_erosion(heightmap_json: String, config_json: Option<String>) -> Result<String, CoreError> {
    let mut map = serde_json::from_str::<worldsmith_core::algo::terrain::terrain::HeightMap>(&heightmap_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let config: erosion::ErosionConfig = config_json
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();
    erosion::hydraulic_erosion(&mut map, &config);
    serde_json::to_string(&map).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
fn cmd_algo_viewshed(heightmap_json: String, observer_x: usize, observer_y: usize, observer_height: f64, radius: f64) -> Result<serde_json::Value, CoreError> {
    let map = serde_json::from_str::<worldsmith_core::algo::terrain::terrain::HeightMap>(&heightmap_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let result = erosion::viewshed(&map, observer_x, observer_y, observer_height, radius);
    serde_json::to_value(&result).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
fn cmd_algo_chaikin_smooth(vertices_json: String, iterations: usize) -> Result<String, CoreError> {
    let vertices: Vec<Point2D> = serde_json::from_str(&vertices_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let result = chaikin_smooth(&vertices, iterations);
    serde_json::to_string(&result).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
fn cmd_algo_find_shared_edges(vertices_a_json: String, vertices_b_json: String, threshold: f64) -> Result<serde_json::Value, CoreError> {
    let a: Vec<Point2D> = serde_json::from_str(&vertices_a_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let b: Vec<Point2D> = serde_json::from_str(&vertices_b_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let result = find_shared_edges(&a, &b, threshold);
    serde_json::to_value(&result).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
fn cmd_algo_find_line_polygon_intersections(line_json: String, polygon_json: String) -> Result<serde_json::Value, CoreError> {
    let line: Vec<Point2D> = serde_json::from_str(&line_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let polygon: Vec<Point2D> = serde_json::from_str(&polygon_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let result = find_line_polygon_intersections(&line, &polygon);
    serde_json::to_value(&result).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
fn cmd_algo_polygon_split(polygon_json: String, cutting_line_json: String) -> Result<serde_json::Value, CoreError> {
    let polygon: Vec<Point2D> = serde_json::from_str(&polygon_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let cutting: Vec<Point2D> = serde_json::from_str(&cutting_line_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let result = polygon_split(&polygon, &cutting);
    serde_json::to_value(&result).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
fn cmd_algo_polygon_augment(polygon_json: String, adding_line_json: String) -> Result<String, CoreError> {
    let polygon: Vec<Point2D> = serde_json::from_str(&polygon_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let adding: Vec<Point2D> = serde_json::from_str(&adding_line_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let result = polygon_augment(&polygon, &adding);
    serde_json::to_string(&result).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
fn cmd_schema_register_entity_type(state: State<AppState>, schema_json: String) -> Result<String, CoreError> {
    let schema: worldsmith_core::schema::EntityTypeSchema = serde_json::from_str(&schema_json)
        .map_err(|e| CoreError::SchemaError(format!("Invalid schema JSON: {}", e)))?;
    let mut reg = state.schema.lock().map_err(|e| CoreError::SchemaError(e.to_string()))?;
    reg.register(schema.clone()).map_err(CoreError::SchemaError)?;
    Ok(serde_json::to_string(&schema).unwrap())
}

#[tauri::command]
fn cmd_schema_unregister_entity_type(state: State<AppState>, type_key: String) -> Result<(), CoreError> {
    let mut reg = state.schema.lock().map_err(|e| CoreError::SchemaError(e.to_string()))?;
    reg.unregister(&type_key);
    Ok(())
}

#[tauri::command]
fn cmd_schema_get_entity_type(state: State<AppState>, type_key: String) -> Result<String, CoreError> {
    let reg = state.schema.lock().map_err(|e| CoreError::SchemaError(e.to_string()))?;
    let schema = reg.get(&type_key)
        .ok_or_else(|| CoreError::SchemaError(format!("Entity type '{}' not found", type_key)))?;
    Ok(serde_json::to_string(schema).unwrap())
}

#[tauri::command]
fn cmd_schema_list_entity_types(state: State<AppState>) -> Result<String, CoreError> {
    let reg = state.schema.lock().map_err(|e| CoreError::SchemaError(e.to_string()))?;
    let list = reg.list_all();
    Ok(serde_json::to_string(&list).unwrap())
}

#[tauri::command]
fn cmd_schema_update_entity_type(state: State<AppState>, type_key: String, updates_json: String) -> Result<String, CoreError> {
    let updates: worldsmith_core::schema::EntityTypeSchema = serde_json::from_str(&updates_json)
        .map_err(|e| CoreError::SchemaError(format!("Invalid updates JSON: {}", e)))?;
    let mut reg = state.schema.lock().map_err(|e| CoreError::SchemaError(e.to_string()))?;
    reg.unregister(&type_key);
    reg.register(updates.clone()).map_err(CoreError::SchemaError)?;
    Ok(serde_json::to_string(&updates).unwrap())
}

#[tauri::command]
fn cmd_schema_register_validation(state: State<AppState>, type_key: String, rule_json: String) -> Result<(), CoreError> {
    let rule: worldsmith_core::schema::ValidationRule = serde_json::from_str(&rule_json)
        .map_err(|e| CoreError::SchemaError(format!("Invalid rule JSON: {}", e)))?;
    let mut reg = state.schema.lock().map_err(|e| CoreError::SchemaError(e.to_string()))?;
    reg.add_validation(&type_key, rule).map_err(CoreError::SchemaError)
}

#[tauri::command]
fn cmd_schema_register_view(state: State<AppState>, type_key: String, view_json: String) -> Result<(), CoreError> {
    let view: worldsmith_core::schema::ViewDeclaration = serde_json::from_str(&view_json)
        .map_err(|e| CoreError::SchemaError(format!("Invalid view JSON: {}", e)))?;
    let mut reg = state.schema.lock().map_err(|e| CoreError::SchemaError(e.to_string()))?;
    reg.add_view(&type_key, view).map_err(CoreError::SchemaError)
}

#[tauri::command]
fn cmd_mcp_spawn(state: State<AppState>, server_id: String, command: String, args: Vec<String>) -> Result<(), CoreError> {
    let child = std::process::Command::new(&command)
        .args(&args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| CoreError::InvalidArgument(format!("Failed to spawn MCP server: {}", e)))?;
    let mut processes = state.mcp_processes.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    processes.insert(server_id, child);
    Ok(())
}

#[tauri::command]
fn cmd_mcp_kill(state: State<AppState>, server_id: String) -> Result<(), CoreError> {
    let mut processes = state.mcp_processes.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    if let Some(mut child) = processes.remove(&server_id) {
        let _ = child.kill();
    }
    Ok(())
}

#[tauri::command]
fn cmd_mcp_list(state: State<AppState>) -> Result<Vec<String>, CoreError> {
    let processes = state.mcp_processes.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    Ok(processes.keys().cloned().collect())
}

#[derive(Serialize, Deserialize, Clone)]
struct SystemFontInfo {
    family: String,
    path: String,
    weight: u32,
    style: String,
    format: String,
}

#[tauri::command]
fn cmd_font_scan_system() -> Result<Vec<SystemFontInfo>, CoreError> {
    let mut fonts = Vec::new();

    #[cfg(target_os = "windows")]
    {
        let font_dir = std::path::Path::new("C:\\Windows\\Fonts");
        if font_dir.exists() {
            if let Ok(entries) = std::fs::read_dir(font_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    let ext = path.extension()
                        .and_then(|e| e.to_str())
                        .map(|e| e.to_lowercase())
                        .unwrap_or_default();

                    if !matches!(ext.as_str(), "ttf" | "otf" | "ttc" | "woff" | "woff2") {
                        continue;
                    }

                    let file_name = path.file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or("Unknown")
                        .to_string();

                    let format = match ext.as_str() {
                        "woff2" => "woff2",
                        "woff" => "woff",
                        "otf" => "opentype",
                        _ => "truetype",
                    }.to_string();

                    let family = file_name
                        .replace(['-', '_'], " ")
                        .split_whitespace()
                        .map(|w| {
                            let mut c = w.chars();
                            match c.next() {
                                None => String::new(),
                                Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                            }
                        })
                        .collect::<Vec<_>>()
                        .join(" ");

                    let (weight, style) = parse_font_meta(&file_name);

                    fonts.push(SystemFontInfo {
                        family,
                        path: path.to_string_lossy().to_string(),
                        weight,
                        style,
                        format,
                    });
                }
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        let dirs = vec![
            "/Library/Fonts",
            "/System/Library/Fonts",
        ];
        for dir_path in dirs {
            let font_dir = std::path::Path::new(dir_path);
            if font_dir.exists() {
                if let Ok(entries) = std::fs::read_dir(font_dir) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        let ext = path.extension()
                            .and_then(|e| e.to_str())
                            .map(|e| e.to_lowercase())
                            .unwrap_or_default();
                        if !matches!(ext.as_str(), "ttf" | "otf" | "ttc" | "woff" | "woff2") {
                            continue;
                        }
                        let file_name = path.file_stem()
                            .and_then(|s| s.to_str())
                            .unwrap_or("Unknown")
                            .to_string();
                        let format = match ext.as_str() {
                            "woff2" => "woff2",
                            "woff" => "woff",
                            "otf" => "opentype",
                            _ => "truetype",
                        }.to_string();
                        let family = file_name.replace(['-', '_'], " ");
                        let (weight, style) = parse_font_meta(&file_name);
                        fonts.push(SystemFontInfo {
                            family,
                            path: path.to_string_lossy().to_string(),
                            weight,
                            style,
                            format,
                        });
                    }
                }
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        let dirs = vec![
            "/usr/share/fonts",
            "/usr/local/share/fonts",
        ];
        for dir_path in dirs {
            let font_dir = std::path::Path::new(dir_path);
            if font_dir.exists() {
                if let Ok(entries) = std::fs::read_dir(font_dir) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if path.is_dir() { continue; }
                        let ext = path.extension()
                            .and_then(|e| e.to_str())
                            .map(|e| e.to_lowercase())
                            .unwrap_or_default();
                        if !matches!(ext.as_str(), "ttf" | "otf" | "ttc" | "woff" | "woff2") {
                            continue;
                        }
                        let file_name = path.file_stem()
                            .and_then(|s| s.to_str())
                            .unwrap_or("Unknown")
                            .to_string();
                        let format = match ext.as_str() {
                            "woff2" => "woff2",
                            "woff" => "woff",
                            "otf" => "opentype",
                            _ => "truetype",
                        }.to_string();
                        let family = file_name.replace(['-', '_'], " ");
                        let (weight, style) = parse_font_meta(&file_name);
                        fonts.push(SystemFontInfo {
                            family,
                            path: path.to_string_lossy().to_string(),
                            weight,
                            style,
                            format,
                        });
                    }
                }
            }
        }
    }

    Ok(fonts)
}

fn parse_font_meta(file_name: &str) -> (u32, String) {
    let lower = file_name.to_lowercase();
    let weight = if lower.contains("thin") || lower.contains("hairline") {
        100
    } else if lower.contains("extralight") || lower.contains("ultralight") {
        200
    } else if lower.contains("light") {
        300
    } else if lower.contains("medium") {
        500
    } else if lower.contains("semibold") || lower.contains("demibold") || lower.contains("demi") {
        600
    } else if lower.contains("extrabold") || lower.contains("ultrabold") {
        800
    } else if lower.contains("black") || lower.contains("heavy") {
        900
    } else if lower.contains("bold") {
        700
    } else {
        400
    };
    let style = if lower.contains("italic") || lower.contains("oblique") {
        "italic".to_string()
    } else {
        "normal".to_string()
    };
    (weight, style)
}

#[tauri::command]
fn cmd_font_read_file(path: String) -> Result<Vec<u8>, CoreError> {
    std::fs::read(&path).map_err(|e| CoreError::storage(format!("Failed to read font file '{}': {}", path, e)))
}

// ── 原生文件系统 API（不依赖 Shell） ──

#[derive(Serialize)]
struct FsEntry {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
    modified: Option<String>,
}

#[derive(Serialize)]
struct FsStat {
    exists: bool,
    is_dir: bool,
    is_file: bool,
    size: u64,
    modified: Option<String>,
    created: Option<String>,
    readonly: bool,
}

/// 获取已安装 Skills 的根目录路径（app_data_dir/skills），并确保目录存在。
/// 供 Skills Store 动态加载已安装技能使用。前端通过此路径 + cmd_fs_list/cmd_fs_read
/// 扫描并加载已安装技能的 manifest 与提示词文件。
#[tauri::command]
fn cmd_skills_get_dir(app: tauri::AppHandle) -> Result<String, CoreError> {
    let data_dir = app.path().app_data_dir()
        .map_err(|e| CoreError::storage(format!("获取 app data 目录失败: {e}")))?;
    let skills_dir = data_dir.join("skills");
    std::fs::create_dir_all(&skills_dir)
        .map_err(|e| CoreError::storage(format!("创建 skills 目录失败: {e}")))?;
    Ok(skills_dir.to_string_lossy().to_string())
}

#[tauri::command]
fn cmd_fs_read(path: String, encoding: Option<String>) -> Result<String, CoreError> {
    let enc = encoding.unwrap_or_else(|| "utf-8".to_string());
    if enc.to_lowercase() == "base64" {
        let bytes = std::fs::read(&path).map_err(|e| CoreError::storage(format!("Failed to read file '{}': {}", path, e)))?;
        Ok(base64_encode(&bytes))
    } else {
        std::fs::read_to_string(&path).map_err(|e| CoreError::storage(format!("Failed to read file '{}': {}", path, e)))
    }
}

#[tauri::command]
fn cmd_fs_read_binary(path: String) -> Result<Vec<u8>, CoreError> {
    std::fs::read(&path).map_err(|e| CoreError::storage(format!("Failed to read file '{}': {}", path, e)))
}

#[tauri::command]
fn cmd_fs_write(path: String, content: String, create_dirs: Option<bool>) -> Result<(), CoreError> {
    if create_dirs.unwrap_or(false) {
        if let Some(parent) = std::path::Path::new(&path).parent() {
            std::fs::create_dir_all(parent).map_err(|e| CoreError::storage(format!("Failed to create dirs for '{}': {}", path, e)))?;
        }
    }
    std::fs::write(&path, &content).map_err(|e| CoreError::storage(format!("Failed to write file '{}': {}", path, e)))
}

#[tauri::command]
fn cmd_fs_write_binary(path: String, data: Vec<u8>, create_dirs: Option<bool>) -> Result<(), CoreError> {
    if create_dirs.unwrap_or(false) {
        if let Some(parent) = std::path::Path::new(&path).parent() {
            std::fs::create_dir_all(parent).map_err(|e| CoreError::storage(format!("Failed to create dirs for '{}': {}", path, e)))?;
        }
    }
    std::fs::write(&path, &data).map_err(|e| CoreError::storage(format!("Failed to write file '{}': {}", path, e)))
}

#[tauri::command]
fn cmd_fs_list(path: String, recursive: Option<bool>) -> Result<Vec<FsEntry>, CoreError> {
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
        if p == root { continue; }
        let meta = entry.metadata().ok();
        entries.push(FsEntry {
            name: p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
            path: p.to_string_lossy().to_string(),
            is_dir: entry.file_type().is_dir(),
            size: meta.as_ref().map(|m| m.len()).unwrap_or(0),
            modified: meta.as_ref().and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs().to_string()),
        });
    }
    Ok(entries)
}

#[tauri::command]
fn cmd_fs_mkdir(path: String, recursive: Option<bool>) -> Result<(), CoreError> {
    if recursive.unwrap_or(true) {
        std::fs::create_dir_all(&path).map_err(|e| CoreError::storage(format!("Failed to create directory '{}': {}", path, e)))
    } else {
        std::fs::create_dir(&path).map_err(|e| CoreError::storage(format!("Failed to create directory '{}': {}", path, e)))
    }
}

#[tauri::command]
fn cmd_fs_stat(path: String) -> Result<FsStat, CoreError> {
    let _p = std::path::Path::new(&path);
    match std::fs::metadata(&path) {
        Ok(meta) => Ok(FsStat {
            exists: true,
            is_dir: meta.is_dir(),
            is_file: meta.is_file(),
            size: meta.len(),
            modified: meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs().to_string()),
            created: meta.created().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs().to_string()),
            readonly: meta.permissions().readonly(),
        }),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(FsStat {
            exists: false, is_dir: false, is_file: false, size: 0, modified: None, created: None, readonly: false,
        }),
        Err(e) => Err(CoreError::storage(format!("Failed to stat '{}': {}", path, e))),
    }
}

#[tauri::command]
fn cmd_fs_copy(source: String, destination: String) -> Result<(), CoreError> {
    let src = std::path::Path::new(&source);
    if src.is_dir() {
        // For directories, we need to copy recursively
        copy_dir_recursive(src, std::path::Path::new(&destination))
    } else {
        std::fs::copy(&source, &destination).map_err(|e| CoreError::storage(format!("Failed to copy '{}' to '{}': {}", source, destination, e)))?;
        Ok(())
    }
}

#[tauri::command]
fn cmd_fs_rename(source: String, destination: String) -> Result<(), CoreError> {
    std::fs::rename(&source, &destination).map_err(|e| CoreError::storage(format!("Failed to rename '{}' to '{}': {}", source, destination, e)))
}

#[tauri::command]
fn cmd_fs_delete(path: String, recursive: Option<bool>) -> Result<(), CoreError> {
    let p = std::path::Path::new(&path);
    if p.is_dir() {
        if recursive.unwrap_or(false) {
            std::fs::remove_dir_all(&path).map_err(|e| CoreError::storage(format!("Failed to delete directory '{}': {}", path, e)))
        } else {
            std::fs::remove_dir(&path).map_err(|e| CoreError::storage(format!("Failed to delete directory '{}': {}", path, e)))
        }
    } else {
        std::fs::remove_file(&path).map_err(|e| CoreError::storage(format!("Failed to delete file '{}': {}", path, e)))
    }
}

#[tauri::command]
fn cmd_fs_search(path: String, pattern: String, search_type: Option<String>) -> Result<Vec<FsEntry>, CoreError> {
    let stype = search_type.unwrap_or_else(|| "glob".to_string());
    let mut results = Vec::new();
    if stype == "content" {
        // Search file contents - return files that contain the pattern
        for entry in walkdir::WalkDir::new(&path).max_depth(5).into_iter().filter_map(|e| e.ok()) {
            if entry.file_type().is_file() {
                if let Ok(content) = std::fs::read_to_string(entry.path()) {
                    if content.contains(&pattern) {
                        let meta = entry.metadata().ok();
                        results.push(FsEntry {
                            name: entry.file_name().to_string_lossy().to_string(),
                            path: entry.path().to_string_lossy().to_string(),
                            is_dir: false,
                            size: meta.as_ref().map(|m| m.len()).unwrap_or(0),
                            modified: meta.as_ref().and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs().to_string()),
                        });
                        if results.len() >= 30 { break; }
                    }
                }
            }
        }
    } else {
        // Glob search by filename
        for entry in walkdir::WalkDir::new(&path).max_depth(5).into_iter().filter_map(|e| e.ok()) {
            let name = entry.file_name().to_string_lossy();
            if glob_match(&pattern, &name) {
                let meta = entry.metadata().ok();
                results.push(FsEntry {
                    name: name.to_string(),
                    path: entry.path().to_string_lossy().to_string(),
                    is_dir: entry.file_type().is_dir(),
                    size: meta.as_ref().map(|m| m.len()).unwrap_or(0),
                    modified: meta.as_ref().and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs().to_string()),
                });
                if results.len() >= 50 { break; }
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
        if p[i-1] == '*' { dp[i][0] = dp[i-1][0]; }
    }
    for i in 1..=p.len() {
        for j in 1..=t.len() {
            if p[i-1] == '*' {
                dp[i][j] = dp[i-1][j] || dp[i][j-1];
            } else if p[i-1] == '?' || p[i-1] == t[j-1] {
                dp[i][j] = dp[i-1][j-1];
            }
        }
    }
    dp[p.len()][t.len()]
}

// ── 文件监听（notify crate） ──────────────────────────────────

use notify::{RecommendedWatcher, RecursiveMode, Event, EventKind, Config as WatcherConfig, Watcher};
use std::sync::mpsc;

/// 文件变更事件（发送到前端）
#[derive(Clone, Serialize)]
struct FsChangeEvent {
    /// 变更类型：create / modify / remove / other
    kind: String,
    /// 受影响的文件路径列表
    paths: Vec<String>,
}

/// 启动项目目录监听。
/// 变更事件通过 Tauri event `fs:change` 推送到前端。
#[tauri::command]
fn cmd_fs_watch_start(app: tauri::AppHandle, path: String, watch_id: String) -> Result<String, CoreError> {
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
    ).map_err(|e| CoreError::storage(format!("Failed to create watcher: {}", e)))?;

    watcher.watch(std::path::Path::new(&path), RecursiveMode::Recursive)
        .map_err(|e| CoreError::storage(format!("Failed to watch '{}': {}", path, e)))?;

    // 将 watcher 存入 app state
    let state = app.state::<FsWatcherState>();
    let mut watchers = state.watchers.lock().unwrap();
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
            let paths: Vec<String> = event.paths.iter()
                .map(|p| p.to_string_lossy().to_string())
                .collect();
            let change = FsChangeEvent { kind: kind.to_string(), paths };
            let _ = app_handle.emit("fs:change", serde_json::json!({
                "watchId": wid,
                "kind": change.kind,
                "paths": change.paths,
            }));
        }
    });

    Ok(watch_id)
}

/// 停止目录监听
#[tauri::command]
fn cmd_fs_watch_stop(app: tauri::AppHandle, watch_id: String) -> Result<(), CoreError> {
    let state = app.state::<FsWatcherState>();
    let mut watchers = state.watchers.lock().unwrap();
    if watchers.remove(&watch_id).is_some() {
        Ok(())
    } else {
        Err(CoreError::storage(format!("Watcher '{}' not found", watch_id)))
    }
}

/// 文件监听状态管理
struct FsWatcherState {
    watchers: Mutex<std::collections::HashMap<String, RecommendedWatcher>>,
}

/// Copy directory recursively
fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> Result<(), CoreError> {
    std::fs::create_dir_all(dst).map_err(|e| CoreError::storage(format!("Failed to create directory '{}': {}", dst.display(), e)))?;
    for entry in std::fs::read_dir(src).map_err(|e| CoreError::storage(format!("Failed to read directory '{}': {}", src.display(), e)))? {
        let entry = entry.map_err(|e| CoreError::storage(format!("Failed to read entry: {}", e)))?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path).map_err(|e| CoreError::storage(format!("Failed to copy '{}': {}", src_path.display(), e)))?;
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
        if chunk.len() > 1 { result.push(CHARS[((triple >> 6) & 0x3F) as usize] as char); } else { result.push('='); }
        if chunk.len() > 2 { result.push(CHARS[(triple & 0x3F) as usize] as char); } else { result.push('='); }
    }
    result
}

#[tauri::command]
fn cmd_pty_spawn(
    app: tauri::AppHandle,
    state: State<AppState>,
    id: String,
    shell: Option<String>,
    cwd: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<(), CoreError> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.unwrap_or(24),
            cols: cols.unwrap_or(80),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| CoreError::InvalidArgument(format!("PTY open failed: {}", e)))?;

    let mut cmd = CommandBuilder::new(shell.unwrap_or_else(|| {
        if cfg!(target_os = "windows") { "cmd.exe".to_string() } else { "sh".to_string() }
    }));
    if let Some(cwd) = cwd { cmd.cwd(cwd); }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| CoreError::InvalidArgument(format!("PTY spawn failed: {}", e)))?;

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| CoreError::InvalidArgument(format!("PTY reader failed: {}", e)))?;

    let (kill_tx, mut kill_rx) = tokio::sync::oneshot::channel::<()>();
    let pty_id = id.clone();
    let app_handle = app.clone();

    // 创建输出 channel，供 cmd_shell_session_exec 直接读取
    let (output_tx, output_rx): (std::sync::mpsc::Sender<String>, std::sync::mpsc::Receiver<String>) = std::sync::mpsc::channel();

    let output_tx_clone = output_tx.clone();
    std::thread::spawn(move || {
        let mut buf_reader = BufReader::new(reader);
        let mut line = String::new();
        loop {
            line.clear();
            match buf_reader.read_line(&mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    let _ = app_handle.emit(&format!("pty-output-{}", pty_id), &line);
                    // 同时发送到 channel，供 session_exec 读取
                    let _ = output_tx_clone.send(line.clone());
                }
            }
            if kill_rx.try_recv().is_ok() { break; }
        }
    });

    let master = pair.master;
    let writer = master.take_writer().map_err(|e| CoreError::InvalidArgument(format!("PTY writer failed: {}", e)))?;
    let mut processes = state.pty_processes.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    processes.insert(id.clone(), PtyProcess {
        master,
        writer,
        _child: child,
        kill_tx: std::sync::Mutex::new(Some(kill_tx)),
        output_tx: std::sync::Mutex::new(Some(output_tx)),
    });

    // 将 output_rx 存到全局 map 中供 session_exec 使用
    {
        let mut rx_map = state.pty_output_receivers.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
        rx_map.insert(id.clone(), output_rx);
    }

    Ok(())
}

#[tauri::command]
fn cmd_pty_write(state: State<AppState>, id: String, data: String) -> Result<(), CoreError> {
    let mut processes = state.pty_processes.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    let pty = processes.get_mut(&id).ok_or_else(|| CoreError::InvalidArgument("PTY not found".to_string()))?;
    pty.writer.write_all(data.as_bytes()).map_err(|e| CoreError::InvalidArgument(format!("PTY write failed: {}", e)))?;
    Ok(())
}

#[tauri::command]
fn cmd_pty_resize(state: State<AppState>, id: String, cols: u16, rows: u16) -> Result<(), CoreError> {
    let processes = state.pty_processes.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    let pty = processes.get(&id).ok_or_else(|| CoreError::InvalidArgument("PTY not found".to_string()))?;
    pty.master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 }).map_err(|e| CoreError::InvalidArgument(format!("PTY resize failed: {}", e)))?;
    Ok(())
}

#[tauri::command]
fn cmd_pty_kill(state: State<AppState>, id: String) -> Result<(), CoreError> {
    let mut processes = state.pty_processes.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    if let Some(pty) = processes.remove(&id) {
        if let Ok(mut tx) = pty.kill_tx.lock() {
            if let Some(sender) = tx.take() {
                let _ = sender.send(());
            }
        }
    }
    // 清理 output channel
    let _ = state.pty_output_receivers.lock().map(|mut m| m.remove(&id));
    Ok(())
}

// ─── Shell 检测 ──────────────────────────────────────────────

/// 检测到的 Shell 信息
#[derive(Serialize)]
struct ShellInfo {
    id: String,
    name: String,
    path: String,
    is_default: bool,
}

/// 检测系统中可用的 Shell
#[tauri::command]
fn cmd_detect_shells() -> Vec<ShellInfo> {
    let is_windows = cfg!(target_os = "windows");
    let mut shells = Vec::new();

    if is_windows {
        // Windows: 检测 CMD、PowerShell 5.x、PowerShell 7、Git Bash、WSL
        let candidates: Vec<(&str, &str, &str)> = vec![
            ("cmd", "CMD", "cmd.exe"),
            ("powershell", "PowerShell", "powershell.exe"),
            ("pwsh", "PowerShell 7", "pwsh.exe"),
            ("git-bash", "Git Bash", "C:\\Program Files\\Git\\bin\\bash.exe"),
            ("wsl", "WSL (Ubuntu)", "wsl.exe"),
        ];
        for (id, name, path) in candidates {
            let found = which_shell(path);
            if let Some(full_path) = found {
                shells.push(ShellInfo {
                    id: id.to_string(),
                    name: name.to_string(),
                    path: full_path,
                    is_default: id == "powershell",
                });
            }
        }
        // CMD 总是可用
        if shells.iter().all(|s| s.id != "cmd") {
            shells.insert(0, ShellInfo {
                id: "cmd".to_string(),
                name: "CMD".to_string(),
                path: "cmd.exe".to_string(),
                is_default: false,
            });
        }
    } else {
        // Unix: 检测 sh、bash、zsh、fish、dash、ksh
        let candidates: Vec<(&str, &str, &str)> = vec![
            ("sh", "POSIX Shell", "/bin/sh"),
            ("bash", "Bash", "/bin/bash"),
            ("zsh", "Zsh", "/bin/zsh"),
            ("fish", "Fish", "/usr/bin/fish"),
            ("dash", "Dash", "/bin/dash"),
        ];
        for (id, name, path) in candidates {
            let found = which_shell(path);
            if let Some(full_path) = found {
                shells.push(ShellInfo {
                    id: id.to_string(),
                    name: name.to_string(),
                    path: full_path,
                    is_default: id == "bash",
                });
            }
        }
        // /bin/sh 总是可用
        if shells.iter().all(|s| s.id != "sh") {
            shells.insert(0, ShellInfo {
                id: "sh".to_string(),
                name: "POSIX Shell".to_string(),
                path: "/bin/sh".to_string(),
                is_default: false,
            });
        }
    }
    shells
}

/// 查找 Shell 可执行文件路径
fn which_shell(name: &str) -> Option<String> {
    // 先尝试绝对路径
    if std::path::Path::new(name).is_absolute() && std::path::Path::new(name).exists() {
        return Some(name.to_string());
    }
    // 再尝试 which/where
    let cmd = if cfg!(target_os = "windows") { "where" } else { "which" };
    std::process::Command::new(cmd)
        .arg(name)
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                String::from_utf8(o.stdout)
                    .ok()
                    .and_then(|s| s.lines().next().map(|l| l.trim().to_string()))
            } else {
                None
            }
        })
}

// ─── 持久化 Shell 会话 ────────────────────────────────────────

/// Shell 会话信息
#[derive(Serialize)]
struct ShellSessionInfo {
    id: String,
    shell_id: String,
    shell_path: String,
    cwd: String,
    created_at: u64,
}

/// 创建持久化 Shell 会话（PTY 保持活跃，支持多轮命令）
#[tauri::command]
fn cmd_shell_session_create(
    app: tauri::AppHandle,
    state: State<AppState>,
    id: String,
    shell: Option<String>,
    cwd: Option<String>,
    env: Option<std::collections::HashMap<String, String>>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<ShellSessionInfo, CoreError> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.unwrap_or(24),
            cols: cols.unwrap_or(200),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| CoreError::InvalidArgument(format!("PTY open failed: {}", e)))?;

    // 确定 Shell
    let is_windows = cfg!(target_os = "windows");
    let shell_path = shell.unwrap_or_else(|| {
        if is_windows { "powershell.exe".to_string() } else { "/bin/bash".to_string() }
    });

    let mut cmd = CommandBuilder::new(&shell_path);
    if let Some(cwd) = &cwd { cmd.cwd(cwd); }

    // 环境变量注入
    if let Some(env_vars) = env {
        for (k, v) in env_vars {
            cmd.env(k, v);
        }
    }

    // Windows PowerShell 加载 Profile 以获取完整 PATH
    if is_windows && (shell_path.contains("powershell") || shell_path.contains("pwsh")) {
        // 不传 -NoProfile，让 PowerShell 加载用户 Profile
        // 但传 -NoLogo 减少启动噪音
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| CoreError::InvalidArgument(format!("PTY spawn failed: {}", e)))?;

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| CoreError::InvalidArgument(format!("PTY reader failed: {}", e)))?;

    let (kill_tx, mut kill_rx) = tokio::sync::oneshot::channel::<()>();
    let pty_id = id.clone();
    let app_handle = app.clone();

    // 创建输出 channel
    let (output_tx, output_rx): (std::sync::mpsc::Sender<String>, std::sync::mpsc::Receiver<String>) = std::sync::mpsc::channel();
    let output_tx_clone = output_tx.clone();

    // 读取线程：持续输出到事件和 channel
    std::thread::spawn(move || {
        let mut buf_reader = BufReader::new(reader);
        let mut line = String::new();
        loop {
            line.clear();
            match buf_reader.read_line(&mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    let _ = app_handle.emit(&format!("pty-output-{}", pty_id), &line);
                    let _ = output_tx_clone.send(line.clone());
                }
            }
            if kill_rx.try_recv().is_ok() { break; }
        }
    });

    let master = pair.master;
    let writer = master.take_writer().map_err(|e| CoreError::InvalidArgument(format!("PTY writer failed: {}", e)))?;
    let mut processes = state.pty_processes.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    processes.insert(id.clone(), PtyProcess {
        master,
        writer,
        _child: child,
        kill_tx: std::sync::Mutex::new(Some(kill_tx)),
        output_tx: std::sync::Mutex::new(Some(output_tx)),
    });

    // 存储 output_rx
    {
        let mut rx_map = state.pty_output_receivers.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
        rx_map.insert(id.clone(), output_rx);
    }

    let created_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    // 等待 Shell 启动就绪（发送空输入触发提示符）
    // 短暂等待让 Shell 初始化
    std::thread::sleep(std::time::Duration::from_millis(300));

    Ok(ShellSessionInfo {
        id,
        shell_id: extract_shell_id(&shell_path),
        shell_path,
        cwd: cwd.unwrap_or_else(|| std::env::current_dir().unwrap_or_default().to_string_lossy().to_string()),
        created_at,
    })
}

/// 从 Shell 路径提取简短 ID
fn extract_shell_id(path: &str) -> String {
    let lower = path.to_lowercase();
    if lower.contains("pwsh") { "pwsh".to_string() }
    else if lower.contains("powershell") { "powershell".to_string() }
    else if lower.contains("cmd") { "cmd".to_string() }
    else if lower.contains("bash") { "bash".to_string() }
    else if lower.contains("zsh") { "zsh".to_string() }
    else if lower.contains("fish") { "fish".to_string() }
    else if lower.contains("dash") { "dash".to_string() }
    else if lower.contains("wsl") { "wsl".to_string() }
    else { "unknown".to_string() }
}

/// 在持久化会话中执行命令并收集输出
#[tauri::command]
async fn cmd_shell_session_exec(
    state: State<'_, AppState>,
    id: String,
    command: String,
    timeout_ms: Option<u64>,
) -> Result<ExecResult, CoreError> {
    let pty_id = id.clone();

    // 写入命令到 PTY
    {
        let mut processes = state.pty_processes.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
        let pty = processes.get_mut(&pty_id).ok_or_else(|| CoreError::InvalidArgument(format!("Session {} not found", pty_id)))?;
        let cmd_bytes = format!("{}\n", command);
        pty.writer.write_all(cmd_bytes.as_bytes()).map_err(|e| CoreError::InvalidArgument(format!("Write failed: {}", e)))?;
        pty.writer.flush().map_err(|e| CoreError::InvalidArgument(format!("Flush failed: {}", e)))?;
    }

    // 从 channel 读取输出
    let timeout = timeout_ms.unwrap_or(30000);
    let rx = {
        let mut rx_map = state.pty_output_receivers.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
        rx_map.remove(&pty_id).ok_or_else(|| CoreError::InvalidArgument(format!("No output channel for session {}", pty_id)))?
    };

    // 收集输出直到稳定或超时
    let start = std::time::Instant::now();
    let mut chunks: Vec<String> = Vec::new();
    let mut last_output_time = std::time::Instant::now();

    loop {
        match rx.recv_timeout(std::time::Duration::from_millis(200)) {
            Ok(data) => {
                chunks.push(data);
                last_output_time = std::time::Instant::now();
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                // 检查是否输出稳定（800ms 无新输出）或超时
                let stable_ms = last_output_time.elapsed().as_millis() as u64;
                let elapsed_ms = start.elapsed().as_millis() as u64;
                if !chunks.is_empty() && stable_ms > 800 {
                    break;
                }
                if elapsed_ms > timeout {
                    break;
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                break;
            }
        }
    }

    // 把 rx 放回去供下次调用使用
    // 注意：由于 channel 的 rx 已经被移出，我们需要重新创建
    // 实际上 channel 是持续的，rx 在 recv 后仍然可用
    // 但我们上面用了 remove，需要重新插入
    {
        let mut rx_map = state.pty_output_receivers.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
        rx_map.insert(pty_id.clone(), rx);
    }

    let raw = chunks.join("");
    let stdout = clean_ansi(&raw);
    let timed_out = start.elapsed().as_millis() as u64 > timeout;

    Ok(ExecResult {
        stdout,
        stderr: String::new(),
        exit_code: if timed_out { None } else { Some(0) },
        timed_out,
    })
}

/// 执行结果
#[derive(Serialize)]
struct ExecResult {
    stdout: String,
    stderr: String,
    exit_code: Option<i32>,
    timed_out: bool,
}

/// 清理 ANSI 转义码和不可打印字符
fn clean_ansi(input: &str) -> String {
    let re_csi = regex::Regex::new(r"\x1b\[[0-9;]*[a-zA-Z]").unwrap();
    let re_osc = regex::Regex::new(r"\x1b\].*?\x07").unwrap();
    let result = re_csi.replace_all(input, "");
    let result = re_osc.replace_all(&result, "");
    // 移除不可打印字符（保留换行/制表符/回车）
    result.chars().filter(|c| {
        !c.is_control() || *c == '\n' || *c == '\r' || *c == '\t'
    }).collect()
}

/// 销毁持久化 Shell 会话
#[tauri::command]
fn cmd_shell_session_destroy(state: State<AppState>, id: String) -> Result<(), CoreError> {
    let mut processes = state.pty_processes.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    if let Some(pty) = processes.remove(&id) {
        if let Ok(mut tx) = pty.kill_tx.lock() {
            if let Some(sender) = tx.take() {
                let _ = sender.send(());
            }
        }
    }
    // 清理 output channel
    let _ = state.pty_output_receivers.lock().map(|mut m| m.remove(&id));
    Ok(())
}

/// 列出活跃的 Shell 会话
#[tauri::command]
fn cmd_shell_session_list(state: State<AppState>) -> Result<Vec<String>, CoreError> {
    let processes = state.pty_processes.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    Ok(processes.keys().cloned().collect())
}

/// 在持久化会话中发送输入（用于交互式命令）
#[tauri::command]
fn cmd_shell_session_input(
    state: State<AppState>,
    id: String,
    data: String,
) -> Result<(), CoreError> {
    let mut processes = state.pty_processes.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    let pty = processes.get_mut(&id).ok_or_else(|| CoreError::InvalidArgument(format!("Session {} not found", id)))?;
    let input = format!("{}\n", data);
    pty.writer.write_all(input.as_bytes()).map_err(|e| CoreError::InvalidArgument(format!("Write failed: {}", e)))?;
    pty.writer.flush().map_err(|e| CoreError::InvalidArgument(format!("Flush failed: {}", e)))?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let db = SqliteStore::open_in_memory().expect("SQLite 内存数据库初始化失败");

    let mut schema_reg = worldsmith_core::schema::SchemaRegistry::new();
    schema_reg.register(worldsmith_core::schema::EntityTypeSchema {
        type_key: "weapon".to_string(),
        label: "武器".to_string(),
        icon: "🗡️".to_string(),
        fields: vec![
            worldsmith_core::schema::FieldSchema {
                key: "name".to_string(),
                label: "名称".to_string(),
                field_type: worldsmith_core::schema::FieldType::Text,
                required: true,
                default_value: None,
                options: vec![],
                placeholder: Some("输入武器名称".to_string()),
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "type".to_string(),
                label: "类型".to_string(),
                field_type: worldsmith_core::schema::FieldType::Select,
                required: false,
                default_value: None,
                options: vec![
                    worldsmith_core::schema::SelectOption { value: "melee".to_string(), label: "近战".to_string() },
                    worldsmith_core::schema::SelectOption { value: "ranged".to_string(), label: "远程".to_string() },
                    worldsmith_core::schema::SelectOption { value: "magic".to_string(), label: "魔法".to_string() },
                    worldsmith_core::schema::SelectOption { value: "shield".to_string(), label: "盾牌".to_string() },
                ],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "rarity".to_string(),
                label: "稀有度".to_string(),
                field_type: worldsmith_core::schema::FieldType::Select,
                required: false,
                default_value: None,
                options: vec![
                    worldsmith_core::schema::SelectOption { value: "common".to_string(), label: "普通".to_string() },
                    worldsmith_core::schema::SelectOption { value: "rare".to_string(), label: "稀有".to_string() },
                    worldsmith_core::schema::SelectOption { value: "epic".to_string(), label: "史诗".to_string() },
                    worldsmith_core::schema::SelectOption { value: "legendary".to_string(), label: "传说".to_string() },
                ],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "description".to_string(),
                label: "描述".to_string(),
                field_type: worldsmith_core::schema::FieldType::Textarea,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: Some("输入武器描述".to_string()),
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "origin".to_string(),
                label: "来源".to_string(),
                field_type: worldsmith_core::schema::FieldType::EntityRef,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: Some("region".to_string()),
                auto_link: None,
                animation: None,
            },
        ],
        relations: vec![
            worldsmith_core::schema::RelationTypeSchema {
                type_key: "evolves_from".to_string(),
                label: "进阶自".to_string(),
                source_types: vec!["weapon".to_string()],
                target_types: vec!["weapon".to_string()],
                directed: true,
            },
        ],
        validations: vec![],
        views: vec![worldsmith_core::schema::ViewDeclaration {
            view_type: worldsmith_core::schema::ViewType::List,
            config: serde_json::Value::Null,
            animation: None,
        }],
        icon_map: {
            let mut m = std::collections::HashMap::new();
            m.insert("melee".to_string(), "⚔️".to_string());
            m.insert("ranged".to_string(), "🏹".to_string());
            m.insert("magic".to_string(), "🪄".to_string());
            m.insert("shield".to_string(), "🛡️".to_string());
            m
        },
        id_prefix: "wpn-".to_string(),
        plugin_id: Some("official.weapons".to_string()),
    }).unwrap();

    schema_reg.register(worldsmith_core::schema::EntityTypeSchema {
        type_key: "species".to_string(),
        label: "物种".to_string(),
        icon: "🧬".to_string(),
        fields: vec![
            worldsmith_core::schema::FieldSchema {
                key: "name".to_string(),
                label: "名称".to_string(),
                field_type: worldsmith_core::schema::FieldType::Text,
                required: true,
                default_value: None,
                options: vec![],
                placeholder: Some("物种名称".to_string()),
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "description".to_string(),
                label: "描述".to_string(),
                field_type: worldsmith_core::schema::FieldType::Textarea,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: Some("简要描述".to_string()),
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "speciesType".to_string(),
                label: "类型".to_string(),
                field_type: worldsmith_core::schema::FieldType::Select,
                required: false,
                default_value: None,
                options: vec![
                    worldsmith_core::schema::SelectOption { value: "类人".to_string(), label: "类人".to_string() },
                    worldsmith_core::schema::SelectOption { value: "兽族".to_string(), label: "兽族".to_string() },
                    worldsmith_core::schema::SelectOption { value: "精灵".to_string(), label: "精灵".to_string() },
                    worldsmith_core::schema::SelectOption { value: "矮人".to_string(), label: "矮人".to_string() },
                    worldsmith_core::schema::SelectOption { value: "龙族".to_string(), label: "龙族".to_string() },
                    worldsmith_core::schema::SelectOption { value: "机械".to_string(), label: "机械".to_string() },
                    worldsmith_core::schema::SelectOption { value: "元素".to_string(), label: "元素".to_string() },
                    worldsmith_core::schema::SelectOption { value: "亡灵".to_string(), label: "亡灵".to_string() },
                    worldsmith_core::schema::SelectOption { value: "神话生物".to_string(), label: "神话生物".to_string() },
                    worldsmith_core::schema::SelectOption { value: "异界生物".to_string(), label: "异界生物".to_string() },
                    worldsmith_core::schema::SelectOption { value: "植物智能".to_string(), label: "植物智能".to_string() },
                    worldsmith_core::schema::SelectOption { value: "其他".to_string(), label: "其他".to_string() },
                ],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "avgLifespan".to_string(),
                label: "平均寿命".to_string(),
                field_type: worldsmith_core::schema::FieldType::Text,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "avgHeight".to_string(),
                label: "平均身高".to_string(),
                field_type: worldsmith_core::schema::FieldType::Text,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "avgWeight".to_string(),
                label: "平均体重".to_string(),
                field_type: worldsmith_core::schema::FieldType::Text,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "appearance".to_string(),
                label: "外貌特征".to_string(),
                field_type: worldsmith_core::schema::FieldType::Textarea,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "abilities".to_string(),
                label: "天赋能力".to_string(),
                field_type: worldsmith_core::schema::FieldType::Textarea,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "weakness".to_string(),
                label: "弱点/缺陷".to_string(),
                field_type: worldsmith_core::schema::FieldType::Textarea,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "origin".to_string(),
                label: "起源地".to_string(),
                field_type: worldsmith_core::schema::FieldType::Text,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "language".to_string(),
                label: "语言".to_string(),
                field_type: worldsmith_core::schema::FieldType::Text,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "population".to_string(),
                label: "人口/数量".to_string(),
                field_type: worldsmith_core::schema::FieldType::Text,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "society".to_string(),
                label: "社会结构".to_string(),
                field_type: worldsmith_core::schema::FieldType::Textarea,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "tags".to_string(),
                label: "标签".to_string(),
                field_type: worldsmith_core::schema::FieldType::Tags,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
        ],
        relations: vec![
            worldsmith_core::schema::RelationTypeSchema {
                type_key: "originates_from".to_string(),
                label: "起源于".to_string(),
                source_types: vec!["species".to_string()],
                target_types: vec!["region".to_string()],
                directed: true,
            },
            worldsmith_core::schema::RelationTypeSchema {
                type_key: "speaks".to_string(),
                label: "使用语言".to_string(),
                source_types: vec!["species".to_string()],
                target_types: vec!["concept".to_string()],
                directed: true,
            },
            worldsmith_core::schema::RelationTypeSchema {
                type_key: "member_of".to_string(),
                label: "隶属组织".to_string(),
                source_types: vec!["species".to_string()],
                target_types: vec!["organization".to_string()],
                directed: true,
            },
            worldsmith_core::schema::RelationTypeSchema {
                type_key: "related_species".to_string(),
                label: "相关物种".to_string(),
                source_types: vec!["species".to_string()],
                target_types: vec!["species".to_string()],
                directed: false,
            },
            worldsmith_core::schema::RelationTypeSchema {
                type_key: "individual".to_string(),
                label: "个体角色".to_string(),
                source_types: vec!["species".to_string()],
                target_types: vec!["character".to_string()],
                directed: true,
            },
        ],
        validations: vec![],
        views: vec![worldsmith_core::schema::ViewDeclaration {
            view_type: worldsmith_core::schema::ViewType::List,
            config: serde_json::Value::Null,
            animation: None,
        }],
        icon_map: {
            let mut m = std::collections::HashMap::new();
            m.insert("类人".to_string(), "🧑".to_string());
            m.insert("兽族".to_string(), "🐺".to_string());
            m.insert("精灵".to_string(), "🧝".to_string());
            m.insert("矮人".to_string(), "🧔".to_string());
            m.insert("龙族".to_string(), "🐉".to_string());
            m.insert("机械".to_string(), "🤖".to_string());
            m.insert("元素".to_string(), "🔥".to_string());
            m.insert("亡灵".to_string(), "💀".to_string());
            m.insert("神话生物".to_string(), "🦄".to_string());
            m.insert("异界生物".to_string(), "👾".to_string());
            m.insert("植物智能".to_string(), "🌳".to_string());
            m
        },
        id_prefix: "spc-".to_string(),
        plugin_id: Some("official.species".to_string()),
    }).unwrap();

    schema_reg.register(worldsmith_core::schema::EntityTypeSchema {
        type_key: "combat_stat".to_string(),
        label: "战力体系".to_string(),
        icon: "⚡".to_string(),
        fields: vec![
            worldsmith_core::schema::FieldSchema {
                key: "name".to_string(),
                label: "名称".to_string(),
                field_type: worldsmith_core::schema::FieldType::Text,
                required: true,
                default_value: None,
                options: vec![],
                placeholder: Some("战力体系名称".to_string()),
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "description".to_string(),
                label: "描述".to_string(),
                field_type: worldsmith_core::schema::FieldType::Textarea,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: Some("简要描述".to_string()),
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "system".to_string(),
                label: "体系类型".to_string(),
                field_type: worldsmith_core::schema::FieldType::Select,
                required: false,
                default_value: None,
                options: vec![
                    worldsmith_core::schema::SelectOption { value: "修仙".to_string(), label: "修仙".to_string() },
                    worldsmith_core::schema::SelectOption { value: "魔法".to_string(), label: "魔法".to_string() },
                    worldsmith_core::schema::SelectOption { value: "武道".to_string(), label: "武道".to_string() },
                    worldsmith_core::schema::SelectOption { value: "异能".to_string(), label: "异能".to_string() },
                    worldsmith_core::schema::SelectOption { value: "科技".to_string(), label: "科技".to_string() },
                    worldsmith_core::schema::SelectOption { value: "混合".to_string(), label: "混合".to_string() },
                    worldsmith_core::schema::SelectOption { value: "其他".to_string(), label: "其他".to_string() },
                ],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "tier".to_string(),
                label: "等级/境界".to_string(),
                field_type: worldsmith_core::schema::FieldType::Text,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "realm".to_string(),
                label: "当前境界".to_string(),
                field_type: worldsmith_core::schema::FieldType::Text,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "promotion".to_string(),
                label: "晋升条件".to_string(),
                field_type: worldsmith_core::schema::FieldType::Textarea,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "bottleneck".to_string(),
                label: "瓶颈/限制".to_string(),
                field_type: worldsmith_core::schema::FieldType::Textarea,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "power".to_string(),
                label: "战力评估".to_string(),
                field_type: worldsmith_core::schema::FieldType::Textarea,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "culture".to_string(),
                label: "修炼文化".to_string(),
                field_type: worldsmith_core::schema::FieldType::Select,
                required: false,
                default_value: None,
                options: vec![
                    worldsmith_core::schema::SelectOption { value: "宗门".to_string(), label: "宗门".to_string() },
                    worldsmith_core::schema::SelectOption { value: "学院".to_string(), label: "学院".to_string() },
                    worldsmith_core::schema::SelectOption { value: "家族".to_string(), label: "家族".to_string() },
                    worldsmith_core::schema::SelectOption { value: "散修".to_string(), label: "散修".to_string() },
                    worldsmith_core::schema::SelectOption { value: "军旅".to_string(), label: "军旅".to_string() },
                    worldsmith_core::schema::SelectOption { value: "其他".to_string(), label: "其他".to_string() },
                ],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "tags".to_string(),
                label: "标签".to_string(),
                field_type: worldsmith_core::schema::FieldType::Tags,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
        ],
        relations: vec![
            worldsmith_core::schema::RelationTypeSchema {
                type_key: "current_realm".to_string(),
                label: "当前境界".to_string(),
                source_types: vec!["combat_stat".to_string()],
                target_types: vec!["character".to_string()],
                directed: true,
            },
            worldsmith_core::schema::RelationTypeSchema {
                type_key: "required_skill".to_string(),
                label: "所需技能".to_string(),
                source_types: vec!["combat_stat".to_string()],
                target_types: vec!["magic".to_string()],
                directed: true,
            },
            worldsmith_core::schema::RelationTypeSchema {
                type_key: "training_ground".to_string(),
                label: "修炼地".to_string(),
                source_types: vec!["combat_stat".to_string()],
                target_types: vec!["region".to_string()],
                directed: true,
            },
            worldsmith_core::schema::RelationTypeSchema {
                type_key: "breakthrough_item".to_string(),
                label: "突破物品".to_string(),
                source_types: vec!["combat_stat".to_string()],
                target_types: vec!["item".to_string()],
                directed: true,
            },
            worldsmith_core::schema::RelationTypeSchema {
                type_key: "racial_cap".to_string(),
                label: "种族上限".to_string(),
                source_types: vec!["combat_stat".to_string()],
                target_types: vec!["species".to_string()],
                directed: true,
            },
        ],
        validations: vec![],
        views: vec![worldsmith_core::schema::ViewDeclaration {
            view_type: worldsmith_core::schema::ViewType::List,
            config: serde_json::Value::Null,
            animation: None,
        }],
        icon_map: {
            let mut m = std::collections::HashMap::new();
            m.insert("修仙".to_string(), "🧘".to_string());
            m.insert("魔法".to_string(), "🔮".to_string());
            m.insert("武道".to_string(), "🥋".to_string());
            m.insert("异能".to_string(), "⚡".to_string());
            m.insert("科技".to_string(), "🔬".to_string());
            m.insert("混合".to_string(), "🌀".to_string());
            m
        },
        id_prefix: "cbt-".to_string(),
        plugin_id: Some("official.combat_stats".to_string()),
    }).unwrap();

    schema_reg.register(worldsmith_core::schema::EntityTypeSchema {
        type_key: "magic".to_string(),
        label: "技能".to_string(),
        icon: "🔮".to_string(),
        fields: vec![
            worldsmith_core::schema::FieldSchema {
                key: "name".to_string(),
                label: "名称".to_string(),
                field_type: worldsmith_core::schema::FieldType::Text,
                required: true,
                default_value: None,
                options: vec![],
                placeholder: Some("技能名称".to_string()),
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "description".to_string(),
                label: "描述".to_string(),
                field_type: worldsmith_core::schema::FieldType::Textarea,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: Some("简要描述".to_string()),
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "magicType".to_string(),
                label: "体系".to_string(),
                field_type: worldsmith_core::schema::FieldType::Select,
                required: false,
                default_value: None,
                options: vec![
                    worldsmith_core::schema::SelectOption { value: "元素魔法".to_string(), label: "元素魔法".to_string() },
                    worldsmith_core::schema::SelectOption { value: "心灵魔法".to_string(), label: "心灵魔法".to_string() },
                    worldsmith_core::schema::SelectOption { value: "神术/圣光".to_string(), label: "神术/圣光".to_string() },
                    worldsmith_core::schema::SelectOption { value: "黑魔法/诅咒".to_string(), label: "黑魔法/诅咒".to_string() },
                    worldsmith_core::schema::SelectOption { value: "自然魔法".to_string(), label: "自然魔法".to_string() },
                    worldsmith_core::schema::SelectOption { value: "符文/附魔".to_string(), label: "符文/附魔".to_string() },
                    worldsmith_core::schema::SelectOption { value: "炼金术".to_string(), label: "炼金术".to_string() },
                    worldsmith_core::schema::SelectOption { value: "武术/战技".to_string(), label: "武术/战技".to_string() },
                    worldsmith_core::schema::SelectOption { value: "科技/异能".to_string(), label: "科技/异能".to_string() },
                    worldsmith_core::schema::SelectOption { value: "通用".to_string(), label: "通用".to_string() },
                ],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "level".to_string(),
                label: "等级/阶位".to_string(),
                field_type: worldsmith_core::schema::FieldType::Select,
                required: false,
                default_value: None,
                options: vec![
                    worldsmith_core::schema::SelectOption { value: "入门".to_string(), label: "入门".to_string() },
                    worldsmith_core::schema::SelectOption { value: "初级".to_string(), label: "初级".to_string() },
                    worldsmith_core::schema::SelectOption { value: "中级".to_string(), label: "中级".to_string() },
                    worldsmith_core::schema::SelectOption { value: "高级".to_string(), label: "高级".to_string() },
                    worldsmith_core::schema::SelectOption { value: "大师".to_string(), label: "大师".to_string() },
                    worldsmith_core::schema::SelectOption { value: "传说".to_string(), label: "传说".to_string() },
                    worldsmith_core::schema::SelectOption { value: "神级".to_string(), label: "神级".to_string() },
                ],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "cost".to_string(),
                label: "消耗".to_string(),
                field_type: worldsmith_core::schema::FieldType::Text,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: Some("魔力/体力/材料".to_string()),
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "castingTime".to_string(),
                label: "施法时间".to_string(),
                field_type: worldsmith_core::schema::FieldType::Text,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "range".to_string(),
                label: "范围/射程".to_string(),
                field_type: worldsmith_core::schema::FieldType::Text,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "duration".to_string(),
                label: "持续时间".to_string(),
                field_type: worldsmith_core::schema::FieldType::Text,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "effect".to_string(),
                label: "效果描述".to_string(),
                field_type: worldsmith_core::schema::FieldType::Textarea,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "requirements".to_string(),
                label: "学习条件".to_string(),
                field_type: worldsmith_core::schema::FieldType::Textarea,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "tags".to_string(),
                label: "标签".to_string(),
                field_type: worldsmith_core::schema::FieldType::Tags,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
        ],
        relations: vec![
            worldsmith_core::schema::RelationTypeSchema {
                type_key: "mastered_by".to_string(),
                label: "掌握者".to_string(),
                source_types: vec!["magic".to_string()],
                target_types: vec!["character".to_string()],
                directed: true,
            },
            worldsmith_core::schema::RelationTypeSchema {
                type_key: "racial_ability".to_string(),
                label: "种族天赋".to_string(),
                source_types: vec!["magic".to_string()],
                target_types: vec!["species".to_string()],
                directed: true,
            },
            worldsmith_core::schema::RelationTypeSchema {
                type_key: "requires_item".to_string(),
                label: "所需物品".to_string(),
                source_types: vec!["magic".to_string()],
                target_types: vec!["item".to_string()],
                directed: true,
            },
            worldsmith_core::schema::RelationTypeSchema {
                type_key: "based_on".to_string(),
                label: "基于概念".to_string(),
                source_types: vec!["magic".to_string()],
                target_types: vec!["concept".to_string()],
                directed: true,
            },
            worldsmith_core::schema::RelationTypeSchema {
                type_key: "counters".to_string(),
                label: "克制".to_string(),
                source_types: vec!["magic".to_string()],
                target_types: vec!["magic".to_string()],
                directed: false,
            },
            worldsmith_core::schema::RelationTypeSchema {
                type_key: "upgrades_to".to_string(),
                label: "进阶为".to_string(),
                source_types: vec!["magic".to_string()],
                target_types: vec!["magic".to_string()],
                directed: true,
            },
        ],
        validations: vec![],
        views: vec![worldsmith_core::schema::ViewDeclaration {
            view_type: worldsmith_core::schema::ViewType::List,
            config: serde_json::Value::Null,
            animation: None,
        }],
        icon_map: {
            let mut m = std::collections::HashMap::new();
            m.insert("元素魔法".to_string(), "🔥".to_string());
            m.insert("心灵魔法".to_string(), "🧠".to_string());
            m.insert("神术/圣光".to_string(), "✨".to_string());
            m.insert("黑魔法/诅咒".to_string(), "💀".to_string());
            m.insert("自然魔法".to_string(), "🌿".to_string());
            m.insert("符文/附魔".to_string(), "🔣".to_string());
            m.insert("炼金术".to_string(), "⚗️".to_string());
            m.insert("武术/战技".to_string(), "🥋".to_string());
            m.insert("科技/异能".to_string(), "⚡".to_string());
            m.insert("通用".to_string(), "🔮".to_string());
            m
        },
        id_prefix: "mag-".to_string(),
        plugin_id: Some("official.magic".to_string()),
    }).unwrap();

    schema_reg.register(worldsmith_core::schema::EntityTypeSchema {
        type_key: "plant".to_string(),
        label: "植物".to_string(),
        icon: "🌿".to_string(),
        fields: vec![
            worldsmith_core::schema::FieldSchema {
                key: "name".to_string(),
                label: "名称".to_string(),
                field_type: worldsmith_core::schema::FieldType::Text,
                required: true,
                default_value: None,
                options: vec![],
                placeholder: Some("植物名称".to_string()),
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "description".to_string(),
                label: "描述".to_string(),
                field_type: worldsmith_core::schema::FieldType::Textarea,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: Some("简要描述".to_string()),
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "plantType".to_string(),
                label: "类型".to_string(),
                field_type: worldsmith_core::schema::FieldType::Select,
                required: false,
                default_value: None,
                options: vec![
                    worldsmith_core::schema::SelectOption { value: "树木".to_string(), label: "树木".to_string() },
                    worldsmith_core::schema::SelectOption { value: "花卉".to_string(), label: "花卉".to_string() },
                    worldsmith_core::schema::SelectOption { value: "草药".to_string(), label: "草药".to_string() },
                    worldsmith_core::schema::SelectOption { value: "藤蔓".to_string(), label: "藤蔓".to_string() },
                    worldsmith_core::schema::SelectOption { value: "菌类".to_string(), label: "菌类".to_string() },
                    worldsmith_core::schema::SelectOption { value: "苔藓".to_string(), label: "苔藓".to_string() },
                    worldsmith_core::schema::SelectOption { value: "水生植物".to_string(), label: "水生植物".to_string() },
                    worldsmith_core::schema::SelectOption { value: "食肉植物".to_string(), label: "食肉植物".to_string() },
                    worldsmith_core::schema::SelectOption { value: "魔法植物".to_string(), label: "魔法植物".to_string() },
                    worldsmith_core::schema::SelectOption { value: "其他".to_string(), label: "其他".to_string() },
                ],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "habitat".to_string(),
                label: "栖息地".to_string(),
                field_type: worldsmith_core::schema::FieldType::Text,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "rarity".to_string(),
                label: "稀有度".to_string(),
                field_type: worldsmith_core::schema::FieldType::Select,
                required: false,
                default_value: None,
                options: vec![
                    worldsmith_core::schema::SelectOption { value: "常见".to_string(), label: "常见".to_string() },
                    worldsmith_core::schema::SelectOption { value: "少见".to_string(), label: "少见".to_string() },
                    worldsmith_core::schema::SelectOption { value: "稀有".to_string(), label: "稀有".to_string() },
                    worldsmith_core::schema::SelectOption { value: "极稀有".to_string(), label: "极稀有".to_string() },
                    worldsmith_core::schema::SelectOption { value: "传说".to_string(), label: "传说".to_string() },
                    worldsmith_core::schema::SelectOption { value: "已灭绝".to_string(), label: "已灭绝".to_string() },
                ],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "usage".to_string(),
                label: "用途".to_string(),
                field_type: worldsmith_core::schema::FieldType::Text,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "appearance".to_string(),
                label: "外观特征".to_string(),
                field_type: worldsmith_core::schema::FieldType::Textarea,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "toxicity".to_string(),
                label: "毒性/危险".to_string(),
                field_type: worldsmith_core::schema::FieldType::Textarea,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "growthCycle".to_string(),
                label: "生长周期".to_string(),
                field_type: worldsmith_core::schema::FieldType::Text,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "relatedProducts".to_string(),
                label: "相关产物".to_string(),
                field_type: worldsmith_core::schema::FieldType::Text,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "tags".to_string(),
                label: "标签".to_string(),
                field_type: worldsmith_core::schema::FieldType::Tags,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
        ],
        relations: vec![
            worldsmith_core::schema::RelationTypeSchema {
                type_key: "native_to".to_string(),
                label: "原产于".to_string(),
                source_types: vec!["plant".to_string()],
                target_types: vec!["region".to_string()],
                directed: true,
            },
            worldsmith_core::schema::RelationTypeSchema {
                type_key: "materials_from".to_string(),
                label: "产出材料".to_string(),
                source_types: vec!["plant".to_string()],
                target_types: vec!["item".to_string()],
                directed: true,
            },
            worldsmith_core::schema::RelationTypeSchema {
                type_key: "used_by".to_string(),
                label: "被使用于".to_string(),
                source_types: vec!["plant".to_string()],
                target_types: vec!["species".to_string(), "character".to_string()],
                directed: true,
            },
            worldsmith_core::schema::RelationTypeSchema {
                type_key: "magic_material".to_string(),
                label: "魔法材料".to_string(),
                source_types: vec!["plant".to_string()],
                target_types: vec!["magic".to_string()],
                directed: true,
            },
        ],
        validations: vec![],
        views: vec![worldsmith_core::schema::ViewDeclaration {
            view_type: worldsmith_core::schema::ViewType::List,
            config: serde_json::Value::Null,
            animation: None,
        }],
        icon_map: {
            let mut m = std::collections::HashMap::new();
            m.insert("树木".to_string(), "🌳".to_string());
            m.insert("花卉".to_string(), "🌸".to_string());
            m.insert("草药".to_string(), "🌿".to_string());
            m.insert("藤蔓".to_string(), "🍃".to_string());
            m.insert("菌类".to_string(), "🍄".to_string());
            m.insert("苔藓".to_string(), "🌱".to_string());
            m.insert("水生植物".to_string(), "🌊".to_string());
            m.insert("食肉植物".to_string(), "🪴".to_string());
            m.insert("魔法植物".to_string(), "✨".to_string());
            m
        },
        id_prefix: "plt-".to_string(),
        plugin_id: Some("official.plants".to_string()),
    }).unwrap();

    schema_reg.register(worldsmith_core::schema::EntityTypeSchema {
        type_key: "building".to_string(),
        label: "建筑".to_string(),
        icon: "🏛".to_string(),
        fields: vec![
            worldsmith_core::schema::FieldSchema {
                key: "name".to_string(),
                label: "名称".to_string(),
                field_type: worldsmith_core::schema::FieldType::Text,
                required: true,
                default_value: None,
                options: vec![],
                placeholder: Some("建筑名称".to_string()),
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "description".to_string(),
                label: "描述".to_string(),
                field_type: worldsmith_core::schema::FieldType::Textarea,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: Some("简要描述".to_string()),
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "buildingType".to_string(),
                label: "建筑类型".to_string(),
                field_type: worldsmith_core::schema::FieldType::Select,
                required: false,
                default_value: None,
                options: vec![
                    worldsmith_core::schema::SelectOption { value: "宫殿/城堡".to_string(), label: "宫殿/城堡".to_string() },
                    worldsmith_core::schema::SelectOption { value: "塔楼/堡垒".to_string(), label: "塔楼/堡垒".to_string() },
                    worldsmith_core::schema::SelectOption { value: "寺庙/教堂".to_string(), label: "寺庙/教堂".to_string() },
                    worldsmith_core::schema::SelectOption { value: "住宅/民居".to_string(), label: "住宅/民居".to_string() },
                    worldsmith_core::schema::SelectOption { value: "商店/市场".to_string(), label: "商店/市场".to_string() },
                    worldsmith_core::schema::SelectOption { value: "学校/学院".to_string(), label: "学校/学院".to_string() },
                    worldsmith_core::schema::SelectOption { value: "工厂/工坊".to_string(), label: "工厂/工坊".to_string() },
                    worldsmith_core::schema::SelectOption { value: "地牢/监狱".to_string(), label: "地牢/监狱".to_string() },
                    worldsmith_core::schema::SelectOption { value: "桥梁/道路".to_string(), label: "桥梁/道路".to_string() },
                    worldsmith_core::schema::SelectOption { value: "奇观/遗迹".to_string(), label: "奇观/遗迹".to_string() },
                    worldsmith_core::schema::SelectOption { value: "其他".to_string(), label: "其他".to_string() },
                ],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "style".to_string(),
                label: "建筑风格".to_string(),
                field_type: worldsmith_core::schema::FieldType::Text,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "era".to_string(),
                label: "建造年代".to_string(),
                field_type: worldsmith_core::schema::FieldType::Text,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "location".to_string(),
                label: "所在区域".to_string(),
                field_type: worldsmith_core::schema::FieldType::Text,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "floors".to_string(),
                label: "层数/规模".to_string(),
                field_type: worldsmith_core::schema::FieldType::Text,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "material".to_string(),
                label: "主要材料".to_string(),
                field_type: worldsmith_core::schema::FieldType::Text,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "owner".to_string(),
                label: "所有者".to_string(),
                field_type: worldsmith_core::schema::FieldType::Text,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "significance".to_string(),
                label: "文化意义".to_string(),
                field_type: worldsmith_core::schema::FieldType::Textarea,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "interior".to_string(),
                label: "内部布局".to_string(),
                field_type: worldsmith_core::schema::FieldType::Textarea,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "tags".to_string(),
                label: "标签".to_string(),
                field_type: worldsmith_core::schema::FieldType::Tags,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
        ],
        relations: vec![
            worldsmith_core::schema::RelationTypeSchema {
                type_key: "located_in".to_string(),
                label: "位于".to_string(),
                source_types: vec!["building".to_string()],
                target_types: vec!["region".to_string()],
                directed: true,
            },
            worldsmith_core::schema::RelationTypeSchema {
                type_key: "belongs_to".to_string(),
                label: "属于".to_string(),
                source_types: vec!["building".to_string()],
                target_types: vec!["organization".to_string()],
                directed: true,
            },
            worldsmith_core::schema::RelationTypeSchema {
                type_key: "owned_by".to_string(),
                label: "拥有者".to_string(),
                source_types: vec!["building".to_string()],
                target_types: vec!["character".to_string()],
                directed: true,
            },
            worldsmith_core::schema::RelationTypeSchema {
                type_key: "resident".to_string(),
                label: "居住者".to_string(),
                source_types: vec!["building".to_string()],
                target_types: vec!["character".to_string()],
                directed: true,
            },
            worldsmith_core::schema::RelationTypeSchema {
                type_key: "contains".to_string(),
                label: "包含".to_string(),
                source_types: vec!["building".to_string()],
                target_types: vec!["building".to_string()],
                directed: true,
            },
            worldsmith_core::schema::RelationTypeSchema {
                type_key: "connected_to".to_string(),
                label: "连接至".to_string(),
                source_types: vec!["building".to_string()],
                target_types: vec!["building".to_string()],
                directed: false,
            },
            worldsmith_core::schema::RelationTypeSchema {
                type_key: "stored_at".to_string(),
                label: "存放于".to_string(),
                source_types: vec!["building".to_string()],
                target_types: vec!["item".to_string()],
                directed: true,
            },
            worldsmith_core::schema::RelationTypeSchema {
                type_key: "event_location".to_string(),
                label: "事件地点".to_string(),
                source_types: vec!["building".to_string()],
                target_types: vec!["event".to_string()],
                directed: true,
            },
            worldsmith_core::schema::RelationTypeSchema {
                type_key: "managed_by".to_string(),
                label: "管理者".to_string(),
                source_types: vec!["building".to_string()],
                target_types: vec!["character".to_string(), "organization".to_string()],
                directed: true,
            },
            worldsmith_core::schema::RelationTypeSchema {
                type_key: "famous_for".to_string(),
                label: "著名于".to_string(),
                source_types: vec!["building".to_string()],
                target_types: vec!["item".to_string(), "concept".to_string(), "character".to_string()],
                directed: true,
            },
        ],
        validations: vec![],
        views: vec![worldsmith_core::schema::ViewDeclaration {
            view_type: worldsmith_core::schema::ViewType::List,
            config: serde_json::Value::Null,
            animation: None,
        }],
        icon_map: {
            let mut m = std::collections::HashMap::new();
            m.insert("宫殿/城堡".to_string(), "🏰".to_string());
            m.insert("塔楼/堡垒".to_string(), "🏯".to_string());
            m.insert("寺庙/教堂".to_string(), "⛪".to_string());
            m.insert("住宅/民居".to_string(), "🏠".to_string());
            m.insert("商店/市场".to_string(), "🏪".to_string());
            m.insert("学校/学院".to_string(), "🏫".to_string());
            m.insert("工厂/工坊".to_string(), "🏭".to_string());
            m.insert("地牢/监狱".to_string(), "🏚️".to_string());
            m.insert("桥梁/道路".to_string(), "🌉".to_string());
            m.insert("奇观/遗迹".to_string(), "🏛️".to_string());
            m
        },
        id_prefix: "bld-".to_string(),
        plugin_id: Some("official.buildings".to_string()),
    }).unwrap();

    schema_reg.register(worldsmith_core::schema::EntityTypeSchema {
        type_key: "language".to_string(),
        label: "语言".to_string(),
        icon: "🔤".to_string(),
        fields: vec![
            worldsmith_core::schema::FieldSchema {
                key: "name".to_string(),
                label: "名称".to_string(),
                field_type: worldsmith_core::schema::FieldType::Text,
                required: true,
                default_value: None,
                options: vec![],
                placeholder: Some("语言名称".to_string()),
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "description".to_string(),
                label: "描述".to_string(),
                field_type: worldsmith_core::schema::FieldType::Textarea,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: Some("简要描述".to_string()),
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "langType".to_string(),
                label: "语言类型".to_string(),
                field_type: worldsmith_core::schema::FieldType::Select,
                required: false,
                default_value: None,
                options: vec![
                    worldsmith_core::schema::SelectOption { value: "自然语言".to_string(), label: "自然语言".to_string() },
                    worldsmith_core::schema::SelectOption { value: "魔法语言".to_string(), label: "魔法语言".to_string() },
                    worldsmith_core::schema::SelectOption { value: "古代语".to_string(), label: "古代语".to_string() },
                    worldsmith_core::schema::SelectOption { value: "方言".to_string(), label: "方言".to_string() },
                    worldsmith_core::schema::SelectOption { value: "手语".to_string(), label: "手语".to_string() },
                    worldsmith_core::schema::SelectOption { value: "密码/密文".to_string(), label: "密码/密文".to_string() },
                ],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "scriptType".to_string(),
                label: "文字类型".to_string(),
                field_type: worldsmith_core::schema::FieldType::Select,
                required: false,
                default_value: None,
                options: vec![
                    worldsmith_core::schema::SelectOption { value: "字母".to_string(), label: "字母".to_string() },
                    worldsmith_core::schema::SelectOption { value: "音节".to_string(), label: "音节".to_string() },
                    worldsmith_core::schema::SelectOption { value: "象形".to_string(), label: "象形".to_string() },
                    worldsmith_core::schema::SelectOption { value: "符文".to_string(), label: "符文".to_string() },
                    worldsmith_core::schema::SelectOption { value: "无文字".to_string(), label: "无文字".to_string() },
                ],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "languageFamily".to_string(),
                label: "语系".to_string(),
                field_type: worldsmith_core::schema::FieldType::Text,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "speakers".to_string(),
                label: "使用人群".to_string(),
                field_type: worldsmith_core::schema::FieldType::Text,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "grammar".to_string(),
                label: "语法特点".to_string(),
                field_type: worldsmith_core::schema::FieldType::Textarea,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "sample".to_string(),
                label: "示例文本".to_string(),
                field_type: worldsmith_core::schema::FieldType::Textarea,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "tags".to_string(),
                label: "标签".to_string(),
                field_type: worldsmith_core::schema::FieldType::Tags,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
        ],
        relations: vec![
            worldsmith_core::schema::RelationTypeSchema {
                type_key: "spoken_by".to_string(),
                label: "使用者".to_string(),
                source_types: vec!["language".to_string()],
                target_types: vec!["species".to_string(), "character".to_string()],
                directed: true,
            },
            worldsmith_core::schema::RelationTypeSchema {
                type_key: "spoken_in".to_string(),
                label: "使用地区".to_string(),
                source_types: vec!["language".to_string()],
                target_types: vec!["region".to_string()],
                directed: true,
            },
            worldsmith_core::schema::RelationTypeSchema {
                type_key: "language_branch".to_string(),
                label: "语支".to_string(),
                source_types: vec!["language".to_string()],
                target_types: vec!["language".to_string()],
                directed: true,
            },
            worldsmith_core::schema::RelationTypeSchema {
                type_key: "related_language".to_string(),
                label: "相关语言".to_string(),
                source_types: vec!["language".to_string()],
                target_types: vec!["language".to_string()],
                directed: false,
            },
            worldsmith_core::schema::RelationTypeSchema {
                type_key: "script_used_in".to_string(),
                label: "文字用于".to_string(),
                source_types: vec!["language".to_string()],
                target_types: vec!["concept".to_string()],
                directed: true,
            },
        ],
        validations: vec![],
        views: vec![worldsmith_core::schema::ViewDeclaration {
            view_type: worldsmith_core::schema::ViewType::List,
            config: serde_json::Value::Null,
            animation: None,
        }],
        icon_map: {
            let mut m = std::collections::HashMap::new();
            m.insert("自然语言".to_string(), "🗣️".to_string());
            m.insert("魔法语言".to_string(), "✨".to_string());
            m.insert("古代语".to_string(), "📜".to_string());
            m.insert("方言".to_string(), "💬".to_string());
            m.insert("手语".to_string(), "🤟".to_string());
            m.insert("密码/密文".to_string(), "🔐".to_string());
            m
        },
        id_prefix: "lang-".to_string(),
        plugin_id: Some("official.languages".to_string()),
    }).unwrap();

    schema_reg.register(worldsmith_core::schema::EntityTypeSchema {
        type_key: "culture".to_string(),
        label: "文化".to_string(),
        icon: "🎭".to_string(),
        fields: vec![
            worldsmith_core::schema::FieldSchema {
                key: "name".to_string(),
                label: "名称".to_string(),
                field_type: worldsmith_core::schema::FieldType::Text,
                required: true,
                default_value: None,
                options: vec![],
                placeholder: Some("文化名称".to_string()),
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "description".to_string(),
                label: "描述".to_string(),
                field_type: worldsmith_core::schema::FieldType::Textarea,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: Some("简要描述".to_string()),
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "cultureType".to_string(),
                label: "类型".to_string(),
                field_type: worldsmith_core::schema::FieldType::Select,
                required: false,
                default_value: None,
                options: vec![
                    worldsmith_core::schema::SelectOption { value: "节日庆典".to_string(), label: "节日庆典".to_string() },
                    worldsmith_core::schema::SelectOption { value: "宗教仪式".to_string(), label: "宗教仪式".to_string() },
                    worldsmith_core::schema::SelectOption { value: "风俗习惯".to_string(), label: "风俗习惯".to_string() },
                    worldsmith_core::schema::SelectOption { value: "艺术流派".to_string(), label: "艺术流派".to_string() },
                    worldsmith_core::schema::SelectOption { value: "饮食文化".to_string(), label: "饮食文化".to_string() },
                    worldsmith_core::schema::SelectOption { value: "服饰传统".to_string(), label: "服饰传统".to_string() },
                    worldsmith_core::schema::SelectOption { value: "社交礼仪".to_string(), label: "社交礼仪".to_string() },
                    worldsmith_core::schema::SelectOption { value: "丧葬习俗".to_string(), label: "丧葬习俗".to_string() },
                    worldsmith_core::schema::SelectOption { value: "其他".to_string(), label: "其他".to_string() },
                ],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "cycle".to_string(),
                label: "周期/频率".to_string(),
                field_type: worldsmith_core::schema::FieldType::Text,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "origin".to_string(),
                label: "起源".to_string(),
                field_type: worldsmith_core::schema::FieldType::Text,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "participants".to_string(),
                label: "参与者".to_string(),
                field_type: worldsmith_core::schema::FieldType::Text,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "significance".to_string(),
                label: "意义/象征".to_string(),
                field_type: worldsmith_core::schema::FieldType::Textarea,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "practices".to_string(),
                label: "仪式/做法".to_string(),
                field_type: worldsmith_core::schema::FieldType::Textarea,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "tags".to_string(),
                label: "标签".to_string(),
                field_type: worldsmith_core::schema::FieldType::Tags,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
        ],
        relations: vec![
            worldsmith_core::schema::RelationTypeSchema {
                type_key: "practiced_in".to_string(),
                label: "流行于".to_string(),
                source_types: vec!["culture".to_string()],
                target_types: vec!["region".to_string()],
                directed: true,
            },
            worldsmith_core::schema::RelationTypeSchema {
                type_key: "practiced_by".to_string(),
                label: "实践者".to_string(),
                source_types: vec!["culture".to_string()],
                target_types: vec!["species".to_string()],
                directed: true,
            },
            worldsmith_core::schema::RelationTypeSchema {
                type_key: "promoted_by".to_string(),
                label: "推广者".to_string(),
                source_types: vec!["culture".to_string()],
                target_types: vec!["organization".to_string()],
                directed: true,
            },
            worldsmith_core::schema::RelationTypeSchema {
                type_key: "origin_event".to_string(),
                label: "起源事件".to_string(),
                source_types: vec!["culture".to_string()],
                target_types: vec!["event".to_string()],
                directed: true,
            },
        ],
        validations: vec![],
        views: vec![worldsmith_core::schema::ViewDeclaration {
            view_type: worldsmith_core::schema::ViewType::List,
            config: serde_json::Value::Null,
            animation: None,
        }],
        icon_map: {
            let mut m = std::collections::HashMap::new();
            m.insert("节日庆典".to_string(), "🎉".to_string());
            m.insert("宗教仪式".to_string(), "🙏".to_string());
            m.insert("风俗习惯".to_string(), "🏮".to_string());
            m.insert("艺术流派".to_string(), "🎨".to_string());
            m.insert("饮食文化".to_string(), "🍜".to_string());
            m.insert("服饰传统".to_string(), "👘".to_string());
            m.insert("社交礼仪".to_string(), "🤝".to_string());
            m.insert("丧葬习俗".to_string(), "🕯".to_string());
            m
        },
        id_prefix: "cul-".to_string(),
        plugin_id: Some("official.culture".to_string()),
    }).unwrap();

    schema_reg.register(worldsmith_core::schema::EntityTypeSchema {
        type_key: "conflict".to_string(),
        label: "冲突".to_string(),
        icon: "⚔️".to_string(),
        fields: vec![
            worldsmith_core::schema::FieldSchema {
                key: "name".to_string(),
                label: "名称".to_string(),
                field_type: worldsmith_core::schema::FieldType::Text,
                required: true,
                default_value: None,
                options: vec![],
                placeholder: Some("冲突名称".to_string()),
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "description".to_string(),
                label: "描述".to_string(),
                field_type: worldsmith_core::schema::FieldType::Textarea,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: Some("简要描述".to_string()),
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "conflictType".to_string(),
                label: "冲突类型".to_string(),
                field_type: worldsmith_core::schema::FieldType::Select,
                required: false,
                default_value: None,
                options: vec![
                    worldsmith_core::schema::SelectOption { value: "战争".to_string(), label: "战争".to_string() },
                    worldsmith_core::schema::SelectOption { value: "政治斗争".to_string(), label: "政治斗争".to_string() },
                    worldsmith_core::schema::SelectOption { value: "宗教冲突".to_string(), label: "宗教冲突".to_string() },
                    worldsmith_core::schema::SelectOption { value: "贸易战".to_string(), label: "贸易战".to_string() },
                    worldsmith_core::schema::SelectOption { value: "内战".to_string(), label: "内战".to_string() },
                    worldsmith_core::schema::SelectOption { value: "边境摩擦".to_string(), label: "边境摩擦".to_string() },
                ],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "scale".to_string(),
                label: "规模".to_string(),
                field_type: worldsmith_core::schema::FieldType::Select,
                required: false,
                default_value: None,
                options: vec![
                    worldsmith_core::schema::SelectOption { value: "局部".to_string(), label: "局部".to_string() },
                    worldsmith_core::schema::SelectOption { value: "区域".to_string(), label: "区域".to_string() },
                    worldsmith_core::schema::SelectOption { value: "大陆级".to_string(), label: "大陆级".to_string() },
                    worldsmith_core::schema::SelectOption { value: "世界级".to_string(), label: "世界级".to_string() },
                ],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "startDate".to_string(),
                label: "开始时间".to_string(),
                field_type: worldsmith_core::schema::FieldType::Text,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "endDate".to_string(),
                label: "结束时间".to_string(),
                field_type: worldsmith_core::schema::FieldType::Text,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "cause".to_string(),
                label: "起因".to_string(),
                field_type: worldsmith_core::schema::FieldType::Textarea,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "outcome".to_string(),
                label: "结果".to_string(),
                field_type: worldsmith_core::schema::FieldType::Textarea,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
            worldsmith_core::schema::FieldSchema {
                key: "tags".to_string(),
                label: "标签".to_string(),
                field_type: worldsmith_core::schema::FieldType::Tags,
                required: false,
                default_value: None,
                options: vec![],
                placeholder: None,
                ref_type: None,
                auto_link: None,
                animation: None,
            },
        ],
        relations: vec![
            worldsmith_core::schema::RelationTypeSchema {
                type_key: "participant_force".to_string(),
                label: "参战势力".to_string(),
                source_types: vec!["conflict".to_string()],
                target_types: vec!["organization".to_string()],
                directed: true,
            },
            worldsmith_core::schema::RelationTypeSchema {
                type_key: "participant_commander".to_string(),
                label: "指挥者".to_string(),
                source_types: vec!["conflict".to_string()],
                target_types: vec!["character".to_string()],
                directed: true,
            },
            worldsmith_core::schema::RelationTypeSchema {
                type_key: "battlefield".to_string(),
                label: "战场".to_string(),
                source_types: vec!["conflict".to_string()],
                target_types: vec!["region".to_string()],
                directed: true,
            },
            worldsmith_core::schema::RelationTypeSchema {
                type_key: "related_event".to_string(),
                label: "相关事件".to_string(),
                source_types: vec!["conflict".to_string()],
                target_types: vec!["event".to_string()],
                directed: true,
            },
            worldsmith_core::schema::RelationTypeSchema {
                type_key: "legendary_item".to_string(),
                label: "传说物品".to_string(),
                source_types: vec!["conflict".to_string()],
                target_types: vec!["item".to_string()],
                directed: true,
            },
            worldsmith_core::schema::RelationTypeSchema {
                type_key: "sub_conflict".to_string(),
                label: "子冲突".to_string(),
                source_types: vec!["conflict".to_string()],
                target_types: vec!["conflict".to_string()],
                directed: true,
            },
        ],
        validations: vec![],
        views: vec![worldsmith_core::schema::ViewDeclaration {
            view_type: worldsmith_core::schema::ViewType::List,
            config: serde_json::Value::Null,
            animation: None,
        }],
        icon_map: {
            let mut m = std::collections::HashMap::new();
            m.insert("战争".to_string(), "⚔️".to_string());
            m.insert("政治斗争".to_string(), "🏛️".to_string());
            m.insert("宗教冲突".to_string(), "⛪".to_string());
            m.insert("贸易战".to_string(), "💰".to_string());
            m.insert("内战".to_string(), "💥".to_string());
            m.insert("边境摩擦".to_string(), "🗺️".to_string());
            m
        },
        id_prefix: "war-".to_string(),
        plugin_id: Some("official.conflict".to_string()),
    }).unwrap();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .manage(AppState {
            db: Mutex::new(db),
            retrofit: Mutex::new(RetrofitEngine::new()),
            spatial: Mutex::new(SpatialIndex::new()),
            schema: Mutex::new(schema_reg),
            mcp_processes: Mutex::new(std::collections::HashMap::new()),
            pty_processes: Mutex::new(std::collections::HashMap::new()),
            pty_output_receivers: Mutex::new(std::collections::HashMap::new()),
            wf_engine: std::sync::Arc::new(crate::workflow::engine::WorkflowEngine::new()),
            wf_db_path: Mutex::new(String::new()),
            plugin_node_metas: Mutex::new(std::collections::HashMap::new()),
            dispatcher_registry: std::sync::Arc::new(std::sync::Mutex::new(std::collections::HashMap::new())),
        })
        .manage(FsWatcherState {
            watchers: Mutex::new(std::collections::HashMap::new()),
        })
        .invoke_handler(tauri::generate_handler![
            cmd_init_db,
            cmd_switch_project,
            cmd_delete_project_db,
            cmd_put_entity,
            cmd_get_entity,
            cmd_get_all_entities,
            cmd_get_entities_by_type,
            cmd_update_entity,
            cmd_delete_entity,
            cmd_count_entities_by_type,
            cmd_put_relation,
            cmd_get_all_relations,
            cmd_get_relations_by_entity,
            cmd_delete_relation,
            cmd_delete_relations_by_entity,
            cmd_import_entities,
            cmd_import_relations,
            cmd_update_relation,
            cmd_clear_entities,
            cmd_clear_relations,
            cmd_kv_get,
            cmd_kv_set,
            cmd_kv_get_all,
            cmd_kv_delete,
            cmd_kv_clear,
            cmd_get_all_files,
            cmd_get_file,
            cmd_get_file_by_path,
            cmd_get_files_by_entity,
            cmd_put_file,
            cmd_update_file,
            cmd_delete_file,
            cmd_get_file_content,
            cmd_validate_entity,
            cmd_validate_entities,
            cmd_validate_pack,
            cmd_check_references,
            cmd_migrate,
            cmd_run_diagnostics,
            cmd_check_storage_health,
            cmd_validate_plugin_manifest,
            cmd_check_plugin_health,
            cmd_retrofit_begin_session,
            cmd_retrofit_submit_intent,
            cmd_retrofit_confirm_and_stage,
            cmd_retrofit_apply_next,
            cmd_retrofit_verify_and_accept,
            cmd_retrofit_request_repair,
            cmd_retrofit_redirect,
            cmd_retrofit_rollback_last,
            cmd_retrofit_abort,
            cmd_retrofit_session_phase,
            cmd_retrofit_patch_diff,
            cmd_retrofit_patch_apply,
            cmd_retrofit_detect_conflicts,
            cmd_retrofit_end_session,
            cmd_spatial_insert_rect,
            cmd_spatial_insert_point,
            cmd_spatial_query_range,
            cmd_spatial_query_at_point,
            cmd_spatial_nearest_point,
            cmd_spatial_k_nearest,
            cmd_spatial_query_by_category,
            cmd_spatial_remove_rect,
            cmd_spatial_clear,
            cmd_spatial_counts,
            cmd_algo_segment_intersect,
            cmd_algo_segment_intersection_point,
            cmd_algo_find_all_intersections,
            cmd_algo_point_in_polygon,
            cmd_algo_polygon_area,
            cmd_algo_polygon_centroid,
            cmd_algo_convex_hull,
            cmd_algo_aabb_intersects,
            cmd_algo_obb_intersects,
            cmd_algo_dijkstra,
            cmd_algo_dijkstra_path,
            cmd_algo_astar,
            cmd_algo_k_shortest_paths,
            cmd_algo_topological_sort,
            cmd_algo_connected_components,
            cmd_algo_tarjan_scc,
            cmd_algo_find_dangling,
            cmd_algo_force_layout,
            cmd_algo_grid_layout,
            cmd_algo_radial_layout,
            cmd_algo_tree_layout,
            cmd_algo_layout_unified,
            cmd_algo_crdt_lww_new,
            cmd_algo_crdt_lww_set,
            cmd_algo_crdt_lww_merge,
            cmd_algo_crdt_orset_new,
            cmd_algo_crdt_orset_add,
            cmd_algo_crdt_orset_remove,
            cmd_algo_crdt_orset_merge,
            cmd_algo_crdt_orset_elements,
            cmd_algo_crdt_rga_new,
            cmd_algo_crdt_rga_insert,
            cmd_algo_crdt_rga_delete,
            cmd_algo_crdt_rga_merge,
            cmd_algo_crdt_rga_text,
            cmd_algo_crdt_vc_compare,
            cmd_algo_terrain_noise,
            cmd_algo_terrain_heightmap_generate,
            cmd_algo_terrain_heightmap_slope,
            cmd_algo_terrain_heightmap_aspect,
            cmd_algo_terrain_marching_squares,
            cmd_algo_constraint_solve,
            cmd_algo_dxf_parse,
            cmd_algo_dxf_generate,
            cmd_algo_dxf_extract_constraints,
            cmd_algo_polygon_boolean,
            cmd_algo_polygon_offset,
            cmd_algo_polygon_simplify,
            cmd_algo_line_length,
            cmd_algo_pagerank,
            cmd_algo_community_detection,
            cmd_algo_betweenness_centrality,
            cmd_algo_hydraulic_erosion,
            cmd_algo_viewshed,
            cmd_algo_chaikin_smooth,
            cmd_algo_find_shared_edges,
            cmd_algo_find_line_polygon_intersections,
            cmd_algo_polygon_split,
            cmd_algo_polygon_augment,
            cmd_schema_register_entity_type,
            cmd_schema_unregister_entity_type,
            cmd_schema_get_entity_type,
            cmd_schema_list_entity_types,
            cmd_schema_update_entity_type,
            cmd_schema_register_validation,
            cmd_schema_register_view,
            cmd_mcp_spawn,
            cmd_mcp_kill,
            cmd_mcp_list,
            cmd_font_scan_system,
            cmd_font_read_file,
            cmd_skills_get_dir,
            cmd_fs_read,
            cmd_fs_read_binary,
            cmd_fs_write,
            cmd_fs_write_binary,
            cmd_fs_list,
            cmd_fs_mkdir,
            cmd_fs_stat,
            cmd_fs_copy,
            cmd_fs_rename,
            cmd_fs_delete,
            cmd_fs_search,
            cmd_fs_watch_start,
            cmd_fs_watch_stop,
            // ─── workflow plugin (Phase 1) ─────────────────────────────
            crate::workflow::commands::definitions::workflow_list,
            crate::workflow::commands::definitions::workflow_get,
            crate::workflow::commands::definitions::workflow_create,
            crate::workflow::commands::definitions::workflow_update,
            crate::workflow::commands::definitions::workflow_delete,
            crate::workflow::commands::definitions::workflow_export,
            crate::workflow::commands::definitions::workflow_import,
            crate::workflow::commands::node_meta::workflow_list_node_types,
            crate::workflow::commands::node_meta::workflow_get_node_schema,
            crate::workflow::commands::node_meta::workflow_register_node_type,
            crate::workflow::commands::node_meta::workflow_unregister_node_type,
            crate::workflow::commands::dry_run::workflow_dry_run,
            crate::workflow::commands::runs::workflow_run,
            crate::workflow::commands::runs::workflow_run_sync,
            crate::workflow::commands::runs::workflow_pause,
            crate::workflow::commands::runs::workflow_resume,
            crate::workflow::commands::runs::workflow_cancel,
            crate::workflow::commands::runs::workflow_skip_to,
            crate::workflow::commands::runs::workflow_status,
            crate::workflow::commands::runs::workflow_list_runs,
            crate::workflow::commands::runs::workflow_get_run,
            crate::workflow::commands::dispatch::workflow_node_result,
            crate::workflow::commands::dispatch::workflow_node_heartbeat,
            crate::workflow::commands::dispatch::workflow_node_cancel_ack,
            crate::workflow::commands::settings::workflow_get_setting,
            crate::workflow::commands::settings::workflow_set_setting,
            crate::workflow::commands::settings::workflow_purge_runs_now,
            cmd_secure_store,
            cmd_secure_load,
            cmd_secure_delete,
            cmd_secure_exists,
            // ─── PTY 终端命令 ─────────────────────────────────────────
            cmd_pty_spawn,
            cmd_pty_write,
            cmd_pty_resize,
            cmd_pty_kill,
            // ─── Shell 检测与会话管理 ──────────────────────────────────
            cmd_detect_shells,
            cmd_shell_session_create,
            cmd_shell_session_exec,
            cmd_shell_session_destroy,
            cmd_shell_session_list,
            cmd_shell_session_input,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
