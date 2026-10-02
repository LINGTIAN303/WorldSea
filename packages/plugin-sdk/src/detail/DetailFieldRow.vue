<template>
  <div class="edf-row" :class="{ 'edf-row-full': fullWidth }">
    <div class="edf-row-head">
      <span class="edf-label">{{ field.label }}</span>
      <span v-if="editing && showActs" class="edf-row-acts">
        <button
          v-if="field.scope === 'entity'"
          class="edf-act"
          type="button"
          title="共享给整个类型：同类型所有实体的详情都会出现该字段"
          @click="emit('promote-field', field.key)"
        >共享</button>
        <button
          v-else-if="removable"
          class="edf-act"
          type="button"
          title="仅保留在本实体：从类型定义里摘出，值不动"
          @click="emit('demote-field', field.key)"
        >仅本实体</button>
        <button
          v-if="removable"
          class="edf-field-del"
          type="button"
          :title="`从「${entityLabel}」移除该字段`"
          @click="emit('remove-field', field.key)"
        >×</button>
      </span>
    </div>
    <div class="edf-control" @dblclick="onDblClick">
      <FieldControl
        :value="value"
        :raw-type="field.fieldType"
        :label="field.label"
        :editing="editing"
        :options="field.options"
        :ref-type="field.refType"
        :entity-id="entityId"
        :cover-position="coverPosition"
        :cover-zoom="coverZoom"
        @update:value="val => emit('update:field', field.key, val)"
        @update:cover-position="val => emit('update:field', 'coverPosition', val)"
        @update:cover-zoom="val => emit('update:field', 'coverZoom', val)"
        @request-edit="emit('enter-edit')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 详情字段行（标签 + 控件 + 作用域/移除动作）。
 * 各内容形态共用这一份行渲染——形态之间只差编排，不差控件与动作。
 * 详细见 docs/details/注释/packages/plugin-sdk/实体详情内容形态.md
 */
import { computed } from 'vue'
import FieldControl from './FieldControl.vue'
import { controlSpecFor } from './fieldControlMap'
import { normalizeFieldType } from './fieldType'
import type { DetailFieldMeta } from './fieldMeta'

const props = withDefaults(defineProps<{
  field: DetailFieldMeta
  value: unknown
  editing: boolean
  entityLabel?: string
  entityId?: string
  coverPosition?: string
  coverZoom?: number
  /** 摘要式等紧凑形态不出动作按钮 */
  showActs?: boolean
}>(), {
  entityLabel: '',
  entityId: undefined,
  coverPosition: undefined,
  coverZoom: undefined,
  showActs: true,
})

const emit = defineEmits<{
  'update:field': [key: string, value: unknown]
  'promote-field': [key: string]
  'demote-field': [key: string]
  'remove-field': [key: string]
  'enter-edit': []
}>()

const fullWidth = computed(() => controlSpecFor(normalizeFieldType(props.field.fieldType)).fullWidth)
/** 只有非内置字段可移除（内置字段由芽声明，移除等于改芽的语义） */
const removable = computed(() => (props.field.source ?? 'builtin') !== 'builtin')

function onDblClick() {
  if (!props.editing) emit('enter-edit')
}
</script>

<style scoped>
.edf-row { flex: 1 1 calc(50% - 12px); min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.edf-row-full { flex-basis: 100%; }
.edf-row-head { display: flex; align-items: center; gap: 4px; }
.edf-label {
  font-size: var(--font-size-xs); color: var(--text-secondary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.edf-row-acts { margin-left: auto; display: inline-flex; align-items: center; gap: 2px; flex-shrink: 0; }
.edf-act {
  padding: 0 5px; font-size: var(--font-size-xs); cursor: pointer;
  background: none; border: 1px solid var(--border, #d1d5db); border-radius: 3px;
  color: var(--text-tertiary, #9ca3af); white-space: nowrap;
}
.edf-act:hover { border-color: var(--accent, #4f46e5); color: var(--accent, #4f46e5); }
.edf-field-del {
  background: none; border: none; cursor: pointer; padding: 0 2px;
  color: var(--danger, #d97706); font-size: var(--font-size-xs); opacity: 0.6;
}
.edf-field-del:hover { opacity: 1; }
.edf-control { min-width: 0; cursor: default; }
</style>
