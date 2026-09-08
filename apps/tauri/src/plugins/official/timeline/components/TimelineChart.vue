<template>
  <div class="timeline-chart" ref="chartContainer">
    <template v-if="layoutMode === 'horizontal'">
      <TimelineAxis
        :width="containerWidth"
        :major-ticks="scaleMajorTicks"
        :minor-ticks="scaleMinorTicks"
        :zoom-level="scaleZoomLevel"
        :scroll-offset="scaleScrollOffset"
        :era-colors="eraColorBands"
      />

      <div class="horizontal-body" @wheel.prevent="onWheel" @mousedown="onPanStart">
        <div class="swimlane-sidebar">
          <TimelineSwimlaneHeader
            v-for="lane in swimlaneLayout.lanes.value"
            :key="lane.id"
            :lane="lane"
            @toggle-collapse="swimlaneLayout.toggleLaneCollapse"
          />
        </div>

        <div class="horizontal-events" :style="{ width: containerWidth + 'px' }">
          <TimelineSwimlane
            v-for="lane in swimlaneLayout.lanes.value"
            :key="lane.id"
            :lane="lane"
            @toggle-collapse="swimlaneLayout.toggleLaneCollapse"
          >
            <template v-for="event in lane.events" :key="event.id">
              <EventBar
                v-if="isRangeEvent(event)"
                :event="event"
                :pixel-x="getEventX(event)"
                :pixel-width="getEventWidth(event)"
                :pixel-y="getEventY(event)"
                :is-selected="selectedEventId === event.id"
                :is-dragging="dragIsDragging && dragDragTarget === event.id"
                :child-count="0"
                @select="$emit('selectEvent', event)"
              />
              <EventMarker
                v-else
                :event="event"
                :pixel-x="getEventX(event)"
                :pixel-y="getEventY(event)"
                :is-selected="selectedEventId === event.id"
                @select="$emit('selectEvent', event)"
              />
            </template>
          </TimelineSwimlane>
        </div>
      </div>

      <TimelineMinimap
        :width="containerWidth"
        :total-width="scaleTotalWidth"
        :scroll-offset="scaleScrollOffset"
        :viewport-width="containerWidth"
        :event-positions="eventPositions"
        @pan-to="scale.scrollOffset.value = $event"
      />
    </template>

    <template v-else>
      <div class="vertical-body" :class="{ 'is-empty': events.length === 0 && !loading }">
        <div class="timeline-line"></div>

        <template v-for="group in eraGroups" :key="group.era">
          <div class="era-header">
            <span class="era-label">{{ group.era }}</span>
            <span class="era-range">{{ group.range }}</span>
          </div>

          <template v-if="sortMode === 'tree'">
            <template v-for="(rootNode, idx) in getRootNodesForGroup(group)" :key="rootNode.entity.id">
              <TreeNode
                :node="rootNode"
                :depth="0"
                :is-last="idx === getRootNodesForGroup(group).length - 1"
                :collapsed-set="treeCollapsedSet"
                :selected-event-id="selectedEventId"
                :selected-ids="selectedIds"
                :compact="compactMode"
                :parent-names="[]"
                @select="(e: Entity) => $emit('selectEvent', e)"
                @toggle-select="(id: string) => $emit('toggleSelect', id)"
                @toggle-collapse="tree.toggleCollapse"
              />
            </template>
          </template>

          <template v-else>
            <div v-for="event in group.events" :key="event.id" class="chrono-item">
              <span class="chrono-dot" :class="getImportanceClass(event)"></span>
              <EventCard
                :event="event"
                :highlighted="selectedEventId === event.id"
                :batch-selected="selectedIds.has(event.id)"
                :compact="compactMode"
                @select="$emit('selectEvent', event)"
                @toggle-select="$emit('toggleSelect', event.id)"
              />
            </div>
          </template>
        </template>

        <WsEmpty v-if="events.length === 0 && !loading" preset="no-data" description="还没有事件，点击上方按钮创建" />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { WsEmpty } from '@worldsea/ui-kit'
import type { Entity } from '@worldsea/entity-core'
import type { ParsedDate, EraInfo } from '../composables/useDateParser'
import type { TreeNode as TreeNodeType } from '../composables/useEventTree'
import { useTimelineScale } from '../composables/useTimelineScale'
import { useSwimlaneLayout } from '../composables/useSwimlaneLayout'

