// 外部插件的停用——崩溃归因指名的插件，经宿主的 pluginManager Remote 停掉其整个家族。
//
// 为什么要停「家族」：实测（2026-11-04）`dsh-plugin-wallpaper-engine` 一个 npm 包装出
// **8 个 entry**（主 entry + about-notice / mascot-avatar / media-bridge / pet-link / fx /
// parallax / fonts）。只停主 entry 时，其余 7 个仍是 `enabled: true`，仅 `fiberPhase` 变
// `pending`（等父激活）。崩溃若是某个子入口引起的，停主 entry 并不能止住它。
//
// 为什么只碰外部插件：用户明确要求「不染指官方内置插件」。判据是 `moduleName` 前缀——
// 官方一律 `@deepseek-ai/`，外部插件是裸包名或第三方 scope。**注意不要用
// `readOnlyReason` 判**：实测它只表示「不能经 profile patch 管理」，几乎所有官方插件
// （llm / session / storage …）都没有它，拿它当内置判据会把内置插件当成外部。
//
// 通信口径：与页面同链路（`dsh_bridge::call_api`，自动带 cookie），走 typert Remote 的
// HTTP 信封 `{type:'client-request', rpcId, method, payload:{args}}`。

use serde_json::{json, Value};
use tauri::Manager;

use crate::dsh_bridge::DshBridge;

/// 官方插件的模块名前缀；带此前缀的一律视为内置，永不提供停用。
const OFFICIAL_SCOPE: &str = "@deepseek-ai/";

/// 一个可停用的外部插件家族。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExternalFamily {
    /// 家族名（去掉 `-` 后缀的包名基座，如 `dsh-plugin-wallpaper-engine`）。
    pub name: String,
    /// 家族内所有 entry 的 id；停用时逐个停。
    pub entry_ids: Vec<String>,
    /// 家族内所有包名（用于展示与日志）。
    pub module_names: Vec<String>,
}

/// Remote 调用的固定信封。`args` 是宿主要求的唯一载荷字段（缺它会报
/// `Remote payload must contain exactly one plain-object args field`）。
fn envelope(rpc_id: &str, method: &str, args: Value) -> Vec<u8> {
    serde_json::to_vec(&json!({
        "type": "client-request",
        "rpcId": rpc_id,
        "method": method,
        "payload": { "args": args },
    }))
    .unwrap_or_default()
}

/// 调一次 `pluginManager` 的 Remote 方法。
/// @returns 成功时的 `result.value`；HTTP 非 2xx、信封 `ok:false`、或桥不可用时返回错误说明。
fn call_plugin_manager(bridge: &DshBridge, rpc_id: &str, method: &str, args: Value) -> Result<Value, String> {
    let path = format!("/api/pluginManager/{method}");
    let (status, text) = bridge.call_api("POST", &path, Some(envelope(rpc_id, &format!("pluginManager/{method}"), args)))?;
    if !(200..300).contains(&status) {
        return Err(format!("pluginManager/{method} 返回 HTTP {status}"));
    }
    let parsed: Value = serde_json::from_str(&text).map_err(|e| format!("pluginManager/{method} 响应不是 JSON：{e}"))?;
    let result = parsed.get("result").ok_or_else(|| format!("pluginManager/{method} 响应缺 result"))?;
    if result.get("ok").and_then(Value::as_bool) != Some(true) {
        let code = result.pointer("/error/code").and_then(Value::as_str).unwrap_or("unknown");
        let message = result.pointer("/error/message").and_then(Value::as_str).unwrap_or("");
        return Err(format!("pluginManager/{method} 失败：{code} {message}"));
    }
    Ok(result.get("value").cloned().unwrap_or(Value::Null))
}

/// 读当前在册插件（只读）。
pub fn list_plugins(bridge: &DshBridge) -> Result<Vec<Value>, String> {
    let value = call_plugin_manager(bridge, "ws-list", "listPlugins", json!({}))?;
    value.as_array().cloned().ok_or_else(|| "listPlugins 未返回数组".to_string())
}

/// 判定一个 entry 是否属于官方内置。
fn is_official(module_name: &str) -> bool {
    module_name.starts_with(OFFICIAL_SCOPE) || module_name.starts_with("cordis:")
}

