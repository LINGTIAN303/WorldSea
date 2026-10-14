---
status: 已完成（走查通过，2026-10-14）
---

# 批 3 · theme-editor + 实体辅助对话框迁移（双 Cordis「一切皆插件」L2 第二批）

> **来源**：批 1 路线图既定（L2 分批：theme-editor → data → entity-tools → 全局件 → 设置页）；批 2 已落 overlay 贡献位，2026-10-14 用户确认执行批 3。
> 范围 = `official.theme-editor` + `official.entity-tools` 两插件，全走批 2 的 overlay 通路；三组件契约统一（`{show}` + `@close`），打开事件恰好为 `ws-open-<id>` 形态——**事件契约零改动**。

## 一、口径

| 项 | 定稿 |
|---|---|
| 事件映射 | ThemeEditor → id `theme-editor`（`ws-open-theme-editor`）；CustomRelationTypeDialog → `custom-rel-type`；EntityTemplateDialog → `entity-template`——三者与 Shell 现有事件恰好对齐 |
| 插件身份 | `official.theme-editor`（单 overlay）/ `official.entity-tools`（两 overlay）——「一个界面结构即可作为一个插件」粒度 |
| 懒加载 | 插件 index 用 `defineAsyncComponent(() => import('./xxx.vue'))` 登记——**顺带补批 2 回归**：data-tools 三面板原 Shell 侧是懒加载，批 2 静态 import 丢了，本批统一补回 |
| 启停 | DEFAULT_SPROUTS 加两条（theme-editor：icon `theme-editor`；entity-tools：icon 待选，system 组，默认开） |
| ThemeEditor 内部 | Quick/Pro/Code 三子 Tab 相对引用随目录整搬，组件内部不动 |

## 二、施工面

1. **搬家**：`components/theme-editor/`（4 文件）→ `world/plugins/theme-editor/`；`ui/entity/CustomRelationTypeDialog.vue` + `EntityTemplateDialog.vue` → `world/plugins/entity-tools/`（消费方核实：theme-editor 唯一外部消费 = Shell；两对话框唯一消费 = Shell）。
2. **两插件 index.ts**：manifest + apply 登记 overlay（defineAsyncComponent）。
3. **Shell 接线**：删 ThemeEditor/CustomRelType/EntityTemplate 挂载与 ref/handler（`ws-open-*` 事件改由 OverlayHost 消费）。
4. **DEFAULT_SPROUTS** 两条（[settingsStore.ts](../../packages/entity-core/src/stores/settingsStore.ts)）。
5. **data-tools 懒加载回归**：三面板改 defineAsyncComponent 登记。
6. **测试**：两插件登记 spec（对齐 data-tools.spec 模式：真 createPluginApi + 清理语义 + manifest 校验）。

## 三、验收门

- vue-tsc 0 · vitest 全量 · cargo 不动 · workspace-dist 重建。
- **真机走查**：
  1. 外观面板「主题编辑器」按钮 → 编辑器打开（Quick/Pro/Code 三 Tab 正常），关闭正常；
  2. 实体右键/菜单入口 → 自定义关系类型、实体模板两对话框正常；
  3. 插件关「主题编辑器」/「实体工具」→ 对应入口失效；开回恢复；
  4. 批 2 回归：三数据面板入口正常（懒加载改造后）。

## 四、边界

- WsAsk/WsConfirm/GlobalEditMenu/AppMenu 菜单项贡献化 → 批 4；SettingsDialog 及其内 StorageTab/KvViewer → 设置页最后迁；theme-editor 内部功能重构不在本批（原样迁移）。

## 五、施工记录（2026-10-14）

| 工作包 | 落点 | 说明 |
|---|---|---|
| theme-editor 整搬 | `components/theme-editor/` → [world/plugins/theme-editor/](../../apps/tauri/src/world/plugins/theme-editor)（4 文件 + index.ts） | `official.theme-editor` 单 overlay，defineAsyncComponent 懒加载 |
| entity-tools 插件 | [world/plugins/entity-tools/](../../apps/tauri/src/world/plugins/entity-tools)（2 对话框 + index.ts） | `official.entity-tools` 双 overlay（custom-rel-type / entity-template） |
| data-tools 懒加载回归 | [data-tools/index.ts](../../apps/tauri/src/world/plugins/data-tools/index.ts) | 三面板改 defineAsyncComponent（补批 2 静态 import 丢失的懒加载语义） |
| Shell 再瘦身 | [Shell.vue](../../apps/tauri/src/ui/layout/Shell.vue) | 删 ThemeEditor/CustomRelType/EntityTemplate 挂载 + ref/handler/事件注册；SettingsDialog 成为 Shell 唯一直挂业务弹窗 |
| 芽开关 | [settingsStore.ts](../../packages/entity-core/src/stores/settingsStore.ts) | DEFAULT_SPROUTS 加 `official.theme-editor`（icon theme-editor）+ `official.entity-tools`（icon puzzle），system 组默认开 |
| 测试 | `world/__tests__/batch3-plugins.spec.ts`（4） | 两插件登记/归属/清理语义（对齐 data-tools.spec 模式） |

**门禁**：vue-tsc 0 · vitest 全量 **136 文件/1207 例全绿** · cargo 不动 · workspace-dist 已重建。
**施工小事故**：PowerShell `Move-Item` 到不存在目录时按「重命名」执行（entity-tools 变成文件）——已归位；教训：move 前先确保目标目录存在（`New-Item -ItemType Directory -Force` 前置）。
