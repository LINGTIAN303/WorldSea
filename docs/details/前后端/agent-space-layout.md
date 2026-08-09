# Agent 空间布局距离与形态逻辑计算

> 版本：2026-08-09（窗口栏补齐 + 顶栏分割线移除后实测）
> 范围：Agent 空间（单聊 + 群聊）全部组件的布局距离（间距/尺寸/边框/圆角）与形态逻辑（布局方式/视觉语言）
> 数据来源：源码 CSS 实测 + 浏览器冒烟（1440×900 视口）

---

## 1. 全局骨架（纵向三层）

Agent 空间是纵向三层 flex column 结构，`100vh` 固定高度，`overflow: hidden`：

| 层 | 组件 | 高度 | 形态逻辑 |
|---|---|---|---|
| 窗口栏 | `TitleBar.vue` variant="space" | 32px | 拖拽区（`data-tauri-drag-region`）+ 居中标题 + 窗口控制三键（最小化/最大化/关闭）；下边框 1px |
| 顶栏 | `SpaceNavbar.vue` | 48px | 左（身份+模式下拉）/ 中（mode-switch + 新建）/ 右（功能按钮组）；下边框 1px；`z-index: 100` |
| 主区 | `.space-body` | flex:1 | flex 行向，`gap: 8px`，`padding: 8px`，独立块各自 1px 边框 + 圆角 10px（双线分隔：块间缝隙透出 app 底色） |

**层间关系**：窗口栏 + 顶栏为固定高度（`flex-shrink: 0`），主区吃掉剩余空间。窗口栏与顶栏之间无缝隙（连续 surface 底），顶栏与主区间由主区自身 padding 8px 形成分隔。

**主区三块**（双线分隔独立块，各 1px 边框 + 圆角 10px + `gap: 8px` 缝隙）：

| 块 | 定位 | 默认宽度 | 可调范围 | 形态 |
|---|---|---|---|---|
| `.session-panel` 会话栏 | 左（`v-if sessionOpen`）| 260px（`sessionSidebarWidth`）| 200–400px | 独立块 + 右侧 resize-handle 6px |
| `.space-main` 主对话区 | 中 | flex:1 min-width:0 | — | 独立块，内嵌 SpaceChat / GroupChatView |
| `.exec-panel-wrap` 执行面板 | 右（`v-if execPanelOpen`）| 300px（`execPanelWidth`）| 240–560px | 独立块 + 左侧 resize-handle |

**弹出层**（浮于主区之上，非 flex 块）：
- `.config-drawer` 配置抽屉：absolute `top/right/bottom: 8px`，宽 360px（240–560px 可调），圆角 10px，阴影 `-12px 0 32px`，z-index 24，入场 `translateX(24px)`
- `.left-panel` 知识墙：absolute `top/bottom: 8px`，宽 340px，`left: 16px`（会话栏开时 260+16），阴影 `4px 0 12px`，z-index 20
- resize-handle：6px 宽，hover 时 accent 底 opacity 0.35

---

## 2. 顶栏（SpaceNavbar）布局

`height: 48px; padding: 0 16px; gap: 12px; justify-content: space-between`，三区各 `flex: 1`：

### 左区（单聊模式）
| 元素 | 尺寸 | 间距 | 形态 |
|---|---|---|---|
| PanelToggle | 32×40px | — | 双面翻转（会话↔知识墙），both 时 40px |
| agent-identity（头像+名字+状态）| 头像 32px | gap 10px，padding 4px 8px | 点击开 PersonaMirror popover |
| mode-dropdown-btn（快问快答等）| padding 4px 10px | margin-left 4px | 下拉菜单 min-width 220px，玻璃态 |

### 左区（群聊模式）
| 元素 | 尺寸 | 间距 | 形态 |
|---|---|---|---|
| user-identity（用户头像+昵称+状态）| 头像 32px + 状态绿点 | gap 10px，padding 4px 8px | 点击开 UserProfilePopover |
| mode-dropdown-btn（会议/闲聊）| 同上 | 同上 | 同款下拉 |

### 中区（两模式共用）
| 元素 | 尺寸 | 间距 | 形态 |
|---|---|---|---|
| mode-switch 胶囊 | height 20px，padding 0 8px | 圆角 10px | 单聊⇄群聊切换；on 态 accent 字 + 600 |
| new-session-btn | 20×20px | gap 4px | `+` 新建会话 |
| current-session 会话名 | 10px 小字 | margin-top 1px | 140px 截断省略 |

### 右区（功能按钮组）
2026-08-09 起**移除全部 nav-divider 分割线**，按钮组以 4px gap 直接相邻（视觉稿 tb-sep 亦移除）：

| 模式 | 按钮序列 | 尺寸 | 形态 |
|---|---|---|---|
| 单聊 | 记忆架 brain → 运行面板 chart(徽标) → 知识墙 book → 更多 more-horizontal | 32×32px，gap 4px | hover surface 底，active accent-soft 底 |
| 群聊 | Agent管理 bot → Provider池 key → 记忆架 → 运行面板 → 知识墙 → 更多 | 同上 | 前两个 `v-if mode==='group'` 专属 |

