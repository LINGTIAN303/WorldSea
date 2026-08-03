import { useEntityStore } from '@worldsmith/entity-core'
import type { Entity } from '@worldsmith/entity-core'
import type { TreeNodeData } from '@worldsmith/ui-kit'

export function useOutlineDrag() {
  const es = useEntityStore()

  function findNodeInTree(nodes: TreeNodeData[], id: string): TreeNodeData | null {
    for (const n of nodes) {
      if (n.entity.id === id) return n
      const found = findNodeInTree(n.children, id)
      if (found) return found
    }
    return null
  }

  function isDescendant(nodes: TreeNodeData[], ancestorId: string, targetId: string): boolean {
    const ancestor = findNodeInTree(nodes, ancestorId)
    if (!ancestor) return false
    return !!findNodeInTree(ancestor.children, targetId)
  }

  async function handleMoveNode(
    draggedId: string,
    targetId: string,
    treeData: TreeNodeData[],
    flatNodes: Entity[],
  ) {
    if (draggedId === targetId) return
    if (isDescendant(treeData, draggedId, targetId)) return

    const targetNode = flatNodes.find(e => e.id === targetId)
    if (!targetNode) return

    const targetParentId = (targetNode.properties.parentId as string) || ''
    const siblings = flatNodes.filter(
      e => (e.properties.parentId as string) === targetParentId && e.id !== draggedId
    )
    const targetOrder = Number(targetNode.properties.order || 0)

    await es.update(draggedId, {
      properties: {
        parentId: targetParentId,
        order: targetOrder,
      },
    } as Partial<Entity>)

    const afterTarget = siblings.filter(
      e => Number(e.properties.order || 0) >= targetOrder && e.id !== targetId
    )
    for (let i = 0; i < afterTarget.length; i++) {
      await es.update(afterTarget[i].id, {
        properties: { order: targetOrder + i + 2 },
      } as Partial<Entity>)
    }

    await es.loadByType('outline_node')
  }

  async function handleDropOnNode(
    draggedId: string,
    targetParentId: string,
    treeData: TreeNodeData[],
    flatNodes: Entity[],
  ) {
    if (draggedId === targetParentId) return
    if (isDescendant(treeData, draggedId, targetParentId)) return

    const children = flatNodes.filter(
      e => (e.properties.parentId as string) === targetParentId
    )
    const newOrder = children.length + 1

    await es.update(draggedId, {
      properties: {
        parentId: targetParentId,
        order: newOrder,
      },
    } as Partial<Entity>)

    await es.loadByType('outline_node')
  }

  return {
    handleMoveNode,
    handleDropOnNode,
    isDescendant,
  }
}
