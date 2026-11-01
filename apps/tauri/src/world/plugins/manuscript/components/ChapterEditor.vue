<template>
  <div class="chapter-editor">
    <EditorToolbar
      :editor="editor"
      :save-status="saveStatus"
      :word-count="wordCount"
      @open-find="findBarRef?.open(false)"
    />
    <FindReplaceBar ref="findBarRef" :editor="editor" />
    <div v-if="editor" class="editor-wrap">
      <EditorContent :editor="editor" />
    </div>
    <div v-else class="editor-loading">
      <WsSkeleton variant="text" :lines="8" label="正在初始化编辑器" />
    </div>
    <MentionPopover ref="mentionPopoverRef" @select="onMentionSelect" @close="() => {}" />
    <SlashCommandMenu ref="slashCommandMenuRef" @select="onSlashCommandSelect" @close="() => {}" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import { EditorContent } from '@tiptap/vue-3'
import { WsSkeleton } from '@worldsea/ui-kit'
import EditorToolbar from './EditorToolbar.vue'
import FindReplaceBar from '@/components/editor/FindReplaceBar.vue'
import MentionPopover from '@/components/editor/MentionPopover.vue'
import SlashCommandMenu from '@/components/editor/SlashCommandMenu.vue'
import type { MentionItem, FindReplaceBarApi } from '../composables/useChapterEditor'
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
  setFindReplaceApi: (api: FindReplaceBarApi | null) => void
}>()

const mentionPopoverRef = ref<{ open: (clientRect: (() => DOMRect | null) | null) => void; close: () => void } | null>(null)
const slashCommandMenuRef = ref<SlashCommandPopoverApi | null>(null)
const findBarRef = ref<InstanceType<typeof FindReplaceBar> | null>(null)

onMounted(() => {
  props.setMentionPopover(mentionPopoverRef.value)
  props.setSlashCommandPopover(slashCommandMenuRef.value)
  // 查找条 API 反注册给扩展快捷键（Ctrl+F/H/Esc）；FindReplaceBar 卸载随组件树一致，无需注销
  props.setFindReplaceApi(findBarRef.value)
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
  flex-direction: column;
  padding: 16px 20px;
}
.editor-loading .ws-skeleton { width: 100%; }
.editor-wrap :deep(.tiptap) {
  outline: none;
  min-height: 300px;
  font-family: var(--font-family-content);
  /* 写作偏好（批1）：默认 14px/1.8/全宽 = 既有呈现（--font-size-md 未定义，继承 --fs-base） */
  font-size: var(--ms-font-size, var(--fs-base));
  line-height: var(--ms-line-height, 1.8);
  /* 长段落断行优化：末行不成孤字（Chromium 120+ 渐进增强，字体系统 v2 批 3） */
  text-wrap: pretty;
  max-width: var(--ms-page-width, none);
  margin-inline: auto;
  color: var(--text-color);
}
.editor-wrap :deep(.tiptap p) {
  margin: 0 0 8px;
  /* 段首缩进为呈现层开关（排版偏好），不写入内容 */
  text-indent: var(--ms-indent, 0);
}
/* 段落淡出（专注模式子项）：当前段之外的顶层块降透明度 */
.editor-wrap :deep(.tiptap .ms-para--dimmed) { opacity: 0.35; }
/* 查找高亮（批1）：普通匹配淡底、当前匹配强调 */
.editor-wrap :deep(.ms-find-match) { background: var(--warning-soft, rgba(255, 193, 7, 0.25)); border-radius: 2px; }
.editor-wrap :deep(.ms-find-match--current) { background: var(--primary-light); outline: 1px solid var(--primary); }
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

/* ── 图片（三期前置）：块级 img，宽度自适应不越界；选中态与表格选中同色 ── */
.editor-wrap :deep(.tiptap img) {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 8px 0;
  border-radius: var(--radius-xs);
}
.editor-wrap :deep(.tiptap img.ProseMirror-selectednode) {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
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
