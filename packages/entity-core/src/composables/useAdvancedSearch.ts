import { ref } from 'vue'
import type { Entity } from '../types/entity'
import { storage, type EntitySearchFilter } from '../core/StorageBackend'
import { useRelationStore } from '../stores/relationStore'

export interface SearchFilter {
  query?: string
  type?: string
  tags?: string[]
  propertyFilters?: Array<{ field: string; operator: 'eq' | 'neq' | 'contains' | 'gt' | 'lt'; value: string }>
  createdAfter?: string
  createdBefore?: string
  updatedAfter?: string
  updatedBefore?: string
  relationFilter?: { entityId: string; relationType?: string; direction: 'outgoing' | 'incoming' | 'both'; maxDepth?: number }
}

export function useAdvancedSearch() {
  const loading = ref(false)
  const results = ref<Entity[]>([])
  const savedFilters = ref<Array<{ name: string; filter: SearchFilter }>>([])

  function loadSavedFilters() {
    try {
      const raw = localStorage.getItem('ws_saved_search_filters')
      if (raw) savedFilters.value = JSON.parse(raw)
    } catch { /* ignore */ }
  }

  function saveFilter(name: string, filter: SearchFilter) {
    savedFilters.value.push({ name, filter })
    localStorage.setItem('ws_saved_search_filters', JSON.stringify(savedFilters.value))
  }

  function deleteSavedFilter(name: string) {
    savedFilters.value = savedFilters.value.filter(f => f.name !== name)
    localStorage.setItem('ws_saved_search_filters', JSON.stringify(savedFilters.value))
  }

  async function search(filter: SearchFilter): Promise<Entity[]> {
    loading.value = true
    try {
      // 可下推条件（type / updatedAt 范围）交给 DB 索引过滤，减少 JS 层处理量
      const dbFilter: EntitySearchFilter = {
        type: filter.type,
        updatedAfter: filter.updatedAfter,
        updatedBefore: filter.updatedBefore,
      }
      let items = await storage.searchEntities(dbFilter)

      if (filter.query) {
        const q = filter.query.toLowerCase()
        items = items.filter(e => e.name.toLowerCase().includes(q) || (e.description || '').toLowerCase().includes(q))
      }
      if (filter.tags && filter.tags.length > 0) {
        const tags = filter.tags.map(t => t.toLowerCase())
        items = items.filter(e => e.tags?.some(t => tags.some(tag => t.toLowerCase().includes(tag))))
      }
      if (filter.propertyFilters && filter.propertyFilters.length > 0) {
        items = items.filter(e => {
          const props = e.properties || {}
          return filter.propertyFilters!.every(pf => {
            const val = String(props[pf.field] ?? '')
            switch (pf.operator) {
              case 'eq': return val === pf.value
              case 'neq': return val !== pf.value
              case 'contains': return val.toLowerCase().includes(pf.value.toLowerCase())
              case 'gt': return val > pf.value
              case 'lt': return val < pf.value
              default: return true
            }
          })
        })
      }
      if (filter.createdAfter) items = items.filter(e => e.createdAt >= filter.createdAfter!)
      if (filter.createdBefore) items = items.filter(e => e.createdAt <= filter.createdBefore!)

      if (filter.relationFilter) {
        const relationStore = useRelationStore()
        const { entityId, relationType, direction, maxDepth = 1 } = filter.relationFilter
        const connectedIds = new Set<string>()
        const queue: Array<{ id: string; depth: number }> = [{ id: entityId, depth: 0 }]
        const visited = new Set<string>([entityId])
        while (queue.length > 0) {
          const { id, depth } = queue.shift()!
          if (depth >= maxDepth) continue
          const rels = relationStore.relations.filter(r => {
            if (relationType && r.type !== relationType) return false
            if (direction === 'outgoing') return r.sourceId === id
            if (direction === 'incoming') return r.targetId === id
            return r.sourceId === id || r.targetId === id
          })
          for (const r of rels) {
            const nextId = r.sourceId === id ? r.targetId : r.sourceId
            if (!visited.has(nextId)) {
              visited.add(nextId)
              connectedIds.add(nextId)
              queue.push({ id: nextId, depth: depth + 1 })
            }
          }
        }
        items = items.filter(e => connectedIds.has(e.id))
      }

      results.value = items
      return items
    } finally {
      loading.value = false
    }
  }

  loadSavedFilters()
  return { loading, results, savedFilters, search, saveFilter, deleteSavedFilter }
}
