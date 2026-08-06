import { computed, ref, watch, onUnmounted } from 'vue'
import { useEntityStore, useRelationStore } from '@worldsmith/entity-core'
import { deduplicateEdges } from '@worldsmith/entity-core/composables'
import { relationSchemaRegistry, entitySchemaRegistry } from '@worldsmith/entity-core'
import { getNodeTypeInfo, getEdgeTypeInfo } from '@worldsmith/entity-core'
import type { Relation } from '@worldsmith/entity-core'

export interface GraphNode {
  id: string
  name: string
  type: string
  label: string
  icon: string
  shape: string
  coolColor: string
  warmColor: string
  tags: string[]
  description: string
  degree: number
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  relType: string
  relLabel: string
  bidirectional: boolean
  symmetric: boolean
  relationIds: string[]
  coolColor: string
  warmColor: string
  dashed: boolean
  noArrow: boolean
  curveStyle: 'bezier' | 'straight' | 'taxi'
}

/** 图谱节点数阈值：超过此数只渲染 top-N 高 degree 节点 */
export const GRAPH_NODE_THRESHOLD = 500

/** 防抖阈值：实体+关系总数超过此数时启用 200ms 防抖 */
const DEBOUNCE_THRESHOLD = 500

export function useGraphData(opts?: { threshold?: number }) {
  const entityStore = useEntityStore()
  const relationStore = useRelationStore()
  const threshold = opts?.threshold ?? GRAPH_NODE_THRESHOLD

  /** degree 映射：独立 computed，避免每次 entity 变化重建 */
  const degreeMap = computed<Map<string, number>>(() => {
    const m = new Map<string, number>()
    for (const r of relationStore.relations) {
      m.set(r.sourceId, (m.get(r.sourceId) || 0) + 1)
      m.set(r.targetId, (m.get(r.targetId) || 0) + 1)
    }
    return m
  })

  /** 节点类型缓存：避免 repeated getNodeTypeInfo 查询 */
  const nodeInfoMap = computed<Map<string, ReturnType<typeof getNodeTypeInfo>>>(() => {
    const m = new Map()
    for (const schema of entitySchemaRegistry.getAll()) {
      const info = getNodeTypeInfo(schema.typeKey)
      if (info) m.set(schema.typeKey, info)
    }
    return m
  })

  /** 大图谱防抖：总元素 > DEBOUNCE_THRESHOLD 时 200ms 延迟更新 */
  const debouncedEntities = ref(entityStore.entities)
  const debouncedRelations = ref(relationStore.relations)

  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  watch(
    () => [entityStore.entities, relationStore.relations] as const,
    () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      const total = entityStore.entities.length + relationStore.relations.length
      if (total < DEBOUNCE_THRESHOLD) {
        debouncedEntities.value = entityStore.entities
        debouncedRelations.value = relationStore.relations
      } else {
        debounceTimer = setTimeout(() => {
          debouncedEntities.value = entityStore.entities
          debouncedRelations.value = relationStore.relations
          debounceTimer = null
        }, 200)
      }
    },
    { deep: false },
  )

  onUnmounted(() => { if (debounceTimer) clearTimeout(debounceTimer) })

  const nodes = computed<GraphNode[]>(() => {
    return debouncedEntities.value.map(e => {
      const info = nodeInfoMap.value.get(e.type) ?? getNodeTypeInfo(e.type)
      return {
        id: e.id,
        name: e.name,
        type: e.type,
        label: info.label,
        icon: info.icon,
        shape: info.shape,
        coolColor: info.coolColor,
        warmColor: info.warmColor,
        tags: e.tags || [],
        description: e.description || '',
        degree: degreeMap.value.get(e.id) || 0,
      }
    })
  })

  const edges = computed<GraphEdge[]>(() => {
    const merged = deduplicateEdges(
      debouncedRelations.value,
      (type) => relationSchemaRegistry.get(type)?.label || type
    )
    return merged.map(me => {
      const info = getEdgeTypeInfo(me.relType)
      return {
        id: me.id,
        source: me.source,
        target: me.target,
        relType: me.relType,
        relLabel: me.relLabel,
        bidirectional: me.bidirectional,
        symmetric: me.symmetric,
        relationIds: me.relationIds,
        coolColor: info.coolColor,
        warmColor: info.warmColor,
        dashed: info.dashed,
        noArrow: info.noArrow,
        curveStyle: info.curveStyle,
      }
    })
  })

  /** 邻接表：基于已加载 relations，O(1) 查询某实体的所有关联关系 */
  const adjacency = computed(() => {
    const map = new Map<string, Relation[]>()
    for (const r of debouncedRelations.value) {
      if (!map.has(r.sourceId)) map.set(r.sourceId, [])
      if (!map.has(r.targetId)) map.set(r.targetId, [])
      map.get(r.sourceId)!.push(r)
      map.get(r.targetId)!.push(r)
    }
    return map
  })

  function getConnected(entityId: string): Relation[] {
    return adjacency.value.get(entityId) ?? []
  }

  /** 是否超过阈值 */
  const isOverThreshold = computed(() => nodes.value.length > threshold)

  /** 截断后节点：按 degree 降序取前 threshold 个，中小图谱返回全量 */
  const truncatedNodes = computed<GraphNode[]>(() => {
    if (!isOverThreshold.value) return nodes.value
    return [...nodes.value].sort((a, b) => b.degree - a.degree).slice(0, threshold)
  })

  const nodeCount = computed(() => nodes.value.length)
  const edgeCount = computed(() => edges.value.length)

  const nodeMap = computed(() => {
    const m = new Map<string, GraphNode>()
    for (const n of nodes.value) m.set(n.id, n)
    return m
  })

  const edgeMap = computed(() => {
    const m = new Map<string, GraphEdge>()
    for (const e of edges.value) m.set(e.id, e)
    return m
  })

  function getNode(id: string): GraphNode | undefined {
    return nodeMap.value.get(id)
  }

  function getEdge(id: string): GraphEdge | undefined {
    return edgeMap.value.get(id)
  }

  return {
    nodes,
    edges,
    truncatedNodes,
    isOverThreshold,
    adjacency,
    getConnected,
    nodeCount,
    edgeCount,
    nodeMap,
    edgeMap,
    getNode,
    getEdge,
  }
}
