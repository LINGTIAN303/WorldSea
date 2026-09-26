<template>
  <div class="tsc">
    <div class="tsc__field">
      <label class="tsc__label">任务意图</label>
      <div v-if="config.intent" class="tsc__value">{{ config.intent }}</div>
      <div v-else class="tsc__empty">未配置任务意图</div>
    </div>
    <div class="tsc__params">
      <span class="tsc__param">k={{ config.branchingK }}</span>
      <span class="tsc__param">top-b={{ config.keepTopB }}</span>
      <span class="tsc__param">max-depth={{ config.maxDepth }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { TotSearchConfig } from '../../types'
defineProps<{ config: TotSearchConfig }>()
</script>

<style scoped>
.tsc {
  font-size: var(--fs-sm);
  line-height: 1.5;
}
.tsc__field {
  margin-bottom: 6px;
}
.tsc__label {
  font-weight: 500;
  opacity: 0.7;
  display: inline-block;
  margin-right: 4px;
}
.tsc__value {
  opacity: 0.8;
  white-space: pre-wrap;
}
.tsc__empty {
  opacity: 0.4;
  font-style: italic;
}
.tsc__params {
  display: flex;
  gap: 6px;
  margin-top: 4px;
}
.tsc__param {
  font-size: var(--fs-xs);
  padding: 2px 6px;
  background: var(--bg-tertiary, #e4e4e7);
  border-radius: var(--radius-xs);
  opacity: 0.6;
}
</style>