/// 家族基座：把包名末尾的 `-<片段>` 逐级去掉，取「基座本身也在册」的最长形态。
///
/// 例：`dsh-plugin-wallpaper-engine-fx` 的家族是 `dsh-plugin-wallpaper-engine`
/// （因为清单里同时存在 `dsh-plugin-wallpaper-engine` 本体）。
///
/// 判据只有「基座在册」一条：`known` 只收完整包名，故 `dsh-plugin-worldsea-console`
/// 剥到 `dsh-plugin-worldsea` 时已不在册，不会与 `dsh-whale-widget` 归并成一族。
/// @returns 家族基座；该包独立成族时返回自身。
fn family_root(module_name: &str, known: &[&str]) -> String {
    let mut best = module_name.to_string();
    let mut cursor = module_name;
    while let Some((head, _)) = cursor.rsplit_once('-') {
        if !known.iter().any(|name| *name == head) {
            break;
        }
        best = head.to_string();
        cursor = head;
    }
    best
}

/// 从 `listPlugins` 结果里挑出**外部插件家族**（官方与框架自身一律排除）。
///
/// 已停用（`enabled:false`）的 entry 不计入——它们本来就不跑，没有停用价值。
pub fn external_families(plugins: &[Value]) -> Vec<ExternalFamily> {
    let candidates: Vec<(&str, &str)> = plugins
        .iter()
        .filter_map(|row| {
            let id = row.get("entryId")?.as_str()?;
            let module = row.get("moduleName")?.as_str()?;
            let enabled = row.get("enabled")?.as_bool()?;
            if !enabled || is_official(module) {
                return None;
            }
            Some((id, module))
        })
        .collect();
    let known: Vec<&str> = candidates.iter().map(|(_, module)| *module).collect();
    let mut families: Vec<ExternalFamily> = Vec::new();
    for (id, module) in &candidates {
        let root = family_root(module, &known);
        match families.iter_mut().find(|family| family.name == root) {
            Some(family) => {
                family.entry_ids.push((*id).to_string());
                if !family.module_names.iter().any(|name| name == module) {
                    family.module_names.push((*module).to_string());
                }
            }
            None => families.push(ExternalFamily {
                name: root,
                entry_ids: vec![(*id).to_string()],
                module_names: vec![(*module).to_string()],
            }),
        }
    }
    families
}

/// 从崩溃归因的插件名解析出它所属的外部插件家族。
///
/// 归因给的是**运行期 fiber 名**（如 `wallpaper-engine` 或 `dsh-plugin-wallpaper-engine`），
/// 与 profile 里的包名不总是逐字相同，故按「族内任一包名以它结尾」匹配。
/// @returns 命中的家族；对不上（官方插件、已卸载、名字形态不符）时返回 `None`。
pub fn family_of<'a>(families: &'a [ExternalFamily], plugin: &str) -> Option<&'a ExternalFamily> {
    let needle = plugin.trim();
    if needle.is_empty() {
        return None;
    }
    families.iter().find(|family| {
        family.name == needle
            || family.module_names.iter().any(|module| {
                module == needle || module.ends_with(&format!("-{needle}")) || module.ends_with(&format!("/{needle}"))
            })
    })
}

/// 停用一个家族的全部 entry。
/// @returns 实际停用成功的 entry id；任一失败即返回错误（不掩盖半途状态）。
pub fn disable_family(bridge: &DshBridge, family: &ExternalFamily) -> Result<Vec<String>, String> {
    let mut disabled = Vec::new();
    for (index, id) in family.entry_ids.iter().enumerate() {
        let args = json!({ "id": id, "enabled": false });
        match call_plugin_manager(bridge, &format!("ws-disable-{index}"), "setPluginEnabled", args) {
            Ok(_) => disabled.push(id.clone()),
            Err(error) => {
                return Err(format!(
                    "停用 {} 失败（已停 {} 个：{}）：{error}",
                    id,
                    disabled.len(),
                    disabled.join(", ")
                ))
            }
        }
    }
    Ok(disabled)
}

