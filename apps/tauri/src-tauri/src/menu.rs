// 原生菜单（壳件最小集：文件 / 编辑 / 视图 / 设置）。
// 菜单由壳持有、页面无关；编辑族用 muda 预定义项（Windows 上合成标准编辑快捷键 → WebView2 处理）；
// 视图族走壳侧窗口/缩放原语（`set_zoom` 无 getter，故壳自持档位，缩放档位按窗口持久化到 prefs.json）；
// 「打开设置」无 URL 路由可用，经壳桥点开侧栏设置入口；桥缺席时**显式降级**：页面右下角红条提示（不静默）。
// 动作目标「焦点窗优先」（产品窗聚焦时 Ctrl+R 刷的是工作台窗；「打开设置」例外恒 main——设置唯一承接方在 dsh 侧）。

use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Manager};

const ID_RELOAD: &str = "worldsea.reload";
/// 宿主崩溃自愈的手动入口：自动重试耗尽后用户从菜单重来。
/// 走原生菜单事件而非页面按钮——错误页是 `data:` URL，拿不到 `__TAURI_INTERNALS__`。
const ID_RESTART_AGENT: &str = "worldsea.restart-agent";
const ID_ZOOM_IN: &str = "worldsea.zoom-in";
const ID_ZOOM_OUT: &str = "worldsea.zoom-out";
const ID_ZOOM_RESET: &str = "worldsea.zoom-reset";
const ID_FULLSCREEN: &str = "worldsea.fullscreen";
const ID_SETTINGS: &str = "worldsea.settings";
/// 一键修复工作区权限（与页面横幅同一命令；点击即执行，结果走系统通知）。
const ID_FIX_WORKSPACE: &str = "worldsea.fix-workspace";
/// 停用疑似问题插件后重启：崩溃线索指名了外部插件时才有意义。
/// 与「重新启动 Agent 内核」并列——那是硬重启（问题插件还在），这是止血（先处置再重启）。
const ID_DISABLE_SUSPECT: &str = "worldsea.disable-suspect";
/// 卸载疑似问题插件后重启：破坏性更强（包被移除），与停用并列交给用户选。
const ID_REMOVE_SUSPECT: &str = "worldsea.remove-suspect";
/// 「外部插件」子菜单容器（内容在每次弹出前按当前清单重建）。
const ID_EXTERNAL_PLUGINS: &str = "worldsea.external-plugins";
/// 动态项 id 前缀：`worldsea.plugin.<停用|卸载>.<包名>`。
///
/// 静态 `match` 分支无法枚举运行时才存在的包名，故这些项在 `handle` 里按前缀解析，
/// 而不是逐个登记常量。
const ID_PLUGIN_ACTION_PREFIX: &str = "worldsea.plugin.";
/// 通知自检——系统通知端到端验证（两窗 ACL 均放行 cmd_notify 但长期零生产者；
/// 菜单给一个随时可触发的验证口，生产者〔Agent 长任务提醒〕后续经事件通道接入）。
const ID_NOTIFY_TEST: &str = "worldsea.notify-test";

const ZOOM_MIN_INDEX: i32 = 5; // 0.5
const ZOOM_MAX_INDEX: i32 = 20; // 2.0
const ZOOM_STEP: f64 = 0.1;

/// 组装菜单并登记为 **popup 资源**。
/// 无边框形态下 Win32 菜单栏**视觉消失**（实测）——不再 `set_menu`；
/// 菜单改由窗口栏「⋯」按钮经 [`cmd_shell_popup_menu`] 在按钮处弹出。
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

/// 窗口栏「⋯」按钮 → 在页面坐标 (x, y) 处弹出菜单（坐标 = 页面 CSS 像素，相对窗口左上角；
/// `Position::Logical` 由 Tauri 按缩放因子换算成物理坐标）。
/// 弹出是 Win32 模态循环（阻塞至菜单关闭）——页面侧 fire-and-forget，不 await。
#[tauri::command]
pub fn cmd_shell_popup_menu(
    app: AppHandle,
    window: tauri::WebviewWindow,
    x: f64,
    y: f64,
) -> Result<(), String> {
    refresh_suspect_items(&app);
    rebuild_external_plugins(&app);
    let menu = &app.state::<PopupMenu>().0;
    window
        .popup_menu_at(menu, tauri::LogicalPosition::new(x, y))
        .map_err(|e| format!("弹出菜单失败：{e}"))
}

