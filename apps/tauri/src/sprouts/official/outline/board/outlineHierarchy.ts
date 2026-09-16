/**
 * outlineHierarchy —— 大纲层级调整的计算（纯函数）
 *
 * 右栏拖拽重排的「算账」部分：给定「谁拖到谁身上、落点语义」，算出**需要写库的完整更新集**
 * （含被拖节点的新 parentId 与新序、以及受影响的同胞 order 归一化）。
 * 抽成纯函数是为了可单测——写库只是循环执行结果。
 *
 * 规格背景：原独立树视图下线后，「拖拽调整层级与顺序」的能力迁到白板右栏树
 * （负责人 09-16 裁定方案 C）。
 */
import { collectDescendantIds, parentIdOf, resolveChildNodes, type NodeLike } from './outlineDerive'

/** 落点语义：目标行上 1/4 = 插到其前，下 1/4 = 插到其后，中间 = 成为其子节点 */
export type DropMode = 'before' | 'child' | 'after'

export interface HierarchyUpdate {
  id: string
  parentId: string
  order: number
}

/** 按指针在目标行内的纵向比例判定落点语义（0 = 顶部，1 = 底部） */
export function dropModeFromRatio(ratio: number): DropMode {
  if (!Number.isFinite(ratio)) return 'child'
  if (ratio < 0.25) return 'before'
  if (ratio > 0.75) return 'after'
  return 'child'
}

/** target 是否是 ancestor 的后代（含自身）——用于防止把节点挂到自己的子树下成环 */
export function isDescendantOrSelf(nodes: NodeLike[], ancestorId: string, targetId: string): boolean {
  if (ancestorId === targetId) return true
  return collectDescendantIds(ancestorId, nodes).includes(targetId)
}

function orderOfNode(n: NodeLike): number {
  const v = Number(n.properties?.order)
  return Number.isFinite(v) ? v : 0
}

/**
 * 计算重排更新集。
 * 返回 null 表示这是非法/无意义操作（自身、缺失节点、会成环），调用方应静默忽略。
 */
export function planReparent(
  nodes: NodeLike[],
  draggedId: string,
  targetId: string,
  mode: DropMode,
): HierarchyUpdate[] | null {
  if (!draggedId || !targetId || draggedId === targetId) return null
  const dragged = nodes.find(n => n.id === draggedId)
  const target = nodes.find(n => n.id === targetId)
  if (!dragged || !target) return null
  // 防环：不能把节点挂到自己的后代下（含自身）
  if (isDescendantOrSelf(nodes, draggedId, targetId)) return null

  const oldParentId = parentIdOf(dragged)
  const newParentId = mode === 'child' ? targetId : parentIdOf(target)

  // 新父下现有子节点（排除被拖者），保持相对顺序
  const siblings = resolveChildNodes(newParentId, nodes).filter(n => n.id !== draggedId)
  let insertIndex = siblings.length
  if (mode === 'before' || mode === 'after') {
    const idx = siblings.findIndex(n => n.id === targetId)
    insertIndex = idx < 0 ? siblings.length : mode === 'before' ? idx : idx + 1
  }
  const sequence: NodeLike[] = [...siblings]
  sequence.splice(insertIndex, 0, dragged)

  const updates: HierarchyUpdate[] = []
  const seen = new Set<string>()

  sequence.forEach((n, i) => {
    const order = i + 1
    const parentId = n.id === draggedId ? newParentId : parentIdOf(n)
    // 只收「真有变化」的节点：无变化的场景（如拖到现父下且序号不变）应返回 null，
    // 避免制造一次无意义的写库与撤销记录
    const changed = parentIdOf(n) !== parentId || orderOfNode(n) !== order
    if (changed) {
      updates.push({ id: n.id, parentId, order })
      seen.add(n.id)
    }
  })

  // 换了父时，旧父下的同胞也要归一化（否则 order 留空洞）
  if (oldParentId !== newParentId) {
    const olds = resolveChildNodes(oldParentId, nodes).filter(n => n.id !== draggedId)
    olds.forEach((n, i) => {
      const order = i + 1
      if (seen.has(n.id)) return
      if (orderOfNode(n) !== order) updates.push({ id: n.id, parentId: oldParentId, order })
    })
  }

  return updates.length ? updates : null
}

/**
 * 采集层级快照（撤销用）：只记 id → { parentId, order }，体积小、可整体回放。
 */
export function captureHierarchy(nodes: NodeLike[]): Record<string, { parentId: string; order: number }> {
  const out: Record<string, { parentId: string; order: number }> = {}
  for (const n of nodes) {
    out[n.id] = { parentId: parentIdOf(n), order: orderOfNode(n) }
  }
  return out
}

/**
 * 比对当前层级与快照，返回需要恢复的更新集（只含差异项；无差异返回空数组）。
 */
export function diffHierarchy(
  nodes: NodeLike[],
  snapshot: Record<string, { parentId: string; order: number }>,
): HierarchyUpdate[] {
  const updates: HierarchyUpdate[] = []
  for (const n of nodes) {
    const want = snapshot[n.id]
    if (!want) continue // 快照之后新建的节点不参与回滚
    if (parentIdOf(n) !== want.parentId || orderOfNode(n) !== want.order) {
      updates.push({ id: n.id, parentId: want.parentId, order: want.order })
    }
  }
  return updates
}
