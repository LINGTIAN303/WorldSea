<template>
  <Teleport to="body">
    <div v-if="visible" class="fp-overlay" :class="{ 'fp-overlay-transparent': pinned }" @click="onOverlayClick" />
    <div v-if="visible" class="fp-panel" :style="panelStyle" @mousedown.stop>
      <div class="fp-header" @mousedown="onDragStart">
        <span class="fp-title">{{ title }}</span>
        <div class="fp-header-actions">
          <button class="fp-pin-btn" :class="{ pinned }" @click.stop="togglePin" :title="pinned ? '取消置顶' : '置顶'">
            <WsIcon name="pin" size="xs" />
          </button>
          <button v-if="showClose" class="fp-close-btn" @click.stop="onClose">✕</button>
        </div>
      </div>
      <div class="fp-body">
        <slot />
      </div>
      <div class="fp-resize-handle" @mousedown.stop="onResizeStart"></div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { useFloatingPanel, Z_INDEX } from '../../composables/useFloatingPanel'
import WsIcon from '../WsIcon.vue'

const props = withDefaults(defineProps<{
  visible: boolean
  title?: string
  width?: number
  height?: number
  zIndex?: number
  gap?: number
  pinned?: boolean
  showClose?: boolean
  triggerRect?: DOMRect | { left: number; top: number; right: number; bottom: number; width: number; height: number } | null
  panelId?: string
}>(), {
  title: '',
  width: 280,
  height: 320,
  zIndex: Z_INDEX.FLOATING,
  gap: 4,
  pinned: false,
  showClose: true,
  triggerRect: null,
  panelId: '',
})

const emit = defineEmits<{
  'update:visible': [value: boolean]
  'update:pinned': [value: boolean]
  'close': []
}>()

const {
  visible: panelVisible,
  pinned: panelPinned,
  panelStyle,
  open,
  close,
  forceClose,
  togglePin: togglePinInternal,
  onDragStart,
  onResizeStart,
} = useFloatingPanel({
  width: props.width,
  height: props.height,
  zIndex: props.zIndex,
  gap: props.gap,
  panelId: props.panelId || undefined,
})

function syncOpen() {
  if (props.visible && props.triggerRect) {
    open(props.triggerRect)
  } else if (!props.visible) {
    forceClose()
  }
}

syncOpen()

import { watch } from 'vue'

watch(() => props.visible, () => syncOpen())
watch(() => props.triggerRect, () => {
  if (props.visible && props.triggerRect) {
    open(props.triggerRect)
  }
})

watch(panelVisible, (v) => {
  if (!v && props.visible) {
    emit('update:visible', false)
    emit('close')
  }
})

watch(panelPinned, (v) => {
  emit('update:pinned', v)
})

function togglePin() {
  togglePinInternal()
}

function onOverlayClick() {
  close()
  if (!panelPinned.value) {
    emit('update:visible', false)
    emit('close')
  }
}

function onClose() {
  forceClose()
  emit('update:visible', false)
  emit('close')
}

defineExpose({
  open,
  close: forceClose,
  togglePin,
})
</script>

<style scoped>
.fp-overlay {
  position: fixed;
  inset: 0;
  z-index: calc(v-bind(zIndex) - 1);
  background: transparent;
}

.fp-overlay-transparent {
  background: transparent;
  pointer-events: none;
}

.fp-panel {
  background: var(--modal-bg, #fff);
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 8px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  user-select: none;
  position: relative;
}

.fp-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: var(--bg-tertiary, #f9fafb);
  border-bottom: 1px solid var(--border-light, #f0f0f0);
  cursor: grab;
  flex-shrink: 0;
}

.fp-header:active {
  cursor: grabbing;
}

.fp-title {
  flex: 1;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--text-secondary, #666);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fp-header-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.fp-pin-btn {
  width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: var(--font-size-sm);
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.4;
  transition: opacity 0.15s, background 0.15s;
}

.fp-pin-btn:hover {
  opacity: 0.7;
  background: var(--hover-bg, #f3f4f6);
}

.fp-pin-btn.pinned {
  opacity: 1;
  background: var(--primary-light, #eef2ff);
}

.fp-close-btn {
  width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: var(--font-size-xs);
  color: var(--text-tertiary, #999);
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
}

.fp-close-btn:hover {
  background: var(--hover-bg, #f3f4f6);
  color: var(--text-color, #333);
}

.fp-body {
  flex: 1;
  overflow-y: auto;
  padding: 0;
}

.fp-resize-handle {
  position: absolute;
  right: 0;
  top: 0;
  width: 6px;
  height: 100%;
  cursor: col-resize;
  z-index: 10;
  background: transparent;
  transition: background 0.15s;
}

.fp-resize-handle:hover,
.fp-resize-handle:active {
  background: var(--primary);
  opacity: 0.3;
}
</style>
