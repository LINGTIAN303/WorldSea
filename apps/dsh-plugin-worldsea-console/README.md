# dsh-plugin-worldsea-console

WorldSea 产品域**管理面**（内置级 dsh 插件）——dsh 设置「内置插件」里的「WorldSea 插件」标签页（WorldSea 插件集中清单）+ 独立设置分区「WorldSea 产品域」（产品域 ↔ dsh 交界配置）（D3，2026-09-28；2026-10-07 拆分双槽位）。

与 [dsh-plugin-worldsea](../dsh-plugin-worldsea/README.md)（Agent 工具面，12 条 world_* 工具）**职责分治**：本插件不含任何工具，只承载管理 UI 与配置桥——工具面与管理面的变化节奏、风险面不同，分容器隔离。

## 形态

- **宿主半**（`lib/index.js`）：空 apply 占 Loader 行（对齐 dsh `ui-settings-shell` / `ui-settings-plugin-inventory` 先例）。
- **客户端半**（`lib/client.js`）：**手写闭包工厂产物**（`window.__ModuleLoader__.load({id, factory})`，external 经 loader 模块表 require——种子表含 react 全家，见 `dsh/packages/client/web/src/platform.ts`）。零构建链、零 dsh 内部依赖，直接入库，追版免疫。
- 装载：profile `bundle` + `link:` junction（三坑先例见 worldsea 插件 README）。

## 设置页内容（两个注册面）

### ① 「WorldSea 插件」标签页（`settings.plugins.tab`，id `worldsea-console`）

WorldSea 插件集中清单（卡片形态对齐「插件列表」页；点卡片展开详情）。当前两张卡：

| 卡片 | 内容 |
|---|---|
| `worldsea`（工具面） | 条目/模块/工具/能力面事实行 + **插件数据面配置**（dshHome/dataRoot）——**卡内可编辑**：真源在**本插件**的 config（worldsea 预设化后自身 config 退出设置面枚举，编辑入口绑本插件命名空间 `worldsea-console`），经 configForms + 上游 SettingsForm/SettingsFormModel 写盘落 profile 补丁层，**worldsea 侧经服务桥每次现取、保存即生效**；「覆盖中」由 user 层**存在性**判定。**未覆盖时另显示壳注入的缺省生效值**（D3-c2b：`__WORLDSEA_DSH_HOME__`，壳把解析后的 DSH_HOME 经注入面透传；非壳环境/覆盖中不显示） |
| `worldsea-console`（管理面） | 条目/模块事实行（即本插件；渲染中即运行中，不带状态标签） |

新增 WorldSea 插件时：往 `lib/client.js` 的 `PLUGINS` 数组加一行 + 字典补文案即可。

### 服务桥（宿主半，2026-10-07）

宿主半从「空 apply 占行」升级为带 `Config`（dshHome/dataRoot，均 volatile）的真宿主插件：
apply 里 `ctx.reflect.provide('worldseaDataFace', { dshHome(), dataRoot() })` 暴露数据面现值——
worldsea 预设子实例（「产品域模式」预设，见 [dsh-plugin-worldsea](../dsh-plugin-worldsea/README.md)）
经作用域继承**软访问**（`ctx.worldseaDataFace?.`，不进 inject），每次工具调用现取。
方法返回 `string | null`（空串归一 null = 未设置）。worldsea 缺失本服务时回落其自身 config / env
（单独部署兼容），故两插件不互为装载前提。

### /entity 全局快捷指令（纯插件形态，2026-10-07 三版迭代定稿）

**形态 = 客户端贡献位 + 壳 IPC，零 dsh 源码改动**（用户拍板路线 B，落实 dsh「一切皆插件」）：

- **菜单行与行为 = 客户端贡献位**（`ctx.commandUi.register`，本插件客户端半）——`label`（中文名「实体」）/
  `description`（短提示）/ `icon`（IconGlobeOutlineRegular——世界图形，呼应 WorldSea 语义；**注意避开
  IconDataOutlineRegular：那是「模型」指令的图标**）**原生支持**，渲染层在 label ≠ 注册名时自动
  补英文别名 `entity`，与内建指令行样式对齐；`available: () => true` → **全预设可用**（用户口径）。
