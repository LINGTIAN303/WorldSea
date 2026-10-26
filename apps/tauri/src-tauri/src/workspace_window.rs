// 工作台窗口——启动预建 + 与 Agent 空间（`main` 窗）互斥切换（位置/尺寸同步）。
// - 独立窗口（label=`workspace`）承载产品域页面（壳协议 `/workspace/`）——ACL 按窗口隔离；
// - **启动预建**：产品域是默认落地——启动即以隐藏态建窗，页面首帧（启动页挂载）经首绘门显示；
//   建成后常驻（隐藏不销毁——保住工作台内的编辑现场）；
// - 切换 = 目标窗几何对齐（沿用来源窗位置/尺寸）→ 双侧遮罩（`__wsSpaceVeil`，眼睛跨窗位置连续）→
//   显示 + 聚焦 → 来源窗隐藏：观感等同同窗切换；
// - 关闭键 = 隐藏到托盘（两窗同语义，见 lib.rs 的 CloseRequested 分支）；新窗挂壳级导航/新窗栅栏（策略与 dsh 窗一致）。

use tauri::{Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::dsh_bridge::APP_URL;

/// 工作台窗口标签（ACL capability 的 `windows` 项按此绑定；见 capabilities/workspace.json）。
pub const LABEL: &str = "workspace";

/// 工作台页面 URL（壳协议 `/workspace` 前缀；与 dsh 页同源，故主题等 localStorage 互通）。
pub fn page_url() -> String {
    format!("{APP_URL}workspace/")
}

/// 当前所在空间（true = 工作台 / false = Agent 空间）：托盘左键、「显示窗口」菜单、
/// 单实例二次启动、全局快捷键据此显示**当前所在**的窗口（此前硬编码指主窗，是「主窗=家」模型残留）。
static CURRENT_SPACE_WORKBENCH: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(true);

/// 启动首绘门：启动路径下工作台窗以隐藏态预建，等页面首帧（启动页挂载）调
/// [`cmd_workspace_first_paint`] 再显示——窗口出现即已是启动页，全程无空白帧。
/// 仅正常启动路径置位（`--autostart` 托盘常驻不弹窗，门不置；手动切换不走门）。
static FIRST_SHOW_PENDING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// 空间切换互斥。
/// 背景（实测）：`cmd_shell_space_switch` 是 async 命令——快速连切（连按 Ctrl+Tab、两窗交替触发）时
/// 两次切换会**并发执行**，show/hide/unminimize 相互交错、完成序 ≠ 提交序（实测 6 连发多次终态违背
/// 最后一条指令，现象「两个窗同时在」/「界面状态拧巴」）；修法：所有切换经本锁**串行化**（show/hide 原子成对）。
/// ★ 死锁纪律：窗口操作要回主线程消息泵——主线程调用方（托盘菜单 / CloseRequested）绝不能阻塞等锁，一律用 [`request_space_switch`] 投递后台线程（async 命令线程与后台线程等锁安全）。
static SPACE_SWITCH_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// 空间切换遮罩 eval（页面侧执行体 = 注入的 `dsh_space_veil.js`，两页同款）。
/// action 为完整调用式（如 `show(true)` / `show()` / `release()`）：源窗侧 `show(true)` 淡入；
/// 目标窗侧 `show()` **无过渡出现**——窗口可见首帧遮罩即全不透明，防另一侧界面闪现（走查修复）。
/// 页面未载 / eval 失败一律静默——遮罩是观感增强，失败退化为原硬切，不影响切换正确性。
fn veil(app: &tauri::AppHandle, label: &str, action: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.eval(&format!("globalThis.__wsSpaceVeil && __wsSpaceVeil.{action}"));
    }
}

