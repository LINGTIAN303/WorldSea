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
