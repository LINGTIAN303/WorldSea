<template>
  <div class="chapter-editor">
    <EditorToolbar
      :editor="editor"
      :save-status="saveStatus"
      :word-count="wordCount"
    />
    <div v-if="editor" class="editor-wrap">
      <EditorContent :editor="editor" />
    </div>
    <div v-else class="editor-loading">编辑器加载中...</div>
    <MentionPopover ref="mentionPopoverRef" @select="onMentionSelect" @close="() => {}" />
    <SlashCommandMenu ref="slashCommandMenuRef" @select="onSlashCommandSelect" @close="() => {}" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import { EditorContent } from '@tiptap/vue-3'
import EditorToolbar from './EditorToolbar.vue'
import MentionPopover from './MentionPopover.vue'
import SlashCommandMenu from './SlashCommandMenu.vue'
import type { MentionItem } from '../composables/useChapterEditor'
import type { SlashCommandItem } from '../composables/slashCommandExtension'

type SlashCommandPopoverApi = {
  open: (clientRect: (() => DOMRect | null) | null, items: SlashCommandItem[]) => void
  close: () => void
  updateItems: (items: SlashCommandItem[]) => void
  onKeyDown: (event: KeyboardEvent) => boolean
}

const props = defineProps<{
  editor: Editor | null
  saveStatus: 'saved' | 'saving' | 'unsaved'
  wordCount: number
  setMentionPopover: (ref: { open: (clientRect: (() => DOMRect | null) | null) => void; close: () => void } | null) => void
  onMentionSelect: (item: MentionItem) => void
  setSlashCommandPopover: (ref: SlashCommandPopoverApi | null) => void
  onSlashCommandSelect: (item: SlashCommandItem) => void
}>()

const mentionPopoverRef = ref<{ open: (clientRect: (() => DOMRect | null) | null) => void; close: () => void } | null>(null)
const slashCommandMenuRef = ref<SlashCommandPopoverApi | null>(null)

onMounted(() => {
  props.setMentionPopover(mentionPopoverRef.value)
  props.setSlashCommandPopover(slashCommandMenuRef.value)
})
</script>

<style scoped>
.chapter-editor {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--input-bg);
  position: relative;
}
.editor-wrap {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}
.editor-loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
}
.editor-wrap :deep(.tiptap) {
  outline: none;
  min-height: 300px;
  font-family: var(--font-family-content);
  font-size: var(--font-size-md);
  line-height: 1.8;
  color: var(--text-color);
}
.editor-wrap :deep(.tiptap h1) {
  font-size: var(--font-size-2xl);
  font-weight: var(--font-weight-bold);
  margin: 20px 0 12px;
}
.editor-wrap :deep(.tiptap h2) {
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
  margin: 16px 0 10px;
}
.editor-wrap :deep(.tiptap h3) {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  margin: 12px 0 8px;
}
.editor-wrap :deep(.tiptap p) {
  margin: 0 0 8px;
}
.editor-wrap :deep(.tiptap blockquote) {
  border-left: 3px solid var(--primary);
  padding-left: 12px;
  margin: 8px 0;
  color: var(--text-secondary);
}
.editor-wrap :deep(.tiptap ul),
.editor-wrap :deep(.tiptap ol) {
  padding-left: 20px;
  margin: 8px 0;
}
.editor-wrap :deep(.tiptap hr) {
  border: none;
  border-top: 1px solid var(--border-color);
  margin: 16px 0;
}
.editor-wrap :deep(.tiptap code) {
  background: var(--bg-tertiary);
  padding: 2px 4px;
  border-radius: var(--radius-2xs);
  font-size: var(--font-size-sm);
}
.editor-wrap :deep(.tiptap pre) {
  background: var(--bg-tertiary);
  padding: 12px;
  border-radius: var(--radius-sm);
  overflow-x: auto;
  font-size: var(--font-size-sm);
  margin: 8px 0;
}
.editor-wrap :deep(.ms-mention) {
  background: var(--primary-light);
  color: var(--primary);
  padding: 1px 6px;
  border-radius: var(--radius-xs);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
}
.editor-wrap :deep(.ms-mention:hover) {
  background: var(--primary);
  color: var(--color-text-inverse);
}

/* ── 表格（二期）：与笔记本同一套最小样式，令牌取本文件既有别名层 ── */
.editor-wrap :deep(.tiptap .tableWrapper) {
  overflow-x: auto;
  margin: 8px 0;
}
.editor-wrap :deep(.tiptap table) {
  border-collapse: collapse;
  table-layout: fixed;
  width: 100%;
  overflow: hidden;
}
.editor-wrap :deep(.tiptap th),
.editor-wrap :deep(.tiptap td) {
  border: 1px solid var(--border-color);
  padding: 4px 10px;
  vertical-align: top;
  position: relative;
}
.editor-wrap :deep(.tiptap th) {
  background: var(--bg-tertiary);
  font-weight: var(--font-weight-semibold);
  text-align: left;
}
.editor-wrap :deep(.tiptap .selectedCell::after) {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  background: color-mix(in srgb, var(--primary) 18%, transparent);
}
.editor-wrap :deep(.tiptap .column-resize-handle) {
  position: absolute;
  right: -2px;
  top: 0;
  bottom: -2px;
  width: 4px;
  z-index: 20;
  background: var(--primary);
  pointer-events: none;
}
.editor-wrap :deep(.tiptap.resize-cursor) {
  cursor: col-resize;
}
</style>
