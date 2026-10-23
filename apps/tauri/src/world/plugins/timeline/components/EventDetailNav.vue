<template>
  <div class="ed-nav">
    <div class="ed-nav-pager">
      <button
        type="button"
        class="ed-nav-btn"
        :disabled="!hasPrev"
        title="上一个事件（方向键 ←）"
        aria-label="上一个事件"
        @click="$emit('prev')"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </button>
      <span class="ed-nav-pos">{{ index >= 0 ? `${index + 1} / ${total}` : '—' }}</span>
      <button
        type="button"
        class="ed-nav-btn"
        :disabled="!hasNext"
        title="下一个事件（方向键 →）"
        aria-label="下一个事件"
        @click="$emit('next')"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </button>
    </div>
    <button type="button" class="ed-nav-focus" title="切到时间画布并定位到该事件" @click="$emit('focus')">在画布中查看</button>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  /** 当前事件在可见时间序中的下标（-1 = 不在当前筛选结果里） */
  index: number
  total: number
  hasPrev: boolean
  hasNext: boolean
}>()

defineEmits<{ prev: []; next: []; focus: [] }>()
</script>

<style scoped>
.ed-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-color);
}
.ed-nav-pager { display: inline-flex; align-items: center; gap: 4px; }
.ed-nav-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  color: var(--text-secondary);
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-xs);
  cursor: pointer;
}
.ed-nav-btn:hover:not(:disabled) { color: var(--text-color); border-color: var(--primary); }
.ed-nav-btn:disabled { opacity: 0.35; cursor: default; }
.ed-nav-pos {
  min-width: 42px;
  text-align: center;
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}
.ed-nav-focus {
  padding: 0;
  font-size: var(--font-size-xs);
  color: var(--primary);
  background: transparent;
  border: none;
  cursor: pointer;
}
.ed-nav-focus:hover { text-decoration: underline; }
</style>
