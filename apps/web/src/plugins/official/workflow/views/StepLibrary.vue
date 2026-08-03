<template>
  <div class="sl-view">
    <h3 class="sl-title">步骤库</h3>
    <input
      v-model="searchQuery"
      class="sl-search"
      placeholder="搜索步骤..."
    />
    <div class="sl-list">
      <div
        v-for="item in filteredLibrary"
        :key="item.type"
        class="sl-item"
        draggable="true"
        @dragstart="$emit('drag-start', item)"
        @click="$emit('add-step', item)"
      >
        <span class="sl-item__icon">{{ item.icon }}</span>
        <div class="sl-item__info">
          <span class="sl-item__label">{{ item.label }}</span>
          <span class="sl-item__desc">{{ item.description }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useStepLibrary } from '../composables/useStepLibrary'
import type { StepLibraryItem } from '../types'

defineEmits<{
  'add-step': [item: StepLibraryItem]
  'drag-start': [item: StepLibraryItem]
}>()

const { searchQuery, filteredLibrary } = useStepLibrary()
</script>

<style scoped>
.sl-view { padding: 12px; display: flex; flex-direction: column; gap: 8px; height: 100%; }
.sl-title { margin: 0; font-size: 14px; font-weight: 600; }
.sl-search {
  padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border, #30363d);
  background: var(--bg-secondary, #161b22); color: var(--text-primary, #e6edf3);
  font-size: 12px; outline: none;
}
.sl-list { display: flex; flex-direction: column; gap: 4px; overflow: auto; }
.sl-item {
  display: flex; align-items: flex-start; gap: 8px; padding: 8px 10px;
  border-radius: 6px; cursor: pointer; transition: background 0.15s;
  border: 1px solid transparent;
}
.sl-item:hover { background: var(--bg-tertiary, #21262d); border-color: var(--border, #30363d); }
.sl-item__icon { font-size: 18px; flex-shrink: 0; }
.sl-item__info { display: flex; flex-direction: column; gap: 2px; }
.sl-item__label { font-size: 13px; font-weight: 500; }
.sl-item__desc { font-size: 11px; opacity: 0.5; line-height: 1.3; }
</style>
