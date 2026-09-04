/** 消息列表渲染窗口化 + 滚动锚定 composable（前缀和二分定位 + 回到底部按钮）。泛化接收任意「含唯一 id 的事件行数组」（对齐 Agent 事件行流），详细见 docs/details/注释/packages/shared-ui/agent/message-list/useMessageWindowing.md */
import { ref, computed, shallowRef, watch, nextTick, onMounted, onBeforeUnmount, type Ref } from 'vue'
import type { AgentMessage } from '@worldsmith/agent-runtime'

// 窗口化常量
const WINDOW_BUFFER = 20          // 视口上下各保留 20 条缓冲，减少滚动时频繁切换
const INITIAL_RENDER_COUNT = 50   // 初始渲染最近 50 条（覆盖大多数对话首屏）
const ESTIMATED_ITEM_HEIGHT = 80  // 未测量过的 item 估算高度（px）
/** 结构突变保底抑制期（ms）：突变瞬间新行未测、前缀和含估算误差，此窗口内 RO 重建
 *  **不做 scrollTop 锚定补偿**——结构突变瞬间用「突变前布局采集的 offset」补偿会算出
 *  荒谬目标值（实测曾把 scrollTop 设成负数 → clamp → 回顶）。 */
const REBUILD_ANCHOR_SUPPRESS_MS = 380
/** 走查 S2（2026-09-05）测量静默判定（收敛信号）：RO 回调静默超此时长视为测量收敛——
 *  保底期（380ms）之外，测量若仍活跃（静默 < 120ms，即仍在逐帧收敛）则继续抑制，
 *  收敛后提前解除。原固定 380ms 在慢机器/长会话上不够（抖动回归），此为自适应补丁。 */
