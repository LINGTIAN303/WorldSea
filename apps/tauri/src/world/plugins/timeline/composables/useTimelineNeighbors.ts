/** 详情侧栏的相邻事件导航：按当前筛选后的时间序取上一个/下一个。 */
import { computed, type ComputedRef, type Ref } from 'vue'
import type { Entity } from '@worldsea/entity-core'

export function useTimelineNeighbors(
  selected: Ref<Entity | null>,
  ordered: ComputedRef<Entity[]>,
  onPick: (event: Entity) => void,
) {
  const index = computed(() => (
    selected.value ? ordered.value.findIndex(event => event.id === selected.value?.id) : -1
  ))

  const nav = computed(() => ({
    index: index.value,
    total: ordered.value.length,
    hasPrev: index.value > 0,
    hasNext: index.value >= 0 && index.value < ordered.value.length - 1,
  }))

  function step(delta: number) {
    const target = index.value >= 0 ? ordered.value[index.value + delta] : undefined
    if (target) onPick(target)
  }

  return { nav, step }
}
