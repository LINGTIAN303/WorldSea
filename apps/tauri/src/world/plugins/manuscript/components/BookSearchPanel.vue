<template>
  <div :ref="panelRef" class="ms-book-search" :style="panelStyle">
    <div class="ms-bs-head">
      <span class="ms-bs-title">全书搜索</span>
      <button class="ms-bs-close" aria-label="关闭全书搜索" @click="$emit('close')"><WsIcon name="close" size="xs" /></button>
    </div>
    <input
      ref="inputRef"
      v-model="term"
      class="ms-bs-input"
      placeholder="搜索当前书籍的全部章节…"
      @keyup.enter="onEnter"
    />
    <div class="ms-bs-results">
      <div
        v-for="hit in hits"
        :key="hit.chapterId"
        class="ms-bs-item"
        role="button"
        tabindex="0"
        @click="$emit('jump', { chapterId: hit.chapterId, term: term.trim() })"
        @keydown.enter.prevent="$emit('jump', { chapterId: hit.chapterId, term: term.trim() })"
      >
        <span class="ms-bs-chapter">{{ hit.chapterName }}</span>
        <span class="ms-bs-snippet">{{ hit.snippet.slice(0, hit.matchStart) }}<mark>{{ hit.snippet.slice(hit.matchStart, hit.matchStart + hit.matchLen) }}</mark>{{ hit.snippet.slice(hit.matchStart + hit.matchLen) }}</span>
        <span class="ms-bs-count">{{ hit.count }} 处</span>
      </div>
      <p v-if="term.trim() && hits.length === 0" class="ms-bs-empty">全书没有匹配「{{ term.trim() }}」的章节</p>
      <p v-else-if="!term.trim()" class="ms-bs-empty">输入关键词，搜索书内全部章节；点击结果跳转并高亮</p>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 全书跨章搜索面板（批3）：编辑器头部按钮触发的锚定面板（useAnchoredPanel）。
 * 搜索对书内全部章节的存储内容离线扫描（useBookSearch，不逐章装载编辑器）；
 * 点击结果由父级跳章并自动打开查找条（编辑器内高亮/滚动复用批1机制，零新机制）。
 */
import { ref, computed, onMounted } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import type { Entity } from '@worldsea/entity-core'
import { useAnchoredPanel } from '@/composables/useAnchoredPanel'
import { searchBookChapters } from '../composables/useBookSearch'

const props = defineProps<{
  anchor: HTMLElement | null
  /** 当前书内全部章节（含未打开的——搜索读存储内容，不依赖编辑器装载） */
  chapters: Entity[]
}>()

const emit = defineEmits<{
  jump: [payload: { chapterId: string; term: string }]
  close: []
}>()

const { panelRef, panelStyle } = useAnchoredPanel(() => props.anchor, () => emit('close'), { bottomGuard: 360 })

const term = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

const hits = computed(() => searchBookChapters(props.chapters, term.value))

function onEnter() {
  const first = hits.value[0]
  if (first) emit('jump', { chapterId: first.chapterId, term: term.value.trim() })
}

onMounted(() => {
  inputRef.value?.focus()
})
</script>

<style scoped>
.ms-book-search {
  position: fixed;
  z-index: var(--z-popover, 400);
  width: 380px;
  padding: 12px;
  background: var(--modal-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-mid);
  box-shadow: var(--shadow-md);
  display: flex;
  flex-direction: column;
}
.ms-bs-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.ms-bs-title {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--text-color);
}
.ms-bs-close {
  width: 22px; height: 22px; border: none; background: transparent;
  border-radius: var(--radius-xs); color: var(--text-tertiary); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.ms-bs-close:hover { background: var(--hover-bg); color: var(--primary); }
.ms-bs-input {
  padding: 6px 10px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-xs);
  font-size: var(--font-size-sm);
  background: var(--input-bg);
  color: var(--text-color);
  outline: none;
}
.ms-bs-input:focus { border-color: var(--primary); }
.ms-bs-results {
  margin-top: 8px;
  max-height: 320px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ms-bs-item {
  padding: 6px 8px;
  border-radius: var(--radius-xs);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ms-bs-item:hover { background: var(--hover-bg); }
.ms-bs-chapter { font-size: var(--font-size-xs); color: var(--primary); font-weight: var(--font-weight-medium); }
.ms-bs-snippet { font-size: var(--font-size-xs); color: var(--text-secondary); line-height: 1.6; word-break: break-all; }
.ms-bs-snippet mark { background: var(--primary-light); color: var(--primary); border-radius: 2px; padding: 0 1px; }
.ms-bs-count { font-size: var(--font-size-2xs); color: var(--text-tertiary); }
.ms-bs-empty { margin: 10px 0; font-size: var(--font-size-xs); color: var(--text-tertiary); text-align: center; }
</style>
