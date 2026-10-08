import { describe, expect, it } from 'vitest'
import { resolveDetailTabs, PINNED_TAB_IDS } from '../detailTabs'

const custom = [
  { id: 'family', label: '家谱', icon: 'tree' },
  { id: 'names', label: '称呼', icon: 'badge' },
]
const extras = [{ id: 'causal', label: '因果链', icon: 'link' }]

describe('resolveDetailTabs —— 组装序', () => {
  it('基础序：info → cover(有) → custom → extras → relations', () => {
    expect(resolveDetailTabs({ hasCover: true, customTabs: custom, extras }).map(t => t.id))
      .toEqual(['info', 'cover', 'family', 'names', 'causal', 'relations'])
  })

  it('无封面则无 cover（其余不动）', () => {
    expect(resolveDetailTabs({ hasCover: false, customTabs: custom }).map(t => t.id))
      .toEqual(['info', 'family', 'names', 'relations'])
  })

  it('最小输入＝info + relations（兜底恒在）', () => {
    expect(resolveDetailTabs({ hasCover: false }).map(t => t.id)).toEqual(['info', 'relations'])
  })
})

describe('resolveDetailTabs —— 用户覆写', () => {
  it('hidden 剔除；info 与 relations 钉底（存了也不隐）', () => {
    const tabs = resolveDetailTabs({
      hasCover: true,
      customTabs: custom,
      override: { hidden: ['family', 'info', 'relations'] },
    })
    expect(tabs.map(t => t.id)).toEqual(['info', 'cover', 'names', 'relations'])
  })

  it('order 列出者按序前置，未列出者保持默认序尾随', () => {
    const tabs = resolveDetailTabs({
      hasCover: true,
      customTabs: custom,
      override: { order: ['relations', 'family'] },
    })
    expect(tabs.map(t => t.id)).toEqual(['relations', 'family', 'info', 'cover', 'names'])
  })

  it('order 里不存在的 id 被忽略（不产生幽灵 tab）', () => {
    const tabs = resolveDetailTabs({
      hasCover: false,
      override: { order: ['ghost', 'relations'] },
    })
    expect(tabs.map(t => t.id)).toEqual(['relations', 'info'])
  })

  it('hidden 与 order 同时生效（先剔后排）', () => {
    const tabs = resolveDetailTabs({
      hasCover: true,
      customTabs: custom,
      override: { hidden: ['cover'], order: ['names'] },
    })
    expect(tabs.map(t => t.id)).toEqual(['names', 'info', 'family', 'relations'])
  })

  it('空覆写＝基础序（且不抖动对象）', () => {
    const a = resolveDetailTabs({ hasCover: true, customTabs: custom, override: {} })
    const b = resolveDetailTabs({ hasCover: true, customTabs: custom })
    expect(a.map(t => t.id)).toEqual(b.map(t => t.id))
  })

  it('钉底清单导出（消费侧共用）内容锁定', () => {
    expect(PINNED_TAB_IDS).toEqual(['info', 'relations'])
  })
})
