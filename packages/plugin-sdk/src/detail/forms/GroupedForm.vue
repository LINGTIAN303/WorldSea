<template>
  <!-- 分组折叠态是本件局部态（一次浏览内的偏好，不落盘） -->
  <section v-for="g in visibleGroups" :key="g.key" class="dfm-group">
    <button class="dfm-group-head" type="button" :aria-expanded="!collapsed.has(g.key)" @click="toggleGroup(g.key)">
      <WsIcon :name="collapsed.has(g.key) ? 'chevron-right' : 'chevron-down'" size="xs" />
      <span class="dfm-group-label">{{ g.label }}</span>
      <span class="dfm-group-count">{{ g.fields.length }}</span>
    </button>

    <div v-show="!collapsed.has(g.key)" class="dfm-rows">
      <DetailFieldRow
        v-for="field in g.fields"
        :key="field.key"
        :field="field"
        :value="valueOfField(field, src)"
        :editing="editing"
        :entity-label="entityLabel"
        :entity-id="entity?.id"
        :cover-position="entity?.coverPosition"
        :cover-zoom="entity?.coverZoom"
        @update:field="onField"
        @promote-field="key => emit('promote-field', key)"
        @demote-field="key => emit('demote-field', key)"
        @remove-field="key => emit('remove-field', key)"
        @enter-edit="emit('enter-edit')"
      />
    </div>
  </section>

  <div v-if="!visibleGroups.length" class="dfm-empty">该实体没有可显示的字段</div>
</template>

<script setup lang="ts">
/**
 * 内容形态·分组式（唯一 inline 型：就地编辑走 1a 的行内单轨）。
 * 详细见 docs/details/注释/packages/plugin-sdk/实体详情内容形态.md
 */
import { computed, ref, watch } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import type { Entity } from '@worldsea/entity-core'
import DetailFieldRow from '../DetailFieldRow.vue'
import { groupsOf, valueOfField } from '../formValues'
import { useFieldSource } from '../useFieldSource'
import type { DetailFieldMeta } from '../fieldMeta'
import type { DetailGroup } from '../detailLayout'

const props = withDefaults(defineProps<{
  entity: Entity | null
  /** 已按 order 排好、剔除隐藏项与标题的可见字段 */
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

const collapsed = ref<Set<string>>(new Set())
const visibleGroups = computed(() => groupsOf(props.fields, props.groups))

function onField(key: string, value: unknown) {
  emit('update:field', key, value)
}

function toggleGroup(key: string) {
  const next = new Set(collapsed.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  collapsed.value = next
}

// 换实体时全部展开，避免带着上一份的折叠态看不出字段
watch(() => props.entity?.id, () => { collapsed.value = new Set() })
</script>

<style scoped>
.dfm-group { display: flex; flex-direction: column; gap: 6px; }
.dfm-group-head {
  display: flex; align-items: center; gap: 6px; padding: 2px 0; width: 100%;
  background: none; border: none; cursor: pointer; text-align: left;
  color: var(--text-secondary); font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold); letter-spacing: 0.3px;
}
.dfm-group-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dfm-group-count { color: var(--text-tertiary); font-weight: normal; }
.dfm-rows { display: flex; flex-wrap: wrap; gap: 8px 12px; }
.dfm-empty { font-size: var(--font-size-xs); color: var(--text-tertiary); }
</style>
