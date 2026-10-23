/** 画布横向平移（中键/Alt 拖拽、时间轴拖拽共用）。 */
import { onBeforeUnmount, type Ref } from 'vue'

export interface TimelinePanOptions {
  scrollOffset: Ref<number>
  setScrollOffset: (value: number) => void
}

export function useTimelinePan(options: TimelinePanOptions) {
  let cleanup: (() => void) | null = null

  /** 从某个按下横坐标开始平移；松手/卸载都会摘掉监听 */
  function startPan(clientX: number) {
    cleanup?.()
    const startOffset = options.scrollOffset.value
    const move = (event: MouseEvent) => {
      options.setScrollOffset(startOffset - (event.clientX - clientX))
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.style.removeProperty('cursor')
      cleanup = null
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    document.body.style.cursor = 'grabbing'
    cleanup = up
  }

  function cancel() {
    cleanup?.()
    cleanup = null
  }

  onBeforeUnmount(cancel)

  return { startPan, cancel }
}
