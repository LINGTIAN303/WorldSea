import { describe, expect, it } from 'vitest'
import { familyOfType } from '../policy/palette'
import { nodeSizeFor, nodeVisual, shapeForType } from '../policy/nodeStyle'

describe('nodeStyle', () => {
  it('注册表形状映射到 G6 内置形状', () => {
    expect(shapeForType('round-rectangle')).toBe('rect')
    expect(shapeForType('round-triangle')).toBe('triangle')
    expect(shapeForType('round-diamond')).toBe('diamond')
    expect(shapeForType('round-hexagon')).toBe('hexagon')
    expect(shapeForType('ellipse')).toBe('ellipse')
    expect(shapeForType('unknown')).toBe('circle')
  })

  it('类型归入 6 个语义族 + 中性辅助', () => {
    expect(familyOfType('character')).toBe('being')
    expect(familyOfType('region')).toBe('place')
    expect(familyOfType('outline_node')).toBe('narrative')
    expect(familyOfType('organization')).toBe('society')
    expect(familyOfType('item')).toBe('artifact')
    expect(familyOfType('concept')).toBe('concept')
    expect(familyOfType('note')).toBe('meta')
    expect(familyOfType('custom_unknown')).toBe('meta')
  })

  it('尺寸随度数单调增长，孤立节点更小且有上下限', () => {
    expect(nodeSizeFor(0, false)).toBe(7)
    expect(nodeSizeFor(1, false)).toBeLessThan(nodeSizeFor(4, false))
    expect(nodeSizeFor(4, false)).toBeLessThan(nodeSizeFor(16, false))
    expect(nodeSizeFor(100, false)).toBe(22)
    expect(nodeSizeFor(0, true)).toBeLessThan(nodeSizeFor(0, false))
  })

  it('椭圆/矩形返回宽高数组，其余返回单值', () => {
    const ellipse = nodeVisual('concept', 'ellipse', 2, false)
    expect(Array.isArray(ellipse.size)).toBe(true)
    const circle = nodeVisual('character', 'circle', 2, false)
    expect(typeof circle.size).toBe('number')
    expect(ellipse.fill).not.toBe(circle.fill)
  })
})
