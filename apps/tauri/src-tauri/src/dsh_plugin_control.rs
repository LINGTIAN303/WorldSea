// 外部插件的停用与卸载——经宿主的 pluginManager Remote，按 **bundle（npm 包）** 粒度操作。
//
// 为什么是 bundle 粒度而不是 entry 粒度（2026-11-04 实测）：
//
//   dsh-plugin-wallpaper-engine 一个包在 `listPlugins()` 里展开成 **8 个 entry**
//   （主入口 + about-notice / mascot-avatar / media-bridge / pet-link / fx / parallax / fonts）。
//   逐 entry 停用要调 8 次，且子 entry 只是变 `fiberPhase: pending`（仍 `enabled: true`）；
//   而 `setBundleEnabled(name, false)` **一次调用**就让 8 个 entry 全部从清单消失。
//
//   卸载同理：`removeBundle(name)` 按包名一次移除，不必逐个 entry 处理。
//
// 为什么只碰外部插件：用户明确要求「不染指官方内置插件」。判据是包名/模块名前缀——
// 官方一律 `@deepseek-ai/`，框架自身是 `cordis:`。**注意不要用 `readOnlyReason` 判**：
// 实测它只表示「不能经 profile patch 管理」，几乎所有官方插件（llm / session / storage …）
// 都没有该字段，拿它当内置判据会把内置插件当成外部。
//
// 通信口径：与页面同链路（`dsh_bridge::call_api`，自动带 cookie），走 typert Remote 的
// HTTP 信封 `{type:'client-request', rpcId, method, payload:{args}}`；`args` 是宿主要求的
// 唯一载荷字段（缺它会报 `Remote payload must contain exactly one plain-object args field`）。

use serde_json::{json, Value};
use tauri::Manager;

use crate::dsh_bridge::DshBridge;

/// 官方插件的包名前缀；带此前缀的一律视为内置，永不提供停用/卸载。
const OFFICIAL_SCOPE: &str = "@deepseek-ai/";

/// 一个可按包操作的外部插件。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExternalBundle {
    /// profile 里的包名（`removeBundle` / `setBundleEnabled` 的入参）。
    pub name: String,
    /// 当前是否启用。
    pub enabled: bool,
    /// 宿主是否允许移除（官方保护或使用中都为 false）。
    pub removable: bool,
}

/// Remote 调用的固定信封。
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

/// 判定一个包名是否属于官方内置（含框架自身）。
pub fn is_official(name: &str) -> bool {
    name.starts_with(OFFICIAL_SCOPE) || name.starts_with("cordis:")
}

/// 读当前在册的**外部** bundle（官方与框架自身一律排除）。
pub fn external_bundles(bridge: &DshBridge) -> Result<Vec<ExternalBundle>, String> {
    let value = call_plugin_manager(bridge, "ws-bundles", "listBundles", json!({}))?;
    let rows = value.as_array().ok_or_else(|| "listBundles 未返回数组".to_string())?;
    Ok(rows
        .iter()
        .filter_map(|row| {
            let name = row.get("name")?.as_str()?;
            if is_official(name) {
                return None;
            }
            Some(ExternalBundle {
                name: name.to_string(),
                enabled: row.get("enabled").and_then(Value::as_bool).unwrap_or(false),
                removable: row.get("removable").and_then(Value::as_bool).unwrap_or(false),
            })
        })
        .collect())
}

/// 把崩溃线索里的插件名匹配到某个外部 bundle。
///
/// 线索给的是**运行期 fiber 名**（如 `wallpaper-engine`），与包名
/// （`dsh-plugin-wallpaper-engine`）不总是逐字相同，故按「包名以它结尾」匹配。
/// @returns 命中的包名；对不上（官方插件、已卸载、名字形态不符）时返回 `None`。
pub fn bundle_of<'a>(bundles: &'a [ExternalBundle], plugin: &str) -> Option<&'a ExternalBundle> {
    let needle = plugin.trim();
    if needle.is_empty() {
        return None;
    }
    bundles.iter().find(|bundle| {
        bundle.name == needle
            || bundle.name.ends_with(&format!("-{needle}"))
            || bundle.name.ends_with(&format!("/{needle}"))
    })
}

