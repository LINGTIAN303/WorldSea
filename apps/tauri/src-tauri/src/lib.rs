// WorldSmith Tauri App — Agent 端到端闭环（Phase 5.x）
//
// Phase 5.1：注册 agent-commands 命令层，manage 一个 AgentCommandService 实例，
// 供 WebView 前端 invoke 调用（newSession / sendMessage / abort / ... 14 主链路命令）。

use agent_commands::{AgentCommandService, SqliteSubAgentSpecStore, TerminalService};
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
            commands::trim_context,
            commands::get_state,
            commands::get_messages,
            commands::is_streaming,
            commands::update_model,
            commands::update_thinking_level,
            commands::get_provider_config,
            commands::set_provider_config,
            commands::get_heartbeat,
            commands::terminal_execute_command,
            commands::terminal_detect_shells,
            commands::terminal_create_session,
            commands::terminal_exec_session,
            commands::terminal_input_session,
            commands::terminal_destroy_session,
            commands::terminal_list_sessions,
            commands::subagent_list_specs,
            commands::subagent_register_spec,
            commands::subagent_remove_spec,
            commands::subagent_export_specs,
            commands::subagent_import_specs,
            commands::subagent_list_instances,
            commands::subagent_clear_instance,
            commands::subagent_clear_instances,
        ])
        // Phase 5.1：Agent 命令服务（内部持有 session_id -> Arc<AgentLoop> 映射）
        // 终端服务（独立持有 ShellSessionManager，供前端直接调用终端命令）
        .manage(TerminalService::new())
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }

            // 子 Agent 规格持久化：把 SQLite 数据库放入应用数据目录，使前端配置的
            // 子 Agent 规格在应用重启后仍能恢复（写穿 + 启动加载）。
            let app_data = app
                .path()
                .app_data_dir()
                .expect("无法定位应用数据目录");
            std::fs::create_dir_all(&app_data).ok();
            let db_path = app_data.join("subagent_specs.db");
            let svc = tauri::async_runtime::block_on(async {
                let store = SqliteSubAgentSpecStore::new(db_path.to_str().unwrap())
                    .await
                    .expect("初始化子 Agent 规格数据库失败");
                AgentCommandService::with_subagent_store(store)
                    .await
                    .expect("初始化 Agent 命令服务失败")
            });
            app.manage(svc);

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}