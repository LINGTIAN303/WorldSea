<template>
  <div class="dfm-timeline" @dblclick="emit('enter-edit')">
    <ol v-if="points.length" class="dft-list">
      <li v-for="p in points" :key="p.key" class="dft-node">
        <span class="dft-dot" aria-hidden="true"></span>
        <span class="dft-when">{{ p.text }}</span>
        <span class="dft-label">{{ p.label }}</span>
      </li>
    </ol>
    <div v-else class="dfm-empty">该实体没有日期字段，时间轴式对它没有意义</div>
  </div>
</template>

<script setup lang="ts">
/**
 * 内容形态·时间轴式（derived）：把散在各处的日期字段聚成一条轴。节点顺序**沿用字段顺序**
 * 而非按日期排：`datable` 的日期常是「约 1420 年」这类非 ISO 串，字典序会排错位置还看似有理。
 * 详细见 docs/details/注释/packages/plugin-sdk/实体详情内容形态.md
 */
import { computed } from 'vue'
import type { Entity } from '@worldsea/entity-core'
import { timelinePoints } from '../formValues'
import { useFieldSource } from '../useFieldSource'
import type { DetailFieldMeta } from '../fieldMeta'
import type { DetailGroup } from '../detailLayout'

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

const points = computed(() =>
  timelinePoints(props.fields, src.value, props.config.includeCreatedAt === true))
</script>

<style scoped>
.dfm-timeline { display: flex; flex-direction: column; }
.dft-list {
  position: relative; margin: 0; padding: 0 0 0 16px; list-style: none;
  display: flex; flex-direction: column; gap: 10px;
}
.dft-list::before {
  content: ''; position: absolute; left: 4px; top: 4px; bottom: 4px; width: 1px;
  background: var(--border, #ececec);
}
.dft-node { position: relative; display: flex; align-items: baseline; gap: 8px; }
.dft-dot {
  position: absolute; left: -16px; top: 5px; width: 9px; height: 9px; border-radius: 50%;
  background: var(--bg-surface, #fff); border: 2px solid var(--accent, #4f46e5);
}
.dft-when { font-size: var(--font-size-sm); color: var(--text); font-variant-numeric: tabular-nums; }
.dft-label { font-size: var(--font-size-xs); color: var(--text-tertiary); }
.dfm-empty { font-size: var(--font-size-xs); color: var(--text-tertiary); }
</style>
