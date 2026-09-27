// C1-c（2026-09-24）：原生菜单（壳件最小集：文件 / 编辑 / 视图 / 设置）。
//
// 口径（C1 批计划 §五 C1-c + 裁定 ③「壳件最小集：菜单 + 通知」）：
// - 菜单由壳持有，页面无关；编辑族用 muda 预定义项（Windows 上合成标准编辑快捷键 → WebView2 处理）；
// - 视图族走壳侧窗口/缩放原语（`set_zoom` 无 getter，故壳自持档位）；
// - 「打开设置」没有 URL 路由可用（dsh 客户端无路由），经壳桥在页面里点开侧栏设置入口；
//   桥缺席时**显式降级**：页面右下角出示红条提示（不静默），见 SETTINGS_FALLBACK_JS。
// E9（2026-09-27）：#6 动作目标改**焦点窗优先**（产品窗聚焦时 Ctrl+R 刷的是工作台窗，不再恒打 main；
//   「打开设置」例外——设置唯一承接方在 dsh 侧，恒 main）· #7 缩放档位按窗口持久化到 prefs.json
//   （app_prefs::load_zoom/save_zoom；主窗启动与工作台窗创建时经 restore_zoom 恢复）·
//   #9 通知自检项（系统通知端到端验证；生产者语义留 D2）。

use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Manager};

const ID_RELOAD: &str = "worldsea.reload";
const ID_ZOOM_IN: &str = "worldsea.zoom-in";
const ID_ZOOM_OUT: &str = "worldsea.zoom-out";
const ID_ZOOM_RESET: &str = "worldsea.zoom-reset";
const ID_FULLSCREEN: &str = "worldsea.fullscreen";
const ID_SETTINGS: &str = "worldsea.settings";
/// C4-b：一键修复工作区权限（与页面横幅同一命令；点击即执行，结果走系统通知）。
const ID_FIX_WORKSPACE: &str = "worldsea.fix-workspace";
/// E9 #9：通知自检——系统通知端到端验证（两窗 ACL 均放行 cmd_notify 但长期零生产者；
/// 菜单给一个随时可触发的验证口，生产者语义〔Agent 长任务提醒〕留 D2 事件通道）。
const ID_NOTIFY_TEST: &str = "worldsea.notify-test";

const ZOOM_MIN_INDEX: i32 = 5; // 0.5
const ZOOM_MAX_INDEX: i32 = 20; // 2.0
const ZOOM_STEP: f64 = 0.1;

/// 组装菜单并登记为 **popup 资源**。
/// C6（2026-09-24）：无边框形态下 Win32 菜单栏**视觉消失**（实测，见 C6 批计划 §〇）——
/// 不再 `set_menu`；菜单改由窗口栏「⋯」按钮经 [`cmd_shell_popup_menu`] 在按钮处弹出。
pub fn install(app: &AppHandle) {
    match build(app) {
        Ok(menu) => {
            app.manage(PopupMenu(menu));
            app.on_menu_event(|app, event| handle(app, event.id().as_ref()));
            println!("[DSH-SHELL] 菜单已就绪（窗口栏 ⋯ 按钮弹出：文件/编辑/视图/设置）");
        }
        Err(e) => eprintln!("[DSH-SHELL] 菜单构建失败：{e}"),
    }
}

/// popup 菜单载体（`Menu` 内部为共享句柄，存进状态供命令取用；事件仍走 app 级 `on_menu_event`）。
pub struct PopupMenu(pub tauri::menu::Menu<tauri::Wry>);

/// C6：窗口栏「⋯」按钮 → 在页面坐标 (x, y) 处弹出菜单（坐标 = 页面 CSS 像素，相对窗口左上角；
/// `Position::Logical` 由 Tauri 按缩放因子换算成物理坐标）。
/// 弹出是 Win32 模态循环（阻塞至菜单关闭）——页面侧 fire-and-forget，不 await。
#[tauri::command]
pub fn cmd_shell_popup_menu(
    app: AppHandle,
    window: tauri::WebviewWindow,
    x: f64,
    y: f64,
) -> Result<(), String> {
    let menu = &app.state::<PopupMenu>().0;
    window
        .popup_menu_at(menu, tauri::LogicalPosition::new(x, y))
        .map_err(|e| format!("弹出菜单失败：{e}"))
}

fn build(app: &AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    let file = SubmenuBuilder::new(app, "文件")
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, None)?)
        .build()?;
    let edit = SubmenuBuilder::new(app, "编辑")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .build()?;
    let view = SubmenuBuilder::new(app, "视图")
        .item(&MenuItemBuilder::with_id(ID_RELOAD, "重新加载").accelerator("CmdOrCtrl+R").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id(ID_ZOOM_IN, "放大").accelerator("CmdOrCtrl+=").build(app)?)
        .item(&MenuItemBuilder::with_id(ID_ZOOM_OUT, "缩小").accelerator("CmdOrCtrl+-").build(app)?)
        .item(&MenuItemBuilder::with_id(ID_ZOOM_RESET, "实际大小").accelerator("CmdOrCtrl+0").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id(ID_FULLSCREEN, "全屏").accelerator("F11").build(app)?)
        .build()?;
    let settings = SubmenuBuilder::new(app, "设置")
        .item(&MenuItemBuilder::with_id(ID_SETTINGS, "打开设置").accelerator("CmdOrCtrl+,").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id(ID_NOTIFY_TEST, "通知自检（测试系统通知）").build(app)?)
        .item(&MenuItemBuilder::with_id(ID_FIX_WORKSPACE, "修复工作区权限（授当前用户完全控制）").build(app)?)
        .build()?;
    MenuBuilder::new(app).items(&[&file, &edit, &view, &settings]).build()
}

