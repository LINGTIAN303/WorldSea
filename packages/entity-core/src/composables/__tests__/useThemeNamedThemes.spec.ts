import { describe, expect, it, vi, beforeEach } from 'vitest'

// useTheme 为模块级单例状态：每用例重置模块 + 清空 localStorage 保证隔离
beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
})

async function setup() {
  const mod = await import('../useTheme')
  return { mod, theme: mod.useTheme() }
}

describe('命名主题（保存/应用/删除）', () => {
  it('保存当前覆盖为命名主题：剔除强调色管理键，空覆盖返回 null', async () => {
    const { theme } = await setup()
    // 仅强调色管理键 → 无有效覆盖 → null
    theme.setUserOverrides({ '--accent': '#123456' })
    expect(theme.saveCurrentOverridesAsTheme('我的主题')).toBeNull()
    // 混合覆盖：强调色键被剔除，其余保留
    theme.setUserOverrides({ '--radius-btn': '10px', '--accent': '#123456' })
    const saved = theme.saveCurrentOverridesAsTheme('我的主题')
    expect(saved).not.toBeNull()
    expect(saved!.tokens).toEqual({ '--radius-btn': '10px' })
    expect(theme.customThemes.value.length).toBe(1)
  })

  it('应用命名主题：整组替换当前覆盖', async () => {
    const { theme } = await setup()
    theme.setUserOverrides({ '--radius-btn': '10px' })
    const saved = theme.saveCurrentOverridesAsTheme('主题甲')
    theme.setUserOverrides({ '--spacing-gap': '32px' })
    expect(theme.userOverrides.value).toEqual({ '--spacing-gap': '32px' })
    expect(theme.applyNamedTheme(saved!.id)).toBe(true)
    expect(theme.userOverrides.value).toEqual({ '--radius-btn': '10px' })
    // 未知 id：false 且不动当前覆盖
    expect(theme.applyNamedTheme('nope')).toBe(false)
    expect(theme.userOverrides.value).toEqual({ '--radius-btn': '10px' })
  })

  it('删除命名主题并持久化；重启后列表与令牌回读', async () => {
    const first = await setup()
    first.theme.setUserOverrides({ '--radius-btn': '12px' })
    const saved = first.theme.saveCurrentOverridesAsTheme('重启主题')
    first.theme.removeCustomTheme(saved!.id)
    expect(first.theme.customThemes.value.length).toBe(0)
    // 重新保存用于重启验证
    first.theme.setUserOverrides({ '--radius-btn': '12px' })
    const saved2 = first.theme.saveCurrentOverridesAsTheme('重启主题')
    // 重启：重置模块后从 localStorage 回读
    vi.resetModules()
    const second = await import('../useTheme')
    const theme2 = second.useTheme()
    expect(theme2.customThemes.value.map(t => t.id)).toContain(saved2!.id)
    expect(theme2.applyNamedTheme(saved2!.id)).toBe(true)
    expect(theme2.userOverrides.value['--radius-btn']).toBe('12px')
  })

  it('空名/空白名保存为 null', async () => {
    const { theme } = await setup()
    theme.setUserOverrides({ '--radius-btn': '10px' })
    expect(theme.saveCurrentOverridesAsTheme('')).toBeNull()
    expect(theme.saveCurrentOverridesAsTheme('   ')).toBeNull()
    expect(theme.customThemes.value.length).toBe(0)
  })
})
