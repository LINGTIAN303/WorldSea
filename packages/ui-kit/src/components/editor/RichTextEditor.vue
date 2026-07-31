<template>
  <div class="rich-editor">
    <div v-if="showToolbar" class="editor-toolbar">
      <button class="et-btn" @click="toggleBold" :class="{ active: bold }"><strong>B</strong></button>
      <button class="et-btn" @click="toggleItalic" :class="{ active: italic }"><em>I</em></button>
      <button class="et-btn" @click="toggleStrike" :class="{ active: strike }"><s>S</s></button>
      <span class="et-sep"></span>
      <button class="et-btn" @click="toggleBulletList" :class="{ active: bulletList }">?</button>
      <button class="et-btn" @click="toggleOrderedList" :class="{ active: orderedList }">1.</button>
      <span class="et-sep"></span>
      <button class="et-btn" @click="toggleBlockquote" :class="{ active: blockquote }">"</button>
      <button class="et-btn" @click="setHorizontalRule" title="HR">?</button>
      <span class="et-sep"></span>
      <button class="et-btn" @click="toggleHeading(1)" :class="{ active: headingLevel === 1 }">H1</button>
      <button class="et-btn" @click="toggleHeading(2)" :class="{ active: headingLevel === 2 }">H2</button>
      <button class="et-btn" @click="toggleHeading(3)" :class="{ active: headingLevel === 3 }">H3</button>
    </div>
    <div
      ref="editorRef"
      class="editor-content"
      contenteditable="plaintext-only"
      @input="onInput"
      @focus="onFocus"
    ></div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{ modelValue: string; showToolbar?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const editorRef = ref<HTMLDivElement | null>(null)
const bold = ref(false); const italic = ref(false); const strike = ref(false)
const bulletList = ref(false); const orderedList = ref(false)
const blockquote = ref(false); const headingLevel = ref(0)

watch(() => props.modelValue, (val) => {
  if (editorRef.value && document.activeElement !== editorRef.value) {
    editorRef.value.textContent = val || ''
  }
}, { immediate: true })

function onInput(e: Event) {
  const text = (e.target as HTMLElement)?.textContent || ''
  emit('update:modelValue', text)
}
function onFocus() {}

function toggleBold() { document.execCommand('bold'); bold.value = !bold.value; editorRef.value?.focus() }
function toggleItalic() { document.execCommand('italic'); italic.value = !italic.value; editorRef.value?.focus() }
function toggleStrike() { document.execCommand('strikeThrough'); strike.value = !strike.value; editorRef.value?.focus() }
function toggleBulletList() { document.execCommand('insertUnorderedList'); bulletList.value = !bulletList.value; editorRef.value?.focus() }
function toggleOrderedList() { document.execCommand('insertOrderedList'); orderedList.value = !orderedList.value; editorRef.value?.focus() }
function toggleBlockquote() { document.execCommand('formatBlock', false, '<blockquote>'); blockquote.value = !blockquote.value; editorRef.value?.focus() }
function setHorizontalRule() { document.execCommand('insertHorizontalRule'); editorRef.value?.focus() }
function toggleHeading(level: number) {
  if (headingLevel.value === level) {
    document.execCommand('formatBlock', false, '<p>'); headingLevel.value = 0
  } else {
    document.execCommand('formatBlock', false, '<h' + level + '>'); headingLevel.value = level
  }
  editorRef.value?.focus()
}


</script>

<style scoped>
.rich-editor { border: 1px solid var(--border-color); border-radius: var(--radius-md); overflow: hidden; }
.rich-editor:focus-within { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(79,70,229,0.1); }
.editor-toolbar { display: flex; align-items: center; gap: 2px; padding: 6px 8px; border-bottom: 1px solid var(--border-color); flex-wrap: wrap; }
.et-btn { width: 28px; height: 28px; border: none; background: transparent; border-radius: var(--radius-sm); cursor: pointer; font-size: var(--font-size-sm); color: var(--text-secondary); display: flex; align-items: center; justify-content: center; }
.et-btn:hover { background: var(--hover-bg); color: var(--text-color); }
.et-btn.active { background: var(--primary-light); color: var(--primary); }
.et-sep { width: 1px; height: 18px; background: var(--border-color); margin: 0 4px; }
.editor-content { padding: 12px; min-height: 200px; outline: none; cursor: text; line-height: 1.7; word-wrap: break-word; white-space: pre-wrap; }
.editor-content:empty:before { content: attr(data-placeholder); color: var(--text-tertiary); pointer-events: none; }
</style>