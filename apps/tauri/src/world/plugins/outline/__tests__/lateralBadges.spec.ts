/**
 * 横向关系徽章单测（G1.1，2026-10-19）
 *
 * 口径：**两端任一命中即算**——并列/对比对称，递进有向但「与谁有递进」对两端都成立。
 */
import { describe, it, expect } from 'vitest'
import type { Relation } from '@worldsea/entity-core'
import { lateralBadges, LATERAL_META, LATERAL_TYPES } from '../board/lateralBadges'

function rel(id: string, type: string, sourceId: string, targetId: string): Relation {
  return { id, type, sourceId, targetId, properties: {}, createdAt: '', updatedAt: '' } as unknown as Relation
}

describe('lateralBadges', () => {
  it('三种类型分别计数，且只在有关系时出现', () => {
    const relations = [
      rel('r1', LATERAL_TYPES.parallel, 'a', 'b'),
      rel('r2', LATERAL_TYPES.parallel, 'c', 'a'),
      rel('r3', LATERAL_TYPES.progressive, 'a', 'd'),
    ]
    const badges = lateralBadges(relations, 'a')
    expect(badges.map(b => [b.key, b.count])).toEqual([
      ['parallel', 2],
      ['progressive', 1],
    ])
  })

  it('对称关系：source 端与 target 端都能看到', () => {
    const relations = [rel('r1', LATERAL_TYPES.contrast, 'a', 'b')]
    expect(lateralBadges(relations, 'a')).toEqual([{ key: 'contrast', type: LATERAL_TYPES.contrast, count: 1 }])
    expect(lateralBadges(relations, 'b')).toEqual([{ key: 'contrast', type: LATERAL_TYPES.contrast, count: 1 }])
  })

  it('无关节点不产生徽章', () => {
    const relations = [rel('r1', LATERAL_TYPES.parallel, 'a', 'b')]
    expect(lateralBadges(relations, 'z')).toEqual([])
  })

  it('非横向关系类型被忽略', () => {
    const relations = [rel('r1', 'parent_child', 'a', 'b'), rel('r2', 'outline_mentions', 'a', 'c')]
    expect(lateralBadges(relations, 'a')).toEqual([])
  })

  it('空 nodeId / 空关系返回空数组', () => {
    expect(lateralBadges([rel('r1', LATERAL_TYPES.parallel, 'a', 'b')], '')).toEqual([])
    expect(lateralBadges([], 'a')).toEqual([])
  })

  it('每种徽章都有符号与中文名', () => {
    for (const key of Object.keys(LATERAL_META) as Array<keyof typeof LATERAL_META>) {
      expect(LATERAL_META[key].mark.length).toBeGreaterThan(0)
      expect(LATERAL_META[key].label.length).toBeGreaterThan(0)
    }
  })
})
