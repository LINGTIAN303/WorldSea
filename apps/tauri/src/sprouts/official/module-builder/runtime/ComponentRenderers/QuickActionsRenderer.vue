<template>
  <div class="quick-actions-renderer">
    <button v-for="action in actions" :key="action" class="qa-btn" @click="onAction(action)">
      <WsIcon :name="actionLabel(action)" size="xs" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import type { ModuleRuntimeContext } from '../ModuleRuntimeContext'

const props = defineProps<{ config: Record<string, unknown>; componentId: string }>()
const ctx = inject<ModuleRuntimeContext | null>('moduleRuntimeContext', null)

const actions = computed(() => (props.config.actions as string[]) || [])

function actionLabel(action: string): string {
  const map: Record<string, string> = { create: 'edit', delete: 'delete', save: 'item', refresh: 'delete' }
  return map[action] || action
}

function onAction(action: string) {
  ctx?.emit(`quick:${action}`)
}
</script>

<style scoped>
.quick-actions-renderer { display: flex; gap: 4px; padding: 4px 8px; }
.qa-btn { width: 28px; height: 28px; border: none; border-radius: 50%; background: var(--bg-secondary); color: var(--text-secondary); font-size: var(--font-size-base); cursor: pointer; display: flex; align-items: center; justify-content: center; }
.qa-btn:hover { background: var(--hover-bg); color: var(--primary); }
</style>
