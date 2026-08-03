<template>
  <div v-if="isActive" class="mm-key-hint">
    <span class="mm-kh-seq">{{ currentSequence }}_</span>
    <span v-if="availableNext.length > 0" class="mm-kh-options">
      <span v-for="opt in availableNext" :key="opt.key" class="mm-kh-option">
        <kbd>{{ opt.key }}</kbd> {{ opt.desc }}
      </span>
    </span>
    <span v-else class="mm-kh-unknown">未知序列</span>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  currentSequence: string
  availableNext: { key: string; desc: string }[]
  isActive: boolean
}>()
</script>

<style scoped>
.mm-key-hint {
  position: absolute; bottom: 8px; left: 8px;
  background: var(--card-bg); border: 1px solid var(--border-color);
  border-radius: var(--radius-md); padding: 4px 10px;
  font-size: var(--font-size-xs); display: flex; align-items: center; gap: 8px;
  box-shadow: var(--shadow-lg); z-index: 100;
}
.mm-kh-seq { color: var(--primary); font-weight: bold; font-family: monospace; }
.mm-kh-options { display: flex; gap: 8px; color: var(--text-secondary); }
.mm-kh-option { display: flex; align-items: center; gap: 2px; }
.mm-kh-option kbd {
  background: var(--color-bg-elevated); color: var(--color-text-primary); padding: 1px 5px;
  border-radius: 3px; font-size: var(--font-size-xs); font-family: monospace;
}
.mm-kh-unknown { color: var(--danger); }
</style>
