import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { startBackgroundTask, useBackgroundTask } from '../useBackgroundTask'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useBackgroundTask（R4）', () => {
  it('1s 内完成不显示', async () => {
    const task = startBackgroundTask('快速任务')
    const { active, count } = useBackgroundTask()
    expect(active.value).toBe(false)
    task.done()
    vi.advanceTimersByTime(1000)
    await nextTick()
    expect(active.value).toBe(false)
    expect(count.value).toBe(0)
  })

  it('超过 1s 出现；多个任务合并为 +n', async () => {
    const a = startBackgroundTask('同步实体')
    const b = startBackgroundTask('同步关系')
    const { active, count, label } = useBackgroundTask()

    vi.advanceTimersByTime(999)
    expect(active.value).toBe(false)
    vi.advanceTimersByTime(1)
    await nextTick()
    expect(active.value).toBe(true)
    expect(count.value).toBe(2)
    expect(label.value).toContain('同步关系 · +1')

    b.done()
    expect(count.value).toBe(1)
    expect(label.value).toBe('同步实体')

    a.done()
    await nextTick()
    expect(active.value).toBe(false)
  })

  it('fail 移除任务并派发失败事件', async () => {
    const listener = vi.fn()
    window.addEventListener('ws-background-failed', listener)
    const task = startBackgroundTask('同步外部变更')
    vi.advanceTimersByTime(1000)
    await nextTick()

    task.fail(new Error('磁盘不可写'))
    await nextTick()
    expect(useBackgroundTask().active.value).toBe(false)
    expect(listener).toHaveBeenCalledTimes(1)
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({
      label: '同步外部变更',
      message: '磁盘不可写',
    })
    window.removeEventListener('ws-background-failed', listener)
  })
})
