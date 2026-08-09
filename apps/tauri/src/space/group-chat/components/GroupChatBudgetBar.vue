<template>
  <div class="budget-bar" :class="budgetClass">
    <span class="budget-icon"><WsIcon name="coins" size="xs" /></span>
    <span class="budget-text">
      {{ isLocal ? `${formatTokens(totalTokens)} tokens` : `$${costUsd.toFixed(2)} / $${maxCost.toFixed(2)}` }}
    </span>
    <div class="budget-progress">
      <div class="budget-fill" :style="{ width: `${percentUsed}%` }"></div>
    </div>
    <span class="budget-percent">{{ Math.round(percentUsed) }}%</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'

const props = defineProps<{
  costUsd: number
  maxCost: number
  totalInputTokens: number
  totalOutputTokens: number
  isLocal: boolean
}>()

const percentUsed = computed(() =>
  props.maxCost > 0 ? Math.min(100, (props.costUsd / props.maxCost) * 100) : 0
)

const totalTokens = computed(() => props.totalInputTokens + props.totalOutputTokens)

const budgetClass = computed(() => {
  if (percentUsed.value >= 80) return 'budget-danger'
  if (percentUsed.value >= 50) return 'budget-warning'
  return 'budget-ok'
})

function formatTokens(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return String(n)
}
</script>

<style scoped>
.budget-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  font-size: var(--font-size-2xs);
  border-radius: var(--radius-mid);
  background: var(--color-surface);
}

.budget-icon {
  font-size: var(--fs-sm);
}

.budget-text {
  color: var(--color-text-secondary);
  white-space: nowrap;
}

.budget-progress {
  flex: 1;
  height: 4px;
  background: var(--color-border);
  border-radius: 2px;
  overflow: hidden;
  min-width: 40px;
}

.budget-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.3s, background 0.3s;
}

.budget-ok .budget-fill {
  background: var(--success);
}

.budget-warning .budget-fill {
  background: var(--warning);
}

.budget-danger .budget-fill {
  background: var(--danger);
}

.budget-percent {
  color: var(--color-text-tertiary);
  min-width: 28px;
  text-align: right;
}
</style>