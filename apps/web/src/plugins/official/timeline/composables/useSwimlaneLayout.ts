import { computed, ref, type ComputedRef } from 'vue'
import type { Entity, Relation } from '@worldsmith/entity-core'
import { parseDateRange, type ParsedDate } from './useDateParser'

export type GroupMode = 'none' | 'character' | 'location' | 'era' | 'tag'

export interface Swimlane {
  id: string
  label: string
  color: string
  events: Entity[]
  collapsed: boolean
  sortOrder: number
}

export interface RowAssignment {
  eventId: string
  row: number
  pixelX: number
  pixelWidth: number
  pixelY: number
}

const LANE_COLORS = [
  'var(--primary)', 'var(--success)', 'var(--warning)', 'var(--danger)',
  'var(--info)', 'var(--secondary)', '#8b5cf6', '#06b6d4',
  '#f97316', '#84cc16', '#ec4899', '#14b8a6',
]

export interface SwimlaneLayoutOptions {
  events: ComputedRef<Entity[]>
  relations: ComputedRef<Relation[]>
  entityMap: ComputedRef<Map<string, Entity>>
  pixelsPerYear: ComputedRef<number>
  timeToPixel: (date: ParsedDate) => number
  timeToTimeValue: (date: ParsedDate) => number
}

export function useSwimlaneLayout(options: SwimlaneLayoutOptions) {
  const { events, relations, entityMap, timeToPixel, timeToTimeValue } = options

  const groupMode = ref<GroupMode>('none')
  const collapsedLanes = ref<Set<string>>(new Set())

  const parsedDateMap = computed(() => {
    const map = new Map<string, ParsedDate | null>()
    for (const e of events.value) {
      const dateText = (e.properties.date as string) || ''
      const dateEndText = (e.properties.dateEnd as string) || ''
      map.set(e.id, parseDateRange(dateText, dateEndText))
    }
    return map
  })

  const lanes = computed<Swimlane[]>(() => {
    if (groupMode.value === 'none') {
      return [{
        id: '__default__',
        label: '全部事件',
        color: LANE_COLORS[0],
        events: events.value,
        collapsed: collapsedLanes.value.has('__default__'),
        sortOrder: 0,
      }]
    }

    const groupMap = new Map<string, Entity[]>()

    if (groupMode.value === 'character') {
      const involveRels = relations.value.filter(r => r.type === 'involves')
      const ungrouped: Entity[] = []
      const grouped = new Set<string>()
      for (const e of events.value) {
        const rels = involveRels.filter(r => r.sourceId === e.id)
        if (rels.length === 0) {
          ungrouped.push(e)
        } else {
          for (const rel of rels) {
            const char = entityMap.value.get(rel.targetId)
            if (!char) continue
            if (!groupMap.has(char.name)) groupMap.set(char.name, [])
            groupMap.get(char.name)!.push(e)
            grouped.add(e.id)
          }
        }
      }
      for (const e of ungrouped) {
        if (!grouped.has(e.id)) {
          if (!groupMap.has('未分配')) groupMap.set('未分配', [])
          groupMap.get('未分配')!.push(e)
        }
      }
    } else if (groupMode.value === 'location') {
      for (const e of events.value) {
        const loc = (e.properties.location as string) || '未知地点'
        if (!groupMap.has(loc)) groupMap.set(loc, [])
        groupMap.get(loc)!.push(e)
      }
    } else if (groupMode.value === 'era') {
      for (const e of events.value) {
        const era = (e.properties.era as string) || '未知纪元'
        if (!groupMap.has(era)) groupMap.set(era, [])
        groupMap.get(era)!.push(e)
      }
    } else if (groupMode.value === 'tag') {
      for (const e of events.value) {
        const tags = (e.tags as string[]) || []
        if (tags.length === 0) {
          if (!groupMap.has('无标签')) groupMap.set('无标签', [])
          groupMap.get('无标签')!.push(e)
        } else {
          for (const tag of tags) {
            if (!groupMap.has(tag)) groupMap.set(tag, [])
            groupMap.get(tag)!.push(e)
          }
        }
      }
    }

    const result: Swimlane[] = []
    let colorIdx = 0
    const sortedKeys = Array.from(groupMap.keys()).sort()
    for (const key of sortedKeys) {
      result.push({
        id: `lane-${key}`,
        label: key,
        color: LANE_COLORS[colorIdx % LANE_COLORS.length],
        events: groupMap.get(key) || [],
        collapsed: collapsedLanes.value.has(`lane-${key}`),
        sortOrder: colorIdx,
      })
      colorIdx++
    }
    return result
  })

  const rowAssignments = computed<Map<string, RowAssignment>>(() => {
    const map = new Map<string, RowAssignment>()
    const ROW_HEIGHT = 32
    const ROW_GAP = 4

    for (const lane of lanes.value) {
      if (lane.collapsed) continue

      const sorted = [...lane.events].sort((a, b) => {
        const da = parsedDateMap.value.get(a.id)
        const db = parsedDateMap.value.get(b.id)
        if (!da && !db) return 0
        if (!da) return -1
        if (!db) return 1
        return timeToTimeValue(da) - timeToTimeValue(db)
      })

      const rows: { endTime: number }[] = []

      for (const e of sorted) {
        const pd = parsedDateMap.value.get(e.id)
        if (!pd) continue

        const startTime = timeToTimeValue(pd)
        const isRange = pd.isRange && pd.yearEnd != null
        const endTime = isRange
          ? timeToTimeValue({ ...pd, year: pd.yearEnd ?? pd.year, era: pd.eraEnd ?? pd.era })
          : startTime + 1

        const startX = timeToPixel(pd)
        const endX = isRange
          ? timeToPixel({ ...pd, year: pd.yearEnd ?? pd.year, era: pd.eraEnd ?? pd.era })
          : startX + 24

        const width = Math.max(24, endX - startX)

        let assignedRow = -1
        for (let r = 0; r < rows.length; r++) {
          if (rows[r].endTime <= startTime) {
            assignedRow = r
            rows[r].endTime = endTime
            break
          }
        }
        if (assignedRow === -1) {
          assignedRow = rows.length
          rows.push({ endTime })
        }

        map.set(e.id, {
          eventId: e.id,
          row: assignedRow,
          pixelX: startX,
          pixelWidth: width,
          pixelY: assignedRow * (ROW_HEIGHT + ROW_GAP),
        })
      }
    }

    return map
  })

  function setGroupMode(mode: GroupMode) {
    groupMode.value = mode
    collapsedLanes.value = new Set()
  }

  function toggleLaneCollapse(laneId: string) {
    const newSet = new Set(collapsedLanes.value)
    if (newSet.has(laneId)) newSet.delete(laneId)
    else newSet.add(laneId)
    collapsedLanes.value = newSet
  }

  function reorderLanes(fromIndex: number, toIndex: number) {
    void fromIndex; void toIndex
  }

  return {
    lanes,
    rowAssignments,
    parsedDateMap,
    groupMode,
    collapsedLanes,
    setGroupMode,
    toggleLaneCollapse,
    reorderLanes,
  }
}
