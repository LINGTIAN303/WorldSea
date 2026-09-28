// C1-c（2026-09-24）：壳桥的 Rust 侧——页面经 Tauri IPC 调用的壳命令。
//
// 为什么可行：我们的页面（`http://worldsea.localhost/`）落在 Tauri 的 `is_local_url` 白名单内
// （自定义协议页），`__TAURI_INTERNALS__.invoke` 直达应用命令；应用自定义命令不属插件 ACL，
// 无需 capability 项（先例：旧前端调 cmd_notify / cmd_secure_store 等）。
//
// JS 侧见 `dsh_shell_bridge.js`（注入在 index 的 `<head>` 后，先于全部模块脚本）。

/// 页面请求在系统浏览器打开外链（壳持有 opener 插件；避免页面把整个应用导航走）。
#[tauri::command]
pub fn cmd_shell_open_external(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://") || url.starts_with("mailto:")) {
        return Err(format!("worldsea shell: 拒绝非 http(s)/mailto 外链 {url}"));
    }
    tauri_plugin_opener::open_url(&url, None::<&str>).map_err(|e| format!("打开外链失败：{e}"))
}

/// 壳桥日志通道：页面侧与壳交互的结果落到壳日志（与 [DSH-SHELL] 同风格，方便排障对齐两侧时间线）。
#[tauri::command]
pub fn cmd_shell_bridge_report(message: String) {
    let text: String = message.chars().take(400).collect();
    println!("[DSH-SHELL] bridge(page): {text}");
}

/// C4-b：一键修复工作区权限（页面横幅按钮 / 「设置 → 修复工作区权限…」菜单共用）。
/// **只在用户显式点击时执行**；语义、后果与探测口径见 `dsh_workspace::fix_workspace_permissions`。
#[tauri::command]
pub fn cmd_fix_workspace_acl(app: tauri::AppHandle) -> Result<String, String> {
    crate::dsh_workspace::fix_workspace_permissions(&app)
}

/// C6（2026-09-24）：窗口栏的窗口动作（最小化 / 最大化⇄还原 / 关闭 / 起拖 / 查询最大化）。
/// G1（2026-09-29）：加「全屏切换」——走应用命令而非 Tauri 窗口插件，ACL 面不增长（守 C3 纪律）。
/// 「关闭」与系统关闭按钮同语义（托盘激活时隐藏到托盘，见 `lib.rs` 的 CloseRequested 处理）。
/// 返回值统一携带最大化**与全屏**两态——窗口栏据此切换按钮图标，并置 `html[data-fullscreen]`
/// 交 dsh 把浮层内缩从 52px 回落到 20px（挂载时查询即恢复，故全屏中重载不退回窗口态 CSS）。
#[derive(serde::Serialize)]
pub struct WindowActionOutcome {
    maximized: bool,
    fullscreen: bool,
}

#[tauri::command]
pub fn cmd_shell_window_action(
    window: tauri::WebviewWindow,
    action: String,
) -> Result<WindowActionOutcome, String> {
    let failure = |e: tauri::Error| e.to_string();
    match action.as_str() {
        "minimize" => window.minimize().map_err(failure)?,
        "toggle-maximize" => {
            if window.is_maximized().map_err(failure)? {
                window.unmaximize().map_err(failure)?;
            } else {
                window.maximize().map_err(failure)?;
            }
        }
        // 绝对全屏（无边框真全屏，区别于最大化）：F11 浏览器惯例，与菜单「视图 → 全屏」同一原语
        "toggle-fullscreen" => {
            let now = window.is_fullscreen().map_err(failure)?;
            window.set_fullscreen(!now).map_err(failure)?;
        }
        "close" => {
            window.close().map_err(failure)?;
            // 关闭后不再查询（托盘激活时窗口隐藏；未激活时进程退出，查询必然失败）
            return Ok(WindowActionOutcome {
                maximized: false,
                fullscreen: false,
            });
        }
        // 阻塞至拖动结束（Win32 模态循环；页面侧不 await）
        "start-drag" => window.start_dragging().map_err(failure)?,
        "is-maximized" => {}
        other => return Err(format!("worldsea shell: 未知窗口动作 {other}")),
    }
    let maximized = window.is_maximized().map_err(failure)?;
    let fullscreen = window.is_fullscreen().map_err(failure)?;
    Ok(WindowActionOutcome {
        maximized,
        fullscreen,
    })
}
