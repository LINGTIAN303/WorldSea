import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  buildEffectiveMap,
  ICON_GLOBAL_STORAGE_KEY,
  pickNewerProjectState,
  sanitizeOverrides,
  useIconOverrideStore,
} from '../iconOverrideStore'

describe('iconOverrideStore', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('项目覆盖优先于全局', () => {
    const s = useIconOverrideStore()
    s.setGlobalIcon('sprout:a', 'book')
    s.setProjectIcon('sprout:a', 'flame')
    expect(s.sourceOf('sprout:a')).toBe('project')
    expect(s.resolve('sprout:a', 'default')).toBe('flame')
  })

  it('未覆盖时跟随全局；关闭跟随后快照为项目覆盖', () => {
    const s = useIconOverrideStore()
    s.setGlobalIcon('sprout:a', 'book')
    expect(s.sourceOf('sprout:a')).toBe('global')
    expect(s.resolve('sprout:a', 'default')).toBe('book')

    s.setFollowGlobal(false)
    expect(s.sourceOf('sprout:a')).toBe('project')
    expect(s.resolve('sprout:a', 'default')).toBe('book')
  })

  it('关闭跟随全局时快照当前全局图标，画面不跳', () => {
    const s = useIconOverrideStore()
    s.setGlobalIcon('sprout:a', 'book')
    s.setGlobalIcon('sprout:b', 'flame')
    s.setProjectIcon('sprout:b', 'gem')

    expect(s.setFollowGlobal(false)).toBe(1)
    expect(s.project.followGlobal).toBe(false)
    expect(s.sourceOf('sprout:a')).toBe('project')
    expect(s.resolve('sprout:a', 'default')).toBe('book')
    expect(s.resolve('sprout:b', 'default')).toBe('gem')
  })

  it('回到芽默认会清空项目覆盖并停止跟随', () => {
    const s = useIconOverrideStore()
    s.setGlobalIcon('sprout:a', 'book')
    s.setProjectIcon('sprout:a', 'flame')
    s.resetToDefaults()
    expect(s.project.followGlobal).toBe(false)
    expect(s.project.overrides).toEqual({})
    expect(s.resolve('sprout:a', 'default')).toBe('default')
  })

  it('应用到全局同时落全局与本项目', () => {
    const s = useIconOverrideStore()
    s.applyToGlobal('entityType:concept', 'lightbulb')
    expect(s.global.overrides['entityType:concept']).toBe('lightbulb')
    expect(s.project.overrides['entityType:concept']).toBe('lightbulb')
    expect(s.sourceOf('entityType:concept')).toBe('project')
  })

  it('清除全局只影响未落地本项目的槽位', () => {
    const s = useIconOverrideStore()
    s.setGlobalIcon('sprout:a', 'book')
    s.setProjectIcon('sprout:a', 'flame')
    s.clearGlobalIcon('sprout:a')
    expect(s.global.overrides['sprout:a']).toBeUndefined()
    expect(s.resolve('sprout:a', 'default')).toBe('flame')
  })

  it('全局层写 localStorage，键名固定', () => {
    const s = useIconOverrideStore()
    s.setGlobalIcon('sprout:a', 'book')
    const raw = localStorage.getItem(ICON_GLOBAL_STORAGE_KEY)
    expect(raw).toContain('sprout:a')
    expect(raw).toContain('book')
  })
})

describe('buildEffectiveMap', () => {
  it('跟随开启时全局先铺、项目覆盖后压', () => {
    const map = buildEffectiveMap(
      { version: 1, overrides: { a: 'book', b: 'flame' } },
      { version: 1, followGlobal: true, overrides: { b: 'gem' } },
    )
    expect(map.get('a')).toBe('book')
    expect(map.get('b')).toBe('gem')
  })

  it('跟随关闭时忽略全局', () => {
    const map = buildEffectiveMap(
      { version: 1, overrides: { a: 'book' } },
      { version: 1, followGlobal: false, overrides: {} },
    )
    expect(map.size).toBe(0)
  })
})

describe('pickNewerProjectState', () => {
  const db = { version: 1 as const, followGlobal: true, overrides: { a: 'book' }, updatedAt: 100 }
  const fallback = { version: 1 as const, followGlobal: true, overrides: { a: 'flame' }, updatedAt: 200 }

  it('回退时间戳更新时取回退（防快速重启丢最后一次写入）', () => {
    expect(pickNewerProjectState(db, fallback)?.overrides.a).toBe('flame')
  })

  it('项目库更新或时间相同时取项目库', () => {
    expect(pickNewerProjectState({ ...db, updatedAt: 300 }, fallback)?.overrides.a).toBe('book')
    expect(pickNewerProjectState(db, { ...fallback, updatedAt: 100 })?.overrides.a).toBe('book')
  })

  it('一侧为空时取另一侧', () => {
    expect(pickNewerProjectState(null, fallback)?.overrides.a).toBe('flame')
    expect(pickNewerProjectState(db, null)?.overrides.a).toBe('book')
    expect(pickNewerProjectState(null, null)).toBeNull()
  })
})

describe('sanitizeOverrides', () => {
  it('丢弃非字符串与空值，保留未知槽位', () => {
    expect(sanitizeOverrides({
      'sprout:a': 'book',
      'sprout:b': '',
      'sprout:c': 42,
      'ws.unknown': 'flame',
    })).toEqual({ 'sprout:a': 'book', 'ws.unknown': 'flame' })
  })

  it('非对象输入返回空表', () => {
    expect(sanitizeOverrides(null)).toEqual({})
    expect(sanitizeOverrides([])).toEqual({})
    expect(sanitizeOverrides('x')).toEqual({})
  })
})
