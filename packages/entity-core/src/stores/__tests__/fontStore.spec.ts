import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useFontStore } from '../fontStore'

/** 字体分层与字号档位守卫（字体系统 v2）：
 *  - 活跃层写 inline CSS 变量，重置移除；退役层（canvas/agent）永不写变量；
 *  - uiScale 钳位 0.85–1.15、默认 1 时移除 inline；reapplyAll 重放全部。 */

describe('fontStore 层变量写入', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.style.cssText = ''
    setActivePinia(createPinia())
  })

  it('chrome 层写入 family 后写 inline 变量，重置后移除', () => {
    const s = useFontStore()
    s.setLayerFont('chrome', 'MiSans')
    expect(document.documentElement.style.getPropertyValue('--font-family-chrome')).toContain('MiSans')
    s.resetLayer('chrome')
    expect(document.documentElement.style.getPropertyValue('--font-family-chrome')).toBe('')
  })

  it('content 层写入时 weight/style 非默认才写 inline，默认值移除', () => {
    const s = useFontStore()
    s.setLayerFont('content', 'Source Han Serif CN', 700, 'italic')
    expect(document.documentElement.style.getPropertyValue('--font-weight-content')).toBe('700')
    expect(document.documentElement.style.getPropertyValue('--font-style-content')).toBe('italic')
    s.setLayerVariant('content', 400, 'normal')
    expect(document.documentElement.style.getPropertyValue('--font-weight-content')).toBe('')
    expect(document.documentElement.style.getPropertyValue('--font-style-content')).toBe('')
  })

  it('退役层 canvas/agent 永不写 CSS 变量（agent 面已退场；canvas 仅渲染直读）', () => {
    const s = useFontStore()
    s.setLayerFont('agent', 'X', 700, 'italic')
    s.setLayerFont('canvas', 'X', 700, 'italic')
    expect(document.documentElement.style.getPropertyValue('--font-family-agent')).toBe('')
    expect(document.documentElement.style.getPropertyValue('--font-family-canvas')).toBe('')
    expect(document.documentElement.style.getPropertyValue('--font-weight-canvas')).toBe('')
  })

  it('uiScale 钳位 0.85–1.15 并写 inline；默认 1 移除 inline', () => {
    const s = useFontStore()
    s.setUiScale(2) // 超上限 → 钳到 1.15
    expect(document.documentElement.style.getPropertyValue('--ui-font-scale')).toBe('1.15')
    s.setUiScale(0.5)
    expect(document.documentElement.style.getPropertyValue('--ui-font-scale')).toBe('0.85')
    s.setUiScale(1)
    expect(document.documentElement.style.getPropertyValue('--ui-font-scale')).toBe('')
    expect(s.uiScale).toBe(1)
  })

  it('reapplyAll 重放层变量与字号档位（启动恢复链）', () => {
    const s = useFontStore()
    s.setLayerFont('chrome', 'LXGW', 500)
    s.setUiScale(1.08)
    document.documentElement.style.cssText = '' // 模拟重启后 inline 丢失
    s.reapplyAll()
    expect(document.documentElement.style.getPropertyValue('--font-family-chrome')).toContain('LXGW')
    expect(document.documentElement.style.getPropertyValue('--font-weight-chrome')).toBe('500')
    expect(document.documentElement.style.getPropertyValue('--ui-font-scale')).toBe('1.08')
  })
})
