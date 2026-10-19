/**
 * storylineRows 单测 —— 线索式表现形式的行构建（纯函数）。
 * 语义对齐原「情节线索」页签（useOutlineStorylines.ts:5-15 + OutlineView.vue:91-104），
 * 另守两处**输入容错改进**：中文逗号分隔、中文拼音序排序。
 */
import { describe, it, expect } from 'vitest'
import {
  buildStorylineRows,
  collectStorylines,
  estimateStorylineHeight,
  normalizeStorylineSort,
  parseStorylines,
} from '../board/forms/storylineRows'

interface N {
  id: string
  name?: string
  properties: Record<string, unknown>
}

function node(id: string, storylines = '', extra: Record<string, unknown> = {}): N {
  return { id, name: `节点${id}`, properties: { parentId: '', order: 0, storylines, ...extra } }
}

describe('storylineRows / parseStorylines', () => {
  it('英文逗号分隔 + 去空白', () => {
    expect(parseStorylines('主线, 支线 ,伏线')).toEqual(['主线', '支线', '伏线'])
  })

  it('中文逗号同样分隔（中文输入法下的默认逗号）', () => {
    expect(parseStorylines('主线，支线')).toEqual(['主线', '支线'])
  })

  it('两种逗号混用、重复项去重且保持出现顺序', () => {
    expect(parseStorylines('主线, 支线，主线')).toEqual(['主线', '支线'])
  })

  it('空值 / 非字符串 / 全空白 → 空数组', () => {
    expect(parseStorylines('')).toEqual([])
    expect(parseStorylines('  ,  , ')).toEqual([])
    expect(parseStorylines(undefined)).toEqual([])
    expect(parseStorylines(123)).toEqual([])
  })
})

describe('storylineRows / collectStorylines', () => {
  it('跨节点去重收集', () => {
    // 拼音序：支 zhī < 主 zhǔ
    expect(collectStorylines([node('a', '主线'), node('b', '主线,支线'), node('c', '')])).toEqual(['支线', '主线'])
  })

  it('按中文**拼音序**排列（localeCompare("zh-Hans-CN")，不是按码点）', () => {
    // 拼音：丙 bǐng < 甲 jiǎ < 乙 yǐ（按码点会是 丙 < 乙 < 甲，不符合直觉）
    expect(collectStorylines([node('a', '乙线'), node('b', '甲线'), node('c', '丙线')])).toEqual(['丙线', '甲线', '乙线'])
  })
})

describe('storylineRows / buildStorylineRows', () => {
  it('行 = 线索名 + 命中节点数 + 字数合计 + 节点名（保持传入顺序）', () => {
    const nodes = [
      node('a', '主线', { wordCount: 100 }),
      node('b', '主线,支线', { wordCount: 50 }),
      node('c', '支线', { wordCount: 7 }),
    ]
    const rows = buildStorylineRows(nodes)

    // 行序 = 拼音序：支 zhī 在 主 zhǔ 之前
    expect(rows.map(r => r.line)).toEqual(['支线', '主线'])
    expect(rows[1]).toMatchObject({ count: 2, wordCount: 150, nodeIds: ['a', 'b'], names: ['节点a', '节点b'] })
    expect(rows[0]).toMatchObject({ count: 2, wordCount: 57, nodeIds: ['b', 'c'], names: ['节点b', '节点c'] })
  })

  it('无线索的节点不产生行', () => {
    expect(buildStorylineRows([node('a', ''), node('b', '  ')])).toEqual([])
  })

  it('节点无名字时标签回退「未命名节点」', () => {
    const nodes: N[] = [{ id: 'a', name: '  ', properties: { parentId: '', order: 0, storylines: '主线' } }]
    expect(buildStorylineRows(nodes)[0].names).toEqual(['未命名节点'])
  })

  it('一条线索命中全部节点也成立（不因数量短路）', () => {
    expect(buildStorylineRows([node('a', '主权线'), node('b', '主权线'), node('c', '主权线')])[0].count).toBe(3)
  })

  it('高度估算：行数钳制在 [1, maxRows] 内', () => {
    expect(estimateStorylineHeight(0)).toBe(estimateStorylineHeight(1))
    expect(estimateStorylineHeight(100, 8)).toBe(estimateStorylineHeight(8, 8))
  })
})

describe('storylineRows / 信息密度（2026-10-19）', () => {
  const nodes = [
    node('a', '主线', { wordCount: 10 }),
    node('b', '主线', { wordCount: 20 }),
    node('c', '支线', { wordCount: 100 }),
    node('d', '伏线', { wordCount: 5 }),
  ]

  it('sortBy=count：按节点数降序，同数按名称拼音序', () => {
    const rows = buildStorylineRows(nodes, { sortBy: 'count' })
    expect(rows.map(r => r.line)).toEqual(['主线', '伏线', '支线'])
  })

  it('sortBy=wordCount：按字数降序', () => {
    const rows = buildStorylineRows(nodes, { sortBy: 'wordCount' })
    expect(rows.map(r => r.line)).toEqual(['支线', '主线', '伏线'])
  })

  it('maxLines：只返回前 N 行', () => {
    const rows = buildStorylineRows(nodes, { maxLines: '2' })
    expect(rows.map(r => r.line)).toEqual(['伏线', '支线'])
  })

  it('maxLines=all / 非法值：不截断', () => {
    expect(buildStorylineRows(nodes, { maxLines: 'all' })).toHaveLength(3)
    expect(buildStorylineRows(nodes, { maxLines: 'abc' })).toHaveLength(3)
  })

  it('normalizeStorylineSort：未知值回退 name（旧行为）', () => {
    expect(normalizeStorylineSort(undefined)).toBe('name')
    expect(normalizeStorylineSort('nope')).toBe('name')
    expect(normalizeStorylineSort('count')).toBe('count')
  })
})
