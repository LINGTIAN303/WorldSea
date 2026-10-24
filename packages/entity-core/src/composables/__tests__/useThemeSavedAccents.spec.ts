import { describe, expect, it, vi, beforeEach } from 'vitest'
import { SAVED_ACCENTS_LIMIT } from '../useTheme'

// useTheme 为模块级单例状态（refs 在模块顶层）：每用例重置模块 + 清空 localStorage 保证隔离
beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
})

async function setup() {
  const mod = await import('../useTheme')
  return { mod, theme: mod.useTheme() }
}

describe('我的强调色（保存/应用/删除）', () => {
  it('保存当前自定义色并持久化；重复保存去重', async () => {
    const { theme } = await setup()
    theme.setCustomAccent('#4f46e5')
    expect(theme.saveCurrentAccent()).toBe(true)
    expect(theme.savedAccents.value).toEqual([theme.customAccentColor.value])
    theme.setCustomAccent('#2563eb')
    theme.saveCurrentAccent()
    expect(theme.savedAccents.value.length).toBe(2)
    // 切回第一个再保存：已在收藏 → false，列表不变
    theme.setCustomAccent('#4f46e5')
    expect(theme.saveCurrentAccent()).toBe(false)
    expect(theme.savedAccents.value.length).toBe(2)
    // localStorage 持久化
    expect(JSON.parse(localStorage.getItem('worldsea-accent-saved')!).length).toBe(2)
  })

  it('未激活自定义轴时保存为 no-op', async () => {
    const { theme } = await setup()
    expect(theme.customAccentColor.value).toBeNull()
    expect(theme.saveCurrentAccent()).toBe(false)
    expect(theme.savedAccents.value).toEqual([])
  })

  it(`上限 ${SAVED_ACCENTS_LIMIT}：超出挤掉最早`, async () => {
    const { theme } = await setup()
    const hues = ['#c2410c', '#0e7490', '#15803d', '#2563eb', '#4f46e5', '#0891b2', '#b45309', '#6d28d9', '#be123c', '#0f766e', '#4d7c0f', '#a21caf', '#7c2d12']
    for (const hex of hues.slice(0, SAVED_ACCENTS_LIMIT + 1)) {
      theme.setCustomAccent(hex)
      theme.saveCurrentAccent()
    }
    expect(theme.savedAccents.value.length).toBe(SAVED_ACCENTS_LIMIT)
    // 最早的 #c2410c 被挤出
    expect(theme.savedAccents.value).not.toContain('#c2410c')
    expect(theme.savedAccents.value[0]).toBe('#0e7490')
  })

  it('删除收藏仅移除记录，当前激活色不受影响', async () => {
    const { theme } = await setup()
    theme.setCustomAccent('#0e7490')
    theme.saveCurrentAccent()
    theme.removeSavedAccent(theme.customAccentColor.value!)
    expect(theme.savedAccents.value).toEqual([])
    expect(theme.currentThemeId.value).toBe('custom')
    expect(theme.customAccentColor.value).toBe('#0e7490')
    // localStorage 同步
    expect(JSON.parse(localStorage.getItem('worldsea-accent-saved')!)).toEqual([])
  })

  it('重启恢复：保存列表回读 + restorePersistedTheme 回放自定义轴', async () => {
    const first = await setup()
    first.theme.setCustomAccent('#15803d')
    first.theme.saveCurrentAccent()
    const savedHex = first.theme.customAccentColor.value
    // 模拟重启：重置模块（新 import 从 localStorage 还原状态）
    vi.resetModules()
    const second = await import('../useTheme')
    const theme2 = second.useTheme()
    expect(theme2.savedAccents.value).toEqual([savedHex])
    theme2.restorePersistedTheme()
    expect(theme2.currentThemeId.value).toBe('custom')
    expect(theme2.customAccentColor.value).toBe(savedHex)
  })
})