/// 页面侧入口（「Agent 空间⇄工作台」切换控件调用；经注入的 `__WORLDSEA_SPACE_SWITCH__` 桥）：
/// `target` = `space`（Agent 空间）| `workbench`（工作台）。返回切换后的空间名（调用方可留痕）。
/// ★ **必须是 async 命令**（真机实测踩坑）：同步命令在**主线程**执行，而 `WebviewWindowBuilder::build()`
/// 要在事件循环上等 WebView2 创建回执——事件循环正卡在本次 IPC 派发里 → 自锁（窗口停 `about:blank`、
/// 主线程不再响应 IPC）。async 命令跑在异步运行时线程上才有泵可跑；两臂经 [`SPACE_SWITCH_LOCK`] 串行化，等锁安全。
#[tauri::command]
pub async fn cmd_shell_space_switch(app: tauri::AppHandle, target: String) -> Result<String, String> {
    match target.as_str() {
        "workbench" => switch_to_workbench(&app).map(|()| "workbench".to_string()),
        "space" => switch_to_space(&app).map(|()| "space".to_string()),
        other => Err(format!("worldsea shell: 未知空间目标 {other}（可用：space / workbench）")),
    }
}

/// 切到工作台：预建窗（缺窗时兜底建）→ 几何平移来源窗 → 双侧遮罩（源浮现→底下换窗→目标续转）→ 隐藏 Agent 空间窗。
/// 互斥与「主线程调用方不得直呼」见 [`SPACE_SWITCH_LOCK`] / [`request_space_switch`]。
pub(crate) fn switch_to_workbench(app: &tauri::AppHandle) -> Result<(), String> {
    let _guard = SPACE_SWITCH_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    // 切换是对齐主题的天然时机（可见性的那一侧切换前先跟上真源；dsh 里改过则此处跟随）
    crate::app_prefs_dsh::adopt_from_dsh(app);
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "主窗口（Agent 空间）不存在，无法同步几何".to_string())?;
    let geometry = snapshot(&main);
    let workspace = match app.get_webview_window(LABEL) {
        Some(window) => window,
        None => create(app)?,
    };
    apply_geometry(&workspace, &geometry);
    // 双侧遮罩时序（eval 失败静默）：源浮现 220ms（观感=点击处眼睛亮起）→ 目标遮罩就位 150ms
    // → show/focus/hide（硬切被完全遮蔽；几何已对齐故遮罩眼睛跨窗位置连续）→ 目标续转 650ms 后淡出。
    veil(app, "main", "show(true)");
    std::thread::sleep(std::time::Duration::from_millis(220));
    veil(app, LABEL, "show()");
    std::thread::sleep(std::time::Duration::from_millis(150));
    ensure_target_visible(&workspace, "工作台窗口")?;
    let _ = workspace.set_focus();
    let _ = main.hide();
    CURRENT_SPACE_WORKBENCH.store(true, std::sync::atomic::Ordering::Relaxed);
    std::thread::sleep(std::time::Duration::from_millis(650));
    veil(app, LABEL, "release()");
    veil(app, "main", "release()");
    println!("[DSH-SHELL] space: Agent 空间 → 工作台（窗口 {LABEL}；几何平移 {}）", geometry.describe());
    println!("[DSH-SHELL] space: 切换后 {}", state_pair(&main, &workspace));
    Ok(())
}

/// 切回 Agent 空间：工作台窗几何回写 → 双侧遮罩 → 显示 + 聚焦主窗 → 隐藏工作台窗。
/// 互斥与「主线程调用方不得直呼」见 [`SPACE_SWITCH_LOCK`] / [`request_space_switch`]。
pub(crate) fn switch_to_space(app: &tauri::AppHandle) -> Result<(), String> {
    let _guard = SPACE_SWITCH_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let workspace = app.get_webview_window(LABEL).ok_or_else(|| "工作台窗口尚未创建".to_string())?;
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "主窗口（Agent 空间）不存在".to_string())?;
    let geometry = snapshot(&workspace);
    apply_geometry(&main, &geometry);
    // 双侧遮罩时序：与 [`switch_to_workbench`] 对称
    veil(app, LABEL, "show(true)");
    std::thread::sleep(std::time::Duration::from_millis(220));
    veil(app, "main", "show()");
    std::thread::sleep(std::time::Duration::from_millis(150));
    ensure_target_visible(&main, "Agent 空间")?;
    let _ = main.set_focus();
    let _ = workspace.hide();
    CURRENT_SPACE_WORKBENCH.store(false, std::sync::atomic::Ordering::Relaxed);
    std::thread::sleep(std::time::Duration::from_millis(650));
    veil(app, "main", "release()");
    veil(app, LABEL, "release()");
    println!("[DSH-SHELL] space: 工作台 → Agent 空间（窗口 main；几何平移 {}）", geometry.describe());
    println!("[DSH-SHELL] space: 切换后 {}", state_pair(&main, &workspace));
    Ok(())
}

