<template>
  <div class="timeline-canvas">
    <div class="axis-row">
      <div class="side-spacer"></div>
      <TimelineAxis
        :width="viewportWidth"
        :major-ticks="scale.majorTicks.value"
        :minor-ticks="scale.minorTicks.value"
        :bands="scale.pixelBands.value"
        @pan-start="pan.startPan($event.clientX)"
      />
      <TimelineAxisNotes :events="allEvents" :points="points" :calendar="calendar" :calendars="calendars" @select-event="$emit('selectEvent', $event)" />
    </div>

    <div class="canvas-body" ref="bodyEl" @wheel="onWheel" @mousedown="drag.onPointerDown" @focusin="onFocusIn">
      <div v-for="lane in lanes" :key="lane.id" class="lane-row" :style="{ height: lane.height + 'px' }">
        <div class="lane-side">
          <TimelineSwimlaneHeader :lane="lane" @toggle-collapse="toggleCollapse" />
        </div>
        <div class="lane-track">
          <template v-for="item in lane.items" :key="item.key">
            <EventBar
              v-if="isRangeItem(item)"
              :event="item.event"
              :data-event-id="item.event.id"
              :pixel-x="itemX(item)"
              :pixel-width="itemWidth(item)"
              :pixel-y="itemY(item)"
              :is-selected="selectedEventId === item.event.id || selectedIds.has(item.event.id)"
              :peer="peerIds?.has(item.event.id)"
              :is-dragging="drag.activeId.value === item.event.id"
              :draggable="dragEnabled === true"
              :child-count="0"
              :fuzzy="pointOf(item)?.fuzzy"
              :certainty-label="certaintyLabel(item)"
              :cycle="!!item.event.properties?.recurrence"
              @select="onItemSelect(item.event)"
            />
            <EventMarker
              v-else
              :event="item.event"
              :data-event-id="item.event.id"
              :data-occurrence="item.occurrenceText ? '1' : undefined"
              :pixel-x="itemX(item)"
              :pixel-y="itemY(item)"
              :is-selected="selectedEventId === item.event.id || selectedIds.has(item.event.id)"
              :peer="peerIds?.has(item.event.id)"
              :display-text="item.occurrenceText"
              :fuzzy="pointOf(item)?.fuzzy"
              :occurrence="!!item.occurrenceText"
              @select="onItemSelect(item.event)"
            />
          </template>
        </div>
      </div>

      <div v-if="drag.hint.value" class="drag-hint" :style="{ left: drag.hint.value.left + 'px', top: drag.hint.value.top + 'px' }">{{ drag.hint.value.text }}</div>
      <div v-if="drag.ghost.value" class="drag-ghost" :style="rectStyle(drag.ghost.value)"></div>
      <div v-if="drag.marquee.value" class="drag-marquee" :style="rectStyle(drag.marquee.value)"></div>

      <div v-if="lanes.length === 0" class="canvas-empty">当前分组下没有可上轴的事件</div>
    </div>

    <div class="minimap-row">
      <div class="side-spacer"></div>
      <TimelineMinimap
        :width="viewportWidth"
        :total-width="scale.totalWidth.value"
        :scroll-offset="scale.scrollOffset.value"
        :viewport-width="viewportWidth"
        :event-positions="minimapPositions"
        @pan-to="scale.setScrollOffset($event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useEntityStore } from '@worldsea/entity-core'
import type { Entity } from '@worldsea/entity-core'
import type { Calendar } from '../calendar/types'
import type { CalendarRuntime } from '../calendar/math'
import type { AxisBand, EventTime } from '../composables/useTimelinePoints'
import type { TimelineGroup } from '../composables/timelineGroups'
import { useTimelineScale } from '../composables/useTimelineScale'
import { useTimelineOccurrences } from '../composables/useTimelineOccurrences'
import { useTimelinePan } from '../composables/useTimelinePan'
import {
  LANE_HEADER_HEIGHT, ROW_HEIGHT, useSwimlaneLayout, type LaneItem,
} from '../composables/useSwimlaneLayout'
import { rectsIntersect, useTimelineCanvasDrag, type CanvasCreatePreset } from '../composables/useTimelineCanvasDrag'

import TimelineAxis from './TimelineAxis.vue'
import TimelineAxisNotes from './TimelineAxisNotes.vue'
import TimelineMinimap from './TimelineMinimap.vue'
import TimelineSwimlaneHeader from './TimelineSwimlaneHeader.vue'
import EventBar from './EventBar.vue'
import EventMarker from './EventMarker.vue'

const SIDEBAR_WIDTH = 160

