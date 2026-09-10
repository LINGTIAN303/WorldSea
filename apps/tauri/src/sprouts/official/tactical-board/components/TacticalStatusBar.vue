<template>
  <div class="tb-status">
    <span>回合 {{ turn }}</span>
    <span class="tb-status-sep">|</span>
    <span>单位 {{ unitCount }}</span>
    <span class="tb-status-sep">|</span>
    <span>{{ gridLabel }}</span>
    <span class="tb-status-sep">|</span>
    <span class="tb-status-hint">{{ hint }}</span>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  turn: number
  unitCount: number
  gridLabel: string
  hint: string
}>()
</script>

<style scoped>
.tb-status {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 16px;
  background: var(--color-bg-surface);
  border-top: 1px solid var(--color-border);
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  flex-shrink: 0;
}

.tb-status-sep { color: var(--color-border); }
.tb-status-hint { margin-left: auto; color: var(--color-text-tertiary); }
</style>
