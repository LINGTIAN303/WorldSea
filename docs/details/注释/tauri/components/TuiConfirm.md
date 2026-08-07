# TuiConfirm 注释

## 职责
Tauri 端确认对话框，替代原生 `window.confirm`（原生弹窗破坏应用视觉与风格统一）。

## 设计决策
- 基于 TuiModal 的 sm 档，`maskClosable=false` + 无关闭按钮：确认类操作强制用户做出明确选择。
- **danger 变体**：危险操作（删除/清空）确认按钮用 danger 红，普通确认用 primary；视觉上弱化"强警告"感，仅用语义色提示。
- **组件式 API**：`v-model:show` + `@confirm` / `@cancel`。父级持有 `onConfirm` 回调，异步操作可配合 `loading` 禁用防重复提交。
- 取消时同时 emit `update:show(false)` 与 `cancel`，父级任选其一消费。

## 约束
- 项目中禁止再出现 `window.confirm` / `window.alert`（SubAgentView 删除规格、清空实例已迁移）。
