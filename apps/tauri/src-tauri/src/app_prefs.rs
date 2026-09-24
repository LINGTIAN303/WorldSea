// E2-a（2026-09-24）：应用级偏好真源（主题）+ 壳自有面的色板。
//
// 口径（见 docs/details/架构/一致性盘点.md §三）：
// - **真源** = `<app_data>/worldsea/prefs.json` 的 `theme`（`light|dark|system`）——壳是应用级偏好的所有者；
// - **产品页**：`/workspace` index 注入 `__WORLDSEA_THEME__`（真源值，防闪脚本优先用它）与
//   `__WORLDSEA_SET_THEME__`（写回桥）；壳改动后广播 `worldsea:theme-changed` 事件，产品页据此重应用；
// - **dsh 页**：主题由它自己的 boot 脚本按 **host 侧 durable 偏好** 画 → 壳在桥就绪时**反向读一次做种子**
//   （不夺用户已在 dsh 里做的选择），此后真源为准、每次改动写回 `POST /api/settings/update`；
// - **壳自有面**（HTML 错误页 / 不白屏安全网 / 工作区横幅）：按 [`dark_now`] 取亮暗两套值。

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::Manager;

/// 真源值域（与产品侧 `worldsea:theme` 三态一致）。
const THEMES: [&str; 3] = ["light", "dark", "system"];
/// 壳自有面的当前深浅：错误页在无窗口上下文处渲染，故走进程级原子（启动与每次改动时刷新）。
static DARK_NOW: AtomicBool = AtomicBool::new(true);
/// 页面事件名（产品页监听；dsh 页不监听——它的主题由其设置通道驱动）。
pub const THEME_EVENT: &str = "worldsea:theme-changed";

/// 值是否合法。
pub fn valid(value: &str) -> bool {
    THEMES.contains(&value)
}

/// 真源字符串快照（供**无 app 句柄**的渲染点用：index 注入、壳自有页面）。
static PREF_NOW: std::sync::Mutex<String> = std::sync::Mutex::new(String::new());

/// 当前真源值（未经 {@link bootstrap}/{@link save} 时回落 `system`）。
pub fn preference_now() -> String {
    match PREF_NOW.lock() {
        Ok(value) if !value.is_empty() => value.clone(),
        _ => "system".to_string(),
    }
}

fn set_preference_now(value: &str) {
    if let Ok(mut guard) = PREF_NOW.lock() {
        *guard = value.to_string();
    }
}

/// 壳自有面当前是否深色。
pub fn dark_now() -> bool {
    DARK_NOW.load(Ordering::Relaxed)
}

/// 刷新壳自有面的深浅（真源 = `system` 时由调用方给系统解析值）。
pub fn set_dark(dark: bool) {
    DARK_NOW.store(dark, Ordering::Relaxed);
}

/// 壳自有面的亮暗两套色（HTML 错误页用；JS 侧看 `__WORLDSEA_DARK__` 自行取色）。
fn page_colors() -> (&'static str, &'static str, &'static str) {
    if dark_now() {
        ("#111113", "#e4e4e7", "#a1a1aa")
    } else {
        ("#fafaf9", "#1f2328", "#6b7280")
    }
}

/// 壳自有 HTML（错误页 / 失败态）模板：两处调用点（协议层 `failure_response`、导航层 `show_error`）共用，
/// 色板随真源取亮暗两套（此前是**第三套硬编码深色**，浅色主题下很扎眼）。
pub(crate) fn error_page_html(title: &str, detail: &str) -> String {
    let (bg, fg, muted) = page_colors();
    format!(
        "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><title>WorldSea</title></head>\
<body style=\"margin:0;padding:32px;font-family:'Segoe UI','Microsoft YaHei',system-ui;background:{bg};color:{fg}\">\
<h1 style=\"font-size:18px;margin:0 0 12px\">{}</h1>\
<pre style=\"white-space:pre-wrap;word-break:break-word;color:{muted};font-size:13px;line-height:1.6\">{}</pre>\
</body></html>",
        escape_html(title),
        escape_html(detail)
    )
}

/// HTML 转义（壳自有页面的单点实现）。
pub(crate) fn escape_html(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// 由窗口的 OS 主题解析实际深浅（`system` 态用）。
pub fn resolve_dark(pref: &str, window: &tauri::WebviewWindow) -> bool {
    match pref {
        "dark" => true,
        "light" => false,
        _ => window.theme().map(|theme| theme == tauri::Theme::Dark).unwrap_or(true),
    }
}

fn prefs_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| format!("定位应用数据目录失败：{e}"))?
        .join("worldsea")
        .join("prefs.json"))
}

/// 读真源（缺失/损坏/越界 → `None`，由调用方决定种子）。
pub fn load(app: &tauri::AppHandle) -> Option<String> {
    let path = prefs_path(app).ok()?;
    let text = std::fs::read_to_string(path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    let theme = value.get("theme")?.as_str()?.to_string();
    if valid(&theme) {
        Some(theme)
    } else {
        None
    }
}

/// 写真源（目录不存在则创建）。
pub fn save(app: &tauri::AppHandle, value: &str) -> Result<(), String> {
    if !valid(value) {
        return Err(format!("未知主题值 {value}（可用：light / dark / system）"));
    }
    let path = prefs_path(app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("创建配置目录失败：{e}"))?;
    }
    let body = serde_json::json!({ "theme": value });
    std::fs::write(&path, serde_json::to_string_pretty(&body).unwrap_or_default())
        .map_err(|e| format!("写入 {path:?} 失败：{e}"))?;
    set_preference_now(value);
    Ok(())
}

