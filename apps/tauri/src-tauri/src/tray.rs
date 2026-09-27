//! 系统托盘（批次97 基础版 + 系统层集成扩展）：
//! - 菜单：显示主窗口 / 新建项目 / 最近项目(子菜单) / 打开设置 / 退出
//! - 动态状态：最近项目列表（前端 `cmd_tray_set_recent_projects` 同步）
//! - 菜单动作 → emit 事件（tray:open-settings / tray:new-project /
//!   tray:open-project {id}），由前端监听分发到对应面板/项目切换
//! （2026-09-27 E8：旧 Agent 面退场，移除「打开 Agent 对话」项与 Agent 生成状态链）

use serde::Deserialize;
use std::sync::Mutex;

use tauri::{
    menu::{IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Runtime,
};

/// 托盘动态状态（由前端命令回写）
#[derive(Debug, Clone, Default)]
pub struct TrayState {
    /// 最近项目（前端 ProjectManager 列表）
    pub projects: Vec<ProjectItem>,
}

/// 托盘「最近项目」条目载荷（前端 JSON 直接反序列化）
#[derive(Debug, Clone, Deserialize)]
pub struct ProjectItem {
    pub id: String,
    pub name: String,
}

/// 重建完整托盘菜单（菜单是原子的：任何状态变化都整份重建）
fn build_menu<R: Runtime>(app: &AppHandle<R>, state: &TrayState) -> tauri::Result<Menu<R>> {
    let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
    let new_project = MenuItem::with_id(app, "new-project", "新建项目", true, None::<&str>)?;

    // 最近项目子菜单：空列表时展示禁用占位项
    let recent_items: Vec<MenuItem<R>> = if state.projects.is_empty() {
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
    let recent_refs: Vec<&dyn IsMenuItem<R>> =
        recent_items.iter().map(|m| m as &dyn IsMenuItem<R>).collect();
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
pub fn build_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<TrayIcon<R>> {
    let menu = build_menu(app, &app.state::<Mutex<TrayState>>().lock().unwrap())?;
    let icon = app
        .default_window_icon()
        .cloned()
        .expect("窗口默认图标缺失");
    TrayIconBuilder::<R>::with_id("main")
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
            // 功能菜单项：先显示主窗口再 emit（窗口在托盘隐藏时也能看到动作结果）
            "new-project" => {
                show_main_window(app);
                let _ = app.emit("tray:new-project", ());
            }
            "open-settings" => {
                show_main_window(app);
                let _ = app.emit("tray:open-settings", ());
            }
            "quit" => app.exit(0),
            id if id.starts_with("recent-project:") => {
                show_main_window(app);
                let project_id = id.trim_start_matches("recent-project:").to_string();
                let _ = app.emit("tray:open-project", project_id);
            }
            _ => {}
        })
        .build(app)
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
pub fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("main") {
        w.show().ok();
        w.unminimize().ok();
        w.set_focus().ok();
    }
}

/// 唤起/隐藏主窗口（全局快捷键切换）
pub fn toggle_main_window<R: Runtime>(app: &AppHandle<R>) {
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
