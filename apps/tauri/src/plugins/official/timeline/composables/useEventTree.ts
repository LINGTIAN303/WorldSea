import { computed, ref, type ComputedRef } from 'vue'
import type { Entity } from '@worldsmith/entity-core'

export interface TreeNode {
  entity: Entity
  depth: number
  children: TreeNode[]
}

export interface TreeResult {
  roots: TreeNode[]
  depthMap: Map<string, number>
  flatOrder: Entity[]
}

export function useEventTree(events: ComputedRef<Entity[]>) {
  const collapsedSet = ref<Set<string>>(new Set())

  const treeResult = computed<TreeResult>(() => {
    const eventList = events.value
    const childrenMap = new Map<string, Entity[]>()
    const roots: Entity[] = []
    const eventIds = new Set(eventList.map(e => e.id))
    const nameToId = new Map<string, string>()
    for (const e of eventList) {
      if (e.name) nameToId.set(e.name, e.id)
    }

    function resolveParentId(raw: string): string | null {
      if (!raw) return null
      if (eventIds.has(raw)) return raw
      const byName = nameToId.get(raw)
      if (byName) return byName
      return null
    }

    for (const e of eventList) {
      const rawParentId = (e.properties.parentId as string) || ''
      const resolved = resolveParentId(rawParentId)
      if (resolved) {
        if (!childrenMap.has(resolved)) childrenMap.set(resolved, [])
        childrenMap.get(resolved)!.push(e)
      } else {
        roots.push(e)
      }
    }

    const depthMap = new Map<string, number>()
    const flatOrder: Entity[] = []

    function dfs(list: Entity[], depth: number, visited: Set<string>): TreeNode[] {
      const nodes: TreeNode[] = []
      for (const e of list) {
        if (visited.has(e.id)) continue
        visited.add(e.id)
        depthMap.set(e.id, depth)
        flatOrder.push(e)
        const kids = childrenMap.get(e.id) || []
        const childNodes = dfs(kids, depth + 1, visited)
        nodes.push({ entity: e, depth, children: childNodes })
      }
      return nodes
    }

    const rootNodes = dfs(roots, 0, new Set())

    return { roots: rootNodes, depthMap, flatOrder }
  })

  const depthMap = computed(() => treeResult.value.depthMap)
  const flatOrder = computed(() => treeResult.value.flatOrder)
  const roots = computed(() => treeResult.value.roots)

  const childrenMap = computed(() => {
    const map = new Map<string, Entity[]>()
    for (const node of roots.value) {
      collectChildren(node, map)
    }
    return map
  })

  function collectChildren(node: TreeNode, map: Map<string, Entity[]>) {
    if (node.children.length > 0) {
      map.set(node.entity.id, node.children.map(c => c.entity))
      for (const child of node.children) {
        collectChildren(child, map)
      }
    }
  }

  const visibleFlatOrder = computed(() => {
    const collapsed = collapsedSet.value
    if (collapsed.size === 0) return flatOrder.value

    const hiddenIds = new Set<string>()
    function markHidden(parentId: string) {
      const kids = childrenMap.value.get(parentId)
      if (!kids) return
      for (const kid of kids) {
        hiddenIds.add(kid.id)
        if (collapsed.has(kid.id)) markHidden(kid.id)
      }
    }
    for (const id of collapsed) markHidden(id)

    return flatOrder.value.filter(e => !hiddenIds.has(e.id))
  })

  function getDepth(id: string): number {
    return depthMap.value.get(id) ?? 0
  }

  function toggleCollapse(id: string) {
    const newSet = new Set(collapsedSet.value)
    if (newSet.has(id)) newSet.delete(id)
    else newSet.add(id)
    collapsedSet.value = newSet
  }

  function expandAll() {
    collapsedSet.value = new Set()
  }

  function collapseAll() {
    const newSet = new Set<string>()
    for (const [id, kids] of childrenMap.value) {
      if (kids.length > 0) newSet.add(id)
    }
    collapsedSet.value = newSet
  }

  function expandTo(id: string) {
    const newSet = new Set(collapsedSet.value)
    const idSet = new Set(flatOrder.value.map(e => e.id))
    const nameMap = new Map<string, string>()
    for (const e of flatOrder.value) {
      if (e.name) nameMap.set(e.name, e.id)
    }
    let current = id
    while (current) {
      newSet.delete(current)
      let rawParentId = ''
      for (const e of flatOrder.value) {
        if (e.id === current) {
          rawParentId = (e.properties.parentId as string) || ''
          break
        }
      }
      if (!rawParentId) break
      if (idSet.has(rawParentId)) {
        current = rawParentId
      } else {
        const resolved = nameMap.get(rawParentId)
        current = resolved ?? ''
      }
    }
    collapsedSet.value = newSet
  }

  function getChildCount(id: string): number {
    return childrenMap.value.get(id)?.length ?? 0
  }

  return {
    treeResult,
    depthMap,
    flatOrder,
    visibleFlatOrder,
    roots,
    childrenMap,
    collapsedSet,
    getDepth,
    toggleCollapse,
    expandAll,
    collapseAll,
    expandTo,
    getChildCount,
  }
}
