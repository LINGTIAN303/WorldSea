import { watch, type WatchSource } from 'vue'

/**
 * 防抖 watch：在源变化后等待 ms 毫秒再触发回调。
 * 替代 watch(..., { deep: true }) 的高频触发场景。
 */
export function watchDebounced(
  source: WatchSource<unknown>,
  cb: () => void,
  options?: { debounce?: number; immediate?: boolean; flush?: 'pre' | 'post' | 'sync'; deep?: boolean }
) {
  const ms = options?.debounce ?? 50
  let timer: ReturnType<typeof setTimeout> | null = null

  const stop = watch(
    source,
    () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        cb()
        timer = null
      }, ms)
    },
    { immediate: options?.immediate, flush: options?.flush, deep: options?.deep },
  )

  return () => {
    stop()
    if (timer) { clearTimeout(timer); timer = null }
  }
}
