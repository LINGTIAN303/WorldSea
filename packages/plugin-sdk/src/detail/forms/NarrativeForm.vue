<template>
  <article class="dfm-narrative" @dblclick="emit('enter-edit')">
    <section v-for="s in sections" :key="s.key" class="dfm-para">
      <h4 class="dfm-para-label">{{ s.label }}</h4>
      <p v-for="(line, i) in paragraphs(s.text)" :key="i" class="dfm-para-text">{{ line }}</p>
    </section>
    <div v-if="!sections.length" class="dfm-empty">该实体没有长文本字段，换分组式或摘要式看更合适</div>
  </article>
</template>

<script setup lang="ts">
/**
 * 内容形态·段落式（derived）：长文本字段合并成篇，按空行切自然段。
 * 详细见 docs/details/注释/packages/plugin-sdk/实体详情内容形态.md
 *
 * 这里**不做 markdown/HTML 渲染**：富文本字段历史上存的是带标签的串，
 * `v-html` 等于把实体数据当代码执行；现行做法是剥标签后按纯文本排版（同 1a 的 `stripHtml`）。
 */
import { computed } from 'vue'
import type { Entity } from '@worldsea/entity-core'
import { narrativeSections } from '../formValues'
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

const sections = computed(() =>
  narrativeSections(props.fields, src.value, props.config.includeDescription !== false))

/** 空行分段（单换行仍是同一段） */
function paragraphs(text: string): string[] {
  const parts = text.split(/\n\s*\n/).map(s => s.trim()).filter(s => s !== '')
  return parts.length ? parts : ['—']
}
</script>

<style scoped>
.dfm-narrative {
  display: flex; flex-direction: column; gap: 14px;
  font-size: var(--font-size-sm); line-height: 1.75; color: var(--text);
}
.dfm-para { display: flex; flex-direction: column; gap: 4px; }
.dfm-para-label {
  margin: 0; font-size: var(--font-size-xs); font-weight: var(--font-weight-semibold);
  letter-spacing: 0.3px; color: var(--text-secondary);
}
.dfm-para-text { margin: 0; white-space: pre-wrap; word-break: break-word; }
.dfm-para-text + .dfm-para-text { margin-top: 6px; }
.dfm-empty { font-size: var(--font-size-xs); color: var(--text-tertiary); }
</style>
