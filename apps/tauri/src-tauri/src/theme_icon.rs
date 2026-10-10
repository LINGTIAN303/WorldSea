// 主题跟随图标（2026-10-09）：窗口任务栏/托盘图标按应用当前生效深浅切换。
// - 深色 → 黑底白眼（icon-dark.png，融入深色任务栏/托盘）；浅色 → 白底黑眼（icon-light.png）；
// - 深浅真源 = `app_prefs::dark_now()`（`system` 态由 ThemeChanged 刷新，手动态由 cmd_theme_set 刷新）；
// - 图标为打包级资源（exe/安装包静态图标不受此影响——那是编译期嵌入，无法运行时切换，也不需要）。

use tauri::Manager;

/// 深色主题图标（黑底白眼；编译期嵌入）
const DARK_ICON: tauri::image::Image<'static> = tauri::include_image!("icons/icon-dark.png");
/// 浅色主题图标（白底黑眼；编译期嵌入）
const LIGHT_ICON: tauri::image::Image<'static> = tauri::include_image!("icons/icon-light.png");

/// 按当前生效深浅刷新全部窗口（任务栏图标）与托盘图标（幂等，重复调用无害）。
/// 挂点：启动（托盘就位后）/ 系统主题变化（ThemeChanged）/ 手动切主题（cmd_theme_set）/
/// 工作台窗懒创建（新窗默认带 bundle 图标，需对齐）。
pub fn apply(app: &tauri::AppHandle) {
    let icon = if crate::app_prefs::dark_now() { DARK_ICON } else { LIGHT_ICON };
    for (_, window) in app.webview_windows() {
        let _ = window.set_icon(icon.clone());
    }
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_icon(Some(icon));
    }
}