- **行为 = 取事实 → 弹卡**（只读，不触发模型轮次）：`ui: { kind: 'action', run }` → 壳 IPC
  `cmd_product_briefing`（Rust `product_briefing.rs`：**只出结构化事实**，`kind` 码 + 数值；
  当前项目 = 注册表默认项目标记，worlddata 计数与工具面同源）→ `shell.overlay` 槽位 Modal 弹卡
  （状态桥 `createSnapshotStore` 三态 loading/ready/error；文案全部在客户端组装，改措辞不重编译 Rust）。
- **迭代留档**：v1 宿主指令注册在 worldsea 插件（预设子实例 → 仅产品域模式可见，不合「全预设」口径）；
  v2 迁 console 宿主 + 曾引入 dsh fork 改动 `commandUi.face()` 挂呈现面——**同日改判 v3 整体撤出**
  （客户端贡献位原生有图标/中文名，呈现面无需动 dsh；fork 台账留「曾登记已撤」记录；行为链路改走壳 IPC，
  因贡献位行为只能在客户端而就绪卡需读工作区文件 → 壳 `cmd_product_briefing` 提供数据面）。
- **可用性提示**：弹卡含一行「world_* 工具仅产品域模式会话挂载」的说明（全预设提示口径；
  预设分流判断已不需要——提示语对两种模式都成立）。

### ② 「WorldSea 产品域」独立分区（`settings.section`，id `worldsea-product`，order 25）

原「WorldSea 产品域」标签页的交界配置迁此（2026-10-07）：

| 组 | 真相源 | 行为 |
|---|---|---|
| 说明书与指针 | 壳偏好 `product_domain.manualGeneration / agentsPointer` | 壳启动**及保存时**在工作区根幂等生成 WORLDSEA.md / 薄指针 AGENTS.md（已存在绝不覆盖；薄指针经 dsh agent-instructions 自动注入会话） |
| 快照策略 | 壳偏好 `product_domain.snapshotExport`（auto/off） | 工作台 boot.ts 导出门：off 时不再导出 schema 快照（Agent 写校验 fail loud 提示先开工作台） |

壳命令：`cmd_product_prefs_get` / `cmd_product_prefs_set` / `cmd_product_briefing`（Rust 侧
`app_prefs.rs` + `product_briefing.rs`；ACL = `worldsea-shell.toml` 两窗共用）。

## 客户端半机制要点（供维护）

- 包声明 `dsh.client.platform: 'web'` + `exports["./client"]` → client-modules 扫描收录（`dsh/packages/client/modules/src/client/manifest.ts`）。
- 标签页注册 = `ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({name, id, order, label, locale, inject}, Component))`；独立分区注册 = `ctx.slots.inject('settings.section', () => ctx.slots.register({name, id, order, label, locale}, Component))`（order 25 排在内置四页 0/10/15/20 之后）；指令贡献位 = `ctx.commandUi.register`（客户端根服务，ui-commands 包提供）；弹层挂载 = `ctx.slots.register('shell.overlay', …)`（根级列表槽，ui-chat 配额提示先例）；locale 字典 `ctx.locale.register(NS, {zh, en})`（NS = `settings.worldseaConsole`）。
- dsh 页调壳命令 = `globalThis.__TAURI_INTERNALS__.invoke(command, args)`（与壳注入的 shell_bridge 同链路）。

## 设计依据

- D3 批计划：`docs/plans/已完成/2026-09-28-D3-产品域设置页批计划.md`（五理由 / 拆两插件拍板 / 真相源草案 / 待验证核实）
- 2026-10-07 拆分：交界配置出「内置插件」Tab、Tab 让位给插件集中清单（用户拍板：独立设置分区 / 数据面配置留卡片内）
- 先例：`dsh/packages/client/ui-settings-plugin-inventory`（tab 贡献者 + 卡片形态）/ `ui-settings-shell`（configForms 卡片 + 空 apply 占行）/ `ui-agent-preset`（settings.section 注册）
