/**
 * useOutlineTree —— 大纲树的读操作 + 少量写操作（Agent 桥与白板右栏共用）
 *
 * 【消费者现状】独立树视图 `OutlineView.vue` 已于 2026-09-16 下线（浏览形态改由白板承载）。
 * 本模块**存活的部分**只有四个：`flatNodes`（读）、`syncParentChildRelation`（BoardView 用）、
 * `deleteNode` / `moveNode`（agentDataBridges 的 Agent 路径用）。
 * 其余（`treeData` / `addRootNode` / `addChildNode` / `nodeIcon` / `statusLabel`）仅供已下线的
 * OutlineView 使用，属施工分解 §十三 C 类「待消化」挂账——按「不允许无记录地删能力」保留。
 *
 * 【两条硬约束（2026-09-17 质量体检发现，均曾造成真实数据丢失）】
 * ① **写 `properties` 前必须合并**：实体更新对 `properties` 是**整体替换**
 *    （`entityStore.update` → `updateById` 只做顶层浅合并，`properties` 整个对象被换掉）。
 *    只提交 `{ parentId, order }` 这类子集会抹掉 status / 摘要 / 关联章节 / content。
 * ② **不得调用 `es.loadByType`**：它内部走 `setAll()`，会把 store 的 `entities`
 *    整体替换为**该类型**的实体，从而挤掉其它所有芽的实体（Agent 删一个节点 → 全库实体
 *    从内存消失，直到下次 `loadAll`）。写操作后 store 已同步维护内存态，本就无需刷新。
 */
import { computed } from 'vue'
import { useEntityStore, useRelationStore } from '@worldsea/entity-core'
import type { Entity } from '@worldsea/entity-core'
import { useDuplicateNameCheck } from '@worldsea/plugin-sdk'
import { type TreeNodeData } from '@worldsea/ui-kit'

export function useOutlineTree() {
  const es = useEntityStore()
  const rs = useRelationStore()
  const { checkAndConfirmName } = useDuplicateNameCheck()

  const flatNodes = computed(() =>
    (es.entities ?? []).filter(e => e.type === 'outline_node')
  )

  function getChildren(parentId: string): TreeNodeData[] {
    return flatNodes.value
      .filter(e => (e.properties.parentId as string || '') === parentId)
      .sort((a, b) => Number(a.properties.order || 0) - Number(b.properties.order || 0))
      .map(e => ({ entity: e, children: getChildren(e.id) }))
  }

  const treeData = computed(() => getChildren(''))

  async function syncParentChildRelation(nodeId: string, parentId: string) {
    const existing = rs.relations.filter(
      r => r.type === 'parent_child' && r.targetId === nodeId
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

  async function addRootNode() {
    const defaultName = '新章节'
    const checkedName = await checkAndConfirmName(defaultName, undefined, 'outline_node')
    if (!checkedName) return
    const now = new Date().toISOString()
    const id = `out-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    await es.add({
      id, type: 'outline_node', name: checkedName,
      description: '',
      properties: {
        status: '未写', order: flatNodes.value.length + 1,
        parentId: '', storylines: '', summary: '',
        manuscriptId: '', content: '',
      },
      tags: [], createdAt: now, updatedAt: now,
    } as Entity)
    await es.loadByType('outline_node')
    return id
  }

  async function addChildNode(parent: Entity) {
    const defaultName = '子节点'
    const checkedName = await checkAndConfirmName(defaultName, undefined, 'outline_node')
    if (!checkedName) return
    const now = new Date().toISOString()
    const children = flatNodes.value.filter(e => (e.properties.parentId as string || '') === parent.id)
    const id = `out-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    await es.add({
      id, type: 'outline_node', name: checkedName,
      description: '',
      properties: {
        status: '未写', order: children.length + 1,
        parentId: parent.id, storylines: '', summary: '',
        manuscriptId: '', content: '',
      },
      tags: [], createdAt: now, updatedAt: now,
    } as Entity)
    await syncParentChildRelation(id, parent.id)
    return id
  }

  async function deleteNode(id: string) {
    const children = flatNodes.value.filter(e => (e.properties.parentId as string || '') === id)
    for (const c of children) await deleteNode(c.id)
    await es.remove(id) // 级联清理关联关系；内存态由 store 同步维护
  }

  async function moveNode(nodeId: string, newParentId: string, newOrder: number) {
    const node = flatNodes.value.find(e => e.id === nodeId)
    if (!node) return
    // 必须合并：只写 { parentId, order } 会抹掉 status / 摘要 / 关联章节 / content（见文件头约束 ①）
    await es.update(nodeId, {
      properties: { ...node.properties, parentId: newParentId, order: newOrder },
    } as Partial<Entity>)
    await syncParentChildRelation(nodeId, newParentId)
  }

  function nodeIcon(e: Entity): string {
    const s = e.properties.status as string
    if (s === '完成') return '✅'
    if (s === '草稿') return '📝'
    return '📋'
  }

  function statusLabel(e: Entity): string {
    return (e.properties.status as string) || '未写'
  }

  return {
    flatNodes, treeData,
    addRootNode, addChildNode, deleteNode, moveNode,
    // Agent bridge（outline create_node/batch_create）建子节点时同步 parent_child 关系；
    // BoardView 的右栏重排同样复用
    syncParentChildRelation,
    nodeIcon, statusLabel,
  }
}
