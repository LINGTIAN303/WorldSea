import { describe, expect, it } from 'vitest'
import { buildTimeline, formatAbsYear, isOutsideRange } from '../model/timeline'

describe('buildTimeline', () => {
  it('只收集带日期的实体，区间端点正确且按起点排序', () => {
    const index = buildTimeline([
      { id: 'a', properties: { date: '第三纪元147年' } },
      { id: 'b', properties: { date: '第三纪元100年', dateEnd: '第三纪元300年' } },
      { id: 'c', properties: {} },
      { id: 'd' },
    ])
    expect(index.datedCount).toBe(2)
    expect(index.points.map(p => p.id)).toEqual(['b', 'a'])
    expect(index.min).toBe(30100)
    expect(index.max).toBe(30300)
    expect(index.byId.get('a')).toMatchObject({ start: 30147, end: 30147 })
    expect(index.byId.get('b')).toMatchObject({ start: 30100, end: 30300 })
    expect(index.byId.has('c')).toBe(false)
    expect(index.byId.has('d')).toBe(false)
  })

  it('没有任何日期时返回空索引', () => {
    const index = buildTimeline([{ id: 'a' }, { id: 'b', properties: { date: '' } }])
    expect(index.datedCount).toBe(0)
    expect(index.points).toEqual([])
    expect(index.min).toBe(0)
    expect(index.max).toBe(0)
  })
})

describe('isOutsideRange', () => {
  it('区间与过滤窗口有交集时不隐藏', () => {
    const index = buildTimeline([
      { id: 'a', properties: { date: '第三纪元100年', dateEnd: '第三纪元300年' } },
    ])
    const point = index.byId.get('a')
    expect(isOutsideRange(point, 30200, 30400)).toBe(false)
    expect(isOutsideRange(point, 29950, 30100)).toBe(false)
  })

  it('区间完全在窗口外时隐藏', () => {
    const index = buildTimeline([{ id: 'a', properties: { date: '第三纪元100年' } }])
    const point = index.byId.get('a')
    expect(isOutsideRange(point, 30101, 30400)).toBe(true)
    expect(isOutsideRange(point, 1, 30099)).toBe(true)
  })

  it('无日期实体永不隐藏', () => {
    expect(isOutsideRange(undefined, 0, 0)).toBe(false)
  })
})

describe('formatAbsYear', () => {
  it('纪元年与公元前年都有可读文本', () => {
    expect(formatAbsYear(30147)).toBe('第3纪元 147年')
    expect(formatAbsYear(-520)).toBe('公元前 520 年')
    expect(formatAbsYear(0)).toBe('0 年')
    expect(formatAbsYear(147)).toBe('147 年')
  })
})
