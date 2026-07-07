<template>
  <div class="nb-tiptap-editor">
    <div class="nb-tt-toolbar">
      <div class="toolbar-group">
        <select class="toolbar-select" :value="headingLevel" @change="setHeading">
          <option value="0">正文</option>
          <option value="1">标题 1</option>
          <option value="2">标题 2</option>
          <option value="3">标题 3</option>
        </select>
      </div>
      <div class="toolbar-divider"></div>
      <div class="toolbar-group">
        <button class="tb-btn" :class="{ active: editor?.isActive('bold') }" @click="editor?.chain().focus().toggleBold().run()" title="粗体"><b>B</b></button>
        <button class="tb-btn" :class="{ active: editor?.isActive('italic') }" @click="editor?.chain().focus().toggleItalic().run()" title="斜体"><i>I</i></button>
        <button class="tb-btn" :class="{ active: editor?.isActive('strike') }" @click="editor?.chain().focus().toggleStrike().run()" title="删除线"><s>S</s></button>
        <button class="tb-btn" :class="{ active: editor?.isActive('code') }" @click="editor?.chain().focus().toggleCode().run()" title="行内代码">&lt;/&gt;</button>
      </div>
      <div class="toolbar-divider"></div>
      <div class="toolbar-group">
        <button class="tb-btn" :class="{ active: editor?.isActive('blockquote') }" @click="editor?.chain().focus().toggleBlockquote().run()" title="引用">"</button>
        <button class="tb-btn" :class="{ active: editor?.isActive('bulletList') }" @click="editor?.chain().focus().toggleBulletList().run()" title="无序列表">•</button>
        <button class="tb-btn" :class="{ active: editor?.isActive('orderedList') }" @click="editor?.chain().focus().toggleOrderedList().run()" title="有序列表">1.</button>
        <button class="tb-btn" @click="editor?.chain().focus().setHorizontalRule().run()" title="分割线">—</button>
      </div>
      <div class="toolbar-divider"></div>
      <div class="toolbar-group">
        <button class="tb-btn" @click="editor?.chain().focus().undo().run()" :disabled="!editor?.can().undo()" title="撤销">↩</button>
        <button class="tb-btn" @click="editor?.chain().focus().redo().run()" :disabled="!editor?.can().redo()" title="重做">↪</button>
      </div>
      <div class="toolbar-spacer"></div>
      <button class="nb-preview-toggle" :class="{ active: showPreview }" @click="showPreview = !showPreview" title="切换预览">
        {{ showPreview ? '编辑' : '预览' }}
      </button>
      <span class="save-status" :class="saveStatus">{{ saveLabel }}</span>
      <span class="word-count">{{ wordCount }} 字</span>
    </div>
    <div class="nb-tt-body">
      <div v-if="!showPreview" class="nb-editor-wrap">
        <EditorContent v-if="editor" :editor="editor" />
        <textarea v-else v-model="fallbackContent" class="editor-fallback" aria-label="文本编辑器（备选）" @input="onFallbackInput" />
      </div>
      <div v-else class="nb-preview-wrap" v-html="previewHtml"></div>
    </div>
    <MentionPopover ref="mentionPopoverRef" @select="onMentionSelect" @close="() => {}" />
    <SlashCommandMenu ref="slashCommandMenuRef" @select="onSlashCommandSelect" @close="() => {}" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { EditorContent } from '@tiptap/vue-3'
import { marked } from 'marked'
import MentionPopover from '../../manuscript/components/MentionPopover.vue'
import SlashCommandMenu from '../../manuscript/components/SlashCommandMenu.vue'
import { useNoteEditor } from '../composables/useNoteEditor'
import type { SlashCommandItem } from '../composables/slashCommandExtension'
import type { Entity } from '@worldsmith/entity-core'

type SlashCommandPopoverApi = {
  open: (clientRect: (() => DOMRect | null) | null, items: SlashCommandItem[]) => void
  close: () => void
  updateItems: (items: SlashCommandItem[]) => void
  onKeyDown: (event: KeyboardEvent) => boolean
}

