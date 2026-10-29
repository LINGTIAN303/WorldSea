import { describe, it, expect, afterEach, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { useCarrierOpenWindow } from '../useDetailCarrier'

afterEach(() => vi.useRealTimers())

describe('useCarrierOpenWindow', () => {
  it('关闭后保留布局类，窗口结束再摘', async () => {
    vi.useFakeTimers()
    const split = ref(true)
    const selected = ref(true)
    const scope = effectScope()
    const open = scope.run(() => useCarrierOpenWindow(() => split.value, () => selected.value, 180))!
    expect(open.value).toBe(true)
    selected.value = false
    await nextTick()
    expect(open.value).toBe(true)
    vi.advanceTimersByTime(180)
    expect(open.value).toBe(false)
    scope.stop()
  })

  it('窗口内重新选中则保持', async () => {
    vi.useFakeTimers()
    const split = ref(true)
    const selected = ref(true)
    const scope = effectScope()
    const open = scope.run(() => useCarrierOpenWindow(() => split.value, () => selected.value, 180))!
    selected.value = false
    await nextTick()
    selected.value = true
    await nextTick()
    vi.advanceTimersByTime(180)
    expect(open.value).toBe(true)
    scope.stop()
  })

  it('载体切换为非分栏时立即回落', async () => {
    vi.useFakeTimers()
    const split = ref(true)
    const selected = ref(true)
    const scope = effectScope()
    const open = scope.run(() => useCarrierOpenWindow(() => split.value, () => selected.value, 180))!
    selected.value = false
    await nextTick()
    split.value = false
    await nextTick()
    expect(open.value).toBe(false)
    scope.stop()
  })
})
