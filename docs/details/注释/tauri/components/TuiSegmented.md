# TuiSegmented 组件注释

## 职责
Tauri 端分段选择器（互斥短选项），用于模式切换、级别选择等 ≤4 项场景。

## 设计决策
- 与 TuiSelect 定位互补：分段按钮让所有选项始终可见（省一次点击），适合"模式"这类需要上下文感的切换。
- 视觉：容器 `bg-muted` 底 + 细边框，active 项白底 + 微阴影浮起——"滑轨"式选中暗示。
- `role="tablist"` + `aria-selected`，键盘与读屏友好。
- 用法与 TuiSelect 同为 v-model 契约，调用方无需记两套 API。

## 约束
- 仅用于短列表（≤4 项）；长列表用 TuiSelect。