const props = defineProps<{ note: Entity }>()
const emit = defineEmits<{ contentChange: [html: string] }>()

const showPreview = ref(false)
const fallbackContent = ref(String(props.note.properties?.content || ''))

function onFallbackInput(e: Event) {
  const val = (e.target as HTMLTextAreaElement).value
  fallbackContent.value = val
  emit('contentChange', val)
}

const {
  editor,
  saveStatus,
  wordCount,
  loadNote,
  setMentionPopover,
  onMentionSelect,
  setSlashCommandPopover,
  setSlashCommandCallback,
  onSlashCommandSelect,
} = useNoteEditor(
  computed(() => props.note),
  (html) => emit('contentChange', html),
)

const mentionPopoverRef = ref<{ open: (clientRect: (() => DOMRect | null) | null) => void; close: () => void } | null>(null)
const slashCommandMenuRef = ref<SlashCommandPopoverApi | null>(null)

onMounted(() => {
  setMentionPopover(mentionPopoverRef.value)
  setSlashCommandPopover(slashCommandMenuRef.value)
  loadNote(props.note)
})

watch(() => props.note, (n) => {
  if (n) loadNote(n)
})

const headingLevel = computed(() => {
  if (!editor.value) return '0'
  for (let i = 1; i <= 3; i++) {
    if (editor.value.isActive('heading', { level: i })) return String(i)
  }
  return '0'
})

const saveLabel = computed(() => {
  switch (saveStatus.value) {
    case 'saved': return '已保存'
    case 'saving': return '保存中...'
    case 'unsaved': return '未保存'
  }
})

const previewHtml = computed(() => {
  const content = editor.value?.getHTML() || ''
  return marked.parse(content) as string
})

function setHeading(e: Event) {
  const val = parseInt((e.target as HTMLSelectElement).value, 10)
  if (val === 0) {
    editor.value?.chain().focus().setParagraph().run()
  } else {
    editor.value?.chain().focus().toggleHeading({ level: val as 1 | 2 | 3 }).run()
  }
}

onBeforeUnmount(() => {
  setSlashCommandCallback(null as any)
})
</script>

<style scoped>
.nb-tiptap-editor { display: flex; flex-direction: column; height: 100%; }
.nb-tt-toolbar {
  display: flex; align-items: center; gap: 4px; padding: 6px 10px;
  border-bottom: 1px solid var(--color-border-subtle); background: var(--color-bg-surface);
  flex-shrink: 0; flex-wrap: wrap; font-family: var(--font-family-editor-ui);
}
.toolbar-group { display: flex; gap: 2px; }
.toolbar-divider { width: 1px; height: 20px; background: var(--color-border-subtle); margin: 0 4px; }
.toolbar-spacer { flex: 1; }
.tb-btn {
  width: 28px; height: 28px; border: none; background: transparent;
  cursor: pointer; border-radius: 4px; font-size: var(--font-size-sm);
  color: var(--color-text-secondary); display: flex; align-items: center; justify-content: center;
}
.tb-btn:hover { background: var(--color-bg-hover); }
.tb-btn.active { background: color-mix(in srgb, var(--color-primary) 15%, transparent); color: var(--color-primary); }
.tb-btn:disabled { opacity: 0.3; cursor: default; }
.toolbar-select {
  padding: 2px 6px; border: 1px solid var(--color-border); border-radius: 4px;
  font-size: var(--font-size-sm); background: var(--color-bg-base); color: var(--color-text-primary);
}
.nb-preview-toggle {
  padding: 2px 8px; border: 1px solid var(--color-border); border-radius: 4px;
  font-size: var(--font-size-xs); background: transparent; color: var(--color-text-secondary); cursor: pointer;
}
.nb-preview-toggle.active { background: color-mix(in srgb, var(--color-primary) 15%, transparent); color: var(--color-primary); border-color: var(--color-primary); }
.save-status { font-size: var(--font-size-xs); margin-right: 8px; }
.save-status.saved { color: var(--color-text-tertiary); }
.save-status.saving { color: var(--color-primary); }
.save-status.unsaved { color: var(--color-warning); }
.word-count { font-size: var(--font-size-xs); color: var(--color-text-tertiary); }

