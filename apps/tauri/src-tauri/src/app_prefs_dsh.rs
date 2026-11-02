// 2026-09-30 arch 拆分：dsh 主题桥（与 dsh 的读写对齐）从 app_prefs.rs 外迁。
// 语义不变：种子（首次反向读 dsh 现值）/ 写回（真源为准）/ 切换空间前对齐（dsh 改动跟随）。

use tauri::Manager;

use crate::app_prefs::{broadcast, load, resolve_dark, save, set_dark, valid};

/// 与 dsh 侧对齐（桥就绪后调用）：**首次**反向读 dsh 现有偏好做种子（不夺用户已有选择）；
/// 已有真源且与 dsh 不同 → 以真源为准写回 dsh。
pub(crate) fn init_after_bridge(app: &tauri::AppHandle) {
    let dsh = read_dsh_theme(app);
    match (load(app), dsh) {
        (None, Some(dsh)) => match save(app, &dsh) {
            Ok(()) => println!("[DSH-SHELL] theme: 真源首次建立，种子取 dsh 现值（{dsh}）"),
            Err(e) => eprintln!("[DSH-SHELL] theme: 种子写入失败：{e}"),
        },
        (None, None) => {
            let _ = save(app, "system");
            println!("[DSH-SHELL] theme: 真源首次建立，取默认 system（dsh 侧读数不可用）");
        }
        (Some(source), Some(dsh)) if source != dsh => {
            println!("[DSH-SHELL] theme: dsh 现值（{dsh}）与真源（{source}）不同 → 按真源写回 dsh");
            if let Err(e) = write_dsh_theme(app, &source) {
                eprintln!("[DSH-SHELL] theme: 写回 dsh 失败（下次切换重试）：{e}");
            }
        }
        (Some(_), None) => println!("[DSH-SHELL] theme: dsh 侧读数不可用（跳过对齐）"),
        _ => {}
    }
}

/// 经壳内管道调 dsh API（与页面同链路；自动带 cookie）。**注意**：dsh 的 HTTP API 是 **RPC 信封**——
/// 路由名即 `method`、`payload.args` 必须恰好一个对象字段（实测：`{"args":{}}` 正确，
/// `{"input":…}` 会被拒 `gateway/arguments-invalid`，缺 `type` 则 400 `body is not JSON`）。
fn dsh_call(
    app: &tauri::AppHandle,
    path: &str,
    method: &str,
    args: &serde_json::Value,
) -> Result<(u16, String), String> {
    let bridge = app
        .try_state::<crate::dsh_bridge::DshBridge>()
        .ok_or_else(|| "壳协议桥未装配".to_string())?;
    let envelope = serde_json::json!({
        "type": "client-request",
        "rpcId": "worldsea-shell",
        "method": method,
        "payload": { "args": args },
    });
    bridge.call_api("POST", path, Some(envelope.to_string().into_bytes()))
}

/// 读 dsh 当前主题偏好：**直接读 dsh 的 index**——其 `boot-theme` 行由 host 按 durable 偏好渲染，
/// 形状固定为 `const preference = "…"`（比解析 `settings/describe` 稳：那里的 `preference` 同名键
/// 在多个命名空间与 schema 里都出现，实测会误读成 `fontSize` 之类的相邻键）。
pub(crate) fn read_dsh_theme(app: &tauri::AppHandle) -> Option<String> {
    let bridge = app.try_state::<crate::dsh_bridge::DshBridge>()?;
    let (status, body) = bridge.call_api("GET", "/", None).ok()?;
    if status != 200 {
        eprintln!("[DSH-SHELL] theme: 读 dsh index 返回 {status}");
        return None;
    }
    let needle = "const preference = \"";
    let at = body.find(needle)? + needle.len();
    let value: String = body[at..].chars().take_while(|c| *c != '"').collect();
    if valid(&value) {
        Some(value)
    } else {
        eprintln!("[DSH-SHELL] theme: dsh index 读数不可解析（{value}）");
        None
    }
}

/// 把真源写给 dsh（`ui-theme` 命名空间；字段名 = `patch`，实测口径）。
pub(crate) fn write_dsh_theme(app: &tauri::AppHandle, value: &str) -> Result<(), String> {
    let args = serde_json::json!({ "ns": "ui-theme", "patch": { "preference": value } });
    let (status, body) = dsh_call(app, "/api/settings/update", "settings/update", &args)?;
    if (200..300).contains(&status) && !body.contains("\"ok\":false") {
        Ok(())
    } else {
        Err(format!("settings/update 返回 {status}：{}", body.chars().take(160).collect::<String>()))
    }
}

/// 切换空间前对齐（dsh 里改过主题 → 切到工作台时跟随）：读数不同则以 dsh 为新真源。
pub(crate) fn adopt_from_dsh(app: &tauri::AppHandle) {
    // 读 dsh 期间若有主题写入在途或新写入，本轮放弃；下一轮切换再对齐
    if crate::app_prefs::theme_write_in_progress() {
        return;
    }
    let epoch = crate::app_prefs::theme_write_epoch();
    let Some(dsh) = read_dsh_theme(app) else { return };
    if crate::app_prefs::theme_write_in_progress() || crate::app_prefs::theme_write_epoch() != epoch {
        return;
    }
    let source = load(app);
    if crate::app_prefs::theme_write_epoch() != epoch {
        return;
    }
    if source.as_deref() == Some(dsh.as_str()) {
        return;
    }
    match save(app, &dsh) {
        Ok(()) => {
            let dark = match app.get_webview_window("main") {
                Some(window) => resolve_dark(&dsh, &window),
                None => dsh == "dark",
            };
            set_dark(dark);
            broadcast(app, dark, &dsh);
            println!("[DSH-SHELL] theme: 跟随 dsh 现值 → {dsh}（真源已更新并广播两窗）");
        }
        Err(e) => eprintln!("[DSH-SHELL] theme: 跟随 dsh 失败：{e}"),
    }
}
