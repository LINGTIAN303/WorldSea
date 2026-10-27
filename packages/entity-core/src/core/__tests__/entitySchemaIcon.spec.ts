import { afterEach, describe, expect, it } from 'vitest'
import { EntitySchemaRegistry } from '../EntitySchema'
import {
  clearEffectiveIconOverrides,
  entityTypeIconSlot,
  setEffectiveIconOverrides,
} from '../iconOverrides'

afterEach(() => clearEffectiveIconOverrides())

describe('EntitySchemaRegistry.getIconName', () => {
  it('优先使用注册的 icon，而不是静态表', () => {
    const r = new EntitySchemaRegistry()
    r.register({ typeKey: 'book', label: '书籍', icon: 'book', fields: [] })
    expect(r.getIconName('book')).toBe('book')
    expect(r.getDefaultIconName('book')).toBe('book')
  })

  it('覆盖层优先于注册 icon', () => {
    const r = new EntitySchemaRegistry()
    r.register({ typeKey: 'book', label: '书籍', icon: 'book', fields: [] })
    setEffectiveIconOverrides(new Map([[entityTypeIconSlot('book'), 'flame']]))
    expect(r.getIconName('book')).toBe('flame')
    expect(r.getDefaultIconName('book')).toBe('book')
  })

  it('未注册 icon 时回退静态表，再回退 manuscript', () => {
    const r = new EntitySchemaRegistry()
    r.register({ typeKey: 'item', label: '道具', fields: [] })
    expect(r.getIconName('item')).toBe('item')
    expect(r.getIconName('unknown-type')).toBe('manuscript')
  })
})
