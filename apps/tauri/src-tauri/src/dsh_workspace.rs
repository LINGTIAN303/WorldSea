// C4（2026-09-24）：工作区取向与「可供给性」提示——从 dsh_shell.rs 拆出（行数门禁）。
//
// 三件：① 默认工作区解析（用户 profile 下的专用目录；`WORLDSEA_WORKSPACE` 可覆盖）；
// ② 启动探测 + 日志 + 系统通知（不可供给时把横幅文案带出去）；③ 一键修复（**用户显式点击才执行**）。
// 机制与依据（dsh 的 ACL 沙箱要目录上的 WRITE_OWNER）见 workspace_probe.rs 与
// docs/plans/2026-09-24-C4-壳侧工作区批计划.md §二。
// D2-a（2026-09-27）追加第四件：dsh 工作区**列表转发**（`cmd_dsh_workspace_list`）——
// 「项目 = dsh workspace」同源模型（D2 批计划 §1.1）的产品域数据源，见文件尾段。

use std::path::{Path, PathBuf};

use tauri::Manager;

/// 去掉 Windows verbatim 前缀（`\\?\`）——Node 不认该形态（实测 `EISDIR: lstat 'D:'`）。
/// `canonicalize()` 会加上该前缀，故凡是要交给 Node 作参数的路径都必须先剥掉。
pub(crate) fn strip_verbatim_prefix(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy();
    match text.strip_prefix(r"\\?\") {
        Some(rest) => PathBuf::from(rest),
        None => path,
    }
}

/// 默认工作区（C4-a）：`WORLDSEA_WORKSPACE` 显式指定 > `%USERPROFILE%\WorldSea`（POSIX `$HOME/WorldSea`）
/// > 应用数据目录下 `workspace`。缺失即创建——用户 profile 下的目录 ACL 天然含用户完全控制，
/// dsh 的 Windows ACL 沙箱才供给得动。
pub(crate) fn resolve_workspace(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let candidate = match std::env::var_os("WORLDSEA_WORKSPACE") {
        Some(raw) => PathBuf::from(raw),
        None => match std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
            Some(home) => PathBuf::from(home).join("WorldSea"),
            None => app
                .path()
                .app_data_dir()
                .map_err(|e| format!("定位应用数据目录失败：{e}"))?
                .join("workspace"),
        },
    };
    let candidate = strip_verbatim_prefix(candidate);
    std::fs::create_dir_all(&candidate)
        .map_err(|e| format!("创建工作区失败（{}）：{e}", candidate.display()))?;
    Ok(candidate)
}

/// 工作区可供给性探测（C4-a）：日志一行；不可供给时补一条系统通知。
/// 返回横幅文案（不可供给且未按 `WORLDSEA_NO_WORKSPACE_NOTICE=1` 关掉时），供 index 注入带出。
pub(crate) fn announce_workspace(app: &tauri::AppHandle, workspace: &Path) -> Option<String> {
    let probe = crate::workspace_probe::check(workspace);
    println!("[DSH-SHELL] 工作区探测：{} —— {}", probe.label(), probe.describe(workspace));
    if probe.is_ready() {
        return None;
    }
    eprintln!(
        "[DSH-SHELL] 工作区不可供给：该工作区里的命令会在 dsh 沙箱初始化阶段失败（前台后台一视同仁）；修复命令见上行"
    );
    if std::env::var_os("WORLDSEA_NO_WORKSPACE_NOTICE").is_some() {
        eprintln!("[DSH-SHELL] 工作区横幅已按 WORLDSEA_NO_WORKSPACE_NOTICE 关闭（反证模式）");
        return None;
    }
    use tauri_plugin_notification::NotificationExt;
    if let Err(e) = app
        .notification()
        .builder()
        .title("WorldSea：工作区权限不足")
        .body("默认工作区无法被 dsh 沙箱初始化，里面的命令会失败。界面横幅可一键修复（或见应用日志里的 icacls 命令）。")
        .show()
    {
        eprintln!("[DSH-SHELL] 工作区通知发送失败：{e}");
    }
    Some(format!("工作区不可供给：{}", probe.describe(workspace)))
}

