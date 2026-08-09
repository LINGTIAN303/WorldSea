<template>
  <!-- 普通型：原有工具行（无特殊交互） -->
  <div class="itc-normal" :class="tc.status" @click="toggleExpand">
    <span class="itc-normal-dot" :class="tc.status"></span>
    <span class="itc-normal-name">{{ getToolLabel(tc.name) }}</span>
    <span v-if="tc.status === 'running'" class="itc-normal-status running">执行中</span>
    <span v-else-if="tc.status === 'completed'" class="itc-normal-status completed">完成</span>
    <span v-else class="itc-normal-status failed">失败</span>
    <span v-if="tc.endedAt && tc.startedAt" class="itc-normal-dur">{{ formatDuration(tc.startedAt, tc.endedAt) }}</span>
    <span class="itc-normal-chevron" :class="{ expanded: isExpanded }">▸</span>
    <Transition name="itc-detail">
      <div v-if="isExpanded" class="itc-normal-detail" @click.stop>
        <div v-if="Object.keys(tc.args).length > 0" class="itc-detail-section">
          <div class="itc-detail-label">参数</div>
          <pre class="itc-detail-code">{{ formatJson(tc.args) }}</pre>
        </div>
        <div v-if="tc.result" class="itc-detail-section">
          <div class="itc-detail-label">结果</div>
          <pre class="itc-detail-code itc-detail-result">{{ formatResult(tc.result) }}</pre>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { ToolCallView } from '@worldsmith/shared-composables/agent/useAgent'
import { getToolLabel, formatDuration, formatJson, formatResult } from './utils'

defineProps<{
  tc: ToolCallView
}>()

/** 折叠状态：默认折叠 */
const isExpanded = ref(false)

function toggleExpand() {
  isExpanded.value = !isExpanded.value
}
</script>

<style scoped>
/* ─── 普通型 ─── */
.itc-normal {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
  flex-wrap: wrap;
  transition: background 0.1s;
}

.itc-normal:hover {
  background: color-mix(in srgb, var(--bg-surface) 3%, transparent);
}

.itc-normal-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--agent-text-tertiary);
}

.itc-normal-dot.running {
  background: var(--agent-segment-tooling, #38bdf8);
  animation: itc-pulse 1.5s infinite;
}

.itc-normal-dot.completed {
  background: var(--agent-segment-output, #34d399);
}

.itc-normal-dot.failed {
  background: var(--agent-danger, #ef4444);
}

.itc-normal-name {
  color: var(--agent-text-secondary);
  flex-shrink: 0;
}

.itc-normal-status {
  font-size: 10px;
  flex-shrink: 0;
}

.itc-normal-status.running { color: var(--agent-segment-tooling, #38bdf8); }
.itc-normal-status.completed { color: color-mix(in srgb, var(--agent-segment-output, #34d399) 60%, transparent); }
.itc-normal-status.failed { color: color-mix(in srgb, var(--agent-danger, #ef4444) 60%, transparent); }

.itc-normal-dur {
  font-size: 10px;
  color: var(--agent-text-tertiary);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.itc-normal-chevron {
  font-size: 9px;
  color: var(--agent-text-tertiary);
  transition: transform 0.15s;
  flex-shrink: 0;
}

.itc-normal-chevron.expanded {
  transform: rotate(90deg);
}

.itc-normal-detail {
  width: 100%;
  margin-top: 4px;
  padding: 6px 8px;
  background: color-mix(in srgb, var(--bg-app) 15%, transparent);
  border-radius: 6px;
}

.itc-detail-section {
  margin-bottom: 6px;
}

.itc-detail-section:last-child {
  margin-bottom: 0;
}

.itc-detail-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--agent-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
}

.itc-detail-code {
  font-size: 11px;
  line-height: 1.5;
  color: var(--agent-text-secondary);
  padding: 4px 6px;
  border-radius: 4px;
  overflow-x: auto;
  max-height: 150px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
  font-family: 'Consolas', 'Monaco', monospace;
  background: color-mix(in srgb, var(--bg-app) 10%, transparent);
}

.itc-detail-result {
  max-height: 200px;
}

/* ─── 普通型动画 ─── */
@keyframes itc-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.itc-detail-enter-active,
.itc-detail-leave-active {
  transition: max-height 0.15s ease, opacity 0.1s ease;
  max-height: 300px;
  overflow: hidden;
}

.itc-detail-enter-from,
.itc-detail-leave-to {
  max-height: 0;
  opacity: 0;
}
</style>
