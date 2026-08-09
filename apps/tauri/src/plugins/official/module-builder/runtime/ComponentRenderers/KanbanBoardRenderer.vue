<template>
  <div class="kanban-board-renderer">
    <WsEmpty v-if="displayList.length === 0 && columns.length === 0" preset="no-data" />
    <div v-else class="kb-board">
      <div v-for="col in columns" :key="col" class="kb-column">
        <div class="kb-col-header">
          <span class="kb-col-title">{{ col }}</span>
          <span class="kb-col-count">{{ columnEntities(col).length }}</span>
        </div>
        <div class="kb-col-cards">
          <div
            v-for="entity in columnEntities(col)"
            :key="entity.id"
            class="kb-card"
            :class="{ selected: ctx?.selectedEntityId.value === entity.id }"
            @click="onSelect(entity)"
          >
            <span class="kb-card-icon"><WsIcon :name="entityIcon" size="sm" /></span>
            <span class="kb-card-name">{{ entity.name || '(未命名)' }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import { WsEmpty } from '@worldsmith/ui-kit'
import type { ModuleRuntimeContext } from '../ModuleRuntimeContext'

const props = defineProps<{ config: Record<string, unknown>; componentId: string }>()
const ctx = inject<ModuleRuntimeContext | null>('moduleRuntimeContext', null)

const displayList = computed(() => ctx?.filteredList.value || [])

const entityIcon = computed(() => {
  const types = ctx?.manifest.entityTypes || []
  return types.find(t => t.name === props.config.entityType)?.icon || 'manuscript'
})

const groupField = computed(() => props.config.groupField as string || '')

const columns = computed(() => {
  if (!groupField.value) return ['全部']
  const values = new Set<string>()
  for (const e of displayList.value) {
    const val = e.properties?.[groupField.value]
    values.add(String(val ?? '未分类'))
  }
  return Array.from(values)
})

function columnEntities(col: string): any[] {
  if (!groupField.value) return displayList.value
  return displayList.value.filter(e => String(e.properties?.[groupField.value] ?? '未分类') === col)
}

function onSelect(entity: any) {
  if (ctx) ctx.selectedEntityId.value = entity.id
}
</script>

<style scoped>
.kanban-board-renderer { overflow: auto; height: 100%; }
.kb-board { display: flex; gap: 12px; padding: 12px; min-height: 100%; }
.kb-column { min-width: 220px; max-width: 280px; background: var(--bg-secondary); border-radius: var(--radius-mid); display: flex; flex-direction: column; }
.kb-col-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--text-secondary); }
.kb-col-count { font-size: var(--font-size-xs); background: var(--border-color); border-radius: var(--radius-md); padding: 1px 8px; color: var(--text-tertiary); font-weight: var(--font-weight-normal); }
.kb-col-cards { padding: 4px 8px 8px; display: flex; flex-direction: column; gap: 6px; flex: 1; }
.kb-card { background: var(--bg); border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 8px 10px; cursor: pointer; display: flex; align-items: center; gap: 6px; transition: background 0.1s, border-color 0.1s, color 0.1s, box-shadow 0.1s, transform 0.1s, opacity 0.1s, filter 0.1s; }
.kb-card:hover { border-color: var(--primary); box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
.kb-card.selected { border-color: var(--primary); background: var(--accent-soft, rgba(79, 70, 229, 0.08)); }
.kb-card-icon { font-size: var(--font-size-lg); }
.kb-card-name { font-size: var(--font-size-sm); color: var(--text-color); }
</style>
