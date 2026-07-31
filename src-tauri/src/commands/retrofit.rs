//! Retrofit（改造会话）相关命令
//!
//! 拆分自 lib.rs（P0-2 批次3）。
//! 涵盖改造会话生命周期：begin/submit_intent/confirm/apply/verify/repair/
//! redirect/rollback/abort/phase/patch_diff/patch_apply/detect_conflicts/end。
//! 所有命令通过 `state.retrofit`（Mutex<RetrofitEngine>）操作会话状态。

use tauri::State;

use worldsmith_core::error::CoreError;
use worldsmith_core::retrofit::catalog::CapabilityCatalog;
use worldsmith_core::retrofit::executor::ConflictReport;
use worldsmith_core::retrofit::guard::SafetyReport;
use worldsmith_core::retrofit::intent::RetrofitIntent;
use worldsmith_core::retrofit::session::SessionPhase;
use worldsmith_core::retrofit::{ConfirmResult, ApplyResult};
use worldsmith_core::retrofit::patch::{JsonPatch, JsonPatchDiff};

use crate::state::AppState;

#[tauri::command]
pub fn cmd_retrofit_begin_session(
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
pub fn cmd_retrofit_submit_intent(
    state: State<AppState>,
    intent_json: String,
) -> Result<SafetyReport, CoreError> {
    let intent: RetrofitIntent = serde_json::from_str(&intent_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let mut engine = state.retrofit.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    engine.submit_intent(intent)
}

#[tauri::command]
pub fn cmd_retrofit_confirm_and_stage(
    state: State<AppState>,
) -> Result<ConfirmResult, CoreError> {
    let mut engine = state.retrofit.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    engine.confirm_and_stage()
}

#[tauri::command]
pub fn cmd_retrofit_apply_next(
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
pub fn cmd_retrofit_verify_and_accept(
    state: State<AppState>,
    entity_count: usize,
    relation_count: usize,
) -> Result<worldsmith_core::retrofit::RetrofitResult, CoreError> {
    let mut engine = state.retrofit.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    engine.verify_and_accept(entity_count, relation_count)
}

#[tauri::command]
pub fn cmd_retrofit_request_repair(
    state: State<AppState>,
    message: String,
) -> Result<(), CoreError> {
    let mut engine = state.retrofit.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    engine.request_repair(&message)
}

#[tauri::command]
pub fn cmd_retrofit_redirect(
    state: State<AppState>,
    message: String,
) -> Result<(), CoreError> {
    let mut engine = state.retrofit.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    engine.redirect(&message)
}

#[tauri::command]
pub fn cmd_retrofit_rollback_last(
    state: State<AppState>,
) -> Result<Option<String>, CoreError> {
    let mut engine = state.retrofit.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    engine.rollback_last()
}

#[tauri::command]
pub fn cmd_retrofit_abort(
    state: State<AppState>,
) -> Result<Vec<String>, CoreError> {
    let mut engine = state.retrofit.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    engine.abort()
}

#[tauri::command]
pub fn cmd_retrofit_session_phase(
    state: State<AppState>,
) -> Result<Option<SessionPhase>, CoreError> {
    let engine = state.retrofit.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    Ok(engine.session().map(|s| s.phase))
}

#[tauri::command]
pub fn cmd_retrofit_patch_diff(
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
pub fn cmd_retrofit_patch_apply(
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
pub fn cmd_retrofit_detect_conflicts(
    state: State<AppState>,
) -> Result<Option<ConflictReport>, CoreError> {
    let engine = state.retrofit.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    Ok(engine.detect_conflicts())
}

#[tauri::command]
pub fn cmd_retrofit_end_session(
    state: State<AppState>,
) -> Result<bool, CoreError> {
    let mut engine = state.retrofit.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    Ok(engine.end_session().is_some())
}
