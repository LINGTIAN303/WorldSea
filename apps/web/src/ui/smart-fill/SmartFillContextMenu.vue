<template>
  <Teleport to="body">
    <div v-if="visible" class="sfcm-menu" :style="menuStyle" @click.stop>
      <button class="sfcm-item" @click="onDiscuss">
        <WsIcon name="sparkles" :size="14" />
        <span>与 AI 讨论</span>
      </button>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'

const props = defineProps<{
  visible: boolean
  x: number
  y: number
  entityType?: string
  entityId?: string
  entityName?: string
}>()

const emit = defineEmits<{
  discuss: [context: { entityType?: string; entityId?: string; entityName?: string }]
  close: []
}>()

const menuStyle = computed(() => ({
  left: `${props.x}px`,
  top: `${props.y}px`,
}))

function onDiscuss() {
  emit('discuss', {
    entityType: props.entityType,
    entityId: props.entityId,
    entityName: props.entityName,
  })
  emit('close')
}
</script>

<style scoped>
.sfcm-menu {
  position: fixed;
  z-index: 100001;
  min-width: 160px;
  background: var(--glass-bg, var(--modal-bg, var(--color-bg-surface)));
  border: 1px solid var(--glass-border, var(--border-color, var(--border)));
  border-radius: var(--radius-md, 8px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  backdrop-filter: blur(var(--glass-blur, 12px));
  padding: 4px;
  animation: sfcm-in 0.12s ease-out;
}
@keyframes sfcm-in {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}
.sfcm-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  border: none;
  background: none;
  color: var(--text-color);
  font-size: var(--font-size-sm, 13px);
  cursor: pointer;
  border-radius: var(--radius-sm, 4px);
  transition: background 0.12s;
}
.sfcm-item:hover {
  background: var(--hover-bg, rgba(255, 255, 255, 0.06));
}
</style>
