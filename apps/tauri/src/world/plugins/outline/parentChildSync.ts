/**
 * 层级双写的 relation 同步（`parent_child`）。
 *
 * 2026-10-18：从 `composables/useOutlineTree.ts` 抽出独立模块——该 composable 的其余导出
 * （`treeData` / `addRootNode` / `addChildNode` / `statusLabel` / `getChildren`）只服务
 * 2026-09-16 已下线的独立树视图（`OutlineView.vue`），外部引用为零，已随本次清理删除。
 *
 * 读侧真相源是 `properties.parentId + order`；本函数只负责把同一事实同步到关系表
 * （关系表供图谱/导出一类消费方使用），**不参与层级计算**。
 */
import { relationsSvc } from './serviceAccess'

/** 同步「父 → 子」关系：先清该节点既有的 parent_child 入边，再按需重建（parentId 为空则只清不建） */
export async function syncParentChildRelation(nodeId: string, parentId: string): Promise<void> {
  const rs = relationsSvc()
  const existing = rs.list().filter(
    r => r.type === 'parent_child' && r.targetId === nodeId,
  )
  for (const rel of existing) {
    await rs.remove(rel.id)
  }
  if (parentId) {
    const now = new Date().toISOString()
    await rs.add({
      id: `rel-pc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'parent_child',
      sourceId: parentId,
      targetId: nodeId,
      properties: {},
      createdAt: now,
      updatedAt: now,
    })
  }
}