nav-badge 红点（活动徽标）：6×6px，absolute top/right 5px，1.6s 呼吸。

---

## 3. 单聊模式主区（SpaceChat）

`.space-chat` flex column 100%；内部：
- Rust 模式 banner：padding 6px 12px，下边框，居中
- `.chat-messages` flex:1
- ChatInput：padding 12px 16px 16px

**输入栏（ChatInput）胶囊形态**：
| 态 | 宽度 | padding | 圆角 |
|---|---|---|---|
| 收缩（无输入）| 200px（max-width 200px）| 6px 8px | 24px |
| 展开（聚焦）| calc(80% - 120px) | 8px 12px | 16px |

附：attach/send 32×32px，radius 10px；kb-chips/attachments 胶囊化；textarea max-height 120px。

**消息区**（AgentMessageList，布局见全局对话规范）：860px 居中限宽（`--chat-gutter`），消息气泡左助手/右用户、头像 26px、日期分隔线双线夹字、PhaseSection/SubAgentSection 折叠卡均 860px。

---

## 4. 群聊模式主区（GroupChatView）

`.group-chat-layout` flex 行向 100%：

### 4.1 三栏骨架
| 栏 | 宽度 | 形态 |
|---|---|---|
| SidebarStrip 窄条 | 40px | 竖排两个 zone（群列表/好友列表）+ 1px strip-divider（margin 0 8px）；active 左侧 3px accent 色条 |
| sidebar-panel 展开面板 | 260px（`.sidebar-panel > *`）| 宽度动画 0.25s 展开 / 0.2s 收起（0→260px）；右边框 1px |
| group-main 主区 | flex:1 | flex column |

### 4.2 会议模式（Meeting）
| 区块 | 布局 | 形态 |
|---|---|---|
| GroupChatSetup 设置页 | max-width 560px 居中；padding 24px 24px 8px | 表单滚动区 + 吸底 footer（padding 12px 24px 16px，上边框）；start-btn padding 8px 20px radius 10px 带投影 |
| chat-header | padding 8px 16px，space-between | 下边框 1px；左侧 topic + 预算条 + parallel-badge + state-tag |
| chat-messages | flex:1 滚动，padding 8px 0 | 时间分隔线双线夹字（padding 8px 16px）|
| GroupReviewCheckpoint | 会话中 | 评审检查点 |
| GroupChatControls 控制条 | padding 8px 16px，space-between | 上边框 1px；left gap 12px / right gap 6px；ctrl-btn padding 4px 12px radius 8px；inject 区整行换行 |

### 4.3 闲聊模式（CasualChatView）
与会议同骨架：SidebarStrip + 260px 展开面板 + chat-area（flex column）：
- chat-header：padding 8px 16px，header-btn 28×28px
- chat-messages：padding 8px 0
- scroll-to-bottom 胶囊：absolute bottom 68px right 16px
- private-chat-overlay 私聊抽屉：fixed 420px，阴影 `-4px 0 24px`，z-index 9998

### 4.4 群消息气泡（GroupMessageBubble）
| 元素 | 尺寸 | 形态 |
|---|---|---|
| `.group-msg` | padding 8px 16px，gap 4px | 入场动画 msg-slide-in 0.25s |
| msg-speaker | gap 8px | 头像 28px 圆形 + 名字 |
| msg-body | margin-left 36px（= 28 头像 + 8 gap），padding 8px 12px | border-left 3px speaker 色；radius 0 12px 12px 12px；max-width 85% |
| msg-user .msg-body | 右对齐镜像 | border-right 3px primary；radius 12px 0 12px 12px |
| tool-call-tag | padding 2px 8px | radius 4px；状态色 running/completed/failed |
| msg-actions | height 20px | 默认 opacity 0，hover 浮现 |
| text-collapsed | max-height 160px | 底部 48px 渐变遮罩 |

### 4.5 群聊专属浮层（SpaceNavbar 入口，2026-08-09 迁移）
| 浮层 | 尺寸 | 定位 | 形态 |
|---|---|---|---|
| AgentManagerPanel | 340px，max-height 480px | 锚定按钮下方（top = rect.bottom + 6px，右缘对齐）；无锚回退 top 56 right 16 | 玻璃态 blur 16px，radius 12px；agent-card gap 10px padding 8px 10px；create-btn 通栏虚线 |
| ProviderSlotEditor | 640px，max-height 80vh | 居中模态（overlay rgba(0,0,0,0.5)）| header padding 16px 20px；body gap 16px；slot-card 独立卡片（padding 12px radius 8px 边框 1px）；picker 下拉 min-width 300px |

---

## 5. 侧栏与抽屉面板（MemoryShelf / PersonaMirror / SessionSidebar）

