// D1-b（2026-09-24）：工作台窗口——懒创建 + 与 Agent 空间（`main` 窗）互斥切换（位置/尺寸同步）。
//
// 口径（见 docs/plans/2026-09-24-D1-产品域落位批计划.md §一 / §三 D1-b）：
// - 独立窗口（label=`workspace`）承载产品域页面（壳协议 `/workspace/`，D1-a 伺服）——ACL 按窗口隔离（D1-c）；
// - **懒创建**：点「工作台」才建窗；建成后常驻（隐藏不销毁——保住工作台内的编辑现场）；
// - 切换 = 目标窗几何对齐（沿用来源窗位置/尺寸）→ 显示 + 聚焦 → 来源窗隐藏：观感等同同窗切换；
// - 关闭键（工作台窗 ✕）= 隐藏 + 回 Agent 空间（不销毁页面；见 lib.rs 的 CloseRequested 分支）；
// - 安全：新窗同样挂 C3-b 的导航/新窗栅栏（`nav_fence::install`），策略与 dsh 窗一致。

use tauri::{Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::dsh_bridge::APP_URL;

/// 工作台窗口标签（ACL capability 的 `windows` 项按此绑定；见 capabilities/workspace.json）。
pub const LABEL: &str = "workspace";

/// 工作台页面 URL（壳协议 `/workspace` 前缀；与 dsh 页同源，故主题等 localStorage 互通）。
pub fn page_url() -> String {
    format!("{APP_URL}workspace/")
}

/// 页面侧入口（旧前端的「Agent 空间⇄工作台」切换控件调用；经注入的 `__WORLDSEA_SPACE_SWITCH__` 桥）：
/// `target` = `space`（Agent 空间）| `workbench`（工作台）。返回切换后的空间名（调用方可留痕）。
///
/// ★ **必须是 async 命令**（D1-b 真机实测踩坑）：同步命令在**主线程**执行，而
/// `WebviewWindowBuilder::build()` 要在事件循环上等 WebView2 控制器的创建回执——事件循环此刻
/// 正卡在本次 IPC 派发里 → 自锁（现象：窗口停在 `about:blank`、主线程此后不再响应任何 IPC、
/// 壳日志无任何后续行）。async 命令跑在异步运行时线程上，`build()` 的「投递 + 等回执」才有泵可跑。
/// （对照：窗口 getter / 动作类命令留同步没问题——C6 的 `cmd_shell_window_action` 就调 `is_maximized`。）
#[tauri::command]
pub async fn cmd_shell_space_switch(app: tauri::AppHandle, target: String) -> Result<String, String> {
    match target.as_str() {
        "workbench" => switch_to_workbench(&app).map(|()| "workbench".to_string()),
        "space" => switch_to_space(&app).map(|()| "space".to_string()),
        other => Err(format!("worldsea shell: 未知空间目标 {other}（可用：space / workbench）")),
    }
}

/// 切到工作台：懒建（缺窗时创建）→ 几何平移来源窗 → 显示 + 聚焦 → 隐藏 Agent 空间窗。
pub(crate) fn switch_to_workbench(app: &tauri::AppHandle) -> Result<(), String> {
    // E2：切换是对齐主题的天然时机（可见性的那一侧切换前先跟上真源；dsh 里改过则此处跟随）
    crate::app_prefs::adopt_from_dsh(app);
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "主窗口（Agent 空间）不存在，无法同步几何".to_string())?;
    let geometry = snapshot(&main);
    let workspace = match app.get_webview_window(LABEL) {
        Some(window) => window,
        None => create(app)?,
    };
    apply_geometry(&workspace, &geometry);
    workspace.show().map_err(|e| format!("显示工作台窗口失败：{e}"))?;
    let _ = workspace.unminimize();
    let _ = workspace.set_focus();
    let _ = main.hide();
    println!("[DSH-SHELL] space: Agent 空间 → 工作台（窗口 {LABEL}；几何平移 {}）", geometry.describe());
    Ok(())
}

/// 切回 Agent 空间：工作台窗几何回写 → 显示 + 聚焦主窗 → 隐藏工作台窗。
pub(crate) fn switch_to_space(app: &tauri::AppHandle) -> Result<(), String> {
    let workspace = app.get_webview_window(LABEL).ok_or_else(|| "工作台窗口尚未创建".to_string())?;
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "主窗口（Agent 空间）不存在".to_string())?;
    let geometry = snapshot(&workspace);
    apply_geometry(&main, &geometry);
    main.show().map_err(|e| format!("显示 Agent 空间失败：{e}"))?;
    let _ = main.unminimize();
    let _ = main.set_focus();
    let _ = workspace.hide();
    println!("[DSH-SHELL] space: 工作台 → Agent 空间（窗口 main；几何平移 {}）", geometry.describe());
    Ok(())
}

