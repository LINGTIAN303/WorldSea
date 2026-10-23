/**
 * 时间冲突检测：角色参与的事件在标量区间上重叠。
 *
 * 口径（D5）：模糊日期单独标注（fuzzy=true），不并入精确冲突；
 * 跨历法的事件不共享标量轴，不参与比较。
 */
import { computed, type ComputedRef } from 'vue'
import type { Entity, Relation } from '@worldsea/entity-core'
import { scalarRange, rangesOverlap, type ScalarRange } from '../calendar/fuzzy'
import type { CalendarRuntime } from '../calendar/math'
import type { EventTime } from './useTimelinePoints'

export interface Conflict {
  type: 'same_date' | 'overlap' | 'same_location'
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
  /** 参与检测的角色数 */
  characters: number
  /** 角色关联的事件数 */
  events: number
  /** 其中时间可解析、可比较的事件数 */
  scannable: number
}

export function useConflictDetection(
  relations: ComputedRef<Relation[]>,
  entityMap: ComputedRef<Map<string, Entity>>,
  points: ComputedRef<Map<string, EventTime>>,
  runtime: ComputedRef<CalendarRuntime>,
) {
  const conflicts = computed<Conflict[]>(() => {
    const results: Conflict[] = []
    const byCharacter = new Map<string, Entity[]>()
    for (const rel of relations.value) {
      if (rel.type !== 'involves') continue
      const event = entityMap.value.get(rel.sourceId)
      if (!event) continue
      if (!byCharacter.has(rel.targetId)) byCharacter.set(rel.targetId, [])
      byCharacter.get(rel.targetId)!.push(event)
    }

    const rangeOf = (eventId: string): { range: ScalarRange; point: EventTime } | null => {
      const point = points.value.get(eventId)
      if (!point || point.foreign || point.unresolved || !point.start) return null
      try {
        return { range: scalarRange(runtime.value, point.start, point.end), point }
      } catch {
        return null
      }
    }

    for (const [characterId, events] of byCharacter) {
      const character = entityMap.value.get(characterId)
      if (!character || events.length < 2) continue
      for (let i = 0; i < events.length; i++) {
        for (let j = i + 1; j < events.length; j++) {
          const a = rangeOf(events[i].id)
          const b = rangeOf(events[j].id)
          if (!a || !b || !rangesOverlap(a.range, b.range)) continue

          const fuzzy = a.range.fuzzy || b.range.fuzzy
          const sameDate = a.point.startScalar === b.point.startScalar && !a.point.range && !b.point.range
          results.push({
            type: sameDate ? 'same_date' : 'overlap',
            description: fuzzy
              ? `${character.name} 参与了时间重叠的事件（含模糊日期，仅供参考）`
              : `${character.name} 参与了时间重叠的事件`,
            entities: [events[i].name, events[j].name],
            eventIds: [events[i].id, events[j].id],
            date: a.point.text,
            fuzzy,
          })

          const locA = (events[i].properties.location as string) || ''
          const locB = (events[j].properties.location as string) || ''
          if (locA && locB && locA === locB) {
            results.push({
              type: 'same_location',
              description: `${character.name} 在 ${locA} 同时参与了多个事件${fuzzy ? '（含模糊日期，仅供参考）' : ''}`,
              entities: [events[i].name, events[j].name],
              eventIds: [events[i].id, events[j].id],
              date: a.point.text,
              fuzzy,
            })
          }
        }
      }
    }
    // 精确冲突优先展示，模糊冲突集中排在其后
    return results.sort((a, b) => Number(a.fuzzy) - Number(b.fuzzy))
  })

  const hasConflicts = computed(() => conflicts.value.length > 0)

  const scanStats = computed<ConflictScanStats>(() => {
    const characters = new Set<string>()
    const events = new Set<string>()
    for (const rel of relations.value) {
      if (rel.type !== 'involves' || !entityMap.value.has(rel.sourceId)) continue
      characters.add(rel.targetId)
      events.add(rel.sourceId)
    }
    let scannable = 0
    for (const id of events) {
      const point = points.value.get(id)
      if (point && !point.foreign && !point.unresolved) scannable++
    }
    return { characters: characters.size, events: events.size, scannable }
  })

  return { conflicts, hasConflicts, scanStats }
}