fn handle(app: &AppHandle, id: &str) {
    // E9 #6：「打开设置」恒打 main（设置唯一承接方在 dsh 侧）；其余动作**焦点窗优先**——
    // 产品窗聚焦时 Ctrl+R/Ctrl+= 作用于工作台窗，不再恒打 dsh 窗。无焦点窗回落 main。
    let window = if id == ID_SETTINGS {
        app.get_webview_window("main")
    } else {
        target_window(app)
    };
    let Some(window) = window else { return };
    match id {
        ID_RELOAD => {
            if let Err(e) = window.reload() {
                eprintln!("[DSH-SHELL] 菜单：重新加载失败：{e}");
            }
        }
        ID_ZOOM_IN | ID_ZOOM_OUT | ID_ZOOM_RESET => {
            let label = window.label().to_string();
            let current = crate::app_prefs::load_zoom(app, &label).unwrap_or(10);
            let next = match id {
                ID_ZOOM_IN => (current + 1).min(ZOOM_MAX_INDEX),
                ID_ZOOM_OUT => (current - 1).max(ZOOM_MIN_INDEX),
                _ => 10,
            };
            if let Err(e) = window.set_zoom(f64::from(next) * ZOOM_STEP) {
                eprintln!("[DSH-SHELL] 菜单：缩放失败：{e}");
            } else if let Err(e) = crate::app_prefs::save_zoom(app, &label, next) {
                eprintln!("[DSH-SHELL] 菜单：缩放档位保存失败（{label}={next}）：{e}");
            } else {
                println!("[DSH-SHELL] 菜单：缩放 {label} → {}%", next * 10);
            }
        }
        ID_FULLSCREEN => {
            let now = window.is_fullscreen().unwrap_or(false);
            if let Err(e) = window.set_fullscreen(!now) {
                eprintln!("[DSH-SHELL] 菜单：全屏切换失败：{e}");
            }
        }
        ID_SETTINGS => {
            if let Err(e) = window.eval(OPEN_SETTINGS_JS) {
                eprintln!("[DSH-SHELL] 菜单：打开设置失败：{e}");
            }
        }
        ID_NOTIFY_TEST => {
            use tauri_plugin_notification::NotificationExt;
            let result = app
                .notification()
                .builder()
                .title("WorldSea 通知自检")
                .body("系统通知链路正常——Agent 长任务完成提醒将经由本通道（生产者接续见 D2）。")
                .show();
            match result {
                Ok(()) => println!("[DSH-SHELL] 菜单：通知自检已发送（E9 #9 链路验证）"),
                Err(e) => eprintln!("[DSH-SHELL] 菜单：通知自检失败：{e}"),
            }
        }
        ID_FIX_WORKSPACE => {
            let (title, body) = match crate::dsh_workspace::fix_workspace_permissions(app) {
                Ok(label) => (
                    "WorldSea：工作区权限已修复",
                    format!("当前探测：{label}。若命令仍报沙箱初始化失败，请重启应用后重试。"),
                ),
                Err(error) => ("WorldSea：工作区权限修复失败", error),
            };
            println!("[DSH-SHELL] 菜单：{title} —— {body}");
            use tauri_plugin_notification::NotificationExt;
            if let Err(e) = app.notification().builder().title(title).body(body).show() {
                eprintln!("[DSH-SHELL] 菜单：通知发送失败：{e}");
            }
        }
        _ => {}
    }
}

/// 动作目标窗（E9 #6）：**焦点窗优先**，无焦点窗回落 main。
fn target_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    app.webview_windows()
        .into_iter()
        .find(|(_, window)| window.is_focused().unwrap_or(false))
        .map(|(_, window)| window)
        .or_else(|| app.get_webview_window("main"))
}

/// 恢复窗口的缩放档位（prefs.json `zoom.<label>`；缺省/100% 不动）。
/// 主窗启动（lib.rs setup）与工作台窗创建（workspace_window::create）各调一次。
pub fn restore_zoom(window: &tauri::WebviewWindow) {
    let Some(index) = crate::app_prefs::load_zoom(&window.app_handle(), window.label()) else { return };
    if index == 10 {
        return;
    }
    if let Err(e) = window.set_zoom(f64::from(index) * ZOOM_STEP) {
        eprintln!("[DSH-SHELL] 菜单：缩放档位恢复失败（{}={index}）：{e}", window.label());
    } else {
        println!("[DSH-SHELL] 菜单：缩放档位恢复 {} → {}%（窗口 {}）", index, index * 10, window.label());
    }
}

/// 打开设置：走壳桥点开侧栏设置控件；桥缺席时在页面右下角出示可见提示（显式降级，不静默）。
const OPEN_SETTINGS_JS: &str = r#"(function () {
  if (globalThis.__WORLDSEA_SHELL__ && typeof globalThis.__WORLDSEA_SHELL__.openSettings === 'function') {
    globalThis.__WORLDSEA_SHELL__.openSettings();
    return;
  }
  var id = 'worldsea-shell-bridge-missing';
  if (document.getElementById(id)) return;
  var box = document.createElement('div');
  box.id = id;
  box.setAttribute('style', 'position:fixed;bottom:10px;right:10px;z-index:2147483647;background:#7f1d1d;color:#fef2f2;padding:8px 12px;border-radius:8px;font:12px/1.5 system-ui');
  box.textContent = '壳桥未注入：设置入口不可用（设 WORLDSEA_SHELL_DIAG=1 可看页面 console 与壳日志）';
  (document.body || document.documentElement).appendChild(box);
})()"#;
