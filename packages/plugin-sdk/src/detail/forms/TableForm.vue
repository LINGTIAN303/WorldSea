<template>
  <div class="dfm-table" @dblclick="emit('enter-edit')">
    <DataTable :columns="COLUMNS" :rows="rows" />
    <div v-if="!rows.length" class="dfm-empty">该实体没有可显示的字段</div>
  </div>
</template>

<script setup lang="ts">
/**
 * 内容形态·表格式（derived）：字段/值两列通读，复用 `ui-kit/DataTable`——
 * 表格的样式与滚动条不在这里再造一份。详细见
 * docs/details/注释/packages/plugin-sdk/实体详情内容形态.md
 */
import { computed } from 'vue'
import { DataTable } from '@worldsea/ui-kit'
import type { Entity } from '@worldsea/entity-core'
import { textOfField } from '../formValues'
import { useFieldSource } from '../useFieldSource'
import type { DetailFieldMeta } from '../fieldMeta'
import type { DetailGroup } from '../detailLayout'

// 形态契约在五个件里保持一致：分发器 v-bind 一次，多余的面不必各自声明不同形状
const props = withDefaults(defineProps<{
  entity: Entity | null
  fields: DetailFieldMeta[]
  groups: DetailGroup[]
  editing: boolean
  draft: Record<string, unknown>
  config: Record<string, unknown>
  entityLabel?: string
}>(), { entityLabel: '' })

const emit = defineEmits<{
  'update:field': [key: string, value: unknown]
  'remove-field': [key: string]
  'promote-field': [key: string]
  'demote-field': [key: string]
  'enter-edit': []
}>()

const src = useFieldSource(props)

const COLUMNS = [
  { key: 'field', label: '字段' },
  { key: 'value', label: '值' },
]

const rows = computed(() => props.fields.map(f => ({
  field: f.label || f.key,
  value: textOfField(f, src.value),
})))
</script>

<style scoped>
.dfm-table { display: flex; flex-direction: column; gap: 8px; }
.dfm-empty { font-size: var(--font-size-xs); color: var(--text-tertiary); }
</style>
