<template>
  <div class="vtf" ref="rootRef">
    <button
      class="vtf-btn"
      :aria-expanded="open"
      aria-haspopup="true"
      aria-label="筛选"
      title="筛选"
      @click="toggle"
      @keydown.enter.prevent="toggle"
      @keydown.space.prevent="toggle"
    >
      <WsIcon name="filter" size="sm" class="vtf-icon" />
      <span class="vtf-label">筛选</span>
      <span class="vtf-arrow" :class="{ open }">▾</span>
    </button>
    <!-- 向右伸展的筛选条：常驻 DOM（v-show），保证 Teleport 目标始终存在 -->
    <div class="vtf-panel" v-show="open">
      <!-- 视图把各自的筛选/排序下拉传送到这里；横排，装不下时滚轮左右移动 -->
      <div id="view-toolbar-filter-body" class="vtf-body" ref="bodyRef" @wheel.prevent="onWheel"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import WsIcon from '../WsIcon.vue'

// 筛选收束控件：默认收缩，点击向右横向伸展，滚轮左右移动展示其余筛选控件
const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)
const bodyRef = ref<HTMLElement | null>(null)

function toggle() { open.value = !open.value }

// 滚轮纵向滚动 → 换算为筛选条横向位移，展示被遮挡的其余筛选控件
function onWheel(e: WheelEvent) {
  const el = bodyRef.value
  if (!el) return
  el.scrollLeft += e.deltaY + e.deltaX
}

function onDocClick(e: MouseEvent) {
  if (rootRef.value && !rootRef.value.contains(e.target as Node)) open.value = false
}
function onDocKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    // capture 阶段消费：筛选下拉打开时 Esc 归下拉（抢在注册表 view 层命中消费之前）
    if (open.value) { e.stopPropagation(); open.value = false }
  }
}

onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onDocKey, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onDocKey, true)
})
</script>

<style scoped>
.vtf {
  position: relative;
  flex-shrink: 0;
}
.vtf-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 8px;
  background: var(--bg, var(--bg-surface));
  border: 1px solid var(--border, var(--color-border));
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  font-family: inherit;
  font-size: var(--font-size-sm);
  transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
}
.vtf-btn:hover {
  background: var(--hover-bg);
  color: var(--text-color);
}
.vtf-icon {
  color: var(--accent);
}
.vtf-arrow {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  transition: transform var(--transition-fast);
}
.vtf-arrow.open {
  transform: rotate(180deg);
}
/* 筛选条：向右横向伸展（宽约容纳 2 个内筛选控件），超宽时横向滚动 */
.vtf-panel {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 300;
  max-width: 340px;
  padding: 8px;
  background: var(--modal-bg, var(--bg-surface));
  border: 1px solid var(--border-color, var(--border));
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-dropdown);
}
.vtf-body {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  overflow-x: auto;
  scrollbar-width: thin;
}
</style>
