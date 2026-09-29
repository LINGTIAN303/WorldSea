//! 系统托盘（批次97 基础版 + 系统层集成扩展）：
//! - 菜单：显示主窗口 / 打开工作台 / 最近项目(子菜单) / 打开设置 / 退出
//! - 动态状态：最近项目列表（前端 `cmd_tray_set_recent_projects` 同步；D2-b2 起项目 = dsh 工作区）
//! - 菜单动作 → emit 事件（tray:open-settings / tray:open-project），
//!   由前端监听分发到对应面板/项目切换；「打开工作台」壳内直切不派事件（D2-b2）
//! （2026-09-27 E8：旧 Agent 面退场，移除「打开 Agent 对话」项与 Agent 生成状态链）
//! （2026-09-27 E9 #1/#2/#5：功能菜单项收口——先**切到工作台窗**（懒创建 + 显示 + 聚焦）再派发，
//!   修复「没开过工作台时点托盘无反应」（监听方只在懒建的工作台窗）与「打开设置」错窗；
//!   页面未就绪（窗刚懒建、React 还在加载）时动作入积压队列，`cmd_tray_page_ready` 时补投，
//!   事件不再静默丢弃）
//! （2026-09-28 D2-b2：「新建项目」→ P1「打开项目文件夹」→ **「打开工作台」**——项目 = dsh 工作区
//!   同源模型落地后，新建/选择项目归 dsh 界面与工作台项目下拉，托盘只负责唤出窗口）

use serde::Deserialize;
use std::sync::Mutex;

// 口径与 workspace_window/menu 一致：**Wry 固定（非泛型）**——托盘动作要调 workspace_window 的
// 懒创建链（非泛型签名），泛型 Runtime 参数在此无实际多态价值（build_tray 仅被 Wry 调用）。
use tauri::{
    menu::{IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Wry,
};

/// 托盘动作积压条目（工作台页面未就绪时 emit 会丢——页面 setup 经 [`cmd_tray_page_ready`] 触发补投）。
#[derive(Debug, Clone, serde::Serialize)]
pub struct PendingAction {
    pub event: String,
    pub payload: Option<String>,
}

/// 托盘动态状态（由前端命令回写）
#[derive(Debug, Clone, Default)]
pub struct TrayState {
    /// 最近项目（前端 ProjectManager 列表）
    pub projects: Vec<ProjectItem>,
    /// 页面就绪前积压的工作台动作（上限 32，防御洪泛）
    pub pending: Vec<PendingAction>,
    /// 工作台页面已就绪（`useSystemBridge.setup` → `cmd_tray_page_ready`；监听器常驻，窗隐显不重置）
    pub page_ready: bool,
}

/// 托盘「最近项目」条目载荷（前端 JSON 直接反序列化）
#[derive(Debug, Clone, Deserialize)]
pub struct ProjectItem {
    pub id: String,
    pub name: String,
}

/// 重建完整托盘菜单（菜单是原子的：任何状态变化都整份重建）
fn build_menu(app: &AppHandle, state: &TrayState) -> tauri::Result<Menu<Wry>> {
    let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
    // D2-b2（2026-09-28）：项目 = dsh 工作区（同源）——「打开项目文件夹选择器」随产品域建项目入口退役；
    // 托盘该项演进为「打开工作台」（壳内直切工作台窗，不派事件——项目选择在 dsh 界面/工作台下拉开）
    let new_project = MenuItem::with_id(app, "open-workbench", "打开工作台", true, None::<&str>)?;

    // 最近项目子菜单：空列表时展示禁用占位项
    let recent_items: Vec<MenuItem<Wry>> = if state.projects.is_empty() {
        vec![MenuItem::with_id(
            app,
            "recent-none",
            "（暂无项目）",
            false,
            None::<&str>,
        )?]
    } else {
        state
            .projects
            .iter()
            .map(|p| {
                MenuItem::with_id(
                    app,
                    format!("recent-project:{}", p.id),
                    &p.name,
                    true,
                    None::<&str>,
                )
            })
            .collect::<tauri::Result<Vec<_>>>()?
    };
    let recent_refs: Vec<&dyn IsMenuItem<Wry>> =
        recent_items.iter().map(|m| m as &dyn IsMenuItem<Wry>).collect();
    let recent = Submenu::with_items(app, "最近项目", true, &recent_refs)?;

    let open_settings = MenuItem::with_id(app, "open-settings", "打开设置", true, None::<&str>)?;

    let quit = MenuItem::with_id(app, "quit", "退出 WorldSea", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;

    Menu::with_items(
        app,
        &[
            &show,
            &new_project,
            &recent,
            &sep1,
            &open_settings,
            &sep2,
            &quit,
        ],
    )
}

/// 构建托盘图标与初始菜单（失败不阻塞启动，由调用方降级）
pub fn build_tray(app: &AppHandle) -> tauri::Result<TrayIcon> {
    let menu = build_menu(app, &app.state::<Mutex<TrayState>>().lock().unwrap())?;
    let icon = app
        .default_window_icon()
        .cloned()
        .expect("窗口默认图标缺失");
    TrayIconBuilder::with_id("main")
        .icon(icon)
        .tooltip("WorldSea — 世界观构建工具")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            // 左键单击托盘图标 → 显示主窗口（批次99：单击/双击均有反应，避免"托盘失效"错觉）
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            // E9：功能菜单项的监听方在工作台窗 → 先切到工作台（懒创建 + 显示 + 聚焦）再派发
            // D2-b2：「打开工作台」= 壳内直切（不派事件——项目选择在 dsh 界面/工作台下拉开）
            // G1 收尾批修：主线程只投递（空间切换经互斥串行、后台线程执行——主线程等锁会与窗口操作互锁）
            "open-workbench" => crate::workspace_window::request_space_switch(app, "workbench"),
            "open-settings" => dispatch_workbench(app, "tray:open-settings", None),
            "quit" => app.exit(0),
            id if id.starts_with("recent-project:") => {
                let project_id = id.trim_start_matches("recent-project:").to_string();
                dispatch_workbench(app, "tray:open-project", Some(project_id));
            }
            _ => {}
        })
        .build(app)
}

