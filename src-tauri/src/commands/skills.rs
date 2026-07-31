//! Skills 目录管理命令
//!
//! 拆分自 lib.rs（P0-2 批次5）。
//! 提供 Skills Store 已安装技能根目录路径查询。
//! 前端通过此路径 + cmd_fs_list/cmd_fs_read 扫描并加载已安装技能。

use tauri::Manager;
use worldsmith_core::error::CoreError;

/// 获取已安装 Skills 的根目录路径（app_data_dir/skills），并确保目录存在。
/// 供 Skills Store 动态加载已安装技能使用。前端通过此路径 + cmd_fs_list/cmd_fs_read
/// 扫描并加载已安装技能的 manifest 与提示词文件。
#[tauri::command]
pub fn cmd_skills_get_dir(app: tauri::AppHandle) -> Result<String, CoreError> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| CoreError::storage(format!("获取 app data 目录失败: {e}")))?;
    let skills_dir = data_dir.join("skills");
    std::fs::create_dir_all(&skills_dir)
        .map_err(|e| CoreError::storage(format!("创建 skills 目录失败: {e}")))?;
    Ok(skills_dir.to_string_lossy().to_string())
}
