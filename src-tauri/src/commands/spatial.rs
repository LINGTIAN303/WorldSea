//! 空间索引（Spatial Index）相关命令
//!
//! 拆分自 lib.rs（P0-2 批次3）。
//! 涵盖矩形/点的插入、范围查询、最近邻查询、按类别查询、删除、清空、计数。
//! 所有命令通过 `state.spatial`（Mutex<SpatialIndex>）操作内存索引。

use tauri::State;

use worldsmith_core::error::CoreError;
use worldsmith_core::algo::spatial::rtree::{SpatialItem, PointItem};

use crate::state::AppState;

#[tauri::command]
pub fn cmd_spatial_insert_rect(
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
pub fn cmd_spatial_insert_point(
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
pub fn cmd_spatial_query_range(
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
pub fn cmd_spatial_query_at_point(
    state: State<AppState>,
    point_json: String,
) -> Result<Vec<SpatialItem>, CoreError> {
    let point: [f64; 2] = serde_json::from_str(&point_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let idx = state.spatial.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    Ok(idx.query_rect_at_point(point).into_iter().cloned().collect())
}

#[tauri::command]
pub fn cmd_spatial_nearest_point(
    state: State<AppState>,
    query_json: String,
) -> Result<Option<PointItem>, CoreError> {
    let query: [f64; 2] = serde_json::from_str(&query_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let idx = state.spatial.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    Ok(idx.nearest_point(query).cloned())
}

#[tauri::command]
pub fn cmd_spatial_k_nearest(
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
pub fn cmd_spatial_query_by_category(
    state: State<AppState>,
    category: String,
) -> Result<Vec<SpatialItem>, CoreError> {
    let idx = state.spatial.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    Ok(idx.query_rects_by_category(&category).into_iter().cloned().collect())
}

#[tauri::command]
pub fn cmd_spatial_remove_rect(
    state: State<AppState>,
    item_json: String,
) -> Result<bool, CoreError> {
    let item: SpatialItem = serde_json::from_str(&item_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let mut idx = state.spatial.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    Ok(idx.remove_rect(&item))
}

#[tauri::command]
pub fn cmd_spatial_clear(state: State<AppState>) -> Result<(), CoreError> {
    let mut idx = state.spatial.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    idx.clear();
    Ok(())
}

#[tauri::command]
pub fn cmd_spatial_counts(state: State<AppState>) -> Result<serde_json::Value, CoreError> {
    let idx = state.spatial.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    Ok(serde_json::json!({
        "rectCount": idx.rect_count(),
        "pointCount": idx.point_count(),
    }))
}
