// 工作台窗的几何快照 / 平移 / 启动自检（从 workspace_window.rs 拆出，控制单文件规模）。
// 口径：两窗互斥切换时把来源窗的几何平移到目标窗，观感等同「同窗切换」；
// 以及启动时对窗口状态插件还原出的坏几何做兜底复位。

use tauri::{PhysicalPosition, PhysicalSize, WebviewWindow};

/// 窗口几何快照。
/// ★ **尺寸取 `inner_size`**（2026-09-24 走查实测）：Tauri 的 `Window::set_size` 落到
/// `tauri-runtime-wry` 的 `SetSize → window.set_inner_size(…)`，写的是 **inner**；若读 `outer_size`
/// 再写，每轮切换都会按边框/阴影厚度**自增放大**（走查现象：逐次向右下角变大）。
/// 位置取 `outer_position`（与 `set_position` 同口径，成对）。
pub(crate) struct WindowGeometry {
    position: Option<PhysicalPosition<i32>>,
    size: Option<PhysicalSize<u32>>,
    maximized: bool,
    /// 快照时窗口处于最小化：此时 position/size 是平台占位值（Windows ≈ -32000 / 标题栏尺寸），
    /// **不可转移**给目标窗。
    minimized: bool,
    /// 快照时窗口处于全屏：几何=屏幕尺寸，**不参与转移**（见 `geometry_transfer_skipped`）。
    fullscreen: bool,
}

pub(crate) fn snapshot(window: &WebviewWindow) -> WindowGeometry {
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
/// → 应用此后「打开即不可见」）。★ **全屏窗不参与转移**：全屏态是窗口自己的状态，不随切换转移。
pub(crate) fn apply_geometry(target: &WebviewWindow, geometry: &WindowGeometry) {
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
    pub(crate) fn describe(&self) -> String {
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
pub(crate) fn restored_geometry_is_usable(position: Option<(i32, i32)>, size: Option<(u32, u32)>) -> bool {
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

#[cfg(test)]
#[path = "workspace_geometry_tests.rs"]
mod tests;