/// C4-b：一键修复工作区权限——对当前默认工作区授「用户完全控制」（含 dsh 沙箱供给所需的 WRITE_OWNER）。
/// 页面横幅按钮与「设置 → 修复工作区权限…」菜单共用；**只有用户显式点击才会走到这里**。
/// 授权后 dsh 会在该目录常驻能力 ACE、删除拒绝与 Low 完整性标签（上游设计使然、粘滞）。
pub(crate) fn fix_workspace_permissions(app: &tauri::AppHandle) -> Result<String, String> {
    let workspace = resolve_workspace(app)?;
    let user = crate::workspace_probe::current_user();
    let output = std::process::Command::new("icacls")
        .arg(&workspace)
        .arg("/grant")
        .arg(format!("{user}:(OI)(CI)F"))
        .output()
        .map_err(|e| format!("调用 icacls 失败：{e}"))?;
    if !output.status.success() {
        return Err(format!(
            "icacls 失败（{}）：{}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let probe = crate::workspace_probe::check(&workspace);
    println!("[DSH-SHELL] 工作区修复后探测：{} —— {}", probe.label(), probe.describe(&workspace));
    Ok(probe.label().to_string())
}

// ── D2-a：dsh 工作区列表转发（2026-09-27）─────────────────────────────────────
//
// 数据源 = `$DSH_HOME/storages/workspace.json`（**壳直读存储文件**，C5 凭证库同款先例）。
// 为什么不走 dsh API：workspace 命名空间只有 create/rename/delete/排序与会话归档 +
// `follow` 订阅流（AsyncIterable）——没有一次性 list；壳转发订阅流得不偿失，直读最务实。
// 结构（unit v2）：`global.workspaceIds`（**UI 列表顺序**）+ `tables.workspaces.<id>{path,title,...}`。
// 防御性解析：JSON 损坏 / 缺字段 → 跳过该条或空列表（产品侧项目列表为空可容忍，不炸壳）；
// ★ 内部格式耦合登记：`tables` 结构属 dsh 内部存储，dsh 追版（fork:check 后）须真机回归本命令。

/// 工作区条目（产品域「项目」的同源视图：title = 项目名、path = 项目目录）。
#[derive(Debug, Clone, PartialEq, serde::Deserialize, serde::Serialize)]
pub struct DshWorkspace {
    pub id: String,
    pub title: String,
    pub path: String,
}

/// DSH_HOME 口径：`WORLDSEA_DSH_HOME` 覆盖 > `<app_data>/dsh-home`。
/// （与 `dsh_shell` 的 spawn 段同源——该处还带 create_dir_all 副作用，故不共享函数；改动须两处同步。）
fn dsh_storages_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    match std::env::var_os("WORLDSEA_DSH_HOME") {
        Some(raw) => Ok(PathBuf::from(raw)),
        None => app
            .path()
            .app_data_dir()
            .map_err(|e| format!("定位应用数据目录失败：{e}"))
            .map(|dir| dir.join("dsh-home")),
    }
}

/// 解析 workspace.json → 工作区列表（按 `global.workspaceIds` 顺序；缺 path/title 的条目跳过）。
fn parse_workspace_json(text: &str) -> Vec<DshWorkspace> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(text) else {
        return Vec::new();
    };
    let order = value
        .pointer("/global/workspaceIds")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let tables = value.pointer("/tables/workspaces").cloned().unwrap_or_default();
    let mut items = Vec::new();
    for id in order {
        let Some(id) = id.as_str() else { continue };
        let Some(entry) = tables.get(id) else { continue };
        let (Some(title), Some(path)) = (
            entry.get("title").and_then(|v| v.as_str()),
            entry.get("path").and_then(|v| v.as_str()),
        ) else {
            continue;
        };
        items.push(DshWorkspace { id: id.to_string(), title: title.to_string(), path: path.to_string() });
    }
    items
}

/// 读 dsh 工作区列表。
pub(crate) fn list_dsh_workspaces(app: &tauri::AppHandle) -> Result<Vec<DshWorkspace>, String> {
    let path = dsh_storages_dir(app)?.join("storages").join("workspace.json");
    let text = std::fs::read_to_string(&path)
        .map_err(|e| format!("读取 dsh 工作区存储失败（{path:?}）：{e}"))?;
    Ok(parse_workspace_json(&text))
}

/// 命令：产品域「项目」列表的同源数据源（前端 `world.project.list` 能力的后端）。
#[tauri::command]
pub fn cmd_dsh_workspace_list(app: tauri::AppHandle) -> Result<Vec<DshWorkspace>, String> {
    list_dsh_workspaces(&app)
}

#[cfg(test)]
mod dsh_workspace_list_tests {
    use super::parse_workspace_json;

    #[test]
    fn 解析_按_workspaceIds_顺序且条目完整() {
        let text = r#"{
            "unit": {"name": "workspace", "version": 2},
            "global": {"defaultWorkspaceId": "b", "workspaceIds": ["b", "a"]},
            "tables": {"workspaces": {
                "a": {"path": "D:\\WS", "title": "WS"},
                "b": {"path": "C:\\Users\\u\\WorldSea", "title": "WorldSea"}
            }}
        }"#;
        let items = parse_workspace_json(text);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].title, "WorldSea"); // 顺序跟 workspaceIds，不跟 tables 键序
        assert_eq!(items[1].path, "D:\\WS");
    }

    #[test]
    fn 解析_缺字段条目跳过_损坏JSON与空对象返回空() {
        let partial = r#"{"global":{"workspaceIds":["a","b"]},"tables":{"workspaces":{"a":{"title":"无路径"}}}}"#;
        assert_eq!(parse_workspace_json(partial).len(), 0);
        assert!(parse_workspace_json("not json").is_empty());
        assert!(parse_workspace_json("{}").is_empty());
    }
}
