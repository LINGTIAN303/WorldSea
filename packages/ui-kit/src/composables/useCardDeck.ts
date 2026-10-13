import { ref, nextTick } from 'vue'

/**
 * useCardDeck — 设置面板「叠放翻卡」通用逻辑（由 Agent 主设置抽取，推广到全部分类面板）。三卡（或多卡）
 * 拼为三个可见层——上条=上一张、主卡=当前、下条=下一张；翻下一张：下卡上来放大当主卡、主卡上去缩小
 * 当上条、上卡下去不缩放，翻上一张镜像反之；count === 1 退化为单卡直接显示（goToCard 恒为 no-op）。
 */
export function useCardDeck(count: number, onChange?: (index: number) => void) {
  const activeCard = ref(0)
  /** 翻卡翻转动画状态：卡片索引 → 叠加的动画 class（定时器兜底后清空，下次翻卡重播） */
  const cardAnim = ref<Record<number, string>>({})
  let flipTimer: number | null = null

  /** 依据 activeCard 计算某张卡的叠放位：mid=当前 / up=上一张（露顶边）/ down=下一张（露底边） */
  function deckCardClass(i: number): string {
    const n = count
    const prev = (activeCard.value - 1 + n) % n
    const next = (activeCard.value + 1) % n
    if (i === activeCard.value) return 'deck-card--mid'
    if (i === prev) return 'deck-card--up'
    if (i === next) return 'deck-card--down'
    return 'deck-card--hidden'
  }

  /**
   * 触发翻转动画：
   * - 翻下一张：旧主卡向上翻走（anim-out-top）、新主卡从底部翻上（anim-in-bottom）
   * - 翻上一张：旧主卡向下翻走（anim-out-bottom）、新主卡从顶部翻下（anim-in-top）
   */
  function flipCards(fwd: boolean, fromIdx: number, toIdx: number): void {
    cardAnim.value = {}
    nextTick(() => {
      cardAnim.value = {
        [fromIdx]: fwd ? 'anim-out-top' : 'anim-out-bottom',
        [toIdx]: fwd ? 'anim-in-bottom' : 'anim-in-top',
      }
      // 兜底清理：连续翻卡时覆盖前一次定时器
      if (flipTimer !== null) window.clearTimeout(flipTimer)
      flipTimer = window.setTimeout(() => { cardAnim.value = {} }, 500)
    })
  }

  /** 翻到指定卡片（左列标题点击调用；索引取模支持首尾循环） */
  function goToCard(i: number): void {
    const n = count
    const idx = ((i % n) + n) % n
    if (idx === activeCard.value) return
    const fwd = ((idx - activeCard.value + n) % n) === 1 // 是否翻下一张
    flipCards(fwd, activeCard.value, idx)
    activeCard.value = idx
    onChange?.(idx)
  }

  /** 边界续页滚轮：卡片内部还能滚时让内部滚动；滚到顶部/底部边缘继续滚才翻卡（首尾循环） */
  function onDeckWheel(e: WheelEvent): void {
    if (e.deltaY === 0) return
    const deck = e.currentTarget as HTMLElement
    const dir = e.deltaY > 0 ? 1 : -1
    const scroller = findDeckScroller(e.target as HTMLElement, deck)
    if (scroller) {
      const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1
      const atTop = scroller.scrollTop <= 1
      if (dir === 1 && !atBottom) return // 内部还能向下滚，交给内部滚动
      if (dir === -1 && !atTop) return   // 内部还能向上滚，交给内部滚动
    }
    goToCard(dir === 1 ? activeCard.value + 1 : activeCard.value - 1)
    e.preventDefault()
  }

  return { activeCard, cardAnim, deckCardClass, goToCard, onDeckWheel }
}

/** 从滚轮事件目标向上找卡片内部可滚动的元素（限制在 card-deck 内） */
function findDeckScroller(el: HTMLElement | null, root: HTMLElement): HTMLElement | null {
  let cur: HTMLElement | null = el
  while (cur && cur !== root) {
    const oy = getComputedStyle(cur).overflowY
    if ((oy === 'auto' || oy === 'scroll') && cur.scrollHeight > cur.clientHeight + 1) return cur
    cur = cur.parentElement
  }
  return null
}
