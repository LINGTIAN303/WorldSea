<template>
  <div class="edf-fields">
    <div v-if="editing" class="edf-field edf-field-full">
      <span class="edf-field-label">名称</span>
      <FieldControl
        :value="String(draft._name ?? event?.name ?? '')"
        raw-type="text"
        label="名称"
        :editing="true"
        @update:value="val => emit('update:field', '_name', String(val ?? ''))"
      />
    </div>
    <div
      v-for="(val, key) in visibleProperties"
      :key="key"
      class="edf-field"
      :class="{ 'edf-field-full': isFullWidth(String(key)) }"
    >
      <span class="edf-field-label">{{ labelOf(String(key)) }}</span>
      <template v-if="key === 'date' || key === 'dateEnd'">
        <TimePointInput
          v-if="editing"
          :model-value="String(val ?? '')"
          :calendar="draftCalendar"
          :certainty="draftCertainty"
          @update:model-value="v => emit('update:field', String(key), v)"
          @update:certainty="v => emit('update:field', 'dateCertainty', v)"
        />
        <FieldControl
          v-else
          :value="val"
          raw-type="text"
          :label="labelOf(String(key))"
          :editing="false"
        />
      </template>
      <select
        v-else-if="key === 'calendarId' && editing"
        class="edf-select"
        :value="String(val || calendar?.id || calendars?.[0]?.id || '')"
        @change="emit('update:field', 'calendarId', ($event.target as HTMLSelectElement).value)"
      >
        <option v-for="calendar in calendars ?? []" :key="calendar.id" :value="calendar.id">{{ calendar.name }}</option>
      </select>
      <span v-else-if="key === 'calendarId'" class="edf-calendar">{{ calendarName(String(val ?? '')) }}</span>
      <RecurrenceEditor
        v-else-if="key === 'recurrence' && editing"
        :model-value="String(val ?? '')"
        :calendar="draftCalendar"
        @update:model-value="v => emit('update:field', 'recurrence', v)"
      />
      <code v-else-if="key === 'recurrence'" class="edf-json">{{ val || '—' }}</code>
      <FieldControl
        v-else
        :value="val"
        :raw-type="typeOf(String(key))"
        :label="labelOf(String(key))"
        :editing="editing"
        :options="optionsOf(String(key))"
        @update:value="v => emit('update:field', String(key), v)"
      />
    </div>
    <div class="edf-field edf-field-full">
      <span class="edf-field-label">描述</span>
      <FieldControl
        :value="draft._description ?? event?.description ?? ''"
        raw-type="textarea"
        label="描述"
        :editing="editing"
        @update:value="val => emit('update:field', '_description', String(val ?? ''))"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 时间线详情的字段网格（编辑走同一套行内草稿）。
 * 从 TimelineView 拆出以守住该文件的冻结行数上限；控件仍只有 FieldControl 一套。
 */
import { computed } from 'vue'
import type { Entity } from '@worldsea/entity-core'
import { FieldControl, controlSpecFor, normalizeFieldType } from '@worldsea/plugin-sdk'
import type { Calendar, Certainty } from '../calendar/types'
import { createSimpleCalendar } from '../calendar/defaults'
import TimePointInput from '../calendar/components/TimePointInput.vue'
import RecurrenceEditor from '../calendar/components/RecurrenceEditor.vue'

interface EventSchemaField {
  key: string
  label: string
  fieldType: string
  options?: { value: string; label: string }[]
}

const props = withDefaults(defineProps<{
  event: Entity | null
  schemaFields?: EventSchemaField[]
  editing: boolean
  draft: Record<string, unknown>
  calendar?: Calendar
  calendars?: Calendar[]
}>(), {
  schemaFields: () => [],
  calendar: undefined,
  calendars: () => [],
})

const emit = defineEmits<{ 'update:field': [key: string, value: unknown] }>()

/** 位置字段由地图承载；era 是迁移期的历史只读属性，不在字段网格重复 */
const visibleProperties = computed(() => {
  if (!props.event) return {}
  const source = { ...(props.event.properties as Record<string, unknown>) }
  delete source.location
  delete source.era
  const hidden = new Set(['name', 'title', 'description', 'tags', 'coverImage', 'location', 'era'])
  const result: Record<string, unknown> = {}
  // 先按 schema 铺满字段（旧事件缺 calendarId/dateCertainty 也要能编辑），再补自定义属性
  for (const field of props.schemaFields) {
    if (hidden.has(field.key)) continue
    result[field.key] = source[field.key] ?? ''
  }
  for (const [key, value] of Object.entries(source)) {
    if (!(key in result) && !hidden.has(key)) result[key] = value
  }
  return result
})

const draftCalendar = computed(() => {
  const id = String(props.draft.calendarId ?? '')
  return props.calendars.find(calendar => calendar.id === id)
    ?? props.calendar
    ?? props.calendars[0]
    ?? createSimpleCalendar()
})

const draftCertainty = computed<Certainty>(() => {
  const value = String(props.draft.dateCertainty ?? '')
  return (['exact', 'approx', 'before', 'after', 'legend'].includes(value) ? value : 'exact') as Certainty
})

function calendarName(id: string): string {
  return props.calendars.find(calendar => calendar.id === id)?.name
    ?? props.calendar?.name
    ?? (id || '默认历法')
}

function fieldOf(key: string): EventSchemaField | undefined {
  return props.schemaFields.find(f => f.key === key)
}

function labelOf(key: string): string {
  return fieldOf(key)?.label || key
}

/** 按 schema 声明的类型给控件（此前时间线把所有字段一律当文本渲染，select/entityRef 都读成裸值） */
function typeOf(key: string): string {
  return fieldOf(key)?.fieldType || 'text'
}

function optionsOf(key: string) {
  return fieldOf(key)?.options
}

function isFullWidth(key: string): boolean {
  return controlSpecFor(normalizeFieldType(typeOf(key))).fullWidth
}
</script>

<style scoped>
.edf-fields { display: flex; flex-wrap: wrap; gap: 8px 12px; margin: 12px 0; }
.edf-field { flex: 1 1 calc(50% - 12px); min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.edf-field-full { flex-basis: 100%; }
.edf-field-label {
  font-size: var(--font-size-xs); color: var(--color-text-secondary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.edf-select {
  padding: 5px 8px; border: 1px solid var(--border-color); border-radius: var(--radius-sm);
  background: var(--input-bg); color: var(--text-color); font-size: var(--font-size-sm); outline: none;
}
.edf-calendar { font-size: var(--font-size-sm); color: var(--text-secondary); }
.edf-json { font-size: var(--font-size-xs); color: var(--text-tertiary); word-break: break-all; }
</style>
