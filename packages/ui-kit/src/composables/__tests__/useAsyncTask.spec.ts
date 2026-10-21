import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LOADING_DELAY_MS,
  LOADING_MIN_VISIBLE_MS,
  LOADING_SUCCESS_HOLD_MS,
  useAsyncTask,
} from '../useAsyncTask'

describe('useAsyncTask（加载状态机）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('延迟内完成：不出现加载（不闪）', async () => {
    const task = useAsyncTask()
    const promise = task.run(async () => 'ok')

    await vi.advanceTimersByTimeAsync(50)
    await expect(promise).resolves.toBe('ok')

    expect(task.status.value).toBe('success')
    expect(task.visible.value).toBe(false)
  })

  it('超过延迟：显示，并至少保留 minVisible', async () => {
    const task = useAsyncTask()
    let resolveTask!: (value: string) => void
    const promise = task.run(() => new Promise<string>(resolve => { resolveTask = resolve }))

    expect(task.visible.value).toBe(false)
    await vi.advanceTimersByTimeAsync(LOADING_DELAY_MS)
    expect(task.visible.value).toBe(true)

    // 显示 100ms 后完成：剩余 minVisible 300ms，成功停留 300ms，二者取大仍为 300ms
    await vi.advanceTimersByTimeAsync(100)
    resolveTask('ok')
    await expect(promise).resolves.toBe('ok')

    expect(task.status.value).toBe('success')
    expect(task.visible.value).toBe(true)

    await vi.advanceTimersByTimeAsync(LOADING_MIN_VISIBLE_MS - 100 - 1)
    expect(task.visible.value).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(task.visible.value).toBe(false)
  })

  it('成功停留：超过 minVisible 后仍保留 successHold', async () => {
    const task = useAsyncTask({ delay: 0, minVisible: 0, successHold: LOADING_SUCCESS_HOLD_MS })
    let resolveTask!: (value: string) => void
    const promise = task.run(() => new Promise<string>(resolve => { resolveTask = resolve }))

    expect(task.visible.value).toBe(true)
    resolveTask('ok')
    await expect(promise).resolves.toBe('ok')

    expect(task.visible.value).toBe(true)
    await vi.advanceTimersByTimeAsync(LOADING_SUCCESS_HOLD_MS - 1)
    expect(task.visible.value).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(task.visible.value).toBe(false)
  })

  it('失败：立即显示错误并保留错误信息，直到 reset', async () => {
    const task = useAsyncTask()

    const promise = task.run(() => Promise.reject(new Error('boom')))
    await expect(promise).rejects.toThrow('boom')

    expect(task.status.value).toBe('error')
    expect(task.visible.value).toBe(true)
    expect(task.error.value).toBe('boom')

    task.reset()
    expect(task.status.value).toBe('idle')
    expect(task.visible.value).toBe(false)
    expect(task.error.value).toBeNull()
  })

  it('empty 谓词：命中时进入空态', async () => {
    const task = useAsyncTask()
    await task.run(async () => [] as string[], { empty: value => value.length === 0 })
    expect(task.status.value).toBe('empty')
  })

  it('错误态重试：保持浮层可见，避免闪烁', async () => {
    const task = useAsyncTask({ delay: 0 })
    const failed = task.run(() => Promise.reject(new Error('boom')))
    await expect(failed).rejects.toThrow('boom')
    expect(task.visible.value).toBe(true)

    let resolveRetry!: (value: string) => void
    const retry = task.run(() => new Promise<string>(resolve => { resolveRetry = resolve }))
    expect(task.status.value).toBe('loading')
    expect(task.visible.value).toBe(true)

    resolveRetry('ok')
    await expect(retry).resolves.toBe('ok')
    expect(task.status.value).toBe('success')
  })

  it('reset 可取消显示与后续计时', async () => {
    const task = useAsyncTask()
    void task.run(() => new Promise(() => {}))
    await vi.advanceTimersByTimeAsync(LOADING_DELAY_MS)
    expect(task.visible.value).toBe(true)

    task.reset()
    expect(task.status.value).toBe('idle')
    expect(task.visible.value).toBe(false)

    await vi.advanceTimersByTimeAsync(LOADING_MIN_VISIBLE_MS + LOADING_SUCCESS_HOLD_MS)
    expect(task.visible.value).toBe(false)
  })
})
