//! 系统层集成命令（通知 / 开机自启）：
//! - `cmd_notify`：发系统通知（前端在 Agent 长任务完成/失败等时机调用）
//! - `cmd_autostart_is_enabled` / `cmd_autostart_set_enabled`：开机自启开关（设置面板调用）
//!
//! 单实例 / 全局快捷键为纯 Rust 侧插件注册，见 lib.rs（无需前端命令）。

use tauri::AppHandle;

/// 发系统通知（title + body）。失败仅告警，不阻塞调用方。
#[tauri::command]
pub fn cmd_notify(app: AppHandle, title: String, body: String) {
    use tauri_plugin_notification::NotificationExt;
    let builder = app.notification().builder().title(&title).body(&body);
    if let Err(e) = builder.show() {
        tracing::warn!("系统通知发送失败（{title}）: {e}");
    }
}

/// 查询开机自启是否启用
#[tauri::command]
pub fn cmd_autostart_is_enabled(app: AppHandle) -> bool {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().unwrap_or(false)
}

/// 设置开机自启（启用/禁用）
#[tauri::command]
pub fn cmd_autostart_set_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let result = if enabled {
        app.autolaunch().enable()
    } else {
        app.autolaunch().disable()
    };
    result.map_err(|e| e.to_string())
}
