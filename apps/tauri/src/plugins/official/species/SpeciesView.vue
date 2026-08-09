<template>
  <div class="species-view">
    <div v-if="viewMode === 'tree'" class="spv-tree">
      <EvolutionTreeView @back="viewMode = 'list'" />
    </div>
    <SchemaRenderer v-else type-key="species" :detail-tabs="speciesTabs" :schema-loader="loadEntityTypeSchema">
      <template #toolbar-extra>
        <button class="sv-evo-btn" @click="viewMode = 'tree'" title="进化树视图">
          <WsIcon name="family-tree" :size="14" :stroke-width="1.5" />
          进化树
        </button>
      </template>
    </SchemaRenderer>
  </div>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import { SchemaRenderer, type RelationTabDef } from '@worldsmith/plugin-sdk'
import EvolutionTreeView from './EvolutionTreeView.vue'
import { schemaGetEntityType } from '@/core/coreBackend'

/** 实体类型 schema 加载器（从 WASM/后端加载，供 SchemaRenderer 注入） */
const loadEntityTypeSchema = (k: string) => schemaGetEntityType(k)

const viewMode = ref<'list' | 'tree'>('list')
const speciesTabs: RelationTabDef[] = [
  { id: 'evolved_from', label: '进化关系', icon: 'link', relationType: 'evolved_from' },
  { id: 'inhabits', label: '栖息地', icon: 'location', relationType: 'inhabits' },
  { id: 'symbiosis', label: '共生/天敌', icon: 'link', relationType: 'symbiosis' },
]
</script>
<style scoped>
.sv-evo-btn {
  display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px;
  border: 1px solid var(--color-border); border-radius: var(--radius-xs); background: var(--color-bg-elevated);
  color: var(--color-text-primary); font-size: var(--font-size-sm); cursor: pointer; transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s; white-space: nowrap;
}
.sv-evo-btn:hover { background: var(--color-bg-hover); border-color: var(--color-text-secondary); color: var(--color-text-primary); }

</style>
