/** 冲突检测两口径：全量时间重叠（默认）与角色日程；方向归一、开放式日期与上限。 */
import { computed, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import type { Entity, Relation } from '@worldsea/entity-core'
import { createSimpleCalendar, createThreeEraCalendar } from '../../calendar/defaults'
import { useTimelinePoints } from '../useTimelinePoints'
import { useConflictDetection, TIME_CONFLICT_LIMIT } from '../useConflictDetection'

function makeEntity(id: string, name: string, type: string, properties: Record<string, unknown> = {}): Entity {
  return {
    id, type, name, description: '', properties, tags: [],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  } as Entity
}

const event = (id: string, name: string, properties: Record<string, unknown>) => makeEntity(id, name, 'event', properties)
const character = (id: string, name: string) => makeEntity(id, name, 'character')

function setup(entities: Entity[], relations: Relation[] = []) {
  const calendar = createSimpleCalendar()
  const calendars = ref([calendar, createThreeEraCalendar()])
  const { points, runtime } = useTimelinePoints({
    events: computed(() => entities.filter(item => item.type === 'event')),
    calendars,
    activeCalendar: computed(() => calendar),
  })
  return useConflictDetection(
    computed(() => relations),
    computed(() => new Map(entities.map(item => [item.id, item]))),
    points,
    runtime,
  )
}

describe('冲突检测 / 全量时间重叠口径', () => {
  it('默认按时间口径：同一日期成对冲突，相邻年份不冲突', () => {
    const { mode, conflicts, timeConflicts } = setup([
      event('a', '甲', { date: '第三纪元147年' }),
      event('b', '乙', { date: '第三纪元147年' }),
      event('c', '丙', { date: '第三纪元148年' }),
    ])
    expect(mode.value).toBe('time')
    expect(timeConflicts.value).toEqual([
      expect.objectContaining({ type: 'same_date', scope: 'time', eventIds: ['a', 'b'] }),
    ])
    expect(conflicts.value).toHaveLength(1)
  })

  it('区间重叠计入；「早于/晚于」开放式日期不参与', () => {
    const { timeConflicts } = setup([
      event('r', '长战', { date: '第三纪元140年', dateEnd: '第三纪元150年' }),
      event('x', '战役', { date: '第三纪元145年' }),
      event('early', '远古', { date: '第三纪元147年', dateCertainty: 'before' }),
    ])
    expect(timeConflicts.value.map(item => item.eventIds)).toEqual([['r', 'x']])
  })

  it('命中过多时截断到展示上限', () => {
    const many = Array.from({ length: 21 }, (_, i) => event(`e${i}`, `事${i}`, { date: '第三纪元147年' }))
    const { timeConflicts, truncated, conflictCounts } = setup(many)
    expect(timeConflicts.value).toHaveLength(TIME_CONFLICT_LIMIT)
    expect(truncated.value).toBe(true)
    expect(conflictCounts.value.time).toBe(TIME_CONFLICT_LIMIT)
  })
})

describe('冲突检测 / 角色日程口径', () => {
  const relations = [
    { id: 'r1', type: 'involves', sourceId: 'e1', targetId: 'ch' },
    // 反向关系（从角色侧关联事件）同样计入
    { id: 'r2', type: 'involved_in_event', sourceId: 'ch', targetId: 'e2' },
    // 目标不是角色/组织：忽略
    { id: 'r3', type: 'involves', sourceId: 'e1', targetId: 'loc' },
  ] as Relation[]

  it('正反向「涉及」关系都参与比对，非角色目标忽略', () => {
    const api = setup([
      event('e1', '甲', { date: '第三纪元147年' }),
      event('e2', '乙', { date: '第三纪元147年' }),
      character('ch', '角色'),
      makeEntity('loc', '城', 'location'),
    ], relations)
    api.mode.value = 'character'

    expect(api.characterConflicts.value).toHaveLength(1)
    expect(api.characterConflicts.value[0]).toMatchObject({ scope: 'character', eventIds: ['e1', 'e2'] })
    expect(api.scanStats.value).toEqual({ characters: 1, events: 2, scannable: 2, involveRelations: 2 })
  })

  it('没有任何「涉及」关系时角色口径为空，工具条徽标跟随当前口径', () => {
    const api = setup([
      event('e1', '甲', { date: '第三纪元147年' }),
      event('e2', '乙', { date: '第三纪元147年' }),
    ])
    expect(api.scanStats.value.involveRelations).toBe(0)
    api.mode.value = 'character'
    expect(api.conflicts.value).toEqual([])
    expect(api.hasConflicts.value).toBe(false)
    expect(api.conflictCounts.value.time).toBe(1)
  })
})
