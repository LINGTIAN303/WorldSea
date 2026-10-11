import { nextTick } from 'vue'

/** 批量更新合并器（同周期多次 update 合并为一次回调，解决 PERF-03 响应式更新风暴），详细见 docs/details/注释/packages/perf-kit/reactive/batchedUpdates.md */
export interface BatchItem<T> {
  id: string
  changes: Partial<T>
}

export type FlushMode = 'nextTick' | 'raf' | 'timeout'

export function createUpdateBatcher<T>(
  handler: (batch: BatchItem<T>[]) => void,
  options?: {
    /** 刷出时机：nextTick（Vue 微任务，默认）/ raf（下一帧）/ timeout（定时器） */
    flushMode?: FlushMode
    /** flushMode 为 timeout 时的延迟（ms），默认 16 */
    timeout?: number
  },
): {
  queue: (id: string, changes: Partial<T>) => void
  flush: () => void
  cancel: () => void
  readonly pending: number
} {
  const { flushMode = 'nextTick', timeout = 16 } = options ?? {}

  // 同一 id 的多次变更原地合并，避免 Map 重建
  const pending = new Map<string, Partial<T>>()
  let scheduled = false
  let timerId: ReturnType<typeof setTimeout> | null = null

  function flush(): void {
    scheduled = false
    if (timerId !== null) { clearTimeout(timerId); timerId = null }
    if (pending.size === 0) return
    const batch: BatchItem<T>[] = []
    pending.forEach((changes, id) => batch.push({ id, changes }))
    pending.clear()
    handler(batch)
  }

  function schedule(): void {
    if (scheduled) return
    scheduled = true
    if (flushMode === 'nextTick') {
      nextTick(flush)
    } else if (flushMode === 'raf') {
      requestAnimationFrame(flush)
    } else {
      timerId = setTimeout(flush, timeout)
    }
  }

  function queue(id: string, changes: Partial<T>): void {
    const existing = pending.get(id)
    pending.set(id, existing ? { ...existing, ...changes } : changes)
    schedule()
  }

  function cancel(): void {
    scheduled = false
    pending.clear()
    if (timerId !== null) { clearTimeout(timerId); timerId = null }
  }

  return {
    queue,
    flush,
    cancel,
    get pending() { return pending.size },
  }
}