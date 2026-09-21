/**
 * 过程层自动折叠控制器（设计文档 §3.4 三条件）
 *
 * 前置：结果层落地（`turn.resultId` 非空且轮次不在 streaming）→ 才进入折叠评估。
 * 每个 Turn 只自动折叠一次（`hasAutoCollapsed` latch，由归约器置位）。
 *
 * 三条件：
 * 1. 用户未展开过任何行段 → 立即折叠
 * 2. 展开过 && 展开项当前在视口内 && 空闲 ≥ idleMs 无操作 → 折叠（有操作则重置计时）
 * 3. 展开过 && 展开项已不在视口内 → 立即折叠
 *
 * latch 语义：`userEverExpanded` 展开了又收起仍为 true（用户表达过关注，不该被立即折叠）；
 * 用户手动展开过程层后 `hasAutoCollapsed` 已置位，不再自动折叠（避免与用户意图打架）。
 *
 * "操作"计入 wheel/touchmove/scroll/click/keydown/selectionchange；
 * **不计入 mousemove/hover**——过频会导致计时器永不触发。
 */

import { nextTick, onBeforeUnmount, watch, type Ref } from 'vue'
import {
  decideCollapse,
  type CollapseDecision,
  type Turn,
} from '@worldsea/shared-composables/agent/turnModel'

// 折叠判定是纯函数，下沉在 turnModel（与归约器同源、便于单测），此处原样转出
export { decideCollapse, type CollapseDecision }

/** 计入"用户有操作"的事件（滚动容器级） */
const SCROLL_ACTIVITY_EVENTS = ['wheel', 'touchmove', 'scroll'] as const
/** 计入"用户有操作"的事件（文档级） */
const DOC_ACTIVITY_EVENTS = ['click', 'keydown', 'selectionchange'] as const

export interface UseProcessCollapseOptions {
  /** 轮次树（事实源；每次归约产出新数组引用以触发评估） */
  turns: Ref<Turn[]>
  /** 消息区容器（内部取 .messages-scroll 作滚动容器与视口基准） */
  container: Ref<HTMLElement | undefined>
  /** 执行折叠的回调（应走归约器的 auto_collapse 事件，以置 hasAutoCollapsed latch） */
  onCollapse: (turnId: string) => void
  /** 空闲阈值（ms），默认 5000 */
  idleMs?: number
}

