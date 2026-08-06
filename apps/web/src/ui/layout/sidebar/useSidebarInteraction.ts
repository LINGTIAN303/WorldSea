import { ref, onBeforeUnmount } from 'vue'

/** 拖拽判定阈值:总位移超过此值视为拖拽,否则视为点击 */
const DRAG_THRESHOLD = 25
/** 拖拽灵敏度:px → pos 单位转换 */
const DRAG_SENSITIVITY = 0.028

export interface InteractionCallbacks {
  /**
   * 拖拽开始(总位移首次超过阈值)
   * @param startPos 拖拽开始时的 pos
   */
  onDragStart?: (startPos: number) => void
  /**
   * 拖拽移动(已超过阈值)
   * @param newPos 新的 pos 值
   */
  onDragMove?: (newPos: number) => void
  /**
   * 拖拽结束(已超过阈值)
   * @param velocity 释放速度(px/ms)
   * @param startPos 拖拽开始时的 pos
   * @param currentPos 当前 pos
   */
  onDragEnd?: (velocity: number, startPos: number, currentPos: number) => void
  /**
   * 点击(总位移未超过阈值)
   * @param offset 被点击按钮的 offset(0=居中,±1=相邻,±2=隔一个)
   * @param startPos 按下时的 pos(未被污染,可用于计算跳转目标)
   */
  onClick?: (offset: number, startPos: number) => void
}

/** 侧边栏交互处理：点击 vs 拖拽判定（3 处核心修复对比原 Sidebar 见文档），详细见 docs/details/注释/web/ui/layout/sidebar/useSidebarInteraction.md */
export function useSidebarInteraction(callbacks: InteractionCallbacks) {
  /** 是否正在拖拽(超过阈值) */
  const isDragging = ref(false)

  // 拖拽状态(每次 pointerdown 重置)
  let dragStartY = 0
  let dragStartPos = 0
  let dragLastY = 0
  let dragLastTime = 0
  let dragVelSamples: number[] = []
  let dragMoved = false
  let pointerTarget: EventTarget | null = null
  let activePointerId: number | null = null
  let activeElement: HTMLElement | null = null

  /**
   * 处理 pointerdown 事件(绑定到 .sidebar 元素)
   */
  function onPointerDown(e: PointerEvent, currentPos: number) {
    // 仅响应左键
    if (e.button !== 0) return
    e.preventDefault()

    dragStartY = e.clientY
    dragStartPos = currentPos
    dragLastY = e.clientY
    dragLastTime = performance.now()
    dragVelSamples = []
    dragMoved = false
    pointerTarget = e.target
    activePointerId = e.pointerId

    const el = e.currentTarget as HTMLElement
    activeElement = el
    el.setPointerCapture(e.pointerId)

    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', onPointerUp)
    el.addEventListener('pointercancel', onPointerUp)
  }

  /** pointermove 处理(内部,绑定到元素) */
  function onPointerMove(e: PointerEvent) {
    const dy = e.clientY - dragLastY
    const now = performance.now()
    const dt = now - dragLastTime

    // 采样速度(用于 fling)
    if (dt > 0) {
      dragVelSamples.push(dy / dt)
      if (dragVelSamples.length > 5) dragVelSamples.shift()
    }

    const totalDy = e.clientY - dragStartY
    // 修复 1:阈值检测用总位移
    if (Math.abs(totalDy) > DRAG_THRESHOLD) dragMoved = true

    if (dragMoved) {
      // 修复 2:阈值超过后才更新 pos,且用 totalDy 计算绝对位置
      // 原代码 pos = dragStartPos - dy * SENSITIVITY,dy 是单帧增量,会导致 pos 在 dragStartPos 附近振荡
      const newPos = dragStartPos - totalDy * DRAG_SENSITIVITY
      if (!isDragging.value) {
        isDragging.value = true
        callbacks.onDragStart?.(dragStartPos)
      }
      callbacks.onDragMove?.(newPos)
    }
    // 阈值内:不更新 pos,不调用 onDragMove(原代码的 BUG 根源)

    dragLastY = e.clientY
    dragLastTime = now
  }

  /** pointerup 处理(内部) */
  function onPointerUp(_e: PointerEvent) {
    const el = activeElement
    if (el && activePointerId !== null) {
      el.releasePointerCapture(activePointerId)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('pointercancel', onPointerUp)
    }
    activeElement = null
    activePointerId = null

    if (!dragMoved) {
      // 点击分支
      const btn = (pointerTarget as HTMLElement)?.closest('.sidebar-btn') as HTMLElement | null
      if (btn) {
        const offset = parseInt(btn.dataset.offset || '0', 10)
        // 修复 3:用 dragStartPos(未污染)而非 pos
        callbacks.onClick?.(offset, dragStartPos)
      }
      pointerTarget = null
      isDragging.value = false
      return
    }

    // 拖拽分支:计算平均速度
    let avgVel = 0
    if (dragVelSamples.length > 0) {
      const recent = dragVelSamples.slice(-3)
      avgVel = recent.reduce((a, b) => a + b, 0) / recent.length
    }

    // 当前 pos 由上层通过 onDragMove 已更新,这里只通知结束
    callbacks.onDragEnd?.(avgVel, dragStartPos, 0 /* currentPos 由上层持有 */)
    isDragging.value = false
    dragMoved = false
    pointerTarget = null
  }

  onBeforeUnmount(() => {
    // 清理可能的残留监听器
    if (activeElement && activePointerId !== null) {
      activeElement.removeEventListener('pointermove', onPointerMove)
      activeElement.removeEventListener('pointerup', onPointerUp)
      activeElement.removeEventListener('pointercancel', onPointerUp)
    }
  })

  return {
    isDragging,
    onPointerDown,
  }
}
