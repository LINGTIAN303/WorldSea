<template>
  <div class="sort-control-renderer">
    <select class="sc-select" v-model="sortField" @change="applySort">
      <option value="">不排序</option>
      <option v-for="f in availableFields" :key="f.key" :value="f.key">{{ f.label }}</option>
    </select>
    <button class="sc-dir" v-if="sortField" @click="toggleDirection">
      {{ sortDir === 'asc' ? '↑' : '↓' }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, inject } from 'vue'
import type { ModuleRuntimeContext } from '../ModuleRuntimeContext'

const props = defineProps<{ config: Record<string, unknown>; componentId: string }>()
const ctx = inject<ModuleRuntimeContext | null>('moduleRuntimeContext', null)

const sortField = ref('')
const sortDir = ref<'asc' | 'desc'>('asc')

const availableFields = computed(() => {
  const base = [{ key: 'name', label: '名称' }, { key: 'description', label: '描述' }, { key: 'createdAt', label: '创建时间' }, { key: 'updatedAt', label: '更新时间' }]
  const types = ctx?.manifest.entityTypes || []
  const et = types.find(t => t.name === props.config.entityType)
  if (!et) return base
  const customFields = et.fields.map(f => ({ key: f.key, label: f.label || f.key }))
  return [...base, ...customFields]
})

function applySort() {
  if (!sortField.value) {
    ctx?.setSortConfig(null)
  } else {
    ctx?.setSortConfig({ field: sortField.value, direction: sortDir.value })
  }
}

function toggleDirection() {
  sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  applySort()
}
</script>

<style scoped>
.sort-control-renderer { display: flex; align-items: center; gap: 4px; padding: 4px 8px; }
.sc-select { padding: 4px 8px; border: 1px solid var(--border-color); border-radius: 4px; font-size: var(--font-size-sm); background: var(--bg); color: var(--text-color); }
.sc-dir { width: 28px; height: 28px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg); cursor: pointer; font-size: var(--font-size-base); color: var(--text-secondary); }
.sc-dir:hover { background: var(--hover-bg); }
</style>
