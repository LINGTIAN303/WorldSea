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
// 音视频转录（candle-whisper 语音转文字）
mod whisper;

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
// C5（2026-09-24）：凭据环境取向（库优先 + env 兜底；判定与留痕）
mod dsh_credentials;

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
            // C6：窗口栏（最小化/最大化⇄还原/关闭/起拖/查询）+ 「⋯」popup 菜单
            shell_bridge::cmd_shell_window_action,
            menu::cmd_shell_popup_menu,
            // D1-b：空间切换（Agent 空间⇄工作台，双窗互斥 + 几何同步；工作台窗懒创建）
            workspace_window::cmd_shell_space_switch,
            // E2：应用级偏好（主题真源：读写 + 同步 dsh + 广播两窗）
            app_prefs::cmd_theme_get,
            app_prefs::cmd_theme_set,
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
            // 音视频转录（candle-whisper 语音转文字）
            whisper::transcribe_media,
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
        .setup(|app| {
            // E2（2026-09-24）：主题真源先落地——壳自有面（错误页/安全网/横幅）与两窗注入都要读它
            app_prefs::bootstrap(app.handle());
            // E1（2026-09-25）：单一可见根的就地搬迁（旧 ~/.WorldSea → %USERPROFILE%\WorldSea，只拷不删）
            let _ = data_root::migrate_legacy_home_root();

            // C3-b（2026-09-24）：壳级导航/新窗栅栏（WebView2 事件层；主框架 NavigationStarting +
            // NewWindowRequested）——先于壳的首次导航挂上，补 JS 守卫（C1-c′）覆盖不到的程序化导航；
            // 策略为纯函数（nav_fence.rs，含单测）。反证开关 WORLDSEA_NO_NAV_FENCE=1。
            #[cfg(windows)]
            if let Some(window) = app.get_webview_window("main") {
                nav_fence::install(&window);
            }

            // E6（2026-09-27）：还原几何自检——窗口状态插件会把「退出时最小化」的窗口按占位几何还原，
            // 使应用「打开即不可见」；主窗就位后校验一次，不可用则复位默认并居中。
            if let Some(window) = app.get_webview_window("main") {
                workspace_window::sanitize_restored_geometry(&window);
                // E9 #7：恢复主窗缩放档位（prefs.json `zoom.main`；缺省 100% 不动）
                menu::restore_zoom(&window);
                // E9 #11（P3 拍板 2026-09-27）：主窗配置 `visible:false`，启动可见性在此裁决——
                // 正常启动显示 + 聚焦；开机自启（`--autostart`）→ 托盘常驻不弹窗（点托盘/快捷键唤起）。
                if std::env::args().any(|arg| arg == "--autostart") {
                    println!("[DSH-SHELL] 启动形态：开机自启 → 托盘常驻（不自动显示窗口）");
                } else {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }

            // ── B2 壳接入（2026-09-23）＋ C1-a 协议桥（2026-09-24）──────────────
            // 装配全在 dsh_shell::install（spawn/就绪/守护）与 dsh_bridge::attach（协议页/回退）：
            // UI origin 与传输面分离，界面 100% 保留；口径见 docs/plans/ 的准备方案 §六 与 C1 批计划 §三。
            dsh_shell::install(app.handle(), app.get_webview_window("main").as_ref());
            menu::install(app.handle()); // C1-c：原生菜单（构建失败只告警，不阻塞启动）

            // dev 模式内置开发者工具：默认关闭（2026-09-08 起）。
            // 原因：本机 WebView2 152 打开 devtools 同样触发 msedge.dll CHECK 崩溃
            // （异常码 0x80000003 EXCEPTION_BREAKPOINT）。需要内置 devtools 调试时：
            // 设环境变量 WORLDSEA_OPEN_DEVTOOLS=1 再启动（tauri dev 进程会继承）。
            #[cfg(debug_assertions)]
            if std::env::var_os("WORLDSEA_OPEN_DEVTOOLS").is_some() {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }
            // B2（2026-09-23）改回原生边框；C6（2026-09-24）恢复**无边框 + 壳级窗口栏**（旧 TitleBar 形态）：
            // 配置层 `decorations:false` 即缺省无边框；显式 `WORLDSEA_FRAMED=1` 回退原生边框
            // （此时 dsh 侧亦不注入窗口栏——注入开关见 dsh_bridge::prepare，两处同源判定）。
            if std::env::var_os("WORLDSEA_FRAMED").is_some() {
                if let Some(window) = app.get_webview_window("main") {
                    if !window.is_decorated().unwrap_or(false) {
                        let _ = window.set_decorations(true);
                    }
                }
                println!("[DSH-SHELL] 窗口形态：原生边框（WORLDSEA_FRAMED=1 回退口；不注入窗口栏）");
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

            // 应用数据目录：实体兜底库与安全存储落此
            let app_data = app
                .path()
                .app_data_dir()
                .expect("无法定位应用数据目录");
            std::fs::create_dir_all(&app_data).ok();
            // 实体/关系/KV/文件全局库（entities.db）：TauriStorageBackend fallback 用，
            // projectDir 未绑定（启动早期/无项目）时实体数据兜底存储。
            let entity_db_path = app_data.join("entities.db");
            let entity_db = tauri::async_runtime::block_on(async {
                entity_commands::EntityDb::new(entity_db_path.to_str().unwrap())
                    .await
                    .expect("初始化实体数据库失败")
            });
            // 安全存储（secure_store.db）：API Key 等的持久化（cmd_secure_store/load/delete）。
            // 前端 key-store 在 Tauri 环境优先走本命令；key 落应用数据目录，跨重启持久。
            let secure_store_path = app_data.join("secure_store.db");
            let secure_store = tauri::async_runtime::block_on(async {
                secure_store::SecureStore::new(secure_store_path.to_str().unwrap())
                    .await
                    .expect("初始化安全存储数据库失败")
            });
            app.manage(secure_store);
            app.manage(entity_db);

            // 系统托盘（tray.rs）：完整菜单（显示/新建/最近项目/设置/退出）。
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
                // D1-b：工作台窗的 ✕ = 隐藏 + 回 Agent 空间（不销毁页面——保住工作台内的编辑现场；
                // 托盘「退出」走 app.exit(0)，不经本分支，故不会挡真退出）
                if window.label() == workspace_window::LABEL {
                    api.prevent_close();
                    workspace_window::hide_and_back_to_space(window.app_handle());
                    return;
                }
                let active = window.state::<TrayActive>();
                if active.0 {
                    window.hide().ok();
                    api.prevent_close();
                }
            }
            // E2：系统深浅色变化（真源 = `system` 时）→ 刷新壳自有面的亮暗（页面侧自行跟随系统）
            if let tauri::WindowEvent::ThemeChanged(theme) = event {
                if app_prefs::preference_now() == "system" {
                    app_prefs::set_dark(*theme == tauri::Theme::Dark);
                }
            }
        })
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

/** 托盘是否激活：决定关闭窗口是「最小化到托盘」还是「直接退出」 */
struct TrayActive(bool);