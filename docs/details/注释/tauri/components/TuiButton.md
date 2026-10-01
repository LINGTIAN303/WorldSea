# TuiButton 注释

> 位置（2026-10-01 起）：`packages/ui-kit/src/components/TuiButton.vue`（自 `apps/tauri/src/components/ui/` 下沉，
> 使 plugin-sdk 也能消费）。本档保留在原路径以维持既有引用。

## 职责
全仓**唯一**按钮组件，消除各视图按钮样式分叉（此前 App/SubAgent/Terminal/Memory 各自手写按钮 CSS；
2026-10-01 进一步收编跨文件重复的 `.btn/.btn-ghost/.btn-danger/.btn-primary/.btn-secondary/.btn-sm` 族）。

## 2026-10-01 全仓统一（按钮族收编）
- **下沉 ui-kit** + `active` 属性（切换类按钮的当前态：accent 描边 + 浅底 + `aria-pressed`）。
- **旧族映射**：`.btn-ghost/.btn/.btn-secondary`→`secondary`；`.btn-danger`→`danger-ghost`；`.btn-primary`→`primary`；
  `.btn-sm`→`size="sm"`；`:class="{active}"`→`:active`；图标改走 `icon` prop（保留 gap 语义）。
- **基座复位**：`theme.css` 加 `button{color:inherit}`（UA 的 `color:buttontext` 不继承 → 未写 color 的按钮暗色下黑字）。
- **删除**：7 处本地族定义 + 过渡件 `toolbar-buttons.css`（scoped src 方案被本批取代）。
- **刻意例外（登记）**：单文件私有族不迁（`sfa-/efm-/be-/vh-/de-/tm-/lm-/cp-/en-/set-/fpv-/ftb-/pptx-` 等，各只定义一次、
  无跨文件重复）；区域 `.btn-view`（36px 方形视图模式切换）保留自有几何。

## 设计决策
- **变体体系**：primary（主操作）/ secondary（次操作描边）/ ghost（弱操作）/ danger（危险实心）/ danger-ghost（危险描边）。危险操作默认用描边（弱化强提示），hover 才转实心。
- **按压回弹**：`:active` 用 `--ease-spring` 缩放到 0.97，给点击一个克制的"手感"，非生硬变色。
- **尺寸档位** sm（28px，工具栏）/ md（34px，表单）；`loading` 态显示旋转 dots 并禁用。
- 图标经 `icon` prop 前置（内部用 WsIcon），文字用默认插槽。

## 约束
- 新增操作按钮一律用本组件；禁止自写 padding/border 拼按钮（样式已收敛）。
- 语义色只表达状态（danger=删除类），不要用彩色按钮装饰界面。
