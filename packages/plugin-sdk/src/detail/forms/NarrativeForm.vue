<template>
  <article class="dfm-narrative" @dblclick="emit('enter-edit')">
    <section v-for="s in sections" :key="s.key" class="dfm-para">
      <h4 class="dfm-para-label">{{ s.label }}</h4>
      <!-- 两条分支都过 DOMPurify（见 richText.ts），这里不存在裸 v-html 用户数据的路径 -->
      <div v-if="s.text" class="dfm-para-text" v-html="richHtml(s.fieldType, s.raw)"></div>
      <div v-else class="dfm-para-text dfm-para-empty">—</div>
    </section>
    <div v-if="!sections.length" class="dfm-empty">该实体没有长文本字段，换分组式或摘要式看更合适</div>
  </article>
</template>

<script setup lang="ts">
/**
 * 内容形态·段落式（derived）：长文本字段合并成篇。详细见
 * docs/details/注释/packages/plugin-sdk/实体详情内容形态.md §六
 *
 * 正文按 markdown/HTML 渲染，复用主窗口同一内核（marked + DOMPurify），
 * 不再自己 `white-space: pre-wrap` 排自然段——那会让描述里的 `#`/`-`/`**` 原样露出。
 */
import { computed } from 'vue'
import type { Entity } from '@worldsea/entity-core'
import { narrativeSections } from '../formValues'
import { richHtml } from '../richText'
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
.dfm-para-text { word-break: break-word; }
.dfm-para-empty { color: var(--text-tertiary, #9ca3af); }
/* v-html 渲出的 markdown 结构不在 scoped 作用域内，用 :deep 定点补；
   不引主窗口的 markdown.css——那份带 Agent 气泡的代码块/mention 样式，详情面用不上 */
.dfm-para-text :deep(p) { margin: 0 0 6px; }
.dfm-para-text :deep(p:last-child) { margin-bottom: 0; }
.dfm-para-text :deep(h1),
.dfm-para-text :deep(h2),
.dfm-para-text :deep(h3),
.dfm-para-text :deep(h4) { margin: 8px 0 4px; font-size: var(--font-size-base); }
.dfm-para-text :deep(ul),
.dfm-para-text :deep(ol) { margin: 4px 0; padding-left: 20px; }
.dfm-para-text :deep(blockquote) {
  margin: 4px 0; padding-left: 8px; border-left: 2px solid var(--border, #d1d5db);
  color: var(--text-secondary);
}
.dfm-para-text :deep(code) {
  padding: 1px 4px; border-radius: 3px; font-size: 0.92em;
  background: var(--bg-muted, #f4f4f5);
}
.dfm-para-text :deep(table) { border-collapse: collapse; }
.dfm-para-text :deep(td),
.dfm-para-text :deep(th) { padding: 2px 8px; border: 1px solid var(--border, #ececec); }
.dfm-empty { font-size: var(--font-size-xs); color: var(--text-tertiary); }
</style>