/// 主线程安全的空间切换投递（托盘 / CloseRequested 等主线程调用方专用）：
/// 只把请求交给后台线程执行——主线程不得在 [`SPACE_SWITCH_LOCK`] 上等待（死锁纪律见其注释）。
/// 失败只落日志（切换结果由窗口可见状态自证，不做放大性上报）。
pub(crate) fn request_space_switch(app: &tauri::AppHandle, target: &'static str) {
    let app = app.clone();
    std::thread::spawn(move || {
        let result = match target {
            "workbench" => switch_to_workbench(&app),
            "space" => switch_to_space(&app),
            other => Err(format!("worldsea shell: 未知空间目标 {other}（可用：space / workbench）")),
        };
        if let Err(error) = result {
            eprintln!("[DSH-SHELL] space: 后台切换（{target}）失败：{error}");
        }
    });
}

/// 显示目标窗（**仅当确实最小化才 restore**）：对非最小化窗调 `unminimize()`
/// （SW_RESTORE）是无谓扰动——全屏窗上尤其危险；条件分支后最小化语义原样保留。
fn ensure_target_visible(window: &WebviewWindow, label: &str) -> Result<(), String> {
    window.show().map_err(|e| format!("显示{label}失败：{e}"))?;
    if window.is_minimized().unwrap_or(false) {
        let _ = window.unminimize();
    }
    Ok(())
}

/// 切换后状态对（诊断留痕）：正常应恰有一侧 `vis=true`——用户报「双窗/界面拧巴」类现象时，
/// 这行日志直接指认（随每次切换打印，走查与回归自检一并看）。
fn state_pair(main: &WebviewWindow, workspace: &WebviewWindow) -> String {
    let one = |w: &WebviewWindow| {
        format!(
            "vis={} max={} fs={}",
            w.is_visible().unwrap_or(false),
            w.is_maximized().unwrap_or(false),
            w.is_fullscreen().unwrap_or(false)
        )
    };
    format!("main({}) workspace({})", one(main), one(workspace))
}

/// 窗口几何快照。
/// ★ **尺寸取 `inner_size`**（2026-09-24 走查实测）：Tauri 的 `Window::set_size` 落到
/// `tauri-runtime-wry` 的 `SetSize → window.set_inner_size(…)`，写的是 **inner**；若读 `outer_size`
/// 再写，每轮切换都会按边框/阴影厚度**自增放大**（走查现象：逐次向右下角变大）。
/// 位置取 `outer_position`（与 `set_position` 同口径，成对）。
struct WindowGeometry {
    position: Option<PhysicalPosition<i32>>,
    size: Option<PhysicalSize<u32>>,
    maximized: bool,
    /// 快照时窗口处于最小化：此时 position/size 是平台占位值（Windows ≈ -32000 / 标题栏尺寸），
    /// **不可转移**给目标窗。
    minimized: bool,
    /// 快照时窗口处于全屏：几何=屏幕尺寸，**不参与转移**（见 `geometry_transfer_skipped`）。
    fullscreen: bool,
}

fn snapshot(window: &WebviewWindow) -> WindowGeometry {
    WindowGeometry {
        position: window.outer_position().ok(),
        size: window.inner_size().ok(),
        maximized: window.is_maximized().unwrap_or(false),
        minimized: window.is_minimized().unwrap_or(false),
        fullscreen: window.is_fullscreen().unwrap_or(false),
    }
}

