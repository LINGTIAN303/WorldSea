<template>
  <div v-if="visible" class="efh-hint" @click="$emit('click')">
    <WsIcon name="sparkles" :size="14" />
    <span>让 AI 帮你填充？</span>
  </div>
</template>

<script setup lang="ts">
import { WsIcon } from '@worldsea/ui-kit'

defineProps<{
  visible: boolean
}>()

defineEmits<{
  click: []
}>()
</script>

<style scoped>
.efh-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  margin-top: 12px;
  border-radius: var(--radius-md, 8px);
  background: color-mix(in srgb, var(--accent, var(--color-primary, #6366f1)) 6%, transparent);
  color: var(--text-tertiary);
  font-size: var(--font-size-sm, 13px);
  cursor: pointer;
  opacity: 0.6;
  transition: opacity 0.15s, background 0.15s;
}
.efh-hint:hover {
  opacity: 1;
  background: color-mix(in srgb, var(--accent, var(--color-primary, #6366f1)) 10%, transparent);
}
</style>
