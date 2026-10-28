import { afterEach, describe, expect, it } from 'vitest'
import {
  clearEffectiveIconOverrides,
  detailTabIconSlot,
  setEffectiveIconOverrides,
} from '@worldsea/entity-core/core'
import { resolveDetailTabs } from '../detailTabs'

const custom = [{ id: 'family', label: '家谱', icon: 'tree' }]

function setOverride(key: string, icon: string): void {
  setEffectiveIconOverrides(new Map([[key, icon]]))
}

afterEach(() => clearEffectiveIconOverrides())

describe('resolveDetailTabs —— 页签图标覆盖', () => {
  it('通用页通配键对所有实体类型生效', () => {
    setOverride(detailTabIconSlot('*', 'info'), 'book')
    for (const entityType of ['character', 'region', 'event']) {
      const tabs = resolveDetailTabs({ hasCover: false, entityType })
      expect(tabs.find(tab => tab.id === 'info')?.icon, entityType).toBe('book')
    }
  })

  it('精确键优先于通用通配键', () => {
    setEffectiveIconOverrides(new Map([
      [detailTabIconSlot('*', 'info'), 'book'],
      [detailTabIconSlot('character', 'info'), 'flame'],
    ]))
    expect(resolveDetailTabs({ hasCover: false, entityType: 'character' }).find(tab => tab.id === 'info')?.icon).toBe('flame')
    expect(resolveDetailTabs({ hasCover: false, entityType: 'region' }).find(tab => tab.id === 'info')?.icon).toBe('book')
  })

  it('芽自定义页只认精确键，不继承通配键', () => {
    setEffectiveIconOverrides(new Map([
      [detailTabIconSlot('*', 'family'), 'flame'],
      [detailTabIconSlot('character', 'family'), 'book'],
    ]))
    expect(resolveDetailTabs({ hasCover: false, entityType: 'character', customTabs: custom }).find(tab => tab.id === 'family')?.icon).toBe('book')
    expect(resolveDetailTabs({ hasCover: false, entityType: 'region', customTabs: custom }).find(tab => tab.id === 'family')?.icon).toBe('tree')
  })

  it('未传实体类型时不解析覆盖', () => {
    setOverride(detailTabIconSlot('*', 'info'), 'book')
    expect(resolveDetailTabs({ hasCover: false }).find(tab => tab.id === 'info')?.icon).toBe('outline')
  })
})
