//! 项目命令层：前端 useProjectSwitcher 在初始化/切换项目时经下列命令获取应用数据目录、
//! 绑定项目目录与清理项目数据目录。
//!
//! 原 `cmd_switch_project` 空壳（只打日志返回 Ok）已删除——会话库为**全局单库**
//! （按 `project_id` 列归属 + 前端按项目过滤），不存在「切换后端数据库」动作，保留空壳只会造成"已切换"的错觉。

use tauri::Manager;

/// 获取应用数据目录路径（用于自动绑定项目存储目录）
///
/// FileStorageBackend 以文件系统为主存储时需要一个可用目录；
/// 返回 Tauri 应用数据目录（如 %APPDATA%/com.worldsea.app 或 ~/.local/share/...），
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

/// 获取用户主目录路径（创作数据根 = `<home>/WorldSea`）
///
/// 全局规则（`<home>/WorldSea/rules`）与个人技能导入区（`<home>/WorldSea/skills`）的载体根（单一可见根）。
/// 前端 `getHomeDirCached` 缓存后供 globalRulesDirSync / RulesPanel 使用（双端一致）。
#[tauri::command]
pub async fn cmd_get_home_dir(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app
        .path()
        .home_dir()
        .map_err(|e| format!("无法定位用户主目录: {e}"))?;
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
