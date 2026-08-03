<template>
  <Transition name="ws-menu">
    <div
      v-if="visible"
      class="agent-menu agent-panel"
      :style="panelStyle"
      @mousedown.left="onDragStart"
    >
      <div class="menu-drag-handle">
        <span class="menu-title">功能菜单</span>
        <button class="menu-close-btn" @click="emit('close')">✕</button>
      </div>
      <div class="menu-body">
        <div class="menu-section">
          <button class="menu-item" @click="emit('open-settings')">
            <span class="mi-icon"><WsIcon name="settings" size="sm" /></span>
            <span class="mi-label">AI 助手设置</span>
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import { usePanelDrag } from './composables/usePanelDrag'

const props = defineProps<{
  visible: boolean
  position: { x: number; y: number }
  dragged: boolean
}>()

const emit = defineEmits<{
  close: []
  'open-settings': []
  dragstart: [e: MouseEvent]
}>()

const posX = computed({
  get: () => props.position.x,
  set: () => {},
})
const posY = computed({
  get: () => props.position.y,
  set: () => {},
})

const { onDragStart } = usePanelDrag({
  x: posX,
  y: posY,
  excludeSelector: '.menu-body, .menu-close-btn',
})

const panelStyle = computed(() => {
  if (props.dragged) {
    return { left: `${props.position.x}px`, top: `${props.position.y}px` }
  }
  return { left: `${props.position.x}px`, bottom: `${props.position.y}px` }
})
</script>

<style scoped>
.agent-menu {
  position: fixed;
  width: 220px;
  background: var(--agent-bg, rgba(26, 26, 46, 0.92));
  backdrop-filter: blur(var(--agent-blur, 16px));
  border: 1px solid var(--agent-border, rgba(58, 58, 106, 0.4));
  border-radius: var(--agent-radius, 14px);
  box-shadow: var(--shadow-lg, 0 8px 32px rgba(0, 0, 0, 0.5));
  z-index: 10001;
  overflow: hidden;
  pointer-events: auto;
}

.menu-drag-handle {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid var(--agent-border, rgba(58, 58, 106, 0.3));
  cursor: grab;
  user-select: none;
}

.menu-drag-handle:active { cursor: grabbing }

.menu-title {
  font-size: var(--font-size-sm);
  color: var(--agent-text, #e0e0e0);
  font-family: var(--agent-font, sans-serif);
}

.menu-close-btn {
  background: none;
  border: none;
  color: var(--agent-text-secondary, #888);
  cursor: pointer;
  font-size: var(--font-size-base);
}

.menu-body { padding: 6px }
.menu-section { margin-bottom: 4px }

.menu-section-label {
  font-size: var(--font-size-xs);
  color: var(--agent-text-tertiary, #666);
  padding: 4px 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-family: var(--agent-font, sans-serif);
}

.menu-item {
  display: flex; align-items: center; gap: 8px;
  width: 100%; padding: 8px 10px;
  border: none; border-radius: var(--agent-radius-sm, 8px);
  background: transparent;
  color: var(--agent-text, #e0e0e0);
  cursor: pointer; font-size: var(--font-size-sm); text-align: left;
  transition: background 0.1s;
  font-family: var(--agent-font, sans-serif);
}

.menu-item:hover { background: var(--agent-accent-bg, rgba(108, 92, 231, 0.15)) }

.mi-icon { font-size: var(--font-size-base) }
.mi-label { font-weight: var(--font-weight-medium) }


</style>
