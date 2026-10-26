import { describe, expect, it } from 'vitest'
import { edgeVisual, familyOfRelation } from '../policy/edgeStyle'

describe('edgeStyle', () => {
  it('关系类型归入 6 个语义族', () => {
    expect(familyOfRelation('part_of')).toBe('structural')
    expect(familyOfRelation('ally_of')).toBe('social')
    expect(familyOfRelation('located_in')).toBe('spatial')
    expect(familyOfRelation('caused_by')).toBe('causal')
    expect(familyOfRelation('outline_mentions')).toBe('narrative')
    expect(familyOfRelation('custom_relation')).toBe('other')
  })

  it('未登记的自定义关系按关键词兜底', () => {
    expect(familyOfRelation('outline_custom_edge')).toBe('narrative')
    expect(familyOfRelation('my_located_edge')).toBe('spatial')
    expect(familyOfRelation('blood_brother_of')).toBe('other')
  })

  it('方向语义：noArrow 无箭头，双向/对称双箭头', () => {
    expect(edgeVisual('knows', true, false, false, false).endArrow).toBe(false)
    expect(edgeVisual('knows', false, false, false, false)).toMatchObject({ endArrow: true, startArrow: false })
    expect(edgeVisual('knows', false, true, false, false)).toMatchObject({ endArrow: true, startArrow: true })
    expect(edgeVisual('knows', false, false, true, false)).toMatchObject({ endArrow: true, startArrow: true })
  })

  it('高亮档更亮更粗', () => {
    const base = edgeVisual('knows', false, false, false, false)
    const highlight = edgeVisual('knows', false, false, false, false, true)
    expect(highlight.lineWidth).toBeGreaterThan(base.lineWidth)
    expect(highlight.stroke).not.toBe(base.stroke)
  })

  it('虚线关系保留虚线', () => {
    expect(edgeVisual('knows', true, false, false, true).lineDash).toEqual([4, 4])
  })
})
