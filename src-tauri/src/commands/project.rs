//! 项目数据库管理
//!
//! 拆分自 lib.rs（P0-2 批次1）。
//! 3 个命令：init_db / switch_project / delete_project_db。

use tauri::{Manager, State};

use worldsmith_core::error::CoreError;
use worldsmith_core::storage::sqlite::SqliteStore;

use crate::state::AppState;

#[tauri::command]
pub fn cmd_init_db(state: State<AppState>, path: String) -> Result<(), CoreError> {
    let store = SqliteStore::open(&path)?;
    *state.db.lock().map_err(|e| CoreError::Lock(e.to_string()))? = store;
    Ok(())
}

/// 切换项目数据库。根据 project_id 在 app data 目录下创建/打开对应的 SQLite 文件。
#[tauri::command]
pub fn cmd_switch_project(
    app: tauri::AppHandle,
    state: State<AppState>,
    project_id: String,
) -> Result<String, CoreError> {
    let data_dir = app
        .path()
        .app_data_dir()
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
pub fn cmd_delete_project_db(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<(), CoreError> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| CoreError::storage(format!("获取 app data 目录失败: {e}")))?;
    let db_path = data_dir.join("projects").join(format!("{}.db", project_id));
    if db_path.exists() {
        std::fs::remove_file(&db_path)
            .map_err(|e| CoreError::storage(format!("删除项目数据库失败: {e}")))?;
    }
    Ok(())
}
