/** 时间线排序：时序按历法标量，大纲树按树展开顺序。 */
import { computed, ref, type ComputedRef, type Ref } from 'vue'
import type { Entity } from '@worldsea/entity-core'
import type { EventTime } from './useTimelinePoints'

export type SortMode = 'tree' | 'chrono'

export function useTimelineSort(
  events: ComputedRef<Entity[]>,
  flatOrder: ComputedRef<Entity[]>,
  points: Ref<Map<string, EventTime>>,
) {
  const sortMode = ref<SortMode>('chrono')

  const sortedEvents = computed(() => {
    if (sortMode.value === 'tree') return flatOrder.value
    const list = [...events.value]
    list.sort((a, b) => {
      const left = points.value.get(a.id)
      const right = points.value.get(b.id)
      const leftInvalid = !left || left.unresolved
      const rightInvalid = !right || right.unresolved
      if (leftInvalid || rightInvalid) return Number(leftInvalid) - Number(rightInvalid)
      if (left!.foreign !== right!.foreign) return left!.foreign ? 1 : -1
      return left!.startScalar - right!.startScalar
    })
    return list
  })

  function toggleSortMode() {
    sortMode.value = sortMode.value === 'tree' ? 'chrono' : 'tree'
  }

  return { sortMode, sortedEvents, toggleSortMode }
}