/// 几何转移跳过判据（纯函数，单测锁定）：最小化来源（占位几何不可转移）与**全屏窗**——
/// 来源全屏（几何=屏幕尺寸，写过去只是摊成假全屏）或目标全屏（对全屏窗 `set_position`/`set_size`
/// 会把全屏顶掉/成怪态）都不写。全屏态**不随切换转移**：每窗各自保有（切回时仍是全屏）。
fn geometry_transfer_skipped(source_minimized: bool, source_fullscreen: bool, target_fullscreen: bool) -> bool {
    source_minimized || source_fullscreen || target_fullscreen
}

/// 几何平移判据（纯函数：单测锁定「最大化只平移最大化」——2026-09-24 走查修复的核心规则）。
/// 返回 `(是否把最大化平移给目标窗, 是否需先把目标窗还原)`。
fn geometry_plan(source_maximized: bool, target_maximized: bool) -> (bool, bool) {
    if source_maximized {
        // 最大化态几何无意义；对最大化窗写几何会把它顶掉 → 只平移最大化（已最大化则不重复调）
        (true, false)
    } else {
        (false, target_maximized)
    }
}

/// 几何平移：**最大化态只平移最大化**——最大化下几何无意义，对最大化窗 `set_size`/`set_position`
/// 会把它顶掉（走查现象：最大化被取消并放大）；非最大化态先还原目标窗（可能停在最大化）再落几何。
/// ★ **最小化来源不转移几何**：最小化窗的 position/size 是平台占位值（位置 ≈ -32000、尺寸 ≈ 标题栏
/// 大小）——转移会把目标窗变成「不可见窗」且被窗口状态插件持久化（实证：主窗变 159×27 @ -25600,-25600
/// → 应用此后「打开即不可见」）。★ **全屏窗不参与转移**：全屏态是窗口自己的状态，不随切换转移（判据见 `geometry_transfer_skipped`）。
fn apply_geometry(target: &WebviewWindow, geometry: &WindowGeometry) {
    if geometry_transfer_skipped(geometry.minimized, geometry.fullscreen, target.is_fullscreen().unwrap_or(false)) {
        return;
    }
    let target_maximized = target.is_maximized().unwrap_or(false);
    let (transfer_maximize, unmaximize_first) = geometry_plan(geometry.maximized, target_maximized);
    if transfer_maximize {
        if !target_maximized {
            let _ = target.maximize();
        }
        return;
    }
    if unmaximize_first {
        let _ = target.unmaximize();
    }
    if let Some(position) = geometry.position {
        let _ = target.set_position(position);
    }
    if let Some(size) = geometry.size {
        let _ = target.set_size(size);
    }
}

impl WindowGeometry {
    /// 日志/自检口径：**连续切换应打印同一组数值**（走查与回归自检都看这行）。
    fn describe(&self) -> String {
        let position = self.position.map(|p| format!("{},{}", p.x, p.y)).unwrap_or_else(|| "?,?".to_string());
        let size = self.size.map(|s| format!("{}x{}", s.width, s.height)).unwrap_or_else(|| "?x?".to_string());
        format!(
            "{size}@{position}{}{}",
            if self.maximized { " max" } else { "" },
            if self.fullscreen { " 全屏" } else { "" }
        )
    }
}

/// 还原几何是否可用（纯函数，供单测）：位置离屏（平台最小化占位 ≈ -32000）或尺寸小于下限 → 不可用。
fn restored_geometry_is_usable(position: Option<(i32, i32)>, size: Option<(u32, u32)>) -> bool {
    const OFFSCREEN: i32 = -10_000;
    const MIN_W: u32 = 320;
    const MIN_H: u32 = 240;
    match (position, size) {
        (Some((x, y)), Some((w, h))) => x > OFFSCREEN && y > OFFSCREEN && w >= MIN_W && h >= MIN_H,
        // 读不到几何（平台异常）→ 视为可用，不动
        _ => true,
    }
}

