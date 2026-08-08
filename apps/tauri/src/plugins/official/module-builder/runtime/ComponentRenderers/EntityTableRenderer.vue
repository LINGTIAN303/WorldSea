<template>
  <div class="entity-table-renderer">
    <WsEmpty v-if="displayList.length === 0" preset="no-data" />
    <table v-else class="et-table">
      <thead>
        <tr>
          <th v-for="col in columns" :key="col.key" class="et-th" @click="onSort(col.key)">
            {{ col.label }}
            <span v-if="ctx?.sortConfig.value?.field === col.key" class="et-sort">{{ ctx.sortConfig.value.direction === 'asc' ? '↑' : '↓' }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="entity in displayList"
          :key="entity.id"
          class="et-row"
          :class="{ selected: ctx?.selectedEntityId.value === entity.id }"
          @click="onSelect(entity)"
        >
          <td v-for="col in columns" :key="col.key" class="et-td">
            {{ col.key === 'name' ? entity.name : col.key === 'description' ? entity.description : entity.properties[col.key] ?? '—' }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue'
import { WsEmpty } from '@worldsmith/ui-kit'
import type { ModuleRuntimeContext } from '../ModuleRuntimeContext'

const props = defineProps<{ config: Record<string, unknown>; componentId: string }>()
const ctx = inject<ModuleRuntimeContext | null>('moduleRuntimeContext', null)

const displayList = computed(() => ctx?.filteredList.value || [])

const columns = computed(() => {
  const types = ctx?.manifest.entityTypes || []
  const et = types.find(t => t.name === props.config.entityType)
  const base = [{ key: 'name', label: '名称' }]
  if (!et) return base
  const show = props.config.displayColumns as string[] | undefined
  if (show && show.length > 0) return [...base, ...et.fields.filter(f => show.includes(f.key))]
  return [...base, ...et.fields.slice(0, 5)]
})

function onSelect(entity: any) {
  if (ctx) ctx.selectedEntityId.value = entity.id
}

function onSort(field: string) {
  const current = ctx?.sortConfig.value
  if (current?.field === field) {
    ctx?.setSortConfig({ field, direction: current.direction === 'asc' ? 'desc' : 'asc' })
  } else {
    ctx?.setSortConfig({ field, direction: 'asc' })
  }
}
</script>

<style scoped>
.entity-table-renderer { overflow: auto; height: 100%; }
.et-table { width: 100%; border-collapse: collapse; font-size: var(--font-size-sm); }
.et-th { padding: 8px 10px; text-align: left; font-size: var(--font-size-xs); color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid var(--border-color); cursor: pointer; user-select: none; white-space: nowrap; }
.et-th:hover { color: var(--text-secondary); }
.et-sort { font-size: var(--font-size-xs); color: var(--primary); }
.et-row { cursor: pointer; transition: background 0.1s; }
.et-row:hover { background: var(--hover-bg); }
.et-row.selected { background: rgba(79, 70, 229, 0.08); }
.et-td { padding: 6px 10px; border-bottom: 1px solid var(--border-color); color: var(--text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px; }
</style>
