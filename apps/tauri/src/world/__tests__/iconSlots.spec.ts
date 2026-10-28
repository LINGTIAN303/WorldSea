import { describe, expect, it } from 'vitest'
import {
  buildDetailTabIconSlots,
  buildDomainIconSlots,
  buildIconSlots,
  buildRegionTypeIconSlots,
  entityTypeSlotsOf,
} from '../iconSlots'

describe('buildIconSlots', () => {
  it('芽槽位默认取视图图标，缺视图回退芽默认', () => {
    const slots = buildIconSlots({
      views: [{ id: 'concepts', label: '概念/设定库', icon: 'book-open', pluginId: 'official.concepts' }],
      sprouts: [
        { id: 'official.concepts', label: '概念/设定库', icon: 'concept' },
        { id: 'official.disabled', label: '停用芽', icon: 'flame' },
      ],
      plugins: [{ manifest: { id: 'official.concepts', name: '概念/设定库', domain: 'knowledge', entityTypes: ['concept'] } }],
      schemas: [],
    })
    expect(slots.find(slot => slot.key === 'sprout:official.concepts')?.defaultIcon).toBe('book-open')
    expect(slots.find(slot => slot.key === 'sprout:official.disabled')?.defaultIcon).toBe('flame')
  })

  it('实体类型槽位使用 schema 注册 icon', () => {
    const slots = buildIconSlots({
      views: [],
      sprouts: [],
      plugins: [],
      schemas: [{ type: 'book', label: '书籍', icon: 'book', pluginId: 'official.manuscript' }],
    })
    const slot = slots.find(item => item.key === 'entityType:book')
    expect(slot?.defaultIcon).toBe('book')
    expect(slot?.kind).toBe('entityType')
    expect(slot?.domain).toBeUndefined()
  })

  it('芽槽位带实体类型声明，便于同步计数', () => {
    const slots = buildIconSlots({
      views: [],
      sprouts: [{ id: 'official.manuscript', label: '正文写作', icon: 'manuscript' }],
      plugins: [{ manifest: { id: 'official.manuscript', name: '正文写作', domain: 'narrative', entityTypes: ['book', 'manuscript'] } }],
      schemas: [],
    })
    expect(slots.find(slot => slot.kind === 'sprout')?.entityTypes).toEqual(['book', 'manuscript'])
  })

  it('entityTypeSlotsOf 只返回目标芽名下的实体类型', () => {
    const slots = buildIconSlots({
      views: [],
      sprouts: [{ id: 'official.manuscript', label: '正文写作', icon: 'manuscript' }],
      plugins: [{ manifest: { id: 'official.manuscript', name: '正文写作', domain: 'narrative' } }],
      schemas: [
        { type: 'book', label: '书籍', icon: 'book', pluginId: 'official.manuscript' },
        { type: 'concept', label: '概念', icon: 'concept', pluginId: 'official.concepts' },
      ],
    })
    expect(entityTypeSlotsOf(slots, 'official.manuscript').map(slot => slot.key)).toEqual(['entityType:book'])
  })
})

describe('扩展槽位', () => {
  it('语义域只 8 个，key 与默认图标来自 SPROUT_DOMAINS', () => {
    const slots = buildDomainIconSlots()
    expect(slots).toHaveLength(8)
    expect(slots.map(slot => slot.key)).toContain('domain:life')
    expect(slots.find(slot => slot.key === 'domain:geo')?.defaultIcon).toBe('region')
    expect(slots.every(slot => slot.kind === 'domain')).toBe(true)
  })

  it('详情页通用 4 页共享 + 芽自定义页 15 个', () => {
    const slots = buildDetailTabIconSlots([
      { type: 'character', label: '角色', icon: 'character', pluginId: 'official.characters' },
    ])
    expect(slots.filter(slot => slot.entityType === '*')).toHaveLength(4)
    expect(slots.find(slot => slot.key === 'detailTab:*:info')?.defaultIcon).toBe('outline')
    expect(slots.filter(slot => slot.entityType === 'character')).toHaveLength(6)
    expect(slots.find(slot => slot.key === 'detailTab:character:family')).toMatchObject({
      kind: 'detailTab',
      label: '家谱',
      defaultIcon: 'tree',
      entityTypeLabel: '角色',
    })
    // V2 未注册的类型回退旧注册表中文名，设置分组不露英文 type key
    expect(slots.find(slot => slot.key === 'detailTab:organization:members')?.entityTypeLabel).toBe('势力')
    expect(slots).toHaveLength(19)
  })

  it('区域类型覆盖已知全集 18 个，星海题材值也在列', () => {
    const slots = buildRegionTypeIconSlots()
    expect(slots).toHaveLength(18)
    expect(slots.find(slot => slot.key === 'regionType:星海')?.defaultIcon).toBe('sparkle')
    expect(slots.find(slot => slot.key === 'regionType:城市')?.defaultIcon).toBe('city')
    expect(slots.every(slot => slot.kind === 'regionType' && slot.domain === 'geo')).toBe(true)
  })
})
