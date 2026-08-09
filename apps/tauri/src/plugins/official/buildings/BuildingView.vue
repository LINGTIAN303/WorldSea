<template>
  <div class="building-view">
    <div v-if="viewMode === 'section'" class="bv-section">
      <BuildingSectionView @back="viewMode = 'list'" />
    </div>
    <SchemaRenderer v-else type-key="building" :detail-tabs="buildingTabs" :schema-loader="loadEntityTypeSchema">
      <template #toolbar-extra>
        <button class="bv-sec-btn" @click="viewMode = 'section'" title="剖面分层视图">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="2" y="1" width="12" height="14" rx="1"/>
            <line x1="2" y1="5" x2="14" y2="5"/>
            <line x1="2" y1="9" x2="14" y2="9"/>
            <line x1="2" y1="13" x2="14" y2="13"/>
          </svg>
          剖面
        </button>
      </template>
    </SchemaRenderer>
  </div>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import { SchemaRenderer, type RelationTabDef } from '@worldsmith/plugin-sdk'
import BuildingSectionView from './BuildingSectionView.vue'
import { schemaGetEntityType } from '@/core/coreBackend'

/** 实体类型 schema 加载器（从 WASM/后端加载，供 SchemaRenderer 注入） */
const loadEntityTypeSchema = (k: string) => schemaGetEntityType(k)

const viewMode = ref<'list' | 'section'>('list')
const buildingTabs: RelationTabDef[] = [
  { id: 'located_in', label: '所在区域', icon: 'location', relationType: 'located_in' },
  { id: 'owned_by', label: '所属势力', icon: 'building', relationType: 'owned_by' },
  { id: 'resides_at', label: '驻留角色', icon: 'user', relationType: 'resides_at', reverseDirection: true },
]
</script>
<style scoped>
.bv-sec-btn {
  display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px;
  border: 1px solid #21262d; border-radius: var(--radius-xs); background: #21262d;
  color: #c9d1d9; font-size: var(--font-size-sm); cursor: pointer; transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s; white-space: nowrap;
}
.bv-sec-btn:hover { background: #30363d; border-color: #8b949e; color: #e6edf3; }

</style>
