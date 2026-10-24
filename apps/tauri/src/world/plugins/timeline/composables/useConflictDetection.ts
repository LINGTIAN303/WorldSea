/**
 * 时间冲突检测（两种口径）：
 * - time：当前历法下任意两个事件的时间区间重叠（不依赖关系；「早于/晚于」开放式日期不参与）；
 * - character：同一角色/组织通过「涉及」关系关联的事件时间重叠（正向 involves 与反向 involved_in_event 都认）。
 * 模糊日期单独标注（fuzzy=true），不并入精确冲突；跨历法的事件不共享标量轴，不参与比较。
 */
import { computed, ref, type ComputedRef } from 'vue'
import type { Entity, Relation } from '@worldsea/entity-core'
import { scalarRange, rangesOverlap, type ScalarRange } from '../calendar/fuzzy'
import type { CalendarRuntime } from '../calendar/math'
import type { EventTime } from './useTimelinePoints'

export type ConflictMode = 'time' | 'character'

/** 全量口径的展示上限：同一年份事件密集时避免面板被成对组合淹没 */
export const TIME_CONFLICT_LIMIT = 200

export interface Conflict {
  type: 'same_date' | 'overlap' | 'same_location'
  /** 归属口径（面板只在当前口径下列出） */
  scope: ConflictMode
  description: string
  entities: string[]
  /** 两个冲突事件的 id（可点击跳转定位） */
  eventIds: [string, string]
  date: string
  /** 任一方为模糊日期：面板单独标注 */
  fuzzy: boolean
}

/** 检测范围（面板展示口径，避免「无冲突」被误读为检测失效） */
export interface ConflictScanStats {
  /** 参与检测的角色/组织数 */
  characters: number
  /** 角色关联的事件数 */
  events: number
  /** 其中时间可解析、可比较的事件数 */
  scannable: number
  /** 有效的「涉及」关系条数（为 0 时角色口径必然无结果，面板据此给指引） */
  involveRelations: number
}

function involvedPair(
  relation: Relation,
  entityMap: Map<string, Entity>,
): { characterId: string; event: Entity } | null {
  if (relation.type !== 'involves' && relation.type !== 'involved_in_event') return null
  const forward = relation.type === 'involves'
  const event = entityMap.get(forward ? relation.sourceId : relation.targetId)
  const characterId = forward ? relation.targetId : relation.sourceId
  const character = entityMap.get(characterId)
  if (!event || event.type !== 'event' || !character) return null
  if (character.type !== 'character' && character.type !== 'organization') return null
  return { characterId, event }
}

