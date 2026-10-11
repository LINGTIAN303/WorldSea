import { defineStore } from 'pinia'
import { computed } from 'vue'
import { useShallowArray } from '@worldsea/perf-kit/reactive'
import { createDebouncedStorage } from '@worldsea/perf-kit/io'
import type { Entity, Relation } from '../types'

export interface TrashItem {
  id: string
  entityType: 'entity' | 'relation'
  data: Entity | Relation
  deletedAt: string
  deletedBy: 'user' | 'agent' | 'import'
  /** 关联关系ID列表（仅实体删除时记录，用于恢复） */
  cascadedRelationIds?: string[]
}

const TRASH_STORAGE_KEY = 'ws_trash'
const MAX_TRASH_ITEMS = 200
const TRASH_EXPIRE_DAYS = 30

export const useTrashStore = defineStore('trash', () => {
  const { items, setAll, unshift, removeById, trigger } = useShallowArray<TrashItem>('id')
  const debouncedStore = createDebouncedStorage({ debounce: 100 })

  const entityItems = computed(() => items.value.filter(i => i.entityType === 'entity'))
  const relationItems = computed(() => items.value.filter(i => i.entityType === 'relation'))
  const totalCount = computed(() => items.value.length)

  function loadFromStorage() {
    try {
      const raw = localStorage.getItem(TRASH_STORAGE_KEY)
      if (raw) setAll(JSON.parse(raw))
    } catch { setAll([]) }
  }

  function saveToStorage() {
    debouncedStore.set(TRASH_STORAGE_KEY, items.value)
  }

  function add(item: TrashItem) {
    unshift(item)
    // 超出上限时移除最旧的
    while (items.value.length > MAX_TRASH_ITEMS) items.value.pop()
    // 过期清理
    const expireDate = new Date(Date.now() - TRASH_EXPIRE_DAYS * 24 * 60 * 60 * 1000)
    const before = items.value.length
    const filtered = items.value.filter(i => new Date(i.deletedAt) > expireDate)
    if (filtered.length !== before) setAll(filtered)
    else trigger()
    saveToStorage()
  }

  function restore(id: string): TrashItem | undefined {
    const idx = items.value.findIndex(i => i.id === id)
    if (idx === -1) return undefined
    const item = items.value[idx]
    items.value.splice(idx, 1)
    trigger()
    saveToStorage()
    return item
  }

  function permanentDelete(id: string) {
    removeById(id)
    saveToStorage()
  }

  function emptyTrash() {
    setAll([])
    saveToStorage()
  }

  function getItem(id: string): TrashItem | undefined {
    return items.value.find(i => i.id === id)
  }

  loadFromStorage()

  return { items, entityItems, relationItems, totalCount, add, restore, permanentDelete, emptyTrash, getItem }
})
