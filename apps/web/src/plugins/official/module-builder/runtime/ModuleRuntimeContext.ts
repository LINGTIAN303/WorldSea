import { ref, computed, type Ref, type ComputedRef } from 'vue'
import type { CustomModule, Entity } from '@worldsmith/entity-core'
import { storage } from '@worldsmith/entity-core'

export interface SearchFilter {
  field: string
  operator: 'contains' | 'equals' | 'startsWith' | 'endsWith' | 'gt' | 'lt' | 'gte' | 'lte'
  value: unknown
}

export interface SortConfig {
  field: string
  direction: 'asc' | 'desc'
}

export interface ModuleRuntimeContext {
  moduleId: string
  manifest: CustomModule
  selectedEntityId: Ref<string | null>
  selectedEntity: ComputedRef<Entity | null>
  entityList: Ref<Entity[]>
  filteredList: ComputedRef<Entity[]>
  searchQuery: Ref<string>
  filters: Ref<SearchFilter[]>
  sortConfig: Ref<SortConfig | null>
  setSearchQuery(query: string): void
  setFilters(filters: SearchFilter[]): void
  setSortConfig(config: SortConfig | null): void
  emit(event: string, payload?: unknown): void
  on(event: string, handler: (payload?: unknown) => void): void
  off(event: string, handler: (payload?: unknown) => void): void
  createEntity(type: string, data: Record<string, unknown>): Promise<Entity>
  updateEntity(id: string, data: Record<string, unknown>): Promise<void>
  deleteEntity(id: string): Promise<void>
  getEntitiesByType(type: string): Promise<Entity[]>
  initialize(): void
  dispose(): void
}

export function createModuleRuntimeContext(module: CustomModule): ModuleRuntimeContext {
  const selectedEntityId = ref<string | null>(null)
  const entityList = ref<Entity[]>([])
  const listeners = new Map<string, Set<Function>>()
  const searchQuery = ref('')
  const filters = ref<SearchFilter[]>([])
  const sortConfig = ref<SortConfig | null>(null)

  const selectedEntity = computed(() => {
    if (!selectedEntityId.value) return null
    return entityList.value.find(e => e.id === selectedEntityId.value) || null
  })

  const filteredList = computed(() => {
    let list = [...entityList.value]

    if (searchQuery.value) {
      const q = searchQuery.value.toLowerCase()
      list = list.filter(e => {
        const nameMatch = e.name?.toLowerCase().includes(q)
        const descMatch = e.description?.toLowerCase().includes(q)
        const propMatch = Object.values(e.properties || {}).some(v =>
          String(v).toLowerCase().includes(q)
        )
        return nameMatch || descMatch || propMatch
      })
    }

    for (const f of filters.value) {
      list = list.filter(e => {
        const val = f.field === 'name' ? e.name
          : f.field === 'description' ? e.description
          : e.properties?.[f.field]
        if (val === undefined || val === null) return false
        const strVal = String(val).toLowerCase()
        const filterVal = String(f.value).toLowerCase()
        switch (f.operator) {
          case 'contains': return strVal.includes(filterVal)
          case 'equals': return strVal === filterVal
          case 'startsWith': return strVal.startsWith(filterVal)
          case 'endsWith': return strVal.endsWith(filterVal)
          case 'gt': return Number(val) > Number(f.value)
          case 'lt': return Number(val) < Number(f.value)
          case 'gte': return Number(val) >= Number(f.value)
          case 'lte': return Number(val) <= Number(f.value)
          default: return true
        }
      })
    }

    if (sortConfig.value) {
      const { field, direction } = sortConfig.value
      list.sort((a, b) => {
        const aVal = field === 'name' ? a.name : field === 'description' ? a.description : a.properties?.[field]
        const bVal = field === 'name' ? b.name : field === 'description' ? b.description : b.properties?.[field]
        const cmp = String(aVal ?? '').localeCompare(String(bVal ?? ''))
        return direction === 'asc' ? cmp : -cmp
      })
    }

    return list
  })

  let searchTimer: ReturnType<typeof setTimeout> | null = null
  const pendingSearchQuery = ref('')

  function setSearchQuery(query: string) {
    pendingSearchQuery.value = query
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      searchQuery.value = pendingSearchQuery.value
      searchTimer = null
    }, 200)
  }

  function setFilters(newFilters: SearchFilter[]) {
    filters.value = newFilters
  }

  function setSortConfig(config: SortConfig | null) {
    sortConfig.value = config
  }

  function emit(event: string, payload?: unknown) {
    const handlers = listeners.get(event)
    if (!handlers) return
    for (const handler of handlers) {
      try { handler(payload) } catch (e) { console.error(`[ModuleRuntime] 事件处理器错误:`, e) }
    }
  }

  function on(event: string, handler: (payload?: unknown) => void) {
    if (!listeners.has(event)) listeners.set(event, new Set())
    listeners.get(event)!.add(handler)
  }

  function off(event: string, handler: (payload?: unknown) => void) {
    listeners.get(event)?.delete(handler)
  }

  async function createEntity(type: string, data: Record<string, unknown>) {
    const { name, description, ...propertyData } = data
    const now = new Date().toISOString()
    const entity: Entity = {
      id: crypto.randomUUID(),
      type,
      name: (name as string) || '',
      description: (description as string) || '',
      properties: propertyData,
      tags: [],
      createdAt: now,
      updatedAt: now,
    }
    await storage.putEntity(entity)
    entityList.value.push(entity)
    emit('entity:create', entity)
    emit('entity:list-changed')
    return entity
  }

  async function updateEntity(id: string, data: Record<string, unknown>) {
    const idx = entityList.value.findIndex(e => e.id === id)
    const existing = idx !== -1 ? entityList.value[idx] : null
    const { name, description, ...propertyData } = data
    const mergedProperties = existing
      ? { ...existing.properties, ...propertyData }
      : propertyData
    const changes: Partial<Entity> = {
      properties: mergedProperties,
      updatedAt: new Date().toISOString(),
    }
    if (name !== undefined) changes.name = name as string
    if (description !== undefined) changes.description = description as string
    await storage.updateEntity(id, changes)
    if (idx !== -1) {
      entityList.value[idx] = { ...entityList.value[idx], ...changes }
    }
    emit('entity:update', { id, data })
  }

  async function deleteEntity(id: string) {
    await storage.deleteEntity(id)
    entityList.value = entityList.value.filter(e => e.id !== id)
    if (selectedEntityId.value === id) selectedEntityId.value = null
    emit('entity:delete', { id })
    emit('entity:list-changed')
  }

  async function getEntitiesByType(type: string) {
    const entities = await storage.getEntitiesByType(type)
    entityList.value = entities
    return entities
  }

  function initialize() {
    const types = module.entityTypes
    if (types.length > 0) {
      const fullType = `custom.${module.id}.${types[0].name}`
      getEntitiesByType(fullType)
    }
  }

  function dispose() {
    if (searchTimer) { clearTimeout(searchTimer); searchTimer = null }
    listeners.clear()
    entityList.value = []
    selectedEntityId.value = null
    searchQuery.value = ''
    filters.value = []
    sortConfig.value = null
  }

  return {
    moduleId: module.id,
    manifest: module,
    selectedEntityId,
    selectedEntity,
    entityList,
    filteredList,
    searchQuery,
    filters,
    sortConfig,
    setSearchQuery,
    setFilters,
    setSortConfig,
    emit,
    on,
    off,
    createEntity,
    updateEntity,
    deleteEntity,
    getEntitiesByType,
    initialize,
    dispose,
  }
}
