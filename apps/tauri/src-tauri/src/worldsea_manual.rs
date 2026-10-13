// 产品域说明书——Agent 认知面。
//
// 启动时确保工作区根有一份 `WORLDSEA.md`（不存在则写模板；**已存在绝不覆盖**——用户可编辑）。
// dsh 会话的 cwd = 工作区 → Agent 按需经文件工具拉取；入口指向 = 内置插件 systemPrompt 指引段
// （点名本文件）。`WORLDSEA_NO_MANUAL=1` 关闭（反证模式）。能力桥清单与 `shell/capabilities.ts` 同步维护。

use std::path::Path;

/// 说明书模板（能力清单变更时同步更新本模板——已生成的用户文件不会被覆盖）。
const MANUAL_TEMPLATE: &str = r#"# WorldSea 产品域说明书（给 Agent 的能力地图）

> 本文件由壳在工作区根生成（已存在则不覆盖，可自由编辑）。你的 cwd = 当前工作区目录，
> 即一个「项目」的根目录：`worlddata/` 是创作数据（实体/关系/文件），`agent/` 是你的工作路径。

## 操作创作数据的三条通道

| 通道 | 用途 | 特点 |
|---|---|---|
| **原生工具集**（下节 world_*，会话工具面直接调用） | 日常读写创作数据——**默认走这条** | schema 轻校验 + 写前工作区守卫 + 关系簿记互斥；写后工作台界面自动刷新 |
| **能力调用**（下节 world.*，经壳能力桥） | 需要工作台运行时参与的操作 | 带校验、带审计；单实体粒度；改完工作台即见 |
| **FS 直写**（write_file 等通用工具） | 批量/原始文件操作（`worlddata/` 下的 JSON、`agent/` 下任意文件） | 绕过数据层校验，格式自负；worlddata 内的外部写入同样经 FsWatcher 刷新界面 |

## 原生工具集（12 条 world_*，会话工具面直接可用）

项目：`world_project_list`（项目 = dsh 工作区）· `world_project_current`（cwd 对齐的项目）
Schema：`world_schema_get`（type 省略 = 全部；**组装实体前先取**；单类型返回附 snapshotGeneratedAt）
实体：`world_entity_list` · `world_entity_search`（关键词 + tag 标签过滤）· `world_entity_get` · `world_entity_put` · `world_entity_update` · `world_entity_delete`（原子清理关联关系）
关系：`world_relation_list` · `world_relation_put`（两端实体必须已存在）· `world_relation_delete`

**清单类共性**：返回 `{items, total, offset, limit}`——total 超过 items 数即有更多，用 offset 翻页（缺省 200 条上限）；统一按 updatedAt 降序 → id 升序稳定排序；空结果附 `state`（`uninitialized` = 数据目录未初始化，请用户先打开一次工作台 / `empty` = 暂无数据）。
**按需取字段**：`world_entity_get` 与 `world_relation_list` 支持 `fields` 点路径数组（如 `["properties.age"]`），id/type 恒返回，减载荷。
**写操作两条**：① 写前守卫——会话 cwd 必须正好是已登记工作区根，否则报 `WORLDSEA_NOT_A_WORKSPACE`（防误写非项目目录）；② `world_entity_update` 的 `changes.properties` 缺省整包替换，`mergeProperties: true` 按字段合并（只改动点名字段）。

## 能力桥清单（world.*，经壳受控调用）

项目与项目数据（只读发现 → 按 schema 组装 → 写入）：

- `world.project.list` —— 项目清单（项目 = dsh 工作区目录）：id / 名称 / path
- `world.project.current` —— 当前项目（id / 名称 / 目录 dirPath）
- `world.views.list` —— 创作面（芽视图）清单：id / 标题 / 归属芽
- `world.schema.get` —— 实体类型的字段 schema（type 省略 = 全部类型）；**组装实体数据前先取它**
- `world.entity.list` —— 实体清单（瘦身 id/type/name；type 过滤）
- `world.entity.get` —— 实体完整数据（含 properties / facets）
- `world.entity.put` —— 新建实体（{type, name, description?, properties?, tags?}；id 自动生成）
- `world.entity.update` —— 按 id 局部更新
- `world.entity.delete` —— 按 id 删除（不可恢复）
- `world.relation.list` —— 关系清单（entityId 过滤 = 与该实体相关的）
- `world.relation.put` —— 新建关系（{type, sourceId, targetId, label?, properties?}）
- `world.relation.delete` —— 按 id 删除关系

**典型两步**：`world.schema.get {type:"character"}` 拿字段 → `world.entity.put {entity:{type:"character", name:"...", properties:{...}}}`。

## 边界

- 实体类型的字段与取值以 `world.schema.get` 运行时返回为准（本文件不列字段清单，避免漂移）。
- 工作台视图（大纲白板 / 思维导图 / 时间线…）的操作面经 `world.views.list` 发现；
  思维导图等芽的读写能力以 `world.mindmap.*` 等已登记能力为准。
- 你在 dsh 侧换会话不影响产品域当前项目；产品域切项目也不影响你的会话（两边解耦）。
"#;

