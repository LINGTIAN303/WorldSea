import { describe, it, expect, afterEach, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { useViewEntering } from '../useViewEntering'

afterEach(() => vi.useRealTimers())

describe('useViewEntering', () => {
  it('视图变化后进入，时限到后退出', async () => {
    vi.useFakeTimers()
    const viewId = ref('a')
    const scope = effectScope()
    const entering = scope.run(() => useViewEntering(() => viewId.value, 160))!
    expect(entering.value).toBe(false)
    viewId.value = 'b'
    await nextTick()
    expect(entering.value).toBe(true)
    vi.advanceTimersByTime(160)
    expect(entering.value).toBe(false)
    scope.stop()
  })

  it('同一视图刷新不触发', async () => {
    vi.useFakeTimers()
    const viewId = ref('a')
    const scope = effectScope()
    const entering = scope.run(() => useViewEntering(() => viewId.value, 160))!
    viewId.value = 'a'
    await nextTick()
    expect(entering.value).toBe(false)
    scope.stop()
  })

  it('快速切换只保留最后一次', async () => {
    vi.useFakeTimers()
    const viewId = ref('a')
    const scope = effectScope()
    const entering = scope.run(() => useViewEntering(() => viewId.value, 160))!
    viewId.value = 'b'
    await nextTick()
    expect(entering.value).toBe(true)
    viewId.value = 'c'
    await nextTick()
    await nextTick()
    expect(entering.value).toBe(true)
    vi.advanceTimersByTime(160)
    expect(entering.value).toBe(false)
    scope.stop()
  })
})
