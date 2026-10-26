// 窗口过渡与底色（2026-10-26 走查修复：空间切换「超出应用的全屏闪烁」）。
//
// 现象与取证：切换瞬间可见整块闪烁，日志恒 `max=false fs=false`（无最大化/全屏路径），
// 两窗几何写操作用 `SWP_NOZORDER`（不含 SWP_SHOWWINDOW，不会强制显示）。
// 剩余唯一来源 = **DWM 对 ShowWindow 的窗口过渡动画**（Win11 上表现为淡入/缩放，
// 在无边框窗口 + 近全屏尺寸下观感逼近「整屏闪一下」）+ WebView2 未出首帧时的透明客户区。
//
// 对策（两层，均为系统官方开关）：
// 1. `DWMWA_TRANSITIONS_FORCEDISABLED` —— 禁用该窗口的 DWM 过渡动画（显示/隐藏/最小化不再淡入）；
// 2. 窗口与 WebView 的背景色 = 主题底色的深/浅纯色 —— 任何「页面还没画」的空档显示底色而非透明，
//    杜绝桌面透出（透明客户区才是「看到窗口外内容」的真正原因）。
//
// 反证开关：`WORLDSEA_NO_WINDOW_TRANSITIONS=1` 跳过第 1 层（保留系统动画，用于对照复现）。

/// 给窗口挂上「无过渡 + 不透明底色」。幂等，重复调用无害。
pub(crate) fn install(window: &tauri::WebviewWindow) {
    install_background(window);
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_TRANSITIONS_FORCEDISABLED};
        if std::env::var_os("WORLDSEA_NO_WINDOW_TRANSITIONS").is_some() {
            println!("[DSH-SHELL] window-transitions: 已按 WORLDSEA_NO_WINDOW_TRANSITIONS 跳过（反证模式）");
            return;
        }
        // 顶层窗口 HWND 取自 Tauri 窗口本身（`hwnd()`），不绕 WebView2 controller
        let raw = match window.hwnd() {
            Ok(raw) => raw,
            Err(error) => {
                eprintln!("[DSH-SHELL] window-transitions: 取窗口句柄失败（{error}）");
                return;
            }
        };
        let hwnd = HWND(raw.0 as _);
        let disabled: i32 = 1; // BOOL：TRUE = 禁用过渡
        let result = unsafe {
            DwmSetWindowAttribute(
                hwnd,
                DWMWA_TRANSITIONS_FORCEDISABLED,
                &disabled as *const i32 as *const core::ffi::c_void,
                std::mem::size_of::<i32>() as u32,
            )
        };
        match result {
            Ok(()) => println!("[DSH-SHELL] window-transitions: DWM 过渡已禁用（窗口动画不再淡入）"),
            // 旧系统不支持该属性：降级为无操作（不影响其余行为）
            Err(error) => eprintln!("[DSH-SHELL] window-transitions: DWM 取消失败（{error}，降级为系统默认）"),
        }
    }
}

/// 窗口 + WebView 背景色按当前主题真源落纯色：页面未绘制时显示底色而非透出桌面。
/// 主题切换时重新调用即可（幂等）。
fn install_background(window: &tauri::WebviewWindow) {
    let color = if crate::app_prefs::dark_now() {
        tauri::window::Color(20, 20, 22, 255) // 深色底 #141416
    } else {
        tauri::window::Color(244, 245, 247, 255) // 浅色底 #f4f5f7
    };
    if let Err(error) = window.set_background_color(Some(color)) {
        eprintln!("[DSH-SHELL] window-transitions: 背景色设置失败（{error}）");
    }
}

#[cfg(test)]
mod tests {
    /// 源码级门禁：两层修复都必须挂在窗口装配处，避免被后续重构悄悄摘掉。
    #[test]
    fn transitions_and_background_are_wired() {
        let source = include_str!("workspace_window.rs");
        assert!(source.contains("window_transitions::install"), "工作台窗缺无过渡/底色挂载");
        let setup = include_str!("app_setup.rs");
        assert!(setup.contains("window_transitions::install"), "主窗缺无过渡/底色挂载");
    }
}
