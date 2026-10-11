/**
 * outlineDerive —— 大纲节点的派生计算（纯函数）
 *
 * 【为什么需要】树视图靠「递归渲染」隐式携带层级，白板需要「显式」的深度与序号
 * （标题式要显示缩进与编号）。抽为纯函数后可被白板、导出、Agent 复用，且可单测。
 * 详见 docs/plans/2026-09-16-大纲白板-施工分解.md §二。
 *
 * 【防御】父链断裂（父节点不存在）→ 视为根；数据成环 → 以 MAX_DEPTH 截断，绝不无限递归。
 */
import type { Entity } from '@worldsea/entity-core'

/** 深度上限：防止数据成环时无限递归（正常大纲远达不到该层数） */
export const MAX_DEPTH = 64

/** 派生计算只依赖 id 与 properties，故放宽入参类型便于测试与复用 */
export type NodeLike = Pick<Entity, 'id' | 'properties'>

export function parentIdOf(node: NodeLike | undefined): string {
  return (node?.properties?.parentId as string) || ''
}

export function orderOf(node: NodeLike | undefined): number {
  const n = Number(node?.properties?.order)
  return Number.isFinite(n) ? n : 0
}

/**
 * 取直接子节点，按 order 升序；order 相同用 id 兜底保证顺序稳定（避免视图抖动）。
 * 泛型化以保持入参的具体类型（调用方常传 Entity[]，返回也应是 Entity[]）。
 */
export function resolveChildNodes<T extends NodeLike>(parentId: string, nodes: T[]): T[] {
  return nodes
    .filter(n => parentIdOf(n) === parentId)
    .sort((a, b) => orderOf(a) - orderOf(b) || String(a.id).localeCompare(String(b.id)))
}

/**
 * 层级深度：根节点 = 0；父链断裂或成环时停在当前层（返回已累计深度）。
 */
export function resolveNodeDepth(nodeId: string, nodes: NodeLike[]): number {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const seen = new Set<string>([nodeId])
  let depth = 0
  let cur = byId.get(nodeId)
  while (cur) {
    const pid = parentIdOf(cur)
    if (!pid) return depth
    const parent = byId.get(pid)
    if (!parent || seen.has(pid)) return depth
    seen.add(pid)
    depth += 1
    if (depth >= MAX_DEPTH) return depth
    cur = parent
  }
  return depth
}

/**
 * 同级序号（1 基）：按父节点下的 order 排序后的下标；找不到该节点返回 0。
 */
export function resolveSiblingIndex(nodeId: string, nodes: NodeLike[]): number {
  const self = nodes.find(n => n.id === nodeId)
  if (!self) return 0
  const siblings = resolveChildNodes(parentIdOf(self), nodes)
  const idx = siblings.findIndex(n => n.id === nodeId)
  return idx < 0 ? 0 : idx + 1
}

/**
 * 层级编号链：自根到自身每一层的同级序号，如 [1, 2, 3] → 显示为 1.2.3。
 * 根节点若本身是第 n 个子节点也会体现在链首。
 */
export function resolveNodeNumbering(nodeId: string, nodes: NodeLike[]): number[] {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const chain: number[] = []
  const seen = new Set<string>([nodeId])
  let cur = byId.get(nodeId)
  let guard = 0
  while (cur && guard < MAX_DEPTH) {
    guard += 1
    const idx = resolveSiblingIndex(cur.id, nodes)
    if (idx > 0) chain.unshift(idx)
    const pid = parentIdOf(cur)
    if (!pid || seen.has(pid)) break
    seen.add(pid)
    cur = byId.get(pid)
  }
  return chain
}

/**
 * 收集某节点的全部后代 id（不含自身），用于「批量移动/删除」与自环防御。
 */
export function collectDescendantIds(nodeId: string, nodes: NodeLike[]): string[] {
  const out: string[] = []
  const stack = [nodeId]
  const seen = new Set<string>([nodeId])
  while (stack.length) {
    const cur = stack.pop() as string
    for (const child of resolveChildNodes(cur, nodes)) {
      if (seen.has(child.id)) continue
      seen.add(child.id)
      out.push(child.id)
      stack.push(child.id)
    }
  }
  return out
}
