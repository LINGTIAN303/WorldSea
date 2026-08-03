<template>
  <div class="block-progress" :class="`progress-${block.status}`">
    <div class="progress-header">
      <span class="progress-icon"><WsIcon :name="statusIcon" size="xs" /></span>
      <span class="progress-label">{{ block.label }}</span>
      <span class="progress-pct">{{ block.progress }}%</span>
    </div>
    <div class="progress-track">
      <div class="progress-fill" :style="{ width: block.progress + '%' }"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ProgressBlock } from '@worldsmith/agent-runtime'
import { WsIcon } from '@worldsmith/ui-kit'

const props = defineProps<{ block: ProgressBlock }>()
const ICONS: Record<string, string> = { running: 'loader', completed: 'check-circle', failed: 'x-circle' }
const statusIcon = computed(() => ICONS[props.block.status] || 'loader')
</script>

<style scoped>
.block-progress {
  padding: 8px 12px; border-radius: 8px; margin: 4px 0;
  background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08);
  border-left: 3px solid var(--agent-primary, #6c5ce7);
}
.progress-header { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.progress-icon { font-size: 13px; }
.progress-label { font-size: 12px; color: var(--agent-text, #e0e0e0); flex: 1; }
.progress-pct { font-size: 12px; color: var(--agent-accent, #b388ff); font-weight: 600; }
.progress-track {
  height: 4px; border-radius: 2px; background: rgba(255,255,255,0.08); overflow: hidden;
}
.progress-fill {
  height: 100%; border-radius: 2px; transition: width 0.3s ease;
  background: var(--agent-primary, #6c5ce7);
}
.progress-completed .progress-fill { background: #22c55e; }
.progress-failed .progress-fill { background: #ef4444; }
.progress-running .progress-fill {
  background: linear-gradient(90deg, var(--agent-primary, #6c5ce7), var(--agent-accent, #b388ff));
  animation: ws-pulse 1.5s infinite;
}

</style>
