// D2-c（2026-09-27）：产品域说明书——Agent 认知面（D2 批计划 §2.2）。
//
// 启动时确保工作区根有一份 `WORLDSEA.md`（不存在则写模板；**已存在绝不覆盖**——用户可编辑）。
// dsh 会话的 cwd = 工作区 → Agent 首轮经 read_file 拉取（能力 description 里有指向）。
// `WORLDSEA_NO_MANUAL=1` 关闭（反证模式）。内容与 `shell/capabilities.ts` 的 world.* 能力同步维护。

use std::path::Path;

/// 说明书模板（能力清单变更时同步更新本模板——已生成的用户文件不会被覆盖）。
const MANUAL_TEMPLATE: &str = r#"# WorldSea 产品域说明书（给 Agent 的能力地图）

> 本文件由壳在工作区根生成（已存在则不覆盖，可自由编辑）。你的 cwd = 当前工作区目录，
> 即一个「项目」的宇宙根：`worlddata/` 是创作数据（实体/关系/文件），`agent/` 是你的工作路径。

## 你可以操作产品域（工作台窗）——经能力桥

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

## 两条写入通道的判定线

| 通道 | 用途 | 边界 |
|---|---|---|
| **能力调用**（上表） | 带校验、带感知（改完工作台**即见**）、带审计——**默认走这条** | 单实体粒度 |
| **FS 直写**（你的 write_file 等工具） | 批量/原始文件操作（`worlddata/` 下的 JSON、`agent/` 下任意文件） | 绕过数据层校验；改完**不会**自动刷新工作台界面（重进视图才见） |

## 边界

- 实体类型的字段与取值以 `world.schema.get` 运行时返回为准（本文件不列字段清单，避免漂移）。
- 工作台视图（大纲白板 / 思维导图 / 时间线…）的操作面经 `world.views.list` 发现；
  思维导图等芽的读写能力以 `world.mindmap.*` 等已登记能力为准。
- 你在 dsh 侧换会话不影响产品域当前项目；产品域切项目也不影响你的会话（两边解耦）。
"#;

/// 启动时确保工作区根有说明书（幂等：已存在不覆盖）。
/// 工作区根来自 C4 的 `resolve_workspace`（与 dsh cwd 同源）。
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
}
