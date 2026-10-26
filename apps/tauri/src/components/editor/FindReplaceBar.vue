<template>
  <div v-show="visible" class="ms-find-bar">
    <div class="ms-find-row">
      <WsIcon name="search" size="xs" class="ms-find-glyph" />
      <input
        ref="findInputRef"
        v-model="searchTerm"
        class="ms-find-input"
        placeholder="查找…"
        @input="onSearchInput"
        @keydown.enter.prevent="onEnter"
        @keydown.escape.stop.prevent="close"
      />
      <span class="ms-find-count" :class="{ miss: searchTerm && matchCount === 0 }">{{ countLabel }}</span>
      <button class="ms-find-btn" title="上一个 (Shift+Enter)" aria-label="上一个匹配" @click="onPrev"><WsIcon name="chevron-down" size="xs" class="ms-flip-up" /></button>
      <button class="ms-find-btn" title="下一个 (Enter)" aria-label="下一个匹配" @click="onNext"><WsIcon name="chevron-down" size="xs" /></button>
      <button class="ms-find-btn ms-find-btn--txt" :class="{ active: showReplace }" title="展开/收起替换" @click="showReplace = !showReplace">替换</button>
      <button class="ms-find-btn" title="关闭 (Esc)" aria-label="关闭查找" @click="close"><WsIcon name="close" size="xs" /></button>
    </div>
    <div v-show="showReplace" class="ms-find-row">
      <input
        ref="replaceInputRef"
        v-model="replaceTerm"
        class="ms-find-input"
        placeholder="替换为…"
        @keydown.enter.prevent="onReplaceCurrent"
        @keydown.escape.stop.prevent="close"
      />
      <button class="ms-find-btn ms-find-btn--txt" @click="onReplaceCurrent">替换</button>
      <button class="ms-find-btn ms-find-btn--txt" @click="onReplaceAll">全部</button>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 章内/笔记内查找替换条（正文写作/笔记本两芽共用）：编辑器容器内的就地条（非浮层），
 * 与 findReplaceExtension（@/composables/）配对——扩展管状态/装饰/快捷键，本组件只管
 * 输入与展示；开关经 defineExpose 供组合函数的扩展回调（Ctrl+F/H/Esc）调用。
 * scrollSelector = 就近滚动容器选择器（正文写作 .editor-wrap / 笔记本 .nb-split-pane）；
 * stop.prevent 的 Esc：阻止冒泡到视图层「Esc 退出专注模式」。
 */
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import { WsIcon } from '@worldsea/ui-kit'
import { getFindState } from '@/composables/findReplaceExtension'

const props = withDefaults(defineProps<{
  /** useXxxEditor 的 editor 为 shallowRef，未就绪时为 undefined（两芽空态都要接受） */
  editor: Editor | null | undefined
  /** 当前匹配滚到可视区时的就近滚动容器（closest 自编辑器 DOM 向上找） */
  scrollSelector?: string
}>(), { scrollSelector: '.editor-wrap' })

const visible = ref(false)
const showReplace = ref(false)
const searchTerm = ref('')
const replaceTerm = ref('')
const matchCount = ref(0)
const currentIdx = ref(0)
const findInputRef = ref<HTMLInputElement | null>(null)
const replaceInputRef = ref<HTMLInputElement | null>(null)

const countLabel = computed(() => {
  if (!searchTerm.value) return ''
  if (!matchCount.value) return '无结果'
  return `${currentIdx.value + 1}/${matchCount.value}`
})

function refreshFromState() {
  const ed = props.editor
  if (!ed) {
    matchCount.value = 0
    currentIdx.value = 0
    return
  }
  const st = getFindState(ed.state)
  matchCount.value = st?.matches.length ?? 0
  currentIdx.value = st?.currentIdx ?? 0
}

// 编辑器内任何事务（输入/替换/搜索）都可能改变匹配集，transaction 事件即刷新计数
watch(() => props.editor, (ed, old) => {
  old?.off('transaction', refreshFromState)
  ed?.on('transaction', refreshFromState)
}, { immediate: true })
onBeforeUnmount(() => props.editor?.off('transaction', refreshFromState))

function onSearchInput() {
  props.editor?.commands.setSearch(searchTerm.value)
}

/** 当前匹配滚到可视区中央（首次打开时同样适用） */
function scrollToCurrent() {
  const ed = props.editor
  if (!ed) return
  const st = getFindState(ed.state)
  const m = st?.matches[st.currentIdx]
  if (!m) return
  const container = ed.view.dom.closest(props.scrollSelector) as HTMLElement | null
  if (!container) return
  const coords = ed.view.coordsAtPos(m.from)
  const rect = container.getBoundingClientRect()
  container.scrollBy({ top: coords.top - (rect.top + rect.height / 2), behavior: 'smooth' })
}

function onNext() {
  props.editor?.commands.findNext()
  scrollToCurrent()
}

function onPrev() {
  props.editor?.commands.findPrev()
  scrollToCurrent()
}

function onEnter(e: KeyboardEvent) {
  if (e.shiftKey) onPrev()
  else onNext()
}

function onReplaceCurrent() {
  props.editor?.commands.replaceCurrent(replaceTerm.value)
  nextTick(scrollToCurrent)
}

function onReplaceAll() {
  props.editor?.commands.replaceAll(replaceTerm.value)
}

function open(focusReplace = false, term?: string) {
  const ed = props.editor
  visible.value = true
  showReplace.value = focusReplace
  if (ed) {
    if (term) {
      // 显式搜索词（全书搜索跳转链路）：直接扫描定位到首处
      searchTerm.value = term
      ed.commands.setSearch(term)
    } else {
      // 预填选区文本（短且单行才填，跨段文本做搜索词没意义）
      const { from, to, empty } = ed.state.selection
      if (!empty && to - from <= 200) {
        const selected = ed.state.doc.textBetween(from, to, '\n')
        if (selected && !selected.includes('\n')) {
          searchTerm.value = selected
          ed.commands.setSearch(selected)
        }
      }
    }
  }
  nextTick(() => {
    ;(focusReplace ? replaceInputRef : findInputRef).value?.focus()
    if (searchTerm.value) scrollToCurrent()
  })
}

function close() {
  visible.value = false
  props.editor?.commands.clearSearch()
}

defineExpose({ open, close, isVisible: () => visible.value })
</script>

<style scoped>
.ms-find-bar {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border-color);
  background: var(--menubar-bg);
  flex-shrink: 0;
}
.ms-find-row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.ms-find-glyph { color: var(--text-tertiary); flex-shrink: 0; }
.ms-find-input {
  flex: 1;
  min-width: 0;
  padding: 4px 8px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-xs);
  font-size: var(--font-size-sm);
  background: var(--input-bg);
  color: var(--text-color);
  outline: none;
}
.ms-find-input:focus { border-color: var(--primary); }
.ms-find-count {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  min-width: 40px;
  text-align: center;
  white-space: nowrap;
}
.ms-find-count.miss { color: var(--warning); }
.ms-find-btn {
  width: 26px; height: 26px;
  border: none; background: transparent;
  border-radius: var(--radius-xs);
  color: var(--text-secondary);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background 0.12s, color 0.12s;
}
.ms-find-btn:hover { background: var(--hover-bg); color: var(--primary); }
.ms-find-btn.active { background: var(--active-bg); color: var(--primary); }
.ms-find-btn--txt { width: auto; min-width: 26px; padding: 0 7px; font-size: var(--font-size-xs); }
.ms-flip-up { transform: rotate(180deg); }
</style>
