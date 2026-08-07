# TuiSelect / TuiSegmented 注释

## 职责
Tauri 端选择控件：TuiSelect（自定义下拉，替代原生 select）、TuiSegmented（分段选择器，互斥短选项）。

## 设计决策
- **TuiSelect**：原生 select 样式不可控，自定义下拉保证视觉与全局令牌一致。点击外部 / Esc 关闭；`is-sm` 档用于 header 工具栏（28px 高），`is-md` 用于表单（34px）。选中项带 check 图标，打开时 caret 旋转 180°。
- **TuiSegmented**：互斥且短列表（≤4 项）用分段按钮比下拉更直观（模型配置的 云端/本地/自定义、思考级别）。active 项白底 + 阴影浮起，体现"选中"层级。
- 两者都支持 `disabled`，均 emit `update:modelValue`（v-model 兼容）。

## 约束
- 思考级别、模式切换等原有原生 select/radio 已迁移；后续新增选择一律用本组件。
- 长列表（>6 项）优先 TuiSelect，短列表（≤4 项）优先 TuiSegmented。
