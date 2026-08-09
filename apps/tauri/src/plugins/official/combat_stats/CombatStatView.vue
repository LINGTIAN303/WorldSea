<template>
  <div class="combat-stat-view">
    <div v-if="viewMode === 'staircase'" class="csv-staircase">
      <RealmStaircaseView @back="viewMode = 'list'" />
    </div>
    <SchemaRenderer v-else type-key="combat_stat" :schema-loader="loadEntityTypeSchema">
      <template #toolbar-extra>
        <button class="csv-stair-btn" @click="viewMode = 'staircase'" title="境界阶梯/雷达图视图">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="1" y="12" width="3" height="3" rx="0.5"/>
            <rect x="5" y="8" width="3" height="7" rx="0.5"/>
            <rect x="9" y="4" width="3" height="11" rx="0.5"/>
            <rect x="13" y="1" width="2" height="14" rx="0.5"/>
          </svg>
          阶梯
        </button>
      </template>
    </SchemaRenderer>
  </div>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import { SchemaRenderer } from '@worldsmith/plugin-sdk'
import RealmStaircaseView from './RealmStaircaseView.vue'
import { schemaGetEntityType } from '@/core/coreBackend'

/** 实体类型 schema 加载器（从 WASM/后端加载，供 SchemaRenderer 注入） */
const loadEntityTypeSchema = (k: string) => schemaGetEntityType(k)

const viewMode = ref<'list' | 'staircase'>('list')
</script>
<style scoped>
.csv-stair-btn {
  display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px;
  border: 1px solid var(--color-border); border-radius: var(--radius-xs); background: var(--color-bg-elevated);
  color: var(--color-text-primary); font-size: var(--font-size-sm); cursor: pointer; transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s; white-space: nowrap;
}
.csv-stair-btn:hover { background: var(--color-bg-hover); border-color: var(--color-text-secondary); color: var(--color-text-primary); }

</style>
