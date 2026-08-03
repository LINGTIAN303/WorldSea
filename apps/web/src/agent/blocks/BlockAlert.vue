<template>
  <div class="block-alert" :class="`alert-${block.level}`">
    <div class="alert-bar"></div>
    <div class="alert-body">
      <span class="alert-icon">{{ levelIcon }}</span>
      <div class="alert-content">
        <span v-if="block.title" class="alert-title">{{ block.title }}</span>
        <span class="alert-message">{{ block.message }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { AlertBlock } from '@agent/index'

const props = defineProps<{
  block: AlertBlock
}>()

const ICONS: Record<string, string> = { info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌' }
const levelIcon = computed(() => ICONS[props.block.level] || 'ℹ️')
</script>

<style scoped>
.block-alert {
  display: flex; border-radius: 8px; overflow: hidden;
  background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08);
  margin: 4px 0;
}
.alert-bar { width: 3px; flex-shrink: 0; }
.alert-info .alert-bar { background: #3b82f6; }
.alert-success .alert-bar { background: #22c55e; }
.alert-warning .alert-bar { background: #eab308; }
.alert-error .alert-bar { background: #ef4444; }
.alert-body { display: flex; align-items: flex-start; gap: 8px; padding: 8px 12px; flex: 1; }
.alert-icon { font-size: 14px; flex-shrink: 0; margin-top: 1px; }
.alert-content { display: flex; flex-direction: column; gap: 2px; }
.alert-title { font-size: 13px; font-weight: 600; color: var(--agent-text, #e0e0e0); }
.alert-message { font-size: 12px; color: var(--agent-text-secondary, #aaa); line-height: 1.4; }
</style>
