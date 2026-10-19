/**
 * forms/treeRows —— 树式表现形式的「行构建」纯函数
 *
 * 规格：docs/plans/2026-09-16-大纲白板-表现形式规格.md（树式待补该节）
 * 背景：原独立「大纲树视图」下线后，其**浏览形态**由本形式承载（负责人 09-16 裁定方案 C）。
 * 抽为纯函数是为了可单测：展开/折叠、层级、编号、状态全部由纯函数算出，组件只渲染。
 */
import { resolveChildNodes, type NodeLike } from '../outlineDerive'

/** 树式节点需要读到 name（NodeLike 只约束 id/properties），故放宽一层 */
export interface TreeSourceNode extends NodeLike {
  name?: string
}

export type TreeScope = 'all' | 'this'

export interface TreeRow {
  id: string
  name: string
  depth: number
  hasChildren: boolean
  expanded: boolean
  status: string
}

export function treeNodeName(n: TreeSourceNode): string {
  return (n.name ?? '').trim() || '未命名节点'
}

export function treeNodeStatus(n: TreeSourceNode): string {
  return ((n.properties?.status as string) || '未写')
}

/**
 * 默认展开集合：前 `depth` 层（depth=1 表示展开根节点的下一层）。
 * 空树或 depth<=0 时返回空集合。
 *
 * 2026-10-19（信息密度增强）：新增 `'all'`（Infinity）用法，故加 `seen` 防环——
 * 此前 depth 有限，成环数据最多多走几层；Infinity 下若无守卫会无限递归。
 */
export function defaultExpandedIds(
  nodes: TreeSourceNode[],
  scope: TreeScope,
  rootId: string | undefined,
  depth: number,
): Set<string> {
  const out = new Set<string>()
  if (depth <= 0) return out
  const seen = new Set<string>()
  const walk = (parentId: string, level: number): void => {
    if (level > depth) return
    for (const n of resolveChildNodes(parentId, nodes)) {
      if (seen.has(n.id)) continue
      seen.add(n.id)
      const children = resolveChildNodes(n.id, nodes)
      if (!children.length) continue
      out.add(n.id)
      walk(n.id, level + 1)
    }
  }
  if (scope === 'this' && rootId) walk(rootId, 1)
  else walk('', 1)
  return out
}

/**
 * 展开层数归一化（2026-10-19 信息密度增强）：
 * - `'all'` → Infinity（全部展开）
 * - 数字 / 数字字符串 → 0–6 的整数
 * - 非法值 → 2（改动前的硬编码值，保证旧配置观感不变）
 */
export function normalizeExpandDepth(raw: unknown): number {
  if (raw === 'all') return Number.POSITIVE_INFINITY
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return 2
  return Math.min(6, Math.floor(n))
}

/**
 * 构建可见行（深度优先，仅展开的节点下探）。
 * - scope='all'：全部根节点
 * - scope='this'：以 rootId 为根的子树（rootId 本身不作为行，行从它的子节点开始）
 */
export function buildTreeRows(opts: {
  nodes: TreeSourceNode[]
  scope: TreeScope
  rootId?: string
  expanded: ReadonlySet<string>
}): TreeRow[] {
  const { nodes, scope, rootId, expanded } = opts
  const rows: TreeRow[] = []
  /** 防环：`parentId` 成环时（脏数据）不能让渲染无限递归 */
  const seen = new Set<string>()

  const visit = (parentId: string, depth: number): void => {
    for (const n of resolveChildNodes(parentId, nodes)) {
      if (seen.has(n.id)) continue
      seen.add(n.id)
      const children = resolveChildNodes(n.id, nodes)
      const isOpen = expanded.has(n.id)
      rows.push({
        id: n.id,
        name: treeNodeName(n),
        depth,
        hasChildren: children.length > 0,
        expanded: isOpen,
        status: treeNodeStatus(n),
      })
      if (isOpen) visit(n.id, depth + 1)
    }
  }

  if (scope === 'this' && rootId) visit(rootId, 0)
  else visit('', 0)
  return rows
}

/** 树式组件的行高估算（用于容器内容自适应高度的粗略参考） */
export const TREE_ROW_HEIGHT = 22

export function estimateTreeHeight(rowCount: number, maxRows = 10): number {
  return Math.min(Math.max(rowCount, 1), maxRows) * TREE_ROW_HEIGHT + 8
}
