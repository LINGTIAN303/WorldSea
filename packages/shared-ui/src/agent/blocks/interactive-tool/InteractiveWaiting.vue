<template>
  <!-- 等待型：动画指示器 -->
  <div class="itc-waiting" :class="tc.status">
    <span class="itc-waiting-dot" :class="tc.status"></span>
    <span class="itc-waiting-name">{{ getToolLabel(tc.name) }}</span>
    <template v-if="tc.status === 'running'">
      <span class="itc-waiting-indicator">
        <span class="itc-waiting-ring"></span>
      </span>
      <span class="itc-waiting-text">等待操作...</span>
    </template>
    <template v-else-if="tc.status === 'completed'">
      <span class="itc-waiting-status completed">完成</span>
    </template>
    <template v-else>
      <span class="itc-waiting-status failed">失败</span>
    </template>
    <span v-if="tc.endedAt && tc.startedAt" class="itc-waiting-dur">{{ formatDuration(tc.startedAt, tc.endedAt) }}</span>
  </div>
</template>

<script setup lang="ts">
import type { ToolCallView } from '@worldsmith/shared-composables/agent/useAgent'
import { getToolLabel, formatDuration } from './utils'

defineProps<{
  tc: ToolCallView
}>()
</script>

<style scoped>
/* ─── 等待型：动画指示器 ─── */
.itc-waiting {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 12px;
  transition: background 0.15s;
}

.itc-waiting:hover {
  background: rgba(255, 255, 255, 0.03);
}

.itc-waiting-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--agent-text-tertiary);
}

.itc-waiting-dot.running {
  background: var(--agent-warning, #eab308);
  animation: itc-pulse 1.5s infinite;
}

.itc-waiting-dot.completed {
  background: var(--agent-segment-output, #34d399);
}

.itc-waiting-dot.failed {
  background: var(--agent-danger, #ef4444);
}

.itc-waiting-name {
  color: var(--agent-text-secondary);
  flex-shrink: 0;
}

.itc-waiting-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.itc-waiting-ring {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 1.5px solid color-mix(in srgb, var(--agent-warning, #eab308) 30%, transparent);
  border-top-color: var(--agent-warning, #eab308);
  animation: itc-spin 1s linear infinite;
}

.itc-waiting-text {
  font-size: 11px;
  color: var(--agent-warning, #eab308);
  animation: itc-caret-pulse 1.5s ease-in-out infinite;
}

.itc-waiting-status {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 6px;
  flex-shrink: 0;
}

.itc-waiting-status.completed {
  background: color-mix(in srgb, var(--agent-segment-output, #34d399) 8%, transparent);
  color: color-mix(in srgb, var(--agent-segment-output, #34d399) 70%, transparent);
}

.itc-waiting-status.failed {
  background: color-mix(in srgb, var(--agent-danger, #ef4444) 8%, transparent);
  color: color-mix(in srgb, var(--agent-danger, #ef4444) 70%, transparent);
}

.itc-waiting-dur {
  font-size: 10px;
  color: var(--agent-text-tertiary);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

/* ─── 等待型动画 ─── */
@keyframes itc-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

@keyframes itc-spin {
  to { transform: rotate(360deg); }
}

@keyframes itc-caret-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
</style>
