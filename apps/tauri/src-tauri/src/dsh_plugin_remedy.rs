// 处置流程编排——确认、通知、重启。底层 API 调用留在 `dsh_plugin_control.rs`。
//
// 拆出来的理由：两个入口（崩溃线索 / 「外部插件」子菜单）共用同一段流程；把「怎么调
// 宿主」与「怎么问用户、怎么告知结果」分开，前者可以单测，后者只在真机上才有意义。

use tauri::Manager;

use crate::dsh_plugin_control::{bundle_of, disable_bundle, external_bundles, remove_bundle, ExternalBundle, Remediation};
///
/// **任何一步失败都不能静默**：用户点了一个「止血」动作却没效果，比没有这个按钮更糟。
/// 失败路径一律经系统通知 + 应用日志双写，并明确说明失败在哪一步。
pub fn remediate_suspect_and_restart(app: &tauri::AppHandle, action: Remediation) {
    let app = app.clone();
    std::thread::spawn(move || {
        // 先解析出「要对谁做什么」，卸载还要据此向用户确认
        let target = match resolve_target(&app) {
            Ok(target) => target,
            Err(error) => {
                eprintln!("[DSH-SHELL] {}未能开始：{error}", action.label());
                notify(&app, &format!("WorldSea：{}失败", action.label()), &error);
                return;
            }
        };
        // 不可逆的动作先确认（当前只有卸载）；可逆的停用不加摩擦。
        if action.needs_confirmation() && !confirm_removal(&app, &target.bundle.name) {
            println!("[DSH-SHELL] 用户取消了卸载「{}」", target.bundle.name);
            notify(&app, "WorldSea：已取消", &format!("未卸载「{}」。", target.bundle.name));
            return;
        }
        finish(&app, action, &target);
    });
}

/// 处置**指定**插件后重启（「外部插件」子菜单入口：用户自己挑了哪个，不经崩溃线索）。
///
/// 与 [`remediate_suspect_and_restart`] 的区别只在「目标从哪来」；确认、执行、通知、
/// 重启全部走同一条路——两个入口若各自实现一遍，迟早在某处行为不一致。
/// @param name - profile 里的包名（子菜单生成时取自 `listBundles`，故必然是当前在册的）。
pub fn remediate_named_and_restart(app: &tauri::AppHandle, name: &str, action: Remediation) {
    let app = app.clone();
    let name = name.to_string();
    std::thread::spawn(move || {
        let bridge = match app.try_state::<crate::dsh_bridge::DshBridge>() {
            Some(bridge) => bridge,
            None => {
                notify(&app, &format!("WorldSea：{}失败", action.label()), "壳桥未装配，无法调用宿主插件管理接口。");
                return;
            }
        };
        // 重新读一次清单再用：菜单生成到点击之间插件可能已被别处改动（如另一窗操作）
        let bundles = match external_bundles(&bridge) {
            Ok(bundles) => bundles,
            Err(error) => {
                let message = format!("读取插件清单失败：{error}");
                eprintln!("[DSH-SHELL] {}未能开始：{message}", action.label());
                notify(&app, &format!("WorldSea：{}失败", action.label()), &message);
                return;
            }
        };
        let Some(bundle) = bundles.into_iter().find(|bundle| bundle.name == name) else {
            let message = format!("「{name}」已不在外部插件清单里（可能刚被停用或卸载）。");
            eprintln!("[DSH-SHELL] {}未能开始：{message}", action.label());
            notify(&app, &format!("WorldSea：{}失败", action.label()), &message);
            return;
        };
        let target = Target { bundle };
        if action.needs_confirmation() && !confirm_removal(&app, &target.bundle.name) {
            println!("[DSH-SHELL] 用户取消了卸载「{}」", target.bundle.name);
            notify(&app, "WorldSea：已取消", &format!("未卸载「{}」。", target.bundle.name));
            return;
        }
        finish(&app, action, &target);
    });
}

/// 目标已定、确认已过：执行 + 通知 + 重启。两个入口共用这一段。
fn finish(app: &tauri::AppHandle, action: Remediation, target: &Target) {
    match run_remediation(app, action, target) {
        Ok(summary) => {
            println!("[DSH-SHELL] {summary}；即将重启");
            notify(app, "WorldSea：已处置外部插件", &format!("{summary}\n正在重启 Agent 内核…"));
            crate::dsh_restart::request_manual_restart(app);
        }
        Err(error) => {
            eprintln!("[DSH-SHELL] {}失败：{error}", action.label());
            notify(app, &format!("WorldSea：{}失败", action.label()), &error);
        }
    }
}

