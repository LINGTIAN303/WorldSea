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
        <span class="sl-item__icon"><StepTypeIcon :type="item.type" :size="18" /></span>
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
import StepTypeIcon from '../components/StepTypeIcon.vue'
import type { StepLibraryItem } from '../types'

defineEmits<{
  'add-step': [item: StepLibraryItem]
  'drag-start': [item: StepLibraryItem]
}>()

const { searchQuery, filteredLibrary } = useStepLibrary()
</script>

<style scoped>
.sl-view { padding: 12px; display: flex; flex-direction: column; gap: 8px; height: 100%; }
.sl-title { margin: 0; font-size: var(--fs-base); font-weight: 600; }
.sl-search {
  padding: 6px 10px; border-radius: var(--radius-sm); border: 1px solid var(--border, #e4e4e7);
  background: var(--bg-secondary, #f4f4f5); color: var(--text-primary, #18181b);
  font-size: var(--fs-sm); outline: none;
}
.sl-list { display: flex; flex-direction: column; gap: 4px; overflow: auto; }
.sl-item {
  display: flex; align-items: flex-start; gap: 8px; padding: 8px 10px;
  border-radius: var(--radius-sm); cursor: pointer; transition: background 0.15s;
  border: 1px solid transparent;
}
.sl-item:hover { background: var(--bg-tertiary, #e4e4e7); border-color: var(--border, #e4e4e7); }
.sl-item__icon { font-size: 18px; flex-shrink: 0; }
.sl-item__info { display: flex; flex-direction: column; gap: 2px; }
.sl-item__label { font-size: var(--fs-md); font-weight: 500; }
.sl-item__desc { font-size: var(--fs-xs); opacity: 0.5; line-height: 1.3; }
</style>
