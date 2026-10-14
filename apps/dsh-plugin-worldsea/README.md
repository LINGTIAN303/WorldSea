# dsh-plugin-worldsea

WorldSea 产品域工具集（dsh 插件）——让 Agent 以**原生工具**直接读写工作台创作数据。工具对象按 ToolDefinition 形状手写（不需 import cordis 包）；唯一第三方 import = `@deepseek-ai/schemastery`（配置 schema，D3-c2）。

**能力面（2026-10-07 预设化）**：本插件不是全局挂载，而是**「产品域模式」预设的能力组成**（见 cordis.patch.yml）——world_* 十七件工具只在产品域模式会话可用，其余预设（标准/PTC/极简/创造）里不可见。升级信号与判据见 D2 批计划 §候选5-1（非产品域模式里只能靠 `/实体` 强制使用、指引互扰）。

## 工具集（12 条数据 + 5 条外部插件管理）

| 工具 | 用途 |
|---|---|
| `world_project_list` | 项目清单（项目 = dsh 工作区，同源模型） |
| `world_project_current` | 当前项目（会话 cwd 对齐到的 dsh 工作区） |
| `world_schema_get` | 实体类型的字段 schema（type 省略 = 全部；组装实体前先取；单类型返回附 snapshotGeneratedAt） |
| `world_entity_list` | 实体清单（瘦身 id/type/name；type 过滤；limit/offset 分页 + total 回显；排序契约 = updatedAt 降序→id 升序） |
| `world_entity_search` | 按关键词搜实体（匹配 name/description + tag 标签过滤；分页 + 排序契约，与 list 对齐） |
| `world_entity_get` | 实体数据（可选 fields 点路径数组按需取字段减载荷；id/type 恒返回） |
| `world_entity_put` | 新建实体（schema 快照轻校验：类型存在 + 必填字段） |
| `world_entity_update` | 按 id 局部更新（changes.properties 缺省整包替换，mergeProperties=true 按字段合并） |
| `world_entity_delete` | 按 id 删除（对齐工作台原子删除语义：同时清理关联关系） |
| `world_relation_list` | 关系清单（entityId/type 过滤；瘦身默认形状 id/type/sourceId/targetId/label，properties 等按需 fields 点路径取；分页 + 排序契约） |
| `world_relation_put` | 新建/覆盖关系（两端实体必须已存在） |
| `world_relation_delete` | 按 id 删除关系 |
| `world_plugin_list` | 外部插件清单（worlddata/.worldsea/plugins/ 下 <id>.js：id/大小/mtime） |
| `world_plugin_read` | 读外部插件完整源码 |
| `world_plugin_write` | 写入/覆盖外部插件（`(require) => ({ manifest, apply })` 闭包工厂；id 须 ws. 前缀；原子写；**工作台 ~1s 自动热装载**——新增界面结构/功能的标准途径） |
| `world_plugin_delete` | 删除外部插件（工作台 ~1s 自动卸载） |
| `world_plugin_template` | 返回最小插件模板（write 的 code 素材） |

## 快捷指令 /entity（2026-10-07 三版迭代定稿 · 由 console 插件以纯插件形态承载）

人面向斜杠指令 `/entity`：**实体工作就绪卡**（当前项目/schema 快照/数据概况/可用性提示）。终态 =
**console 插件客户端贡献位 + 壳 IPC**（`commandUi.register` 原生支持图标/中文名/短提示、全预设可用；
行为走壳 `cmd_product_briefing` + Modal 弹卡），**零 dsh 源码改动**。本插件三次让位（宿主指令注册 →
迁 console 宿主 → 整体撤出）的迭代留档与机制详解见
[dsh-plugin-worldsea-console](../dsh-plugin-worldsea-console/README.md)。本插件不再注册指令。

## 执行体与通知

- 数据真相 = `<会话 cwd>/worlddata/` 透明 JSON（与工作台 FileStorageBackend 同源）；实体目录 `entities/<type>/<名>_<id>.json`
- 外部写入经工作台 **FsWatcher** 天然刷新 UI（外部写入不进自身写入静默期）——零通知通道
- schema 快照 = `worlddata/.worldsea/schema-snapshot.json`（工作台启动/重播种时导出；`.worldsea/` 目录被 watcher 忽略，不抖 UI）。快照为静态副本：会话中途 schema 变更不推送（schema = 代码内置注册表，低频），`world_schema_get` 单类型返回附 `snapshotGeneratedAt` 供 Agent 感知时效

## 并发与原子性（D2 第二轮，2026-09-28）

- 插件侧关系写（put/delete/实体删除的关联清理）统一走 `mutateRelations`：`.worldsea/relations.lock` 目录锁互斥（mkdir 原子性；锁内 `holder.pid` 记持有方进程——活持有等满 8s fail loud，死残留立即接管自愈，60s 硬过期兜底）+ 临时文件同卷 rename 原子替换
- **已知边界**：工作台（webview）侧写不走此锁——跨端同时写的窄窗口未做跨进程协同（低频：需用户恰在界面编辑关系时 Agent 也在写关系）
- 大项目保护：`world_entity_list` 缺省 200 条上限，`total` 超过 `items` 长度即有更多，用 `offset` 翻页
- **清单排序契约（第四轮，2026-09-28）**：entity list/search 与 relation list 统一按 `updatedAt` 降序 → `id` 升序稳定排序——分页跨页不重不漏的确定性基准；瘦身输出不携带排序键

## 环境自适应与写前守卫（D2 第三轮，2026-09-28）

