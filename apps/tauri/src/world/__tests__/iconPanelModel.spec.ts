import { describe, expect, it } from 'vitest'
import {
  defaultSyncFor,
  groupDetailTabSlots,
  groupDomainSlots,
  groupEntityTypeSlots,
  groupRegionTypeSlots,
  groupSproutSlots,
  iconSlotKindLabel,
  iconSourceLabel,
  syncTargetKeys,
  UNCLASSIFIED_SLOT_DOMAIN,
} from '../iconPanelModel'
import type { IconSlot } from '../iconSlots'

function slot(partial: Partial<IconSlot> & Pick<IconSlot, 'key' | 'kind' | 'label'>): IconSlot {
  return {
    defaultIcon: 'manuscript',
    entityTypes: [],
    ...partial,
  }
}

describe('groupSproutSlots', () => {
  it('按 8 域顺序分组，未分类最后', () => {
    const groups = groupSproutSlots([
      slot({ key: 'sprout:b', kind: 'sprout', label: '乙', domain: 'geo' }),
      slot({ key: 'sprout:c', kind: 'sprout', label: '丙', domain: 'unknown' }),
      slot({ key: 'sprout:a', kind: 'sprout', label: '甲', domain: 'geo' }),
      slot({ key: 'entityType:x', kind: 'entityType', label: '实体' }),
    ])
    expect(groups.map(group => group.id)).toEqual(['geo', UNCLASSIFIED_SLOT_DOMAIN])
    expect(groups[0].items.map(item => item.label)).toEqual(['甲', '乙'])
    expect(groups[1].label).toBe('未分类')
  })
})

describe('groupEntityTypeSlots', () => {
  it('按所属芽名称分组并排序', () => {
    const groups = groupEntityTypeSlots([
      slot({ key: 'entityType:book', kind: 'entityType', label: '书籍', pluginId: 'official.manuscript' }),
      slot({ key: 'entityType:concept', kind: 'entityType', label: '概念', pluginId: 'official.concepts' }),
      slot({ key: 'entityType:x', kind: 'entityType', label: '游离' }),
    ], [
      { manifest: { id: 'official.manuscript', name: '正文写作' } },
      { manifest: { id: 'official.concepts', name: '概念/设定库' } },
    ])
    expect(groups.map(group => group.label)).toEqual(['概念/设定库', '正文写作', '未分类'])
    expect(groups[0].items[0].label).toBe('概念')
  })
})

describe('扩展槽位分组', () => {
  it('语义域单组，保持域顺序', () => {
    const groups = groupDomainSlots([
      slot({ key: 'domain:life', kind: 'domain', label: '生命与族群' }),
      slot({ key: 'domain:geo', kind: 'domain', label: '地理与场所' }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ id: 'domain', label: '语义域', icon: 'globe' })
    expect(groups[0].items.map(item => item.key)).toEqual(['domain:life', 'domain:geo'])
  })

  it('详情页通用页在首，其余按实体类型分组', () => {
    const groups = groupDetailTabSlots([
      slot({ key: 'detailTab:*:info', kind: 'detailTab', label: '信息', entityType: '*', entityTypeLabel: '通用页签' }),
      slot({ key: 'detailTab:character:family', kind: 'detailTab', label: '家谱', entityType: 'character', entityTypeLabel: '角色' }),
      slot({ key: 'detailTab:character:names', kind: 'detailTab', label: '称呼', entityType: 'character', entityTypeLabel: '角色' }),
      slot({ key: 'detailTab:region:subregions', kind: 'detailTab', label: '子区域', entityType: 'region', entityTypeLabel: '区域' }),
    ])
    expect(groups.map(group => group.id)).toEqual(['shared', 'character', 'region'])
    expect(groups[0].label).toBe('通用页签')
    expect(groups[1].items).toHaveLength(2)
  })

  it('区域类型单组', () => {
    const groups = groupRegionTypeSlots([
      slot({ key: 'regionType:大陆', kind: 'regionType', label: '大陆' }),
    ])
    expect(groups[0]).toMatchObject({ id: 'regionType', label: '区域类型', icon: 'region' })
  })

  it('选择器标题文案覆盖五种槽位', () => {
    expect(iconSlotKindLabel('sprout')).toBe('芽')
    expect(iconSlotKindLabel('entityType')).toBe('实体类型')
    expect(iconSlotKindLabel('domain')).toBe('语义域')
    expect(iconSlotKindLabel('detailTab')).toBe('详情页签')
    expect(iconSlotKindLabel('regionType')).toBe('区域类型')
  })
})

describe('同步判定', () => {
  const typeSlots = [
    slot({ key: 'entityType:book', kind: 'entityType', label: '书籍' }),
  ]

  it('唯一实体类型且仍为默认时默认勾选', () => {
    expect(defaultSyncFor(typeSlots, () => 'default')).toBe(true)
    expect(defaultSyncFor(typeSlots, () => 'global')).toBe(false)
    expect(defaultSyncFor([...typeSlots, slot({ key: 'entityType:m', kind: 'entityType', label: '正文' })], () => 'default')).toBe(false)
  })

  it('联动只包含仍为默认的实体类型', () => {
    const all = [
      ...typeSlots,
      slot({ key: 'entityType:m', kind: 'entityType', label: '正文' }),
      slot({ key: 'entityType:x', kind: 'entityType', label: '已改' }),
    ]
    const sources: Record<string, 'default' | 'global' | 'project'> = {
      'entityType:book': 'default',
      'entityType:m': 'global',
      'entityType:x': 'project',
    }
    expect(syncTargetKeys(all, key => sources[key] ?? 'default')).toEqual(['entityType:book'])
  })

  it('已同步过（项目覆盖且与本芽图标一致）仍视为跟随', () => {
    expect(defaultSyncFor(typeSlots, () => 'project', () => 'book-open', 'book-open')).toBe(true)
    expect(syncTargetKeys(typeSlots, () => 'project', () => 'book-open', 'book-open')).toEqual(['entityType:book'])
  })

  it('已单独改成别的图标不联动', () => {
    expect(defaultSyncFor(typeSlots, () => 'project', () => 'flame', 'book-open')).toBe(false)
    expect(syncTargetKeys(typeSlots, () => 'project', () => 'flame', 'book-open')).toEqual([])
  })

  it('来源文案三档', () => {
    expect(iconSourceLabel('default')).toBe('默认')
    expect(iconSourceLabel('global')).toBe('全局')
    expect(iconSourceLabel('project')).toBe('项目')
  })
})
