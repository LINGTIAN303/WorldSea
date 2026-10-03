// WorldSea Tauri App — Agent 端到端闭环（Phase 5.x）
//
// Phase 5.1：注册 agent-commands 命令层，manage 一个 AgentCommandService 实例，
// 供 WebView 前端 invoke 调用（newSession / sendMessage / abort / ... 14 主链路命令）。
// 批次97：窗口层体验——窗口状态记忆（位置/大小持久化）+ 系统托盘（后台长任务不中断）
// + 关闭即最小化到托盘（托盘菜单「退出」才是真正退出）。

use std::sync::Mutex;

use tauri::Manager;

mod win_job;
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

// B2 壳接入（2026-09-23）：spawn dsh host + 就绪探测 + 主窗口导航到 dsh 界面 + 退出回收
mod dsh_shell;
// C1-a（2026-09-24）：`worldsea` 协议层代理宿主（UI origin 与传输面分离）+ 303 cookie 交换
mod dsh_bridge;
// C1-b（2026-09-24）：协议转发核心（路径/方法闸门、缓存策略、失败降级）
mod dsh_proxy;
// C2-b（2026-09-24）：index 注入脚本装配（传输面三态 + 安全网 + 壳桥 + 诊断）
mod dsh_inject;
// D1-a（2026-09-24）：工作台静态伺服（壳协议 `/workspace` 前缀；产物运行时读盘、不嵌二进制）
mod workspace_dist;
// D1-b（2026-09-24）：工作台窗口（懒创建 + 与 Agent 空间互斥切换 + 几何同步）
mod workspace_window;
// E2（2026-09-24）：应用级偏好真源（主题）——壳持有，两窗读写，dsh 经设置通道对齐
mod app_prefs;
// 2026-09-30 arch 拆分：启动装配（setup 链 + 窗口事件 + 托盘激活态）——原 lib.rs 内联
mod app_setup;
// 2026-09-30 arch 拆分：dsh 主题桥（与 dsh 的读写对齐）——原 app_prefs.rs 内联
mod app_prefs_dsh;
// A（2026-09-25）：壳侧能力桥——类型化能力注册表 + 调用 ACL + 两窗中转 + 审计（双 Cordis 的交界缝）
mod capabilities;
// E1（2026-09-25）：单一可见根（%USERPROFILE%\WorldSea）+ 旧 ~/.WorldSea 一次性搬迁
mod data_root;
// C1-a（2026-09-24）：mux WebSocket 凭据中转（改写握手首部后双向透传；C2 起仅 legacy 对照模式使用）
mod dsh_relay;
// C2-b（2026-09-24）：管道传输客户端（宿主管道载体的壳侧对端：帧编解码 + 请求多路复用 + 流 lane）
mod dsh_pipe;
// C2-b（2026-09-24）：管道帧解析/派发与两条 I-O 循环（套接字双线程 / Windows 单线程轮询）
mod dsh_pipe_io;
// C2-b（2026-09-24）：页面流桥命令（openStream 钩子 → 管道 mux 流）
mod dsh_stream;
// F4（2026-09-30）：Channel 投递全序修复（拦截器：全部 Channel 消息走有序 eval 直投，弃异步 fetch 路径）
mod channel_order;
// C1-c（2026-09-24）：壳桥（页面可调的壳命令：外链 / 日志）——JS 侧见 dsh_shell_bridge.js
mod shell_bridge;
// C1-c（2026-09-24）：原生菜单（文件/编辑/视图/设置）
mod menu;
// C3-b（2026-09-24）：壳级导航/新窗栅栏（WebView2 事件层；策略为纯函数）
mod nav_fence;
// C4-a（2026-09-24）：工作区可供给性探针（WRITE_OWNER 开目录句柄的无副作用判定；见 C4 批计划 §二）
mod workspace_probe;
// C4（2026-09-24）：工作区取向与提示（默认工作区解析 / 启动探测+通知 / 一键修复）
mod dsh_workspace;
// G3（2026-10-01）：可回滚的工作区修复（主路径=上游 rc.2 ACL 脚本 / 兜底=icacls 备份+授权；恢复命令落盘）
mod acl_fix;
// C5（2026-09-24）：凭据环境取向（库优先 + env 兜底；判定与留痕）
mod dsh_credentials;
// D2-c（2026-09-27）：产品域说明书（Agent 认知面——工作区根 WORLDSEA.md，幂等生成不覆盖）
mod worldsea_manual;
// 安全存储命令（cmd_secure_store/load/delete）：API Key 落应用数据目录 SQLite（模型注册表 key-store 消费）
mod secure_store;
// 图布局/图分析算法命令（cmd_algo_*）：薄封装 worldsea-core 算法（mindmap 等产品 IPC 消费）
mod algo_commands;
// 文档格式预览：本机 Office 转换（ppt/pptx → PDF，LibreOffice headless；含探测与缓存）
mod office_commands;

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
        // F4（2026-09-30）：Channel 投递全序修复——Tauri 默认对 ≥8KB 的 JSON 走异步 fetch，
        // 与 <8KB 的同步 eval 相混时不保序（真机取证：长会话快照被流式小帧超车 → 前端冻结）。
        // 反证开关 WORLDSEA_NO_CHANNEL_ORDER_FIX=1 → 交回默认双路径（确定性复现应再红）。
        .channel_interceptor(channel_order::interceptor)
        // C1-a（2026-09-24）：壳注册 `worldsea` 协议——UI 页 origin 不再等于宿主 authority。
        // Windows 落形 = `http://worldsea.localhost/`（wry workaround，见 dsh_bridge.rs 头注）。
        // D1-a：`/workspace` 前缀 = 工作台静态伺服（不依赖 dsh 桥——宿主未就绪也能开工作台）。
        .register_asynchronous_uri_scheme_protocol("worldsea", |ctx, request, responder| {
            if workspace_dist::is_workspace_path(request.uri().path()) {
                workspace_dist::handle_request(request, responder);
            } else {
                dsh_bridge::handle_request(ctx, request, responder);
            }
        })
        .invoke_handler(tauri::generate_handler![
            // LSP 外挂桥（智能提示三期 B1）：检测/启动/转发/停止
            lsp_commands::cmd_lsp_detect,
            lsp_commands::cmd_lsp_start,
            lsp_commands::cmd_lsp_send,
            lsp_commands::cmd_lsp_stop,
            // C1-c：壳桥命令（页面经 IPC 调用：外链 / 日志）
            shell_bridge::cmd_shell_open_external,
            shell_bridge::cmd_shell_bridge_report,
            // C4-b：一键修复工作区权限（用户点击才执行）
            shell_bridge::cmd_fix_workspace_acl,
            dsh_workspace::cmd_dsh_workspace_list, // D2-a：dsh 工作区列表转发（同源模型数据源）
            // C6：窗口栏（最小化/最大化⇄还原/关闭/起拖/查询）+ 「⋯」popup 菜单
            shell_bridge::cmd_shell_window_action,
            menu::cmd_shell_popup_menu,
            // D1-b：空间切换（Agent 空间⇄工作台，双窗互斥 + 几何同步；工作台窗懒创建）
            workspace_window::cmd_shell_space_switch,
            // E2：应用级偏好（主题真源：读写 + 同步 dsh + 广播两窗）
            app_prefs::cmd_theme_get,
            app_prefs::cmd_theme_set,
            // D3-a：产品域设置节（console 设置页读写；壳启动与工作台快照门消费）
            app_prefs::cmd_product_prefs_get,
            app_prefs::cmd_product_prefs_set,
            // A：壳侧能力桥（登记 / 内省 / 调用 / 回执 / 撤登记；两窗共用，ACL 在 Rust 侧按窗口 label 判）
            capabilities::cmd_capability_register,
            capabilities::cmd_capability_list,
            capabilities::cmd_capability_invoke,
            capabilities::cmd_capability_result,
            // C 批：撤登记（拆树/卸插件时收口声明面）
            capabilities::cmd_capability_unregister,
            // C2-b：页面流桥（openStream 钩子 → 管道 mux 流：开 / 上行 / 半关 / 取消）
            dsh_stream::cmd_stream_open,
            dsh_stream::cmd_stream_send,
            dsh_stream::cmd_stream_end,
            dsh_stream::cmd_stream_cancel,
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
            fs_commands::cmd_fs_usage,
            // 文档格式预览（2026-09-14）：本机 Office 转换 —— 探测 + ppt/pptx → PDF（带缓存）
            office_commands::cmd_office_available,
            office_commands::cmd_pptx_to_pdf,
            // Phase B 迁移：获取应用数据目录（自动绑定项目存储目录）
            project_commands::cmd_get_app_data_dir,
            // §六 全局层迁移：获取用户主目录（E1 起：创作数据在 `WorldSea/` 根下）
            project_commands::cmd_get_home_dir,
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
            tray::cmd_tray_page_ready,
            tray::cmd_tray_set_recent_projects,
            system::cmd_notify,
            system::cmd_autostart_is_enabled,
            system::cmd_autostart_set_enabled,
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
        // Phase C 收尾：文件监听器注册表（cmd_fs_watch_start/stop 共享）
        .manage(fs_watch_commands::FsWatchRegistry(Default::default()))
        .setup(app_setup::setup)
        // 关闭行为（批次97 P1-4）：托盘激活时关闭窗口仅隐藏到托盘，进程与 Agent 长任务
        // 继续运行；托盘菜单「退出」才是真正退出。托盘未激活时保持默认（关闭即退出）。
        .on_window_event(app_setup::on_window_event)
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                // LSP server 常驻进程随 App 真退出统一回收（防孤儿，立项 B1 验收项）
                lsp_commands::kill_all();
                // B2：dsh 子进程随壳退出回收（防孤儿 node 进程占端口）
                if let Some(state) = app.try_state::<dsh_shell::DshProcess>() {
                    state.kill();
                }
            }
        });
}
