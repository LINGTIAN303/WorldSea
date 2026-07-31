<template>
  <div class="language-view">
    <div v-if="viewMode === 'tree'" class="lv-tree">
      <LanguageFamilyTreeView @back="viewMode = 'list'" />
    </div>
    <SchemaRenderer v-else type-key="language" :detail-tabs="languageTabs">
      <template #toolbar-extra>
        <button class="lv-tree-btn" @click="viewMode = 'tree'" title="语系树视图">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="8" cy="2" r="1.5"/><circle cx="3" cy="9" r="1.5"/><circle cx="13" cy="9" r="1.5"/>
            <line x1="8" y1="3.5" x2="3" y2="7.5"/><line x1="8" y1="3.5" x2="13" y2="7.5"/>
            <circle cx="1" cy="14" r="1"/><circle cx="5" cy="14" r="1"/>
            <circle cx="11" cy="14" r="1"/><circle cx="15" cy="14" r="1"/>
            <line x1="3" y1="10.5" x2="1" y2="13"/><line x1="3" y1="10.5" x2="5" y2="13"/>
            <line x1="13" y1="10.5" x2="11" y2="13"/><line x1="13" y1="10.5" x2="15" y2="13"/>
          </svg>
          语系树
        </button>
      </template>
    </SchemaRenderer>
  </div>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import { SchemaRenderer, type RelationTabDef } from '@worldsmith/plugin-sdk'
import LanguageFamilyTreeView from './LanguageFamilyTreeView.vue'

const viewMode = ref<'list' | 'tree'>('list')
const languageTabs: RelationTabDef[] = [
  { id: 'derived_from', label: '分支来源', icon: 'link', relationType: 'derived_from' },
  { id: 'spoken_by', label: '使用者', icon: 'user', relationType: 'spoken_by', reverseDirection: true },
]
</script>
<style scoped>
.lv-tree-btn {
  display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px;
  border: 1px solid var(--color-border); border-radius: 4px; background: var(--color-bg-elevated);
  color: var(--color-text-primary); font-size: var(--font-size-sm); cursor: pointer; transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s; white-space: nowrap;
}
.lv-tree-btn:hover { background: var(--color-bg-hover); border-color: var(--color-text-secondary); color: var(--color-text-primary); }

</style>