/// 停用请求的载荷（抽出成纯函数以便直接断言字段名）。
///
/// 宿主 `setBundleEnabled(name, enabled)` 只认 **`name`**；写成 `id` 是 entry 粒度的字段，
/// 会被当成缺参。这个区别是本模块的核心契约，故单独可测。
fn disable_args(name: &str) -> Value {
    json!({ "name": name, "enabled": false })
}

/// 卸载请求的载荷。同 `disable_args`：宿主只认 `name`。
fn remove_args(name: &str) -> Value {
    json!({ "name": name })
}

/// 按包停用一个外部插件。
/// @returns 宿主变更结果中的 `changed` 标志（false 表示本来就是这个状态）。
pub fn disable_bundle(bridge: &DshBridge, name: &str) -> Result<bool, String> {
    let value = call_plugin_manager(bridge, "ws-bundle-disable", "setBundleEnabled", disable_args(name))?;
    Ok(value.get("changed").and_then(Value::as_bool).unwrap_or(false))
}

/// 按包卸载一个外部插件（破坏性：连包一起移除）。
///
/// 宿主内部已处理「先停用再移除」（实测：直接对运行中的 bundle 调 `removeBundle` 会返回
/// `changed:true` 并真跑 pnpm remove），故这里**不要**自己先停一次——多调一次只会多一次
/// profile 重载，且在 `removable:false` 时白做一次停用。
pub fn remove_bundle(bridge: &DshBridge, name: &str) -> Result<bool, String> {
    let value = call_plugin_manager(bridge, "ws-bundle-remove", "removeBundle", remove_args(name))?;
    Ok(value.get("changed").and_then(Value::as_bool).unwrap_or(false))
}

/// 用户选了哪一种处置。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Remediation {
    /// 只停用（保守，包还在，随时可再启用）。
    Disable,
    /// 停用并卸载（彻底，包被移除）。
    Remove,
}

impl Remediation {
    /// 动作名（用于日志与通知文案）。
    fn label(self) -> &'static str {
        match self {
            Remediation::Disable => "停用",
            Remediation::Remove => "卸载",
        }
    }
}

/// 处置疑似插件后重启（菜单动作的完整流程）。
///
/// 步骤：取线索 → 读外部 bundle 清单 → 定位包 → 按选择处置 → 发通知 → 重启。
///
/// **任何一步失败都不能静默**：用户点了一个「止血」动作却没效果，比没有这个按钮更糟。
/// 失败路径一律经系统通知 + 应用日志双写，并明确说明失败在哪一步。
pub fn remediate_suspect_and_restart(app: &tauri::AppHandle, action: Remediation) {
    let app = app.clone();
    std::thread::spawn(move || match run_remediation(&app, action) {
        Ok(summary) => {
            println!("[DSH-SHELL] {summary}；即将重启");
            notify(&app, "WorldSea：已处置疑似问题插件", &format!("{summary}\n正在重启 Agent 内核…"));
            crate::dsh_restart::request_manual_restart(&app);
        }
        Err(error) => {
            eprintln!("[DSH-SHELL] {}失败：{error}", action.label());
            notify(&app, &format!("WorldSea：{}失败", action.label()), &error);
        }
    });
}

