# theme.css 全局设计令牌（Tauri 产品域）

> 代码：`apps/tauri/src/styles/theme.css`（本文 = why/how；代码内只留 what 简注）
> 2026-10-24 建立——theme.css 头部注释自始指向本文件，但文件此前未创建（存量断链，本次补建）。

## 为什么集中令牌

- 色值 / 尺寸 / 动效曲线 / 层级等硬编码一旦散落组件，深浅主题切换与全局调整就要逐文件改；集中到 `:root` 的 CSS 变量后，主题只切变量值，全局自动生效。
- 主题模型已收束为「底色 × 强调色」两轴（历史见 `packages/theme-kit` 退役说明：`docs/details/注释/packages/theme-kit/index.md`）， AppearancePanel 编辑的就是这些变量。

## 分区速览

色板（中性灰底 + 克制靛蓝强调）→ 文字 → 圆角/阴影 → **布局尺寸** → **区域分割（三区双线）** → 动效（时长/缓动/按压缩放）→ **层级（z-index 统一规划）** → 加载反馈 → 遮罩/玻璃。新增令牌先进对应分区并附中文注释。

## 标题栏让位机制（--titlebar-height）

**问题**：模态遮罩多为 `position: fixed; inset: 0` 全屏定位，而 `Shell.vue` 带 `contain: layout style`——fixed 后代的包含块是 `.shell`（覆盖含 32px 窗口栏的全窗），遮罩层级（1000）又高于标题栏（100），导致弹窗打开期间窗口栏（拖拽/最小化/关闭）全部不可点。

**机制（三层，2026-10-23/24 落地）**：

1. **单一真源**：`--titlebar-height: 32px`（theme.css 布局尺寸区）；`TitleBar.vue` 高度读同一变量，遮罩读同一变量——改一处全局生效。
2. **让位写法**：模态遮罩统一 `inset: var(--titlebar-height, 32px) 0 0 0`（30+ 处）；全高抽屉面板本体（TuiDrawer / EntityDetailPanel）用 `top: var(--titlebar-height, 32px)` + `height: calc(100vh - var(--titlebar-height, 32px))`。
3. **全屏归零**：F11 绝对全屏时 TitleBar 隐藏自身并广播 `data-fullscreen='true'` 到 documentElement；theme.css 末尾全局规则 `:root[data-fullscreen='true'] { --titlebar-height: 0px }` 让所有让位遮罩/面板自动回到窗口顶，不留未压暗的缝。

**判定线（哪些覆盖层让位）**：

- **让位**：有压暗背景的模态遮罩（设置/回收站/搜索/各类弹窗等 30+ 处）+ 全高抽屉面板本体。
- **不让位**：透明点击捕获层（AppMenu / ProjectSwitcher / FolderTree / FloatingPanel——下移会把「点标题栏关下拉」变成「点标题栏操作窗口」，交互语义变化，未拍板前不动）；沉浸查看（ImageLightbox 的 0.9 近黑是刻意沉浸）；boot 启动屏（Shell 尚未渲染，无标题栏概念）；`pointer-events: none` 的纯定位层（WsAskDialog / PhonePreview popup——本就不拦截）。

**桥接映射**：旧 web 令牌 `--layout-menubar-height`（原硬编码 30px，比真实标题栏矮 2px）在 `web-tokens-bridge.css` 重映射为 `var(--titlebar-height, 32px)`——时间线的 ConflictDetector / CalendarEditorPanel 面板本体由此对齐窗口栏且全屏自动归零（桥接层职责 = 旧 web 设计令牌 → Tauri 现实）。

## 维护约定

- 组件一律 `var(--token, fallback)` 引用，禁止硬编码色值/尺寸；fallback 与令牌值保持一致（兜底 theme.css 未加载的场景，如包被独立预览）。
- 改令牌值时全局搜索该令牌的消费方确认无耦合假设（例：`--titlebar-height` 归零语义 = 全屏，消费方都按「偏移量」而非「常量高度」使用）。
