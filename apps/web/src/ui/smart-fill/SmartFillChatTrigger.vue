<template>
  <Teleport to="body">
    <button
      v-if="visible && rect"
      class="sf-chat-trigger"
      :style="triggerStyle"
      @click="onTriggerClick"
    >与 AI 聊聊？</button>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  visible: boolean
  rect: DOMRect | null
}>()

const emit = defineEmits<{
  click: []
}>()

const triggerStyle = computed(() => {
  if (!props.rect) return { display: 'none' }
  return {
    left: `${props.rect.left + props.rect.width / 2 - 60}px`,
    top: `${props.rect.bottom + 6}px`,
  }
})

function onTriggerClick() {
  emit('click')
}
</script>

<style scoped>
.sf-chat-trigger {
  position: fixed;
  z-index: 99999;
  padding: 5px 14px;
  border: none;
  border-radius: 20px;
  background: var(--accent, var(--color-primary, #6366f1));
  color: var(--color-text-inverse, #fff);
  font-size: var(--font-size-sm, 13px);
  cursor: pointer;
  box-shadow: 0 4px 12px color-mix(in srgb, var(--color-primary, #6366f1) 40%, transparent);
  animation: sf-trigger-in 0.15s ease-out;
  transition: transform 0.12s, box-shadow 0.12s;
  white-space: nowrap;
}
.sf-chat-trigger:hover {
  transform: scale(1.05);
  box-shadow: 0 6px 16px color-mix(in srgb, var(--color-primary, #6366f1) 50%, transparent);
}
@keyframes sf-trigger-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