/// 托盘动作 → 工作台窗（E9 #1/#2 收口）：
/// ① 先切到工作台窗（懒创建 + 显示 + 聚焦——用户点了托盘就要看到结果，且监听方在此窗）；
/// ② 页面已就绪 → 直接 emit；未就绪（窗刚懒建，页面还在加载）→ 入积压队列，
///    页面 setup 调 [`cmd_tray_page_ready`] 时补投。
/// 切窗失败（主窗不存在等）只记日志——托盘动作不做放大性重试。
/// G1 收尾批修：整段移到**后台线程**——本函数跑在主线程（托盘菜单回调），不得阻塞等空间切换互斥
/// （死锁纪律见 `workspace_window::SPACE_SWITCH_LOCK` 注释）；切换完成后在同一线程里派发/入队。
fn dispatch_workbench(app: &AppHandle, event: &str, payload: Option<String>) {
    let app = app.clone();
    let event = event.to_string();
    std::thread::spawn(move || {
        if let Err(e) = crate::workspace_window::switch_to_workbench(&app) {
            eprintln!("[WORLDSEA-TRAY] 切到工作台失败（{event}）：{e}");
            return;
        }
        let tray_state = app.state::<Mutex<TrayState>>();
        let mut state = tray_state.lock().unwrap();
        if state.page_ready {
            drop(state);
            if let Err(e) = app.emit(&event, payload) {
                eprintln!("[WORLDSEA-TRAY] 事件派发失败（{event}）：{e}");
            }
            println!("[WORLDSEA-TRAY] 动作派发：{event}（页面就绪，直发）");
            return;
        }
        if state.pending.len() < 32 {
            println!("[WORLDSEA-TRAY] 动作积压：{event}（页面未就绪，待补投）");
            state.pending.push(PendingAction { event: event.clone(), payload });
        } else {
            eprintln!("[WORLDSEA-TRAY] 动作积压超限，丢弃（{event}）");
        }
    });
}

/// 工作台页面就绪信号（`useSystemBridge.setup` 调用；其时三条 `listen` 已挂好）：
/// 置就绪态 + 补投积压动作。就绪态持久（监听器常驻，窗口隐/显不重置）。
#[tauri::command]
pub fn cmd_tray_page_ready(app: AppHandle) {
    let backlog: Vec<PendingAction>;
    {
        let tray_state = app.state::<Mutex<TrayState>>();
        let mut state = tray_state.lock().unwrap();
        state.page_ready = true;
        backlog = std::mem::take(&mut state.pending);
    }
    if backlog.is_empty() {
        return;
    }
    println!("[WORLDSEA-TRAY] 页面就绪，补投积压动作 {} 条", backlog.len());
    for action in backlog {
        let payload = action.payload;
        if let Err(e) = app.emit(&action.event, payload) {
            eprintln!("[WORLDSEA-TRAY] 补投失败（{}）：{e}", action.event);
        }
    }
}

/// 前端同步：最近项目列表（项目初始化/切换/删除后调用）
#[tauri::command]
pub fn cmd_tray_set_recent_projects(app: AppHandle, projects: Vec<ProjectItem>) {
    {
        let tray_state = app.state::<Mutex<TrayState>>();
        let mut state = tray_state.lock().unwrap();
        state.projects = projects;
    }
    rebuild_tray_menu(&app);
}

/// 用当前状态重建托盘菜单（托盘未激活时静默忽略）
fn rebuild_tray_menu(app: &AppHandle) {
    let Some(tray) = app.tray_by_id("main") else {
        return;
    };
    let tray_state = app.state::<Mutex<TrayState>>();
    let state = tray_state.lock().unwrap().clone();
    match build_menu(app, &state) {
        Ok(menu) => {
            if let Err(e) = tray.set_menu(Some(menu)) {
                tracing::warn!("托盘菜单重建失败: {e}");
            }
        }
        Err(e) => tracing::warn!("托盘菜单重建失败: {e}"),
    }
}

/// 显示并聚焦主窗口（托盘/快捷键/单实例共用）
pub fn show_main_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        w.show().ok();
        w.unminimize().ok();
        w.set_focus().ok();
    }
}

/// 唤起/隐藏主窗口（全局快捷键切换）
pub fn toggle_main_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            w.show().ok();
            w.unminimize().ok();
            w.set_focus().ok();
        }
    }
}