- **空结果环境化**：`world_entity_list` / `world_entity_search` / `world_relation_list` 空结果附 `state` 字段——`uninitialized` = worlddata 不存在（工作台从未打开过，提示用户先开一次工作台）· `empty` = 已初始化但暂无数据；有数据时不附该字段
- **写前工作区守卫（严格拒）**：五个写工具（entity put/update/delete · relation put/delete）要求会话 cwd 正好是某个已登记 dsh 工作区的根目录，否则拒 `WORLDSEA_NOT_A_WORKSPACE`（cwd 在某工作区内部非根同样拒——创作数据以工作区根的 worlddata/ 为准）；读操作不拦；`config.dataRoot` 兜底属显式配置不受限
- **fail loud 三段式错误码**（码 + 人话 + 补救）：`WORLDSEA_NO_SESSION` / `NO_DSH_HOME` / `NO_SCHEMA_SNAPSHOT` / `TYPE_UNKNOWN` / `REQUIRED_MISSING` / `ENTITY_UNKNOWN` / `RELATION_UNKNOWN` / `RELATION_BUSY` / `NOT_A_WORKSPACE` / `BAD_ARGS`

## 配置（cordis.patch.yml 的插件 config，均可省略；**schema 见 lib/index.js 的 `Config`**）

- `dshHome`：DSH_HOME 覆盖（缺省读 `process.env.DSH_HOME`——壳 spawn 宿主时已设置）
- `dataRoot`：无会话 cwd 时的实体目录兜底（缺省无——非会话调用 fail loud）

两字段均声明 `.volatile()`（**设置面写入门槛要求 volatile**，`settings/settings/src/index.ts:383-385`）。

**取值链（2026-10-07 预设化换源）**：`dshHome` / `dataRoot` 的**真源在 console 插件**（worldsea-console，
顶层常驻）——本插件预设化后不是顶层装载行，自身 config 不在设置面枚举范围（`configEditor.entries()`
只认顶层行）。生效顺序：**console 服务桥 `worldseaDataFace`（设置面「内置插件 → WorldSea 插件」Tab
的 worldsea 卡片编辑，保存即生效）> 本插件自身 config（预设子行覆盖 / 单独部署兜底）**；dshHome
再回落 `process.env.DSH_HOME`。服务桥为软访问（`ctx.worldseaDataFace?.`，不进 inject）——console
缺失时优雅回落，两插件不焊死装载依赖。

**★ 实现约束（实测踩到）**：volatile 字段物化后**不是原值**，而是 cosmokit 的 `Volatile<T>` 句柄
（`{ get() }`）——读它必须经 `configText()`（`lib/index.js`），否则句柄会被当路径用。普通字段仍是原值。

## profile 装配（dsh-home/profiles/web/）

**生产形态（安装器分发）**：壳首启由 `dsh_bootstrap::ensure_product_profile` 幂等装配（bundles
合并添加 + link 指向随包 `dsh-runtime/dsh/node_modules`），无需任何手工步骤——本节余下内容
仅适用 dev 手工装配。链路全貌见 [dsh-bootstrap.md](../../docs/details/注释/tauri/dsh-bootstrap.md)。

1. `package.json`：
   - `dsh.profile.bundles` 数组加 `"dsh-plugin-worldsea"`（本插件的 patch 层随之生效——**预设声明就在这个 patch 里**）
   - `dependencies` 加 `"dsh-plugin-worldsea": "link:D:/WorldSea/apps/dsh-plugin-worldsea"`
2. 重启宿主（或 Plugin Manager 里确认插件出现并启用）
3. 验证：dsh 设置「Agent 预设」页出现「产品域模式」（order 5）；Agent 预设按会话组成的产品域会话工具清单出现 `world_*` 十二件；**其余预设的会话里 world_* 不可见**

## 预设化（2026-10-07）

- **形态**：`cordis.patch.yml` 撤销顶层 worldsea 行、插入 `preset-worldsea`（`@deepseek-ai/dsh-agent-preset`）——能力组成 = **dsh 标准模式花名册全量复制 + worldsea 子行**（dsh 预设无继承机制，标准/ptc/minimal/cordis 彼此也是整份复制）。
- **★ 追版纪律**：dsh 追版若改动 `presets/standard.patch.yml` 花名册，必须同步本插件 patch——`__tests__/patch.spec.ts` 的「花名册与标准预设全量一致」用例会自动报警。
- **会话语义**：预设 = 会话创建时绑定的能力组成器，不可中途换；存量会话维持原预设不受影响，新会话按所选预设获得（或不获得）world_* 工具。

## 设计依据

- D2 批计划：`docs/plans/2026-09-27-D2-Agent操作产品域-重设计批计划.md`（§2.1 能力形状 / §1.1 项目=workspace / §五 工具集第二轮 / §候选5-1 预设化形态备案）
- 插件形态对齐 `dsh-plugin-community` 先例（自包含 lib/index.js + link: 装配）；D3-c2 起多一条 `@deepseek-ai/schemastery` 的 `link:` 依赖（配置 schema 所需，见「配置」节）
- 工具注册 = `ctx.tools.register`（ToolDefinition 形状手写，见 dsh/packages/core/tools）；指引段 = `ctx.systemPrompt.section`
- 预设声明 = `@deepseek-ai/dsh-agent-preset` Loader 行（对齐 dsh `packages/bundle/web-app/presets/*` 先例）；服务桥 = `ctx.reflect.provide`（cordis 服务机制，消费方经作用域继承软访问）
