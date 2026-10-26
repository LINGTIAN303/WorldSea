/**
 * 时间轴过滤：只按已填日期过滤，未填日期的实体保持常显。
 * 面板开合、范围与「是否已收窄」都在这里维护，视图只负责渲染。
 */
import { computed, ref, watch } from 'vue'
import type { Entity } from '@worldsea/entity-core'
import { buildTimeline, isOutsideRange } from '../model/timeline'

export function useTimelineFilter(entities: () => Entity[]) {
  const index = computed(() => buildTimeline(entities()))
  const panelOpen = ref(false)
  const start = ref(0)
  const end = ref(0)
  /** 范围是否真的收窄过；未收窄时不触发过滤 */
  const active = ref(false)

  function reset(): void {
    start.value = index.value.min
    end.value = index.value.max
    active.value = false
  }

  function setRange(nextStart: number, nextEnd: number): void {
    start.value = Math.max(index.value.min, Math.min(nextStart, nextEnd))
    end.value = Math.min(index.value.max, Math.max(nextStart, nextEnd))
    active.value = start.value > index.value.min || end.value < index.value.max
  }

  function togglePanel(): void {
    panelOpen.value = !panelOpen.value
    if (panelOpen.value && !active.value) reset()
  }

  function closePanel(): void {
    panelOpen.value = false
  }

  function isHidden(id: string): boolean {
    if (!active.value) return false
    return isOutsideRange(index.value.byId.get(id), start.value, end.value)
  }

  // 数据刷新后把旧范围夹回新的日期区间，避免滑杆停在不存在的年份
  watch(index, () => {
    if (start.value < index.value.min || end.value > index.value.max) reset()
  })

  return {
    timelineIndex: index,
    timelineOpen: panelOpen,
    timelineStart: start,
    timelineEnd: end,
    timelineActive: active,
    timelineDated: computed(() => index.value.datedCount),
    timelineMin: computed(() => index.value.min),
    timelineMax: computed(() => index.value.max),
    setTimelineRange: setRange,
    resetTimeline: reset,
    toggleTimelinePanel: togglePanel,
    closeTimelinePanel: closePanel,
    isTimelineHidden: isHidden,
  }
}
