import { computed, ref, type ComputedRef } from 'vue'
import type { Entity } from '@worldsmith/entity-core'
import { compareDates, parseDateRange, type ParsedDate } from './useDateParser'

export type SortMode = 'tree' | 'chrono'

export function useTimelineSort(events: ComputedRef<Entity[]>, flatOrder: ComputedRef<Entity[]>) {
  const sortMode = ref<SortMode>('chrono')

  const parsedDates = computed(() => {
    const map = new Map<string, ParsedDate | null>()
    for (const e of events.value) {
      const dateText = (e.properties.date as string) || ''
      const dateEndText = (e.properties.dateEnd as string) || ''
      map.set(e.id, parseDateRange(dateText, dateEndText))
    }
    return map
  })

  const sortedEvents = computed(() => {
    if (sortMode.value === 'tree') {
      return flatOrder.value
    }

    const list = [...events.value]
    list.sort((a, b) => {
      const dateA = parsedDates.value.get(a.id) ?? null
      const dateB = parsedDates.value.get(b.id) ?? null
      return compareDates(dateA, dateB)
    })
    return list
  })

  function toggleSortMode() {
    sortMode.value = sortMode.value === 'tree' ? 'chrono' : 'tree'
  }

  return { sortMode, sortedEvents, parsedDates, toggleSortMode }
}