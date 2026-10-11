<template>
  <div class="empty-state">
    <span class="empty-icon">{{ icon }}</span>
    <p class="empty-msg">{{ message }}</p>
    <p v-if="hint" class="empty-hint">{{ hint }}</p>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  icon?: string
  message: string
  hint?: string
}>()
</script>

<style scoped>
.empty-state {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  flex: 1; min-height: 0;
  padding: 48px 20px; text-align: center;
}
.empty-icon { font-size: var(--icon-2xl); margin-bottom: 12px; opacity: 0.6; }
.empty-msg { font-size: var(--font-size-base); color: #888; margin: 0 0 4px; }
.empty-hint { font-size: var(--font-size-sm); color: #555; margin: 0 0 16px; }
</style>