/// 本次处置的目标：崩溃线索命中的外部 bundle。
///
/// 不保留整条 `Suspect`：处置只需要包名，缓存其余字段会让「谁在用哪个字段」变模糊。
struct Target {
    bundle: ExternalBundle,
}

/// 取崩溃线索并在外部 bundle 里定位它。
///
/// 定位不到就直接报错——那通常意味着线索指向官方内置插件（按约定不触碰），
/// 或该插件已被停用/卸载。
fn resolve_target(app: &tauri::AppHandle) -> Result<Target, String> {
    let suspect = app
        .try_state::<crate::dsh_crash_attribution::DshCrashAttribution>()
        .and_then(|state| state.current())
        .ok_or_else(|| "当前没有崩溃线索，无法确定要处置哪个插件。".to_string())?;
    let bridge = app
        .try_state::<crate::dsh_bridge::DshBridge>()
        .ok_or_else(|| "壳桥未装配，无法调用宿主插件管理接口。".to_string())?;
    let bundles = external_bundles(&bridge).map_err(|e| format!("读取插件清单失败：{e}"))?;
    let bundle = bundle_of(&bundles, &suspect.plugin)
        .cloned()
        .ok_or_else(|| {
            format!(
                "在外部插件里找不到「{}」（它可能是官方内置插件，或已经停用/卸载）。\n按约定不触碰官方内置插件。",
                suspect.plugin
            )
        })?;
    Ok(Target { bundle })
}

/// 卸载前的原生二次确认。
/// @returns 用户点了确认才为 true；对话框本身失败时按「不删」处理（宁可不动）。
fn confirm_removal(app: &tauri::AppHandle, name: &str) -> bool {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .message(format!(
            "将从当前 profile 移除插件包：\n\n{name}\n\n这会真的卸载（pnpm remove），之后需要重新安装才能恢复。\n若只想让它不再加载，请改用「停用」。"
        ))
        .title("确认卸载插件？")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom("卸载".to_string(), "取消".to_string()))
        .show(move |confirmed| {
            let _ = tx.send(confirmed);
        });
    match rx.recv_timeout(CONFIRM_TIMEOUT) {
        Ok(confirmed) => confirmed,
        // 超时或通道断开：没拿到明确的「是」，就当用户没同意
        Err(_) => {
            eprintln!("[DSH-SHELL] 卸载确认框未返回结果（超时），按取消处理");
            false
        }
    }
}

/// 等确认框回应的上限。对话框是原生模态，用户不点就一直开着；此处只防它永不回调。
const CONFIRM_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(300);

/// 实际执行处置（目标已解析、卸载已确认），返回人类可读的摘要。
fn run_remediation(app: &tauri::AppHandle, action: Remediation, target: &Target) -> Result<String, String> {
    let bridge = app
        .try_state::<crate::dsh_bridge::DshBridge>()
        .ok_or_else(|| "壳桥未装配，无法调用宿主插件管理接口。".to_string())?;
    let bundle = &target.bundle;
    match action {
        Remediation::Disable => {
            disable_bundle(&bridge, &bundle.name)?;
            Ok(format!("已停用外部插件「{}」（重启后不会再加载）。", bundle.name))
        }
        Remediation::Remove => {
            if !bundle.removable {
                return Err(format!(
                    "「{}」当前不可移除（宿主报告 removable=false，通常是官方保护或仍在使用中）。\n可改用「停用」——同样能让它不再加载。",
                    bundle.name
                ));
            }
            remove_bundle(&bridge, &bundle.name)?;
            Ok(format!("已卸载外部插件「{}」（包已从 profile 移除）。", bundle.name))
        }
    }
}

/// 系统通知（失败不阻断流程，只记日志）。
fn notify(app: &tauri::AppHandle, title: &str, body: &str) {
    use tauri_plugin_notification::NotificationExt;
    if let Err(e) = app.notification().builder().title(title).body(body).show() {
        eprintln!("[DSH-SHELL] 处置流程通知发送失败：{e}");
    }
}
