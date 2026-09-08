<template>
  <button
    v-if="visible"
    class="fft-btn"
    :style="positionStyle"
    @click.stop="$emit('click')"
    title="与 AI 讨论"
  >
    <WsIcon name="sparkles" :size="14" />
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'

const props = defineProps<{
  visible: boolean
  fieldRect: DOMRect | null
}>()

defineEmits<{
  click: []
}>()

const positionStyle = computed(() => {
  if (!props.fieldRect) return { display: 'none' }
  return {
    left: `${props.fieldRect.right + 4}px`,
    top: `${props.fieldRect.top + props.fieldRect.height / 2 - 10}px`,
  }
})
</script>

<style scoped>
.fft-btn {
  position: fixed;
  z-index: 99998;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 4px;
  background: var(--bg-tertiary, var(--color-bg-elevated));
  color: var(--text-tertiary);
  cursor: pointer;
  opacity: 0;
  animation: fft-in 0.15s ease-out forwards;
  transition: color 0.12s, background 0.12s;
}
.fft-btn:hover {
  color: var(--accent, var(--color-primary));
  background: var(--accent-bg, color-mix(in srgb, var(--color-primary, #6366f1) 12%, transparent));
}
@keyframes fft-in {
  from { opacity: 0; transform: scale(0.8); }
  to { opacity: 1; transform: scale(1); }
}
</style>
