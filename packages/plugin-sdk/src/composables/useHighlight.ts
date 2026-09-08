import { ref } from 'vue'
import type { Relation } from '@worldsea/entity-core'
import { getSettingsApi } from '@worldsea/entity-core'

export interface HighlightOptions {
  getRelations: () => Relation[]
}

export function useHighlight(options: HighlightOptions) {
  const settings = getSettingsApi()
  const selectedId = ref<string | null>(null)
  const hoveredId = ref<string | null>(null)
  const searchIds = ref<Set<string>>(new Set())

  function select(id: string | null) {
    selectedId.value = id
  }

  function hover(id: string | null) {
    hoveredId.value = id
  }

  function setSearchResults(ids: string[]) {
    searchIds.value = new Set(ids)
  }

  function computeDistance(fromId: string, relations: Relation[]): Map<string, number> {
    const maxHops = settings.highlight_spreadHops || 3
    const dist = new Map<string, number>()
    dist.set(fromId, 0)
    const queue = [fromId]
    while (queue.length > 0) {
      const current = queue.shift()!
      const currentDist = dist.get(current)!
      if (currentDist >= maxHops) continue
      for (const r of relations) {
        const neighbor = r.sourceId === current ? r.targetId : r.targetId === current ? r.sourceId : null
        if (neighbor && !dist.has(neighbor)) {
          dist.set(neighbor, currentDist + 1)
          queue.push(neighbor)
        }
      }
    }
    return dist
  }

  function applyToList(items: { id: string }[]): { dimmed: boolean; active: boolean; searchHit: boolean }[] {
    const focusId = selectedId.value || hoveredId.value
    const dimmingEnabled = settings.highlight_dimmingEnabled
    const relations = options.getRelations()

    let dist: Map<string, number> | null = null
    if (focusId && dimmingEnabled) {
      dist = computeDistance(focusId, relations)
    }

    return items.map(item => {
      const active = item.id === selectedId.value
      const searchHit = searchIds.value.has(item.id)
      let dimmed = false
      if (focusId && dimmingEnabled && dist) {
        dimmed = !dist.has(item.id) && item.id !== focusId
      }
      return { dimmed, active, searchHit }
    })
  }

  return {
    selectedId,
    hoveredId,
    searchIds,
    select,
    hover,
    setSearchResults,
    applyToList,
  }
}