/// 按当前真实清单重建「外部插件」子菜单。
///
/// **在弹出前重建而非启动时一次建好**：插件是运行期可变的（用户可能在另一个窗口
/// 装了/卸了插件），缓存一份只会让菜单说旧话。代价是每次弹菜单要调一次宿主 API
/// （本地管道，毫秒级），换来的是「菜单里列的就是此刻真在的」。
///
/// 每个插件一个二级子菜单，内含「停用」「卸载」两项——停用可逆、卸载不可逆，
/// 故后者在点击后才弹确认框（见 `dsh_plugin_control::Remediation`）。
fn rebuild_external_plugins(app: &AppHandle) {
    use tauri::menu::{MenuItemBuilder, SubmenuBuilder};
    let Some(popup) = app.try_state::<PopupMenu>() else { return };
    // 找到「外部插件」容器：它是「视图」子菜单里带该 id 的那一项
    let Some(host) = popup.0.get(ID_EXTERNAL_PLUGINS) else { return };
    let Some(host) = host.as_submenu() else { return };
    // 先清空旧内容（含首次的占位项）
    while let Ok(Some(_)) = host.remove_at(0) {}

    let bundles = crate::dsh_plugin_control::external_bundles_for_menu(app);
    if bundles.is_empty() {
        let note = MenuItemBuilder::with_id("worldsea.external-plugins.empty", "（当前没有外部插件）")
            .enabled(false)
            .build(app);
        if let Ok(note) = note {
            let _ = host.append(&note);
        }
        return;
    }
    for bundle in bundles {
        let action_id = |verb: &str| format!("{ID_PLUGIN_ACTION_PREFIX}{verb}.{}", bundle.name);
        // 已停用的插件标出来：用户能看出「它此刻没在跑」，避免误以为已生效却没效果
        let title = if bundle.enabled {
            bundle.name.clone()
        } else {
            format!("{}（已停用）", bundle.name)
        };
        let built = (|| -> tauri::Result<()> {
            let disable = MenuItemBuilder::with_id(action_id("disable"), "停用后重启")
                .enabled(bundle.enabled)
                .build(app)?;
            let remove = MenuItemBuilder::with_id(action_id("remove"), "卸载后重启")
                .enabled(bundle.removable)
                .build(app)?;
            let entry = SubmenuBuilder::new(app, title).item(&disable).item(&remove).build()?;
            host.append(&entry)
        })();
        if let Err(e) = built {
            eprintln!("[DSH-SHELL] 菜单：外部插件项构建失败（{}）：{e}", bundle.name);
        }
    }
}