export function useProcessCollapse(opts: UseProcessCollapseOptions): void {
  const idleMs = opts.idleMs ?? 5_000
  /** 待折叠轮次 → 空闲计时器 */
  const timers = new Map<string, number>()
  /** 滚动容器上的活动监听是否已绑定（滚动容器非首帧就绪，需延迟绑定） */
  let scrollBound = false
  let docBound = false
  /** 条件 3 重评估的 rAF 节流句柄 */
  let rafId: number | null = null

  function getScrollEl(): HTMLElement | null {
    const c = opts.container.value
    if (!c) return null
    return c.querySelector('.messages-scroll') as HTMLElement | null
  }

  /**
   * 构建「轮次 → 过程层是否在视口内」索引（一次 DOM 遍历 + 一次容器 rect）。
   *
   * 2026-09-20 帧率修复：原实现是「每个轮次各查一次」，即每 delta 做 O(轮次数) 次
   * `querySelectorAll('[data-turn-id]')` 全子树遍历 + 强制布局（长会话下每 delta 百万级
   * 节点访问，直接饿死 rAF → 流式打字机掉帧）。改为**每次评估只建一次索引**，
   * 且由 `decideCollapse` 惰性触发——稳态（流式轮 / 已折叠轮全部 'skip'）下完全不查。
   *
   * 只统计已渲染（窗口内）的过程层元素：未渲染 = 被窗口化卸载 → 视为不可见（与逐轮查询语义一致）。
   * 按 dataset 取值而非拼选择器：turnId 可能含特殊字符，避免选择器注入/转义坑。
   */
  function buildVisibilityIndex(): Map<string, boolean> {
    const index = new Map<string, boolean>()
    const scroll = getScrollEl()
    if (!scroll) return index
    const sr = scroll.getBoundingClientRect()
    for (const el of scroll.querySelectorAll<HTMLElement>('[data-turn-id]')) {
      const turnId = el.dataset.turnId
      if (!turnId) continue
      const r = el.getBoundingClientRect()
      // 与视口有任意重叠即视为可见
      index.set(turnId, r.bottom > sr.top && r.top < sr.bottom)
    }
    return index
  }

  function clearTimer(turnId: string): void {
    const id = timers.get(turnId)
    if (id !== undefined) {
      window.clearTimeout(id)
      timers.delete(turnId)
    }
  }

  function scheduleIdle(turnId: string): void {
    if (timers.has(turnId)) return // 已在计时（只有用户操作才重置，见 resetIdle）
    const id = window.setTimeout(() => {
      timers.delete(turnId)
      opts.onCollapse(turnId)
    }, idleMs)
    timers.set(turnId, id)
  }

  function evaluate(): void {
    // 视口索引惰性建一次（仅当某轮次真的需要可见性时才建，见 buildVisibilityIndex 注释）
    let visibility: Map<string, boolean> | null = null
    const isVisible = (turnId: string): boolean => {
      if (!visibility) visibility = buildVisibilityIndex()
      return visibility.get(turnId) ?? false
    }
    for (const t of opts.turns.value) {
      const decision = decideCollapse(t, () => isVisible(t.id))
      if (decision === 'skip') {
        clearTimer(t.id)
      } else if (decision === 'collapse-now') {
        clearTimer(t.id)
        opts.onCollapse(t.id)
      } else {
        scheduleIdle(t.id)
      }
    }
  }

  /** 用户有操作：重置待折叠计时器（条件 2 的空闲窗口重新计时） */
  function resetIdle(): void {
    if (timers.size === 0) return
    const pending = [...timers.keys()]
    for (const turnId of pending) {
      clearTimer(turnId)
      scheduleIdle(turnId)
    }
  }

  function onActivity(): void {
    resetIdle()
    // 条件 3 依赖视口：滚动后需重新评估（rAF 节流，避免滚动高频重算）
    if (rafId !== null) return
    rafId = requestAnimationFrame(() => {
      rafId = null
      evaluate()
    })
  }

  function bindListeners(): void {
    if (!scrollBound) {
      const scroll = getScrollEl()
      if (scroll) {
        for (const ev of SCROLL_ACTIVITY_EVENTS) {
          scroll.addEventListener(ev, onActivity, { passive: true })
        }
        scrollBound = true
      }
    }
    if (!docBound && typeof document !== 'undefined') {
      for (const ev of DOC_ACTIVITY_EVENTS) {
        document.addEventListener(ev, onActivity, { passive: true })
      }
      docBound = true
    }
  }

  function unbindListeners(): void {
    if (scrollBound) {
      const scroll = getScrollEl()
      if (scroll) {
        for (const ev of SCROLL_ACTIVITY_EVENTS) scroll.removeEventListener(ev, onActivity)
      }
      scrollBound = false
    }
    if (docBound && typeof document !== 'undefined') {
      for (const ev of DOC_ACTIVITY_EVENTS) document.removeEventListener(ev, onActivity)
      docBound = false
    }
  }

  // 轮次树变化（结果层落地 / 用户展开行段 / 折叠态变更）→ 重评估
  // nextTick：等过程层元素进入 DOM 后再做视口判定
  watch(
    () => opts.turns.value,
    () => {
      nextTick(() => {
        bindListeners()
        evaluate()
      })
    },
    { immediate: true, deep: false },
  )

  onBeforeUnmount(() => {
    unbindListeners()
    for (const turnId of [...timers.keys()]) clearTimer(turnId)
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
  })
}