const props = defineProps<{
  /** 已过滤、且属于当前历法的事件 */
  events: Entity[]
  /** 筛选后的全部事件（含其他历法与未定时间，供轴角标清单） */
  allEvents: Entity[]
  points: Map<string, EventTime>
  runtime: CalendarRuntime
  calendar: Calendar
  calendars: Calendar[]
  groups: TimelineGroup[]
  bands: AxisBand[]
  selectedEventId: string | null
  selectedIds: Set<string>
  /** 冲突对位高亮（只加环不选中） */
  peerIds?: Set<string>
  batchMode?: boolean
  /** 「拖拽改时间」设置：关闭时事件条不可移动/拉伸 */
  dragEnabled?: boolean
}>()

const emit = defineEmits<{
  selectEvent: [event: Entity]
  toggleSelect: [id: string]
  selectEvents: [ids: string[]]
  createEvent: [preset: CanvasCreatePreset]
}>()

const entityStore = useEntityStore()
const bodyEl = ref<HTMLDivElement>()
const viewportWidth = ref(800)

const scaleEvents = computed(() =>
  props.events
    .map(event => props.points.get(event.id))
    .filter((point): point is EventTime => !!point && !point.foreign && !point.unresolved)
    .map(point => ({ startScalar: point.startScalar, endScalar: point.endScalar })),
)

const scale = useTimelineScale({
  viewportWidth: computed(() => viewportWidth.value),
  runtime: computed(() => props.runtime),
  events: scaleEvents,
  bands: computed(() => props.bands),
})

const occurrenceMarkers = useTimelineOccurrences({
  events: computed(() => props.events),
  points: computed(() => props.points),
  runtime: computed(() => props.runtime),
  calendar: computed(() => props.calendar),
  window: scale.visible,
})

const swimlaneLayout = useSwimlaneLayout({
  groups: computed(() => props.groups),
  points: computed(() => props.points),
  occurrences: occurrenceMarkers,
})
const lanes = swimlaneLayout.lanes
const toggleCollapse = swimlaneLayout.toggleCollapse

const laneOffsets = computed(() => {
  let top = 0
  return lanes.value.map(lane => {
    const entry = { id: lane.id, top }
    top += lane.height
    return entry
  })
})

const pan = useTimelinePan({ scrollOffset: scale.scrollOffset, setScrollOffset: scale.setScrollOffset })

const drag = useTimelineCanvasDrag({
  bodyEl,
  runtime: computed(() => props.runtime),
  calendar: computed(() => props.calendar),
  labelLevel: scale.labelLevel,
  pixelsPerBase: scale.pixelsPerBase,
  scrollOffset: scale.scrollOffset,
  pixelToScalar: scale.pixelToScalar,
  setScrollOffset: scale.setScrollOffset,
  sidebarWidth: SIDEBAR_WIDTH,
  dragEnabled: computed(() => props.dragEnabled === true),
  batchMode: computed(() => props.batchMode === true),
  points: computed(() => props.points),
  eventOf: id => props.events.find(event => event.id === id),
  update: (id, changes) => entityStore.update(id, changes),
  onCreate: preset => emit('createEvent', preset),
  onSelectMany: ids => emit('selectEvents', ids),
  onPanStart: pan.startPan,
  selectInRect,
})

function selectInRect(rect: { left: number; top: number; right: number; bottom: number }): string[] {
  const ids = new Set<string>()
  lanes.value.forEach((lane, index) => {
    const top = laneOffsets.value[index]?.top ?? 0
    for (const item of lane.items) {
      const left = scale.scalarToPixel(item.startScalar) + SIDEBAR_WIDTH
      const width = item.occurrenceText ? 24 : Math.max(24, (item.endScalar - item.startScalar) * scale.pixelsPerBase.value)
      const y = top + LANE_HEADER_HEIGHT + item.row * ROW_HEIGHT
      if (rectsIntersect(rect, { left, right: left + width, top: y, bottom: y + 28 })) ids.add(item.event.id)
    }
  })
  return [...ids]
}

function pointOf(item: LaneItem): EventTime | undefined {
  return props.points.get(item.event.id)
}

function isRangeItem(item: LaneItem): boolean {
  return !item.occurrenceText && !!pointOf(item)?.range
}

const itemStart = (item: LaneItem) => drag.previewStart.value.get(item.event.id) ?? item.startScalar
const itemEnd = (item: LaneItem) => drag.previewEnd.value.get(item.event.id) ?? item.endScalar
function itemX(item: LaneItem): number {
  return scale.scalarToPixel(itemStart(item))
}

function itemWidth(item: LaneItem): number {
  if (item.occurrenceText || !isRangeItem(item)) return 24
  return Math.max(24, (itemEnd(item) - itemStart(item)) * scale.pixelsPerBase.value)
}

function itemY(item: LaneItem): number {
  return LANE_HEADER_HEIGHT + item.row * ROW_HEIGHT
}