.nb-tt-body { flex: 1; overflow: auto; padding: 16px 20px; }
.nb-editor-wrap { height: 100%; }
.nb-editor-wrap :deep(.tiptap) {
  outline: none; min-height: 200px; font-family: var(--font-family-content);
  font-size: var(--font-size-base); line-height: 1.7; color: var(--color-text-primary);
}
.nb-editor-wrap :deep(.tiptap h1) { font-size: var(--font-size-2xl); font-weight: var(--font-weight-bold); margin: 20px 0 12px; }
.nb-editor-wrap :deep(.tiptap h2) { font-size: var(--font-size-xl); font-weight: var(--font-weight-semibold); margin: 16px 0 10px; }
.nb-editor-wrap :deep(.tiptap h3) { font-size: var(--font-size-lg); font-weight: var(--font-weight-semibold); margin: 12px 0 8px; }
.nb-editor-wrap :deep(.tiptap p) { margin: 0 0 8px; }
.nb-editor-wrap :deep(.tiptap blockquote) {
  border-left: 3px solid var(--color-primary); padding-left: 12px; margin: 8px 0; color: var(--color-text-secondary);
}
.nb-editor-wrap :deep(.tiptap ul), .nb-editor-wrap :deep(.tiptap ol) { padding-left: 20px; margin: 8px 0; }
.nb-editor-wrap :deep(.tiptap hr) { border: none; border-top: 1px solid var(--color-border-subtle); margin: 16px 0; }
.nb-editor-wrap :deep(.tiptap code) { background: var(--color-bg-hover); padding: 2px 4px; border-radius: 3px; font-size: var(--font-size-sm); }
.nb-editor-wrap :deep(.tiptap pre) {
  background: var(--color-bg-hover); padding: 12px; border-radius: 6px; overflow-x: auto;
  font-size: var(--font-size-sm); margin: 8px 0;
}
.nb-editor-wrap :deep(.nb-mention) {
  background: color-mix(in srgb, var(--color-primary) 15%, transparent);
  color: var(--color-primary); padding: 1px 6px; border-radius: 4px;
  font-size: var(--font-size-sm); font-weight: var(--font-weight-medium); cursor: pointer;
}
.nb-editor-wrap :deep(.nb-mention:hover) { background: var(--color-primary); color: white; }

.nb-preview-wrap { font-family: var(--font-family-content); font-size: var(--font-size-base); line-height: 1.7; color: var(--color-text-primary); }
.nb-preview-wrap :deep(h1) { font-size: var(--font-size-2xl); font-weight: var(--font-weight-bold); margin: 20px 0 12px; }
.nb-preview-wrap :deep(h2) { font-size: var(--font-size-xl); font-weight: var(--font-weight-semibold); margin: 16px 0 10px; }
.nb-preview-wrap :deep(h3) { font-size: var(--font-size-lg); font-weight: var(--font-weight-semibold); margin: 12px 0 8px; }
.nb-preview-wrap :deep(blockquote) {
  border-left: 3px solid var(--color-primary); padding-left: 12px; margin: 8px 0; color: var(--color-text-secondary);
}
.nb-preview-wrap :deep(code) { background: var(--color-bg-hover); padding: 2px 4px; border-radius: 3px; font-size: var(--font-size-sm); }
.nb-preview-wrap :deep(pre) { background: var(--color-bg-hover); padding: 12px; border-radius: 6px; overflow-x: auto; margin: 8px 0; }

.editor-fallback { width: 100%; height: 100%; min-height: 200px; border: 1px solid var(--color-border-subtle); border-radius: 6px; padding: 12px; font-family: var(--font-family-content); font-size: var(--font-size-base); line-height: 1.7; color: var(--color-text-primary); background: var(--color-bg-base); resize: vertical; outline: none; }
.editor-fallback:focus { border-color: var(--color-primary); }
.editor-loading { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--color-text-tertiary); }
</style>
