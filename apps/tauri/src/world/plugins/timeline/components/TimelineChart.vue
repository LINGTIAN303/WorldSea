<template>
  <div class="timeline-chart" @contextmenu="onContextMenu">
    <div v-if="loading" class="timeline-skeleton" role="status" aria-label="正在载入时间线">
      <WsSkeleton
        v-for="n in 8"
        :key="n"
        variant="text"
        :lines="1"
        :style="{ width: `${70 + (n % 3) * 10}%` }"
        :aria-hidden="n > 1 || undefined"
      />
    </div>

    <WsEmpty
      v-else-if="events.length === 0 && loaded"
      title="暂无事件"
      description="点击上方按钮创建第一个事件"
    >
      <template #icon><WsIcon name="timeline" size="xl" /></template>
    </WsEmpty>

    <TimelineChronicle
      v-else-if="layoutMode === 'vertical'"
      :groups="chronicleGroups"
      :sort-mode="sortMode"
      :tree="tree"
      :compact-mode="compactMode"
      :selected-event-id="selectedEventId"
      :selected-ids="selectedIds"
      :batch-mode="batchMode"
      @select-event="$emit('selectEvent', $event)"
      @toggle-select="$emit('toggleSelect', $event)"
    />

    <TimelineCanvas
      v-else
      ref="canvasRef"
      :events="canvasEvents"
      :all-events="events"
      :points="points"
      :runtime="runtime"
      :calendar="calendar"
      :calendars="calendars"
      :groups="canvasGroups"
      :bands="bands"
      :selected-event-id="selectedEventId"
      :selected-ids="selectedIds"
      :batch-mode="batchMode"
      :drag-enabled="dragEnabled"
      @select-event="$emit('selectEvent', $event)"
      @toggle-select="$emit('toggleSelect', $event)"
      @select-events="$emit('selectEvents', $event)"
      @create-event="$emit('createEvent', $event)"
    />

    <TimelineEventMenu
      v-if="menu"
      :x="menu.x"
      :y="menu.y"
      :name="menu.event.name"
      :focus-label="layoutMode === 'vertical' ? '在画布中查看' : '在编年史中查看'"
      @pick="pickMenu"
      @close="closeMenu"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { WsEmpty, WsIcon, WsSkeleton } from '@worldsea/ui-kit'
import type { Entity } from '@worldsea/entity-core'
import type { Calendar } from '../calendar/types'
import type { CalendarRuntime } from '../calendar/math'
import type { AxisBand, EventTime } from '../composables/useTimelinePoints'
import type { TimelineGroup } from '../composables/timelineGroups'
import type { CanvasCreatePreset } from '../composables/useTimelineCanvasDrag'
import type { TreeNode as TreeNodeType } from '../composables/useEventTree'
import { useTimelineEventMenu, type TimelineEventAction } from '../composables/useTimelineEventMenu'

import TimelineCanvas from './TimelineCanvas.vue'
import TimelineChronicle from './TimelineChronicle.vue'
import TimelineEventMenu from './TimelineEventMenu.vue'

const props = defineProps<{
  /** 筛选后的事件（判定空态用） */
  events: Entity[]
  /** 已排除其他历法、可上轴的事件 */
  canvasEvents: Entity[]
  points: Map<string, EventTime>
  runtime: CalendarRuntime
  calendar: Calendar
  calendars: Calendar[]
  canvasGroups: TimelineGroup[]
  chronicleGroups: TimelineGroup[]
  bands: AxisBand[]
  selectedEventId: string | null
  selectedIds: Set<string>
  batchMode?: boolean
  loading: boolean
  loaded: boolean
  layoutMode: 'horizontal' | 'vertical'
  compactMode: boolean
  sortMode: 'chrono' | 'tree'
  tree: {
    roots: { value: TreeNodeType[] } | TreeNodeType[]
    collapsedSet: { value: Set<string> } | Set<string>
    toggleCollapse: (id: string) => void
  }
  dragEnabled?: boolean
}>()

const emit = defineEmits<{
  selectEvent: [event: Entity]
  toggleSelect: [id: string]
  selectEvents: [ids: string[]]
  createEvent: [preset: CanvasCreatePreset]
  eventAction: [event: Entity, action: TimelineEventAction]
}>()

/* 右键菜单：在壳层做事件委托（画布条/点与编年史卡片都带 data-event-id），两态零侵入 */
const { menu, openAt, close: closeMenu } = useTimelineEventMenu()
function onContextMenu(pointer: MouseEvent) {
  if (openAt(pointer, props.events)) pointer.preventDefault()
}
function pickMenu(action: TimelineEventAction) {
  if (menu.value) emit('eventAction', menu.value.event, action)
  closeMenu()
}

const canvasRef = ref<{
  zoomIn: () => void
  zoomOut: () => void
  fitAll: () => void
  focusEvent: (id: string) => void
} | null>(null)

defineExpose({
  zoomIn: () => canvasRef.value?.zoomIn(),
  zoomOut: () => canvasRef.value?.zoomOut(),
  fitAll: () => canvasRef.value?.fitAll(),
  focusEvent: (id: string) => canvasRef.value?.focusEvent(id),
})
</script>

<style scoped>
.timeline-chart {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  position: relative;
  display: flex;
  flex-direction: column;
}

.timeline-skeleton {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 18px 20px;
  overflow: hidden;
}
.timeline-skeleton .ws-skeleton { width: 100%; }
</style>
