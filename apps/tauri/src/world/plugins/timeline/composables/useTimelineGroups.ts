/** 视图分组派生：两态的分组输入不同（画布剔除其他历法事件，编年史保留尾组）。 */
import { computed, type ComputedRef, type Ref } from 'vue'
import type { Entity, Relation } from '@worldsea/entity-core'
import type { Calendar } from '../calendar/types'
import type { CalendarRuntime } from '../calendar/math'
import type { EventTime, PeriodBand } from './useTimelinePoints'
import type { TreeNode } from './useEventTree'
import { buildGroups, type GroupMode, type TimelineGroup } from './timelineGroups'

/** 大纲树输入（接受 Ref 或裸值，与视图面板的 tree 透传同口径） */
export interface ChronicleTree {
  roots: { value: TreeNode[] } | TreeNode[]
  collapsedSet: { value: Set<string> } | Set<string>
}

export interface TimelineGroupsOptions {
  /** 编年史数据源（时序表已分页） */
  verticalEvents: ComputedRef<Entity[]>
  filteredEvents: ComputedRef<Entity[]>
  points: Ref<Map<string, EventTime>>
  calendar: Ref<Calendar>
  runtime: Ref<CalendarRuntime>
  periods: Ref<PeriodBand[]>
  relations: ComputedRef<Relation[]>
  entityMap: ComputedRef<Map<string, Entity>>
  groupMode: Ref<GroupMode>
  /** 大纲树：树态可见顺序需要层级与折叠状态 */
  tree?: ChronicleTree
  /** 排序形态：tree 时才产出 chronicleOrder */
  sortMode?: Ref<'chrono' | 'tree'>
}

function unwrapNodes(source: { value: TreeNode[] } | TreeNode[]): TreeNode[] {
  return Array.isArray(source) ? source : source.value
}

function unwrapIds(source: { value: Set<string> } | Set<string>): Set<string> {
  return source instanceof Set ? source : source.value
}

export function useTimelineGroups(options: TimelineGroupsOptions) {
  const context = computed(() => ({
    calendar: options.calendar.value,
    runtime: options.runtime.value,
    points: options.points.value,
    periods: options.periods.value,
    relations: options.relations.value,
    entityMap: options.entityMap.value,
  }))

  const canvasEvents = computed(() =>
    options.filteredEvents.value.filter(event => !options.points.value.get(event.id)?.foreign),
  )

  const chronicleGroups = computed<TimelineGroup[]>(() => {
    const mode = options.groupMode.value
    if (mode !== 'none') return buildGroups(options.verticalEvents.value, mode, context.value)
    // 无分组时也把其他历法事件单列尾组，避免混进当前历法的时间序列
    const foreignIds = new Set(
      options.verticalEvents.value
        .filter(event => options.points.value.get(event.id)?.foreign)
        .map(event => event.id),
    )
    if (!foreignIds.size) return buildGroups(options.verticalEvents.value, 'none', context.value)
    return [
      { id: 'all', label: '', events: options.verticalEvents.value.filter(event => !foreignIds.has(event.id)) },
      { id: 'tail:foreign', label: '其他历法', events: options.verticalEvents.value.filter(event => foreignIds.has(event.id)) },
    ]
  })

  const canvasGroups = computed<TimelineGroup[]>(() =>
    buildGroups(canvasEvents.value, options.groupMode.value, context.value),
  )

  /**
   * 树态可见顺序：分组顺序 → 组内根事件树序 → 子树展开（折叠处截断）；
   * 多组归属的同一事件只计首次出现，保证邻接导航不重复指向同一事件。
   * 口径详见 docs/details/注释/apps/tauri/world/timeline-calendar.md
   */
  const chronicleOrder = computed<Entity[]>(() => {
    const tree = options.tree
    if (options.sortMode?.value !== 'tree' || !tree) return options.filteredEvents.value
    const roots = unwrapNodes(tree.roots)
    const collapsed = unwrapIds(tree.collapsedSet)
    const order: Entity[] = []
    const seen = new Set<string>()
    const push = (node: TreeNode) => {
      if (seen.has(node.entity.id)) return
      seen.add(node.entity.id)
      order.push(node.entity)
      if (collapsed.has(node.entity.id)) return
      for (const child of node.children) push(child)
    }
    for (const group of chronicleGroups.value) {
      const ids = new Set(group.events.map(event => event.id))
      for (const root of roots) if (ids.has(root.entity.id)) push(root)
    }
    return order
  })

  return { canvasEvents, chronicleGroups, canvasGroups, chronicleOrder }
}
