import { computed } from 'vue'
import { useEntityStore, useRelationStore } from '@worldsmith/entity-core'
import type { Entity } from '@worldsmith/entity-core'
import { useDuplicateNameCheck } from '@worldsmith/plugin-sdk'
import { type TreeNodeData } from '@worldsmith/ui-kit'

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
    await es.loadByType('outline_node')
    return id
  }

  async function deleteNode(id: string) {
    const children = flatNodes.value.filter(e => (e.properties.parentId as string || '') === id)
    for (const c of children) await deleteNode(c.id)
    await es.remove(id)
    await es.loadByType('outline_node')
  }

  async function moveNode(nodeId: string, newParentId: string, newOrder: number) {
    await es.update(nodeId, {
      properties: {
        parentId: newParentId,
        order: newOrder,
      },
    } as Partial<Entity>)
    await syncParentChildRelation(nodeId, newParentId)
    await es.loadByType('outline_node')
  }

  async function reorderSiblings(_parentId: string, orderedIds: string[]) {
    for (let i = 0; i < orderedIds.length; i++) {
      await es.update(orderedIds[i], {
        properties: { order: i + 1 },
      } as Partial<Entity>)
    }
    await es.loadByType('outline_node')
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
    addRootNode, addChildNode, deleteNode, moveNode, reorderSiblings,
    nodeIcon, statusLabel,
  }
}
