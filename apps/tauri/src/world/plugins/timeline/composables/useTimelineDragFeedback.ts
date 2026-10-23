/** 拖拽视觉反馈：吸附日期气泡 + 拖到边缘时的自动横向滚动。 */
import { ref, type Ref } from 'vue'

export interface TimelineDragFeedbackOptions {
  bodyEl: Ref<HTMLElement | undefined>
  scrollOffset: Ref<number>
  setScrollOffset: (value: number) => void
}

export function useTimelineDragFeedback(options: TimelineDragFeedbackOptions) {
  /** 气泡位置用画布内容坐标，随泳道一起滚动 */
  const hint = ref<{ left: number; top: number; text: string } | null>(null)

  function setHint(event: MouseEvent, text: string) {
    const body = options.bodyEl.value
    if (!body || !text) return
    const rect = body.getBoundingClientRect()
    hint.value = {
      left: event.clientX - rect.left + 14,
      top: event.clientY - rect.top + body.scrollTop + 14,
      text,
    }
  }

  /** 指针进入左右 48px 边缘时推动横向滚动（每次移动推一小步） */
  function edgeScroll(clientX: number) {
    const body = options.bodyEl.value
    if (!body) return
    const rect = body.getBoundingClientRect()
    if (clientX < rect.left + 48) options.setScrollOffset(options.scrollOffset.value - 14)
    else if (clientX > rect.right - 48) options.setScrollOffset(options.scrollOffset.value + 14)
  }

  function clearHint() {
    hint.value = null
  }

  return { hint, setHint, edgeScroll, clearHint }
}
