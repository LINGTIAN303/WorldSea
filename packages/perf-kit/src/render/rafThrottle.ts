/**
 * requestAnimationFrame 节流：同一帧内只执行一次回调。
 * 用于流式输出等高频更新场景，避免每帧多次 DOM 操作。
 */
export function rafThrottle<T extends (...args: any[]) => void>(fn: T): T & { cancel: () => void } {
  let rafId: number | null = null
  let lastArgs: any[] | null = null

  const throttled = ((...args: any[]) => {
    lastArgs = args
    if (rafId !== null) return
    rafId = requestAnimationFrame(() => {
      rafId = null
      if (lastArgs) {
        fn(...lastArgs)
        lastArgs = null
      }
    })
  }) as T & { cancel: () => void }

  throttled.cancel = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
      lastArgs = null
    }
  }

  return throttled
}
