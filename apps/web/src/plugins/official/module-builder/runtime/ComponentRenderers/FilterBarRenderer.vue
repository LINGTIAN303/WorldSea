<template>
  <div class="filter-bar-renderer">
    <div class="fb-filters">
      <div v-for="(f, idx) in activeFilters" :key="idx" class="fb-chip">
        <span class="fb-chip-text">{{ f.field }} {{ operatorLabel(f.operator) }} {{ f.value }}</span>
        <button class="fb-chip-rm" @click="removeFilter(idx)">✕</button>
      </div>
    </div>
    <div class="fb-add">
      <select v-model="newField" class="fb-select">
        <option value="">选择字段</option>
        <option v-for="f in availableFields" :key="f.key" :value="f.key">{{ f.label }}</option>
      </select>
      <select v-model="newOperator" class="fb-select fb-select-sm">
        <option value="contains">包含</option>
        <option value="equals">等于</option>
        <option value="startsWith">开头</option>
        <option value="endsWith">结尾</option>
        <option value="gt">大于</option>
        <option value="lt">小于</option>
        <option value="gte">≥</option>
        <option value="lte">≤</option>
      </select>
      <input v-model="newValue" class="fb-input" placeholder="值" @keyup.enter="addFilter" />
      <button class="fb-add-btn" @click="addFilter">＋</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, inject } from 'vue'
import type { ModuleRuntimeContext, SearchFilter } from '../ModuleRuntimeContext'

const props = defineProps<{ config: Record<string, unknown>; componentId: string }>()
const ctx = inject<ModuleRuntimeContext | null>('moduleRuntimeContext', null)

const newField = ref('')
const newOperator = ref<SearchFilter['operator']>('contains')
const newValue = ref('')

const activeFilters = computed(() => ctx?.filters.value || [])

const availableFields = computed(() => {
  const types = ctx?.manifest.entityTypes || []
  const et = types.find(t => t.name === props.config.entityType)
  return [{ key: 'name', label: '名称' }, { key: 'description', label: '描述' }, ...(et?.fields || [])]
})

function operatorLabel(op: string): string {
  const map: Record<string, string> = { contains: '包含', equals: '等于', startsWith: '开头', endsWith: '结尾', gt: '大于', lt: '小于', gte: '≥', lte: '≤' }
  return map[op] || op
}

function addFilter() {
  if (!newField.value || !newValue.value) return
  const current = [...(ctx?.filters.value || [])]
  current.push({ field: newField.value, operator: newOperator.value, value: newValue.value })
  ctx?.setFilters(current)
  newField.value = ''
  newValue.value = ''
}

function removeFilter(idx: number) {
  const current = [...(ctx?.filters.value || [])]
  current.splice(idx, 1)
  ctx?.setFilters(current)
}
</script>

<style scoped>
.filter-bar-renderer { padding: 6px 8px; display: flex; flex-direction: column; gap: 6px; }
.fb-filters { display: flex; flex-wrap: wrap; gap: 4px; }
.fb-chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; background: var(--bg-secondary); border-radius: 12px; font-size: var(--font-size-xs); color: var(--text-secondary); }
.fb-chip-rm { border: none; background: transparent; color: var(--text-tertiary); cursor: pointer; font-size: var(--font-size-xs); }
.fb-add { display: flex; gap: 4px; align-items: center; }
.fb-select { padding: 4px 6px; border: 1px solid var(--border-color); border-radius: 4px; font-size: var(--font-size-sm); background: var(--bg); color: var(--text-color); }
.fb-select-sm { width: 70px; }
.fb-input { padding: 4px 6px; border: 1px solid var(--border-color); border-radius: 4px; font-size: var(--font-size-sm); width: 80px; background: var(--bg); color: var(--text-color); }
.fb-add-btn { padding: 4px 8px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg); cursor: pointer; font-size: var(--font-size-sm); color: var(--primary); }
</style>
