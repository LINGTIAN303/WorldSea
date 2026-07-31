// WorldSmith Tauri App — Phase 2 骨架
//
// 仅最小可运行骨架，实际命令层（agent/entity/file/git/pty 等）将在 Phase 3 从 src-tauri/ 迁入。

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