import TimelineAxis from './TimelineAxis.vue'
import TimelineMinimap from './TimelineMinimap.vue'
import TimelineSwimlane from './TimelineSwimlane.vue'
import TimelineSwimlaneHeader from './TimelineSwimlaneHeader.vue'
import EventBar from './EventBar.vue'
import EventMarker from './EventMarker.vue'
import EventCard from './EventCard.vue'
import TreeNode from './TreeNode.vue'

const props = defineProps<{
  events: Entity[]
  parsedDates: Map<string, ParsedDate | null>
  depthMap: Map<string, number>
  selectedEventId: string | null
  selectedIds: Set<string>
  loading: boolean
  eras: EraInfo[]
  layoutMode: 'horizontal' | 'vertical'
  compactMode: boolean
  sortMode: 'chrono' | 'tree'
  tree: {
    roots: { value: TreeNodeType[] }
    collapsedSet: { value: Set<string> }
    toggleCollapse: (id: string) => void
    visibleFlatOrder: { value: Entity[] }
  }
  drag: {
    isDragging: { value: boolean }
    dragTarget: { value: string | null }
  }
  relations: { value: import('@worldsea/entity-core').Relation[] }
  entityMap: { value: Map<string, Entity> }
  groupMode: string
}>()

defineEmits<{
  selectEvent: [event: Entity]
  toggleSelect: [id: string]
}>()

const chartContainer = ref<HTMLDivElement>()
const containerWidth = ref(800)

const treeRoots = computed(() => props.tree.roots.value ?? props.tree.roots)
const treeCollapsedSet = computed(() => props.tree.collapsedSet.value ?? props.tree.collapsedSet)
const dragIsDragging = computed(() => props.drag.isDragging.value ?? props.drag.isDragging)
const dragDragTarget = computed(() => props.drag.dragTarget.value ?? props.drag.dragTarget)
const relationsList = computed(() => props.relations.value ?? props.relations)
const entityMapRef = computed(() => props.entityMap.value ?? props.entityMap)

const scaleMajorTicks = computed(() => scale.majorTicks.value)
const scaleMinorTicks = computed(() => scale.minorTicks.value)
const scaleZoomLevel = computed(() => scale.zoomLevel.value)
const scaleScrollOffset = computed(() => scale.scrollOffset.value)
const scaleTotalWidth = computed(() => scale.totalWidth.value)

const scaleEvents = computed(() =>
  props.events.map(e => ({
    id: e.id,
    parsedDate: props.parsedDates.get(e.id) ?? null,
  }))
)

const scale = useTimelineScale({
  containerWidth,
  events: scaleEvents,
})

const swimlaneLayout = useSwimlaneLayout({
  events: computed(() => props.events),
  relations: relationsList,
  entityMap: entityMapRef,
  pixelsPerYear: scale.pixelsPerYear,
  timeToPixel: scale.timeToPixel,
  timeToTimeValue: scale.timeToTimeValue,
})

watch(() => props.groupMode, (mode) => {
  swimlaneLayout.setGroupMode(mode as import('../composables/useSwimlaneLayout').GroupMode)
}, { immediate: true })

const eraColorBands = computed(() =>
  props.eras.map(era => ({
    name: era.name,
    color: 'var(--primary-light)',
    startX: scale.timeToPixelFromValue(era.startYear),
    endX: scale.timeToPixelFromValue(era.endYear),
  }))
)

const eventPositions = computed(() =>
  props.events.map(e => {
    const pd = props.parsedDates.get(e.id)
    if (!pd) return { x: 0, width: 0 }
    const x = scale.timeToPixel(pd)
    const isRange = pd.isRange && pd.yearEnd != null
    const width = isRange
      ? scale.timeToPixel({ ...pd, year: pd.yearEnd ?? pd.year, era: pd.eraEnd ?? pd.era }) - x
      : 24
    return { x, width: Math.max(2, width) }
  })
)

function isRangeEvent(event: Entity): boolean {
  return !!(event.properties.dateEnd as string)
}

function getImportanceClass(event: Entity): string {
  const imp = event.properties.importance as string
  return imp === '关键' ? 'dot-critical' : imp === '重要' ? 'dot-important' : imp === '细微' ? 'dot-minor' : 'dot-normal'
}

function getEventX(event: Entity): number {
  const pd = props.parsedDates.get(event.id)
  return pd ? scale.timeToPixel(pd) : 0
}

function getEventWidth(event: Entity): number {
  const pd = props.parsedDates.get(event.id)
  if (!pd || !pd.isRange || pd.yearEnd == null) return 24
  const endPd: ParsedDate = { ...pd, year: pd.yearEnd, era: pd.eraEnd ?? pd.era }
  return Math.max(24, scale.timeToPixel(endPd) - scale.timeToPixel(pd))
}