export function useConflictDetection(
  relations: ComputedRef<Relation[]>,
  entityMap: ComputedRef<Map<string, Entity>>,
  points: ComputedRef<Map<string, EventTime>>,
  runtime: ComputedRef<CalendarRuntime>,
) {
  const mode = ref<ConflictMode>('time')

  function rangeFor(point: EventTime): ScalarRange | null {
    if (!point.start) return null
    try {
      return scalarRange(runtime.value, point.start, point.end)
    } catch {
      return null
    }
  }

  /** 全量口径：按起点排序后扫描，同起点/相交区间即成对（早于/晚于的无穷区间跳过） */
  const timeConflicts = computed<Conflict[]>(() => {
    const entries: { id: string; name: string; range: ScalarRange; point: EventTime }[] = []
    for (const [id, point] of points.value) {
      if (point.foreign || point.unresolved || !point.start) continue
      if (point.certainty === 'before' || point.certainty === 'after') continue
      const event = entityMap.value.get(id)
      const range = rangeFor(point)
      if (!event || event.type !== 'event' || !range) continue
      entries.push({ id, name: event.name, range, point })
    }
    entries.sort((a, b) => a.range.start - b.range.start)

    const raw: Conflict[] = []
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        if (entries[j].range.start >= entries[i].range.end) break
        if (!rangesOverlap(entries[i].range, entries[j].range)) continue
        const a = entries[i]
        const b = entries[j]
        const fuzzy = a.range.fuzzy || b.range.fuzzy
        const sameDate = a.point.startScalar === b.point.startScalar && !a.point.range && !b.point.range
        raw.push({
          type: sameDate ? 'same_date' : 'overlap',
          scope: 'time',
          description: fuzzy
            ? `「${a.name}」与「${b.name}」时间重叠（含模糊日期，仅供参考）`
            : `「${a.name}」与「${b.name}」时间重叠`,
          entities: [a.name, b.name],
          eventIds: [a.id, b.id],
          date: a.point.text,
          fuzzy,
        })
        if (raw.length > TIME_CONFLICT_LIMIT) return raw
      }
    }
    return raw
  })

  const timeTruncated = computed(() => timeConflicts.value.length > TIME_CONFLICT_LIMIT)
  const shownTimeConflicts = computed(() => (
    timeTruncated.value ? timeConflicts.value.slice(0, TIME_CONFLICT_LIMIT) : timeConflicts.value
  ))

  /** 角色口径：同一角色/组织关联的事件两两比对（同一事件重复关联只算一次） */
  const characterConflicts = computed<Conflict[]>(() => {
    const results: Conflict[] = []
    const byCharacter = new Map<string, Entity[]>()
    const seen = new Set<string>()
    for (const relation of relations.value) {
      const pair = involvedPair(relation, entityMap.value)
      if (!pair) continue
      const key = `${pair.characterId}\u0000${pair.event.id}`
      if (seen.has(key)) continue
      seen.add(key)
      if (!byCharacter.has(pair.characterId)) byCharacter.set(pair.characterId, [])
      byCharacter.get(pair.characterId)!.push(pair.event)
    }

    for (const [characterId, events] of byCharacter) {
      const character = entityMap.value.get(characterId)
      if (!character || events.length < 2) continue
      for (let i = 0; i < events.length; i++) {
        for (let j = i + 1; j < events.length; j++) {
          const pointA = points.value.get(events[i].id)
          const pointB = points.value.get(events[j].id)
          if (!pointA || !pointB || pointA.foreign || pointA.unresolved || pointB.foreign || pointB.unresolved) continue
          const rangeA = rangeFor(pointA)
          const rangeB = rangeFor(pointB)
          if (!rangeA || !rangeB || !rangesOverlap(rangeA, rangeB)) continue

          const fuzzy = rangeA.fuzzy || rangeB.fuzzy
          const sameDate = pointA.startScalar === pointB.startScalar && !pointA.range && !pointB.range
          const fuzzyNote = fuzzy ? '（含模糊日期，仅供参考）' : ''
          results.push({
            type: sameDate ? 'same_date' : 'overlap',
            scope: 'character',
            description: `${character.name} 参与了时间重叠的事件${fuzzyNote}`,
            entities: [events[i].name, events[j].name],
            eventIds: [events[i].id, events[j].id],
            date: pointA.text,
            fuzzy,
          })

          const locA = (events[i].properties.location as string) || ''
          const locB = (events[j].properties.location as string) || ''
          if (locA && locB && locA === locB) {
            results.push({
              type: 'same_location',
              scope: 'character',
              description: `${character.name} 在 ${locA} 同时参与了多个事件${fuzzyNote}`,
              entities: [events[i].name, events[j].name],
              eventIds: [events[i].id, events[j].id],
              date: pointA.text,
              fuzzy,
            })
          }
        }
      }
    }
    // 精确冲突优先展示，模糊冲突集中排在其后
    return results.sort((a, b) => Number(a.fuzzy) - Number(b.fuzzy))
  })

  const conflicts = computed(() => (mode.value === 'time' ? shownTimeConflicts.value : characterConflicts.value))
  const conflictCounts = computed(() => ({
    time: timeTruncated.value ? TIME_CONFLICT_LIMIT : timeConflicts.value.length,
    character: characterConflicts.value.length,
  }))
  const truncated = computed(() => timeTruncated.value)
  const hasConflicts = computed(() => conflicts.value.length > 0)

  const scanStats = computed<ConflictScanStats>(() => {
    const characters = new Set<string>()
    const events = new Set<string>()
    let involveRelations = 0
    for (const relation of relations.value) {
      const pair = involvedPair(relation, entityMap.value)
      if (!pair) continue
      involveRelations++
      characters.add(pair.characterId)
      events.add(pair.event.id)
    }
    let scannable = 0
    for (const id of events) {
      const point = points.value.get(id)
      if (point && !point.foreign && !point.unresolved) scannable++
    }
    return { characters: characters.size, events: events.size, scannable, involveRelations }
  })

  return {
    mode,
    conflicts,
    timeConflicts: shownTimeConflicts,
    characterConflicts,
    conflictCounts,
    truncated,
    hasConflicts,
    scanStats,
  }
}
