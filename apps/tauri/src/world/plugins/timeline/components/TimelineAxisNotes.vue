<template>
  <div class="axis-notes">
    <button
      v-if="unresolved.length > 0"
      type="button"
      class="axis-note"
      :title="`${unresolved.length} 个事件的时间文本无法按当前历法解析`"
      @click="open('unresolved')"
    >{{ unresolved.length }} 个事件时间无法解析</button>
    <button
      v-if="foreign.length > 0"
      type="button"
      class="axis-note"
      :title="`${foreign.length} 个事件属于其他历法`"
      @click="open('foreign')"
    >{{ foreign.length }} 个其他历法事件</button>
  </div>

  <TuiModal :show="showDialog" size="md" :title="mode === 'foreign' ? '其他历法事件' : '未定时间事件'" @close="showDialog = false">
    <p class="an-hint">
      {{ mode === 'foreign'
        ? '这些事件属于其他历法，不在当前轴上显示；点击条目打开详情，可切换历法。'
        : '这些事件的时间文本无法按当前历法解析；点击条目打开详情，修正日期后即会上轴。' }}
    </p>
    <div class="an-list">
      <button
        v-for="item in mode === 'foreign' ? foreign : unresolved"
        :key="item.event.id"
        type="button"
        class="an-row"
        @click="pick(item.event)"
      >
        <span class="an-name">{{ item.event.name }}</span>
        <span class="an-meta">
          <template v-if="mode === 'foreign'">{{ calendarName(item.point.calendarId) }}</template>
          {{ item.point.text || item.point.raw || '未填写日期' }}
        </span>
      </button>
    </div>
  </TuiModal>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Entity } from '@worldsea/entity-core'
import TuiModal from '@/components/ui/TuiModal.vue'
import type { Calendar } from '../calendar/types'
import type { EventTime } from '../composables/useTimelinePoints'

const props = defineProps<{
  /** 筛选后的全部事件（含其他历法与未定时间） */
  events: Entity[]
  points: Map<string, EventTime>
  calendar: Calendar
  calendars: Calendar[]
}>()

const emit = defineEmits<{ selectEvent: [event: Entity] }>()

interface IssueItem { event: Entity; point: EventTime }

const unresolved = computed<IssueItem[]>(() => props.events.flatMap(event => {
  const point = props.points.get(event.id)
  return point?.unresolved ? [{ event, point }] : []
}))
const foreign = computed<IssueItem[]>(() => props.events.flatMap(event => {
  const point = props.points.get(event.id)
  return point?.foreign ? [{ event, point }] : []
}))

const showDialog = ref(false)
const mode = ref<'unresolved' | 'foreign'>('unresolved')

function open(next: 'unresolved' | 'foreign') {
  mode.value = next
  showDialog.value = true
}

function calendarName(id: string): string {
  return props.calendars.find(calendar => calendar.id === id)?.name ?? (id || '未知历法')
}

function pick(event: Entity) {
  showDialog.value = false
  emit('selectEvent', event)
}
</script>

<style scoped>
.axis-notes {
  position: absolute;
  right: 8px;
  top: 2px;
  display: flex;
  gap: 6px;
}
.axis-note {
  padding: 1px 6px;
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-xs);
  cursor: pointer;
}
.axis-note:hover { color: var(--text-color); border-color: var(--primary); }

.an-hint { margin: 0 0 10px; font-size: var(--font-size-xs); color: var(--text-tertiary); line-height: 1.5; }
.an-list { display: flex; flex-direction: column; gap: 4px; max-height: 50vh; overflow-y: auto; }
.an-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 7px 8px;
  text-align: left;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
}
.an-row:hover,
.an-row:focus-visible { background: var(--hover-bg); border-color: var(--border-color); outline: none; }
.an-name { font-size: var(--font-size-sm); color: var(--text-color); }
.an-meta {
  margin-left: auto;
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  max-width: 60%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
