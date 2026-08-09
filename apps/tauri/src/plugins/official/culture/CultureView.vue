<template>
  <div class="culture-view">
    <div v-if="viewMode === 'calendar'" class="cv-calendar">
      <FestivalCalendarView @back="viewMode = 'list'" />
    </div>
    <SchemaRenderer v-else type-key="culture" :detail-tabs="cultureTabs" :schema-loader="loadEntityTypeSchema">
      <template #toolbar-extra>
        <button class="cv-cal-btn" @click="viewMode = 'calendar'" title="节日历环视图">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="8" cy="8" r="6.5"/>
            <line x1="8" y1="1.5" x2="8" y2="4"/>
            <line x1="8" y1="12" x2="8" y2="14.5"/>
            <line x1="1.5" y1="8" x2="4" y2="8"/>
            <line x1="12" y1="8" x2="14.5" y2="8"/>
            <circle cx="8" cy="8" r="1.5"/>
          </svg>
          历环
        </button>
      </template>
    </SchemaRenderer>
  </div>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import { SchemaRenderer, type RelationTabDef } from '@worldsmith/plugin-sdk'
import FestivalCalendarView from './FestivalCalendarView.vue'
import { schemaGetEntityType } from '@/core/coreBackend'

/** 实体类型 schema 加载器（从 WASM/后端加载，供 SchemaRenderer 注入） */
const loadEntityTypeSchema = (k: string) => schemaGetEntityType(k)

const viewMode = ref<'list' | 'calendar'>('list')
const cultureTabs: RelationTabDef[] = [
  { id: 'practiced_in', label: '流行地区', icon: 'location', relationType: 'practiced_in' },
  { id: 'practiced_by', label: '所属物种', icon: 'user', relationType: 'practiced_by', reverseDirection: true },
  { id: 'promoted_by', label: '推行势力', icon: 'building', relationType: 'promoted_by', reverseDirection: true },
]
</script>
<style scoped>
.cv-cal-btn {
  display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px;
  border: 1px solid var(--color-border); border-radius: var(--radius-xs); background: var(--color-bg-elevated);
  color: var(--color-text-primary); font-size: var(--font-size-sm); cursor: pointer; transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s; white-space: nowrap;
}
.cv-cal-btn:hover { background: var(--color-bg-hover); border-color: var(--color-text-secondary); color: var(--color-text-primary); }

</style>
