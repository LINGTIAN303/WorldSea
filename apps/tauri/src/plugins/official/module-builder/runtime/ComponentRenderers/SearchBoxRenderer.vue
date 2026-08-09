<template>
  <div class="search-box-renderer">
    <input
      class="sb-input"
      type="text"
      :placeholder="(config.placeholder as string) || '搜索...'"
      :value="ctx?.searchQuery.value"
      @input="onSearch($event)"
    />
    <button v-if="ctx?.searchQuery.value" class="sb-clear" @click="clearSearch">✕</button>
  </div>
</template>

<script setup lang="ts">
import { inject } from 'vue'
import type { ModuleRuntimeContext } from '../ModuleRuntimeContext'

const props = defineProps<{ config: Record<string, unknown>; componentId: string }>()
const ctx = inject<ModuleRuntimeContext | null>('moduleRuntimeContext', null)

function onSearch(e: Event) {
  const value = (e.target as HTMLInputElement).value
  ctx?.setSearchQuery(value)
}

function clearSearch() {
  ctx?.setSearchQuery('')
}
</script>

<style scoped>
.search-box-renderer { display: flex; align-items: center; gap: 4px; padding: 4px 8px; }
.sb-input { flex: 1; padding: 6px 10px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); font-size: var(--font-size-sm); background: var(--bg); color: var(--text-color); outline: none; }
.sb-input:focus { border-color: var(--primary); }
.sb-clear { width: 24px; height: 24px; border: none; background: transparent; color: var(--text-tertiary); cursor: pointer; font-size: var(--font-size-sm); border-radius: 50%; }
.sb-clear:hover { background: var(--hover-bg); color: var(--text-secondary); }
</style>
