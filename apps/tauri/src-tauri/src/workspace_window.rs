// D1-b（2026-09-24）：工作台窗口——懒创建 + 与 Agent 空间（`main` 窗）互斥切换（位置/尺寸同步）。
//
// 口径（见 docs/plans/2026-09-24-D1-产品域落位批计划.md §一 / §三 D1-b）：
// - 独立窗口（label=`workspace`）承载产品域页面（壳协议 `/workspace/`，D1-a 伺服）——ACL 按窗口隔离（D1-c）；
// - **懒创建**：点「工作台」才建窗；建成后常驻（隐藏不销毁——保住工作台内的编辑现场）；
// - 切换 = 目标窗几何对齐（沿用来源窗位置/尺寸）→ 显示 + 聚焦 → 来源窗隐藏：观感等同同窗切换；
// - 关闭键（工作台窗 ✕）= 隐藏 + 回 Agent 空间（不销毁页面；见 lib.rs 的 CloseRequested 分支）；
// - 安全：新窗同样挂 C3-b 的导航/新窗栅栏（`nav_fence::install`），策略与 dsh 窗一致。

use tauri::{Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

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

/// 切到工作台：懒建（缺窗时创建）→ 几何对齐来源窗 → 显示 + 聚焦 → 隐藏 Agent 空间窗。
pub(crate) fn switch_to_workbench(app: &tauri::AppHandle) -> Result<(), String> {
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "主窗口（Agent 空间）不存在，无法同步几何".to_string())?;
    let position = main.outer_position().ok();
    let size = main.outer_size().ok();
    let workspace = match app.get_webview_window(LABEL) {
        Some(window) => window,
        None => create(app)?,
    };
    if let Some(position) = position {
        let _ = workspace.set_position(position);
    }
    if let Some(size) = size {
        let _ = workspace.set_size(size);
    }
    workspace.show().map_err(|e| format!("显示工作台窗口失败：{e}"))?;
    let _ = workspace.unminimize();
    let _ = workspace.set_focus();
    let _ = main.hide();
    println!("[DSH-SHELL] space: Agent 空间 → 工作台（窗口 {LABEL}；几何与主窗对齐）");
    Ok(())
}

/// 切回 Agent 空间：工作台窗几何回写 → 显示 + 聚焦主窗 → 隐藏工作台窗。
pub(crate) fn switch_to_space(app: &tauri::AppHandle) -> Result<(), String> {
    let workspace = app.get_webview_window(LABEL).ok_or_else(|| "工作台窗口尚未创建".to_string())?;
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "主窗口（Agent 空间）不存在".to_string())?;
    if let (Ok(position), Ok(size)) = (workspace.outer_position(), workspace.outer_size()) {
        let _ = main.set_position(position);
        let _ = main.set_size(size);
    }
    main.show().map_err(|e| format!("显示 Agent 空间失败：{e}"))?;
    let _ = main.unminimize();
    let _ = main.set_focus();
    let _ = workspace.hide();
    println!("[DSH-SHELL] space: 工作台 → Agent 空间（窗口 main；几何与工作台窗对齐）");
    Ok(())
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
    println!("[DSH-SHELL] workspace: 窗口已创建（label={LABEL}，页面={}）", page_url());
    Ok(workspace)
}

#[cfg(test)]
#[path = "workspace_window_tests.rs"]
mod tests;
