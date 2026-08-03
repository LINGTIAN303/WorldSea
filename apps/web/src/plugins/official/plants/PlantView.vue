<template>
  <div class="plant-view">
    <div v-if="viewMode === 'recipe'" class="pv-recipe">
      <RecipeTreeView @back="viewMode = 'list'" />
    </div>
    <SchemaRenderer v-else type-key="plant" :detail-tabs="plantTabs" :schema-loader="loadEntityTypeSchema">
      <template #toolbar-extra>
        <button class="pv-recipe-btn" @click="viewMode = 'recipe'" title="配方树视图">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="4" cy="12" r="2"/>
            <circle cx="8" cy="6" r="2"/>
            <circle cx="12" cy="12" r="2"/>
            <line x1="4" y1="10" x2="8" y2="8"/>
            <line x1="8" y1="8" x2="12" y2="10"/>
            <circle cx="8" cy="14" r="1.5" fill="currentColor"/>
            <line x1="4" y1="12" x2="8" y2="14"/>
            <line x1="12" y1="12" x2="8" y2="14"/>
          </svg>
          配方树
        </button>
      </template>
    </SchemaRenderer>
  </div>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import { SchemaRenderer, type RelationTabDef } from '@worldsmith/plugin-sdk'
import RecipeTreeView from './RecipeTreeView.vue'
import { schemaGetEntityType } from '@/core/coreBackend'

/** 实体类型 schema 加载器（从 WASM/后端加载，供 SchemaRenderer 注入） */
const loadEntityTypeSchema = (k: string) => schemaGetEntityType(k)

const viewMode = ref<'list' | 'recipe'>('list')
const plantTabs: RelationTabDef[] = [
  { id: 'grows_in', label: '生长区域', icon: 'location', relationType: 'grows_in' },
  { id: 'used_by', label: '用途关联', icon: 'user', relationType: 'used_by', reverseDirection: true },
]
</script>
<style scoped>
.pv-recipe-btn {
  display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px;
  border: 1px solid var(--color-border); border-radius: 4px; background: var(--color-bg-elevated);
  color: var(--color-text-primary); font-size: var(--font-size-sm); cursor: pointer; transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s; white-space: nowrap;
}
.pv-recipe-btn:hover { background: var(--color-bg-hover); border-color: var(--color-text-secondary); color: var(--color-text-primary); }

</style>
