<template>
  <div class="dfm-summary" @dblclick="emit('enter-edit')">
    <p v-if="excerpt" class="dfs-excerpt">{{ excerpt }}</p>

    <div v-if="chips.length" class="dfs-chips">
      <span v-for="c in chips" :key="c.key" class="dfs-chip">
        <span class="dfs-chip-label">{{ c.label }}</span>
        <span class="dfs-chip-value">{{ c.text }}</span>
      </span>
    </div>
    <div v-else class="dfm-empty">该实体还没有已填的短字段</div>

    <div v-if="restCount" class="dfs-more">另有 {{ restCount }} 项属性未显示，切表格式可看全</div>
  </div>
</template>

<script setup lang="ts">
/**
 * 内容形态·摘要式（derived）：短字段压成「标签 值」属性牌，只列**已填**的。空值不进牌列——
 * 一排「—」正是被点名要消灭的幽灵行，摘要面更不该复刻它；但也不静默吞掉，末尾如实报
 * 「另有 N 项」。详细见 docs/details/注释/packages/plugin-sdk/实体详情内容形态.md
 */
import { computed } from 'vue'
import type { Entity } from '@worldsea/entity-core'
import { narrativeSections, shortChips } from '../formValues'
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

const EXCERPT_LEN = 120

const src = useFieldSource(props)

const maxChips = computed(() => {
  const n = Number(props.config.maxChips)
  return Number.isFinite(n) && n > 0 ? n : 14
})

const allChips = computed(() => shortChips(props.fields, src.value))
const chips = computed(() => allChips.value.filter(c => !c.empty).slice(0, maxChips.value))
const restCount = computed(() => allChips.value.length - chips.value.length)

const excerpt = computed(() => {
  if (props.config.showExcerpt === false) return ''
  const first = narrativeSections(props.fields, src.value, true)[0]
  if (!first?.text) return ''
  return first.text.length > EXCERPT_LEN ? `${first.text.slice(0, EXCERPT_LEN)}…` : first.text
})
</script>

<style scoped>
.dfm-summary { display: flex; flex-direction: column; gap: 10px; }
.dfs-excerpt {
  margin: 0; font-size: var(--font-size-sm); line-height: 1.7; color: var(--text-secondary);
  white-space: pre-wrap; word-break: break-word;
}
.dfs-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.dfs-chip {
  display: inline-flex; align-items: baseline; gap: 5px; max-width: 100%;
  padding: 2px 8px; border: 1px solid var(--border, #ececec); border-radius: var(--radius-xs, 4px);
  background: var(--bg-muted, #f4f4f5); font-size: var(--font-size-xs);
}
.dfs-chip-label { color: var(--text-tertiary); flex-shrink: 0; }
.dfs-chip-value {
  color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dfs-more { font-size: var(--font-size-xs); color: var(--text-tertiary); }
.dfm-empty { font-size: var(--font-size-xs); color: var(--text-tertiary); }
</style>
