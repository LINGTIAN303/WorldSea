<template>
  <div class="block-alert" :class="`alert-${block.level}`">
    <div class="alert-bar"></div>
    <div class="alert-body">
      <WsIcon :name="levelIcon" size="xs" class="alert-icon" />
      <div class="alert-content">
        <span v-if="block.title" class="alert-title">{{ block.title }}</span>
        <span class="alert-message">{{ block.message }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import type { AlertBlock } from '@worldsmith/agent-runtime'

const props = defineProps<{
  block: AlertBlock
}>()

/** 等级 → WsIcon 图标名（info/success/warning/error → 线性图标） */
const ICONS: Record<string, string> = { info: 'info', success: 'check', warning: 'warning', error: 'close' }
const levelIcon = computed(() => ICONS[props.block.level] || 'info')
</script>

<style scoped>
.block-alert {
  display: flex; border-radius: 8px; overflow: hidden;
  background: color-mix(in srgb, var(--bg-surface) 3%, transparent); border: 1px solid var(--agent-border);
  margin: 4px 0;
}
.alert-bar { width: 3px; flex-shrink: 0; }
.alert-info .alert-bar { background: var(--agent-info, #3b82f6); }
.alert-success .alert-bar { background: var(--agent-success, #22c55e); }
.alert-warning .alert-bar { background: var(--agent-warning, #eab308); }
.alert-error .alert-bar { background: var(--agent-danger, #ef4444); }
.alert-body { display: flex; align-items: flex-start; gap: 8px; padding: 8px 12px; flex: 1; }
.alert-icon { font-size: 14px; flex-shrink: 0; margin-top: 1px; }
.alert-content { display: flex; flex-direction: column; gap: 2px; }
.alert-title { font-size: 13px; font-weight: 600; color: var(--agent-text, #e0e0e0); }
.alert-message { font-size: 12px; color: var(--agent-text-secondary, #aaa); line-height: 1.4; }
</style>