| 组件 | 宽度 | header | body | 形态 |
|---|---|---|---|---|
| MemoryShelf（config-drawer）| 360px（240–560 可调）| padding 12px 14px + 下边框 | padding 8px 14px | 玻璃态 blur 16px；memory-item 左缘 3px 状态色条（fresh/normal/stale）+ radius 8px |
| PersonaMirror（config-drawer / popover）| 抽屉 360px / popover 340px max-height 70vh | 12px 14px | 8px 14px | section-divider 1px margin 12px 0；persona-card radius 10px；reflection-item 左缘 3px accent 条 |
| SessionSidebar（会话栏 260px）| 260px | padding 12px 14px gap 8px | padding 4px 8px | 玻璃态；header 新建按钮 28px 虚线 + 关闭 24px；session-item padding 8px 10px radius 8px，active accent-soft 底 |

---

## 6. 形态逻辑体系（跨组件一致性基准）

### 6.1 间距基准（横向距离计算）
| 档位 | 数值 | 用途 |
|---|---|---|
| 紧凑 | 4px | 按钮组内、标签、badge、agent-card 列表 |
| 标准 | 8px | 按钮组、header 内、主区缝隙、气泡 padding |
| 中距 | 12–16px | 区块内（editor-body gap 16px、footer padding 16px）|
| 宽距 | 16–20px | 弹窗 header/body padding（ProviderSlot 20px）|
| 特殊 | 24px | ChatInput 整体 padding 12px 16px 16px、私聊抽屉宽度 420px |

### 6.2 圆角阶梯
| 档位 | 数值 | 用途 |
|---|---|---|
| 4px | 小标签、entry-row、表单内输入框 | 
| 6px | 次级按钮、chip、tab、表单控件 |
| 8px | 常规按钮、列表项、预算条、卡片 |
| 10px | 大按钮（start-btn）、persona-card、主区独立块（radius-md）|
| 12px | 气泡 body、弹窗（AgentManager/ProviderSlot/persona-popover）|
| 24→16px | ChatInput 胶囊展开切换 |
| 50% | 头像、状态点、icon-btn |

### 6.3 双线分隔（用户规范 2026-08-09）
相邻区域/面板/卡片边界**不共用单线**：各保留自身 1px 边框，区域间留 ≥8px 缝隙透出 app 底色。主区三块（session-panel / space-main / exec-panel-wrap）与 config-drawer 均满足。

### 6.4 玻璃态
侧栏/抽屉/弹出面板统一 `rgba(10,10,20,0.08)` + `backdrop-filter: blur(16px)`；时间线分隔用"双线夹字"（1px 伪元素平分，padding 0 12px）。

### 6.5 弹出层三档
| 档 | 示例 | 特征 |
|---|---|---|
| 锚定式 | AgentManagerPanel（340px）| 右对齐锚定触发按钮，bottom+6px |
| 居中模态 | ProviderSlotEditor（640px/80vh）| overlay 半透明遮罩居中 |
| 右侧抽屉 | config-drawer（360px）、私聊（420px）| top/right/bottom 贴边 + 阴影 |

### 6.6 输入区形态
ChatInput 是唯一"胶囊→宽栏"动态形态（200px ↔ 80%-120px），按钮常驻渲染、opacity/scale 控制可见性（避免 flex 重排）。

---

## 7. 已知不一致点（审计发现，非本次修复范围）

1. **激活形态两套（已消除）**：原 GroupChatList 用左侧 3px 色条激活、GroupSessionSidebar 用整块底色激活——后者已于 2026-08-09 移除（孤儿组件，职责被 GroupChatList 覆盖）
2. 主区独立块圆角 10px 与弹窗圆角 12px 分属两档，属刻意（块 vs 浮层）
3. 私聊抽屉 420px 与 config-drawer 360px 宽度不统一（各自语义，可接受）

---

## 8. 本次改动（2026-08-09）

- **移除 SpaceNavbar 顶栏分割线**：3 处 `nav-divider` 模板 + `.nav-divider` CSS 类全删，按钮组以 4px gap 直接相邻
- **AgentSpace 补齐窗口栏**：`TitleBar.vue` 新增 `variant="workbench"|"space"`——space 变体仅拖拽区 + 居中标题 + 窗口控制（隐藏 ☰/项目切换器/AppMenu/视图名）；AgentSpace 顶部挂载，标题随模式显示「WorldSmith — Agent 空间 / 群聊空间」
- **移除孤儿组件 GroupSessionSidebar.vue**：职责被 GroupChatList 覆盖（后者按全部/闲聊/会议承载双模式会话）
- **模式选择由下拉改分段滑块**：SpaceNavbar 左区 `mode-dropdown`（下拉菜单）→ `TuiSegmented` 滑块——单聊四模式（快问快答/深度思考/知识探索/任务执行）、群聊两模式（会议/闲聊）；`modeModel` 双向 computed 按 mode 分流写 store（groupChatMode/chatMode）；删除 mode-dropdown 全部模板/状态/CSS；滑块紧凑适配 48px 顶栏（item padding 4px 12px）
- 验证：typecheck 0 错误；浏览器冒烟——单聊滑块 4 项渲染/点击切换（知识探索 on）/切群聊 2 项（会议 on）/切回单聊 4 项恢复（active 保留）/旧下拉 0 残留；截图 b91-mode-segmented.png
