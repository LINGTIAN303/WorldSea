import { describe, expect, it } from 'vitest'
import { groupSproutsByDomain, mergeDomainOrder } from '../sproutDomainGroups'

describe('sproutDomainGroups', () => {
  it('按 manifest 域分组，未声明/未知域进未分类，空域不渲染', () => {
    const sprouts = [
      { id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' },
    ]
    const groups = groupSproutsByDomain(sprouts, id => (
      { a: 'geo', b: 'tool', c: 'unclassified', d: 'legacy' }[id] ?? 'unclassified'
    ))
    expect(groups.map(group => group.id)).toEqual(['geo', 'tool', 'unclassified'])
    expect(groups.find(group => group.id === 'unclassified')?.items.map(item => item.id)).toEqual(['c', 'd'])
  })

  it('域内拖拽只改该域芽的相对位置，跨域芽位置不动', () => {
    const order = ['a', 'x', 'b', 'y', 'c']
    const next = mergeDomainOrder(order, ['c', 'a', 'b'])
    expect(next).toEqual(['c', 'x', 'a', 'y', 'b'])
  })

  it('新 id 不在全局顺序时追加到末尾', () => {
    expect(mergeDomainOrder(['a', 'b'], ['b', 'a', 'z'])).toEqual(['b', 'a', 'z'])
  })
})
