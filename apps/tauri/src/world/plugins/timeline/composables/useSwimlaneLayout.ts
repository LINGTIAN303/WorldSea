/**
 * 画布泳道布局：分组 → 泳道 → 行（重叠事件错行）。
 *
 * 口径：只关心行号与高度，像素换算留给标尺；周期 occurrence 与基础事件同泳道参与错行。
 */
import { computed, ref, type ComputedRef } from 'vue'
import type { Entity } from '@worldsea/entity-core'
import type { EventTime } from './useTimelinePoints'
import type { TimelineGroup } from './timelineGroups'

export interface OccurrenceMarker {
  key: string
  eventId: string
  scalar: number
  /** 含「第 N 次」与日期的 tooltip 文案 */
  text: string
  /** 命中周期例外：画布画成跳过点 */
  skipped: boolean
}

export interface LaneItem {
  key: string
  event: Entity
  startScalar: number
  endScalar: number
  row: number
  /** 有值 = 周期展开出的虚拟 occurrence */
  occurrenceText?: string
  occurrenceSkipped?: boolean
}

export interface Swimlane {
  id: string
  label: string
  detail?: string
  color: string
  collapsed: boolean
  count: number
  height: number
  items: LaneItem[]
}

const LANE_COLORS = [
  'var(--primary)', 'var(--success)', 'var(--warning)', 'var(--danger)',
  'var(--info)', 'var(--secondary)', '#8b5cf6', '#06b6d4',
  '#f97316', '#84cc16', '#ec4899', '#14b8a6',
]

export const ROW_HEIGHT = 36
export const LANE_HEADER_HEIGHT = 32
const LANE_PADDING = 8
const LANE_MIN_BODY = 40

export interface SwimlaneLayoutOptions {
  groups: ComputedRef<TimelineGroup[]>
  points: ComputedRef<Map<string, EventTime>>
  occurrences: ComputedRef<OccurrenceMarker[]>
}

export function useSwimlaneLayout(options: SwimlaneLayoutOptions) {
  const { groups, points, occurrences } = options
  const collapsedLanes = ref<Set<string>>(new Set())

  const lanes = computed<Swimlane[]>(() => {
    const occurrenceByEvent = new Map<string, OccurrenceMarker[]>()
    for (const occurrence of occurrences.value) {
      if (!occurrenceByEvent.has(occurrence.eventId)) occurrenceByEvent.set(occurrence.eventId, [])
      occurrenceByEvent.get(occurrence.eventId)!.push(occurrence)
    }

    return groups.value.map((group, index) => {
      const isCollapsed = collapsedLanes.value.has(group.id)
      const items: LaneItem[] = []
      for (const event of group.events) {
        const point = points.value.get(event.id)
        if (!point || point.foreign || point.unresolved || !Number.isFinite(point.startScalar)) continue
        items.push({ key: event.id, event, startScalar: point.startScalar, endScalar: point.endScalar, row: 0 })
        for (const occurrence of occurrenceByEvent.get(event.id) ?? []) {
          items.push({
            key: occurrence.key, event,
            startScalar: occurrence.scalar, endScalar: occurrence.scalar + 1,
            row: 0, occurrenceText: occurrence.text, occurrenceSkipped: occurrence.skipped || undefined,
          })
        }
      }

      items.sort((a, b) => a.startScalar - b.startScalar || a.key.localeCompare(b.key))
      const rowEnds: number[] = []
      for (const item of items) {
        item.endScalar = Math.max(item.endScalar, item.startScalar + 1)
        let row = rowEnds.findIndex(end => end <= item.startScalar)
        if (row < 0) {
          row = rowEnds.length
          rowEnds.push(item.endScalar)
        } else {
          rowEnds[row] = item.endScalar
        }
        item.row = row
      }

      const body = isCollapsed ? 0 : Math.max(LANE_MIN_BODY, rowEnds.length * ROW_HEIGHT + LANE_PADDING)
      return {
        id: group.id,
        label: group.label || '全部事件',
        detail: group.detail,
        color: LANE_COLORS[index % LANE_COLORS.length],
        collapsed: isCollapsed,
        count: group.events.length,
        height: LANE_HEADER_HEIGHT + body,
        items,
      }
    })
  })

  function toggleCollapse(laneId: string) {
    const next = new Set(collapsedLanes.value)
    if (next.has(laneId)) next.delete(laneId)
    else next.add(laneId)
    collapsedLanes.value = next
  }

  function resetCollapse() {
    collapsedLanes.value = new Set()
  }

  return { lanes, toggleCollapse, resetCollapse }
}
