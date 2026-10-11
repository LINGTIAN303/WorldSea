/**
 * useDockPanelRect — HITL 面板「贴合输入栏」定位（2026-09-20 用户走查反馈）
 *
 * 提问面板 / 审批面板（bottom 模式）不再居中浮于输入栏上方，而是**停靠到对话输入栏**：
 * 宽度跟随输入栏（`.chat-input-box`）、底边与输入栏底边对齐（可覆盖输入栏）。
 *
 * 实现：面板 Teleport 到 body 且 overlay 为 `position: fixed; inset: 0`，
 * 故对 overlay 内的面板用 absolute 定位即等价于视口坐标；本 composable 负责测量
 * 并返回内联样式。输入栏不存在（如群聊 / 非对话页）时返回 undefined，由各面板
 * 回退默认居中宽度。
 */
import { computed, onBeforeUnmount, ref, watch, type CSSProperties, type Ref } from 'vue'

/** 输入栏本体选择器（ChatInput 的可视胶囊；宽度即「输入栏宽度」） */
const INPUT_SELECTOR = '.chat-input-box'

interface DockRect {
  left: number
  width: number
  /** 面板底边距视口底部的距离（= 输入栏底边距视口底部距离） */
  bottom: number
}

export function useDockPanelRect(active: Ref<boolean>) {
  const rect = ref<DockRect | null>(null)
  let el: HTMLElement | null = null
  let ro: ResizeObserver | null = null

  /** 测量输入栏 rect（元素失效时重新查找并重挂 ResizeObserver） */
  function measure(): void {
    if (typeof document === 'undefined' || typeof window === 'undefined') return
    if (!el || !el.isConnected) {
      el = document.querySelector<HTMLElement>(INPUT_SELECTOR)
      ro?.disconnect()
      ro = null
      if (el && typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(() => measure())
        ro.observe(el)
      }
    }
    if (!el) {
      rect.value = null
      return
    }
    const r = el.getBoundingClientRect()
    rect.value = {
      left: r.left,
      width: r.width,
      bottom: window.innerHeight - r.bottom,
    }
  }

  // 面板每次展示时重新测量（布局可能已变化：侧栏开关 / 会话切换）
  watch(active, (v) => {
    if (v) measure()
  })
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', measure)
  }
  onBeforeUnmount(() => {
    if (typeof window !== 'undefined') window.removeEventListener('resize', measure)
    ro?.disconnect()
    ro = null
  })

  /** 停靠内联样式（测量失败时 undefined → 由面板 CSS 回退居中态） */
  const dockedStyle = computed<CSSProperties | undefined>(() =>
    rect.value
      ? {
          left: `${rect.value.left}px`,
          width: `${rect.value.width}px`,
          bottom: `${rect.value.bottom}px`,
        }
      : undefined,
  )

  return { dockedStyle, measure }
}