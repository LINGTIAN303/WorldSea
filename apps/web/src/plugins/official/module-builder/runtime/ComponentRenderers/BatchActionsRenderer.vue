<template>
  <div class="batch-actions-renderer">
    <button v-for="action in actions" :key="action" class="ba-btn" @click="onBatchAction(action)">
      {{ actionLabel(action) }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue'
import type { ModuleRuntimeContext } from '../ModuleRuntimeContext'

const props = defineProps<{ config: Record<string, unknown>; componentId: string }>()
const ctx = inject<ModuleRuntimeContext | null>('moduleRuntimeContext', null)

const actions = computed(() => (props.config.actions as string[]) || ['delete'])

function actionLabel(action: string): string {
  const map: Record<string, string> = { delete: '批量删除', export: '批量导出' }
  return map[action] || action
}

function onBatchAction(action: string) {
  ctx?.emit('batch:action', { action })
}
</script>

<style scoped>
.batch-actions-renderer { display: flex; gap: 6px; padding: 6px 12px; }
.ba-btn { padding: 4px 10px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg); color: var(--text-color); font-size: var(--font-size-sm); cursor: pointer; }
.ba-btn:hover { background: var(--hover-bg); }
</style>
