<template>
  <div class="iv-wrap">
    <GenericEntityView
      v-if="viewMode === 'list'"
      entity-type="inspiration"
      :form-fields="fields"
      :icon-fn="icon"
      :filter-options="filterOpts"
      filter-field-key="materialType"
      id-prefix="ins-"
      entity-label="灵感"
    >
      <template #toolbar-extra>
        <button class="iv-canvas-btn" @click="viewMode = 'canvas'" title="画布视图">
          <WsIcon name="dashboard" :size="14" :stroke-width="1.5" />
          画布
        </button>
      </template>
    </GenericEntityView>
    <MoodboardView v-else @back="viewMode = 'list'" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import { GenericEntityView, type FormFieldDef } from '@worldsea/plugin-sdk'
import MoodboardView from './MoodboardView.vue'
import type { Entity } from '@worldsea/entity-core'

const viewMode = ref<'list' | 'canvas'>('list')

const fields: FormFieldDef[] = [
  { key: 'name', label: '名称', type: 'text', required: true, placeholder: '灵感名称' },
  { key: 'description', label: '描述', type: 'textarea', placeholder: '简要描述' },
  { key: 'materialType', label: '素材类型', type: 'select', options: [
    { value: '图片', label: '图片' }, { value: '视频', label: '视频' },
    { value: '文章', label: '文章' }, { value: '音乐', label: '音乐' },
    { value: '概念', label: '概念' }, { value: '角色', label: '角色' },
    { value: '场景', label: '场景' }, { value: '对话', label: '对话' },
    { value: '其他', label: '其他' },
  ] },
  { key: 'source', label: '来源', type: 'text' },
  { key: 'url', label: '链接/URL', type: 'text' },
  { key: 'notes', label: '笔记', type: 'textarea' },
  { key: 'tags', label: '标签', type: 'tags' },
]

function icon(e: Entity | null): string {
  if (!e) return '\u{1F4A1}'
  const t = e.properties.materialType as string
  return { '图片': '\u{1F5BC}', '视频': '\u{1F3AC}', '文章': '\u{1F4DD}', '音乐': '\u{1F3B5}', '概念': '\u{1F4AD}', '角色': '\u{1F464}', '场景': '\u{1F304}', '对话': '\u{1F4AC}' }[t] || '\u{1F4A1}'
}

const filterOpts = [
  { value: '', label: '全部' },
  ...[{ value: '图片', label: '图片' }, { value: '视频', label: '视频' }, { value: '文章', label: '文章' }, { value: '音乐', label: '音乐' }, { value: '概念', label: '概念' }, { value: '角色', label: '角色' }, { value: '场景', label: '场景' }, { value: '对话', label: '对话' }, { value: '其他', label: '其他' }],
]
</script>

<style scoped>
.iv-wrap {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.iv-canvas-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xs);
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
  white-space: nowrap;
}

.iv-canvas-btn:hover {
  background: var(--color-bg-hover);
  border-color: var(--color-text-secondary);
  color: var(--color-text-primary);
}
</style>
