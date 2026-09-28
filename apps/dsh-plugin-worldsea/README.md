# dsh-plugin-worldsea

WorldSea 产品域工具集（内置级 dsh 插件，零依赖）——让 Agent 以**原生工具**直接读写工作台创作数据。

## 工具集（12 条）

| 工具 | 用途 |
|---|---|
| `world_project_list` | 项目清单（项目 = dsh 工作区，同源模型） |
| `world_project_current` | 当前项目（会话 cwd 对齐到的 dsh 工作区） |
| `world_schema_get` | 实体类型的字段 schema（type 省略 = 全部；组装实体前先取；单类型返回附 snapshotGeneratedAt） |
| `world_entity_list` | 实体清单（瘦身 id/type/name；type 过滤；limit/offset 分页 + total 回显） |
| `world_entity_search` | 按关键词搜实体（匹配 name/description，大小写不敏感） |
| `world_entity_get` | 实体数据（可选 fields 点路径数组按需取字段减载荷；id/type 恒返回） |
| `world_entity_put` | 新建实体（schema 快照轻校验：类型存在 + 必填字段） |
| `world_entity_update` | 按 id 局部更新 |
| `world_entity_delete` | 按 id 删除（对齐工作台原子删除语义：同时清理关联关系） |
| `world_relation_list` | 关系清单（entityId 过滤 = 与该实体相关） |
| `world_relation_put` | 新建/覆盖关系（两端实体必须已存在） |
| `world_relation_delete` | 按 id 删除关系 |

## 执行体与通知

- 数据真相 = `<会话 cwd>/worlddata/` 透明 JSON（与工作台 FileStorageBackend 同源）；实体目录 `entities/<type>/<名>_<id>.json`
- 外部写入经工作台 **FsWatcher** 天然刷新 UI（外部写入不进自身写入静默期）——零通知通道
- schema 快照 = `worlddata/.worldsea/schema-snapshot.json`（工作台启动/重播种时导出；`.worldsea/` 目录被 watcher 忽略，不抖 UI）。快照为静态副本：会话中途 schema 变更不推送（schema = 代码内置注册表，低频），`world_schema_get` 单类型返回附 `snapshotGeneratedAt` 供 Agent 感知时效

## 并发与原子性（D2 第二轮，2026-09-28）

- 插件侧关系写（put/delete/实体删除的关联清理）统一走 `mutateRelations`：`.worldsea/relations.lock` 目录锁互斥（mkdir 原子性；锁内 `holder.pid` 记持有方进程——活持有等满 8s fail loud，死残留立即接管自愈，60s 硬过期兜底）+ 临时文件同卷 rename 原子替换
- **已知边界**：工作台（webview）侧写不走此锁——跨端同时写的窄窗口未做跨进程协同（低频：需用户恰在界面编辑关系时 Agent 也在写关系）
- 大项目保护：`world_entity_list` 缺省 200 条上限，`total` 超过 `items` 长度即有更多，用 `offset` 翻页

## 环境自适应与写前守卫（D2 第三轮，2026-09-28）

- **空结果环境化**：`world_entity_list` / `world_entity_search` / `world_relation_list` 空结果附 `state` 字段——`uninitialized` = worlddata 不存在（工作台从未打开过，提示用户先开一次工作台）· `empty` = 已初始化但暂无数据；有数据时不附该字段
- **写前工作区守卫（严格拒）**：五个写工具（entity put/update/delete · relation put/delete）要求会话 cwd 正好是某个已登记 dsh 工作区的根目录，否则拒 `WORLDSEA_NOT_A_WORKSPACE`（cwd 在某工作区内部非根同样拒——创作数据以工作区根的 worlddata/ 为准）；读操作不拦；`config.dataRoot` 兜底属显式配置不受限
- **fail loud 三段式错误码**（码 + 人话 + 补救）：`WORLDSEA_NO_SESSION` / `NO_DSH_HOME` / `NO_SCHEMA_SNAPSHOT` / `TYPE_UNKNOWN` / `REQUIRED_MISSING` / `ENTITY_UNKNOWN` / `RELATION_UNKNOWN` / `RELATION_BUSY` / `NOT_A_WORKSPACE` / `BAD_ARGS`

## 配置（cordis.patch.yml 的插件 config，均可省略）

- `dshHome`：DSH_HOME 覆盖（缺省读 `process.env.DSH_HOME`——壳 spawn 宿主时已设置）
- `dataRoot`：无会话 cwd 时的实体目录兜底（缺省无——非会话调用 fail loud）

## profile 装配（dsh-home/profiles/web/）

1. `package.json`：
   - `dsh.profile.bundles` 数组加 `"dsh-plugin-worldsea"`
   - `dependencies` 加 `"dsh-plugin-worldsea": "link:D:/WorldSea/apps/dsh-plugin-worldsea"`
2. 重启宿主（或 Plugin Manager 里确认插件出现并启用）
3. 验证：dsh 设置「内置插件」页出现 `worldsea`；Agent 会话工具清单出现 `world_*` 十二件

## 设计依据

- D2 批计划：`docs/plans/2026-09-27-D2-Agent操作产品域-重设计批计划.md`（§2.1 能力形状 / §1.1 项目=workspace / §五 工具集第二轮）
- 插件形态对齐 `dsh-plugin-community` 先例（零依赖自包含 lib/index.js + link: 装配）
- 工具注册 = `ctx.tools.register`（ToolDefinition 形状手写，见 dsh/packages/core/tools）；指引段 = `ctx.systemPrompt.section`