const MEASURE_QUIET_MS = 120

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
  /** 2026-09-05 导航点激活推导：用户消息 id 集合（AgentMessageList 由 userMessages 派生） */
  userMsgIds?: Ref<Set<string>>
}) {
  const { container, items, messages, estimateHeight, userMsgIds } = options

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
  /** 2026-09-05 导航点端点高亮：视口贴顶判定（scrollTop ≤ 2px），供 DotNav 亮首条用户消息 */
  const atTop = ref(true)
  const showScrollToBottomBtn = ref(false)
  const newMsgCountWhileAway = ref(0)
  const lastSeenLength = ref(0)
  /** [③] 滚动归属账本：记录程序化写入的 scrollTop，区分读者滚动 vs 程序化滚动（对齐 Harness observedTopRef）；非响应式普通变量 */
  let observedTop = 0
  /** 走查 S2：最近一次 RO 测量批次时刻（收敛信号判定用） */
  let lastMeasurementAt = 0

  /** 抑制判定（走查 S2）：突变保底期内，或测量仍在活跃收敛（静默 < 120ms）时为真 */
  function isMeasureSuppressActive(): boolean {
    return (
      Date.now() - lastStructuralChangeAt < REBUILD_ANCHOR_SUPPRESS_MS ||
      Date.now() - lastMeasurementAt < MEASURE_QUIET_MS
    )
  }

  /**
   * 走查 S3（2026-09-05）视口顶部基准行采集——锚定补偿共用工具：
   * 返回首个 bottom 越过视口顶的可见行（id + 相对视口顶偏移）。过滤 v-show 隐藏行
   * （rect 全 0，满足 bottom>=topY，会被误选为锚 → 抖动修复⑯ 同规则）。
   * 此前 rebuild 锚定 / 切窗锚定两处各自实现，曾因只改一处漏掉另一处出过回归。
   */
  function collectTopAnchorRow(scroll: HTMLElement): { id: string | null; offset: number } {
    const topY = scroll.getBoundingClientRect().top
    for (const el of scroll.querySelectorAll('[data-msg-id]')) {
      if ((el as HTMLElement).offsetParent === null) continue
      const r = el.getBoundingClientRect()
      if (r.bottom >= topY) {
        return { id: el.getAttribute('data-msg-id'), offset: r.top - topY }
      }
    }
    return { id: null, offset: 0 }
  }

  // ===== 可见消息 ID 集合（供点状导航/深度用户条高亮） =====
  const visibleMsgIds = ref<Set<string>>(new Set())
  /** 2026-09-05 导航点激活推导：视口顶基准线之上最后一条用户消息（目录高亮语义，滚动无缝交接） */
  const activeUserMsgId = ref('')

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
   * 调用时机：ResizeObserver 测量到新高度后（anchor=true）、items 长度变化后（anchor=false）。
   * 复杂度 O(n)，但 Float64Array 数组运算极快（1000 项 < 0.1ms）。
   * 抖动修复⑨（2026-09-04）：锚定补偿只在「测量收敛」（同一行高度从估算转实测）时生效——
   * 结构突变（items 长度变化，如过程层折叠/展开：摘要行 ⇄ N 条内容行）时**不锚定**：
   * 该场景视口首行本应随插入/移除内容自然上下移位，强行锚定回原位会把视口硬拽（回顶/跳变）。
   * 结构突变的滚动稳定由宿主的 withProcessAnchor（结果层锚定）负责。
   */
  function rebuildPrefixSums(anchor: boolean): void {
    rebuildRafId = null
    const total = items.value.length
    if (total === 0) {
      prefixSums.value = null
      avgMeasuredHeight = ESTIMATED_ITEM_HEIGHT
      return
    }
    // 重建前：记录视口顶部对应的行（DOM 锚定，比前缀和索引稳定）——仅 anchor=true 时收集
    const scroll = getScrollEl()
    let anchorRowId: string | null = null
    let anchorDomOffset = 0 // 视口顶到该行 top 的真实像素偏移（补偿基准）
    if (anchor && scroll) {
      const collected = collectTopAnchorRow(scroll)
      anchorRowId = collected.id
      anchorDomOffset = collected.offset
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

  /** rAF 合并重建：同一帧内多次测量变化只重建一次前缀和。anchor=true 时重建带视口首行锚定补偿。
   *  并发时序：结构突变（false）与测量收敛（true）可能同一帧到达，后者覆盖前者——以最近一次请求为准。 */
  let rebuildAnchorPending = true
  function scheduleRebuildPrefixSums(anchor: boolean): void {
    rebuildAnchorPending = anchor
    if (rebuildRafId !== null) return
    rebuildRafId = requestAnimationFrame(() => {
      rebuildPrefixSums(rebuildAnchorPending)
    })
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
    // 抖动修复⑩（2026-09-04）：items 突变瞬间前缀和尚未重建时（旧长度不匹配），
    // sums[total]/sums[end] 会越界取 undefined → NaN 占位高度 → 布局错乱闪烁。
    // 长度不匹配时回退 0 占位（等 flush-sync 重建完成即正确）。
    const sums = prefixSums.value
    const sumsValid = sums && sums.length - 1 === total
    const topPlaceholderHeight = sumsValid ? sums[start] : 0
    const bottomPlaceholderHeight = sumsValid ? sums[total] - sums[end] : 0
    return { items: windowed, topPlaceholderHeight: topPlaceholderHeight as number, bottomPlaceholderHeight: bottomPlaceholderHeight as number }
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

    // 2026-09-05 导航点激活推导（放早退之前：纯滚动不切窗时也要更新）——视口顶基准线
    //（top+40px，贴近阅读位）之上最后一条用户消息。目录高亮语义：激活点随基准线跨越
    // 无缝交接，任意时刻恰一条；不依赖 IO 可见性（阈值判定在相邻消息交替处有空档）。
    if (userMsgIds && userMsgIds.value.size > 0) {
      const navTopY = scroll.getBoundingClientRect().top
      let found = ''
      for (const el of scroll.querySelectorAll('[data-msg-id]')) {
        if ((el as HTMLElement).offsetParent === null) continue
        const id = el.getAttribute('data-msg-id') ?? ''
        if (!userMsgIds.value.has(id)) continue
        if (el.getBoundingClientRect().top <= navTopY + 40) found = id
      }
      activeUserMsgId.value = found
    }

    const sums = prefixSums.value
    if (!sums) return

    // 二分查找 O(log n) 定位 scrollTop 和视口底部对应的 item 索引
    const estimatedStart = findIndexAtScroll(scrollTop)
    const estimatedEnd = findIndexAtScroll(scrollTop + viewportH)
    // 抖动修复⑫-b：窗口边界加保守垫——二分基于前缀和估算，未测行（窗口外）低估会让
    // 边界偏前，把视口底部真实行切到占位 → 一帧收缩 + clamp。上/下各多留一个屏幕
    //（BUFFER * 2）吸收估算误差，宁可多渲染一行也不切掉视口边缘。
    const newStart = Math.max(0, estimatedStart - WINDOW_BUFFER * 2)
    let newEnd = Math.min(total, estimatedEnd + WINDOW_BUFFER * 2)
    // 流式跟随状态：确保窗口覆盖到底部
    if (isAtBottom.value) newEnd = total
    if (newStart === visibleStart.value && newEnd === visibleEnd.value) return

    // 抖动修复⑬-b（2026-09-04）：切窗锚定——窗口切片重排会把窗口外真实行卸载换成占位，
    // DOM 高度一帧骤变（实测 7826→~1665）→ 浏览器 clamp scrollTop → 滚动深处"回顶/跳闪"、
    // 底部跟随断流。切窗前记录「视口首行」（DOM 实测 id + 视口偏移），切窗渲染后按实测
    // 位置补偿 scrollTop，让重排对用户无感。底部跟随态直接顺延贴底（优先级高于锚定）。
    // 非法目标值（<0 或超出滚动范围）丢弃，防 clamp 反馈链。
    // 走查 S3：视口首行采集归一到 collectTopAnchorRow（含 v-show 隐藏行过滤，原⑮-d/⑯）。
    const topY = scroll.getBoundingClientRect().top
    const { id: anchorId, offset: anchorOffset } = collectTopAnchorRow(scroll)

    visibleStart.value = newStart
    visibleEnd.value = newEnd

    if (isAtBottom.value) {
      // 抖动修复⑬-c（2026-09-04）：切窗后行重挂载首帧高度未收敛（实测文本行塌缩 4px→sh 骤降
      // → clamp）。单帧 nextTick 贴底可能在未稳帧把底部设到错误位置。双帧 + 执行时刻校验
      // 是否仍在底部附近，等行高收敛后再贴底，且不误拉已离开底部的读者。
      nextTick(() => { scrollToBottomIfNear(); })
      requestAnimationFrame(() => { scrollToBottomIfNear(); })
    } else if (anchorId) {
      nextTick(() => {
        const target = scroll.querySelector<HTMLElement>(`[data-msg-id="${CSS.escape(anchorId!)}"]`)
        if (!target) return
        const d = target.getBoundingClientRect().top - topY - anchorOffset
        const nxt = scroll.scrollTop + d
        const maxTop = scroll.scrollHeight - scroll.clientHeight
        if (Math.abs(d) > 0.5 && nxt >= 0 && nxt <= maxTop + 1) {
          scroll.scrollTop = nxt
          observedTop = scroll.scrollTop
        }
      })
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
    atTop.value = scroll.scrollTop <= 2
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

  /** 仅在仍处于底部附近时贴底（抖动修复⑬-d，2026-09-04）：
   *  程序化 set scrollTop 后 scroll 事件是异步任务，isAtBottom 账本在一帧内仍为旧值 true，
   *  windowedDisplayItems 的底部占位 watch / 切窗贴底会误把读者拽回底部。执行时刻再校验
   *  一次「此刻是否仍在底部」：读者已经离开则放弃贴底。 */
  function scrollToBottomIfNear(): void {
    const scroll = getScrollEl()
    if (!scroll) return
    const floor = scroll.scrollHeight - scroll.clientHeight
    if (floor - scroll.scrollTop > bottomThreshold(scroll.clientHeight)) return
    scrollToBottom()
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
  // 抖动修复⑨/⑩：结构突变（展开/折叠过程层等 items 增减）不锚定——scrollTop 稳定由宿主补偿负责；
  // flush:sync 让前缀和在 windowedDisplayItems computed 读取前完成重建，避免旧长度越界 (NaN 占位)。
  let lastStructuralChangeAt = 0
  // 抖动修复⑰（2026-09-05）：行数增长时同步扩展窗口尾——过程层展开（总折叠头：摘要行 ⇄ N 行段）
  // 的新行插在中部，原 [visibleStart, visibleEnd] 按索引切片会把窗口尾部既有行（结果层等）挤出
  // 窗口（索引后移），且展开不产生 scroll 事件、updateVisibleRange 不重算 → 行「丢失」，滚动
  // 一下才回来。新增多少行就扩多少窗口尾，保证原窗口覆盖的行保持覆盖；收缩方向无需处理
  //（slice 对越界 end 自动 clamp）。窗口回收交由滚动时的 updateVisibleRange 常规重算。
  watch(() => items.value.length, (newLen, oldLen) => {
    if (newLen > oldLen && !isAtBottom.value) {
      visibleEnd.value = Math.min(newLen, visibleEnd.value + (newLen - oldLen))
    }
  })
  // 抖动修复⑮（2026-09-04）：结构签名 watch——原 length watch 只在行数增减时重建，
  // 计划步骤折叠/展开（stepCollapsed 翻转，v-show 切换）与行段折叠不改变行数，
  // 前缀和与 DOM 布局脱节 → 滚动/切窗抖动。签名只编码「影响布局结构」的字段
  //（行类型 + stepCollapsed），文本内容增长（流式 delta）不触发重建。
  const structuralSignature = computed(() => {
    const arr = items.value
    if (arr.length === 0) return ''
    let sig = arr.length + ';'
    for (let i = 0; i < arr.length; i++) {
      const it = arr[i] as { type?: string; stepCollapsed?: boolean }
      const st = it.stepCollapsed === true
      const typ = it.type
      sig += (typ === 'tool' ? 't' : typ === 'think' ? 'h' : typ === 'assistant' ? 'a' : 'o') + (st ? '1' : '0')
    }
    return sig
  })
  watch(() => structuralSignature.value, (_sig, oldSig) => {
    if (_sig === oldSig) return
    lastStructuralChangeAt = Date.now()
    rebuildPrefixSums(false)
    // 抖动修复⑫-b（2026-09-04）：结构突变后等 Vue 渲染出新行，立即按 DOM 实测高度
    // 回填缓存并重建前缀和——让「估算行」最短生命周期转实测。否则后续窗口切片按
    // 低估估算做二分会切错窗口边界 → 占位收缩 → scrollHeight 骤降 → scrollTop clamp
    //（滚到底被回拽、滚动深处跳闪）。ResizeObserver 也会收敛，但它是异步逐帧的，
    // 预热测量在用户可感知的下一帧前一次到位。
    nextTick(() => {
      const sc = getScrollEl()
      if (!sc) return
      let changed = false
      for (const el of sc.querySelectorAll<HTMLElement>('[data-msg-id]')) {
        if (el.hasAttribute('data-animating')) continue
        const id = el.dataset.msgId
        if (!id) continue
        // 抖动修复⑮-b：v-show 隐藏行（计划步骤折叠的子动作等）布局高度为 0——
        // 缓存同步置 0 使前缀和与 DOM 布局一致（否则残留旧高度 → 切窗占位错位 → 抖动）；
        // 展开时 RO/预热会回写真实高度。
        if (el.offsetParent === null) {
          if (measuredHeights.get(id) !== 0) {
            measuredHeights.set(id, 0)
            changed = true
          }
          continue
        }
        const h = el.offsetHeight
        if (h > 0 && measuredHeights.get(id) !== h) {
          measuredHeights.set(id, h)
          changed = true
        }
      }
      if (changed) rebuildPrefixSums(false)
    })
  }, { immediate: true, flush: 'sync' })

  // 抖动修复⑤（2026-09-04）：底部占位高度改变（估算转实测 / 折叠升降）且用户在底部跟随态
  // → 顺延滚动贴底。旧实现只在 items.length 变化时跟随，占位高度单独变化（不增删行）
  // 会导致视口停在旧位置、新行未达底部却已无处贴 → 跳动。
  // 抖动修复⑳（2026-09-05）：结构突变抑制期内跳过占位驱动的贴底——底部展开总折叠头时
  // 大量新行未测、前缀和逐帧漂移 → 占位逐帧变 → 逐帧贴底写 scrollTop = 抖动闪烁；且用户
  // 点击展开想看的是过程层本身，视口应停在原位。流式跟随不受影响：调用方在消息/段落变化
  // 时的 scheduleScrollToBottom 触发路径保留，仅抑制占位驱动这一路。
  watch(() => windowedDisplayItems.value.bottomPlaceholderHeight, (newH, oldH) => {
    if (oldH === newH) return
    if (!isAtBottom.value) return
    if (isMeasureSuppressActive()) return
    scheduleScrollToBottom()
  })

  // 计数账本修复（2026-09-05 额外 E）：以首条消息 id 作会话标识——切会话时重置
  // lastSeenLength/newMsgCountWhileAway（旧会话的长度账对新会话无意义，newCount 乱算
  // = 回到底部按钮计数串会话）与 visibleMsgIds（旧会话残留 → 导航点高亮错乱）。
  // 流式追加不改变首条 id，不误触发。
  watch(() => messages.value[0]?.id, () => {
    lastSeenLength.value = messages.value.length
    newMsgCountWhileAway.value = 0
    visibleMsgIds.value = new Set()
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
          let skipAll = false // 本轮是否全是动画行（动画行不写缓存也不重建，防闪烁反馈环）
          for (const entry of entries) {
            const el = entry.target as HTMLElement
            // 抖动修复⑥（2026-09-04）：行段展开/收起动画（grid-rows 0fr→1fr）期间
            // 每帧测到中间高度——若写入缓存会触发前缀和每帧重建 → 切片重算 → 行卸载重挂
            // → 动画重跑 = 疯狂闪烁反馈环。动画行（data-animating）跳过测高，动画结束
            // 后有一次性测量收敛，配合④锚定兜底。
            if (el.hasAttribute('data-animating')) {
              skipAll = true
              continue
            }
            // 抖动修复⑬（2026-09-04）：窗口化切窗会把部分行从 DOM 卸载（detached），
            // ResizeObserver 对脱离文档的元素仍会回调一次且 contentRect 为 0——若把 0
            // 写进高度缓存，前缀和 sumTotal 会崩到接近 0（实测 7489→1002），占位/切片
            // 全错 → scrollHeight 骤降 → scrollTop clamp（滚到底被回拽）。detached 行
            // 跳过不写；窗口切回时元素重新挂载，RO 会再回调恢复真实高度。
            if (!el.isConnected) continue
            const msgId = el.dataset?.msgId
            // 止血包②：按行 id 直写高度缓存（原按 index 写入需 findIndex 反查，
            // 且行序变化后错位；id 键天然免疫行序变化，还省一次 O(n) 查找）
            if (msgId) {
              // 抖动修复⑮-c：v-show 隐藏行（计划步骤折叠子动作等）缓存置 0——与预热 walk
              // 同规则，保证前缀和随布局切换即时一致（否则残留旧高度 → 切窗占位错位 → 抖动）。
              if (el.offsetParent === null) {
                // 抖动修复⑲（2026-09-05）：隐藏（高度→0）是折叠操作信号——刷新抑制窗口，
                // 抑制期内 RO 重建不带锚定补偿（测量混合态下补偿 target 不可靠，区级折叠
                // 逐行隐藏 + 逐帧补偿 = 抖动跳顶）。折叠期滚动稳定交宿主 withProcessAnchor。
                if ((measuredHeights.get(msgId) ?? 0) > 0) lastStructuralChangeAt = Date.now()
                measuredHeights.set(msgId, 0)
              } else {
                const h = entry.contentRect.height
                if (h > 0) {
                  // 展开（0 → 有高度）同为结构突变信号，刷新抑制窗口
                  if (measuredHeights.get(msgId) === 0) lastStructuralChangeAt = Date.now()
                  measuredHeights.set(msgId, h)
                }
              }
            }
          }
          // 测量到新高度后，重建前缀和（rAF 合并，避免过度重建）。
          // 全部是动画行的批次跳过重建——避免动画中前缀和随中间高度漂移。
          // 非结构突变（纯测量收敛）→ 带锚定补偿（④），保持视口首行原位。
          // 抖动修复⑪（2026-09-04）：结构突变后抑制期内仍重建（前缀和要跟上新布局），
          // 但**关闭锚定补偿**——突变期新行逐个被测、前缀和逐帧漂移，锚定 target 不可靠
          // （实测会算出负数 scrollTop → clamp → 回顶）。
          if (!skipAll) {
            // 走查 S2：突变保底期 + 测量活跃期（静默 < 120ms）内抑制锚定补偿
            lastMeasurementAt = Date.now()
            if (isMeasureSuppressActive()) {
              scheduleRebuildPrefixSums(false)
            } else {
              scheduleRebuildPrefixSums(true)
            }
          }
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
    atTop,
    /** 2026-09-05 导航点激活：视口顶基准线之上最后一条用户消息（供 DotNav 连贯高亮） */
    activeUserMsgId,
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
