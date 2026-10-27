import { describe, expect, it } from 'vitest'
import {
  ICON_CATALOG,
  ICON_DOMAIN_IDS,
  isCatalogIconAvailable,
  searchIconCatalog,
} from '../iconCatalog'

describe('iconCatalog', () => {
  it('名称唯一且全部可解析', () => {
    const names = ICON_CATALOG.map(entry => entry.name)
    expect(new Set(names).size).toBe(names.length)
    for (const entry of ICON_CATALOG) {
      expect(isCatalogIconAvailable(entry.name), entry.name).toBe(true)
    }
  })

  it('每个条目有中文名、关键词和合法域', () => {
    for (const entry of ICON_CATALOG) {
      expect(entry.label.trim()).not.toBe('')
      expect(entry.keywords.trim()).not.toBe('')
      expect(entry.domains.length).toBeGreaterThan(0)
      for (const domain of entry.domains) expect(ICON_DOMAIN_IDS).toContain(domain)
    }
  })

  it('芽/实体类型默认图标均可找回', () => {
    const defaults = [
      'character', 'region', 'organization', 'concept', 'inspiration', 'item',
      'apparel', 'dashboard', 'mindmap', 'graph', 'building', 'species', 'magic',
      'outline', 'language', 'culture', 'combat', 'plant', 'target', 'weapon',
      'manuscript', 'drawing', 'tactical-board', 'notebook', 'lightning', 'grid',
      'book', 'puzzle',
    ]
    for (const name of defaults) {
      expect(ICON_CATALOG.some(entry => entry.name === name), name).toBe(true)
    }
  })

  it('中文、英文与关键词均可搜索', () => {
    expect(searchIconCatalog('概念').some(entry => entry.name === 'concept')).toBe(true)
    expect(searchIconCatalog('dragon').some(entry => entry.name === 'dragon')).toBe(true)
    expect(searchIconCatalog('魔法').some(entry => entry.name === 'magic')).toBe(true)
  })

  it('按域过滤', () => {
    const geoNames = searchIconCatalog('', 'geo').map(entry => entry.name)
    expect(geoNames).toContain('map')
    expect(geoNames).not.toContain('manuscript')
  })
})
