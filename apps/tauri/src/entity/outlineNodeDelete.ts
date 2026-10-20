/**
 * 大纲节点删除（2026-10-19）—— 「删除」与「移除容器」语义分离后的唯一实现。
 *
 * 【语义】
 * - **移除**（容器 ✕ / 编辑面板）：只删白板容器，节点留在右栏「未入板」——不归本模块。
 * - **删除**（Delete 键 / 右键菜单 / 右栏右键）：删节点实体 + 其容器 + 所有关系 + 章节解绑。
 *
 * 【有子节点时的四选项（用户 2026-10-19 拍板）】
 * - `cascade`：连同整棵子树一起删（对话框须列出总数）
 * - `promote`：子节点提升为根（`parentId = ''`）
 * - `reparent`：子节点转移到用户指定的另一个节点
 * - 取消：由调用方处理（不进本模块）
 *
 * 【顺序纪律】必须**先清关系与章节绑定，再删实体**——反过来会留下悬空关系与半解绑的章节。
 */
import type { Entity, Relation } from '@worldsea/entity-core'

export type ChildStrategy = 'cascade' | 'promote' | 'reparent'

/** 本模块对 store 的最小依赖（便于测试注入替身） */
export interface OutlineNodeDeleteApi {
  entities(): readonly Entity[]
  relations(): readonly Relation[]
  removeEntity(id: string): Promise<void>
  removeRelation(id: string): Promise<void>
  /** 章节侧解绑（`chapterLink.unlinkNode`） */
  unlinkChapter(nodeId: string): Promise<unknown>
  /** 更新节点字段（提升为根 / 转移到其它节点时用） */
  updateNode(id: string, properties: Record<string, unknown>): Promise<unknown>
}

function parentIdOf(n: Entity): string {
  return String((n.properties?.parentId as string) || '')
}

/** 直接子节点（只算 `outline_node`） */
export function childrenOf(nodes: readonly Entity[], nodeId: string): Entity[] {
  return nodes.filter(n => n.type === 'outline_node' && parentIdOf(n) === nodeId)
}

/** 子树 id（含自身，深度优先；防环：visited 集合） */
export function collectSubtreeIds(nodes: readonly Entity[], rootId: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const walk = (id: string): void => {
    if (!id || seen.has(id)) return
    seen.add(id)
    out.push(id)
    for (const c of childrenOf(nodes, id)) walk(c.id)
  }
  walk(rootId)
  return out
}

/**
 * 删除一批节点：清关系（两端命中）→ 章节解绑 → 删实体。
 * 返回实际处理的节点数。
 */
export async function deleteOutlineNodes(
  api: OutlineNodeDeleteApi,
  nodeIds: readonly string[],
): Promise<number> {
  const ids = new Set(nodeIds.filter(Boolean))
  if (!ids.size) return 0

  // 1) 关系：以任一被删节点为 source 或 target 的边全部清掉（跨芽 + 横向 + parent_child）
  for (const r of [...api.relations()]) {
    if (ids.has(r.sourceId) || ids.has(r.targetId)) await api.removeRelation(r.id)
  }

  // 2) 章节：删节点时同时解除 outline_chapter 关系对（章节实体保留）
  for (const id of ids) await api.unlinkChapter(id)

  // 3) 实体
  for (const id of ids) await api.removeEntity(id)
  return ids.size
}

/**
 * 把 `childIds` 挂到 `targetParentId` 下（`'`''` = 提升为根）。
 * `order` 取目标父级现有子节点数往后排，避免与既有子节点撞序。
 */
export async function reparentNodes(
  api: OutlineNodeDeleteApi,
  childIds: readonly string[],
  targetParentId: string,
): Promise<void> {
  if (!childIds.length) return
  let order = childrenOf(api.entities(), targetParentId).length
  for (const id of childIds) {
    order += 1
    await api.updateNode(id, { parentId: targetParentId, order })
  }
}

/**
 * 删除节点（按策略处理子节点）。
 * - `cascade`：整棵子树（含自身）删除，返回删除数
 * - `promote` / `reparent`：先安顿直接子节点，再只删自身
 */
export async function deleteOutlineNodeWithStrategy(
  api: OutlineNodeDeleteApi,
  nodeId: string,
  strategy: ChildStrategy,
  reparentTargetId = '',
): Promise<number> {
  const nodes = api.entities()
  const kids = childrenOf(nodes, nodeId).map(n => n.id)

  if (strategy === 'cascade') {
    return deleteOutlineNodes(api, collectSubtreeIds(nodes, nodeId))
  }

  if (kids.length) {
    if (strategy === 'reparent') {
      if (!reparentTargetId || reparentTargetId === nodeId) {
        throw new Error('deleteOutlineNodeWithStrategy: 转移到其它节点时必须指定合法目标')
      }
      await reparentNodes(api, kids, reparentTargetId)
    } else {
      await reparentNodes(api, kids, '')
    }
  }
  return deleteOutlineNodes(api, [nodeId])
}