/// 启动自检（2026-09-27 走查修复）：窗口状态插件会把「退出时最小化」的窗口按占位几何保存/还原，
/// 下次启动 → 应用「打开即不可见」（走查实证：主窗 159×27 @ -25600,-25600）。主窗就位后调用一次；
/// 不可用时复位为默认尺寸并居中（随后的正常退出会覆盖掉坏状态）。
pub(crate) fn sanitize_restored_geometry(window: &WebviewWindow) {
    let position = window.outer_position().ok().map(|p| (p.x, p.y));
    let size = window.inner_size().ok().map(|s| (s.width, s.height));
    if restored_geometry_is_usable(position, size) {
        return;
    }
    eprintln!("[DSH-SHELL] window: 还原几何不可用（{position:?} / {size:?}）→ 复位 1280×800 并居中");
    let _ = window.set_size(PhysicalSize::new(1280u32, 800u32));
    let _ = window.center();
}

/// 主窗启动可见性裁决（产品域为默认落地后的口径）：
/// 两形态都**预建工作台窗（隐藏）**——页面由磁盘伺服即刻可载，载入即眼睛启动页；
/// 主窗（Agent 空间）保持隐藏，后台吃 dsh 就绪链（spawn/导航与可见性解耦，见 dsh_shell.rs）。
/// - 正常启动：置首绘门 + 8s 兜底强显（产物缺失/加载异常时不无限黑）；首个页面首帧经
///   [`cmd_workspace_first_paint`] 显示——窗口出现即已是启动页，全程无空白帧；
/// - 开机自启（`--autostart`）：不置门不显示（托盘常驻，点托盘/快捷键经 [`show_current_space`] 唤起）。
/// 调用时机 = 几何自检（sanitize）之后。★ 建窗走后台线程（`WebviewWindowBuilder::build()` 需事件泵，
/// 与 `cmd_shell_space_switch` 必须 async 同理；setup 期直呼有自锁前科）。
pub(crate) fn startup_visibility(app: &tauri::AppHandle) {
    let autostart = std::env::args().any(|arg| arg == "--autostart");
    let app = app.clone();
    std::thread::spawn(move || {
        if let Err(e) = create(&app) {
            // 预建失败（理论不可达）→ 退回旧行为：显示主窗（Agent 空间）
            eprintln!("[DSH-SHELL] workspace: 启动预建失败（{e}）→ 退回显示 Agent 空间");
            CURRENT_SPACE_WORKBENCH.store(false, std::sync::atomic::Ordering::Relaxed);
            if let Some(main) = app.get_webview_window("main") {
                if !autostart {
                    let _ = main.show();
                    let _ = main.set_focus();
                }
            }
            return;
        }
        println!("[DSH-SHELL] workspace: 启动预建完成（隐藏）——默认落地工作台，等待页面首帧");
        // 几何对齐：工作台窗沿用主窗还原几何（window-state 插件恢复值，sanitize 已自检），
        // 首显即在正确位置/尺寸；此后每次切换按来源窗几何平移（现状机制）。
        if let (Some(main), Some(workspace)) = (app.get_webview_window("main"), app.get_webview_window(LABEL)) {
            let geometry = snapshot(&main);
            apply_geometry(&workspace, &geometry);
            println!("[DSH-SHELL] workspace: 几何对齐主窗（{}）", geometry.describe());
        }
        if autostart {
            println!("[DSH-SHELL] 启动形态：开机自启 → 托盘常驻（不自动显示窗口）");
            return;
        }
        FIRST_SHOW_PENDING.store(true, std::sync::atomic::Ordering::SeqCst);
        // 兜底：页面迟迟不就绪（产物缺失/加载异常 → 错误页无首绘回调）→ 强制显示，不无限黑
        std::thread::sleep(std::time::Duration::from_secs(8));
        if FIRST_SHOW_PENDING.swap(false, std::sync::atomic::Ordering::SeqCst) {
            if let Some(workspace) = app.get_webview_window(LABEL) {
                println!("[DSH-SHELL] workspace: 首绘门 8s 超时 → 强制显示（页面可能异常）");
                let _ = workspace.show();
                let _ = workspace.set_focus();
            }
        }
    });
}