/// 弹出前按当前崩溃线索刷新两个处置项（停用 / 卸载）。
///
/// 菜单是启动时一次性构建的，而线索只在崩溃后才出现；不刷新的话这两项要么一直灰着
/// （明明有线索却点不了），要么一直亮着（没线索时点了没反应）。文案同时带出插件名，
/// 用户不用回想错误页写的是谁。
fn refresh_suspect_items(app: &AppHandle) {
    let Some(menu) = app.try_state::<PopupMenu>() else { return };
    let suspect = app
        .try_state::<crate::dsh_crash_attribution::DshCrashAttribution>()
        .and_then(|state| state.current());
    for (id, verb) in [(ID_DISABLE_SUSPECT, "停用"), (ID_REMOVE_SUSPECT, "卸载")] {
        let Some(item) = menu.0.get(id) else { continue };
        let Some(item) = item.as_menuitem() else { continue };
        let (label, enabled) = match &suspect {
            Some(suspect) => (format!("{verb}「{}」后重启（崩溃时它在服务）", suspect.plugin), true),
            None => (format!("{verb}疑似问题插件后重启（当前无崩溃线索）"), false),
        };
        // 刷新失败不阻断菜单弹出：文案旧一点也比重不出菜单好
        let _ = item.set_text(label);
        let _ = item.set_enabled(enabled);
    }
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
    // 菜单项一律不带 `accelerator`：已查实该列在壳内全不生效（菜单是 popup 资源、从未 `set_menu`，
    // 而 Windows 下 Tauri 只在 `set_menu` 过的菜单上装加速键），原先标注的 Ctrl+R / Ctrl+= 等按下去毫无反应、纯属误导。
    // **不要因为「看起来该有快捷键」而加回来**：即便将来把加速键路由修好，`F11` 会与注入脚本的
    // 页面侧监听（`dsh_titlebar.js`）双重触发 → 全屏切两次。真通的键只有两个：`F11`（注入脚本页面侧监听）
    // 与 `Ctrl+Shift+W`（`tauri-plugin-global-shortcut`，OS 层）；编辑族用 muda 预定义项，标准键由 WebView2 自行处理。
    let view = SubmenuBuilder::new(app, "视图")
        .item(&MenuItemBuilder::with_id(ID_RELOAD, "重新加载").build(app)?)
        .item(&MenuItemBuilder::with_id(ID_RESTART_AGENT, "重新启动 Agent 内核").build(app)?)
        // 文案在 mount 时是占位，弹出前由 refresh_suspect_items 按当前线索刷新
        .item(&MenuItemBuilder::with_id(ID_DISABLE_SUSPECT, "停用疑似问题插件后重启").enabled(false).build(app)?)
        .item(&MenuItemBuilder::with_id(ID_REMOVE_SUSPECT, "卸载疑似问题插件后重启").enabled(false).build(app)?)
        .separator()
        // 崩溃线索之外的手动入口：内容是动态的，见 rebuild_external_plugins
        .item(
            &SubmenuBuilder::new(app, "外部插件")
                .id(ID_EXTERNAL_PLUGINS)
                .item(&MenuItemBuilder::with_id("worldsea.external-plugins.placeholder", "（加载中…）").enabled(false).build(app)?)
                .build()?,
        )
        .separator()
        .item(&MenuItemBuilder::with_id(ID_ZOOM_IN, "放大").build(app)?)
        .item(&MenuItemBuilder::with_id(ID_ZOOM_OUT, "缩小").build(app)?)
        .item(&MenuItemBuilder::with_id(ID_ZOOM_RESET, "实际大小").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id(ID_FULLSCREEN, "全屏").build(app)?)
        .build()?;
    let settings = SubmenuBuilder::new(app, "设置")
        .item(&MenuItemBuilder::with_id(ID_SETTINGS, "打开设置").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id(ID_NOTIFY_TEST, "通知自检（测试系统通知）").build(app)?)
        .item(&MenuItemBuilder::with_id(ID_FIX_WORKSPACE, "修复工作区权限（授当前用户完全控制）").build(app)?)
        .build()?;
    MenuBuilder::new(app).items(&[&file, &edit, &view, &settings]).build()
}

