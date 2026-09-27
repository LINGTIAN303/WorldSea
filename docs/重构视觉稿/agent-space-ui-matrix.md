# Agent 空间 UI/UX 前端面矩阵盘点

> 版本：v1.1 · 2026-08-20（v1.0 基线审计 + F 节 P0-P2 全部修复回填）
> 范围：**Agent 空间（单聊模式）视觉层全前端面**——含右侧执行/配置面板、agent 面板、shared-ui 消息渲染链路。
> **排除**：群聊空间（`space/group-chat/`、`GroupChatView`、`GroupMessageBubble`、`CasualChatView`、`GroupChatSetup` 等全部不在本文档范围内）。
> 用途：作为 Agent 空间 UI/UX 升级的基础地图与验收依据，用户据此逐条发起升级任务。
> 说明：矩阵列结构统一为 `组件/文件 | 职责 | 形态与尺寸 | 设计 token | 图标 | 交互与 a11y | 已知问题`（个别表增减列，但保留「组件/文件」「已知问题」）。文件引用形式 2 可点击；目录/清单用形式 1。

---

## 目录

- [A. 壳层矩阵](#a-壳层矩阵)
- [B. 对话面矩阵](#b-对话面矩阵)
- [C. 面板矩阵](#c-面板矩阵)
- [D. 设置与杂项矩阵](#d-设置与杂项矩阵)
- [E. 设计系统矩阵](#e-设计系统矩阵)
- [F. 问题清单矩阵](#f-问题清单矩阵)
- [G. 输出事件流引擎（2026-08-21 重构）](#g-输出事件流引擎2026-08-21-重构)

---

## A. 壳层矩阵

> 布局基准已与 [agent-space-layout.md](../details/前后端/agent-space-layout.md) 交叉核对（窗口栏 32px / 顶栏 48px / 主区 gap 8px padding 8px / 三栏宽度 200–400 与 240–560 / 双线分隔规范）；与本矩阵差异处已就地标注。

### A.1 主壳结构（AgentSpace）

| 组件/文件 | 职责 | 形态与尺寸 | 设计 token | 图标 | 交互与 a11y | 已知问题 |
|---|---|---|---|---|---|---|
| `AgentSpace.vue` | Agent 空间主壳：窗口栏 + 顶栏 + 三栏主区（会话/主对话/右侧面板） | 纵向 flex column `100vh`；`.space-body` 行向 `gap:8px` `padding:8px`；`.agent-space` 底 `--bg-muted` | `--bg-muted`、`--color-border`、`--radius-md(10px)`、`--color-surface-elevated` | 右侧面板 Tab 用 WsIcon chart/settings/close | resize-handle 6px 拖拽（rAF 节流）；`#agent-space-main` tabindex=-1 可聚焦 | 面板滑入/滑出动画（`.sidebar-slide-*`/`.panel-slide-right-*`）未进 reduced-motion 集中文件（全局 transition-duration 压缩覆盖，位移距离未消除） |
| [TitleBar.vue](../../apps/tauri/src/ui/layout/TitleBar.vue) `variant="space"` | 窗口栏精简变体：拖拽区 + 居中标题 + 窗口控制三键 | 32px 固定高度；下边框 1px；`data-tauri-drag-region` | 全局 theme.css 令牌 | 窗口控制为系统原生按钮 | 拖拽区为 Tauri 窗口拖拽 | 标题随模式动态（「Agent 空间 / 群聊空间」） |
| `.session-panel`（AgentSpace 内） | 会话栏独立块 | 宽 200–400px（默认 260）；`border:1px` `radius-md`；右侧 resize-handle | `--color-border`、`--radius-md`、`--color-surface-elevated` | — | 拖拽收起阈值 180px | 双线分隔已满足（独立块 + 8px 缝隙） |
| `.space-main`（AgentSpace 内） | 主对话区独立块 | `flex:1` `min-width:0`；`border:1px` `radius-md` | 同上 | — | 内嵌 SpaceChat / GroupChatView | — |
| `.right-panel`（AgentSpace 内） | 右侧面板独立块（执行/配置 合并） | 宽 240–560px；`border:1px` `radius-md`；`contain` `will-change` | 同上 | 右 Tab：chart/settings；关闭 close | `.right-tab` 下划线指示条 2px 主色；子 Tab（记忆/人格）`.right-subtab` 同款 | 双层下划线 Tab（Level-1 + Level-2）层级靠字号区分，无 role=tablist 语义 |

### A.2 顶栏（SpaceNavbar）

| 组件/文件 | 职责 | 形态与尺寸 | 设计 token | 图标 | 交互与 a11y | 已知问题 |
|---|---|---|---|---|---|---|
| `apps/tauri/src/space/SpaceNavbar.vue` | 顶栏导航：左（身份+模式+场景）/ 中（模式切换+新建+会话名）/ 右（面板开关+更多） | 48px；`padding:0 16px`；`gap:12px`；`z-index:100` | `--bg-muted` | — | — | 顶栏无独立边框（由主区 padding 分隔） |
| `PanelToggle.vue` | 侧边栏开关 | 32×40px；`--radius-sm` | `--color-text-secondary`、`--color-primary` | WsIcon（双面翻转） | `aria-label`、`aria-pressed` | — |
| `.agent-identity`（SpaceNavbar） | Agent 身份（头像+名字+状态） | 头像 32px；`gap:10px` `padding:4px 8px` | `--font-size-sm/xs`、`--color-text(-secondary)` | 状态 moodIcon WsIcon xs | 点击开 PersonaMirror popover；`.agent-avatar:hover` scale 1.08（reduced-motion 已处理） | — |
| `.mode-segmented`（TuiSegmented） | 单聊模式滑块：深度思考/知识探索/任务执行 | item `padding:4px 10px` `font-size-xs` | `--font-size-xs`、Tui 内部 token | icon-mode 图标常驻 | TuiSegmented 分段滑块语义 | 单聊三模式（快问快答已移除 2026-08-12） |
| `.scene-select`（SpaceNavbar） | 场景选择器（默认 worldbuilding） | `gap:4px`；TuiSelect size=sm | `--color-text-secondary` | globe WsIcon xs | 切换场景即新建会话 | — |
| `.mode-switch`（SpaceNavbar） | 单聊 ⇄ 群聊 胶囊切换 | 24px 高 `radius:999px`；`::after` 填充层 scale 动画 0.5s（hover 扩散空心） | `--switch-bg`、`--switch-fg`、`--text-primary`、`--color-accent-soft` | chat/users WsIcon xs | `role="button" tabindex="0"` + Enter/Space | `.mode-switch::after` 填充扩散动画**未在 scoped reduced-motion 覆盖**（全局压缩过渡但位移感仍在） |
| `.new-session-btn`（SpaceNavbar 中区） | 新建会话 | 20×20px `--radius-xs` | `--font-size-sm`、`--color-text-secondary` | **文本字形 `+`** | button 语义 | 新建按钮用文本 `+` 而非 WsIcon plus |
| `.current-session` | 当前会话名 | `font-size-2xs` 140px 截断 | `--fs-2xs`、`--color-text-tertiary` | — | — | — |
| `.nav-btn`（右侧栏） | 右侧面板开关 + 运行徽标 | 32×32px `--radius-sm`；`.nav-badge` 6px 红点 `nav-badge-pulse 1.6s` | `--color-primary-muted`、`--danger` | panel-right-open/close WsIcon sm | `:focus-visible` 环；badge 呼吸动画 scoped reduced-motion 已停 | — |
| `.more-menu` | 更多菜单（全局设置入口） | `min-width:180px`；玻璃态 `blur(16px)`；`radius-md` | `--color-surface-elevated`、`--color-border`、`--radius-md` | more-horizontal/pencil WsIcon | 锚定定位 + backdrop | — |
| `.persona-popover` | 人格镜弹出层 | 340px `max-height:70vh`；玻璃 `rgba(10,10,20,0.08)` blur16；`radius-2xl` | `--color-border`、`--radius-2xl` | — | 锚定身份下方；overlay 点击关闭 | — |

### A.3 会话栏（SessionSidebar）

| 组件/文件 | 职责 | 形态与尺寸 | 设计 token | 图标 | 交互与 a11y | 已知问题 |
|---|---|---|---|---|---|---|
| `SessionSidebar.vue` | 会话列表 / 知识库 双 Tab 侧边栏 | 100% 高；背景交给外层 `.session-panel` | `--color-border`、`--font-size-*` | clipboard-list/book WsIcon sm；关闭 close | `.sidebar-tab` 下划线指示条 2px 主色 | — |
| `.sidebar-new-row` `.new-session-btn` | 新建会话 | 28×28px 虚线边框 `--radius-sm` | `--color-primary(-muted)` | **文本字形 `+`** | hover 变主色 | 文本 `+` 而非 WsIcon |
| `.search-input` | 会话搜索 | 原生 input；`padding:6px 10px` `--radius-sm` | `--color-border`、`--color-surface-elevated` | — | focus 主色边框 | 原生 input（非 TuiInput） |
| `.session-item` | 会话列表项（已固定/近期分组） | `padding:8px 10px` `--radius-mid` | `--color-surface-elevated`、`--color-primary-muted` | — | `role="button" tabindex aria-current` + Enter/Space；重命名内联 input | 双击重命名无键盘提示；`.session-mode-badge` 为**遗留未用 CSS**（硬编码 #6ea8fe/#b478ff/#50c8a0） |
| `.session-ctx-menu` | 会话右键菜单 | Teleport 固定；`min-width:140px` `radius-mid` | `--color-surface-elevated`、`--color-danger` | — | 边界翻转定位 | 用 document click 关闭（非焦点逃逸） |

### A.4 弹出层矩阵（Agent 空间内）

| 弹出层 | 载体 | 尺寸 | 形态 | 触发 | 已知问题 |
|---|---|---|---|---|---|
| persona-popover | SpaceNavbar → PersonaMirror | 340px / 70vh | 玻璃 blur16、radius-2xl、锚定 | 点击 Agent 头像 | — |
| more-menu | SpaceNavbar | min-width 180px | 玻璃、radius-md、锚定 | 更多按钮 | 单条目（全局设置） |
| summon-menu | ChatInput → `SummonMenu.vue` | 360px | 固定定位、Teleport | 输入 `#/~//!/！/@` | 需单独核对键盘导航与空态 |
| model-dropdown | ModelSwitcher | min-width 200px / 70vh | 玻璃、radius-md、listbox | 模型胶囊 | 见 B.3 |
| session-ctx-menu | SessionSidebar | 140px | 卡片、radius-mid | 右键会话项 | — |
| video-fullscreen-overlay | BlockVideo | 全屏 | 遮罩 + 关闭按钮 | 视频放大 | 见 B.7 |

---

## B. 对话面矩阵

### B.1 主对话区（SpaceChat）

| 组件/文件 | 职责 | 形态与尺寸 | 设计 token | 图标 | 交互与 a11y | 已知问题 |
|---|---|---|---|---|---|---|
| `SpaceChat.vue` | 单聊主对话区：消息列表 + 输入框 | flex column 100%；`.chat-input-dock` 初始居中→首条消息后下沉（transform 0.35s） | `--color-primary` 等 | — | `.sr-only` aria-live 播报生成开始/完成（WCAG 4.1.3）；`aria-busy` | 输入框下沉动画 transition 走全局压缩，未单独 reduced-motion |
| AgentMessageList | 消息列表（见 B.4） | `--chat-gutter` 限宽 860px | — | — | — | — |
| ChatInput | 输入栏（见 B.2） | 见 B.2 | — | — | — | — |

### B.2 输入栏（ChatInput）

| 组件/文件 | 职责 | 形态与尺寸 | 设计 token | 图标 | 交互与 a11y | 已知问题 |
|---|---|---|---|---|---|---|
| `ChatInput.vue` | 双层输入框（胶囊输入区 + 常驻工具栏） | `.chat-input-box` 宽 `min(55%, 100%-32px)`；`radius-2xl`；`.input-capsule` 固定 70px（textarea 54px 3 行） | `--color-surface-elevated`、`--color-border`、`--color-primary(-muted)`、`--radius-2xl` | 大量 WsIcon | textarea aria-label；focus 2px 主色环；`contain` 性能优化 | chip 色 fallback 硬编码（见 F.3） |
| `.chip`（chips-area） | 召唤 chips（/技能 @引用 + 知识注入） | `padding:2px 6px 2px 8px`；`radius-md` | `--color-primary-muted`、`--color-primary`；chip-reference/chip-pipeline 用 `color-mix` + fallback | x WsIcon xs（chip-remove）；file WsIcon xs（kb） | chip-remove `aria-label` | fallback `#3b82f6/#10b981/#d97706` 硬编码 |
| `.attachments-preview` | 附件预览（图片/文件） | `.att-item` `padding:4px 8px` `radius-2xl` | `--color-surface`、`--color-border` | file WsIcon xs；x WsIcon xs（att-remove） | att-remove aria-label | 图片缩略 32px |
| `.textarea-wrap` `.ph-overlay` | 输入 + 占位符轮播（3s 切换，2 条/模式） | textarea 54px；overlay 与首行对齐 | `--font-size-sm`、`--color-text-tertiary` | — | Transition ph 淡入淡出 | 占位轮播为视觉装饰，无 aria 隐藏（input 本身有 aria-label） |
| `.input-toolbar` | 常驻工具栏 | `padding:4px 8px`；`gap:6px` | `--color-text-secondary` | 左：paperclip/document/zap/book/archive/settings + volume-on；中：mode-label 文本；右：workflow + ModelSwitcher + send/square | tool-btn aria-label；router-toggle `aria-pressed`；send-btn aria-label（发送/停止） | voice-active / send-btn.stop-btn 脉冲动画 scoped reduced-motion 已停 |
| 文件输入 | 隐藏 file input | `display:none` | — | — | — | — |
| `.vision-warning` | 图片/语音限制提示 | `radius-mid`；warning-fade 过渡 | `--warning-soft`、`--warning` | — | 4s 自动消失 | — |

### B.3 模型切换（ModelSwitcher）

| 组件/文件 | 职责 | 形态与尺寸 | 设计 token | 图标 | 交互与 a11y | 已知问题 |
|---|---|---|---|---|---|---|
| `ModelSwitcher.vue` | 输入面右侧模型选择 | `.model-pill` 32px `radius-3xl`；dropdown `min-width:200px` `70vh` 玻璃 | `--color-border`、`--color-surface-elevated`、`--color-primary(-muted)` | provider 品牌图标 img / providerLabel 缩写；send 等 | `aria-haspopup="listbox"`；`role="listbox"/"option"` `aria-selected`；键盘 Home/End/Arrow/Enter/Escape 全支持 | **文本字形 `▾`（L20 箭头）、`✓`（L51 选中）**；provider 缩写 label 硬编码映射表（An/OAI/GM/DS…） |
| ModelSwitcher dropdown | 模型列表分组 | `.model-group-label` uppercase | `--fs-2xs`、`--color-text-tertiary` | — | focus 跟随 activeOptionId | — |

### B.4 消息列表（AgentMessageList + shared-ui message-list）

| 组件/文件 | 职责 | 形态与尺寸 | 设计 token | 图标 | 交互与 a11y | 已知问题 |
|---|---|---|---|---|---|---|
| `AgentMessageList.vue` | 消息列表容器：窗口化/归档/深度/A2UI 分发 | `.messages-scroll` `padding:12px 16px 8px` `gap:8px`；scrollbar 隐藏 | `--agent-*` | — | 滚动锚定 + 可见性观察；watchDebounced 自动滚底 | — |
| ArchivedSection.vue | 已归档消息折叠区 | 折叠条 | `--agent-*` | — | 展开按钮 | **文本字形 `▸` chevron（L9）** |
| `packages/shared-ui/src/agent/message-list/DeepProcessPanel.vue` | 深度模式过程段折叠区 | 折叠容器 | `--agent-*` | — | 折叠交互 | **文本字形 `▸` chevron（L10）** |
| StreamingPlaceholder.vue | 流式输出占位 + 思考中 | 点动画 | `--agent-*` | — | — | **文本字形 `●` streaming-cursor（L6）** |
| DeepUserBar.vue | 深度模式右下用户消息导航 | 侧栏 | `--agent-*` | — | 滚动定位 | — |
| DotNav.vue | 非深度用户消息点状导航 | 点导航 | `--agent-*` | — | 滚动定位 | — |
| ScrollToBottomButton.vue | 回到底部 + 新消息计数 | 胶囊 | `--agent-*` | — | — | — |
| MessageListEmpty.vue | 空对话欢迎语 | 空态 | `--agent-*` | — | — | — |
| AgentMessageBubble 分隔线 | 时间分隔线 + 深度回合分隔线 | 双线夹字 / 渐变线 | `--agent-primary`、`--agent-border` | — | — | (已于2026-08-21引擎重构删除：时间分隔线由 divider 事件行 + >30min 补 divider 合成；深度回合分隔线随 deep 形态移除) |

### B.5 消息气泡（路由分发）

| 组件/文件 | 职责 | 形态与尺寸 | 设计 token | 图标 | 交互与 a11y | 已知问题 |
|---|---|---|---|---|---|---|
| `apps/tauri/src/agent/AgentMessageBubble.vue` | 气泡路由：divider / DeepMessageArea / NormalMessageBubble | 分隔线样式 + 可见内容判定 | `--agent-*` | — | hasVisibleContent 过滤 | (已于2026-08-21引擎重构删除：气泡路由随事件行流引擎废弃，由 AgentStreamList 逐行分发取代，见 [G 节](#g-输出事件流引擎2026-08-21-重构)) |
| `packages/shared-ui/src/agent/bubbles/NormalMessageBubble.vue` | 普通模式气泡 | `.chat-msg` `max-width:85%`；`ws-msg-in 0.25s` 入场；头像 24px | `--agent-*`、`--font-size-*`、`--font-weight-*` | manuscript/check/x/wrench/file/outline/delete/image/video WsIcon | 思维链 details/summary；长文本折叠 role=button；操作栏 hover 浮现；mention 事件委托 + 代码复制 | 入场动画 `ws-msg-in` 由 reduced-motion `.chat-msg` 停用（OK）；用户气泡 `backdrop-filter:blur(8px)` |
| `packages/shared-ui/src/agent/bubbles/DeepMessageArea.vue` | 深度模式区域气泡 | `.deep-area` `padding:16px 20px` 左缘 3px 段色；`deep-area-in 0.35s` | `--agent-segment-thinking/tooling/output`、`--agent-primary` | manuscript/wrench/file/clipboard-list WsIcon | 段标签；推理折叠；阶段头 + InlineToolCall；内联活动日志；导出操作栏 | 段标签 11px 字号偏小；活动日志 2 分钟窗口 |
| MessageBlocks.vue | Block 分发容器（13 类） | 按 type 过滤渲染 | — | — | block-action 冒泡 | manuscript 由父级单独渲染 |

### B.6 渲染链路（useMarkdownRender / codeHighlight）

| 组件/文件 | 职责 | 关键能力 | 已知问题 |
|---|---|---|---|
| useMarkdownRender.ts | Markdown 渲染 composable | marked(gfm+breaks) → 自定义 code renderer（ws-code-block 外壳：语言标签+复制按钮）→ DOMPurify（data-ws-* 保留）→ 实体 mention 注入 → rAF 流式节流；`stripJsonBlocks` 剥 JSON；`renderMarkdownHtml` 纯函数（群聊复用）；`handleCodeCopyClick` 复制事件委托 | 流式未闭合围栏降级纯文本（已实现）；mention 注入用 DOMParser 开销可控 |
| `codeHighlight.ts` | Prism 语法高亮 | 按需引入 12 语言（js/ts/py/rust/json/bash/markup/css/markdown/sql/go/java）；`LANG_ALIAS` 别名归一；`setCodeHighlighter` 注入 | 仅 12 高频语言，其余降级纯文本；无行号 |
| MessageBlocks 分发 | 13 类 Block 路由 | table/choice/code/entity-card/alert/stat/list/progress/comparison/timeline/image/video/accordion | manuscript 除外 |
| toolLabels.ts | 工具名→中文标签 | 全量工具映射 | 缺失回退下划线→空格 |

### B.7 Block 组件矩阵（shared-ui blocks 全系列）

统一形态：`.block-toggle`（`role="button" tabindex aria-expanded` + Enter/Space 折叠）+ **`.block-arrow` 文本字形 `▸ 点击展开 / ▾ 点击收起`** + `block-expand` Transition + 图标用 WsIcon。

| 组件/文件 | 职责 | 图标 | 形态 | 已知问题 |
|---|---|---|---|---|
| BlockAlert.vue | 提示条（info/success/warning/error） | WsIcon（等级→图标，L23） | 折叠卡 | 无 emoji（已转 WsIcon） |
| BlockCode.vue | 代码块折叠卡 | — | block-arrow | 文本字形 ▸▾（L7） |
| BlockTable.vue | 表格 | — | block-arrow | 文本字形 ▸▾（L7） |
| BlockStat.vue | 统计指标 + trend 箭头 | WsIcon trending-*（L31） | block-arrow | 文本字形 ▸▾（L7） |
| BlockList.vue | 列表 | — | block-arrow | 文本字形 ▸▾（L7） |
| BlockImage.vue | 图片（5 级来源解析） | — | block-arrow | 文本字形 ▸▾（L16）；图源解析复杂（网络/data/file/IDB/本地） |
| BlockVideo.vue | 视频（折叠/全屏/导出/右键） | video/maximize/download WsIcon；close WsIcon（全屏，已修复 P0-③） | block-arrow | **文本字形 ▸▾（L15）、`▶` play 覆盖层（L31）**；右键菜单原生实现 |
| BlockAccordion.vue | 手风琴 | — | 折叠 | 文本字形 ▸▾（L7）+ `::before` `▸/▾`（L54-55） |
| BlockComparison.vue | 对比表 | — | block-arrow | 文本字形 ▸▾（L6） |
| BlockTimeline.vue | 时间线 | — | block-arrow | 文本字形 ▸▾（L7） |
| BlockChoice.vue | 选择型工具块 | — | 选项 | — |
| BlockEntityCard.vue | 实体卡 | — | block-arrow | 文本字形 ▸▾（L7） |
| BlockProgress.vue | 进度条 | — | — | — |
| BlockManuscript.vue | 创作画布（贴顶渲染） | — | 画布 | `:has(.manuscript-canvas)` 放宽气泡宽度 |
| StepChain.vue | 步骤链（问题拆解→结论） | — | 步骤条 | **文本字形 `✓`（L54）、`●`（L55）** |
| `packages/shared-ui/src/agent/blocks/SearchPath.vue` | 知识探索搜索路径 | — | 分组折叠 | 文本字形 `▾/▸`（L14）(已于2026-08-21引擎重构删除：explore 形态移除) |
| `packages/shared-ui/src/agent/blocks/PhaseHeader.vue` | 阶段头 | — | 折叠 | 文本字形 `▸`（L19）(已于2026-08-21引擎重构删除：deep 形态移除) |
| `packages/shared-ui/src/agent/blocks/DeepSegmentCard.vue` | 深度段卡 | — | 折叠 | 文本字形 `▸`（L9/L31）(已于2026-08-21引擎重构删除：deep 形态移除，轨迹迁右侧面板) |
| InlineToolCall.vue | 内联工具调用卡 | — | 折叠 | 文本字形 `▸`（L11） |
| InteractiveToolCall.vue | 交互工具调用（分派） | — | 分派 | — |

### B.8 interactive-tool / export-corrector 子组件

| 组件/文件 | 职责 | 已知问题 |
|---|---|---|
| InteractiveNormal.vue | 普通工具调用卡 | 文本字形 `▸`（L10） |
| InteractiveConfirm.vue | 确认型工具（权限分级 dangerous/moderate/safe） | 文本字形 `▸`（L11） |
| InteractiveDisplay.vue | 展示型工具 | 文本字形 `▸`（L11） |
| InteractiveWaiting.vue | 等待型工具 | — |
| InteractiveChoice.vue | 选择型工具 | — |
| utils.ts | 工具中文标签映射 | — |
| ExportCorrectorDialog.vue | 导出修正弹窗 | — |
| ExportActionBar.vue | 导出操作条 | — |
| ExportControlPanel.vue | 导出控制面板 | — |
| useExportCorrector.ts | 导出修正逻辑 | — |

---

## C. 面板矩阵

### C.1 执行面板 Tab（ExecPanel）

| Tab | 组件 | 图标 | 职责 |
|---|---|---|---|
| 轨迹 | `apps/tauri/src/agent/components/PhaseSection.vue` + `SubAgentSection.vue` | activity WsIcon | 深度阶段 + 子 Agent 轨迹 |
| 活动 | `ActivityLog.vue` | chart WsIcon | 事件链日志 |
| 计划 | `apps/tauri/src/agent/panels/PlanPanel.vue` | task WsIcon | Plan-and-Execute 编排 |
| 子Agent | SubAgentView（`@/subagent`） | user WsIcon | 子 Agent 规格管理 |
| ToT | `OrchestratorPanel.vue` mode="tot" | workflow WsIcon | 思维树 |
| GoT | OrchestratorPanel mode="got" | mindmap WsIcon | 思维图 |
| 委派 | OrchestratorPanel mode="supervisor" | handshake WsIcon | Supervisor 委派 |
| 多Agent | `apps/tauri/src/agent/panels/MultiAgentPanel.vue` | workflow WsIcon | Multi-Agent 协作 |
| （隐藏）终端 | TerminalView（`@/terminal`） | — | 终端 |
| （隐藏）路由 | `apps/tauri/src/agent/panels/RouterPanel.vue` | — | A3 四管线 |

ExecPanel 骨架：`ExecPanel.vue` 用 `role="tablist/tab/tabpanel"`，Tab `padding:6px 0` `font-size-xs`，`v-show` 切换（保留 DOM）。

### C.2 十二面板逐一

| 组件/文件 | 职责 | 形态 | 图标 | 原生控件 | 已知问题 |
|---|---|---|---|---|---|
| `ActivityLog.vue` | 事件链日志 | 列表 | — | — | — |
| `KnowledgeWall.vue` | 知识墙（侧边栏 embedded） | 列表 + 注入输入 | — | — | embedded 时隐藏自身标题/关闭 |
| `McpPanel.vue` | MCP 服务管理 | 表单/列表 | — | — | — |
| `ModelPanel.vue` | 模型/供应商设置 | 表单 | — | **3 个原生 `type="range"`**（temperature/maxTokens/contextLength，L122/129/136） | range 用 `.settings-slider` 自绘 |
| `apps/tauri/src/agent/panels/MultiAgentPanel.vue` | Multi-Agent 协作配置 + 实时现场 | 折叠面板 + 事件流 | — | **2 个原生 `<select>`（role L37 / topology L56）+ 原生 checkbox（L68）** | **原生 select 残留（配置层 27 个已转 TuiSelect，此处未转）** |
| `OrchestratorPanel.vue` | ToT/GoT/Supervisor 编排现场 | 输入 + 思维树/事件流 | — | — | 树状可视化用 `apps/tauri/src/agent/components/ThoughtTree.vue` 递归组件 |
| `apps/tauri/src/agent/panels/PlanPanel.vue` | 计划 + 自我评审 | orchestrate-box + 计划列表 + reflection-card | chevron-down/check/chevron-right WsIcon | **原生 checkbox（refine L20）** | section-header role=button 可折叠；plan-mini-bar 进度条 |
| `ProviderPanel.vue` | 供应商管理 | 表单/列表 | — | — | — |
| `apps/tauri/src/agent/panels/RouterPanel.vue` | A3 四管线路由 | 配置 + 状态 | — | **原生 checkbox（useLlm L8）** | — |
| `TerminalPanel.vue` | 终端入口 | — | — | — | 实际终端为 TerminalView 迁入 |
| `UsagePanel.vue` | 用量统计 | 数据 | — | — | — |
| `VisionPanel.vue` | 视觉能力配置 | 表单 | — | — | — |

### C.3 编排相关子表

| 组件/文件 | 职责 | 形态 | 已知问题 |
|---|---|---|---|
| `OrchestratorPanel.vue` | 编排输入 + 实时渲染（树/委派日志） | 输入区 + 树 + 事件流 | 极端乱序下任务状态可能失配（记忆记录的风险） |
| `apps/tauri/src/agent/components/ThoughtTree.vue` | 思维树递归可视化 | 父子折线 + 分支折叠 + 评分着色（70/40 阈值） | Options API 自注册规避 script setup 递归限制 |
| `apps/tauri/src/agent/chat/MultiAgentStatusBar.vue` | 多 Agent 状态条 | 状态条 + refreshTick 驱动 | — |
| `SubAgentSection.vue` | 子 Agent 轨迹区 | 折叠卡 860px | 窄面板内去限宽 |
| `apps/tauri/src/agent/components/PhaseSection.vue` | 深度阶段折叠 | 阶段卡 + 工具 chip | 工具 chip pill 语义 |
| `apps/tauri/src/agent/components/LoopControlStatus.vue` | 循环控制状态徽标 | 徽标 | — |

---

## D. 设置与杂项矩阵

| 组件/文件 | 职责 | 形态 | 图标 | 原生控件 | 已知问题 |
|---|---|---|---|---|---|
| `AgentSettingsPanel.vue` | Agent 设置悬浮面板（子面板切换） | settingsSubPanel 切换 Model/Provider/安全/人格/思考/用量/搜索 | — | 原生 password input（L83-136 区）+ 2 个 styled checkbox toggle（L132/L193） | 配置层 27 select 已全转 TuiSelect（记忆确认，本组件无残留 select） |
| `SkillsStorePanel.vue` | 技能商店/导入 | 列表 | — | — | — |
| `SpaceAgentSettingsPanel.vue` | 空间级设置面板 | 面板 | close WsIcon? | — | 关闭按钮为文本 `✕`（见 F.1） |
| `apps/tauri/src/agent/AgentWorkspace.vue` | **已退役**（2026-08-09 记录） | 本地 MessageContent 仅作参考 | — | — | 仍引用 SubAgentSection/PhaseSection/ModelSettingsDialog/LoopControlStatus/SessionList/MessageContent——需确认是否仍有路由引用；若彻底退役可删除 |
| `apps/tauri/src/agent/components/ModelSettingsDialog.vue` | 独立模型配置弹窗 | TuiModal + TuiSegmented + TuiSelect + 原生 input/datalist | — | 原生 input/datalist | — |
| `apps/tauri/src/agent/components/MessageContent.vue` | 本地富渲染组件（参考实现） | — | — | — | 与 shared-ui useMarkdownRender 重复实现（仅历史参考） |

---

## E. 设计系统矩阵

### E.1 设计 Token 全景（theme.css）

命名空间 | 关键 token | 值（浅色） | 用途
---|---|---|---
背景 | `--bg-app` / `--bg-surface` / `--bg-muted` / `--bg-active` | #fafaf9 / #ffffff / #f4f4f5 / #e9e9ea | 底/面板/弱背景/激活
边框 | `--border` / `--border-strong` | #ececec / #d9d9de | 细/强调边框
文字 | `--text-primary` / `--text-secondary` / `--text-muted` | #1f2328 / #6b7280 / #9ca3af | 主/次/弱
强调 | `--accent` / `--accent-hover` / `--accent-soft` / `--on-accent` | #4f46e5 / #4338ca / #eef2ff / #ffffff | 靛蓝克制强调
语义 | `--success` / `--warning` / `--danger` / `--info` | #16a34a / #d97706 / #dc2626 / #2563eb | 状态色
圆角 | `--radius-2xs~3xl`、`--radius-pill` | 3/4/6/8/10/14/16/12/24px / 999px | 阶梯
字号 | `--fs-3xs~xl` | 9/10/11/12/13/14/16/20px | 阶梯
阴影 | `--shadow-sm/md/lg` | — | 层级
布局 | `--chat-gutter:24px` / `--chat-max-w:860px` / `--region-*` / `--input-sm-h:30px` / `--icon-btn-*` | — | 对话限宽、区域分割、尺寸
动效 | `--ease` / `--ease-spring` / `--dur-fast/base/lg/pulse` / `--press-scale` | 0.15/0.22/0.32/1.2s / 0.96 | 统一缓动与时长
焦点 | `--ring-color` / `--ring-width` | rgba(79,70,229,.35) / 3px | 键盘焦点环
层级 | `--z-sticky/dropdown/modal/toast` | 2/100/1000/2000 | z 统一规划
玻璃 | `--glass-bg` / `--overlay` / `--overlay-blur` | — | 遮罩/玻璃
Markdown | `--md-*` | — | 消息富渲染
A2UI 映射 | `--agent-*`（bg/border/text/accent/primary/font/hover/input/radius/blur）+ 语义 `--agent-danger/success/warning/info/segment-*` + `--agent-user-bubble` | — | shared-ui 组件消费
Web 桥接 | `--color-*`（primary/border/surface/text/danger…）+ `--font-size-*` + `--font-weight-*` | — | 迁移组件消费

深色覆盖：`[data-theme='dark']` 覆盖色值/阴影/遮罩/玻璃/Markdown，令牌语义不变（`--accent:#8b87f8` 提亮、`--on-accent:#17171b` 换深字保证对比度、`--agent-*` 语义色提亮）。

### E.2 legacy→统一 token 桥接（web-tokens-bridge.css）

覆盖域 | 桥接内容 | 备注
---|---|---
色板 | `--color-primary/-hover/-active/-accent/-bg-*/-text-*/-border-*/-success/-danger/-warning/-info/-overlay` | 值全引用 Tauri 令牌
web 短名 | `--primary` / `--text-color` / `--border-color` / `--bg` | MenuBar/SidebarV2 消费
组件层 | `--button-*` / `--card-*` / `--modal-*` / `--input-*` / `--hover-bg` / `--glass-*` / `--gradient-accent` | 全引用令牌
排版 | `--font-size-3xs~3xl` / `--font-weight-*` / `--line-height-*` | 2xl/3xl 硬编码
圆角/间距/阴影/动效 | `--radius-*` / `--spacing-*` / `--shadow-*` / `--transition-*` | radius-xl:18px 硬编码
Space/Agent 语义 | `--color-surface(-elevated)` / `--color-text(-muted)` / `--color-primary-muted` / `--color-error` / `--color-bg` | Agent 空间主力消费
长尾补齐 | `--space-*` / `--icon-*` / `--shadow-glow` / `--focus-ring` / `--font-family` 等 | ui-kit/plugin-sdk 消费

覆盖度：已桥接大部分；**硬编码残留点**：`--radius-xl:18px`、`--font-size-2xl/3xl`（24/30px）、`--layout-sidebar-width` 等尺寸类。

### E.3 reduced-motion 覆盖（reduced-motion.css）

覆盖类名前缀：`tc-` `seg-` `itc-` `ws-` `phase-` `bar-` `block-` `streaming-` `cursor-` + `.chat-msg` `.deep-area` `.archived-section` `.a2ui-surface` `.ms-canvas`（`animation:none !important`）
过渡压缩类：`.block-toggle` `.choice-btn` `.a2ui-btn` `.a2ui-choice` `.a2ui-tag` `.msg-bubble` `.tool-call-tag` `.exec-tab`（`transition:none !important`）

未覆盖（宿主级）：AgentSpace `.sidebar-slide-*` / `.panel-slide-right-*`、SpaceNavbar `.mode-switch::after` 填充扩散、SpaceChat `.chat-input-dock` 下沉——全局 `theme.css` 的 `transition-duration:0.01ms` 压缩兜底（无 `!important`，位移距离未消除）。

### E.4 Tui 组件矩阵（apps/tauri/src/components/ui/）

组件 | 职责 | token | 主题三态 | 备注
---|---|---|---|---
[TuiButton.vue](../../apps/tauri/src/components/ui/TuiButton.vue) | 按钮 | `--radius-* --fs-* --dur-* --accent-* --bg-* --text-*` | ✓ | 含按压反馈与 reduced-motion
TuiCheckbox | 复选框 | 全局 | ✓ | — |
TuiConfirm | 确认弹窗 | — | ✓ | — |
TuiDrawer | 抽屉 | — | ✓ | — |
TuiEmpty | 空态 | — | ✓ | — |
[TuiModal.vue](../../apps/tauri/src/components/ui/TuiModal.vue) | 弹窗 | `--z-modal --overlay --bg-surface --radius-lg --shadow-lg` | ✓ | 遮罩模糊
TuiSegmented | 分段滑块 | — | ✓ | 顶栏模式滑块用 |
[TuiSelect.vue](../../apps/tauri/src/components/ui/TuiSelect.vue) | 下拉选择 | — | ✓ | 配置层 27 处替换用 |
TuiSpinner | 加载 | — | ✓ | — |
TuiToast | 轻提示 | — | ✓ | — |
ToolbarOverflow | 工具栏溢出 | — | ✓ | — |

### E.5 WsIcon / WsEmpty / WsSpinner + 图标注册表

能力 | 说明
---|---
[WsIcon.vue](../../packages/ui-kit/src/components/WsIcon.vue) | 尺寸档 xs/sm/md/lg/xl（`--icon-size-*`）；SVG stroke round；从 iconRegistry 解析
[iconRegistry.ts](../../packages/ui-kit/src/assets/icons/index.ts) | action/nav/data/world/theme/category 六组注册；`getAllIconNames()` 可枚举
action 组 | close/edit/delete/save/search/settings/refresh/undo/redo/folder-open/folder/file-select/print/link/list/brush/tag/warning/palette/keyboard/star/star-outline/check/unlock/grip/image/arrow-up/chevron-down/chevron-right/play/pause
nav 组 | chat/terminal/subagent/memory/send/stop/plus/bulb/info/arrow-left/trash/copy/sparkle/dots/book/wrench/grid/moon/sun/upload/file/monitor/video/paperclip/tree/download/package/activity/chart/task
其他被引用名 | x/document/zap/archive/volume-on/workflow/square/outline/maximize/download/clipboard-list/bot/key/panel-right-open/panel-right-close/more-horizontal/pencil/globe/mindmap/handshake/users/manuscript/trending-*
WsEmpty | 空态容器（`--space-8` 大留白）|
WsSpinner | 加载指示 |

> 注：以上图标名为已核实被引用清单；完整可用列表以 `getAllIconNames()` 为准（data/world/theme/category 组未逐项展开，需用时另查）。

### E.6 视觉稿规范提炼（agent-space-redesign-v1.html）

规范 | 数值/要点
---|---
三区布局 | 会话栏 260 / 主区 flex / 执行面板 300；`--region-gap:8px` 缝隙 + `--region-radius` 独立圆角块
双线分隔 | 相邻区域不共用单线，各保留 1px 边框，区域间 ≥8px 缝隙透出 `--bg-app`
间距阶梯 | 紧凑 4px / 标准 8px / 中距 12-16px / 宽距 16-20px / 特殊 24px
圆角阶梯 | 4px 标签 / 6px 次级按钮 / 8px 常规 / 10px 大按钮与区域 / 12px 浮层 / 24px 胶囊
弹出层三档 | 锚定式（340px）/ 居中模态（640px）/ 右侧抽屉（360px）
玻璃态 | `rgba(10,10,20,0.08)` + `backdrop-filter:blur(16px)`；时间线双线夹字
输入区 | 胶囊 200px ↔ 宽栏 80%-120px 动态形态（现 ChatInput 已改固定 55% 宽，见 B.2）

---

## F. 问题清单矩阵

> **修复状态（2026-08-20）**：本节全部 P0/P1/P2 条目已处理完毕，处理范围与决策见 `.trae/documents/agent-space-fissue-remediation.md`（AgentWorkspace 退役、SessionSidebar 死 CSS 为用户确认项）。以下保留原始审计条目并回填处理结果，供后续复核。

### F.1 emoji / 文本字形残留（精确到文件与行）— ✅ 已全部清零

> 注：shared-ui 与 agent 空间的 **emoji/文本字形已全部清零**（2026-08-20 grep 实测无残留；含本次新发现的 🔀/📅 与遗留 2 处 ▶）。

| 位置 | 字形 | 语义 | 处理（2026-08-20） |
|---|---|---|---|
| ModelSwitcher L20 | `▾` | 下拉箭头 | ✅ WsIcon chevron-down |
| ModelSwitcher L51 | `✓` | 当前模型选中 | ✅ WsIcon check |
| MemoryShelf / PersonaMirror / FontSelectorDropdown / SpaceAgentSettingsPanel | `✕` ×4 | 面板关闭 | ✅ WsIcon close |
| 10 个 Block `.block-arrow`（Accordion/Code/Table/Stat/List/Image/Video/Comparison/Timeline/EntityCard） | `▸/▾ 点击展开/收起` | 折叠指示 | ✅ WsIcon chevron-right/down + 文案拆分 |
| BlockAccordion `::before`（L54-55） | `▸/▾` | 折叠箭头 | ✅ 删除伪元素 |
| BlockVideo L31 | `▶` | 播放覆盖层 | ✅ WsIcon play |
| StepChain L54-55 | `✓` / `●` | 步骤完成/进行 | ✅ WsIcon check / CSS 圆点（ws- 前缀类名保证 reduced-motion 停脉冲） |
| StreamingPlaceholder L6 | `●` | 流式光标 | ✅ CSS 圆点 |
| chevron 组（ArchivedSection / DeepProcessPanel / DeepSegmentCard×2 / InlineToolCall / PhaseHeader / SearchPath / InteractiveConfirm / InteractiveDisplay / InteractiveNormal） | `▸` ×10 | 折叠指示 | ✅ WsIcon chevron-right（保留旋转）<br>（注：DeepSegmentCard / PhaseHeader / SearchPath 已于 2026-08-21 引擎重构删除，原计数 −3，见 [G 节](#g-输出事件流引擎2026-08-21-重构)） |
| SpaceNavbar / SessionSidebar `.new-session-btn` | `+` ×2 | 新建 | ✅ WsIcon plus |
| **新发现** BlockComparison L4 | `🔀` | 对比图标 | ✅ WsIcon relation |
| **新发现** BlockTimeline L4 | `📅` | 时间线图标 | ✅ WsIcon timeline |
| **遗留** A2UIComponent L438 | `▶ 运行` | 代码运行 | ✅ WsIcon play |
| **遗留** ExportCorrectorDialog L25 | `▶ 预览动画` | GIF 预览 | ✅ WsIcon play |

### F.2 原生控件残留 — ✅ 观察项外已收敛

| 位置 | 控件 | 处理（2026-08-20） |
|---|---|---|
| MultiAgentPanel 角色/拓扑 select（原 L37/L56） | 原生 `<select>` ×2 | ✅ 转 TuiSelect（+ options 常量 + handler string 入参 + 布局宽适配） |
| MultiAgentPanel L68 / PlanPanel L20 / RouterPanel L8 checkbox | 原生 checkbox | 观察项，保持原生（accent-color 已统一） |
| AgentSettingsPanel toggle ×2 | styled checkbox | 已自绘，保持 |
| ModelPanel range ×3 | 原生 range | 已 `.settings-slider` 自绘，保持 |
| SessionSidebar 搜索 input | 原生 input | 已有 focus 主色，保持 |

### F.3 硬编码色值残留 — ✅ 已收敛

| 位置 | 值 | 处理（2026-08-20） |
|---|---|---|
| ChatInput chip/chip-reference/chip-pipeline/router-toggle/voice-hint/send-btn.stop-btn/vision-warning | `#3b82f6`/`#10b981`/`#d97706`/`#e74c3c` 等 | ✅ 去 fallback，token-only（token 由 theme.css + bridge 保证） |
| SpaceNavbar user-avatar 渐变 | `#10b981`/`#34d399` | ✅ 提为 `--user-avatar-grad` token（浅/深双定义） |
| SessionSidebar `.session-mode-badge` | `#6ea8fe`/`#b478ff`/`#50c8a0` | ✅ 死 CSS 删除（见 F.5） |
| theme.css 语义色 | `--agent-danger:#ef4444` 等 | 有意基准，非问题（保持） |

### F.4 缺 prefers-reduced-motion 的动画 — ✅ 已补全

| 位置 | 动画 | 处理（2026-08-20） |
|---|---|---|
| AgentSpace `.sidebar-slide-*`/`.panel-slide-right-*` | 位移 20px/100% | ✅ scoped media 归零 transform |
| SpaceNavbar `.mode-switch::after` | 填充 scale 1→1.7 | ✅ 归零 scale + transition none |
| SpaceChat `.chat-input-dock` | 下沉 0.35s | 全局压缩覆盖（位移感弱），保持 |
| ChatInput `.ph-overlay`/warning-fade | 淡入淡出 | 已 scoped / 全局覆盖，保持 |

### F.5 P0 / P1 / P2 分级结论（处理状态）

| 级 | 条目 | 文件 | 问题 | 处理结果（2026-08-20） |
|---|---|---|---|---|
| P0 一致性 | MultiAgentPanel 原生 select | MultiAgentPanel.vue | 与配置层 27 个 TuiSelect 不一致 | ✅ 已转 TuiSelect |
| P0 一致性 | AgentWorkspace 退役 | AgentWorkspace.vue | 0 引用孤儿（旧版工作台） | ✅ 已删除 + 6 个孤儿子文件（ModelSettingsDialog / LoopControlStatus / SessionList / MessageContent / agent-memory 整目录） |
| P1 a11y | 宿主级 reduced-motion 缺口 | AgentSpace / SpaceNavbar | 面板滑入、填充扩散未降级 | ✅ 已补 scoped media |
| P2 视觉语言 | 文本字形 ~33 处 | F.1 全表 | 字形与 WsIcon 不统一 | ✅ 全部转 WsIcon / CSS 圆点（含新发现 🔀📅 + 遗留 2 处 ▶） |
| P2 视觉语言 | 硬编码 fallback 色值 | F.3 | 兜底 hex 并存 | ✅ 收敛为 token |
| P2 观察 | SessionSidebar 遗留 CSS | SessionSidebar.vue | 死 CSS + 硬编码色 | ✅ 已删除（用户确认） |
| 已健康 | emoji 清零 | shared-ui + agent | grep 实测 | ✅ 保持（本次再清 2 处新发现 emoji） |
| 已健康 | 配置层 27 select | AgentSettingsPanel | 已全转 TuiSelect | ✅ 保持 |
| 已健康 | shared-ui reduced-motion | reduced-motion.css | 集中覆盖 | ✅ 保持 |

---

## G. 输出事件流引擎（2026-08-21 重构）

> **本次重构**：移除 deep / normal / explore 三种 chatMode 形态，主对话流统一为单一**事件行流** `AgentStreamItem[]`（agentStream）。新渲染引擎集中在 `packages/shared-ui/src/agent/stream/`，统一**扁平形态**——无阶段卡、无段标签彩色边、工具=扁平行、Think=动态折叠（运行中展开跟随末行 / 完成后折叠）。三端口 typecheck 已通过。
> **对 F 节的影响**：本次变更使 F 节相关「模式残留」条目清零——`AgentMessageBubble`/`PhaseHeader`/`SearchPath`/`DeepSegmentCard` 已删除，其残留在 F.1（chevron 组）、B.4/B.7 相关行就地标注「(已于2026-08-21引擎重构删除)」，不再代表现存实现（旧条目保留供历史复核）。

### G.1 事件行流组件矩阵

> 统一扁平形态：**左对齐、无气泡底 / 无阶段段标签彩边**；工具=扁平行；Think=动态折叠（运行中展开跟随末行 / 完成后折叠）。
> reduced-motion 覆盖类前缀 **`ws-stream-`** 命中全局 `[class*='ws-']` 规则（纳入 E.3 集中覆盖）。

| 组件/文件 | 职责 | 形态 | 设计 token | reduced-motion 覆盖 | 已知问题 |
|---|---|---|---|---|---|
| AgentStreamList.vue | 事件行流渲染容器：按 `agentStream` 逐行分派到 rows/ 子行 | 统一扁平形态分发；增量/一次性渲染 | `--agent-*`、`--color-text-*` | `ws-stream-*` 命中 `[class*='ws-']` | — |
| rows/UserRow.vue | `user{msg}` 用户消息行 | 扁平左对齐 | `--agent-user-bubble` 等 | `ws-stream-user-*` | — |
| rows/AssistantRow.vue | `assistant{msg}` 助手消息行（复用 useMarkdownRender 渲染 / caption / 折叠） | 扁平 Markdown | `--agent-*`、`--md-*` | `ws-stream-assistant-*` | — |
| rows/ThinkRow.vue | `think{text,status}` 思考行：动态折叠（运行中展开跟随末行 / 完成折叠） | 动态折叠条 | `--agent-segment-*` | `ws-stream-think-*` | — |
| rows/ToolRow.vue | `tool{tc}` 工具行：工具调用扁平化 | 扁平行（非阶段卡） | `--agent-primary(-muted)`、`--color-border` | `ws-stream-tool-*` | — |
| rows/DividerRow.vue | `divider{dividerText}` 分隔行（时间分隔等） | 双线夹字 / 时间线 | `--agent-border`、`--agent-primary` | `ws-stream-divider-*` | — |

### G.2 重构变更清单

**删除（原文件/组件）**

| 文件 | 原职责 | 替代 / 原因 |
|---|---|---|
| `apps/tauri/src/agent/AgentMessageBody.vue` | 气泡渲染体 | 事件行流引擎接管渲染 |
| `apps/tauri/src/agent/useAgentRenderPlan.ts` | 渲染计划 | 事件行流静态派生，去掉中间层 |
| `packages/shared-ui/src/agent/deepPhases.ts` | 深度阶段定义 | deep 形态移除 |
| `packages/shared-ui/src/agent/blocks/PhaseHeader.vue` | 阶段头 | deep 形态移除 |
| `packages/shared-ui/src/agent/blocks/SearchPath.vue` | 知识探索搜索路径 | explore 形态移除 |
| `packages/shared-ui/src/agent/blocks/DeepSegmentCard.vue` | 深度段卡 | deep 形态移除（轨迹迁右侧面板） |
| `apps/tauri/src/agent/AgentMessageBubble.vue` | 气泡路由（divider / Deep / Normal） | 由 AgentStreamList 逐行分发取代 |

**改动（源文件 + 说明）**

| 文件 | 改动说明 |
|---|---|
| `AgentMessageList.vue` | 改用 `agentStream` + `AgentStreamList`；删 `isDeepMode` / `deepSegments` 平铺 / `turn-separator` / `DeepSegmentCard` |
| `useAgentRust.ts` | 组装层产出 `agentStream`：think 双写（thinking 字段 + think 行）、tool 双写（tool 事件行 + deepSegments 供右侧轨迹面板）；回源 `rebuildStreamFromMessages` 重建；>30min 补 divider；`finalOutput`/`FinalOutput` 删除 |
| useMessageWindowing.ts | 泛化，去 isDeepMode 锚定 |
| bubbles/index.ts | 清理模式专属导出（保留 MessageBlocks / useMarkdownRender / useThinkingFold / useTextFold / useMessageActions / format / toolLabels，group-chat 仍用） |
| bubbles/types.ts | 清理模式专属类型 |

**保留共识**：`deepSegments` **保留**（右侧轨迹面板 TracePanel / PhaseSection / ExecPanel 消费）；`finalOutput` **删除**（权威输出统一由事件行流 + assistant{msg} 行表达）。

---

*本文档为 Agent 空间 UI/UX 升级基线审计（v1.0）→ v1.1（2026-08-20 完成 F 节 P0-P2 全部修复并回填）→ v1.2（2026-08-21 输出事件流引擎重构，见 G 节）。用户可继续依据 A-E 节矩阵表的「已知问题」列逐条发起升级任务；新修复同样回填本节。*
