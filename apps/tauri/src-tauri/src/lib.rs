// WorldSmith Tauri App — Agent 端到端闭环（Phase 5.x）
//
// Phase 5.1：注册 agent-commands 命令层，manage 一个 AgentCommandService 实例，
// 供 WebView 前端 invoke 调用（newSession / sendMessage / abort / ... 14 主链路命令）。

use agent_commands::AgentCommandService;
use tauri::Manager;

mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::new_session,
            commands::list_sessions,
            commands::delete_session,
            commands::send_message,
            commands::abort,
            commands::steer,
            commands::clear_history,
            commands::get_state,
            commands::get_messages,
            commands::is_streaming,
            commands::update_model,
            commands::update_thinking_level,
            commands::get_provider_config,
            commands::set_provider_config,
            commands::get_heartbeat,
        ])
        // Phase 5.1：Agent 命令服务（内部持有 session_id -> Arc<AgentLoop> 映射）
        .manage(AgentCommandService::new())
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