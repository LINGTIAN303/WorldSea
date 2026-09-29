# dsh-plugin-worldsea-console

WorldSea 产品域**管理面**（内置级 dsh 插件）——dsh 设置「内置插件」分区里的「WorldSea 产品域」标签页 + 产品域 ↔ dsh 交界配置桥（D3，2026-09-28）。

与 [dsh-plugin-worldsea](../dsh-plugin-worldsea/README.md)（Agent 工具面，12 条 world_* 工具）**职责分治**：本插件不含任何工具，只承载管理 UI 与配置桥——工具面与管理面的变化节奏、风险面不同，分容器隔离。

## 形态

- **宿主半**（`lib/index.js`）：空 apply 占 Loader 行（对齐 dsh `ui-settings-shell` / `ui-settings-plugin-inventory` 先例）。
- **客户端半**（`lib/client.js`）：**手写闭包工厂产物**（`window.__ModuleLoader__.load({id, factory})`，external 经 loader 模块表 require——种子表含 react 全家，见 `dsh/packages/client/web/src/platform.ts`）。零构建链、零 dsh 内部依赖，直接入库，追版免疫。
- 装载：profile `bundle` + `link:` junction（三坑先例见 worldsea 插件 README）。

## 设置页内容（三组交界配置）

| 组 | 真相源 | 行为 |
|---|---|---|
| 说明书与指针 | 壳偏好 `product_domain.manualGeneration / agentsPointer` | 壳启动**及保存时**在工作区根幂等生成 WORLDSEA.md / 薄指针 AGENTS.md（已存在绝不覆盖；薄指针经 dsh agent-instructions 自动注入会话） |
| 快照策略 | 壳偏好 `product_domain.snapshotExport`（auto/off） | 工作台 boot.ts 导出门：off 时不再导出 schema 快照（Agent 写校验 fail loud 提示先开工作台） |
| 插件数据面 | worldsea 插件 cordis config（dshHome/dataRoot） | **页内可编辑**（D3-c2，2026-09-30）：经 configForms 绑定条目 id `worldsea` + 上游 SettingsForm/SettingsFormModel；写盘落 profile 补丁层，插件下次调用即生效；「覆盖中」由 user 层**存在性**判定 |

壳命令：`cmd_product_prefs_get` / `cmd_product_prefs_set`（Rust 侧 `app_prefs.rs`；ACL = `worldsea-shell.toml` 两窗共用）。

## 客户端半机制要点（供维护）

- 包声明 `dsh.client.platform: 'web'` + `exports["./client"]` → client-modules 扫描收录（`dsh/packages/client/modules/src/client/manifest.ts`）。
- 标签页注册 = `ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({name, id, order, label, locale, inject}, Component))`；locale 字典 `ctx.locale.register(NS, {zh, en})`（NS = `settings.worldseaConsole`）。
- dsh 页调壳命令 = `globalThis.__TAURI_INTERNALS__.invoke(command, args)`（与壳注入的 shell_bridge 同链路）。

## 设计依据

- D3 批计划：`docs/plans/2026-09-28-D3-产品域设置页批计划.md`（五理由 / 拆两插件拍板 / 真相源草案 / 待验证核实）
- 先例：`dsh/packages/client/ui-settings-plugin-inventory`（tab 贡献者）/ `ui-settings-shell`（configForms 卡片 + 空 apply 占行）
