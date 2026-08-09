<template>
  <div class="combat-stat-view">
    <div v-if="viewMode === 'staircase'" class="csv-staircase">
      <RealmStaircaseView @back="viewMode = 'list'" />
    </div>
    <SchemaRenderer v-else type-key="combat_stat" :schema-loader="loadEntityTypeSchema">
      <template #toolbar-extra>
        <button class="csv-stair-btn" @click="viewMode = 'staircase'" title="境界阶梯/雷达图视图">
          <WsIcon name="chart" :size="14" :stroke-width="1.5" />
          阶梯
        </button>
      </template>
    </SchemaRenderer>
  </div>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
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