/// 薄指针模板：写进工作区根 `AGENTS.md`——dsh agent-instructions 会把
/// 项目根的 AGENTS.md 自动注入会话基线（预算 64KB），本文件只做指针不做地图（地图 = WORLDSEA.md）。
const AGENTS_POINTER_TEMPLATE: &str = r#"# WorldSea 产品域工作区（壳生成的指针）

> 本文件由 WorldSea 壳生成（已存在则不覆盖，可自由编辑；不需要可删除，可在
> dsh 设置「内置插件 → WorldSea 产品域」里关闭生成）。

本项目是 **WorldSea 产品域工作区**（项目 = dsh 工作区，单一真相源在 dsh 侧）：

- 你的 cwd = 项目根目录；创作数据在 `worlddata/`（实体/关系/文件），`agent/` 是你的工作路径。
- **先读 `WORLDSEA.md`**——产品域能力地图：三条写入通道判定线 + `world.*` 能力桥清单 + 12 条 `world_*` 原生工具。
- 会话工具面里的 `world_*` 工具可直接读写创作数据；清单类返回带分页与稳定排序，写操作要求 cwd 为本项目根。
"#;

/// 启动时确保工作区根有说明书（幂等：已存在不覆盖）。
/// 工作区根来自 `resolve_workspace`（与 dsh cwd 同源）。
pub(crate) fn ensure_manual(workspace: &Path) {
    if std::env::var_os("WORLDSEA_NO_MANUAL").is_some() {
        println!("[DSH-SHELL] 说明书生成已按 WORLDSEA_NO_MANUAL 关闭（反证模式）");
        return;
    }
    let path = workspace.join("WORLDSEA.md");
    if path.exists() {
        return;
    }
    match std::fs::write(&path, MANUAL_TEMPLATE) {
        Ok(()) => println!("[DSH-SHELL] 说明书已生成：{}（Agent 认知面，用户可编辑）", path.display()),
        Err(e) => eprintln!("[DSH-SHELL] 说明书生成失败（{path:?}）：{e}"),
    }
}

/// 启动时确保工作区根有薄指针 AGENTS.md（幂等：已存在不覆盖；开关 = 产品域设置 `agentsPointer`）。
pub(crate) fn ensure_agents_pointer(workspace: &Path) {
    let path = workspace.join("AGENTS.md");
    if path.exists() {
        return;
    }
    match std::fs::write(&path, AGENTS_POINTER_TEMPLATE) {
        Ok(()) => println!("[DSH-SHELL] 薄指针已生成：{}（dsh agent-instructions 注入链入口，用户可编辑）", path.display()),
        Err(e) => eprintln!("[DSH-SHELL] 薄指针生成失败（{path:?}）：{e}"),
    }
}

/// lib.rs setup 的单行接线：内部定位工作区（不可得则记日志跳过）。
/// 生成开关读产品域设置节：`manualGeneration` / `agentsPointer`。
pub(crate) fn ensure_for_app(app: &tauri::AppHandle) {
    let prefs = crate::app_prefs::load_product_domain(app);
    match crate::dsh_workspace::resolve_workspace(app) {
        Ok(workspace) => {
            if prefs.manual_generation {
                ensure_manual(&workspace);
            } else {
                println!("[DSH-SHELL] 说明书生成已在产品域设置中关闭（不新生成 WORLDSEA.md）");
            }
            if prefs.agents_pointer {
                ensure_agents_pointer(&workspace);
            }
        }
        Err(e) => eprintln!("[DSH-SHELL] 说明书跳过（工作区不可得）：{e}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 说明书_不存在则生成_已存在不覆盖() {
        let dir = std::env::temp_dir().join(format!("ws-manual-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("WORLDSEA.md");

        ensure_manual(&dir);
        assert!(path.exists());
        let first = std::fs::read_to_string(&path).unwrap();
        assert!(first.contains("world.schema.get"));

        std::fs::write(&path, "用户自定义内容").unwrap();
        ensure_manual(&dir);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "用户自定义内容");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 说明书_模板含全部能力条目() {
        for id in [
            "world.project.list",
            "world.project.current",
            "world.views.list",
            "world.schema.get",
            "world.entity.put",
            "world.entity.update",
            "world.entity.delete",
            "world.relation.put",
            "world.relation.delete",
        ] {
            assert!(MANUAL_TEMPLATE.contains(id), "模板缺少能力 {id}");
        }
    }

    #[test]
    fn 薄指针_不存在则生成_已存在不覆盖() {
        let dir = std::env::temp_dir().join(format!("ws-pointer-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("AGENTS.md");

        ensure_agents_pointer(&dir);
        assert!(path.exists());
        let first = std::fs::read_to_string(&path).unwrap();
        assert!(first.contains("WORLDSEA.md"), "薄指针必须指向说明书");
        assert!(first.contains("worlddata"), "薄指针必须交代数据目录口径");

        std::fs::write(&path, "用户自定义 AGENTS.md").unwrap();
        ensure_agents_pointer(&dir);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "用户自定义 AGENTS.md");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 说明书_模板含工具集通道() {
        for id in ["world_project_list", "world_entity_search", "world_relation_put", "mergeProperties", "WORLDSEA_NOT_A_WORKSPACE"] {
            assert!(MANUAL_TEMPLATE.contains(id), "模板缺少工具集要点 {id}");
        }
    }
}
