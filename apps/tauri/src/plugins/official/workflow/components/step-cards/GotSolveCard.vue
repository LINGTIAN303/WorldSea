<template>
  <div class="gsc">
    <div class="gsc__field">
      <label class="gsc__label">任务意图</label>
      <div v-if="config.intent" class="gsc__value">{{ config.intent }}</div>
      <div v-else class="gsc__empty">未配置任务意图</div>
    </div>
    <div class="gsc__params">
      <span class="gsc__param">max-rounds={{ config.maxRounds }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { GotSolveConfig } from '../../types'
defineProps<{ config: GotSolveConfig }>()
</script>

<style scoped>
.gsc {
  font-size: var(--fs-sm);
  line-height: 1.5;
}
.gsc__field {
  margin-bottom: 6px;
}
.gsc__label {
  font-weight: 500;
  opacity: 0.7;
  display: inline-block;
  margin-right: 4px;
}
.gsc__value {
  opacity: 0.8;
  white-space: pre-wrap;
}
.gsc__empty {
  opacity: 0.4;
  font-style: italic;
}
.gsc__params {
  display: flex;
  gap: 6px;
  margin-top: 4px;
}
.gsc__param {
  font-size: var(--fs-xs);
  padding: 2px 6px;
  background: var(--bg-tertiary, #e4e4e7);
  border-radius: var(--radius-xs);
  opacity: 0.6;
}
</style>