/// 启动首绘门命令：工作台页 `App.vue` 挂载首帧调用；仅正常启动预建路径持门——
/// 门置位时显示 + 聚焦工作台窗（窗口出现即已是启动页）。其余调用（手动切换后的重挂载等）无门即 no-op。
#[tauri::command]
pub async fn cmd_workspace_first_paint(app: tauri::AppHandle) -> Result<(), String> {
    if FIRST_SHOW_PENDING.swap(false, std::sync::atomic::Ordering::SeqCst) {
        if let Some(workspace) = app.get_webview_window(LABEL) {
            let _ = workspace.show();
            let _ = workspace.set_focus();
            println!("[DSH-SHELL] workspace: 页面首绘就绪 → 显示（启动首绘门）");
        }
    }
    Ok(())
}

/// 显示「当前所在空间」的窗口（托盘左键 / 「显示窗口」菜单 / 单实例二次启动共用）：
/// 工作台窗存在则直接显示聚焦（预建后常驻，理论恒存在）；缺失则投递完整切换兜底懒建。
/// 本函数只做 show/unminimize/focus，**不含锁**——主线程调用方安全。
pub(crate) fn show_current_space(app: &tauri::AppHandle) {
    if CURRENT_SPACE_WORKBENCH.load(std::sync::atomic::Ordering::Relaxed) {
        if let Some(workspace) = app.get_webview_window(LABEL) {
            let _ = workspace.show();
            if workspace.is_minimized().unwrap_or(false) {
                let _ = workspace.unminimize();
            }
            let _ = workspace.set_focus();
            return;
        }
        request_space_switch(app, "workbench");
        return;
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        if main.is_minimized().unwrap_or(false) {
            let _ = main.unminimize();
        }
        let _ = main.set_focus();
    }
}

/// 唤起/隐藏「当前所在空间」的窗口（全局快捷键切换）：可见则隐藏（收进托盘），否则显示。
/// 只做可见性读写，**不含锁**——主线程调用方安全。
pub(crate) fn toggle_current_space(app: &tauri::AppHandle) {
    let label = if CURRENT_SPACE_WORKBENCH.load(std::sync::atomic::Ordering::Relaxed) { LABEL } else { "main" };
    if let Some(window) = app.get_webview_window(label) {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
            return;
        }
    }
    show_current_space(app);
}

/// 建工作台窗（启动预建 + 缺窗兜底；尺寸/位置由调用方随后按来源窗几何对齐）：
/// 无边框 + 隐藏构建（先定位再显示，避免闪位）；挂壳级导航/新窗栅栏。
fn create(app: &tauri::AppHandle) -> Result<WebviewWindow, String> {
    let url = page_url().parse().map_err(|e| format!("工作台 URL 解析失败（{}）：{e}", page_url()))?;
    let workspace = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::External(url))
        .title("WorldSea — 工作台")
        .inner_size(1280.0, 800.0)
        .min_inner_size(900.0, 600.0)
        .resizable(true)
        .decorations(false)
        .shadow(true)
        // 与主窗同口径（tauri.conf.json `dragDropEnabled:false`）：关宿主拖放劫持，HTML5 拖拽才可用
        .disable_drag_drop_handler()
        .visible(false)
        .build()
        .map_err(|e| format!("创建工作台窗口失败：{e}"))?;
    #[cfg(windows)]
    crate::nav_fence::install(&workspace);
    // 工作台窗同款：禁 DWM 过渡 + 不透明底色（切换「整屏闪烁」修复的一半，见 window_transitions.rs）
    crate::window_transitions::install(&workspace);
    // 主题跟随图标：新窗默认带 bundle 图标，按当前深浅对齐（顺带幂等刷新其余窗口/托盘）
    crate::theme_icon::apply(app);
    // 恢复该窗的缩放档位（prefs.json `zoom.workspace`；缺省 100% 不动）
    crate::menu::restore_zoom(&workspace);
    println!("[DSH-SHELL] workspace: 窗口已创建（label={LABEL}，页面={}）", page_url());
    Ok(workspace)
}

#[cfg(test)]
#[path = "workspace_window_tests.rs"]
mod tests;
