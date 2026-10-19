import { describe, it, expect } from 'vitest'
import {
  DEFAULT_TABLE_COLUMNS,
  EMPTY_CELL,
  TABLE_COLUMN_LABELS,
  buildTableRows,
  cellValueOf,
  columnSpecs,
  normalizeColumns,
  tableNodeName,
  type TableSourceNode,
} from '../board/forms/tableRows'

function node(
  id: string,
  parentId: string,
  order: number,
  extra: { name?: string; status?: string; wordCount?: number; nodeType?: string; storylines?: string } = {},
): TableSourceNode {
  return {
    id,
    name: extra.name ?? id,
    properties: {
      parentId,
      order,
      status: extra.status ?? '未写',
      ...(extra.wordCount !== undefined ? { wordCount: extra.wordCount } : {}),
      ...(extra.nodeType !== undefined ? { nodeType: extra.nodeType } : {}),
      ...(extra.storylines !== undefined ? { storylines: extra.storylines } : {}),
    },
  }
}

const TREE: TableSourceNode[] = [
  node('root', '', 1, { name: '第一章', status: '草稿' }),
  node('a', 'root', 2, { name: '场景A', status: '完成', wordCount: 1200 }),
  node('b', 'root', 1, { name: '场景B', status: '未写' }),
  node('a1', 'a', 1, { name: '镜头1', status: '草稿', wordCount: 30 }),
]

describe('tableRows / 列归一化', () => {
  it('未传或非数组时用默认三列', () => {
    expect(normalizeColumns(undefined)).toEqual(DEFAULT_TABLE_COLUMNS)
    expect(normalizeColumns('title')).toEqual(DEFAULT_TABLE_COLUMNS)
    expect(normalizeColumns([])).toEqual(DEFAULT_TABLE_COLUMNS)
  })

  it('丢弃未知列，保留声明顺序', () => {
    expect(normalizeColumns(['wordCount', 'nope', 'status'])).toEqual(['wordCount', 'status'])
  })

  it('重复列去重', () => {
    expect(normalizeColumns(['title', 'title', 'status'])).toEqual(['title', 'status'])
  })

  it('接受新增的「节点类型 / 所属线索」列（2026-10-19 信息密度）', () => {
    expect(normalizeColumns(['nodeType', 'storylines'])).toEqual(['nodeType', 'storylines'])
    expect(TABLE_COLUMN_LABELS.nodeType).toBe('节点类型')
    expect(TABLE_COLUMN_LABELS.storylines).toBe('所属线索')
  })

  it('columnSpecs 给出中文表头', () => {
    expect(columnSpecs(['title', 'order'])).toEqual([
      { key: 'title', label: TABLE_COLUMN_LABELS.title },
      { key: 'order', label: TABLE_COLUMN_LABELS.order },
    ])
  })
})

describe('tableRows / 单元格取值', () => {
  it('标题与状态有语义兜底', () => {
    expect(cellValueOf('title', node('x', '', 1, { name: '  ' }))).toBe('未命名节点')
    expect(tableNodeName(node('y', '', 1, { name: '有名字' }))).toBe('有名字')
    expect(cellValueOf('status', { id: 'z', properties: {} })).toBe('未写')
  })

  it('数值型缺值显示占位（不伪装成 0）', () => {
    expect(cellValueOf('wordCount', node('a', '', 1))).toBe(EMPTY_CELL)
    expect(cellValueOf('wordCount', node('a', '', 1, { wordCount: 0 }))).toBe(EMPTY_CELL)
    expect(cellValueOf('wordCount', node('a', '', 1, { wordCount: 88 }))).toBe('88')
    expect(cellValueOf('order', node('a', '', 3))).toBe('3')
    expect(cellValueOf('order', { id: 'q', properties: {} })).toBe(EMPTY_CELL)
  })

  it('节点类型：英文四值转中文，未知值原样显示，缺值占位', () => {
    expect(cellValueOf('nodeType', node('a', '', 1, { nodeType: 'act' }))).toBe('幕')
    expect(cellValueOf('nodeType', node('a', '', 1, { nodeType: 'sequence' }))).toBe('序列')
    expect(cellValueOf('nodeType', node('a', '', 1, { nodeType: 'scene' }))).toBe('场景')
    expect(cellValueOf('nodeType', node('a', '', 1, { nodeType: 'beat' }))).toBe('节拍')
    expect(cellValueOf('nodeType', node('a', '', 1, { nodeType: 'custom' }))).toBe('custom')
    expect(cellValueOf('nodeType', node('a', '', 1))).toBe(EMPTY_CELL)
  })

  it('所属线索：原样显示，空值占位（不改写分隔符）', () => {
    expect(cellValueOf('storylines', node('a', '', 1, { storylines: '主线、支线' }))).toBe('主线、支线')
    expect(cellValueOf('storylines', node('a', '', 1, { storylines: '  ' }))).toBe(EMPTY_CELL)
    expect(cellValueOf('storylines', node('a', '', 1))).toBe(EMPTY_CELL)
  })
})

describe('tableRows / 行构建', () => {
  it('行 = 直接子节点，按 order 升序；不递归（孙子不出现）', () => {
    const r = buildTableRows({ nodes: TREE, nodeId: 'root', columns: ['title'] })
    expect(r.rows.map(row => row.title)).toEqual(['场景B', '场景A'])
    expect(r.empty).toBe(false)
  })

  it('includeSelf 时本节点作首行', () => {
    const r = buildTableRows({ nodes: TREE, nodeId: 'root', columns: ['title'], includeSelf: true })
    expect(r.rows.map(row => row.title)).toEqual(['第一章', '场景B', '场景A'])
  })

  it('列顺序决定键顺序（供 DataTable 直接消费）', () => {
    const r = buildTableRows({ nodes: TREE, nodeId: 'root', columns: ['status', 'wordCount'] })
    expect(r.columns.map(c => c.key)).toEqual(['status', 'wordCount'])
    expect(Object.keys(r.rows[0])).toEqual(['__id', 'status', 'wordCount'])
    expect(r.rows[1].wordCount).toBe('1200')
  })

  it('无子节点的叶子节点 → 空表（组件显示空态）', () => {
    const r = buildTableRows({ nodes: TREE, nodeId: 'b' })
    expect(r.rows).toEqual([])
    expect(r.empty).toBe(true)
  })

  it('叶子节点用 includeSelf 时只有本节点一行', () => {
    const r = buildTableRows({ nodes: TREE, nodeId: 'b', includeSelf: true })
    expect(r.rows.map(row => row.title)).toEqual(['场景B'])
    expect(r.empty).toBe(false)
  })

  it('节点不存在（悬空容器）→ 空表且不抛错', () => {
    const r = buildTableRows({ nodes: TREE, nodeId: 'ghost' })
    expect(r.rows).toEqual([])
    expect(r.empty).toBe(true)
  })

  it('子节点被删即从行中消失（派生型无需清理逻辑）', () => {
    const withoutA = TREE.filter(n => n.id !== 'a')
    const r = buildTableRows({ nodes: withoutA, nodeId: 'root', columns: ['title'] })
    expect(r.rows.map(row => row.title)).toEqual(['场景B'])
  })

  it('空节点集合 → 空表', () => {
    const r = buildTableRows({ nodes: [], nodeId: 'root' })
    expect(r.empty).toBe(true)
  })
})