/// 启动期：读真源 + 解析系统深浅 → 刷新 [`dark_now`]（早于任何错误页渲染）。
pub fn bootstrap(app: &tauri::AppHandle) {
    let pref = load(app).unwrap_or_else(|| "system".to_string());
    let dark = match app.get_webview_window("main") {
        Some(window) => resolve_dark(&pref, &window),
        None => pref == "dark",
    };
    set_preference_now(&pref);
    set_dark(dark);
    println!("[DSH-SHELL] theme: 真源={pref}（壳自有面按{}渲染）", if dark { "深色" } else { "浅色" });
}

/// 与 dsh 侧对齐（桥就绪后调用）：**首次**反向读 dsh 现有偏好做种子（不夺用户已有选择）；
/// 已有真源且与 dsh 不同 → 以真源为准写回 dsh。
pub fn init_after_bridge(app: &tauri::AppHandle) {
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
pub fn read_dsh_theme(app: &tauri::AppHandle) -> Option<String> {
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
pub fn write_dsh_theme(app: &tauri::AppHandle, value: &str) -> Result<(), String> {
    let args = serde_json::json!({ "ns": "ui-theme", "patch": { "preference": value } });
    let (status, body) = dsh_call(app, "/api/settings/update", "settings/update", &args)?;
    if (200..300).contains(&status) && !body.contains("\"ok\":false") {
        Ok(())
    } else {
        Err(format!("settings/update 返回 {status}：{}", body.chars().take(160).collect::<String>()))
    }
}

/// 广播给所有窗口（产品页监听后重应用；dsh 页不监听——它由自己的设置通道更新）。
/// 顺带**刷新两页注入的全局快照**（`__WORLDSEA_DARK__`/`__WORLDSEA_THEME__`）：安全网与横幅在
/// 触发时才读它们取色，不刷新会拿到「页面加载时」的旧值。
pub fn broadcast(app: &tauri::AppHandle, applied_dark: bool, preference: &str) {
    use tauri::Emitter;
    let payload = serde_json::json!({ "theme": preference, "dark": applied_dark });
    if let Err(e) = app.emit(THEME_EVENT, payload) {
        eprintln!("[DSH-SHELL] theme: 广播失败：{e}");
    }
    let script = format!(
        "try{{globalThis.__WORLDSEA_DARK__ = {applied_dark};globalThis.__WORLDSEA_THEME__ = \"{preference}\"}}catch(e){{}}"
    );
    for label in ["main", crate::workspace_window::LABEL] {
        if let Some(window) = app.get_webview_window(label) {
            let _ = window.eval(&script);
        }
    }
}

/// 命令：读真源（产品页脚本初始化用不着，留给诊断与设置面板读取）。
#[tauri::command]
pub fn cmd_theme_get(app: tauri::AppHandle) -> Result<String, String> {
    Ok(load(&app).unwrap_or_else(|| "system".to_string()))
}

/// 命令：写真源 + 同步 dsh + 刷新壳自有面 + 广播（产品页设置面板改主题时调用）。
#[tauri::command]
pub fn cmd_theme_set(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    value: String,
) -> Result<String, String> {
    if !valid(&value) {
        return Err(format!("未知主题值 {value}（可用：light / dark / system）"));
    }
    save(&app, &value)?;
    let dark = resolve_dark(&value, &window);
    set_dark(dark);
    println!("[DSH-SHELL] theme: 真源 → {value}（壳自有面{}；同步 dsh）", if dark { "深色" } else { "浅色" });
    if let Err(e) = write_dsh_theme(&app, &value) {
        eprintln!("[DSH-SHELL] theme: 同步 dsh 失败：{e}");
    }
    broadcast(&app, dark, &value);
    Ok(value)
}

/// 切换空间前对齐（dsh 里改过主题 → 切到工作台时跟随）：读数不同则以 dsh 为新真源。
pub fn adopt_from_dsh(app: &tauri::AppHandle) {
    let Some(dsh) = read_dsh_theme(app) else { return };
    if load(app).as_deref() == Some(dsh.as_str()) {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_values_are_the_three_state_model() {
        assert!(valid("light") && valid("dark") && valid("system"));
        assert!(!valid("auto"));
        assert!(!valid("Dark"));
        assert!(!valid(""));
    }

    /// 全局标志与色板同测（同一用例内串行）：避免并行用例互相翻转 `DARK_NOW` 造成偶发红。
    #[test]
    fn dark_flag_drives_the_own_pages_palette() {
        let before = dark_now();
        set_dark(true);
        assert!(dark_now());
        let dark_html = error_page_html("标题 <x>", "详情 & 说明");
        set_dark(false);
        assert!(!dark_now());
        let light_html = error_page_html("标题 <x>", "详情 & 说明");
        set_dark(before);

        assert!(dark_html.contains("#111113") && light_html.contains("#fafaf9"), "亮暗两套底色应不同");
        assert_ne!(dark_html, light_html, "色板必须随真源变化（此前恒深色）");
        for html in [&dark_html, &light_html] {
            assert!(html.contains("&lt;x&gt;"), "标题需转义");
            assert!(html.contains("详情 &amp; 说明"), "详情需转义");
            assert!(html.contains("<meta charset=\"utf-8\">"));
        }
    }
}
