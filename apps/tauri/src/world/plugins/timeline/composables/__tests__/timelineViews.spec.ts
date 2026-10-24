import { computed, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import type { Entity, Relation } from '@worldsea/entity-core'
import { createSimpleCalendar, createThreeEraCalendar } from '../../calendar/defaults'
import { createCalendarRuntime } from '../../calendar/math'
import { useTimelinePoints } from '../useTimelinePoints'
import { buildGroups, periodOf, type GroupMode } from '../timelineGroups'
import { useTimelineFilters } from '../useTimelineFilters'
import { useTimelineGroups } from '../useTimelineGroups'
import { useEventTree } from '../useEventTree'
import { useConflictDetection } from '../useConflictDetection'
import { useTimelineScale } from '../useTimelineScale'
import { useTimelineSort } from '../useTimelineSort'
import { formatSnapped, snapCeil, snapFloor, dragHintText } from '../timelineSnap'

function makeEvent(id: string, name: string, properties: Record<string, unknown>, tags: string[] = []): Entity {
  return {
    id, type: 'event', name, description: '', properties, tags,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  } as Entity
}

function setupPoints(events: Entity[], calendar = createSimpleCalendar()) {
  const calendars = ref([calendar, createThreeEraCalendar()])
  return useTimelinePoints({
    events: computed(() => events),
    calendars,
    activeCalendar: computed(() => calendar),
  })
}

describe('事件时间数据层', () => {
  it('按当前历法解析出标量，原文与格式化文本一致', () => {
    const events = [makeEvent('a', '甲', { date: '第三纪元147年' })]
    const { points } = setupPoints(events)
    const point = points.value.get('a')!
    expect(point.unresolved).toBe(false)
    expect(point.startScalar).toBe(20146)
    expect(point.text).toBe('第三纪元147年')
    expect(point.fuzzy).toBe(false)
  })

  it('其他历法事件标 foreign，并用自己的历法解析', () => {
    const events = [makeEvent('b', '乙', { date: '第二纪元5年', calendarId: 'three-era' })]
    const { points, foreignCount } = setupPoints(events)
    const point = points.value.get('b')!
    expect(point.foreign).toBe(true)
    expect(point.startScalar).toBe(1004)
    expect(foreignCount.value).toBe(1)
  })

  it('解析失败保留原文并标记未定时间', () => {
    const events = [makeEvent('c', '丙', { date: '很久以前' })]
    const { points } = setupPoints(events)
    const point = points.value.get('c')!
    expect(point.unresolved).toBe(true)
    expect(point.text).toBe('很久以前')
  })

  it('模糊限定词进入 fuzzy 与 certainty', () => {
    const events = [
      makeEvent('d', '丁', { date: '约 第三纪元147年' }),
      makeEvent('e', '戊', { date: '第三纪元148年', dateCertainty: 'before' }),
    ]
    const { points } = setupPoints(events)
    expect(points.value.get('d')).toMatchObject({ fuzzy: true, certainty: 'approx' })
    expect(points.value.get('e')).toMatchObject({ fuzzy: true, certainty: 'before' })
  })
})

describe('分组：单位 / 期段', () => {
  const events = [
    makeEvent('e1', '甲', { date: '第一纪元10年' }),
    makeEvent('e2', '乙', { date: '第三纪元147年' }),
    makeEvent('e3', '丙', { date: '第三纪元148年' }),
    makeEvent('e4', '丁', { date: '第二纪元5年', calendarId: 'three-era' }),
    makeEvent('e5', '戊', { date: '?' }),
  ]

  it('按顶层单位分组并按取值顺序排列，其他历法与未定时间尾置', () => {
    const calendar = createSimpleCalendar()
    const { points, runtime, periods } = setupPoints(events, calendar)
    const groups = buildGroups(events, 'unit:era', {
      calendar, runtime: runtime.value, points: points.value, periods: periods.value,
    })
    expect(groups.map(group => group.label)).toEqual(['第一纪元', '第三纪元', '其他历法', '未定时间'])
    expect(groups[0].events.map(event => event.id)).toEqual(['e1'])
    expect(groups[1].events.map(event => event.id)).toEqual(['e2', 'e3'])
  })

  it('按期段取最深包含区间，区间外归无期段', () => {
    const calendar = {
      ...createSimpleCalendar(),
      periods: [
        { id: 'p1', name: '大战', start: '第一纪元5年', end: '第一纪元20年' },
        { id: 'p2', name: '大战中期', start: '第一纪元8年', end: '第一纪元12年', parentId: 'p1' },
      ],
    }
    const inner = [makeEvent('x1', '战起', { date: '第一纪元10年' }), makeEvent('x2', '战外', { date: '第三纪元1年' })]
    const { points, runtime, periods } = setupPoints(inner, calendar)
    const groups = buildGroups(inner, 'period', {
      calendar, runtime: runtime.value, points: points.value, periods: periods.value,
    })
    // 嵌套期段只把事件归到最深一层，父段没有直属事件时不出现空组
    expect(groups.map(group => group.label)).toEqual(['大战中期', '无期段'])
    expect(groups[0].events.map(event => event.id)).toEqual(['x1'])
    expect(groups[1].events.map(event => event.id)).toEqual(['x2'])
    expect(periodOf(periods.value, points.value.get('x1')!.startScalar)!.id).toBe('p2')
  })
})

describe('分组树可见顺序（树态 + 分组同开）', () => {
  const calendar = createSimpleCalendar()
  const events = [
    makeEvent('r1', '根一', { date: '第一纪元10年' }),
    makeEvent('c1', '子一', { date: '第一纪元10年', parentId: 'r1' }),
    makeEvent('r2', '根二', { date: '第三纪元147年' }),
    makeEvent('c2', '子二', { date: '第三纪元147年', parentId: 'r2' }),
  ]

  function setup(groupMode: GroupMode, sortMode: 'chrono' | 'tree', relations: Relation[] = []) {
    const buckets = setupPoints(events, calendar)
    const tree = useEventTree(computed(() => events))
    const filtered = computed(() => tree.flatOrder.value)
    const groups = useTimelineGroups({
      verticalEvents: filtered, filteredEvents: filtered,
      points: buckets.points, calendar: computed(() => calendar),
      runtime: buckets.runtime, periods: buckets.periods,
      relations: computed(() => relations),
      entityMap: computed(() => new Map(events.map(event => [event.id, event]))),
      groupMode: ref(groupMode), tree, sortMode: ref(sortMode),
    })
    return { tree, groups, ids: () => groups.chronicleOrder.value.map(event => event.id) }
  }

  it('段由根事件归属决定，子事件跟随父链，顺序 = 段序 + 组内树序', () => {
    const { groups, ids } = setup('unit:era', 'tree')
    expect(groups.chronicleGroups.value.map(group => group.label)).toEqual(['第一纪元', '第三纪元'])
    expect(ids()).toEqual(['r1', 'c1', 'r2', 'c2'])
  })

  it('折叠父节点时整棵子树截断，被折叠节点自身仍在序列里', () => {
    const { tree, ids } = setup('unit:era', 'tree')
    tree.toggleCollapse('r1')
    expect(ids()).toEqual(['r1', 'r2', 'c2'])
  })

  it('时序态忽略折叠，返回全量筛选结果', () => {
    const { tree, ids } = setup('unit:era', 'chrono')
    tree.collapseAll()
    expect(ids()).toEqual(['r1', 'c1', 'r2', 'c2'])
  })

  it('同一事件被多个组收录时只计首次出现（导航不重复）', () => {
    const relations = [
      { id: 'x1', type: 'involves', sourceId: 'r1', targetId: 'ch1' },
      { id: 'x2', type: 'involves', sourceId: 'r1', targetId: 'ch2' },
    ] as Relation[]
    const { ids } = setup('character', 'tree', relations)
    expect(ids().filter(id => id === 'r1')).toHaveLength(1)
    expect(ids()).toEqual(['r1', 'c1', 'r2', 'c2'])
  })
})

describe('筛选', () => {
  const calendar = createSimpleCalendar()
  const events = [
    makeEvent('e1', '甲', { date: '第一纪元10年', importance: '关键' }),
    makeEvent('e2', '乙', { date: '第三纪元147年', importance: '重要' }),
  ]

  it('顶层单位筛选只保留该单位取值', () => {
    const { points, periods } = setupPoints(events, calendar)
    const sortedEvents = computed(() => events)
    const filters = useTimelineFilters(
      sortedEvents,
      { points, periods, calendar: computed(() => calendar), layoutMode: ref('vertical') },
      'none',
    )
    filters.unitFilter.value = '3'
    expect(filters.filteredEvents.value.map(event => event.id)).toEqual(['e2'])
    expect(filters.unitFilterOptions.value.map(option => option.label)).toEqual(['全部纪元', '第一纪元', '第三纪元'])
    expect(filters.groupModeOptions.value.map(option => option.value)).not.toContain('character')
    expect(filters.hiddenCount.value).toBe(1)
    filters.clearFilters()
    expect(filters.unitFilter.value).toBe('')
    expect(filters.hiddenCount.value).toBe(0)
  })

  it('期段筛选只保留区间内事件，旧 era 分组值映射到顶层单位', () => {
    const withPeriods = {
      ...calendar,
      periods: [{ id: 'p1', name: '大战', start: '第一纪元5年', end: '第一纪元20年' }],
    }
    const { points, periods } = setupPoints(events, withPeriods)
    const filters = useTimelineFilters(
      computed(() => events),
      { points, periods, calendar: computed(() => withPeriods), layoutMode: ref('horizontal') },
      'era',
    )
    expect(filters.groupMode.value).toBe('unit:era')
    filters.periodFilter.value = 'p1'
    expect(filters.filteredEvents.value.map(event => event.id)).toEqual(['e1'])
    expect(filters.groupModeOptions.value.map(option => option.value)).toContain('character')
  })
})

describe('冲突检测', () => {
  const relations = computed<Relation[]>(() => [
    { id: 'r1', type: 'involves', sourceId: 'e1', targetId: 'c1' },
    { id: 'r2', type: 'involves', sourceId: 'e2', targetId: 'c1' },
    { id: 'r3', type: 'involves', sourceId: 'e3', targetId: 'c1' },
    { id: 'r4', type: 'involves', sourceId: 'e4', targetId: 'c1' },
  ] as Relation[])

  it('精确同日算同日期冲突，范围重叠算重叠', () => {
    const events = [
      makeEvent('e1', '甲', { date: '第三纪元147年' }),
      makeEvent('e2', '乙', { date: '第三纪元147年' }),
      makeEvent('e3', '丙', { date: '第三纪元140年', dateEnd: '第三纪元150年' }),
      makeEvent('e4', '丁', { date: '第三纪元130年' }),
    ]
    const { points, runtime } = setupPoints(events)
    const entityMap = computed(() => new Map([
      ['c1', makeEvent('c1', '角色', {})],
      ['e1', events[0]], ['e2', events[1]], ['e3', events[2]], ['e4', events[3]],
    ]))
    const { conflicts, scanStats } = useConflictDetection(relations, entityMap, points, runtime)
    const sameDate = conflicts.value.find(item => item.type === 'same_date')
    const overlap = conflicts.value.find(item => item.type === 'overlap')
    expect(sameDate?.entities).toEqual(['甲', '乙'])
    expect(sameDate?.fuzzy).toBe(false)
    expect(overlap?.entities).toEqual(['甲', '丙'])
    // 检测范围：1 个角色 / 4 个关联事件，全部可比较
    expect(scanStats.value).toEqual({ characters: 1, events: 4, scannable: 4 })
  })

  it('模糊日期冲突带 fuzzy 标记并排在精确冲突之后', () => {
    const events = [
      makeEvent('e1', '甲', { date: '约 第三纪元147年' }),
      makeEvent('e4', '丁', { date: '第三纪元147年' }),
      makeEvent('e2', '乙', { date: '第三纪元147年' }),
      makeEvent('e3', '丙', { date: '第三纪元130年', dateEnd: '第三纪元150年' }),
    ]
    const { points, runtime } = setupPoints(events)
    const entityMap = computed(() => new Map([
      ['c1', makeEvent('c1', '角色', {})],
      ['e1', events[0]], ['e2', events[2]], ['e3', events[3]],
    ]))
    const { conflicts } = useConflictDetection(relations, entityMap, points, runtime)
    expect(conflicts.value.length).toBeGreaterThan(0)
    expect(conflicts.value[0].fuzzy).toBe(false)
    expect(conflicts.value.some(item => item.fuzzy)).toBe(true)
  })
})

describe('标尺：单位层级缩放', () => {
  const calendar = createSimpleCalendar()
  const runtime = computed(() => createCalendarRuntime(calendar))

  function makeScale() {
    return useTimelineScale({
      viewportWidth: computed(() => 600),
      runtime,
      events: ref([
        { startScalar: 10050, endScalar: 10100 },
        { startScalar: 20146, endScalar: 20146 },
      ]),
      bands: ref([]),
    })
  }

  it('适配态覆盖全部事件，标量/像素互逆', () => {
    const scale = makeScale()
    expect(scale.zoomLevel.value).toBe(0)
    expect(scale.timeRange.value.min).toBeLessThan(10050)
    expect(scale.timeRange.value.max).toBeGreaterThan(20146)
    const pixel = scale.scalarToPixel(15000)
    expect(scale.pixelToScalar(pixel)).toBeCloseTo(15000, 6)
    // 适配态跨一个多纪元：顶层级太稀，自动下探到年刻度并抽稀
    expect(scale.majorTicks.value.length).toBeGreaterThan(0)
    expect(scale.majorTicks.value.some(tick => tick.label.endsWith('年'))).toBe(true)
  })

  it('视口落在单个单位实例内部时仍有刻度（下探到更细层级）', () => {
    const scale = useTimelineScale({
      viewportWidth: computed(() => 600),
      runtime,
      events: ref([{ startScalar: 3000, endScalar: 8000 }]),
      bands: ref([]),
    })
    expect(scale.timeRange.value.max - scale.timeRange.value.min).toBeLessThan(10000)
    expect(scale.labelLevel.value).toBe(1)
    expect(scale.majorTicks.value.length).toBeGreaterThan(0)
    expect(scale.majorTicks.value.some(tick => tick.label.endsWith('年'))).toBe(true)
  })

  it('放大到年层级后主刻度按年边界，层级受单位链上限约束', () => {
    const scale = makeScale()
    scale.zoomIn()
    expect(scale.zoomLevel.value).toBe(1)
    expect(scale.labelLevel.value).toBe(1)
    expect(scale.majorTicks.value.some(tick => tick.label.endsWith('年'))).toBe(true)
    scale.zoomIn()
    scale.zoomIn()
    expect(scale.zoomLevel.value).toBe(scale.maxLevel.value)
    scale.fitAll()
    expect(scale.zoomLevel.value).toBe(0)
    expect(scale.scrollOffset.value).toBe(0)
  })

  it('色带按标量换算到视口坐标', () => {
    const scale = useTimelineScale({
      viewportWidth: computed(() => 600),
      runtime,
      events: ref([{ startScalar: 0, endScalar: 20000 }]),
      bands: ref([{ id: 'b', label: '第一纪元', start: 0, end: 10000, tone: 'base', depth: 0 }]),
    })
    const band = scale.pixelBands.value[0]
    expect(band.startX).toBeLessThan(band.endX)
    expect(band.tone).toBe('base')
  })
})

describe('排序', () => {
  it('按标量升序，其他历法与未定时间尾置', () => {
    const events = [
      makeEvent('late', '晚', { date: '第三纪元147年' }),
      makeEvent('early', '早', { date: '第一纪元10年' }),
      makeEvent('foreign', '外', { date: '第二纪元5年', calendarId: 'three-era' }),
      makeEvent('bad', '未定', { date: '?' }),
    ]
    const { points } = setupPoints(events)
    const { sortedEvents } = useTimelineSort(computed(() => events), computed(() => []), points)
    expect(sortedEvents.value.map(event => event.id)).toEqual(['early', 'late', 'foreign', 'bad'])
  })
})

describe('拖拽吸附', () => {
  const calendar = createSimpleCalendar()
  const ctx = { runtime: createCalendarRuntime(calendar), calendar, level: 1 }

  it('向下吸附到年边界，格式化保留该级精度', () => {
    const point = snapFloor(ctx, 20146.9)
    expect(point.values).toEqual([3, 147])
    expect(formatSnapped(ctx, point)).toBe('第三纪元147年')
  })

  it('向上吸附得到区间终点（下一单位边界）', () => {
    const point = snapCeil(ctx, 20146)
    expect(point.values).toEqual([3, 148])
    expect(formatSnapped(ctx, point)).toBe('第三纪元148年')
  })

  it('顶层吸附到纪元边界', () => {
    const top = { ...ctx, level: 0 }
    expect(formatSnapped(top, snapFloor(top, 20146))).toBe('第三纪元')
    expect(formatSnapped(top, snapCeil(top, 20146))).toBe('第四纪元')
  })

  it('吸附结果再解析回同一标量（往返）', () => {
    const point = snapFloor(ctx, 20146.9)
    expect(ctx.runtime.toScalar(point)).toBe(20146)
    expect(ctx.runtime.toScalar(snapCeil(ctx, 20146))).toBe(20147)
  })

  it('拖拽气泡按吸附单位显示起止', () => {
    const pointEvent = { raw: '第三纪元147年', range: false }
    const rangeEvent = { raw: '第三纪元147年', rawEnd: '第三纪元150年', range: true }
    expect(dragHintText(ctx, pointEvent, 'move', 20146, 20147, 0, ctx.runtime)).toBe('第三纪元147年')
    expect(dragHintText(ctx, rangeEvent, 'move', 20146, 20149, 0, ctx.runtime)).toBe('第三纪元147年 ~ 第三纪元150年')
    expect(dragHintText(ctx, rangeEvent, 'resize-start', 20146, 20149, 0, ctx.runtime)).toBe('第三纪元147年 ~ 第三纪元150年')
    expect(dragHintText(ctx, rangeEvent, 'resize-end', 20146, 20146, 0, ctx.runtime)).toBe('第三纪元147年 ~ 第三纪元148年')
  })
})
