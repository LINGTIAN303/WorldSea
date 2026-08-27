# useMessageWindowing.ts 详细注释

> 来源：`packages/shared-ui/src/agent/message-list/useMessageWindowing.ts`
> 说明：本文件为 useMessageWindowing 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-13 行）

````
/**
 * 消息列表渲染窗口化 + 滚动锚定 composable。
 *
 * 职责：
 * 1. 渲染窗口化：只渲染视口附近 [visibleStart, visibleEnd) 区间内的 item，
 *    区间外用占位 div 撑开滚动条高度，避免长对话 DOM 节点爆炸。
 *    采用前缀和 + 二分查找（O(log n)）定位滚动位置，替代原 O(n) 遍历。
 * 2. 滚动锚定：用户向上浏览历史时新消息不强制拉回底部，改为显示"回到底部"按钮 + 新消息计数。
 * 3. 可见性观察：IntersectionObserver 维护 visibleMsgIds（供点状导航/深度用户条高亮），
 *    MutationObserver 增量化 observe 新消息节点，ResizeObserver 测量真实高度缓存到前缀和。
 *
 * 本 composable 只提供"机制"，自动滚动的"触发时机"由调用方通过 scheduleScrollToBottom 接入。
 */
````

## 止血包修复（2026-08-25，输出区不稳定治理）

用户实测反馈"输出区极不稳定、行段渲染效果极差"，根因诊断与修复记录：

### 修复 ① 判底阈值动态化
- 原实现：`floor - scrollTop <= 60` 固定 60px 判定"在底部"。
- 问题：流式 markdown 是**块级展开**（代码块/表格渲染完成瞬间高度暴涨数百 px），在跟随滚动的延迟窗口内差值远超 60px → `onScroll` 误判"读者离开底部" → `isAtBottom=false` → 窗口 end 收缩 → `bottomPlaceholderHeight` 从 0 变正 → scrollHeight 跳变 → 跟随时断时续、按钮反复横跳。
- 修复：`bottomThreshold(viewportH) = max(60, viewportH * 0.15)`，视口 800px 时阈值 120px。

### 修复 ② 高度缓存改行 id 作 key
- 原实现：`measuredHeights: Map<index, height>` 以**数组下标**为 key。
- 问题：事件行流是动态数组，切会话/回源重建（`rebuildStreamFromMessages`）后行序变化 → 高度张冠李戴 → 前缀和错 → 占位高度错 → 滚动位置跳屏。
- 修复：改 `Map<id, height>`；ResizeObserver 回调直接 `set(msgId, height)`，顺带省掉原 O(n) findIndex 反查。

### 修复 ③ estimateHeight 行级分桶估算
- 原实现：未测量行统一用全局平均高度 `avgMeasuredHeight` 估算。
- 问题：事件行高度分布极端不均（tool 行 ~32px vs 长 markdown 行数千 px），平均值两头失真 → 窗口切片范围与占位高度大幅偏差。
- 修复：新增可选参数 `estimateHeight?: (row) => number | undefined`，调用方（AgentMessageList）按行类型分桶：tool=32 / divider=33 / think=60，user/assistant 回落全局平均。优先级：测量值 > 分桶估算 > 全局平均。

### 修复 ④ 跟随滚动去内部延迟
- 原实现：`scheduleScrollToBottom` 内部 `setTimeout(50ms)` 再 `nextTick(scrollToBottom)`。
- 问题：调用方（AgentMessageList）已用 watchDebounced 节流 30-50ms，双重延迟让跟随显著滞后于流式内容增长，表现为视口被内容周期性推挤。
- 修复：去掉内部 setTimeout，直接 `nextTick(scrollToBottom)`（写入后同步记账 observedTop）。

### 配套修复（同批其它文件）
- `AgentMessageList.vue`：`.messages-scroll` 加 `overflow-anchor: none`——禁用浏览器原生 scroll anchoring，避免其与自制锚定（observedTop 账本）互相打架导致 scrollTop 突变。
- `AgentStreamList.vue`：入场动画治理——`ws-stream-row-enter` 仅挂"真正新追加"的行（seenIds 机制；首屏水合与整表替换静默渲染），消除滚动浏览历史/切会话时的整屏行闪烁（原实现所有行挂载即播 CSS animation，窗口切片每次移动边界都会让新进行重播渐入）。

### 遗留（中期加固项，未在本批处理）
- 流式期间 assistant 行高度每帧变化 → ResizeObserver 每帧触发 `rebuildPrefixSums` → `start>0` 时 topPlaceholder 抖动。方向：isStreaming 期间冻结重建，message_end 后一次重建。
- 每个 delta 全量替换 agentStream 数组 + markdown 每帧全量重解析 + v-html 整树替换。方向：v-memo / 行 id 稳定化 / markdown 增量渲染。
