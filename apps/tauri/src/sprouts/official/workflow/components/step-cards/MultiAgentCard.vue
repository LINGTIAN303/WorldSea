<template>
  <div class="mac">
    <div class="mac__field">
      <label class="mac__label">任务意图</label>
      <div v-if="config.intent" class="mac__value">{{ config.intent }}</div>
      <div v-else class="mac__empty">未配置任务意图</div>
    </div>
    <div class="mac__params">
      <span class="mac__param">max-lanes={{ config.maxLanes }}</span>
      <span class="mac__param">子 Agent × {{ config.specs?.length ?? 0 }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { MultiAgentConfig } from '../../types'
defineProps<{ config: MultiAgentConfig }>()
</script>

<style scoped>
.mac {
  font-size: var(--fs-sm);
  line-height: 1.5;
}
.mac__field {
  margin-bottom: 6px;
}
.mac__label {
  font-weight: 500;
  opacity: 0.7;
  display: inline-block;
  margin-right: 4px;
}
.mac__value {
  opacity: 0.8;
  white-space: pre-wrap;
}
.mac__empty {
  opacity: 0.4;
  font-style: italic;
}
.mac__params {
  display: flex;
  gap: 6px;
  margin-top: 4px;
}
.mac__param {
  font-size: var(--fs-xs);
  padding: 2px 6px;
  background: var(--bg-tertiary, #e4e4e7);
  border-radius: var(--radius-xs);
  opacity: 0.6;
}
</style>