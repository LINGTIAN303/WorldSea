/**
 * forms/tableRows —— 表格式表现形式的「表格行构建」纯函数
 *
 * 规格：docs/plans/2026-09-16-大纲白板-表现形式规格.md §三
 * 【重要澄清】表的数据源是**实体**（直接子节点），不是白板上的容器——子节点在白板上没有容器
 * 也照常显示；子节点被删则行自动消失（派生型天然免疫，无需清理逻辑）。
 * 【只读】表内不提供编辑（跨层级写入与「容器 : 节点 = 1:1」冲突），columns/rows 仅用于渲染。
 */
import { orderOf, resolveChildNodes, type NodeLike } from '../outlineDerive'

/** 表格式节点需要 name 与 wordCount，故放宽 NodeLike */
export interface TableSourceNode extends NodeLike {
  name?: string
}

export type TableColumnKey = 'title' | 'status' | 'wordCount' | 'order'

export interface TableColumnSpec {
  key: TableColumnKey
  label: string
}

export const TABLE_COLUMN_LABELS: Record<TableColumnKey, string> = {
  title: '标题',
  status: '状态',
  wordCount: '字数',
  order: '序号',
}

/** 首版默认三列（规格 §3.5-2：固定 3 列起步，列选择作为配置项后置） */
export const DEFAULT_TABLE_COLUMNS: TableColumnKey[] = ['title', 'status', 'wordCount']

/** 单元格缺值占位（规格 §3.2-①） */
export const EMPTY_CELL = '—'

/** 把配置里的 columns 归一化：未知项丢弃；空数组回退默认三列 */
export function normalizeColumns(raw: unknown): TableColumnKey[] {
  if (!Array.isArray(raw)) return [...DEFAULT_TABLE_COLUMNS]
  const valid = raw.filter(
    (k): k is TableColumnKey => typeof k === 'string' && k in TABLE_COLUMN_LABELS,
  )
  // 去重并保持声明顺序
  const seen = new Set<TableColumnKey>()
  const out = valid.filter(k => (seen.has(k) ? false : (seen.add(k), true)))
  return out.length ? out : [...DEFAULT_TABLE_COLUMNS]
}

export function columnSpecs(columns: TableColumnKey[]): TableColumnSpec[] {
  return columns.map(key => ({ key, label: TABLE_COLUMN_LABELS[key] }))
}

export function tableNodeName(n: TableSourceNode): string {
  return (n.name ?? '').trim() || '未命名节点'
}

/** 单元格取值：标题/状态有语义兜底，数值型缺值显示占位 */
export function cellValueOf(key: TableColumnKey, node: TableSourceNode): string {
  if (key === 'title') return tableNodeName(node)
  if (key === 'status') return ((node.properties?.status as string) || '未写')
  if (key === 'wordCount') {
    const n = Number(node.properties?.wordCount)
    return Number.isFinite(n) && n > 0 ? String(n) : EMPTY_CELL
  }
  const order = orderOf(node)
  return order > 0 ? String(order) : EMPTY_CELL
}

export interface TableBuildResult {
  columns: TableColumnSpec[]
  rows: Array<Record<string, unknown>>
  /** 无任何数据行（含 includeSelf 的情形）—— 组件据此显示空态 */
  empty: boolean
}

/**
 * 构建表格数据。
 * · 行 = 该节点的**直接子节点**（按 order 升序，不递归）
 * · `includeSelf` 为真时把本节点作为**首行**（规格 §3.2-④）
 * · 节点不存在（悬空容器）时返回空表，不抛错
 */
export function buildTableRows(opts: {
  nodes: TableSourceNode[]
  nodeId: string
  columns?: unknown
  includeSelf?: boolean
}): TableBuildResult {
  const columns = normalizeColumns(opts.columns)
  const specs = columnSpecs(columns)
  const self = opts.nodes.find(n => n.id === opts.nodeId)
  const children = self ? resolveChildNodes(opts.nodeId, opts.nodes) : []

  const source: TableSourceNode[] = []
  if (self && opts.includeSelf) source.push(self)
  source.push(...children)

  const rows = source.map(node => {
    const row: Record<string, unknown> = {}
    for (const key of columns) row[key] = cellValueOf(key, node)
    return row
  })

  return { columns: specs, rows, empty: rows.length === 0 }
}