/// 窗口几何快照。
///
/// ★ **尺寸取 `inner_size`**（2026-09-24 走查实测）：Tauri 的 `Window::set_size` 落到
/// `tauri-runtime-wry` 的 `WindowMessage::SetSize → window.set_inner_size(…)`，写的是 **inner**；
/// 若读 `outer_size` 再写，每轮切换都会按边框/阴影厚度**自增放大**（走查现象：逐次向右下角变大）。
/// 位置取 `outer_position`（与 `set_position` 同口径，成对）。
struct WindowGeometry {
    position: Option<PhysicalPosition<i32>>,
    size: Option<PhysicalSize<u32>>,
    maximized: bool,
    /// 快照时窗口处于最小化（E6）：此时 position/size 是平台占位值（Windows ≈ -32000 / 标题栏尺寸），
    /// **不可转移**给目标窗。
    minimized: bool,
}

fn snapshot(window: &WebviewWindow) -> WindowGeometry {
    WindowGeometry {
        position: window.outer_position().ok(),
        size: window.inner_size().ok(),
        maximized: window.is_maximized().unwrap_or(false),
        minimized: window.is_minimized().unwrap_or(false),
    }
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

/// 几何平移：**最大化态只平移最大化**——最大化下几何无意义，且对最大化窗 `set_size`/`set_position`
/// 会把它顶掉（走查现象：最大化被取消并放大）。非最大化态先还原目标窗（可能停在最大化）再落几何。
///
/// ★ **最小化来源不转移几何（E6 2026-09-27 走查修复）**：最小化窗的 position/size 是平台占位值
/// （Windows：位置 ≈ -32000、尺寸 ≈ 标题栏大小）——转移过去会把目标窗也变成「不可见窗」
/// （实证：托盘在「工作台已最小化」时切回 Agent 面 → 主窗变成 159×27 @ -25600,-25600，且被
/// 窗口状态插件持久化 → 应用此后「打开即不可见」）。调用方随后仍会 show/unminimize/focus，
/// 目标窗保持自身几何即可。
fn apply_geometry(target: &WebviewWindow, geometry: &WindowGeometry) {
    if geometry.minimized {
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
        format!("{size}@{position}{}", if self.maximized { " max" } else { "" })
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

/// 启动自检（E6 2026-09-27）：窗口状态插件会把「退出时最小化」的窗口按占位几何保存/还原，
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

/// 关闭键语义（lib.rs 的 CloseRequested 分支调用）：回 Agent 空间；主窗缺失等异常态至少把工作台窗藏起。
pub(crate) fn hide_and_back_to_space(app: &tauri::AppHandle) {
    if let Err(e) = switch_to_space(app) {
        eprintln!("[DSH-SHELL] space: 工作台关闭回切失败（{e}）——仅隐藏窗口");
        if let Some(workspace) = app.get_webview_window(LABEL) {
            let _ = workspace.hide();
        }
    }
}

/// 主窗启动可见性裁决（E9 #11，P3 拍板 2026-09-27）：主窗配置 `visible:false`——
/// 正常启动显示 + 聚焦；开机自启（`--autostart`）→ 托盘常驻不弹窗（点托盘/快捷键唤起）。
/// 调用时机 = sanitize（E6 几何自检）之后（show 时几何已就绪）。
pub(crate) fn startup_visibility(window: &WebviewWindow) {
    if std::env::args().any(|arg| arg == "--autostart") {
        println!("[DSH-SHELL] 启动形态：开机自启 → 托盘常驻（不自动显示窗口）");
        return;
    }
    let _ = window.show();
    let _ = window.set_focus();
}

/// 建工作台窗（懒创建；尺寸/位置由调用方随后按来源窗几何对齐）：
/// 无边框 + 隐藏构建（先定位再显示，避免闪位）；挂 C3-b 导航/新窗栅栏。
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
    // E9 #7：恢复该窗的缩放档位（prefs.json `zoom.workspace`；缺省 100% 不动）
    crate::menu::restore_zoom(&workspace);
    println!("[DSH-SHELL] workspace: 窗口已创建（label={LABEL}，页面={}）", page_url());
    Ok(workspace)
}

#[cfg(test)]
#[path = "workspace_window_tests.rs"]
mod tests;
