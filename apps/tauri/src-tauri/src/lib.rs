// WorldSea Tauri App — Agent 端到端闭环（Phase 5.x）
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
// LSP 外挂桥（智能提示三期 B1）：系统已装语言服务器检测 + stdio 帧 ↔ IPC
mod lsp_commands;
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
// B3 搜索 Provider 抽象 + 降级链（web_search 原生工具 + 配置命令）
mod search_commands;
// A4 Plan-Exec 计划工具（plan_create / plan_update）
mod plan_commands;
// Router Pattern 编排命令层：2026-09-09 随右栏 Router 区一并下线（Router 归场景识别底座，
// 非编排模式命令；底座为 agent-runtime 的 router 模块，不受影响）
// Rust → 前端 双向工具桥（entity_create/update + content_search 等经前端执行）
mod frontend_tool_bridge;
// MCP 客户端 Hub（rmcp：stdio / streamable-http 双传输 + 工具快照）
mod mcp_client;
// MCP Tauri 命令层（连接/断开/状态/持久化，SQLite mcp.db）
mod mcp_commands;
// Skills Store 命令层（Task 24 阶段2/4；H3 点火 2026-08-30 从 git 历史重建——
// 原实现在 980385c 端分离迁移中被删，详见 Harness 工程差距调研 H3）
mod skills_store;
// 安全存储命令（cmd_secure_store/load/delete）：API Key 落应用数据目录 SQLite
mod secure_store;
// [HTTP-BRIDGE] 临时：浏览器直连真实后端的 HTTP 服务（axum RPC + SSE）；移除时删除本段与 http_bridge/ 目录
mod http_bridge;
// [HTTP-BRIDGE] 图布局/图分析算法命令（cmd_algo_*）：薄封装 worldsea-core 算法，桌面 IPC + HTTP RPC 双端
mod algo_commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // [WebView2 崩溃记录] 2026-09-08：本机 WebView2 Runtime 152（152.0.4191.66，最新稳定）
    // 在 wry/Tauri 宿主下间歇性 msedge.dll CHECK 崩溃（转储异常地址 0x7FFE1511B21D，
    // EXCEPTION_BREAKPOINT），browser 进程启动或运行数分钟内随机触发、界面空白。
    // 已排除：devtools/GPU/user-data/参数（env WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
    // 与 set_var 均无效——wry 0.55 强制 set_additional_browser_arguments 覆盖 env；
    // msSmartScreenProtection 禁用亦无效）。疑 runtime 152 缺陷+本机被"优化"环境叠加。
    // 已知正常存活实例：首启曾稳定 20+ 分钟。对策：崩溃后重启实例；WebView2 153
    // （2026-09-10 发布）由 EdgeUpdate 自动更新后大概率自愈（152 为 2 周节奏首批）。
    // 若要传 WebView2 启动参数，须用 tauri::WebviewWindowBuilder::additional_browser_args()
    // 显式建窗（config 自动建窗无此通道），详见 docs。
    tauri::Builder::default()
        // 单实例：防多开，二次启动聚焦已有主窗口（须最先注册）
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            tray::show_main_window(app);
        }))
        // 窗口状态记忆：恢复上次窗口位置/大小（桌面应用基础体验，批次97 P1-1）
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        // 系统目录选择对话框：目录空间选择器「打开文件夹」/ 项目管理器绑定目录（plugin-dialog）
        .plugin(tauri_plugin_dialog::init())
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
            commands::list_scenarios,
            commands::list_patterns,
            commands::list_sessions,
            commands::get_run,
            commands::get_artifact,
            commands::list_session_runs,
            commands::delete_session,
            commands::update_session_title,
            commands::cmd_agent_generate_title,
            commands::cmd_update_session_workdir,
            commands::set_session_pinned,
            commands::cmd_list_workdirs,
            commands::cmd_save_workdir,
            commands::cmd_delete_workdir,
            commands::cmd_list_workspaces,
            // 创作编排模式步骤（tot-search / got-solve / multi-agent 接轨 B 轨引擎）
            commands::cmd_pattern_step_run,
            // supervisor 编排续跑（resume 入口，2026-09-09 接入）
            commands::cmd_run_supervisor_resume,
            commands::create_group_session_participant,
            commands::list_group_session_participants,
            commands::delete_group_session_participants,
            commands::memory_list,
            commands::memory_md_render,
            commands::memory_recall,
            commands::memory_archive,
            commands::memory_load_chunk,
            commands::memory_boundary,
            commands::send_message,
            commands::cmd_agent_confirm,
            commands::cmd_agent_set_security_level,
            // 诊断：会话工具名清单（MCP 注入链路验证）
            commands::cmd_agent_tool_names,
            commands::cmd_agent_update_system_prompt,
            // FrontendToolBridge：前端执行桥工具后按 callId 回传结果
            commands::cmd_agent_tool_result,
            // Skills Store（H3 点火 2026-08-30 重建）：商城安装/卸载/版本/本地导入/目录
            skills_store::cmd_skills_download_manifest,
            skills_store::cmd_skills_install,
            skills_store::cmd_skills_uninstall,
            skills_store::cmd_skills_get_installed_versions,
            skills_store::cmd_skills_import_local,
            skills_store::cmd_skills_get_dir,
            // MCP（H2 重建 2026-08-30 · rmcp）：连接/断开/状态/工具/持久化
            mcp_commands::cmd_mcp_connect,
            mcp_commands::cmd_mcp_disconnect,
            mcp_commands::cmd_mcp_status,
            mcp_commands::cmd_mcp_list_tools,
            mcp_commands::cmd_mcp_save,
            mcp_commands::cmd_mcp_delete,
            mcp_commands::cmd_mcp_saved,
            // LSP 外挂桥（智能提示三期 B1）：检测/启动/转发/停止
            lsp_commands::cmd_lsp_detect,
            lsp_commands::cmd_lsp_start,
            lsp_commands::cmd_lsp_send,
            lsp_commands::cmd_lsp_stop,
            // 诊断日志（临时，排障用）
            commands::cmd_diag_log,
            commands::abort,
            commands::steer,
            commands::clear_history,
            commands::trim_context,
            commands::get_state,
            commands::get_messages,
            // A1 R3：会话日志面板只读查询（统计 / 分页日志 / 事件流 / 活跃坐标 / 原文取回）
            commands::session_log_stats,
            commands::load_session_log,
            commands::load_session_events,
            commands::load_live_offsets,
            commands::memory_read_raw,
            commands::is_streaming,
            commands::update_model,
            commands::update_thinking_level,
            commands::get_provider_config,
            commands::set_provider_config,
            commands::set_api_key_pool,
            commands::get_heartbeat,
            commands::terminal_execute_command,
            commands::terminal_detect_shells,
            commands::terminal_create_session,
            commands::terminal_exec_session,
            commands::terminal_input_session,
            commands::terminal_destroy_session,
            commands::terminal_list_sessions,
            commands::terminal_poll_output,
            commands::terminal_resize,
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
            fs_commands::cmd_open_in_explorer,
            // Phase 4 工作区：文件系统元数据/目录/复制/重命名/搜索命令（WorkspacePanel 依赖）
            fs_commands::cmd_fs_stat,
            fs_commands::cmd_fs_mkdir,
            fs_commands::cmd_fs_copy,
            fs_commands::cmd_fs_rename,
            fs_commands::cmd_fs_search,
            // Phase A 迁移：项目切换（useProjectSwitcher Tauri 分支）
            project_commands::cmd_switch_project,
            // Phase B 迁移：获取应用数据目录（自动绑定项目存储目录）
            project_commands::cmd_get_app_data_dir,
            // §六 全局层迁移：获取用户主目录（~/.WorldSea 载体根）
            project_commands::cmd_get_home_dir,
            // Phase B 迁移：删除项目数据目录（deleteProject Tauri 分支）
            project_commands::cmd_delete_project_db,
            // Phase C 收尾：文件系统监听（useFsWatcher）
            fs_watch_commands::cmd_fs_watch_start,
            fs_watch_commands::cmd_fs_watch_stop,
            // v2 权限规则引擎（方向3 P0，2026-09-03）：白名单/上锁名单 CRUD
            commands::cmd_perm_rules_get,
            commands::cmd_perm_rule_add_allow_command,
            commands::cmd_perm_rule_remove_allow_command,
            commands::cmd_perm_rule_add_allow_path,
            commands::cmd_perm_rule_remove_allow_path,
            commands::cmd_perm_rule_add_lock,
            commands::cmd_perm_rule_remove_lock,
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
            // B3 搜索 Provider 配置（设置搜索 API Key，作用于 web_search 工具降级链）
            search_commands::set_search_config,
            // 安全存储（cmd_secure_store/load/delete）：API Key 落应用数据目录 SQLite
            secure_store::cmd_secure_store,
            secure_store::cmd_secure_load,
            secure_store::cmd_secure_delete,
            // [HTTP-BRIDGE] 图布局/图分析算法（cmd_algo_*）：mindmap Rust 布局/分析真实后端
            algo_commands::cmd_algo_force_layout,
            algo_commands::cmd_algo_radial_layout,
            algo_commands::cmd_algo_tree_layout,
            algo_commands::cmd_algo_grid_layout,
            algo_commands::cmd_algo_layout_unified,
            algo_commands::cmd_algo_dijkstra_path,
            algo_commands::cmd_algo_connected_components,
            algo_commands::cmd_algo_pagerank,
            algo_commands::cmd_algo_community_detection,
        ])
        // Phase 5.1：Agent 命令服务（内部持有 session_id -> Arc<AgentLoop> 映射）
        // 终端服务（独立持有 ShellSessionManager，供前端直接调用终端命令）
        // Loop Engineering：LoopController 实例注册表 + 长任务 SQLite 持久化
        .manage(TerminalService::new())
        // Phase C 收尾：文件监听器注册表（cmd_fs_watch_start/stop 共享）
        .manage(fs_watch_commands::FsWatchRegistry(Default::default()))
        .setup(|app| {
            // dev 模式内置开发者工具：默认关闭（2026-09-08 起）。
            // 原因：本机 WebView2 152 打开 devtools 同样触发 msedge.dll CHECK 崩溃
            // （异常码 0x80000003 EXCEPTION_BREAKPOINT）。需要内置 devtools 调试时：
            // 设环境变量 WORLDSEA_OPEN_DEVTOOLS=1 再启动（tauri dev 进程会继承）。
            #[cfg(debug_assertions)]
            if std::env::var_os("WORLDSEA_OPEN_DEVTOOLS").is_some() {
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

            // 窗口控制键 F11 修复：WebView2 默认开启浏览器加速键（AreBrowserAcceleratorKeysEnabled），
            // F11/F12/Ctrl+F 等被壳层吞掉、页面 keydown 收不到——F11 绝对全屏（TitleBar
            // onWindowKeydown）需要页面自己收到按键。tauri 未透传 wry 的
            // browser_accelerator_keys 开关，只能经 with_webview 直接调 WebView2 设置。
            // 副作用：F12 开发者工具快捷键失效——dev 模式已由上方 open_devtools() 兜底。
            #[cfg(windows)]
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.with_webview(|webview| {
                    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
                    use windows::core::Interface;
                    // 链路：Controller → CoreWebView2 → Settings → Settings3（加速键开关在 Settings3）
                    let controller = webview.controller();
                    unsafe {
                        if let Ok(core) = controller.CoreWebView2() {
                            if let Ok(settings) = core.Settings() {
                                if let Ok(settings3) = settings.cast::<ICoreWebView2Settings3>() {
                                    let _ = settings3.SetAreBrowserAcceleratorKeysEnabled(false);
                                }
                            }
                        }
                    }
                });
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
            // v2 权限规则引擎（方向3 P0，2026-09-03）：白名单/上锁名单 JSON 持久化
            agent_commands::permission_rules::init_rules(app_data.join("permission_rules.json"));
            let db_path = app_data.join("subagent_specs.db");
            let session_db_path = app_data.join("sessions.db");
            // 实体/关系/KV/文件全局库（entities.db）：TauriStorageBackend fallback 用，
            // projectDir 未绑定（启动早期/无项目）时实体数据兜底存储。
            // 先于 AgentCommandService 创建，供场景实体访问器（B1 场景上下文注入）引用。
            let entity_db_path = app_data.join("entities.db");
            let entity_db = tauri::async_runtime::block_on(async {
                entity_commands::EntityDb::new(entity_db_path.to_str().unwrap())
                    .await
                    .expect("初始化实体数据库失败")
            });
            // 安全存储（secure_store.db）：API Key 等的持久化（cmd_secure_store/load/delete）。
            // 前端 key-store 在 Tauri 环境优先走本命令；此前未注册导致「cmd_secure_store not found」
            // 警告 + 每次都降级 localStorage。此处补齐，key 落应用数据目录，跨重启持久。
            let secure_store_path = app_data.join("secure_store.db");
            let secure_store = tauri::async_runtime::block_on(async {
                secure_store::SecureStore::new(secure_store_path.to_str().unwrap())
                    .await
                    .expect("初始化安全存储数据库失败")
            });
            app.manage(secure_store);
            // B3 搜索 Provider 降级链：global 管理，供 web_search 工具 + set_search_config 命令共享
            let search_chain = Arc::new(search_commands::SearchProviderChain::new(
                search_commands::SearchConfig::default(),
            ));
            app.manage(search_chain.clone());
            // FrontendToolBridge：构造前端工具桥（注入 AppHandle 发全局 agent:tool_call 事件），
            // manage 供 cmd_agent_tool_result 命令使用；桥工具并入 extra_tools 注入每个会话
            let frontend_bridge = Arc::new(frontend_tool_bridge::FrontendToolBridge::new(
                app.handle().clone(),
            ));
            app.manage(frontend_bridge.clone());
            let mut svc = tauri::async_runtime::block_on(async {
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
                    .with_memory_root(Some(app_data.join("worldsea").join("memory")))
                    // 会话持久化：注入 SQLite 会话存储，会话变更写穿 + 启动恢复
                    .with_session_store(session_store)
                    // 场景底座（2026-09-09）：场景工作区根（严格硬隔离——场景会话 workdir
                    // 强制落在 scenes/<scene.workspace_hint()>，跨场景目录不可切）
                    .with_scenes_root(Some(app_data.join("scenes")))
                    // B1 场景上下文注入：注入实体访问器，场景 build_system_prompt 可感知项目已有实体
                    .with_entity_provider(Some(Arc::new(
                        entity_commands::SqliteScenarioEntityProvider::new(entity_db.clone()),
                    )))
                    // B1 场景工具桥 MVP：注入原生实体只读工具（entity_list/entity_get），
                    // 使 worldbuilding 场景 tool_ids() 声明的同名工具可被 LLM 调用
                    .with_extra_tools(
                        entity_commands::entity_read_tools(entity_db.clone())
                            .into_iter()
                            .chain(search_commands::search_tools(search_chain.clone()))
                            .chain(plan_commands::plan_tools())
                            // FrontendToolBridge：注入前端执行桥工具（entity_create/update +
                            // content_search），这些工具 Rust 无原生实现，经全局事件转前端执行
                            .chain(frontend_tool_bridge::bridge_tools(frontend_bridge.clone()))
                            .collect(),
                    )
                    // 任务29/M4 数据源收敛：有 workdir 的会话改用文件版实体读取
                    //（扫 {workdir}/entities/ 真身数据，同名覆盖 SQLite 兜底版；
                    //  EntityDb 由此收敛为前端 TauriStorageBackend fallback 专用）
                    .with_session_entity_adapter(
                        Arc::new(|workdir| entity_commands::fs_entity_tools(workdir.to_path_buf())),
                        Arc::new(|workdir| {
                            Arc::new(entity_commands::FsScenarioEntityProvider::new(
                                workdir.to_path_buf(),
                            )) as Arc<dyn agent_runtime::scenario::ScenarioEntityProvider>
                        }),
                    )
            });
            // H2 MCP 重建（P2，2026-08-30 · Rust 原生 rmcp 路线）：MCP Hub 初始化——
            // 打开 mcp.db（SQLite 持久化）+ 工具快照供给器（new_agent 时注入会话 tool_bus）
            let mcp_state = tauri::async_runtime::block_on(async {
                mcp_commands::init_state(app.handle()).await.expect("初始化 MCP 状态失败")
            });
            svc.set_mcp_tools_provider({
                let hub = mcp_state.hub.clone();
                Arc::new(move || hub.tools_for_bus())
            });
            app.manage(mcp_state);
            {
                let state = app.state::<mcp_commands::McpState>();
                tauri::async_runtime::block_on(mcp_commands::auto_connect_all(&state));
            }
            // 启动加载：从会话库恢复全部历史会话（重建 AgentLoop + 消息历史），
            // 失败仅告警弱提示，不阻塞应用启动（无历史则按空会话启动）。
            let restored = tauri::async_runtime::block_on(async { svc.restore_sessions().await });
            if let Err(e) = restored {
                tracing::warn!("恢复持久化会话失败（按空会话启动）: {e}");
            }
            app.manage(svc);
            app.manage(entity_db);

            // 长任务持久化：独立数据库文件（long_tasks.db），供 cmd_long_task_* 命令使用
            let lt_db_path = app_data.join("long_tasks.db");
            let long_task_repo = tauri::async_runtime::block_on(async {
                LongTaskRepository::new(lt_db_path.to_str().unwrap())
                    .await
                    .expect("初始化长任务数据库失败")
            });
            app.manage(long_task_repo);

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

            // [HTTP-BRIDGE] 临时：启动 HTTP 服务（浏览器直连真实后端）；移除时删除本段
            {
                let mut reg = http_bridge::rpc::Registry::new();
                http_bridge::rpc::register_core(&mut reg);
                let port = std::env::var("WORLDSEA_HTTP_PORT")
                    .ok()
                    .and_then(|s| s.parse::<u16>().ok())
                    .unwrap_or(8787);
                http_bridge::spawn(app.handle().clone(), Arc::new(reg), port);
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
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| {
            // LSP server 常驻进程随 App 真退出统一回收（防孤儿，立项 B1 验收项）
            if let tauri::RunEvent::Exit = event {
                lsp_commands::kill_all();
            }
        });
}

/** 托盘是否激活：决定关闭窗口是「最小化到托盘」还是「直接退出」 */
struct TrayActive(bool);