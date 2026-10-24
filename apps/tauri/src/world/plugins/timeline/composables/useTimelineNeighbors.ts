/** 详情侧栏的相邻事件导航：按当前筛选后的顺序取上一个/下一个；大纲树用分组 + 折叠后的可见顺序。 */
import { computed, type ComputedRef, type Ref } from 'vue'
import type { Entity } from '@worldsea/entity-core'

export interface NeighborScope {
  /** 排序形态：tree 时使用 treeOrder */
  mode?: Ref<'chrono' | 'tree'>
  /** 树态可见顺序（分组顺序 → 组内树序 → 折叠截断），缺省时退回 ordered */
  treeOrder?: ComputedRef<Entity[]>
}

export function useTimelineNeighbors(
  selected: Ref<Entity | null>,
  ordered: ComputedRef<Entity[]>,
  onPick: (event: Entity) => void,
  scope: NeighborScope = {},
) {
  const list = computed(() => (
    scope.mode?.value === 'tree' && scope.treeOrder ? scope.treeOrder.value : ordered.value
  ))

  const index = computed(() => (
    selected.value ? list.value.findIndex(event => event.id === selected.value?.id) : -1
  ))

  const nav = computed(() => ({
    index: index.value,
    total: list.value.length,
    hasPrev: index.value > 0,
    hasNext: index.value >= 0 && index.value < list.value.length - 1,
  }))

  function step(delta: number) {
    const target = index.value >= 0 ? list.value[index.value + delta] : undefined
    if (target) onPick(target)
  }

  return { nav, step }
}