fn handle(app: &AppHandle, id: &str) {
    // 「打开设置」恒打 main（设置唯一承接方在 dsh 侧）；其余动作**焦点窗优先**——
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
        ID_RESTART_AGENT => {
            // 与页面按钮同一动作，但走原生事件：错误页（data: URL）无 IPC 可用。
            // 用户显式发起，故不占用自动重试配额。
            eprintln!("[DSH-SHELL] 菜单：重新启动 Agent 内核");
            crate::dsh_restart::request_manual_restart(app);
        }
        ID_DISABLE_SUSPECT => {
            // 止血动作：先停掉疑似插件，再重启。用户显式发起，不占自动重试配额。
            crate::dsh_plugin_remedy::remediate_suspect_and_restart(app, crate::dsh_plugin_control::Remediation::Disable);
        }
        ID_REMOVE_SUSPECT => {
            // 更彻底：停用后连包一起移除。破坏性动作，仅在用户显式点击时执行。
            crate::dsh_plugin_remedy::remediate_suspect_and_restart(app, crate::dsh_plugin_control::Remediation::Remove);
        }
        other if other.starts_with(ID_PLUGIN_ACTION_PREFIX) => {
            // 「外部插件」子菜单的动态项：`worldsea.plugin.<动词>.<包名>`。
            // 包名可能含点（`@scope/name`），故只按**第一个**点切分动词与包名。
            if let Some((action, name)) = parse_plugin_action(other) {
                crate::dsh_plugin_remedy::remediate_named_and_restart(app, name, action);
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
            let next = !window.is_fullscreen().unwrap_or(false);
            // 与 F11 命令共用「进全屏先脱最大化」助手（tao 全屏不脱最大化 → 任务栏条/坏组合）
            if let Err(e) = crate::shell_bridge::set_fullscreen_safely(&window, next) {
                eprintln!("[DSH-SHELL] 菜单：全屏切换失败：{e}");
            } else if let Err(e) = window.eval(&sync_fullscreen_js(next)) {
                // 切换已成功、只是回传失败：窗口确实进了全屏，页面侧靠 resize 查询自愈
                eprintln!("[DSH-SHELL] 菜单：全屏态回传页面失败：{e}");
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
                .body("系统通知链路正常——Agent 长任务完成提醒将经由本通道（生产者后续接入）。")
                .show();
            match result {
                Ok(()) => println!("[DSH-SHELL] 菜单：通知自检已发送（链路验证）"),
                Err(e) => eprintln!("[DSH-SHELL] 菜单：通知自检失败：{e}"),
            }
        }
        ID_FIX_WORKSPACE => {
            let (title, body) = match crate::acl_fix::fix_workspace_permissions(app) {
                Ok(outcome) => (
                    "WorldSea：工作区权限已修复",
                    format!("当前探测：{}。{}", outcome.label, outcome.note),
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

/// 解析「外部插件」动态项的 id：`worldsea.plugin.<动词>.<包名>`。
///
/// 包名可能自带点与斜杠（`@scope/name`、`dsh-plugin-x`），故只按**第一个**点
/// 切出动词，其余整体是包名。
/// @returns 动词对应的处置方式与包名；id 形态不符或动词未知时返回 `None`。
fn parse_plugin_action(id: &str) -> Option<(crate::dsh_plugin_control::Remediation, &str)> {
    use crate::dsh_plugin_control::Remediation;
    let rest = id.strip_prefix(ID_PLUGIN_ACTION_PREFIX)?;
    let (verb, name) = rest.split_once('.')?;
    if name.is_empty() {
        return None;
    }
    let action = match verb {
        "disable" => Remediation::Disable,
        "remove" => Remediation::Remove,
        _ => return None,
    };
    Some((action, name))
}

/// 动作目标窗：**焦点窗优先**，无焦点窗回落 main。
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

/// 全屏态回传页面：菜单是壳侧发起的 `set_fullscreen`，页面无从得知；派发 CustomEvent 交注入的窗口栏脚本
/// （`dsh_titlebar.js`）独占 DOM 效果——置 `html[data-fullscreen]`（dsh 据此内缩浮层）+ 隐藏窗口栏
/// + 解除侧栏键的内联钉住。事件名是壳两侧的共享字面量，`src/__tests__/titlebar.spec.ts` 有跨文件
/// 契约用例守着，改名两侧一起红；页面侧另有 F11 通路（走 `cmd_shell_window_action` 的返回值），
/// 两条路径汇聚到同一函数。无监听者时（`WORLDSEA_NO_TITLEBAR` / `WORLDSEA_FRAMED` 反证开关等）派发无害。
fn sync_fullscreen_js(on: bool) -> String {
    format!("window.dispatchEvent(new CustomEvent('worldsea:fullscreen', {{ detail: {on} }}))")
}

#[path = "menu_tests.rs"]
#[cfg(test)]
mod tests;
