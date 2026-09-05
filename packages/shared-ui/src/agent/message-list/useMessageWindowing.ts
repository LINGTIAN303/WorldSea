/** 消息列表渲染窗口化 + 滚动锚定 composable（前缀和二分定位 + 回到底部按钮）。泛化接收任意「含唯一 id 的事件行数组」（对齐 Agent 事件行流），详细见 docs/details/注释/packages/shared-ui/agent/message-list/useMessageWindowing.md */
import { ref, computed, shallowRef, watch, nextTick, onMounted, onBeforeUnmount, type Ref } from 'vue'
import type { AgentMessage } from '@worldsmith/agent-runtime'

// 窗口化常量（2026-09-05 S5 阶段 B：粒度切换为轮次级——测量/切片/占位单元从行改为轮次）
const WINDOW_BUFFER = 3             // 视口上下各保留 3 个轮次缓冲（轮次级切窗块大，缓冲稍宽降低切窗频率）
const INITIAL_RENDER_TURNS = 30     // 初始渲染最近 30 个轮次
const ESTIMATED_ITEM_HEIGHT = 80    // 未估算过的行回退高度（px，行求和兜底用）
/** 走查 S2（2026-09-05）测量静默判定（收敛信号）：RO 回调静默超此时长视为测量收敛——
 *  收敛前（测量活跃）锚定补偿关闭，滚动稳定交宿主 withProcessAnchor；静默后恢复。
 *  S5 阶段 B 起为唯一抑制信号：轮次级 RO 对布局突变（折叠/新行）自然回调刷新活跃时刻。 */
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

  // ===== 窗口化状态（S5 阶段 B：轮次级）=====
  /** 可见轮次范围 [visibleStart, visibleEnd)（轮次索引；切片边界强制对齐轮次边界） */
  const visibleStart = ref(0)
  const visibleEnd = ref(INITIAL_RENDER_TURNS)
  /** 轮次高度缓存：WeakMap 以 turn-root 元素为键——turnId 跨会话重复（回源 turn-N 每会话
   *  从 0 计数），字符串键会张冠李戴；元素键天然免疫。RO 直写。 */
  const measuredTurnHeights = new WeakMap<Element, number>()
  /** turnId → turn-root 元素登记（MutationObserver 增量挂载；会话切换时清空） */
  const turnRootEls = new Map<string, Element>()
  let resizeObserver: ResizeObserver | null = null
  let scrollRafId: number | null = null

  /** 轮次前缀和数组 + O(1) 占位高度：turnPrefixSums[i] = 前 i 个轮次的累计高度 */
  const prefixSums = shallowRef<Float64Array | null>(null)
  let rebuildRafId: number | null = null

  /** 行按 turnId 分组的轮次边界 [start, end)——切片边界对齐轮次的依据（items 序即文档序） */
  const turnSegments = computed<{ turnId: string; start: number; end: number }[]>(() => {
    const all = items.value
    const out: { turnId: string; start: number; end: number }[] = []
    let cur: { turnId: string; start: number; end: number } | null = null
    for (let i = 0; i < all.length; i++) {
      const tid: string = (all[i] as { turnId?: string }).turnId ?? cur?.turnId ?? `__anon-${i}`
      if (!cur || cur.turnId !== tid) {
        cur = { turnId: tid, start: i, end: i + 1 }
        out.push(cur)
        continue
      }
      cur.end = i + 1
    }
    return out
  })

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

  /** 抑制判定（走查 S2/S5）：测量仍在活跃收敛（静默 < 120ms）时为真——轮次级 RO 对
   *  布局突变（折叠/新行）自然回调刷新 lastMeasurementAt，无需结构突变单独标记 */
  function isMeasureSuppressActive(): boolean {
    return Date.now() - lastMeasurementAt < MEASURE_QUIET_MS
  }

  // ===== S4 滚动调度器（阶段 C）：scrollTop 写入的统一仲裁 =====
  // 两层仲裁：
  //   ① 同帧优先级——16ms 时间窗内已有更高/同优先级写入时，低优先级请求丢弃
  //     （根治「锚定补偿与贴底同帧互相覆盖」）；后到的高优先级覆盖先到的低优先级。
  //   ② 折叠补偿保护期——fold-compensate 写入后 300ms 内 bottom-follow 降级丢弃
  //     （根治「补偿刚把视口拉回锚点，随后的流式跟随又贴底覆盖」的跨帧竞争；
  //     等价语义此前由「底部展开解除跟随」补丁在语义层实现，此处收拢为机制）。
  // 所有写入统一做目标合法性 clamp 与 observedTop 记账。

  /** 滚动写入来源（数值越小优先级越高）；经 requestScroll 签名对宿主可见 */
  type ScrollWriteSource = 'fold-compensate' | 'bottom-follow' | 'measure-anchor'
  const SOURCE_PRIORITY: Record<ScrollWriteSource, number> = {
    'fold-compensate': 1,
    'bottom-follow': 2,
    'measure-anchor': 3,
  }
  const FOLD_COMPENSATE_GUARD_MS = 300
  const FRAME_WINDOW_MS = 16

  let lastFrameSource: ScrollWriteSource | null = null
  let lastFrameWriteAt = 0
  let lastFoldCompensateAt = 0

  /** 调度写入：仲裁通过则写 scrollTop 并记账；被仲裁丢弃返回 false */
  function writeScroll(scroll: HTMLElement, target: number, source: ScrollWriteSource): boolean {
    const now = performance.now()
    // ① 同帧优先级仲裁
    if (
      lastFrameSource &&
      now - lastFrameWriteAt < FRAME_WINDOW_MS &&
      SOURCE_PRIORITY[source] >= SOURCE_PRIORITY[lastFrameSource]
    ) {
      return false
    }
    // ② 折叠补偿保护期：贴底跟随降级
    if (source === 'bottom-follow' && Date.now() - lastFoldCompensateAt < FOLD_COMPENSATE_GUARD_MS) {
      return false
    }
    const floor = Math.max(0, scroll.scrollHeight - scroll.clientHeight)
    const clamped = Math.max(0, Math.min(target, floor))
    if (Math.abs(scroll.scrollTop - clamped) <= 0.5) {
      observedTop = scroll.scrollTop
      return false
    }
    scroll.scrollTop = clamped
    observedTop = scroll.scrollTop
    if (source === 'fold-compensate') lastFoldCompensateAt = Date.now()
    lastFrameSource = source
    lastFrameWriteAt = now
    return true
  }

  /** 供宿主（withProcessAnchor）接入的调度接口 */
  function requestScroll(scroll: HTMLElement, target: number, source: ScrollWriteSource): void {
    writeScroll(scroll, target, source)
  }

  /**
   * 走查 S3/S5：视口顶部基准**轮次**采集——切窗/重建锚定共用。
   * 返回首个 bottom 越过视口顶的轮次（turnId + 相对视口顶偏移）。
   * 过滤 v-show 隐藏元素（rect 全 0 会被误选为锚，抖动修复⑯/⑮-d 同规则）。
   */
  function collectTopAnchorTurn(scroll: HTMLElement): { id: string | null; offset: number } {
    const topY = scroll.getBoundingClientRect().top
    for (const el of scroll.querySelectorAll('[data-turn-root]')) {
      if ((el as HTMLElement).offsetParent === null) continue
      const r = el.getBoundingClientRect()
      if (r.bottom >= topY) {
        return { id: el.getAttribute('data-turn-root'), offset: r.top - topY }
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
   * 重建轮次前缀和（S5 阶段 B：粒度=轮次）。
   * 轮次高度：turn-root 实测（WeakMap 元素键，RO 直写）优先；未测轮次按行分桶估算求和。
   * 调用时机：RO 测量回调后（anchor=true/non）、items/轮次结构变化后（anchor=false）。
   * 行级时代的结构签名 watch 退役：轮次级 RO 对布局突变（折叠 v-show/新行）自然回调，
   * 测量活跃度（静默期）即收敛信号。
   */
  function rebuildPrefixSums(anchor: boolean): void {
    rebuildRafId = null
    const segs = turnSegments.value
    const totalTurns = segs.length
    if (totalTurns === 0 || items.value.length === 0) {
      prefixSums.value = null
      return
    }
    // 重建前：记录视口顶部对应的轮次（DOM 锚定）——仅 anchor=true 时收集
    const scroll = getScrollEl()
    let anchorTurnId: string | null = null
    let anchorDomOffset = 0
    if (anchor && scroll) {
      const collected = collectTopAnchorTurn(scroll)
      anchorTurnId = collected.id
      anchorDomOffset = collected.offset
    }
    // 轮次前缀和：实测优先，未测按行估算求和
    const sums = new Float64Array(totalTurns + 1)
    sums[0] = 0
    const all = items.value
    for (let t = 0; t < totalTurns; t++) {
      const seg = segs[t]
      const el = turnRootEls.get(seg.turnId)
      const measured = el ? measuredTurnHeights.get(el) : undefined
      let h = measured
      if (h === undefined || h <= 0) {
        h = 0
        for (let i = seg.start; i < seg.end; i++) {
          h += estimateHeight?.(all[i]) ?? ESTIMATED_ITEM_HEIGHT
        }
      }
      sums[t + 1] = sums[t] + h
    }
    prefixSums.value = sums
    // 重建后锚定补偿：锚轮次顶部回原位（非底部跟随态；底部由贴底主导）
    if (scroll && anchorTurnId && !isAtBottom.value) {
      const tIdx = segs.findIndex((s) => s.turnId === anchorTurnId)
      if (tIdx >= 0) {
        writeScroll(scroll, sums[tIdx] + anchorDomOffset, 'measure-anchor')
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
   * 二分查找：定位 scrollTop 对应的轮次索引（轮次前缀和）。
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
    const segs = turnSegments.value
    const totalTurns = segs.length
    // 流式跟随态：末轮（正在生成）强制在窗口内
    let endTurn = Math.min(visibleEnd.value, totalTurns)
    if (isAtBottom.value && endTurn < totalTurns) endTurn = totalTurns
    const startTurn = Math.min(visibleStart.value, endTurn)
    // 切片边界对齐轮次边界：窗口内轮次的行全量渲染
    const startRow = startTurn < totalTurns ? segs[startTurn].start : all.length
    const endRow = endTurn > startTurn ? segs[endTurn - 1].end : startRow
    const windowed = all.slice(startRow, endRow)
    // 抖动修复⑩语义保留：前缀和与轮次数不匹配时（突变瞬间未重建）回退 0 占位
    const sums = prefixSums.value
    const sumsValid = sums && sums.length - 1 === totalTurns
    const topPlaceholderHeight = sumsValid ? sums[startTurn] : 0
    const bottomPlaceholderHeight = sumsValid ? sums[totalTurns] - sums[endTurn] : 0
    return {
      items: windowed,
      topPlaceholderHeight: topPlaceholderHeight as number,
      bottomPlaceholderHeight: bottomPlaceholderHeight as number,
    }
  })

  /** 根据滚动位置更新可见窗口（S5：轮次级切片）。性能：rAF 节流 + 二分查找 O(log n)。 */
  function updateVisibleRange(): void {
    const scroll = getScrollEl()
    if (!scroll) return
    const scrollTop = scroll.scrollTop
    const viewportH = scroll.clientHeight
    const segs = turnSegments.value
    const totalTurns = segs.length
    if (totalTurns === 0) return

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

    // 二分 O(log n) 定位 scrollTop 和视口底部对应的轮次索引
    const estimatedStart = findIndexAtScroll(scrollTop)
    const estimatedEnd = findIndexAtScroll(scrollTop + viewportH)
    // 窗口边界加轮次缓冲：上下各 WINDOW_BUFFER 个轮次吸收占位估算误差
    const newStart = Math.max(0, estimatedStart - WINDOW_BUFFER)
    let newEnd = Math.min(totalTurns, estimatedEnd + 1 + WINDOW_BUFFER)
    // 底部跟随态：确保窗口覆盖到末轮
    if (isAtBottom.value) newEnd = totalTurns
    if (newStart === visibleStart.value && newEnd === visibleEnd.value) return

    // 抖动修复⑬语义（S5 轮次化）：切窗锚定——切窗前记录视口顶部基准**轮次**，
    // 切窗渲染后按实测位置补偿 scrollTop（collectTopAnchorTurn 含隐藏元素过滤）。
    const { id: anchorTurnId, offset: anchorOffset } = collectTopAnchorTurn(scroll)

    visibleStart.value = newStart
    visibleEnd.value = newEnd

    if (isAtBottom.value) {
      // 抖动修复⑬-c：切窗后行重挂载首帧高度未收敛，双帧贴底 + 执行时刻校验
      nextTick(() => { scrollToBottomIfNear(); })
      requestAnimationFrame(() => { scrollToBottomIfNear(); })
    } else if (anchorTurnId) {
      nextTick(() => {
        const target = scroll.querySelector<HTMLElement>(`[data-turn-root="${CSS.escape(anchorTurnId!)}"]`)
        if (!target) return
        const d = target.getBoundingClientRect().top - scroll.getBoundingClientRect().top - anchorOffset
        // S4：切窗锚定走调度器（合法性 clamp 与 observedTop 记账内置）
        writeScroll(scroll, scroll.scrollTop + d, 'measure-anchor')
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

  function scrollToBottom(force = false): void {
    const scroll = getScrollEl()
    if (!scroll) return
    // S4：贴底走调度器（bottom-follow，受折叠补偿保护期约束）；
    // force=true 为用户明确意图（回底按钮），绕过仲裁直接贴底
    const floor = Math.max(0, scroll.scrollHeight - scroll.clientHeight)
    if (!force && !writeScroll(scroll, floor, 'bottom-follow')) return
    scroll.scrollTop = floor
    // [③] 程序化写入同步记账，避免 onScroll 误判为读者离开底部
    observedTop = scroll.scrollTop
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
    visibleEnd.value = turnSegments.value.length
    // 双帧：nextTick 等 Vue 渲染出扩展窗口的新行，rAF 再校正一次高度（图片/字体异步布局兜底）
    nextTick(() => {
      scrollToBottom(true)
      requestAnimationFrame(() => {
        scrollToBottom(true)
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
    // S5 轮次化：行索引换算为所属轮次索引（visibleStart/End 语义=轮次）
    const segs = turnSegments.value
    const targetTurn = segs.findIndex(s => targetIndex >= s.start && targetIndex < s.end)
    if (targetTurn >= 0 && (targetTurn < visibleStart.value || targetTurn >= visibleEnd.value)) {
      // 目标在窗口外，扩展窗口覆盖目标附近
      visibleStart.value = Math.max(0, targetTurn - WINDOW_BUFFER)
      visibleEnd.value = Math.min(segs.length, targetTurn + 1 + WINDOW_BUFFER)
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
            }
          }
          // S5：新增轮次根 → 登记 + RO 观察（轮次高度测量单元）
          if (el.hasAttribute && el.hasAttribute('data-turn-root')) {
            const tid = el.getAttribute('data-turn-root')
            if (tid && !turnRootEls.has(tid)) {
              turnRootEls.set(tid, el)
              resizeObserver?.observe(el)
            }
          }
          // 也观察后代中的消息节点
          if (el.querySelectorAll) {
            for (const child of el.querySelectorAll('[data-msg-id]')) {
              if (!observedMsgEls.has(child)) {
                scrollObserver.observe(child)
                observedMsgEls.add(child)
              }
            }
            for (const child of el.querySelectorAll('[data-turn-root]')) {
              const tid = child.getAttribute('data-turn-root')
              if (tid && !turnRootEls.has(tid)) {
                turnRootEls.set(tid, child)
                resizeObserver?.observe(child)
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

  // S5 阶段 B：行级结构签名 watch（flush:sync 行级前缀和重建 + 预热测量 walk）退役——
  // 轮次级 RO 对布局突变（折叠 v-show / 行增删）自然回调，测量活跃度即收敛信号。
  // 抖动修复⑰（轮次版）：轮次数增长时同步扩展窗口尾（新轮次落在尾部，原索引窗口会把
  // 既有轮次挤出）；flush:sync 在 computed 读取前同步重建前缀和——新轮次未挂 DOM 时
  // 走行估算求和分支，避免一帧 0 占位塌缩（原⑩语义）。
  watch(() => turnSegments.value.length, (newN, oldN) => {
    if (newN === oldN) return
    rebuildPrefixSums(false)
    if (newN > oldN && !isAtBottom.value) {
      visibleEnd.value = Math.min(newN, visibleEnd.value + (newN - oldN))
    }
  }, { flush: 'sync' })
  // 抖动修复⑮/⑫-b（2026-09-04）结构签名 watch + 预热测量 walk 已随 S5 轮次化退役：
  // 轮次根 RO 对 v-show 切换/行增删自然回调（测量即布局事实），预热收敛由 RO 逐帧完成，
  // 测量活跃度（静默期）即收敛信号——行级「签名编码 + 隐藏行置 0 + DOM 预热」整类补丁不再需要。

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
  // S5：轮次测量登记（turnRootEls）与可见范围一并重置；高度 WeakMap 随元素卸载自然回收。
  watch(() => messages.value[0]?.id, () => {
    lastSeenLength.value = messages.value.length
    newMsgCountWhileAway.value = 0
    visibleMsgIds.value = new Set()
    turnRootEls.clear()
    activeUserMsgId.value = ''
    visibleStart.value = 0
    visibleEnd.value = INITIAL_RENDER_TURNS
    rebuildPrefixSums(false)
  })

  onMounted(() => {
    nextTick(() => {
      setupScrollObserver()
      // 绑定 scroll 监听用于窗口化 + 滚动锚定
      const scroll = getScrollEl()
      if (scroll) {
        scroll.addEventListener('scroll', onScroll, { passive: true })
        // 初始化 ResizeObserver（S5 轮次级）：观察轮次根元素，实测高度写入轮次缓存
        // 用于提升窗口化滚动估算的准确性，减少跳屏
        // 初始化 ResizeObserver（S5 轮次级）：观察轮次根元素，高度直写轮次缓存。
        // 行级时代的隐藏行置 0 / 动画行跳过 / 结构突变检测整类补丁退役——轮次根高度
        // 对内部 v-show 切换/行增删/动画自然敏感，测量即布局事实。
        resizeObserver = new ResizeObserver((entries) => {
          for (const entry of entries) {
            const el = entry.target as HTMLElement
            // 切窗卸载的轮次跳过（脱离文档仍会回调一次且高度为 0——写入会崩塌前缀和，
            // 抖动修复⑬语义保留；窗口切回重挂时 RO 会再回调恢复真实高度）
            if (!el.isConnected) continue
            measuredTurnHeights.set(el, entry.contentRect.height)
          }
          lastMeasurementAt = Date.now()
          // 测量活跃（静默期）内不带锚定补偿（收敛中 target 不可靠）；静默后恢复
          if (isMeasureSuppressActive()) scheduleRebuildPrefixSums(false)
          else scheduleRebuildPrefixSums(true)
        })
        // 对当前已渲染的轮次根 observe（后续新轮次由 MutationObserver 增量 observe）
        for (const el of scroll.querySelectorAll('[data-turn-root]')) {
          resizeObserver.observe(el)
          const tid = el.getAttribute('data-turn-root')
          if (tid) turnRootEls.set(tid, el)
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
    /** S4 调度器接口：宿主（withProcessAnchor 折叠补偿）的 scrollTop 写入统一走仲裁 */
    requestScroll,
  }
}
