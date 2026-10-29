import { describe, it, expect, afterEach } from 'vitest'
import { isReducedMotion } from '../composables/useReducedMotion'

afterEach(() => {
  delete document.documentElement.dataset.reduceMotion
})

describe('isReducedMotion', () => {
  it('应用内开关开启时返回 true', () => {
    document.documentElement.dataset.reduceMotion = 'on'
    expect(isReducedMotion()).toBe(true)
  })

  it('开关关闭且系统未要求时返回 false', () => {
    document.documentElement.dataset.reduceMotion = 'off'
    expect(isReducedMotion()).toBe(false)
  })
})