const CERTAINTY_TEXT: Record<string, string> = { approx: '约', before: '早于', after: '晚于', legend: '传说' }
function certaintyLabel(item: LaneItem): string {
  const point = pointOf(item)
  return point && point.certainty !== 'exact' ? CERTAINTY_TEXT[point.certainty] ?? '' : ''
}
function rectStyle(rect: { left: number; top: number; width: number; height: number }) {
  return { left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px' }
}
/** 批量态：点击事件条/点路由到选中切换；浏览态打开详情（拖拽后的 click 被吞掉） */
function onItemSelect(event: Entity) {
  if (drag.clickSuppressed.value) return
  if (props.batchMode) emit('toggleSelect', event.id)
  else emit('selectEvent', event)
}

const minimapPositions = computed(() => {
  const result: { x: number; width: number }[] = []
  for (const group of props.groups) {
    for (const event of group.events) {
      const point = props.points.get(event.id)
      if (!point || point.foreign || point.unresolved) continue
      const x = scale.scalarToContentX(point.startScalar)
      result.push({ x, width: Math.max(2, scale.scalarToContentX(point.endScalar) - x) })
    }
  }
  return result
})

/* 滚轮：Ctrl/⌘ 缩放、Shift 横向平移；其余交给浏览器纵向滚动泳道 */
function onWheel(event: WheelEvent) {
  if (!event.ctrlKey && !event.metaKey && !event.shiftKey) return
  event.preventDefault()
  if (event.shiftKey && !event.ctrlKey && !event.metaKey) scale.panBy(event.deltaY)
  else if (event.deltaY < 0) scale.zoomIn()
  else scale.zoomOut()
}

/** 键盘焦点移到视口外的事件时，把画布平移到它 */
function onFocusIn(event: FocusEvent) {
  const target = event.target as HTMLElement
  const id = target.closest<HTMLElement>('[data-event-id]')?.dataset.eventId
  if (!id) return
  const point = props.points.get(id)
  if (!point || !Number.isFinite(point.startScalar)) return
  const x = scale.scalarToPixel(point.startScalar)
  if (x < 24 || x > viewportWidth.value - 24) scale.panToScalar(point.startScalar)
}

/** 选中聚焦/冲突跳转：把事件平移到视口中心 */
function focusEvent(id: string) {
  const point = props.points.get(id)
  if (!point || !Number.isFinite(point.startScalar)) return
  scale.panToScalar(point.startScalar)
}

let resizeObserver: ResizeObserver | null = null
/** 切项目：数据与历法整体换源，标尺回到适配全部，避免停在旧项目的缩放位置 */
const onProjectSwitch = () => scale.fitAll()
onMounted(() => {
  if (!bodyEl.value) return
  viewportWidth.value = Math.max(0, bodyEl.value.clientWidth - SIDEBAR_WIDTH)
  resizeObserver = new ResizeObserver(() => {
    if (bodyEl.value) viewportWidth.value = Math.max(0, bodyEl.value.clientWidth - SIDEBAR_WIDTH)
  })
  resizeObserver.observe(bodyEl.value)
  window.addEventListener('project:switched', onProjectSwitch)
})
onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  window.removeEventListener('project:switched', onProjectSwitch)
})

defineExpose({
  zoomIn: () => scale.zoomIn(),
  zoomOut: () => scale.zoomOut(),
  fitAll: () => scale.fitAll(),
  focusEvent,
})
</script>

<style scoped>
.timeline-canvas {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}

.axis-row {
  display: flex;
  flex-shrink: 0;
  position: relative;
}
.side-spacer { width: 160px; flex-shrink: 0; }

.canvas-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  position: relative;
}
.lane-row {
  display: flex;
  border-bottom: 1px solid var(--border-color);
  box-sizing: border-box;
}
.lane-side {
  width: 160px;
  flex-shrink: 0;
  position: sticky;
  left: 0;
  z-index: 4;
  background: var(--content-bg, var(--card-bg));
  border-right: 1px solid var(--border-color);
  box-sizing: border-box;
}
.lane-track {
  position: relative;
  flex: 1;
  min-width: 0;
  cursor: crosshair;
}
.canvas-empty {
  padding: 32px;
  text-align: center;
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
}

/* 创建区间 / 框选 / 拖拽日期气泡（随内容滚动） */
.drag-ghost,
.drag-marquee,
.drag-hint {
  position: absolute;
  z-index: 6;
  pointer-events: none;
}
.drag-ghost,
.drag-marquee { border-radius: var(--radius-xs); }
.drag-ghost {
  background: color-mix(in srgb, var(--primary) 12%, transparent);
  border: 1px dashed var(--primary);
}
.drag-marquee {
  background: color-mix(in srgb, var(--primary) 8%, transparent);
  border: 1px solid var(--primary);
}
.drag-hint {
  padding: 3px 8px;
  font-size: var(--font-size-xs);
  color: var(--text-color);
  background: var(--card-bg);
  border: 1px solid var(--primary);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-dropdown);
  white-space: nowrap;
}

.minimap-row {
  display: flex;
  flex-shrink: 0;
}
</style>
