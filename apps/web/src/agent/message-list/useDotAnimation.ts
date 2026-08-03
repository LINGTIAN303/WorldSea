/**
 * 思考中省略号动画 composable。
 *
 * 性能优化：用 requestAnimationFrame + 时间戳替代 setInterval，
 * 与浏览器刷新率同步，避免抖动。isStreaming 变化时自动启停。
 */
import { ref, watch, onBeforeUnmount, type Ref } from 'vue'

const DOT_INTERVAL_MS = 400

export function useDotAnimation(isStreaming: Ref<boolean>) {
  const dotText = ref('')

  let dotRafId: number | null = null
  let dotStartTime = 0
  let dotCount = 0

  function dotLoop(ts: number): void {
    if (dotRafId === null) return
    if (ts - dotStartTime >= DOT_INTERVAL_MS) {
      dotCount = (dotCount + 1) % 4
      dotText.value = '.'.repeat(dotCount)
      dotStartTime = ts
    }
    dotRafId = requestAnimationFrame(dotLoop)
  }

  function startDotAnimation(): void {
    stopDotAnimation()
    dotCount = 0
    dotStartTime = 0
    dotRafId = requestAnimationFrame(dotLoop)
  }

  function stopDotAnimation(): void {
    if (dotRafId !== null) {
      cancelAnimationFrame(dotRafId)
      dotRafId = null
    }
    dotText.value = ''
  }

  // isStreaming 变化时自动启停动画
  watch(
    () => isStreaming.value,
    (val) => {
      if (val) startDotAnimation()
      else stopDotAnimation()
    }
  )

  onBeforeUnmount(() => {
    stopDotAnimation()
  })

  return { dotText }
}
