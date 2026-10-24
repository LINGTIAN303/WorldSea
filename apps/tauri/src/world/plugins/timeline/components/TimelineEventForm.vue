<template>
  <EntityFormModal
    ref="modalRef"
    :model-value="modelValue"
    :title="title"
    :entity="entity"
    :fields="fields"
    :entity-type="entityType"
    :preset="preset"
    @update:model-value="value => emit('update:modelValue', value)"
    @save="payload => emit('save', payload)"
  >
    <template #field="{ field, value, set, form }">
      <TimePointInput
        v-if="field.key === 'date' || field.key === 'dateEnd'"
        :model-value="String(value ?? '')"
        :calendar="calendarFor(form)"
        :certainty="certaintyOf(form)"
        @update:model-value="set"
        @update:certainty="value => form.dateCertainty = value"
      />
      <RecurrenceEditor
        v-else-if="field.key === 'recurrence'"
        :model-value="String(value ?? '')"
        :calendar="calendarFor(form)"
        @update:model-value="set"
      />
      <select
        v-else-if="field.key === 'calendarId'"
        class="tef-select"
        :value="String(value || activeCalendarId)"
        @change="set(($event.target as HTMLSelectElement).value)"
      >
        <option v-for="calendar in calendars" :key="calendar.id" :value="calendar.id">{{ calendar.name }}</option>
      </select>
      <InvolvedEntitiesPicker
        v-else-if="field.key === '_involvedIds'"
        :model-value="asStringArray(form._involvedIds)"
        @update:model-value="ids => set(ids)"
        :event-id="entity?.id"
      />
      <FieldControl
        v-else
        :value="value"
        :raw-type="field.type"
        :label="field.label"
        :editing="true"
        :options="field.options"
        :placeholder="field.placeholder"
        :ref-type="field.refType"
        :entity-id="entity?.id"
        :cover-position="String(form._coverPosition ?? '')"
        :cover-zoom="Number(form._coverZoom) || 1"
        @update:value="set"
        @update:cover-position="value => form._coverPosition = value"
        @update:cover-zoom="value => form._coverZoom = value"
      />
    </template>
  </EntityFormModal>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { EntityFormModal, FieldControl, type FormFieldDef } from '@worldsea/plugin-sdk'
import type { Entity } from '@worldsea/entity-core'
import type { Calendar, Certainty } from '../calendar/types'
import { createSimpleCalendar } from '../calendar/defaults'
import TimePointInput from '../calendar/components/TimePointInput.vue'
import RecurrenceEditor from '../calendar/components/RecurrenceEditor.vue'
import InvolvedEntitiesPicker from './InvolvedEntitiesPicker.vue'

const props = defineProps<{
  modelValue: boolean
  title: string
  entity: Entity | null
  entityType: string
  calendars: Calendar[]
  activeCalendarId: string
  /** 新建预填属性（画布拖拽建事件预填起止日期） */
  preset?: Record<string, unknown> | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  save: [data: {
    name: string
    description: string
    properties: Record<string, any>
    tags: string[]
    _entityRefFields?: FormFieldDef[]
    _autoLinkFields?: FormFieldDef[]
    _coverPosition?: string
    _coverZoom?: number
  }]
}>()

const modalRef = ref<InstanceType<typeof EntityFormModal> | null>(null)
const fallbackCalendar = computed(() => props.calendars[0] ?? createSimpleCalendar())

const fields = computed<FormFieldDef[]>(() => [
  { key: 'name', label: '名称', type: 'text', required: true, placeholder: '事件名称' },
  { key: 'description', label: '描述', type: 'textarea', placeholder: '事件描述' },
  { key: 'date', label: '日期/纪年', type: 'text', placeholder: '按当前历法输入' },
  { key: 'dateEnd', label: '结束日期', type: 'text' },
  {
    key: 'calendarId', label: '历法', type: 'select',
    options: props.calendars.map(calendar => ({ value: calendar.id, label: calendar.name })),
  },
  {
    key: 'dateCertainty', label: '日期确定度', type: 'select',
    options: [
      { value: 'exact', label: '精确' },
      { value: 'approx', label: '约' },
      { value: 'before', label: '早于' },
      { value: 'after', label: '晚于' },
      { value: 'legend', label: '传说' },
    ],
  },
  { key: 'recurrence', label: '周期规则', type: 'textarea', placeholder: '留空 = 不重复' },
  {
    key: 'importance', label: '重要程度', type: 'select',
    options: ['关键', '重要', '普通', '细微'].map(value => ({ value, label: value })),
  },
  {
    key: 'status', label: '状态', type: 'select',
    options: ['正史', '废案', '备选'].map(value => ({ value, label: value })),
  },
  { key: 'location', label: '发生地点', type: 'text' },
  { key: '_involvedIds', label: '参与角色/组织', type: 'text' },
  { key: 'tags', label: '标签', type: 'tags' },
  { key: 'parentId', label: '父级事件', type: 'entityRef', refType: 'event', placeholder: '搜索事件...' },
])

function calendarFor(form: Record<string, any>): Calendar {
  const id = String(form.calendarId ?? '') || props.activeCalendarId
  return props.calendars.find(calendar => calendar.id === id) ?? fallbackCalendar.value
}

/** 插槽 form 值 → InvolvedEntitiesPicker 的 modelValue（模板联合类型断言在 vue-tsc 下失效，走显式转换） */
function asStringArray(v: unknown): string[] | undefined {
  return Array.isArray(v) ? v.map(item => String(item)) : undefined
}

function certaintyOf(form: Record<string, any>): Certainty {
  const value = String(form.dateCertainty ?? '')
  return (['exact', 'approx', 'before', 'after', 'legend'].includes(value) ? value : 'exact') as Certainty
}

defineExpose({
  syncEntityRefAfterCreate: (id: string) => modalRef.value?.syncEntityRefAfterCreate(id),
})
</script>

<style scoped>
.tef-select {
  padding: 7px 10px; border: 1px solid var(--border-color); border-radius: var(--radius-sm);
  background: var(--input-bg); color: var(--text-color); font-size: var(--font-size-base); outline: none;
}
.tef-select:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--focus-ring); }
</style>
