import { ref, computed } from 'vue'
import type { GraphNode, GraphEdge } from './useGraphData'

export interface FilterCriteria {
  entityTypes?: string[]
  relationTypes?: string[]
  tags?: string[]
  timeRange?: { start: number; end: number }
}

export function useGraphFilter(
  nodes: () => GraphNode[],
  edges: () => GraphEdge[]
) {
  const criteria = ref<FilterCriteria>({})

  let timer: ReturnType<typeof setTimeout> | null = null
  const pendingCriteria = ref<FilterCriteria>({})

  function setFilter(newCriteria: FilterCriteria): void {
    pendingCriteria.value = newCriteria
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      criteria.value = { ...newCriteria }
      timer = null
    }, 100)
  }

  function clearFilters(): void {
    if (timer) clearTimeout(timer)
    criteria.value = {}
    pendingCriteria.value = {}
  }

  const filteredNodes = computed<GraphNode[]>(() => {
    const c = criteria.value
    const source = nodes()
    if (!c.entityTypes?.length && !c.tags?.length) return source
    return source.filter(n => {
      if (c.entityTypes?.length && !c.entityTypes.includes(n.type)) return false
      if (c.tags?.length && !c.tags.some(t => n.tags.includes(t))) return false
      return true
    })
  })

  const filteredEdges = computed<GraphEdge[]>(() => {
    const c = criteria.value
    const source = edges()
    const visibleIds = new Set(filteredNodes.value.map(n => n.id))
    return source.filter(e => {
      if (!visibleIds.has(e.source) || !visibleIds.has(e.target)) return false
      if (c.relationTypes?.length && !c.relationTypes.includes(e.relType)) return false
      return true
    })
  })

  const activeFilters = computed<FilterCriteria>(() => criteria.value)

  const hasActiveFilters = computed(() => {
    const c = criteria.value
    return !!(c.entityTypes?.length || c.relationTypes?.length || c.tags?.length || c.timeRange)
  })

  return {
    setFilter,
    clearFilters,
    filteredNodes,
    filteredEdges,
    activeFilters,
    hasActiveFilters,
  }
}