/// 停用疑似问题插件后重启（菜单动作的完整流程）。
///
/// 步骤：取归因 → 读在册插件 → 定位家族 → 整族停用 → 发通知 → 重启。
///
/// **任何一步失败都不能静默**：用户点了一个「止血」动作却没效果，比没有这个按钮更糟。
/// 失败路径一律经系统通知 + 应用日志双写，并明确说明失败在哪一步。
pub fn disable_suspect_and_restart(app: &tauri::AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let outcome = run_disable(&app);
        match outcome {
            Ok(summary) => {
                println!("[DSH-SHELL] 停用成功：{summary}；即将重启");
                notify(&app, "WorldSea：已停用疑似问题插件", &format!("{summary}\n正在重启 Agent 内核…"));
                crate::dsh_restart::request_manual_restart(&app);
            }
            Err(error) => {
                eprintln!("[DSH-SHELL] 停用失败：{error}");
                notify(&app, "WorldSea：停用失败", &error);
            }
        }
    });
}

/// 实际执行停用，返回人类可读的摘要。
fn run_disable(app: &tauri::AppHandle) -> Result<String, String> {
    let suspect = app
        .try_state::<crate::dsh_crash_attribution::DshCrashAttribution>()
        .and_then(|state| state.current())
        .ok_or_else(|| "当前没有崩溃归因，无法确定要停用哪个插件。".to_string())?;
    let bridge = app
        .try_state::<crate::dsh_bridge::DshBridge>()
        .ok_or_else(|| "壳桥未装配，无法调用宿主插件管理接口。".to_string())?;
    let plugins = list_plugins(&bridge).map_err(|e| format!("读取插件清单失败：{e}"))?;
    let families = external_families(&plugins);
    let family = family_of(&families, &suspect.plugin).ok_or_else(|| {
        format!(
            "在外部插件里找不到「{}」（它可能是官方内置插件，或已经停用/卸载）。\n按约定不触碰官方内置插件。",
            suspect.plugin
        )
    })?;
    let disabled = disable_family(&bridge, family)?;
    Ok(format!(
        "已停用外部插件「{}」共 {} 个入口。",
        family.name,
        disabled.len()
    ))
}

