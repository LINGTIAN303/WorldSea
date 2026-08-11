// WorldSmith Tauri App — Agent 端到端闭环（Phase 5.x）
//
// Phase 5.1：注册 agent-commands 命令层，manage 一个 AgentCommandService 实例，
// 供 WebView 前端 invoke 调用（newSession / sendMessage / abort / ... 14 主链路命令）。
// 批次97：窗口层体验——窗口状态记忆（位置/大小持久化）+ 系统托盘（后台长任务不中断）
// + 关闭即最小化到托盘（托盘菜单「退出」才是真正退出）。

use std::sync::{Arc, Mutex};

use agent_commands::{
    AgentCommandService, LongTaskRepository, LoopControlRegistry, SqliteSessionRepository,
    SqliteSubAgentSpecStore, TerminalService,
};
use tauri::Manager;

mod commands;
// Phase A 迁移：内容插件数据落盘（FileStorageBackend 依赖的 fs 命令）
mod fs_commands;
// Phase C 收尾：文件系统监听（useFsWatcher 依赖的 cmd_fs_watch_*）
mod fs_watch_commands;
// Phase A 迁移：项目切换命令（前端 useProjectSwitcher Tauri 分支）
mod project_commands;
// 实体/关系/KV/文件命令（TauriStorageBackend fallback 用，SQLite 全局库）
mod entity_commands;
// 系统层集成：托盘（完整菜单 + 状态同步 + 事件桥）
mod tray;
// 系统层集成：通知 / 开机自启命令
mod system;
// 音视频转录（candle-whisper 语音转文字）
mod whisper;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 单实例：防多开，二次启动聚焦已有主窗口（须最先注册）
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            tray::show_main_window(app);
        }))
        // 窗口状态记忆：恢复上次窗口位置/大小（桌面应用基础体验，批次97 P1-1）
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        // 系统通知：Agent 长任务完成/失败等（前端 cmd_notify 触发）
        .plugin(tauri_plugin_notification::init())
        // 全局快捷键：Ctrl+Shift+W 唤起/隐藏主窗口
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    use tauri_plugin_global_shortcut::{Code, Modifiers, ShortcutState};
                    if event.state == ShortcutState::Pressed
                        && shortcut
                            .matches(Modifiers::CONTROL | Modifiers::SHIFT, Code::KeyW)
                    {
                        tray::toggle_main_window(app);
                    }
                })
                .build(),
        )
        // 开机自启：设置面板 cmd_autostart_* 控制
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        // 托盘动态状态（前端命令回写）
        .manage(Mutex::new(tray::TrayState::default()))
        .invoke_handler(tauri::generate_handler![
            commands::new_session,
            commands::list_sessions,
            commands::delete_session,
            commands::update_session_title,
            commands::set_session_pinned,
            commands::create_group_session_participant,
            commands::list_group_session_participants,
            commands::delete_group_session_participants,
            commands::memory_list,
            commands::memory_recall,
            commands::memory_archive,
            commands::memory_load_chunk,
            commands::memory_boundary,
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
            // Phase A 迁移：文件系统命令（FileStorageBackend 数据落盘）
            fs_commands::cmd_fs_write,
            fs_commands::cmd_fs_read,
            fs_commands::cmd_fs_list,
            fs_commands::cmd_fs_delete,
            // Phase A 迁移：项目切换（useProjectSwitcher Tauri 分支）
            project_commands::cmd_switch_project,
            // Phase B 迁移：获取应用数据目录（自动绑定项目存储目录）
            project_commands::cmd_get_app_data_dir,
            // Phase B 迁移：删除项目数据目录（deleteProject Tauri 分支）
            project_commands::cmd_delete_project_db,
            // Phase C 收尾：文件系统监听（useFsWatcher）
            fs_watch_commands::cmd_fs_watch_start,
            fs_watch_commands::cmd_fs_watch_stop,
            // 实体/关系/KV/文件命令（TauriStorageBackend fallback）
            entity_commands::cmd_get_all_entities,
            entity_commands::cmd_get_entity,
            entity_commands::cmd_get_entities_by_type,
            entity_commands::cmd_put_entity,
            entity_commands::cmd_update_entity,
            entity_commands::cmd_delete_entity,
            entity_commands::cmd_count_entities_by_type,
            entity_commands::cmd_clear_entities,
            entity_commands::cmd_import_entities,
            entity_commands::cmd_get_all_relations,
            entity_commands::cmd_get_relations_by_entity,
            entity_commands::cmd_put_relation,
            entity_commands::cmd_update_relation,
            entity_commands::cmd_delete_relation,
            entity_commands::cmd_delete_relations_by_entity,
            entity_commands::cmd_clear_relations,
            entity_commands::cmd_import_relations,
            entity_commands::cmd_kv_get,
            entity_commands::cmd_kv_set,
            entity_commands::cmd_kv_delete,
            entity_commands::cmd_kv_get_all,
            entity_commands::cmd_get_all_files,
            entity_commands::cmd_get_file,
            entity_commands::cmd_get_file_by_path,
            entity_commands::cmd_get_files_by_entity,
            entity_commands::cmd_put_file,
            entity_commands::cmd_update_file,
            entity_commands::cmd_delete_file,
            entity_commands::cmd_get_file_content,
            // 系统层集成：托盘状态同步 / 系统通知 / 开机自启
            tray::cmd_tray_set_recent_projects,
            tray::cmd_tray_set_agent_state,
            system::cmd_notify,
            system::cmd_autostart_is_enabled,
            system::cmd_autostart_set_enabled,
            // 音视频转录（candle-whisper 语音转文字）
            whisper::transcribe_media,
        ])
        // Phase 5.1：Agent 命令服务（内部持有 session_id -> Arc<AgentLoop> 映射）
        // 终端服务（独立持有 ShellSessionManager，供前端直接调用终端命令）
        // Loop Engineering：LoopController 实例注册表 + 长任务 SQLite 持久化
        .manage(TerminalService::new())
        // Phase C 收尾：文件监听器注册表（cmd_fs_watch_start/stop 共享）
        .manage(fs_watch_commands::FsWatchRegistry(Default::default()))
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }
            // 无边框窗口兜底：tauri.conf.json 的 decorations:false 在增量编译缓存下
            // 可能未编译进二进制（首次实测出现双标题栏），窗口创建后运行时再强制一次。
            if let Some(window) = app.get_webview_window("main") {
                if window.is_decorated().unwrap_or(true) {
                    let _ = window.set_decorations(false);
                }
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
            let session_db_path = app_data.join("sessions.db");
            let svc = tauri::async_runtime::block_on(async {
                let store = SqliteSubAgentSpecStore::new(db_path.to_str().unwrap())
                    .await
                    .expect("初始化子 Agent 规格数据库失败");
                let session_store = SqliteSessionRepository::new(session_db_path.to_str().unwrap())
                    .await
                    .expect("初始化会话数据库失败");
                AgentCommandService::with_subagent_store(store)
                    .await
                    .expect("初始化 Agent 命令服务失败")
                    .with_loop_control_registry(loop_control_registry)
                    // 记忆后端：传入应用数据目录子路径，new_session 时为每个会话构造
                    // MemoryCenterAccessor 并注入 AgentLoop（阶段 2：让桌面生效）
                    .with_memory_root(Some(app_data.join("worldsmith").join("memory")))
                    // 会话持久化：注入 SQLite 会话存储，会话变更写穿 + 启动恢复
                    .with_session_store(session_store)
            });
            // 启动加载：从会话库恢复全部历史会话（重建 AgentLoop + 消息历史），
            // 失败仅告警弱提示，不阻塞应用启动（无历史则按空会话启动）。
            let restored = tauri::async_runtime::block_on(async { svc.restore_sessions().await });
            if let Err(e) = restored {
                tracing::warn!("恢复持久化会话失败（按空会话启动）: {e}");
            }
            app.manage(svc);

            // 长任务持久化：独立数据库文件（long_tasks.db），供 cmd_long_task_* 命令使用
            let lt_db_path = app_data.join("long_tasks.db");
            let long_task_repo = tauri::async_runtime::block_on(async {
                LongTaskRepository::new(lt_db_path.to_str().unwrap())
                    .await
                    .expect("初始化长任务数据库失败")
            });
            app.manage(long_task_repo);

            // 实体/关系/KV/文件全局库（entities.db）：TauriStorageBackend fallback 用，
            // projectDir 未绑定（启动早期/无项目）时实体数据兜底存储。
            let entity_db_path = app_data.join("entities.db");
            let entity_db = tauri::async_runtime::block_on(async {
                entity_commands::EntityDb::new(entity_db_path.to_str().unwrap())
                    .await
                    .expect("初始化实体数据库失败")
            });
            app.manage(entity_db);

            // 系统托盘（tray.rs）：完整菜单（显示/新建/最近项目/Agent/设置/状态/退出）。
            // 构建失败（如无图标）不阻塞启动，仅记录——关闭行为将回退为直接退出。
            let tray_active = match tray::build_tray(app.handle()) {
                Ok(_tray) => true,
                Err(e) => {
                    tracing::warn!("托盘初始化失败（关闭窗口将直接退出）: {e}");
                    false
                }
            };
            app.manage(TrayActive(tray_active));

            // 全局快捷键注册（Ctrl+Shift+W 唤起/隐藏主窗口）
            use tauri_plugin_global_shortcut::GlobalShortcutExt;
            if let Err(e) = app.global_shortcut().register("Ctrl+Shift+W") {
                tracing::warn!("全局快捷键 Ctrl+Shift+W 注册失败: {e}");
            }

            Ok(())
        })
        // 关闭行为（批次97 P1-4）：托盘激活时关闭窗口仅隐藏到托盘，进程与 Agent 长任务
        // 继续运行；托盘菜单「退出」才是真正退出。托盘未激活时保持默认（关闭即退出）。
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let active = window.state::<TrayActive>();
                if active.0 {
                    window.hide().ok();
                    api.prevent_close();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/** 托盘是否激活：决定关闭窗口是「最小化到托盘」还是「直接退出」 */
struct TrayActive(bool);