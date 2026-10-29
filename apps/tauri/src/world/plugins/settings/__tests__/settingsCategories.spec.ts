import { describe, expect, it } from 'vitest'
import { SETTINGS_CATEGORIES, SETTINGS_CATEGORY_KEYWORDS } from '../settingsCategories'

describe('设置分类', () => {
  it('含「首页」分类与搜索词', () => {
    expect(SETTINGS_CATEGORIES.some(c => c.id === 'home' && c.label === '首页')).toBe(true)
    expect(SETTINGS_CATEGORY_KEYWORDS.home).toContain('简介')
    expect(SETTINGS_CATEGORY_KEYWORDS.home).toContain('封面')
  })

  it('动画效果 tab 存在且靠前', () => {
    const idx = SETTINGS_CATEGORIES.findIndex(c => c.id === 'accessibility')
    expect(idx).toBe(1)
    expect(SETTINGS_CATEGORIES[idx]?.label).toBe('动画效果')
  })
})
