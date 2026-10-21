/**
 * useAsyncTask：加载状态机（延迟出现 / 最短可见 / 成功停留 / 错误常驻）。
 * 详细 why 见 docs/details/注释/tauri/components/加载反馈.md
 */

import { ref, type Ref } from 'vue'

export type AsyncTaskStatus = 'idle' | 'loading' | 'success' | 'empty' | 'error'

export interface UseAsyncTaskOptions {
  /** 超过该时长才显示加载；默认 200ms（镜像 --loading-delay） */
  delay?: number
  /** 一旦显示，至少保留该时长；默认 400ms（镜像 --loading-min-visible） */
  minVisible?: number
  /** 成功态在隐藏前的停留时长；默认 300ms */
  successHold?: number
}

export interface UseAsyncTaskReturn {
  status: Ref<AsyncTaskStatus>
  visible: Ref<boolean>
  error: Ref<string | null>
  run: <T>(
    task: () => Promise<T>,
    options?: { empty?: (value: T) => boolean },
  ) => Promise<T>
  fail: (message?: unknown) => void
  reset: () => void
}

export const LOADING_DELAY_MS = 200
export const LOADING_MIN_VISIBLE_MS = 400
export const LOADING_SUCCESS_HOLD_MS = 300

function messageOf(value: unknown): string {
  if (value instanceof Error) return value.message
  if (typeof value === 'string' && value) return value
  return '操作失败'
}

export function useAsyncTask(options: UseAsyncTaskOptions = {}): UseAsyncTaskReturn {
  const delay = Math.max(0, options.delay ?? LOADING_DELAY_MS)
  const minVisible = Math.max(0, options.minVisible ?? LOADING_MIN_VISIBLE_MS)
  const successHold = Math.max(0, options.successHold ?? LOADING_SUCCESS_HOLD_MS)

  const status = ref<AsyncTaskStatus>('idle')
  const visible = ref(false)
  const error = ref<string | null>(null)

  let delayTimer: ReturnType<typeof setTimeout> | null = null
  let hideTimer: ReturnType<typeof setTimeout> | null = null
  let visibleAt = 0
  let runId = 0

  function clearTimers(): void {
    if (delayTimer) { clearTimeout(delayTimer); delayTimer = null }
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null }
  }

  function start(): number {
    clearTimers()
    runId += 1
    // 错误态重试：保持浮层可见，避免关闭再打开造成闪烁
    const keepVisible = visible.value && status.value === 'error'
    status.value = 'loading'
    error.value = null
    visible.value = keepVisible
    visibleAt = keepVisible ? Date.now() : 0
    if (!keepVisible) {
      if (delay === 0) {
        visible.value = true
        visibleAt = Date.now()
      } else {
        delayTimer = setTimeout(() => {
          delayTimer = null
          if (status.value !== 'loading') return
          visible.value = true
          visibleAt = Date.now()
        }, delay)
      }
    }
    return runId
  }

  function finish(next: 'success' | 'empty'): void {
    if (status.value !== 'loading') return
    status.value = next
    if (delayTimer) { clearTimeout(delayTimer); delayTimer = null }
    if (!visible.value) return
    const elapsed = visibleAt ? Date.now() - visibleAt : 0
    const hold = Math.max(successHold, minVisible - elapsed, 0)
    if (hold > 0) {
      hideTimer = setTimeout(() => {
        hideTimer = null
        if (status.value === next) visible.value = false
      }, hold)
    } else {
      visible.value = false
    }
  }

  function fail(message?: unknown): void {
    clearTimers()
    runId += 1
    status.value = 'error'
    error.value = messageOf(message)
    visible.value = true
    visibleAt = Date.now()
  }

  async function run<T>(
    task: () => Promise<T>,
    options?: { empty?: (value: T) => boolean },
  ): Promise<T> {
    const id = start()
    try {
      const value = await task()
      if (id === runId) finish(options?.empty?.(value) ? 'empty' : 'success')
      return value
    } catch (err) {
      if (id === runId) fail(err)
      throw err
    }
  }

  function reset(): void {
    clearTimers()
    runId += 1
    status.value = 'idle'
    visible.value = false
    visibleAt = 0
    error.value = null
  }

  return { status, visible, error, run, fail, reset }
}
