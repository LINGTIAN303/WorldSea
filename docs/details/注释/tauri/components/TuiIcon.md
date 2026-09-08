# TuiIcon 合并注释（已废弃，2026-08-10 合并入 WsIcon）

## 状态
`TuiIcon.vue` 已删除，其 30+ 个导航/工作台图标（chat、terminal、subagent、memory、sparkle、bulb、activity、chart、task 等）
迁移至 `packages/ui-kit/src/assets/icons/nav.ts`（`category: 'nav'`），统一由 `WsIcon`（`@worldsea/ui-kit`）消费。

## 合并动机
- 原存在两套并行图标系统：Tauri 端 `TuiIcon`（硬编码 path 映射）与 Web 端 `WsIcon`（注册表 + Lucide 兜底）。
- `WsIcon` 为主流（100 文件 / 477 处），`TuiIcon` 仅工作台局部使用（22 文件 / 136 处）。
- 合并后单一来源，避免两套图标重复维护、风格割裂。

## 合并规则
- 注册表中已存在的同名图标（close/check/search/edit 等）不重复注册，直接复用注册表或 Lucide 兜底。
- 仅注册表中不存在的、工作台实际用到的图标才加入 `nav.ts`，path 原样保留保证视觉不变。
- `TuiIcon` 用 camelCase 名（chevronDown/folderOpen/arrowLeft 等），`WsIcon` 用 kebab-case；迁移时已改写为 `chevron-down`/`folder-open`/`arrow-left`。

## 描边一致性
- `TuiIcon` 默认 stroke-width 1.7；`WsIcon` 默认按尺寸自动（≤16px 为 1.5）。迁移时为原依赖默认值的实例补显式 `:stroke-width="1.7"`，保证零视觉差异。
- 原显式 `:stroke-width="2"` / `="1.5"` 保持不变。
