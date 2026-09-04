/** 消息列表渲染窗口化 + 滚动锚定 composable（前缀和二分定位 + 回到底部按钮）。泛化接收任意「含唯一 id 的事件行数组」（对齐 Agent 事件行流），详细见 docs/details/注释/packages/shared-ui/agent/message-list/useMessageWindowing.md */
import { ref, computed, shallowRef, watch, nextTick, onMounted, onBeforeUnmount, type Ref } from 'vue'
import type { AgentMessage } from '@worldsmith/agent-runtime'

// 窗口化常量
const WINDOW_BUFFER = 20          // 视口上下各保留 20 条缓冲，减少滚动时频繁切换
const INITIAL_RENDER_COUNT = 50   // 初始渲染最近 50 条（覆盖大多数对话首屏）
const ESTIMATED_ITEM_HEIGHT = 80  // 未测量过的 item 估算高度（px）

/**
 * 判底阈值：视口高度的 15%，下限 60px。
 * 流式 markdown 块级展开一次可增长数百 px，固定 60px 会在跟随延迟窗口内
 * 误判「读者离开底部」导致跟随断流（视口反复跳动的主根因）。
 */
function bottomThreshold(viewportH: number): number {
  return Math.max(60, viewportH * 0.15)
}

/** 窗口化行通用约束：每行必须暴露可直接用于锚定/高度缓存的唯一 id */
export function useMessageWindowing<Row extends { id: string }>(options: {
  container: Ref<HTMLDivElement | undefined>
  /** 事件行流的完整数组（窗口化数据源；行类型由调用方决定，仅需含 id 字段） */
  items: Ref<Readonly<Row[]>>
  messages: Ref<AgentMessage[]>
  /**
   * 行级高度估算（止血包③）：返回 undefined 回落到全局测量平均。
   * 事件行高度分布极端不均（tool 行 ~32px vs 长 markdown 行数千 px），
   * 全局平均两头失真；调用方按行类型分桶可显著提升窗口切片与占位高度准确性。
   */
  estimateHeight?: (row: Row) => number | undefined
}) {
  const { container, items, messages, estimateHeight } = options

  // ===== 窗口化状态 =====
  const visibleStart = ref(0)
  const visibleEnd = ref(INITIAL_RENDER_COUNT)
  // 已测量的 item 高度缓存（Map<id, height>），首次渲染后由 ResizeObserver 填充。
  // 止血包②：以行 id 作 key（原为数组下标——回源重建/切会话后行序变化会导致高度张冠李戴，
  // 前缀和与占位高度随之错位，滚动位置跳变）。
  const measuredHeights = new Map<string, number>()
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
  /** [③] 滚动归属账本：记录程序化写入的 scrollTop，区分读者滚动 vs 程序化滚动（对齐 Harness observedTopRef）；非响应式普通变量 */
  let observedTop = 0

  // ===== 可见消息 ID 集合（供点状导航/深度用户条高亮） =====
  const visibleMsgIds = ref<Set<string>>(new Set())

  interface WindowedItems {
    items: Row[]
    topPlaceholderHeight: number
    bottomPlaceholderHeight: number
  }

  // ===== Observer 句柄 =====
  let scrollObserver: IntersectionObserver | null = null
  let mutationObserver: MutationObserver | null = null
  // 已观察过的消息节点集合，避免 MutationObserver 重复 observe
  const observedMsgEls = new WeakSet<Element>()

  /**
   * 重建前缀和数组 + 计算已测量 item 平均高度。
   * 调用时机：ResizeObserver 测量到新高度后、items 长度变化后。
   * 复杂度 O(n)，但 Float64Array 数组运算极快（1000 项 < 0.1ms）。
   * 抖动修复④：重建前锚定视口首行（DOM 实测位置），重建后按新前缀和补偿 scrollTop，
   * 使估算转实测的前缀和偏移不再让正在阅读的视口漂移。
   */
  function rebuildPrefixSums(): void {
    rebuildRafId = null
    const total = items.value.length
    if (total === 0) {
      prefixSums.value = null
      avgMeasuredHeight = ESTIMATED_ITEM_HEIGHT
      return
    }
    // 重建前：记录视口顶部对应的行（DOM 锚定，比前缀和索引稳定）
    const scroll = getScrollEl()
    let anchorRowId: string | null = null
    let anchorDomOffset = 0 // 视口顶到该行 top 的真实像素偏移（补偿基准）
    if (scroll) {
      const topY = scroll.getBoundingClientRect().top
      for (const el of scroll.querySelectorAll('[data-msg-id]')) {
        const r = el.getBoundingClientRect()
        if (r.bottom >= topY) {
          anchorRowId = el.getAttribute('data-msg-id')
          anchorDomOffset = r.top - topY
          break
        }
      }
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
    // 优先级：测量值 > 行级分桶估算 > 全局测量平均
    const sums = new Float64Array(total + 1)
    sums[0] = 0
    const avg = avgMeasuredHeight
    const all = items.value
    for (let i = 0; i < total; i++) {
      const measured = measuredHeights.get(all[i].id)
      if (measured !== undefined) {
        sums[i + 1] = sums[i] + measured
      } else {
        const estimated = estimateHeight?.(all[i])
        sums[i + 1] = sums[i] + (estimated !== undefined ? estimated : avg)
      }
    }
    prefixSums.value = sums
    // 重建后：按新前缀和补偿 scrollTop，锚定视口首行回原位（仅在非底部跟随态有意义；
    // 底部跟随由 scrollToBottom 直接贴底，不做锚定补偿，避免与跟随竞争）
    if (scroll && anchorRowId && !isAtBottom.value) {
      const idx = all.findIndex((r) => r.id === anchorRowId)
      if (idx >= 0) {
        const newTopOfAnchor = sums[idx]
        const target = newTopOfAnchor + anchorDomOffset
        if (Math.abs(scroll.scrollTop - target) > 0.5) {
          scroll.scrollTop = target
          observedTop = target // 程序化位移记账
        }
      }
    }
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
    const all = items.value
    const total = all.length
    // 流式输出期间，最后一条（正在生成）必须始终在窗口内，确保用户可见
    let end = Math.min(visibleEnd.value, total)
    // 若在底部跟随状态，强制 end 覆盖到最后一条
    if (isAtBottom.value && end < total) end = total
    const start = Math.min(visibleStart.value, end)
    // 原样切片（不做展开/注入 _windowIndex），保留判定联合类型，由调用方行渲染器按 item.type 收敛
    const windowed = all.slice(start, end)
    // O(1) 占位高度：前缀和直接取值，替代原 O(n) 遍历累加
    const sums = prefixSums.value
    const topPlaceholderHeight = sums ? sums[start] : 0
    const bottomPlaceholderHeight = sums ? sums[total] - sums[end] : 0
    return { items: windowed, topPlaceholderHeight, bottomPlaceholderHeight }
  })

  /** 根据滚动位置更新可见窗口。性能：rAF 节流 + 二分查找 O(log n)。 */
  function updateVisibleRange(): void {
    const scroll = getScrollEl()
    if (!scroll) return
    const scrollTop = scroll.scrollTop
    const viewportH = scroll.clientHeight
    const all = items.value
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

  // 内容总高（用于检测折叠/流式收缩引起的收缩型 clamp，2026-09-04 抖动修复③）
  let lastScrollHeight = 0

  function onScroll(): void {
    const scroll = getScrollEl()
    if (!scroll) return
    // [③] flow-tip 跟随归属判定（对齐 Harness ChatView observedTopRef 语义）：
    //   记录程序化写入的 scrollTop 到 observedTopRef（滚动锚定在写入后同步记录），
    //   仅当读者输入（wheel/touch/scrollbar/键盘）导致实际位移偏离账本时才更新 isAtBottom。
    const floor = Math.max(0, scroll.scrollHeight - scroll.clientHeight)
    const movedByReader = Math.abs(scroll.scrollTop - Math.min(observedTop, floor)) > 0.5
    const wasAtBottom = isAtBottom.value
    // 抖动修复③（2026-09-04）：折叠过程层/flow 收缩致 scrollHeight 骤减 → 浏览器 clamp scrollTop，
    // 账本陈旧时误判「读者离开底部」→ 跟随断流。检测高度收缩 + 原本在底部 → 保持跟随态。
    const heightShrunk = lastScrollHeight > 0 && scroll.scrollHeight < lastScrollHeight - 1
    const isAtBottomNow = heightShrunk && wasAtBottom
      ? true // 内容收缩型 clamp：非读者意图，保持跟随
      : movedByReader
        ? floor - scroll.scrollTop <= bottomThreshold(scroll.clientHeight)
        : wasAtBottom
    lastScrollHeight = scroll.scrollHeight
    isAtBottom.value = isAtBottomNow
    // 从底部离开时，显示"回到底部"按钮
    if (wasAtBottom && !isAtBottomNow) {
      showScrollToBottomBtn.value = true
    }
    // 回到底部时，清除按钮和计数
    if (!wasAtBottom && isAtBottomNow) {
      showScrollToBottomBtn.value = false
      newMsgCountWhileAway.value = 0
    }
    // 读者滚动才记账本（程序化写入由 scrollToBottom 自行记账）
    if (movedByReader) observedTop = scroll.scrollTop
    // rAF 节流更新窗口
    if (scrollRafId !== null) return
    scrollRafId = requestAnimationFrame(() => {
      scrollRafId = null
      updateVisibleRange()
    })
  }

  function scrollToBottom(): void {
    const scroll = getScrollEl()
    if (scroll) {
      scroll.scrollTop = scroll.scrollHeight
      // [③] 程序化写入同步记账，避免 onScroll 误判为读者离开底部
      observedTop = scroll.scrollTop
    }
  }

  /**
   * 外部程序化滚动后同步账本（抖动修复②，2026-09-04）：
   * 折叠/展开补偿等外部写入 scrollTop 的路径，若不记账会被 onScroll 视为「读者离开底部」，
   * 导致 isAtBottom 误判为 false → 自动跟随断流（流式输出时表现为卡住/往复跳动）。
   * 调用方在补偿写入后调用 `syncObservedTop()` 即可告知账本「这是程序化位移，非读者滚动」。
   */
  function syncObservedTop(): void {
    const scroll = getScrollEl()
    if (scroll) observedTop = scroll.scrollTop
  }

  function jumpToBottom(): void {
    // 抖动修复①（2026-09-04）：先置跟随态 + 扩展窗口覆盖到底部，再等 DOM 渲染后滚动。
    // 旧实现先滚后扩窗——首次滚到的是扩展前的旧 scrollHeight（新行未渲染 → 不满屏），
    // 需二次点击才到底。顺序修正 + nextTick/rAF 双帧：让新行真实落 DOM 后再滚到底。
    isAtBottom.value = true
    showScrollToBottomBtn.value = false
    newMsgCountWhileAway.value = 0
    visibleEnd.value = items.value.length
    // 双帧：nextTick 等 Vue 渲染出扩展窗口的新行，rAF 再校正一次高度（图片/字体异步布局兜底）
    nextTick(() => {
      scrollToBottom()
      requestAnimationFrame(() => {
        scrollToBottom()
      })
    })
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
    // 止血包④：去掉原内部 50ms setTimeout 延迟（调用方 watchDebounced 已节流 30-50ms，
    // 双重延迟让跟随滚动显著滞后于流式内容增长，表现为视口被内容周期性推挤跳动）。
    // nextTick 确保 DOM 更新后写入 scrollTop，写入后同步记账。
    nextTick(() => { scrollToBottom(); })
  }

  /**
   * 跳转到指定事件行（去模式分叉：统一按事件行 id 锚定）。
   * 目标未渲染进窗口时，先扩展窗口覆盖目标附近，等待 DOM 更新后滚动。
   */
  function scrollToMessage(id: string): void {
    const containerEl = container.value
    if (!containerEl) return
    const all = items.value
    const targetIndex = all.findIndex(item => item.id === id)
    if (targetIndex >= 0 && (targetIndex < visibleStart.value || targetIndex >= visibleEnd.value)) {
      // 目标在窗口外，扩展窗口覆盖目标附近
      visibleStart.value = Math.max(0, targetIndex - WINDOW_BUFFER)
      visibleEnd.value = Math.min(all.length, targetIndex + WINDOW_BUFFER * 2)
      // 等待 DOM 更新后再滚动
      nextTick(() => {
        const el = containerEl.querySelector(`[data-msg-id="${id}"]`) as HTMLElement | null
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      })
      return
    }
    const el = containerEl.querySelector(`[data-msg-id="${id}"]`) as HTMLElement | null
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

  // 事件行数组长度变化时（新行到来/切换筛选），重建前缀和
  // immediate: true 保证组件初始化时就构建一次前缀和
  watch(() => items.value.length, () => {
    scheduleRebuildPrefixSums()
  }, { immediate: true })

  // 抖动修复⑤（2026-09-04）：底部占位高度改变（估算转实测 / 折叠升降）且用户在底部跟随态
  // → 顺延滚动贴底。旧实现只在 items.length 变化时跟随，占位高度单独变化（不增删行）
  // 会导致视口停在旧位置、新行未达底部却已无处贴 → 跳动。
  watch(() => windowedDisplayItems.value.bottomPlaceholderHeight, (newH, oldH) => {
    if (oldH === newH) return
    if (isAtBottom.value) scheduleScrollToBottom()
  })

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
            // 止血包②：按行 id 直写高度缓存（原按 index 写入需 findIndex 反查，
            // 且行序变化后错位；id 键天然免疫行序变化，还省一次 O(n) 查找）
            if (msgId) {
              measuredHeights.set(msgId, entry.contentRect.height)
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
    syncObservedTop,
  }
}
