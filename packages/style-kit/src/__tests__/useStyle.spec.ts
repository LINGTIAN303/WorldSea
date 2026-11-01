import { beforeEach, describe, expect, it, vi } from 'vitest'

const load = async () => {
  vi.resetModules()
  return import('../composables/useStyle')
}

describe('useStyle', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-style')
    document.documentElement.removeAttribute('data-perf')
    document.documentElement.removeAttribute('style')
  })

  it('默认应用 mist 与预设四维值', async () => {
    const { applyPersistedStyle } = await load()
    applyPersistedStyle()
    expect(document.documentElement.dataset.style).toBe('mist')
    expect(document.documentElement.style.getPropertyValue('--sf-depth')).toBe('2')
    expect(document.documentElement.style.getPropertyValue('--sf-material')).toBe('50')
  })

  it('setStyle 持久化并应用', async () => {
    const { useStyle } = await load()
    useStyle().setStyle('neu')
    expect(document.documentElement.dataset.style).toBe('neu')
    expect(localStorage.getItem('worldsea_ui_style')).toBe('neu')
  })

  it('setAxis 夹取范围并写变量', async () => {
    const { useStyle } = await load()
    useStyle().setAxis('depth', 9)
    expect(document.documentElement.style.getPropertyValue('--sf-depth')).toBe('3')
    expect(JSON.parse(localStorage.getItem('worldsea_ui_style_axes')!)).toEqual({ depth: 3 })
  })

  it('resetAxis 恢复预设值', async () => {
    const { useStyle } = await load()
    const api = useStyle()
    api.setAxis('material', 10)
    api.resetAxis('material')
    expect(document.documentElement.style.getPropertyValue('--sf-material')).toBe('50')
    expect(localStorage.getItem('worldsea_ui_style_axes')).toBeNull()
  })

  it('性能模式写入 data-perf', async () => {
    const { useStyle } = await load()
    useStyle().setPerfMode(true)
    expect(document.documentElement.dataset.perf).toBe('on')
    expect(localStorage.getItem('worldsea_ui_style_perf')).toBe('1')
  })

  it('setStyle 期间挂过渡类并自动移除', async () => {
    vi.useFakeTimers()
    const { useStyle } = await load()
    useStyle().setStyle('neu')
    expect(document.documentElement.classList.contains('is-style-switching')).toBe(true)
    vi.advanceTimersByTime(250)
    expect(document.documentElement.classList.contains('is-style-switching')).toBe(false)
    vi.useRealTimers()
  })

  it('玻璃变体持久化并应用', async () => {
    const { useStyle } = await load()
    useStyle().setGlassVariant('clear')
    expect(document.documentElement.dataset.glass).toBe('clear')
    expect(localStorage.getItem('worldsea_ui_style_glass')).toBe('clear')
  })

  it('液化玻璃可选并持久化', async () => {
    const { useStyle } = await load()
    const api = useStyle()
    api.setStyle('liquid-glass')
    expect(api.styleId.value).toBe('liquid-glass')
    expect(document.documentElement.dataset.style).toBe('liquid-glass')
    expect(localStorage.getItem('worldsea_ui_style')).toBe('liquid-glass')
  })
})
