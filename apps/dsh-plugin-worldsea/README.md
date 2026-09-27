# dsh-plugin-worldsea

WorldSea 产品域工具集（内置级 dsh 插件，零依赖）——让 Agent 以**原生工具**直接读写工作台创作数据。

## 工具集

| 工具 | 用途 |
|---|---|
| `world_project_list` | 项目清单（项目 = dsh 工作区，同源模型） |
| `world_schema_get` | 实体类型的字段 schema（type 省略 = 全部；组装实体前先取） |
| `world_entity_list` | 实体清单（瘦身 id/type/name；type 过滤） |
| `world_entity_get` | 实体完整数据 |
| `world_entity_put` | 新建实体（schema 快照轻校验：类型存在 + 必填字段） |
| `world_entity_update` | 按 id 局部更新 |
| `world_entity_delete` | 按 id 删除 |

关系（relation）读写后置：`worlddata/relations/_index.json` 簿记语义未清，待核实后补。

## 执行体与通知

- 数据真相 = `<会话 cwd>/worlddata/` 透明 JSON（与工作台 FileStorageBackend 同源）；实体目录 `entities/<type>/<名>_<id>.json`
- 外部写入经工作台 **FsWatcher** 天然刷新 UI（外部写入不进自身写入静默期）——零通知通道
- schema 快照 = `worlddata/.worldsea/schema-snapshot.json`（工作台启动/重播种时导出；`.worldsea/` 目录被 watcher 忽略，不抖 UI）

## 配置（cordis.patch.yml 的插件 config，均可省略）

- `dshHome`：DSH_HOME 覆盖（缺省读 `process.env.DSH_HOME`——壳 spawn 宿主时已设置）
- `dataRoot`：无会话 cwd 时的实体目录兜底（缺省无——非会话调用 fail loud）

## profile 装配（dsh-home/profiles/web/）

1. `package.json`：
   - `dsh.profile.bundles` 数组加 `"dsh-plugin-worldsea"`
   - `dependencies` 加 `"dsh-plugin-worldsea": "link:D:/WorldSea/apps/dsh-plugin-worldsea"`
2. 重启宿主（或 Plugin Manager 里确认插件出现并启用）
3. 验证：dsh 设置「内置插件」页出现 `worldsea`；Agent 会话工具清单出现 `world_*` 七件

## 设计依据

- D2 批计划：`docs/plans/2026-09-27-D2-Agent操作产品域-重设计批计划.md`（§2.1 能力形状 / §1.1 项目=workspace）
- 插件形态对齐 `dsh-plugin-community` 先例（零依赖自包含 lib/index.js + link: 装配）
- 工具注册 = `ctx.tools.register`（ToolDefinition 形状手写，见 dsh/packages/core/tools）；指引段 = `ctx.systemPrompt.section`
