use std::sync::Mutex;

use worldsmith_core::algo::spatial::rtree::SpatialIndex;
use worldsmith_core::retrofit::RetrofitEngine;
use worldsmith_core::storage::sqlite::SqliteStore;

mod state;
pub use state::{AppState, FsWatcherState, PtyProcess};
pub mod workflow;
mod skills_store;
mod commands;
mod schema_seed;
// 阶段 1.5：Agent Bridge — agent-runtime 与 Tauri 之间的适配层
mod agent_bridge;


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 阶段 2.1：初始化 tracing 日志（RUST_LOG=info 默认，可由环境变量覆盖）
    // 用途：CDP 自动化不可用时，通过 stdout 日志诊断 Agent 通信链路
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info,worldsmith_app_lib=debug,agent_runtime=debug")),
        )
        .with_target(true)
        .with_line_number(true)
        .try_init();

    tracing::info!("WorldSmith Tauri 应用启动");

    let db = SqliteStore::open_in_memory().expect("SQLite 内存数据库初始化失败");

    let mut schema_reg = worldsmith_core::schema::SchemaRegistry::new();
    schema_seed::seed_schema(&mut schema_reg);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .manage(AppState {
            db: Mutex::new(db),
            retrofit: Mutex::new(RetrofitEngine::new()),
            spatial: Mutex::new(SpatialIndex::new()),
            schema: Mutex::new(schema_reg),
            mcp_processes: Mutex::new(std::collections::HashMap::new()),
            pty_processes: Mutex::new(std::collections::HashMap::new()),
            pty_output_receivers: Mutex::new(std::collections::HashMap::new()),
            wf_engine: std::sync::Arc::new(crate::workflow::engine::WorkflowEngine::new()),
            wf_db_path: Mutex::new(String::new()),
            plugin_node_metas: Mutex::new(std::collections::HashMap::new()),
            dispatcher_registry: std::sync::Arc::new(std::sync::Mutex::new(std::collections::HashMap::new())),
            agent_registry: std::sync::Arc::new(crate::agent_bridge::AgentRegistry::new()),
            // 阶段 2.1：Supervisor 实例注册表（与 AgentRegistry 并列存在）
            supervisor_registry: std::sync::Arc::new(crate::agent_bridge::SupervisorRegistry::new()),
            // 阶段 2.5：Router 实例注册表（与 AgentRegistry / SupervisorRegistry 并列存在）
            router_registry: std::sync::Arc::new(crate::agent_bridge::RouterRegistry::new()),
            // 阶段 2.1：ToT 实例注册表（与 AgentRegistry / SupervisorRegistry / RouterRegistry 并列存在）
            tot_registry: std::sync::Arc::new(crate::agent_bridge::ToTRegistry::new()),
            // 阶段 2.2：GoT 实例注册表（与 AgentRegistry / SupervisorRegistry / RouterRegistry / ToTRegistry 并列存在）
            got_registry: std::sync::Arc::new(crate::agent_bridge::GoTRegistry::new()),
            // 阶段 2.3：Multi-Agent 实例注册表（与上述 Registry 并列存在）
            ma_registry: std::sync::Arc::new(crate::agent_bridge::MultiAgentRegistry::new()),
            // 阶段 2.6：Loop Engineering 实例管理（横切关注点，按 task_id 索引）
            loop_control_registry: std::sync::Arc::new(
                crate::agent_bridge::LoopControlRegistry::new(),
            ),
            session_repository: std::sync::OnceLock::new(),
            long_task_repository: std::sync::OnceLock::new(),
        })
        .setup(|app| {
            // 阶段 2.5：初始化 Agent 会话持久化仓库
            // 必须在 setup 中执行，因为 app_data_dir 需要 PathResolver（仅 App 实例可用）
            use tauri::Manager;
            let app_state = app.state::<AppState>();
            match app.path().app_data_dir() {
                Ok(dir) => {
                    // WORLDSMITH_DATA_DIR 环境变量优先：数据目录可配置
                    // （测试沙箱隔离 / 多实例 / 自定义位置），未设置则回退系统 app_data_dir。
                    // db 文件仍为 agent_sessions.db，Session 与 LongTask 共用同库。
                    let base_dir = std::env::var("WORLDSMITH_DATA_DIR")
                        .map(std::path::PathBuf::from)
                        .unwrap_or_else(|_| dir.clone());
                    let db_path = base_dir.join("agent_sessions.db");
                    tracing::info!(
                        "初始化 SessionRepository: db_path={}",
                        db_path.display()
                    );
                    match crate::agent_bridge::SessionRepository::open(db_path.clone()) {
                        Ok(repo) => {
                            if app_state.session_repository.set(repo).is_err() {
                                tracing::error!("SessionRepository 注入失败（已被占用）");
                            }
                        }
                        Err(e) => {
                            tracing::error!(
                                "SessionRepository 初始化失败，session 持久化命令将不可用: {}",
                                e
                            );
                        }
                    }

                    // 阶段 2.2：初始化 LongTaskRepository（Loop Engineering）
                    // 与 SessionRepository 共用同一 db 文件，但持有独立 Connection。
                    // 失败不阻塞应用启动，仅记录错误日志，长任务相关命令将返回 NotReady。
                    tracing::info!(
                        "初始化 LongTaskRepository: db_path={}",
                        db_path.display()
                    );
                    match crate::agent_bridge::LongTaskRepository::open(db_path) {
                        Ok(repo) => {
                            if app_state.long_task_repository.set(repo).is_err() {
                                tracing::error!("LongTaskRepository 注入失败（已被占用）");
                            }
                        }
                        Err(e) => {
                            tracing::error!(
                                "LongTaskRepository 初始化失败，长任务持久化命令将不可用: {}",
                                e
                            );
                        }
                    }
                }
                Err(e) => {
                    tracing::error!(
                        "无法获取 app_data_dir，SessionRepository 未初始化: {}",
                        e
                    );
                }
            }
            Ok(())
        })
        .manage(FsWatcherState {
            watchers: Mutex::new(std::collections::HashMap::new()),
        })
        .invoke_handler(tauri::generate_handler![
            commands::project::cmd_init_db,
            commands::project::cmd_switch_project,
            commands::project::cmd_delete_project_db,
            commands::entity::cmd_put_entity,
            commands::entity::cmd_get_entity,
            commands::entity::cmd_get_all_entities,
            commands::entity::cmd_get_entities_by_type,
            commands::entity::cmd_update_entity,
            commands::entity::cmd_delete_entity,
            commands::entity::cmd_count_entities_by_type,
            commands::relation::cmd_put_relation,
            commands::relation::cmd_get_all_relations,
            commands::relation::cmd_get_relations_by_entity,
            commands::relation::cmd_delete_relation,
            commands::relation::cmd_delete_relations_by_entity,
            commands::entity::cmd_import_entities,
            commands::relation::cmd_import_relations,
            commands::relation::cmd_update_relation,
            commands::entity::cmd_clear_entities,
            commands::relation::cmd_clear_relations,
            commands::kv::cmd_kv_get,
            commands::kv::cmd_kv_set,
            commands::kv::cmd_kv_get_all,
            commands::kv::cmd_kv_delete,
            commands::kv::cmd_kv_clear,
            commands::file::cmd_get_all_files,
            commands::file::cmd_get_file,
            commands::file::cmd_get_file_by_path,
            commands::file::cmd_get_files_by_entity,
            commands::file::cmd_put_file,
            commands::file::cmd_update_file,
            commands::file::cmd_delete_file,
            commands::file::cmd_get_file_content,
            commands::validate::cmd_validate_entity,
            commands::validate::cmd_validate_entities,
            commands::validate::cmd_validate_pack,
            commands::validate::cmd_check_references,
            commands::validate::cmd_migrate,
            commands::validate::cmd_run_diagnostics,
            commands::validate::cmd_check_storage_health,
            commands::validate::cmd_validate_plugin_manifest,
            commands::validate::cmd_check_plugin_health,
            commands::retrofit::cmd_retrofit_begin_session,
            commands::retrofit::cmd_retrofit_submit_intent,
            commands::retrofit::cmd_retrofit_confirm_and_stage,
            commands::retrofit::cmd_retrofit_apply_next,
            commands::retrofit::cmd_retrofit_verify_and_accept,
            commands::retrofit::cmd_retrofit_request_repair,
            commands::retrofit::cmd_retrofit_redirect,
            commands::retrofit::cmd_retrofit_rollback_last,
            commands::retrofit::cmd_retrofit_abort,
            commands::retrofit::cmd_retrofit_session_phase,
            commands::retrofit::cmd_retrofit_patch_diff,
            commands::retrofit::cmd_retrofit_patch_apply,
            commands::retrofit::cmd_retrofit_detect_conflicts,
            commands::retrofit::cmd_retrofit_end_session,
            commands::spatial::cmd_spatial_insert_rect,
            commands::spatial::cmd_spatial_insert_point,
            commands::spatial::cmd_spatial_query_range,
            commands::spatial::cmd_spatial_query_at_point,
            commands::spatial::cmd_spatial_nearest_point,
            commands::spatial::cmd_spatial_k_nearest,
            commands::spatial::cmd_spatial_query_by_category,
            commands::spatial::cmd_spatial_remove_rect,
            commands::spatial::cmd_spatial_clear,
            commands::spatial::cmd_spatial_counts,
            commands::algo::cmd_algo_segment_intersect,
            commands::algo::cmd_algo_segment_intersection_point,
            commands::algo::cmd_algo_find_all_intersections,
            commands::algo::cmd_algo_point_in_polygon,
            commands::algo::cmd_algo_polygon_area,
            commands::algo::cmd_algo_polygon_centroid,
            commands::algo::cmd_algo_convex_hull,
            commands::algo::cmd_algo_aabb_intersects,
            commands::algo::cmd_algo_obb_intersects,
            commands::algo::cmd_algo_dijkstra,
            commands::algo::cmd_algo_dijkstra_path,
            commands::algo::cmd_algo_astar,
            commands::algo::cmd_algo_k_shortest_paths,
            commands::algo::cmd_algo_topological_sort,
            commands::algo::cmd_algo_connected_components,
            commands::algo::cmd_algo_tarjan_scc,
            commands::algo::cmd_algo_find_dangling,
            commands::algo::cmd_algo_force_layout,
            commands::algo::cmd_algo_grid_layout,
            commands::algo::cmd_algo_radial_layout,
            commands::algo::cmd_algo_tree_layout,
            commands::algo::cmd_algo_layout_unified,
            commands::algo::cmd_algo_crdt_lww_new,
            commands::algo::cmd_algo_crdt_lww_set,
            commands::algo::cmd_algo_crdt_lww_merge,
            commands::algo::cmd_algo_crdt_orset_new,
            commands::algo::cmd_algo_crdt_orset_add,
            commands::algo::cmd_algo_crdt_orset_remove,
            commands::algo::cmd_algo_crdt_orset_merge,
            commands::algo::cmd_algo_crdt_orset_elements,
            commands::algo::cmd_algo_crdt_rga_new,
            commands::algo::cmd_algo_crdt_rga_insert,
            commands::algo::cmd_algo_crdt_rga_delete,
            commands::algo::cmd_algo_crdt_rga_merge,
            commands::algo::cmd_algo_crdt_rga_text,
            commands::algo::cmd_algo_crdt_vc_compare,
            commands::algo::cmd_algo_terrain_noise,
            commands::algo::cmd_algo_terrain_heightmap_generate,
            commands::algo::cmd_algo_terrain_heightmap_slope,
            commands::algo::cmd_algo_terrain_heightmap_aspect,
            commands::algo::cmd_algo_terrain_marching_squares,
            commands::algo::cmd_algo_constraint_solve,
            commands::algo::cmd_algo_dxf_parse,
            commands::algo::cmd_algo_dxf_generate,
            commands::algo::cmd_algo_dxf_extract_constraints,
            commands::algo::cmd_algo_polygon_boolean,
            commands::algo::cmd_algo_polygon_offset,
            commands::algo::cmd_algo_polygon_simplify,
            commands::algo::cmd_algo_line_length,
            commands::algo::cmd_algo_pagerank,
            commands::algo::cmd_algo_community_detection,
            commands::algo::cmd_algo_betweenness_centrality,
            commands::algo::cmd_algo_hydraulic_erosion,
            commands::algo::cmd_algo_viewshed,
            commands::algo::cmd_algo_chaikin_smooth,
            commands::algo::cmd_algo_find_shared_edges,
            commands::algo::cmd_algo_find_line_polygon_intersections,
            commands::algo::cmd_algo_polygon_split,
            commands::algo::cmd_algo_polygon_augment,
            commands::schema::cmd_schema_register_entity_type,
            commands::schema::cmd_schema_unregister_entity_type,
            commands::schema::cmd_schema_get_entity_type,
            commands::schema::cmd_schema_list_entity_types,
            commands::schema::cmd_schema_update_entity_type,
            commands::schema::cmd_schema_register_validation,
            commands::schema::cmd_schema_register_view,
            commands::mcp::cmd_mcp_spawn,
            commands::mcp::cmd_mcp_kill,
            commands::mcp::cmd_mcp_list,
            commands::font::cmd_font_scan_system,
            commands::font::cmd_font_read_file,
            commands::skills::cmd_skills_get_dir,
            // ─── Skills Store（Task 24 阶段2）─────────────────────────
skills_store::cmd_skills_download_manifest,
skills_store::cmd_skills_install,
skills_store::cmd_skills_uninstall,
skills_store::cmd_skills_get_installed_versions,
skills_store::cmd_skills_import_local,
            commands::fs::cmd_fs_read,
            commands::fs::cmd_fs_read_binary,
            commands::fs::cmd_fs_write,
            commands::fs::cmd_fs_write_binary,
            commands::fs::cmd_fs_list,
            commands::fs::cmd_fs_mkdir,
            commands::fs::cmd_fs_stat,
            commands::fs::cmd_fs_copy,
            commands::fs::cmd_fs_rename,
            commands::fs::cmd_fs_delete,
            commands::fs::cmd_fs_search,
            commands::fs::cmd_fs_watch_start,
            commands::fs::cmd_fs_watch_stop,
            // ─── workflow plugin (Phase 1) ─────────────────────────────
            crate::workflow::commands::definitions::workflow_list,
            crate::workflow::commands::definitions::workflow_get,
            crate::workflow::commands::definitions::workflow_create,
            crate::workflow::commands::definitions::workflow_update,
            crate::workflow::commands::definitions::workflow_delete,
            crate::workflow::commands::definitions::workflow_export,
            crate::workflow::commands::definitions::workflow_import,
            crate::workflow::commands::node_meta::workflow_list_node_types,
            crate::workflow::commands::node_meta::workflow_get_node_schema,
            crate::workflow::commands::node_meta::workflow_register_node_type,
            crate::workflow::commands::node_meta::workflow_unregister_node_type,
            crate::workflow::commands::dry_run::workflow_dry_run,
            crate::workflow::commands::runs::workflow_run,
            crate::workflow::commands::runs::workflow_run_sync,
            crate::workflow::commands::runs::workflow_pause,
            crate::workflow::commands::runs::workflow_resume,
            crate::workflow::commands::runs::workflow_cancel,
            crate::workflow::commands::runs::workflow_skip_to,
            crate::workflow::commands::runs::workflow_status,
            crate::workflow::commands::runs::workflow_list_runs,
            crate::workflow::commands::runs::workflow_get_run,
            crate::workflow::commands::dispatch::workflow_node_result,
            crate::workflow::commands::dispatch::workflow_node_heartbeat,
            crate::workflow::commands::dispatch::workflow_node_cancel_ack,
            crate::workflow::commands::dispatch::workflow_node_chunk,
            crate::workflow::commands::settings::workflow_get_setting,
            crate::workflow::commands::settings::workflow_set_setting,
            crate::workflow::commands::settings::workflow_purge_runs_now,
            commands::secure::cmd_secure_store,
            commands::secure::cmd_secure_load,
            commands::secure::cmd_secure_delete,
            commands::secure::cmd_secure_exists,
            // ─── PTY 终端命令 ─────────────────────────────────────────
            commands::pty::cmd_pty_spawn,
            commands::pty::cmd_pty_write,
            commands::pty::cmd_pty_resize,
            commands::pty::cmd_pty_kill,
            // ─── Shell 检测与会话管理 ──────────────────────────────────
            commands::shell::cmd_detect_shells,
            commands::shell::cmd_shell_session_create,
            commands::shell::cmd_shell_session_exec,
            commands::shell::cmd_shell_session_destroy,
            commands::shell::cmd_shell_session_list,
            commands::shell::cmd_shell_session_input,
            // ─── Agent 命令（阶段 1.5）─────────────────────────────────
            commands::agent::cmd_agent_create,
            commands::agent::cmd_agent_prompt,
            commands::agent::cmd_agent_steer,
            commands::agent::cmd_agent_follow_up,
            commands::agent::cmd_agent_abort,
            commands::agent::cmd_agent_destroy,
            commands::agent::cmd_agent_clear_history,
            commands::agent::cmd_agent_update_model,
            commands::agent::cmd_agent_update_thinking_level,
            commands::agent::cmd_agent_trim_context,
            commands::agent::cmd_agent_get_state_snapshot,
            commands::agent::cmd_agent_get_runtime_messages,
            commands::agent::cmd_agent_set_runtime_messages,
            commands::agent::cmd_agent_list_sessions,
            commands::agent::cmd_agent_tool_result,
            // 阶段 2.5：会话持久化命令
            commands::session::cmd_session_save,
            commands::session::cmd_session_load,
            commands::session::cmd_session_list,
            commands::session::cmd_session_delete,
            commands::session::cmd_session_update_title,
            commands::session::cmd_session_toggle_pin,
            // 阶段 2.2：长任务持久化命令（Loop Engineering 批次5）
            commands::long_task::cmd_long_task_save,
            commands::long_task::cmd_long_task_load,
            commands::long_task::cmd_long_task_list_running,
            commands::long_task::cmd_long_task_list_all,
            commands::long_task::cmd_long_task_update_heartbeat,
            commands::long_task::cmd_long_task_update_status,
            commands::long_task::cmd_long_task_delete,
            // 阶段 2.1：Supervisor Pattern 命令（SupervisorNode Tauri 集成）
            commands::supervisor::cmd_supervisor_create,
            commands::supervisor::cmd_supervisor_run,
            commands::supervisor::cmd_supervisor_abort,
            commands::supervisor::cmd_supervisor_destroy,
            commands::supervisor::cmd_supervisor_get_state,
            commands::supervisor::cmd_supervisor_set_state,
            commands::supervisor::cmd_supervisor_list_sessions,
            commands::supervisor::cmd_supervisor_clear_agent_pool,
            // ─── Router（阶段 2.5 Router Pattern Tauri 命令层）─────────
            commands::router::cmd_router_create,
            commands::router::cmd_router_run,
            commands::router::cmd_router_abort,
            commands::router::cmd_router_destroy,
            commands::router::cmd_router_get_state,
            commands::router::cmd_router_set_state,
            commands::router::cmd_router_list_sessions,
            commands::router::cmd_router_get_targets,
            // ─── ToT（阶段 2.1 Tree of Thoughts Pattern Tauri 命令层）──
            commands::tot::cmd_tot_create,
            commands::tot::cmd_tot_run,
            commands::tot::cmd_tot_abort,
            commands::tot::cmd_tot_destroy,
            commands::tot::cmd_tot_get_state,
            commands::tot::cmd_tot_set_state,
            commands::tot::cmd_tot_list_sessions,
            commands::tot::cmd_tot_get_tree,
            // ─── GoT（阶段 2.2 Graph of Thoughts Pattern Tauri 命令层）──
            commands::got::cmd_got_create,
            commands::got::cmd_got_run,
            commands::got::cmd_got_abort,
            commands::got::cmd_got_destroy,
            commands::got::cmd_got_get_state,
            commands::got::cmd_got_set_state,
            commands::got::cmd_got_list_sessions,
            commands::got::cmd_got_get_tree,
            // ─── Multi-Agent（阶段 2.3 Multi-Agent Pattern Tauri 命令层）──
            commands::multi_agent::cmd_multi_agent_create,
            commands::multi_agent::cmd_multi_agent_run,
            commands::multi_agent::cmd_multi_agent_abort,
            commands::multi_agent::cmd_multi_agent_destroy,
            commands::multi_agent::cmd_multi_agent_get_state,
            commands::multi_agent::cmd_multi_agent_set_state,
            commands::multi_agent::cmd_multi_agent_list_sessions,
            commands::multi_agent::cmd_multi_agent_get_blackboard,
            // ─── Loop Control（阶段 2.6 Loop Engineering Tauri 命令层）──
            commands::loop_control::cmd_loop_control_create,
            commands::loop_control::cmd_loop_control_check,
            commands::loop_control::cmd_loop_control_record_turn,
            commands::loop_control::cmd_loop_control_record_tool_call,
            commands::loop_control::cmd_loop_control_record_tokens,
            commands::loop_control::cmd_loop_control_update_activity,
            commands::loop_control::cmd_loop_control_reset_counters,
            commands::loop_control::cmd_loop_control_get_config,
            commands::loop_control::cmd_loop_control_get_status,
            commands::loop_control::cmd_loop_control_destroy,
            commands::loop_control::cmd_loop_control_list_tasks,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
