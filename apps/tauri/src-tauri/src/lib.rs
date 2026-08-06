// WorldSmith Tauri App — Agent 端到端闭环（Phase 5.x）
//
// Phase 5.1：注册 agent-commands 命令层，manage 一个 AgentCommandService 实例，
// 供 WebView 前端 invoke 调用（newSession / sendMessage / abort / ... 14 主链路命令）。

use std::sync::Arc;

use agent_commands::{
    AgentCommandService, LongTaskRepository, LoopControlRegistry, SqliteSubAgentSpecStore,
    TerminalService,
};
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
            // Loop Engineering：Loop Control 11 命令（cmd_loop_control_*）
            commands::cmd_loop_control_create,
            commands::cmd_loop_control_check,
            commands::cmd_loop_control_record_turn,
            commands::cmd_loop_control_record_tool_call,
            commands::cmd_loop_control_record_tokens,
            commands::cmd_loop_control_update_activity,
            commands::cmd_loop_control_reset_counters,
            commands::cmd_loop_control_get_config,
            commands::cmd_loop_control_get_status,
            commands::cmd_loop_control_destroy,
            commands::cmd_loop_control_list_tasks,
            // Loop Engineering：长任务 7 命令（cmd_long_task_*）
            commands::cmd_long_task_save,
            commands::cmd_long_task_load,
            commands::cmd_long_task_list_running,
            commands::cmd_long_task_list_all,
            commands::cmd_long_task_update_heartbeat,
            commands::cmd_long_task_update_status,
            commands::cmd_long_task_delete,
        ])
        // Phase 5.1：Agent 命令服务（内部持有 session_id -> Arc<AgentLoop> 映射）
        // 终端服务（独立持有 ShellSessionManager，供前端直接调用终端命令）
        // Loop Engineering：LoopController 实例注册表 + 长任务 SQLite 持久化
        .manage(TerminalService::new())
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }

            // Loop Control 注册表：单独 manage 供 cmd_loop_control_* 命令使用，
            // 同时注入 AgentCommandService，使"绑定会话的 loop_control"复用
            // AgentLoop 内建 LoopController（共享单实例，消双轨）。
            let loop_control_registry = Arc::new(LoopControlRegistry::new());
            app.manage(loop_control_registry.clone());

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
                    .with_loop_control_registry(loop_control_registry)
                    // 记忆后端：传入应用数据目录子路径，new_session 时为每个会话构造
                    // MemoryCenterAccessor 并注入 AgentLoop（阶段 2：让桌面生效）
                    .with_memory_root(Some(app_data.join("worldsmith").join("memory")))
            });
            app.manage(svc);

            // 长任务持久化：独立数据库文件（long_tasks.db），供 cmd_long_task_* 命令使用
            let lt_db_path = app_data.join("long_tasks.db");
            let long_task_repo = tauri::async_runtime::block_on(async {
                LongTaskRepository::new(lt_db_path.to_str().unwrap())
                    .await
                    .expect("初始化长任务数据库失败")
            });
            app.manage(long_task_repo);

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}