/// 系统通知（失败不阻断流程，只记日志）。
fn notify(app: &tauri::AppHandle, title: &str, body: &str) {
    use tauri_plugin_notification::NotificationExt;
    if let Err(e) = app.notification().builder().title(title).body(body).show() {
        eprintln!("[DSH-SHELL] 停用流程通知发送失败：{e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 造一行 `listPlugins` 结果。
    fn row(entry_id: &str, module_name: &str, enabled: bool) -> Value {
        json!({
            "entryId": entry_id,
            "moduleName": module_name,
            "enabled": enabled,
            "fiberPhase": if enabled { json!("active") } else { Value::Null },
        })
    }

    #[test]
    fn official_plugins_are_never_listed() {
        // 用户明确要求：不染指官方内置插件。判据是 moduleName 前缀。
        let plugins = vec![
            row("include:llm", "@deepseek-ai/dsh-llm", true),
            row("include:session", "@deepseek-ai/dsh-session", true),
            row("include", "cordis:include", true),
            row("include:wallpaper-engine", "dsh-plugin-wallpaper-engine", true),
        ];
        let families = external_families(&plugins);
        assert_eq!(families.len(), 1, "只应留下外部插件：{families:?}");
        assert_eq!(families[0].name, "dsh-plugin-wallpaper-engine");
        assert_eq!(families[0].entry_ids, vec!["include:wallpaper-engine"]);
    }

    #[test]
    fn read_only_reason_is_not_the_builtin_judge() {
        // 实测教训：官方插件（llm / session / storage）都没有 readOnlyReason，
        // 拿它当内置判据会把内置插件误列成「可停用」。
        let official_without_flag = json!({
            "entryId": "include:llm",
            "moduleName": "@deepseek-ai/dsh-llm",
            "enabled": true,
            "fiberPhase": "active",
        });
        assert!(external_families(&[official_without_flag]).is_empty(), "无 readOnlyReason 不等于外部插件");
    }

    #[test]
    fn one_package_with_child_entries_forms_one_family() {
        // 实测形态：profile 只装 dsh-plugin-wallpaper-engine 一个包，却产生 8 个 entry。
        // 停主 entry 不会停掉子 entry（它们只变 pending），故必须整族一起停。
        let plugins = vec![
            row("include:wallpaper-engine", "dsh-plugin-wallpaper-engine", true),
            row("include:wallpaper-engine-fx", "dsh-plugin-wallpaper-engine-fx", true),
            row("include:wallpaper-engine-fonts", "dsh-plugin-wallpaper-engine-fonts", true),
        ];
        let families = external_families(&plugins);
        assert_eq!(families.len(), 1, "同包名的子入口应归为一族：{families:?}");
        assert_eq!(families[0].name, "dsh-plugin-wallpaper-engine");
        assert_eq!(families[0].entry_ids.len(), 3, "整族必须包含全部子入口");
    }

    #[test]
    fn unrelated_hyphenated_packages_stay_separate() {
        // 家族判定只认「基座本身也在册」，不能把无关的连字符包名吞并。
        let plugins = vec![
            row("include:a", "dsh-plugin-worldsea-console", true),
            row("include:b", "dsh-whale-widget", true),
            row("include:c", "dshmarket", true),
        ];
        let families = external_families(&plugins);
        assert_eq!(families.len(), 3, "三个互不相关的包不应归并：{families:?}");
    }

    #[test]
    fn packages_sharing_only_the_dsh_prefix_are_not_one_family() {
        // 回归锁：曾把 `dsh-plugin-worldsea-console` 与 `dsh-whale-widget` 顺着公共
        // 前缀归并成不存在的 `dsh` 家族——那会让「停用一个」变成「停一片无关插件」。
        let plugins = vec![
            row("include:console", "dsh-plugin-worldsea-console", true),
            row("include:whale", "dsh-whale-widget", true),
        ];
        let families = external_families(&plugins);
        assert_eq!(families.len(), 2, "共用 `dsh` 前缀不等于同一家族：{families:?}");
        for family in &families {
            assert_ne!(family.name, "dsh", "不得产生 `dsh` 这个假家族");
        }
    }

    #[test]
    fn already_disabled_entries_are_not_offered() {
        let plugins = vec![
            row("include:x", "dsh-plugin-x", true),
            row("include:y", "dsh-plugin-y", false),
        ];
        let families = external_families(&plugins);
        assert_eq!(families.len(), 1);
        assert_eq!(families[0].name, "dsh-plugin-x");
    }

    #[test]
    fn attribution_name_matches_its_family() {
        // 归因给的是运行期 fiber 名，可能与包名不完全逐字相同。
        let plugins = vec![
            row("include:wallpaper-engine", "dsh-plugin-wallpaper-engine", true),
            row("include:wallpaper-engine-fx", "dsh-plugin-wallpaper-engine-fx", true),
        ];
        let families = external_families(&plugins);
        let family = families[0].clone();
        for name in ["dsh-plugin-wallpaper-engine", "wallpaper-engine"] {
            let hit = family_of(&families, name);
            assert_eq!(hit.map(|f| f.name.as_str()), Some(family.name.as_str()), "{name} 应命中家族");
        }
        assert!(family_of(&families, "@deepseek-ai/dsh-llm").is_none(), "官方插件不得命中");
        assert!(family_of(&families, "").is_none(), "空名不得命中");
    }

    #[test]
    fn envelope_carries_the_args_field_the_host_requires() {
        // 宿主对缺 args 的载荷报 `Remote payload must contain exactly one plain-object args field`，
        // 这是实测踩过的坑，用测试钉住信封形状。
        let bytes = envelope("rpc-1", "pluginManager/listPlugins", json!({}));
        let parsed: Value = serde_json::from_slice(&bytes).expect("信封应为 JSON");
        assert_eq!(parsed["type"], "client-request");
        assert_eq!(parsed["rpcId"], "rpc-1");
        assert_eq!(parsed["method"], "pluginManager/listPlugins");
        assert!(parsed["payload"]["args"].is_object(), "args 必须是对象：{parsed}");
    }
}
