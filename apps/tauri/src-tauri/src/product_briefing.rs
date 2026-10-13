//! `/entity` 就绪卡的数据面（**纯插件形态**）。
//! 链路：console 客户端贡献位（`commandUi.register`，图标/中文名/短提示由贡献位原生承载，零 dsh 改动）
//! → 壳 IPC [`cmd_product_briefing`] → 本命令**只读**创作数据 → 客户端 Modal 弹卡。
//! **数据与文案分治**：本命令只出结构化事实（`kind` 码 + 数值），文案（含各段降级语）由客户端组装——改措辞不需重编译 Rust；
//! kind 码：project `ok|none`；snapshot `ok|missing|noProject`；data `ok|uninitialized|noProject`。「当前项目」= dsh 工作区注册表默认项目标记（cwd 与工作区根同构，不向客户端要 cwd）。

use std::path::Path;

use serde::Serialize;

/// 当前项目段。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[serde(tag = "kind")]
pub enum BriefingProject {
    /// 命中注册表默认项目。
    Ok { title: String, path: String },
    /// 注册表无默认项目标记（或存储缺失）。
    None,
}

/// schema 快照段（与工具面 `world_schema_get` 同一真源：worlddata/.worldsea/schema-snapshot.json）。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[serde(tag = "kind")]
pub enum BriefingSnapshot {
    Ok { generated_at: Option<String>, type_keys: Vec<String> },
    /// 快照文件缺失（工作台从未打开过该项目）。
    Missing,
    NoProject,
}

/// 数据概况段。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[serde(tag = "kind")]
pub struct BriefingDataOk {
    pub entity_count: u64,
    pub type_count: u64,
    pub relation_count: u64,
}

/// 数据概况段（kind 码：`ok` 携数；`uninitialized` = worlddata 目录不存在；`noProject` 同上）。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[serde(tag = "kind")]
pub enum BriefingData {
    Ok(BriefingDataOk),
    Uninitialized,
    NoProject,
}

/// 就绪卡事实面（三段独立，各段自带降级码——客户端逐段 fail-soft 渲染）。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductBriefing {
    pub project: BriefingProject,
    pub snapshot: BriefingSnapshot,
    pub data: BriefingData,
}

/// 读 JSON 文件（缺失/损坏 → None）。
fn read_json(path: &Path) -> Option<serde_json::Value> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

/// 纯函数：给定默认项目（title, path；None = 注册表无默认项目），组装三段事实。可测。
pub(crate) fn build_briefing(workspace: Option<(&str, &str)>) -> ProductBriefing {
    let Some((title, path)) = workspace else {
        return ProductBriefing {
            project: BriefingProject::None,
            snapshot: BriefingSnapshot::NoProject,
            data: BriefingData::NoProject,
        };
    };
    let project = BriefingProject::Ok { title: title.to_string(), path: path.to_string() };
    let worlddata = Path::new(path).join("worlddata");

    let snapshot = match read_json(&worlddata.join(".worldsea").join("schema-snapshot.json")) {
        Some(value) => BriefingSnapshot::Ok {
            generated_at: value.get("generatedAt").and_then(|v| v.as_str()).map(String::from),
            type_keys: value
                .get("types")
                .and_then(|v| v.as_object())
                .map(|types| types.keys().cloned().collect())
                .unwrap_or_default(),
        },
        None => BriefingSnapshot::Missing,
    };

    let data = if !worlddata.exists() {
        BriefingData::Uninitialized
    } else {
        let entities_root = worlddata.join("entities");
        let mut entity_count = 0u64;
        let mut type_count = 0u64;
        if let Ok(entries) = std::fs::read_dir(&entities_root) {
            for entry in entries.flatten().filter(|e| e.path().is_dir()) {
                type_count += 1;
                if let Ok(files) = std::fs::read_dir(entry.path()) {
                    entity_count += files
                        .flatten()
                        .filter(|f| f.path().extension().map(|ext| ext == "json").unwrap_or(false))
                        .filter(|f| !f.file_name().to_string_lossy().starts_with('_'))
                        .count() as u64;
                }
            }
        }
        let relation_count = read_json(&worlddata.join("relations").join("_index.json"))
            .and_then(|value| value.as_array().map(|list| list.len() as u64))
            .unwrap_or(0);
        BriefingData::Ok(BriefingDataOk { entity_count, type_count, relation_count })
    };

    ProductBriefing { project, snapshot, data }
}

