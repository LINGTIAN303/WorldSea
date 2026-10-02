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
      <FieldControl
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
}>(), {
  schemaFields: () => [],
})

const emit = defineEmits<{ 'update:field': [key: string, value: unknown] }>()

/** 位置字段由地图承载，不在字段网格里重复一份 */
const visibleProperties = computed(() => {
  if (!props.event) return {}
  const { location, ...rest } = props.event.properties as Record<string, unknown>
  return rest
})

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
</style>
