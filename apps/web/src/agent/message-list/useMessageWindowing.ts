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
import { ref, computed, shallowRef, watch, nextTick, onMounted, onBeforeUnmount, type Ref } from 'vue'
import type { AgentMessage } from '@agent/index'
import { findAssistantAfterUserMsg, type DisplayItem } from './utils'

// 窗口化常量
const WINDOW_BUFFER = 20          // 视口上下各保留 20 条缓冲，减少滚动时频繁切换
const INITIAL_RENDER_COUNT = 50   // 初始渲染最近 50 条（覆盖大多数对话首屏）
const ESTIMATED_ITEM_HEIGHT = 80  // 未测量过的 item 估算高度（px）

export function useMessageWindowing(options: {
  container: Ref<HTMLDivElement | undefined>
  fullDisplayItems: Ref<DisplayItem[]>
  messages: Ref<AgentMessage[]>
  isDeepMode: Ref<boolean>
}) {
  const { container, fullDisplayItems, messages, isDeepMode } = options

  // ===== 窗口化状态 =====
  const visibleStart = ref(0)
  const visibleEnd = ref(INITIAL_RENDER_COUNT)
  // 已测量的 item 高度缓存（Map<index, height>），首次渲染后由 ResizeObserver 填充
  const measuredHeights = new Map<number, number>()
  let resizeObserver: ResizeObserver | null = null
  let scrollRafId: number | null = null

  // 前缀和数组 + 动态平均高度：O(log n) 二分查找 + O(1) 占位高度计算
  // prefixSums[i] = 前 i 个 item 的累计高度；item i 的顶部位置 = prefixSums[i]
  const prefixSums = shallowRef<Float64Array | null>(null)
  // 已测量 item 的平均高度（非响应式，仅 rebuildPrefixSums 内部使用）
  let avgMeasuredHeight = ESTIMATED_ITEM_HEIGHT
  let rebuildRafId: number | null = null

  // ===== 滚动锚定状态 =====
  const isAtBottom = ref(true)
  const showScrollToBottomBtn = ref(false)
  const newMsgCountWhileAway = ref(0)
  const lastSeenLength = ref(0)

  // ===== 可见消息 ID 集合（供点状导航/深度用户条高亮） =====
  const visibleMsgIds = ref<Set<string>>(new Set())

  interface WindowedItems {
    items: DisplayItem[]
    topPlaceholderHeight: number
    bottomPlaceholderHeight: number
  }

  // ===== Observer 句柄 =====
  let scrollObserver: IntersectionObserver | null = null
  let mutationObserver: MutationObserver | null = null
  // 已观察过的消息节点集合，避免 MutationObserver 重复 observe
  const observedMsgEls = new WeakSet<Element>()
  let scrollTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * 重建前缀和数组 + 计算已测量 item 平均高度。
   * 调用时机：ResizeObserver 测量到新高度后、fullDisplayItems 长度变化后。
   * 复杂度 O(n)，但 Float64Array 数组运算极快（1000 项 < 0.1ms）。
   */
  function rebuildPrefixSums(): void {
    rebuildRafId = null
    const total = fullDisplayItems.value.length
    if (total === 0) {
      prefixSums.value = null
      avgMeasuredHeight = ESTIMATED_ITEM_HEIGHT
      return
    }
    // 计算已测量 item 的平均高度，作为未测量 item 的估算值（比固定 80px 更精准）
    let measuredTotal = 0
    let measuredCount = 0
    measuredHeights.forEach((h) => {
      measuredTotal += h
      measuredCount++
    })
    avgMeasuredHeight = measuredCount > 0
      ? measuredTotal / measuredCount
      : ESTIMATED_ITEM_HEIGHT

    // 构建前缀和：prefixSums[i] = sum of height(item[0..i-1])
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
   * 二分查找：定位 scrollTop 对应的 item 索引。
   * 找到最大的 i 使得 prefixSums[i] <= scrollTop。复杂度 O(log n)。
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

  const windowedDisplayItems = computed<WindowedItems>(() => {
    const all = fullDisplayItems.value
    const total = all.length
    // 流式输出期间，最后一条消息（正在生成）必须始终在窗口内，确保用户可见
    let end = Math.min(visibleEnd.value, total)
    // 若在底部跟随状态，强制 end 覆盖到最后一条
    if (isAtBottom.value && end < total) end = total
    const start = Math.min(visibleStart.value, end)
    const items: DisplayItem[] = []
    for (let i = start; i < end; i++) {
      items.push({ ...all[i], _windowIndex: i })
    }
    // O(1) 占位高度：前缀和直接取值，替代原 O(n) 遍历累加
    const sums = prefixSums.value
    const topPlaceholderHeight = sums ? sums[start] : 0
    const bottomPlaceholderHeight = sums ? sums[total] - sums[end] : 0
    return { items, topPlaceholderHeight, bottomPlaceholderHeight }
  })

  /** 根据滚动位置更新可见窗口。性能：rAF 节流 + 二分查找 O(log n)。 */
  function updateVisibleRange(): void {
    const scroll = getScrollEl()
    if (!scroll) return
    const scrollTop = scroll.scrollTop
    const viewportH = scroll.clientHeight
    const all = fullDisplayItems.value
    const total = all.length
    if (total === 0) return

    const sums = prefixSums.value
    if (!sums) return

    // 二分查找 O(log n) 定位 scrollTop 和视口底部对应的 item 索引
    const estimatedStart = findIndexAtScroll(scrollTop)
    const estimatedEnd = findIndexAtScroll(scrollTop + viewportH)

    const newStart = Math.max(0, estimatedStart - WINDOW_BUFFER)
    let newEnd = Math.min(total, estimatedEnd + WINDOW_BUFFER)
    // 流式跟随状态：确保窗口覆盖到底部
    if (isAtBottom.value) newEnd = total
    if (newStart !== visibleStart.value || newEnd !== visibleEnd.value) {
      visibleStart.value = newStart
      visibleEnd.value = newEnd
    }
  }

  function getScrollEl(): HTMLElement | null {
    const c = container.value
    if (!c) return null
    return c.querySelector('.messages-scroll') as HTMLElement | null
  }

  function onScroll(): void {
    const scroll = getScrollEl()
    if (!scroll) return
    // 更新 isAtBottom（距底部 < 60px 视为在底部）
    const distanceToBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight
    const wasAtBottom = isAtBottom.value
    isAtBottom.value = distanceToBottom < 60
    // 从底部离开时，显示"回到底部"按钮
    if (wasAtBottom && !isAtBottom.value) {
      showScrollToBottomBtn.value = true
    }
    // 回到底部时，清除按钮和计数
    if (!wasAtBottom && isAtBottom.value) {
      showScrollToBottomBtn.value = false
      newMsgCountWhileAway.value = 0
    }
    // rAF 节流更新窗口
    if (scrollRafId !== null) return
    scrollRafId = requestAnimationFrame(() => {
      scrollRafId = null
      updateVisibleRange()
    })
  }

  function scrollToBottom(): void {
    const scroll = getScrollEl()
    if (scroll) scroll.scrollTop = scroll.scrollHeight
  }

  function jumpToBottom(): void {
    scrollToBottom()
    isAtBottom.value = true
    showScrollToBottomBtn.value = false
    newMsgCountWhileAway.value = 0
    // 跳到底部时扩展窗口覆盖到底部
    visibleEnd.value = fullDisplayItems.value.length
  }

  /**
   * 滚动锚定：仅当用户在底部跟随状态时才自动滚到底部。
   * 用户向上滚动浏览历史时，新消息不会强制拉回视图，改为累加新消息计数。
   * 由调用方在消息/段落/结论变化时触发。
   */
  function scheduleScrollToBottom(): void {
    if (!isAtBottom.value) {
      const newCount = messages.value.length - lastSeenLength.value
      if (newCount > 0) newMsgCountWhileAway.value += newCount
      lastSeenLength.value = messages.value.length
      return
    }
    lastSeenLength.value = messages.value.length
    if (scrollTimer) clearTimeout(scrollTimer)
    scrollTimer = setTimeout(() => nextTick(scrollToBottom), 50)
  }

  /** 跳转到指定消息（深度模式下跳转到对应的助手回复） */
  function scrollToMessage(id: string): void {
    const containerEl = container.value
    if (!containerEl) return
    // 深度模式下，用户消息不在 DOM 中，跳转到对应的助手回复
    const targetId = isDeepMode.value
      ? (findAssistantAfterUserMsg(messages.value, id) || id)
      : id
    // 窗口化改造：目标消息可能不在当前窗口内（占位状态），需先扩展窗口再滚动
    const all = fullDisplayItems.value
    const targetIndex = all.findIndex(item => item.type === 'message' && item.msg?.id === targetId)
    if (targetIndex >= 0 && (targetIndex < visibleStart.value || targetIndex >= visibleEnd.value)) {
      // 目标在窗口外，扩展窗口覆盖目标附近
      visibleStart.value = Math.max(0, targetIndex - WINDOW_BUFFER)
      visibleEnd.value = Math.min(all.length, targetIndex + WINDOW_BUFFER * 2)
      // 等待 DOM 更新后再滚动
      nextTick(() => {
        const el = containerEl.querySelector(`[data-msg-id="${targetId}"]`) as HTMLElement | null
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      })
      return
    }
    const el = containerEl.querySelector(`[data-msg-id="${targetId}"]`) as HTMLElement | null
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  /**
   * 增量化 observe：只对新出现的 [data-msg-id] 节点调用 observe。
   * 性能优化：替代原"每次 messages.length 变化都 querySelectorAll 全量重 observe"的实现。
   */
  function observeMsgEls(root: Element): void {
    if (!scrollObserver) return
    for (const el of root.querySelectorAll('[data-msg-id]')) {
      if (!observedMsgEls.has(el)) {
        scrollObserver.observe(el)
        observedMsgEls.add(el)
      }
    }
  }

  function setupScrollObserver(): void {
    // 清理旧 observer（仅在组件卸载或容器变更时调用）
    if (scrollObserver) { scrollObserver.disconnect(); scrollObserver = null }
    if (mutationObserver) { mutationObserver.disconnect(); mutationObserver = null }

    const containerEl = container.value
    if (!containerEl) return
    const scrollRoot = containerEl.querySelector('.messages-scroll') as HTMLElement || containerEl

    scrollObserver = new IntersectionObserver(
      (entries) => {
        // 增量更新 visibleMsgIds，避免每次都 new Set(...) 复制整个集合
        let changed = false
        const next = new Set(visibleMsgIds.value)
        for (const entry of entries) {
          const msgId = (entry.target as HTMLElement).dataset?.msgId
          if (msgId) {
            if (entry.isIntersecting) {
              if (!next.has(msgId)) { next.add(msgId); changed = true }
            } else {
              if (next.has(msgId)) { next.delete(msgId); changed = true }
            }
          }
        }
        if (changed) visibleMsgIds.value = next
      },
      { root: scrollRoot, threshold: 0.5 }
    )

    // 初始全量 observe（仅首次或重连时一次）
    observeMsgEls(scrollRoot)

    // 用 MutationObserver 监听子节点新增，增量化 observe 新消息节点
    // 替代原 watch(messages.length) + nextTick(setupScrollObserver) 的全量重做
    mutationObserver = new MutationObserver((mutations) => {
      if (!scrollObserver) return
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue
          const el = node as Element
          // 新增节点本身可能是消息，也可能是包含多个消息的容器
          if (el.hasAttribute && el.hasAttribute('data-msg-id')) {
            if (!observedMsgEls.has(el)) {
              scrollObserver.observe(el)
              observedMsgEls.add(el)
              // 同时 observe 高度变化，用于窗口化高度缓存
              if (resizeObserver) resizeObserver.observe(el)
            }
          }
          // 也观察后代中的消息节点
          if (el.querySelectorAll) {
            for (const child of el.querySelectorAll('[data-msg-id]')) {
              if (!observedMsgEls.has(child)) {
                scrollObserver.observe(child)
                observedMsgEls.add(child)
                if (resizeObserver) resizeObserver.observe(child)
              }
            }
          }
        }
      }
    })
    mutationObserver.observe(scrollRoot, { childList: true, subtree: true })
  }

  // 保留原 watch 用于首次挂载或消息从 0→N 时的初始化（此时 MutationObserver 可能还未挂上）
  // 但不再每次 length 变化都 disconnect + 全量 querySelectorAll
  watch(() => messages.value.length, (newLen, oldLen) => {
    // 仅在 observer 尚未初始化，或消息从 0→N（首条消息）时重新 setup
    if (!scrollObserver || (oldLen === 0 && newLen > 0)) {
      nextTick(() => setupScrollObserver())
    }
    // 其他情况由 MutationObserver 增量处理，无需手动干预
  })

  // 消息列表长度变化时（新消息到来/筛选切换），重建前缀和
  // immediate: true 保证组件初始化时就构建一次前缀和
  watch(() => fullDisplayItems.value.length, () => {
    scheduleRebuildPrefixSums()
  }, { immediate: true })

  onMounted(() => {
    nextTick(() => {
      setupScrollObserver()
      // 绑定 scroll 监听用于窗口化 + 滚动锚定
      const scroll = getScrollEl()
      if (scroll) {
        scroll.addEventListener('scroll', onScroll, { passive: true })
        // 初始化 ResizeObserver：测量已渲染 item 的真实高度，缓存到 measuredHeights
        // 用于提升窗口化滚动估算的准确性，减少跳屏
        resizeObserver = new ResizeObserver((entries) => {
          for (const entry of entries) {
            const el = entry.target as HTMLElement
            const msgId = el.dataset?.msgId
            if (msgId) {
              // 找到该消息在 fullDisplayItems 中的索引，缓存真实高度
              const idx = fullDisplayItems.value.findIndex(item => item.type === 'message' && item.msg?.id === msgId)
              if (idx >= 0) {
                measuredHeights.set(idx, entry.contentRect.height)
              }
            }
          }
          // 测量到新高度后，重建前缀和（rAF 合并，避免过度重建）
          scheduleRebuildPrefixSums()
        })
        // 对当前已渲染的消息节点 observe（后续新节点由 MutationObserver 增量 observe）
        for (const el of scroll.querySelectorAll('[data-msg-id]')) {
          resizeObserver.observe(el)
        }
      }
    })
  })

  onBeforeUnmount(() => {
    if (scrollObserver) { scrollObserver.disconnect(); scrollObserver = null }
    if (mutationObserver) { mutationObserver.disconnect(); mutationObserver = null }
    if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null }
    if (scrollRafId !== null) { cancelAnimationFrame(scrollRafId); scrollRafId = null }
    if (rebuildRafId !== null) { cancelAnimationFrame(rebuildRafId); rebuildRafId = null }
    if (scrollTimer) { clearTimeout(scrollTimer); scrollTimer = null }
    // 移除 scroll 监听
    const scroll = getScrollEl()
    if (scroll) scroll.removeEventListener('scroll', onScroll)
  })

  return {
    // 窗口化
    windowedDisplayItems,
    // 滚动锚定
    isAtBottom,
    showScrollToBottomBtn,
    newMsgCountWhileAway,
    // 可见性
    visibleMsgIds,
    // 操作
    onScroll,
    jumpToBottom,
    scrollToBottom,
    scrollToMessage,
    scheduleScrollToBottom,
  }
}
