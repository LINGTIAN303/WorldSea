//! 项目命令层（Phase A/B 迁移：数据层链路打通）
//!
//! 前端 useProjectSwitcher 的 Tauri 分支在初始化/切换项目时调用 cmd_switch_project，
//! 创建项目时通过 cmd_get_app_data_dir 获取应用数据目录以自动绑定项目目录。

use tauri::Manager;

/// 切换项目（当前架构为全局会话库，记录日志返回成功）
#[tauri::command]
pub async fn cmd_switch_project(project_id: String) -> Result<(), String> {
    tracing::debug!("[Project] 切换到项目: {project_id}（全局会话库，无需重连）");
    Ok(())
}

/// 获取应用数据目录路径（用于自动绑定项目存储目录）
///
/// FileStorageBackend 以文件系统为主存储时需要一个可用目录；
/// 返回 Tauri 应用数据目录（如 %APPDATA%/com.worldsmith.app 或 ~/.local/share/...），
/// 前端在其下按项目 id 划分子目录。
#[tauri::command]
pub async fn cmd_get_app_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法定位应用数据目录: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建应用数据目录失败: {e}"))?;
    Ok(dir.to_string_lossy().replace('\\', "/"))
}

/// 删除项目关联的数据目录（前端 useProjectSwitcher.deleteProject 的 Tauri 分支）
///
/// 项目目录由 cmd_get_app_data_dir 返回的应用数据目录下 {dataDir}/projects/{project_id}
/// 划分子目录；删除项目时同步清理该目录。目录不存在视为成功（幂等）。
#[tauri::command]
pub async fn cmd_delete_project_db(project_id: String, app: tauri::AppHandle) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法定位应用数据目录: {e}"))?;
    let project_dir = data_dir.join("projects").join(&project_id);
    if project_dir.exists() {
        std::fs::remove_dir_all(&project_dir)
            .map_err(|e| format!("删除项目数据目录失败: {e}"))?;
    }
    Ok(())
}
