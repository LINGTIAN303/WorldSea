// dsh-home profile 首启装配（产品域插件随安装器就绪的唯一入口）：
// 把插件目录下的全部 dsh-plugin-* 幂等合并进 web profile 的 bundles 与 dependencies link。
// 只加不改：profile 既有条目（用户编辑、插件管理器写入）一律保留；失效链接修复，缺失才补。
// 插件实体位置由 DshInstall.plugins_dir 统一提供（生产 = 随包部署树 node_modules；dev = 仓 apps/）。
// 新增插件零接线：构建侧按 apps/dsh-plugin-* 通配收编，此处运行时按目录扫描，双方无名单可漏。

use std::path::Path;

use serde_json::{json, Value};

use crate::dsh_shell::DshInstall;

/// 扫描插件目录下的产品域插件包名（dsh-plugin-* 前缀且含 package.json；排序保证 profile 稳定）。
/// 一个都没有 = 安装不完整，fail loud（否则就是静默丢失产品域能力——正是本模块要防的事故）。
fn discover_product_plugins(plugins_dir: &Path) -> Result<Vec<String>, String> {
    let entries =
        std::fs::read_dir(plugins_dir).map_err(|e| format!("读取插件目录失败（{}）：{e}", plugins_dir.display()))?;
    let mut names: Vec<String> = entries
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.starts_with("dsh-plugin-") && plugins_dir.join(n).join("package.json").is_file())
        .collect();
    names.sort();
    if names.is_empty() {
        return Err(format!("插件目录下没有任何 dsh-plugin-*：{}（安装不完整或被杀软误删）", plugins_dir.display()));
    }
    Ok(names)
}

/// 幂等装配 web profile：缺失的 profile 按产品基线重建，存在则合并添加/修复失效 link。
pub(crate) fn ensure_product_profile(home: &Path, install: &DshInstall) -> Result<(), String> {
    let plugins = discover_product_plugins(&install.plugins_dir)?;
    let profile_path = home.join("profiles").join("web").join("package.json");
    let mut root: Value = std::fs::read_to_string(&profile_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| json!({ "name": "dsh-profile-web", "private": true }));
    // 基线 bundles（新建时为完整形状；已有时只补缺，不摘除任何条目）
    if root.get("dsh").is_none() {
        root["dsh"] = json!({});
    }
    if root["dsh"].get("profile").is_none() {
        root["dsh"]["profile"] = json!({});
    }
    if root["dsh"]["profile"].get("bundles").is_none() {
        root["dsh"]["profile"]["bundles"] = json!(["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"]);
    }
    let bundle_list = root["dsh"]["profile"]["bundles"]
        .as_array_mut()
        .ok_or_else(|| "profile 的 dsh.profile.bundles 不是数组".to_string())?;
    for plugin in &plugins {
        if !bundle_list.iter().any(|v| v.as_str() == Some(plugin.as_str())) {
            bundle_list.push(json!(plugin));
        }
    }
    // dependencies link：缺失补上；失效（指向不存在的目录）修复为当前运行时的插件位置
    if !root.get("dependencies").is_some_and(Value::is_object) {
        root["dependencies"] = json!({});
    }
    let deps = root["dependencies"].as_object_mut().expect("上面已确保是 object");
    for plugin in &plugins {
        let link_target = install.plugins_dir.join(plugin);
        if !link_target.is_dir() {
            return Err(format!("产品域插件缺失：{}（安装不完整或被杀软误删）", link_target.display()));
        }
        let link = format!("link:{}", link_target.to_string_lossy().replace('\\', "/"));
        let stale = match deps.get(plugin).and_then(Value::as_str) {
            Some(existing) => match existing.strip_prefix("link:") {
                Some(target) => !Path::new(target).is_dir(),
                None => true,
            },
            None => true,
        };
        if stale {
            deps.insert(plugin.to_string(), json!(link));
        }
    }
    std::fs::create_dir_all(profile_path.parent().expect("profile 路径必有父目录"))
        .map_err(|e| format!("创建 profile 目录失败：{e}"))?;
    let rendered = serde_json::to_string_pretty(&root).map_err(|e| format!("profile 序列化失败：{e}"))?;
    std::fs::write(&profile_path, rendered + "\n").map_err(|e| format!("写入 profile 失败：{e}"))?;
    Ok(())
}
