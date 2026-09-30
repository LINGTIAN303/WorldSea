// 2026-09-30 arch 拆分：原 lib.rs 的启动装配（setup 链）与窗口事件处理外迁至此。
// lib.rs 保留 Builder 链的声明式装配；本模块承载各步实质动作（主题真源、单根搬迁、导航栅栏、
// 几何自检、壳接入、托盘、全局快捷键、WebView2 设置）与关闭行为（含托盘激活态）。

use tauri::Manager;

use crate::{app_prefs, data_root, dsh_shell, entity_commands, menu, nav_fence, secure_store, tray, workspace_window, worldsea_manual};

/// 启动装配（lib.rs `.setup` 链的实体）。
pub(crate) fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
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
        menu::restore_zoom(&window); // E9 #7：缩放档位恢复
        worldsea_manual::ensure_for_app(app.handle()); // D2-c：说明书幂等生成
        workspace_window::startup_visibility(&window); // E9 #11：自启到托盘 / 正常显示
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
}

/// 托盘是否激活：决定关闭窗口是「最小化到托盘」还是「直接退出」
struct TrayActive(bool);

/// 关闭行为（批次97 P1-4）：托盘激活时关闭窗口仅隐藏到托盘，进程与 Agent 长任务
/// 继续运行；托盘菜单「退出」才是真正退出。托盘未激活时保持默认（关闭即退出）。
pub(crate) fn on_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
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
}
