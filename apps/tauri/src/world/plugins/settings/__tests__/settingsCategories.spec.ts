import { describe, expect, it } from 'vitest'
import { SETTINGS_CATEGORIES, SETTINGS_CATEGORY_KEYWORDS } from '../settingsCategories'

describe('设置分类', () => {
  it('含「首页」分类与搜索词', () => {
    expect(SETTINGS_CATEGORIES.some(c => c.id === 'home' && c.label === '首页')).toBe(true)
    expect(SETTINGS_CATEGORY_KEYWORDS.home).toContain('简介')
    expect(SETTINGS_CATEGORY_KEYWORDS.home).toContain('封面')
  })
})