function getEventY(event: Entity): number {
  const assignment = swimlaneLayout.rowAssignments.value.get(event.id)
  return assignment?.pixelY ?? 0
}

const eraGroups = computed(() => {
  if (props.eras.length === 0) {
    return [{ era: '', range: '', events: props.events }]
  }
  const eraSet = new Set(props.eras.map(e => e.name))
  const groups: { era: string; range: string; events: Entity[] }[] = []
  for (const era of props.eras) {
    groups.push({ era: era.name, range: `${era.startYear} ~ ${era.endYear}`, events: [] })
  }
  const noEraGroup = { era: '未知纪元', range: '', events: [] as Entity[] }
  let hasNoEra = false
  for (const event of props.events) {
    const eraText = (event.properties.era as string) || ''
    const eraName = eraText || '未知纪元'
    if (eraSet.has(eraName)) {
      const group = groups.find(g => g.era === eraName)
      if (group) group.events.push(event)
    } else {
      noEraGroup.events.push(event)
      hasNoEra = true
    }
  }
  const result = groups.filter(g => g.events.length > 0)
  if (hasNoEra) result.push(noEraGroup)
  return result
})

function getRootNodesForGroup(group: { events: Entity[] }): TreeNodeType[] {
  const eventIds = new Set(group.events.map(e => e.id))
  return treeRoots.value.filter(n => eventIds.has(n.entity.id))
}

function onWheel(e: WheelEvent) {
  if (e.ctrlKey || e.metaKey) {
    if (e.deltaY < 0) scale.zoomIn()
    else scale.zoomOut()
  } else {
    scale.panBy(-e.deltaX || -e.deltaY)
  }
}

let panStartX = 0
let panStartOffset = 0
function onPanStart(e: MouseEvent) {
  panStartX = e.clientX
  panStartOffset = scale.scrollOffset.value
  const onMove = (ev: MouseEvent) => {
    const maxOffset = Math.max(0, scale.totalWidth.value - containerWidth.value)
    scale.scrollOffset.value = Math.max(0, Math.min(maxOffset, panStartOffset - (ev.clientX - panStartX)))
  }
  const onUp = () => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

let resizeObserver: ResizeObserver | null = null
onMounted(() => {
  if (chartContainer.value) {
    containerWidth.value = chartContainer.value.clientWidth
    resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        containerWidth.value = entry.contentRect.width
      }
    })
    resizeObserver.observe(chartContainer.value)
  }
})
onBeforeUnmount(() => resizeObserver?.disconnect())
</script>

<style scoped>
.timeline-chart {
  flex: 1;
  overflow: hidden;
  position: relative;
  display: flex;
  flex-direction: column;
}

.horizontal-body {
  flex: 1;
  display: flex;
  overflow: hidden;
  position: relative;
}
.swimlane-sidebar {
  width: 160px;
  flex-shrink: 0;
  overflow-y: auto;
  border-right: 1px solid var(--border-color);
  padding: 4px;
}
.horizontal-events {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  position: relative;
}

.vertical-body {
  flex: 1;
  overflow-y: auto;
  position: relative;
  padding: 10px 0 10px 20px;
}

/* 空事件状态：提示语在视图区域内垂直+水平居中 */
.vertical-body.is-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  padding-left: 0;
}

.timeline-line {
  position: absolute;
  left: 28px;
  top: 0;
  bottom: 0;
  width: 2px;
  background: linear-gradient(to bottom, var(--primary-light), var(--primary), var(--primary-light));
}

.era-header {
  position: relative;
  padding: 16px 0 8px 30px;
  display: flex;
  align-items: baseline;
  gap: 12px;
}
.era-header::before {
  content: '';
  position: absolute;
  left: 18px;
  top: 50%;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--primary);
  border: 3px solid var(--primary-light);
  transform: translate(-11px, -50%);
  z-index: 1;
}
.era-label {
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-bold);
  color: var(--primary);
}
.era-range {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
}

.chrono-item {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 4px 0 4px 30px;
}
.chrono-dot {
  position: absolute;
  left: 22px;
  top: 14px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid;
  flex-shrink: 0;
  z-index: 1;
}
.dot-critical { background: var(--danger); border-color: var(--danger); }
.dot-important { background: var(--warning); border-color: var(--warning); }
.dot-normal { background: var(--primary); border-color: var(--primary); }
.dot-minor { background: var(--text-tertiary); border-color: var(--text-tertiary); }
</style>
