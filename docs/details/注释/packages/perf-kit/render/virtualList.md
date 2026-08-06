# virtualList.ts 详细注释

> 来源：`packages/perf-kit/src/render/virtualList.ts`
> 说明：本文件为 virtualList 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 3-20 行）

````
/**
 * 通用虚拟滚动 hook：只渲染视口附近 [start, end) 区间内的 item，
 * 区间外用占位 div 撑开滚动条高度，避免长列表 DOM 节点爆炸。
 *
 * 高度策略：先按 estimatedHeight 估算，滚动后由 ResizeObserver 测量真实高度，
 * 用前缀和 + 二分查找（O(log n)）定位滚动位置，rAF 合并滚动更新。
 * 适用于看板列等高度不固定的卡片列表。
 *
 * 用法：
 *   const { visibleItems, topPlaceholderHeight, bottomPlaceholderHeight, onScroll, containerRef } =
 *     useVirtualList({ items: cards, estimatedHeight: 96 })
 *
 *   <div ref="containerRef" class="scroll" @scroll.passive="onScroll">
 *     <div :style="{ height: topPlaceholderHeight + 'px' }" />
 *     <div v-for="item in visibleItems" :key="item.id">{{ item.name }}</div>
 *     <div :style="{ height: bottomPlaceholderHeight + 'px' }" />
 *   </div>
 */
````
