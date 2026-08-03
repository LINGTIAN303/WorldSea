import { computed, type ComputedRef } from 'vue'
import type { Entity, Relation } from '@worldsmith/entity-core'
import { parseDateRange, datesOverlap, type ParsedDate } from './useDateParser'

export interface Conflict {
  type: 'same_date' | 'overlap' | 'same_location'
  description: string
  entities: string[]
  date: string
}

export function useConflictDetection(
  events: ComputedRef<Entity[]>,
  relations: ComputedRef<Relation[]>,
  entityMap: ComputedRef<Map<string, Entity>>
) {
  const conflicts = computed<Conflict[]>(() => {
    const results: Conflict[] = []
    const parsedDateMap = new Map<string, ParsedDate | null>()
    for (const e of events.value) {
      const dateText = (e.properties.date as string) || ''
      const dateEndText = (e.properties.dateEnd as string) || ''
      parsedDateMap.set(e.id, parseDateRange(dateText, dateEndText))
    }

    const involveRels = relations.value.filter(r => r.type === 'involves')
    const charEvents = new Map<string, Entity[]>()
    for (const rel of involveRels) {
      if (!charEvents.has(rel.targetId)) charEvents.set(rel.targetId, [])
      const evt = entityMap.value.get(rel.sourceId)
      if (evt) charEvents.get(rel.targetId)!.push(evt)
    }

    for (const [charId, evts] of charEvents) {
      const character = entityMap.value.get(charId)
      if (!character || evts.length < 2) continue

      for (let i = 0; i < evts.length; i++) {
        for (let j = i + 1; j < evts.length; j++) {
          const dateA = parsedDateMap.get(evts[i].id) ?? null
          const dateB = parsedDateMap.get(evts[j].id) ?? null

          if (!dateA || !dateB) continue

          if (datesOverlap(dateA, dateB)) {
            results.push({
              type: dateA.raw === dateB.raw ? 'same_date' : 'overlap',
              description: `${character.name} 参与了时间重叠的事件`,
              entities: [evts[i].name, evts[j].name],
              date: dateA.raw,
            })
          }

          const locA = (evts[i].properties.location as string) || ''
          const locB = (evts[j].properties.location as string) || ''
          if (locA && locB && locA === locB && datesOverlap(dateA, dateB)) {
            results.push({
              type: 'same_location',
              description: `${character.name} 在 ${locA} 同时参与了多个事件`,
              entities: [evts[i].name, evts[j].name],
              date: dateA.raw,
            })
          }
        }
      }
    }

    return results
  })

  const hasConflicts = computed(() => conflicts.value.length > 0)

  return { conflicts, hasConflicts }
}