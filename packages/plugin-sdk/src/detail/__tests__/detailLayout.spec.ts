import { describe, expect, it } from 'vitest'

import { DEFAULT_CONTENT_FORM, normalizeGroups, normalizeOrder, OTHER_GROUP, resolveLayout } from '../detailLayout'

const FIELDS = ['a', 'b', 'c', 'd']

describe('normalizeOrder —— 整表替换 + 缺失补齐', () => {
  it('未给顺序时按可用字段原序', () => {
    expect(normalizeOrder(undefined, FIELDS)).toEqual(FIELDS)
  })

  it('给出的顺序生效，漏掉的字段追加在后（新增字段不被旧预设吞掉）', () => {
    expect(normalizeOrder(['c', 'a'], FIELDS)).toEqual(['c', 'a', 'b', 'd'])
  })

  it('已失效的 key 剔除，重复 key 只留一次', () => {
    expect(normalizeOrder(['d', 'ghost', 'd', 'a'], FIELDS)).toEqual(['d', 'a', 'b', 'c'])
  })
})

describe('normalizeGroups —— 分组成员归一', () => {
  it('无分组声明时全部落「其它」', () => {
    expect(normalizeGroups(undefined, FIELDS)).toEqual([{ ...OTHER_GROUP, fieldKeys: FIELDS }])
  })

  it('组内顺序以各组自身 fieldKeys 为准（独立于全局 order）；组外字段补进其它', () => {
    const groups = normalizeGroups([
      { key: 'g1', label: '一组', fieldKeys: ['c', 'a'] },
    ], ['a', 'b', 'c', 'd'])
    expect(groups[0]).toMatchObject({ key: 'g1', fieldKeys: ['c', 'a'] })
    expect(groups[1]).toMatchObject({ key: OTHER_GROUP.key, fieldKeys: ['b', 'd'] })
  })

  it('重复声明的字段只归第一个组；未知 key 与空组剔除', () => {
    const groups = normalizeGroups([
      { key: 'g1', label: '', fieldKeys: ['a', 'ghost'] },
      { key: 'g2', label: '二组', fieldKeys: ['a', 'b'] },
      { key: 'g3', label: '空组', fieldKeys: ['ghost'] },
    ], ['a', 'b'])
    expect(groups).toEqual([
      { key: 'g1', label: 'g1', fieldKeys: ['a'] },
      { key: 'g2', label: '二组', fieldKeys: ['b'] },
    ])
  })
})

describe('resolveLayout —— 芽默认 ⊕ 用户覆写 ⊕ 即时态', () => {
  it('三层都不给 = 原序、单组、不隐藏、默认内容形态', () => {
    const layout = resolveLayout(FIELDS)
    expect(layout).toEqual({
      groups: [{ ...OTHER_GROUP, fieldKeys: FIELDS }],
      order: FIELDS,
      hidden: [],
      contentForm: DEFAULT_CONTENT_FORM,
      contentConfig: {},
    })
  })

  it('形态配置也走同一优先序（即时态 > 用户覆写 > 芽默认）', () => {
    const layout = resolveLayout(FIELDS, { contentConfig: { maxChips: 5 } }, { contentConfig: { maxChips: 9 } })
    expect(layout.contentConfig).toEqual({ maxChips: 9 })
    expect(resolveLayout(FIELDS, { contentConfig: { maxChips: 5 } }).contentConfig).toEqual({ maxChips: 5 })
  })

  it('后一层整表覆盖前一层', () => {
    const layout = resolveLayout(FIELDS, { order: ['a', 'b'] }, { order: ['d', 'c'] })
    expect(layout.order).toEqual(['d', 'c', 'a', 'b'])
  })

  it('即时态只改形态时，顺序/分组/隐藏都继承上层', () => {
    const layout = resolveLayout(FIELDS, { order: ['b', 'a'], hidden: ['c'] }, undefined, { contentForm: 'table' })
    expect(layout.order).toEqual(['b', 'a', 'c', 'd'])
    expect(layout.contentForm).toBe('table')
    expect(layout.hidden).toEqual(['c'])
    expect(layout.groups.flatMap(g => g.fieldKeys)).toEqual(['b', 'a', 'd'])
  })

  it('隐藏字段既不在分组里出现，也不被 hidden 里的幽灵 key 污染', () => {
    const layout = resolveLayout(FIELDS, { hidden: ['a', 'ghost'] })
    expect(layout.hidden).toEqual(['a'])
    expect(layout.groups.flatMap(g => g.fieldKeys)).not.toContain('a')
  })

  it('全局排序不再改组内顺序（组内独立）；「其它」仍跟随全局 order', () => {
    const layout = resolveLayout(
      FIELDS,
      { groups: [{ key: 'g1', label: '一组', fieldKeys: ['a', 'b'] }] },
      { order: ['b', 'a', 'd', 'c'] },
    )
    expect(layout.groups[0]).toMatchObject({ key: 'g1', fieldKeys: ['a', 'b'] })
    expect(layout.groups[1]).toMatchObject({ key: OTHER_GROUP.key, fieldKeys: ['d', 'c'] })
  })
})