/// 实际执行处置，返回人类可读的摘要。
fn run_remediation(app: &tauri::AppHandle, action: Remediation) -> Result<String, String> {
    let suspect = app
        .try_state::<crate::dsh_crash_attribution::DshCrashAttribution>()
        .and_then(|state| state.current())
        .ok_or_else(|| "当前没有崩溃线索，无法确定要处置哪个插件。".to_string())?;
    let bridge = app
        .try_state::<crate::dsh_bridge::DshBridge>()
        .ok_or_else(|| "壳桥未装配，无法调用宿主插件管理接口。".to_string())?;
    let bundles = external_bundles(&bridge).map_err(|e| format!("读取插件清单失败：{e}"))?;
    let bundle = bundle_of(&bundles, &suspect.plugin).ok_or_else(|| {
        format!(
            "在外部插件里找不到「{}」（它可能是官方内置插件，或已经停用/卸载）。\n按约定不触碰官方内置插件。",
            suspect.plugin
        )
    })?;
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

#[cfg(test)]
mod tests {
    use super::*;

    fn bundle(name: &str, enabled: bool, removable: bool) -> ExternalBundle {
        ExternalBundle { name: name.to_string(), enabled, removable }
    }

    #[test]
    fn official_plugins_are_never_offered() {
        // 用户明确要求：不染指官方内置插件。判据是包名前缀。
        assert!(is_official("@deepseek-ai/dsh-llm"));
        assert!(is_official("@deepseek-ai/dsh-client-connection"));
        assert!(is_official("cordis:include"));
        assert!(!is_official("dsh-plugin-wallpaper-engine"));
        assert!(!is_official("dshmarket"));
        assert!(!is_official("@montersy123/dsh-skill-market"), "第三方 scope 不是官方");
    }

    #[test]
    fn attribution_name_matches_its_bundle() {
        // 线索给运行期 fiber 名，包名可能带前缀；两种写法都要命中。
        let bundles = vec![bundle("dsh-plugin-wallpaper-engine", true, true)];
        for name in ["dsh-plugin-wallpaper-engine", "wallpaper-engine"] {
            assert_eq!(bundle_of(&bundles, name).map(|b| b.name.as_str()), Some("dsh-plugin-wallpaper-engine"));
        }
        assert!(bundle_of(&bundles, "@deepseek-ai/dsh-llm").is_none(), "官方包不得命中");
        assert!(bundle_of(&bundles, "").is_none(), "空名不得命中");
    }

    #[test]
    fn scoped_third_party_bundle_matches_by_its_leaf() {
        let bundles = vec![bundle("@montersy123/dsh-skill-market", true, true)];
        assert_eq!(
            bundle_of(&bundles, "dsh-skill-market").map(|b| b.name.as_str()),
            Some("@montersy123/dsh-skill-market"),
        );
    }

    #[test]
    fn remove_payload_is_by_bundle_name_not_entry_id() {
        // 卸载同样按包名：宿主 `removeBundle(name)` 只认 bundle 名。
        let args = remove_args("dsh-plugin-wallpaper-engine");
        assert_eq!(args["name"], "dsh-plugin-wallpaper-engine");
        assert!(args.get("id").is_none(), "卸载不按 entryId 操作");
    }

    #[test]
    fn non_removable_bundles_are_reported_not_forced() {
        // 宿主对不可移除的包会以 not-removable 拒绝；壳侧先看 removable 标志，
        // 把「不能卸」的原因说清楚并指向「停用」这条路，而不是硬试一次再抛宿主的错。
        let bundles = vec![bundle("@deepseek-ai/dsh-llm", true, false)];
        let target = bundle_of(&bundles, "dsh-llm");
        // 官方包根本不会进 external_bundles；这里直接验证 removable 语义在结构上可见
        assert_eq!(target.map(|b| b.removable), Some(false));
    }

    #[test]
    fn envelope_carries_the_args_field_the_host_requires() {
        // 宿主对缺 args 的载荷报 `Remote payload must contain exactly one plain-object args field`，
        // 这是实测踩过的坑，用测试钉住信封形状。
        let bytes = envelope("rpc-1", "pluginManager/listBundles", json!({}));
        let parsed: Value = serde_json::from_slice(&bytes).expect("信封应为 JSON");
        assert_eq!(parsed["type"], "client-request");
        assert_eq!(parsed["rpcId"], "rpc-1");
        assert_eq!(parsed["method"], "pluginManager/listBundles");
        assert!(parsed["payload"]["args"].is_object(), "args 必须是对象：{parsed}");
    }

    #[test]
    fn bundle_granularity_is_one_call_not_one_per_entry() {
        // 本模块存在的理由：entry 粒度要 8 次调用且子 entry 只变 pending，
        // bundle 粒度一次调用就让整组消失。锁住「按包名操作」这个契约。
        let args = disable_args("dsh-plugin-wallpaper-engine");
        assert_eq!(args["name"], "dsh-plugin-wallpaper-engine");
        assert_eq!(args["enabled"], false);
        assert!(args.get("id").is_none(), "bundle 粒度不按 entryId 操作");
    }
}
