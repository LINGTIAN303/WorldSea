import { ref, shallowRef, computed, watch, onBeforeUnmount, onMounted, type Ref } from 'vue'

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
export function useVirtualList<T extends { id: string }>(options: {
  items: Ref<T[]>
  /** 未测量 item 的估算高度（px），默认 96 */
  estimatedHeight?: number
  /** 视口上下各保留的缓冲条数，减少滚动时频繁切换，默认 10 */
  buffer?: number
}) {
  const { items, estimatedHeight = 96, buffer = 10 } = options

  const containerRef = ref<HTMLElement | undefined>()
  const visibleStart = ref(0)
  const visibleEnd = ref(0)

  // 已测量 item 的高度缓存（Map<index, height>），首次渲染后由 ResizeObserver 填充
  const measuredHeights = new Map<number, number>()
  // 前缀和：prefixSums[i] = 前 i 个 item 的累计高度，item i 的顶部位置 = prefixSums[i]
  const prefixSums = shallowRef<Float64Array | null>(null)
  // 已测量 item 的平均高度（非响应式，仅 reBuild 内部使用）
  let avgMeasuredHeight = estimatedHeight

  let resizeObserver: ResizeObserver | null = null
  let scrollRafId: number | null = null
  let rebuildRafId: number | null = null

  /** 重建前缀和数组 + 计算平均高度。O(n)，Float64Array 数组运算极快。 */
  function rebuildPrefixSums(): void {
    rebuildRafId = null
    const total = items.value.length
    if (total === 0) {
      prefixSums.value = null
      avgMeasuredHeight = estimatedHeight
      return
    }
    let measuredTotal = 0
    let measuredCount = 0
    measuredHeights.forEach((h) => { measuredTotal += h; measuredCount++ })
    avgMeasuredHeight = measuredCount > 0 ? measuredTotal / measuredCount : estimatedHeight

    const sums = new Float64Array(total + 1)
    sums[0] = 0
    const avg = avgMeasuredHeight
    for (let i = 0; i < total; i++) {
      sums[i + 1] = sums[i] + (measuredHeights.get(i) ?? avg)
    }
    prefixSums.value = sums
  }

  /** rAF 合并重建：同一帧内多次测量变化只重建一次前缀和 */
  function scheduleRebuildPrefixSums(): void {
    if (rebuildRafId !== null) return
    rebuildRafId = requestAnimationFrame(rebuildPrefixSums)
  }

  /**
   * 二分查找：定位 scrollTop 对应的 item 索引。O(log n)。
   * 找到最大的 i 使得 prefixSums[i] <= scrollTop。
   */
  function findIndexAtScroll(scrollTop: number): number {
    const sums = prefixSums.value
    if (!sums || sums.length <= 1) return 0
    let lo = 0
    let hi = sums.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (sums[mid] <= scrollTop) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  /** 根据滚动位置更新可见窗口。rAF 节流 + 二分查找 O(log n)。 */
  function updateVisibleRange(): void {
    const el = containerRef.value
    if (!el) return
    const total = items.value.length
    if (total === 0) return
    const sums = prefixSums.value
    if (!sums) return

    const estimatedStart = findIndexAtScroll(el.scrollTop)
    const estimatedEnd = findIndexAtScroll(el.scrollTop + el.clientHeight)

    const newStart = Math.max(0, estimatedStart - buffer)
    const newEnd = Math.min(total, estimatedEnd + buffer)
    if (newStart !== visibleStart.value || newEnd !== visibleEnd.value) {
      visibleStart.value = newStart
      visibleEnd.value = newEnd
    }
  }

  function onScroll(): void {
    if (scrollRafId !== null) return
    scrollRafId = requestAnimationFrame(() => {
      scrollRafId = null
      updateVisibleRange()
    })
  }

  /** 可见窗口内的 item 列表（携带原始 index 供 key 使用） */
  const visibleItems = computed(() => {
    const all = items.value
    const total = all.length
    const start = Math.min(visibleStart.value, total)
    const end = Math.min(visibleEnd.value, total)
    const arr: T[] = []
    for (let i = start; i < end; i++) arr.push(all[i])
    return arr
  })

  /** 顶部占位高度（px） */
  const topPlaceholderHeight = computed(() => {
    const sums = prefixSums.value
    return sums ? sums[Math.min(visibleStart.value, items.value.length)] : 0
  })

  /** 底部占位高度（px） */
  const bottomPlaceholderHeight = computed(() => {
    const sums = prefixSums.value
    if (!sums) return 0
    const total = items.value.length
    return sums[total] - sums[Math.min(visibleEnd.value, total)]
  })

  function setupResizeObserver(): void {
    const el = containerRef.value
    if (!el) return

    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const target = entry.target as HTMLElement
        const idx = target.dataset?.virtualIndex
        if (idx !== undefined) {
          const n = Number(idx)
          if (Number.isFinite(n)) measuredHeights.set(n, entry.contentRect.height)
        }
      }
      scheduleRebuildPrefixSums()
    })
    // 对当前已渲染的 item 节点 observe（后续新节点由容器滚动后重新渲染）
    for (const node of Array.from(el.querySelectorAll('[data-virtual-index]'))) {
      resizeObserver.observe(node)
    }
  }

  // items 变化（异步加载 / 删除 / 排序）时重建前缀和并刷新可见范围。
  // 关键：挂载时 items 往往为空，数据加载完成后必须在此补齐首屏渲染，
  // 否则 visibleEnd 恒为 0，列表会一直空白。
  watch(items, () => {
    rebuildPrefixSums()
    const el = containerRef.value
    if (el && visibleEnd.value === 0 && items.value.length > 0) {
      const viewportH = el.clientHeight ?? 0
      const count = Math.max(1, Math.ceil(viewportH / estimatedHeight) + buffer * 2)
      visibleStart.value = 0
      visibleEnd.value = Math.min(items.value.length, count)
    }
    updateVisibleRange()
  })

  onMounted(() => {
    rebuildPrefixSums()
    // 初始渲染首屏（按估算高度覆盖视口）
    const el = containerRef.value
    const viewportH = el?.clientHeight ?? 0
    const count = Math.max(1, Math.ceil(viewportH / estimatedHeight) + buffer * 2)
    visibleStart.value = 0
    visibleEnd.value = Math.min(items.value.length, count)
    if (el) {
      setupResizeObserver()
    }
  })

  onBeforeUnmount(() => {
    if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null }
    if (scrollRafId !== null) { cancelAnimationFrame(scrollRafId); scrollRafId = null }
    if (rebuildRafId !== null) { cancelAnimationFrame(rebuildRafId); rebuildRafId = null }
  })

  return {
    containerRef,
    visibleStartIndex: visibleStart,
    visibleItems,
    topPlaceholderHeight,
    bottomPlaceholderHeight,
    onScroll,
  }
}