/// 命令：就绪卡事实面（console 客户端贡献位 `/entity` 调用；**只读、无参数**——
/// 当前项目取壳侧注册表默认标记，与工作台「打开的项目」同源）。
#[tauri::command]
pub fn cmd_product_briefing(app: tauri::AppHandle) -> Result<ProductBriefing, String> {
    let workspace = crate::dsh_workspace::list_dsh_workspaces(&app)
        .ok()
        .and_then(|items| items.iter().find(|w| w.is_default).map(|w| (w.title.clone(), w.path.clone())));
    let briefing = match workspace.as_ref() {
        Some((title, path)) => build_briefing(Some((title.as_str(), path.as_str()))),
        None => build_briefing(None),
    };
    Ok(briefing)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// 造一个最小工作区（可选 worlddata 内容），返回其路径。
    fn fixture(with_data: bool) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ws-briefing-{}-{}", std::process::id(), uuid_like()));
        let _ = fs::remove_dir_all(&dir);
        if with_data {
            fs::create_dir_all(dir.join("worlddata/.worldsea")).unwrap();
            fs::write(
                dir.join("worlddata/.worldsea/schema-snapshot.json"),
                r#"{"generatedAt":"2026-10-07T10:00:00Z","types":{"character":{"typeKey":"character"},"region":{"typeKey":"region"}}}"#,
            )
            .unwrap();
            fs::create_dir_all(dir.join("worlddata/entities/character")).unwrap();
            fs::write(dir.join("worlddata/entities/character/甲_1.json"), "{}").unwrap();
            fs::write(dir.join("worlddata/entities/character/_index.json"), "{}").unwrap();
            fs::create_dir_all(dir.join("worlddata/entities/region")).unwrap();
            fs::write(dir.join("worlddata/entities/region/东海_2.json"), "{}").unwrap();
            fs::create_dir_all(dir.join("worlddata/relations")).unwrap();
            fs::write(dir.join("worlddata/relations/_index.json"), r#"[{"id":"r1"}]"#).unwrap();
        }
        dir
    }

    /// 轻量唯一后缀（测试内联用，避免引入 uuid 依赖）。
    fn uuid_like() -> u128 {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
    }

    use std::path::PathBuf;

    #[test]
    fn 无默认项目_三段全是_no_project() {
        let briefing = build_briefing(None);
        assert_eq!(briefing.project, BriefingProject::None);
        assert_eq!(briefing.snapshot, BriefingSnapshot::NoProject);
        assert_eq!(briefing.data, BriefingData::NoProject);
    }

    #[test]
    fn 有项目无_worlddata_快照缺失且数据未初始化() {
        let dir = fixture(false);
        let briefing = build_briefing(Some(("测试项目", dir.to_str().unwrap())));
        assert_eq!(briefing.project, BriefingProject::Ok { title: "测试项目".into(), path: dir.to_str().unwrap().into() });
        assert_eq!(briefing.snapshot, BriefingSnapshot::Missing);
        assert_eq!(briefing.data, BriefingData::Uninitialized);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn 有数据_计数正确且下划线文件不计入实体() {
        let dir = fixture(true);
        let briefing = build_briefing(Some(("测试项目", dir.to_str().unwrap())));
        assert_eq!(
            briefing.snapshot,
            BriefingSnapshot::Ok {
                generated_at: Some("2026-10-07T10:00:00Z".into()),
                type_keys: vec!["character".into(), "region".into()],
            }
        );
        assert_eq!(
            briefing.data,
            BriefingData::Ok(BriefingDataOk { entity_count: 2, type_count: 2, relation_count: 1 })
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn 序列化_camel_case_kind_tag_稳定() {
        let briefing = build_briefing(Some(("测试项目", "Z:\\no-such")));
        let json = serde_json::to_value(&briefing).unwrap();
        assert_eq!(json["project"]["kind"], "ok");
        assert_eq!(json["project"]["title"], "测试项目");
        assert_eq!(json["snapshot"]["kind"], "missing");
        assert_eq!(json["data"]["kind"], "uninitialized");
    }
}
