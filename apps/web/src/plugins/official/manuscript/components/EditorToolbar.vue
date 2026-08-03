<template>
  <div class="editor-toolbar">
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
    <span class="save-status" :class="saveStatus">{{ saveLabel }}</span>
    <span class="word-count">{{ wordCount }} 字</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Editor } from '@tiptap/vue-3'

const props = defineProps<{
  editor: Editor | null
  saveStatus: 'saved' | 'saving' | 'unsaved'
  wordCount: number
}>()

const headingLevel = computed(() => {
  if (!props.editor) return '0'
  for (let i = 1; i <= 3; i++) {
    if (props.editor.isActive('heading', { level: i })) return String(i)
  }
  return '0'
})

const saveLabel = computed(() => {
  switch (props.saveStatus) {
    case 'saved': return '已保存 ✓'
    case 'saving': return '保存中...'
    case 'unsaved': return '未保存'
  }
})

function setHeading(e: Event) {
  const val = parseInt((e.target as HTMLSelectElement).value, 10)
  if (val === 0) {
    props.editor?.chain().focus().setParagraph().run()
  } else {
    props.editor?.chain().focus().toggleHeading({ level: val as 1 | 2 | 3 }).run()
  }
}
</script>

<style scoped>
.editor-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border-light);
  background: var(--menubar-bg);
  flex-shrink: 0;
  flex-wrap: wrap;
  font-family: var(--font-family-editor-ui);
}
.toolbar-group { display: flex; gap: 2px; }
.toolbar-divider { width: 1px; height: 20px; background: var(--border-light); margin: 0 4px; }
.toolbar-spacer { flex: 1; }
.tb-btn {
  width: 28px; height: 28px; border: none; background: transparent;
  cursor: pointer; border-radius: 4px; font-size: var(--font-size-sm);
  color: var(--text-secondary); display: flex; align-items: center; justify-content: center;
}
.tb-btn:hover { background: var(--hover-bg); }
.tb-btn.active { background: var(--active-bg); color: var(--primary); }
.tb-btn:disabled { opacity: 0.3; cursor: default; }
.toolbar-select {
  padding: 2px 6px; border: 1px solid var(--border-color); border-radius: 4px;
  font-size: var(--font-size-sm); background: var(--input-bg); color: var(--text-color);
}
.save-status { font-size: var(--font-size-xs); margin-right: 8px; }
.save-status.saved { color: var(--text-tertiary); }
.save-status.saving { color: var(--primary); }
.save-status.unsaved { color: var(--warning); }
.word-count { font-size: var(--font-size-xs); color: var(--text-tertiary); }
</style>
