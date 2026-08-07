# TuiIcon 注释

## 职责
Tauri 端统一线性 SVG 图标集。集中管理全端图标（stroke 风格，24 viewBox），消除各页面内联散落的 `<path>` 定义。

## 设计决策
- 用 `name → path` 映射表替代逐个内联 SVG：保证图标风格一致（stroke-width 1.7、round 端点），且新增图标只需在表中加一项。
- 与全局令牌配合：颜色继承 `currentColor`，尺寸由 `size` prop 控制，可随按钮/标题的 `color` 自动变色。
- 图标风格与既有 Web 端 WsIcon 视觉语言对齐（线性描边），避免双端视觉割裂。

## 约束
- 只收 24 viewBox 描边图标；实心图标（如 stop 方块）用 `fill="currentColor"` 局部覆盖。
- 新增图标命名用 kebab-case 语义名，勿与既有名冲突。
