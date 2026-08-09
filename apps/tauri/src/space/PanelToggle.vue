<template>
  <button
    class="panel-toggle"
    :class="btnClass"
    @click="onClick"
    @mousedown="onMouseDown"
    @mouseup="onMouseUp"
    @mouseleave="onMouseUp"
    @contextmenu.prevent
    :title="title"
  >
    <div class="toggle-content">
      <Transition name="mode-fade" mode="out-in">
        <div v-if="!bothOpen" key="single" class="flip-scene" :class="{ flipped: rotation === 'knowledge' }">
          <div class="flip-inner">
            <div class="flip-front"><WsIcon name="clipboard-list" size="sm" /></div>
            <div class="flip-back"><WsIcon name="book" size="sm" /></div>
          </div>
        </div>
        <div v-else key="both" class="both-icons">
          <WsIcon name="clipboard-list" size="xs" />
          <WsIcon name="book" size="xs" />
        </div>
      </Transition>
    </div>
  </button>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'

const props = defineProps<{
  rotation: 'session' | 'knowledge'
  sessionOpen: boolean
  knowledgeOpen: boolean
}>()

const emit = defineEmits<{
  click: []
  longpress: []
}>()

const bothOpen = computed(() => props.sessionOpen && props.knowledgeOpen)
const hint = ref(false)

const btnClass = computed(() => {
  const c: string[] = []
  if (bothOpen.value) c.push('both')
  else if (props.rotation === 'session' && props.sessionOpen) c.push('active')
  else if (props.rotation === 'knowledge' && props.knowledgeOpen) c.push('active')
  if (hint.value) c.push('long-press-hint')
  return c
})

const title = computed(() => {
  if (bothOpen.value) return '会话列表 + 知识墙'
  if (props.sessionOpen) return '会话列表'
  if (props.knowledgeOpen) return '知识墙'
  return props.rotation === 'session' ? '会话列表' : '知识墙'
})

let longPressTimer: ReturnType<typeof setTimeout> | null = null
let isLongPress = false

function onClick() {
  if (isLongPress) return
  emit('click')
}

function onMouseDown() {
  isLongPress = false
  longPressTimer = setTimeout(() => {
    isLongPress = true
    hint.value = true
    setTimeout(() => hint.value = false, 300)
    emit('longpress')
  }, 300)
}

function onMouseUp() {
  if (longPressTimer) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }
}
</script>

<style scoped>
.panel-toggle {
  position: relative;
  width: 32px;
  height: 40px;
  padding: 0;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: width 0.25s ease, background 0.15s;
  flex-shrink: 0;
  color: var(--color-text-secondary);
}
.panel-toggle:hover {
  background: var(--color-surface);
}
.panel-toggle.active {
  color: var(--color-primary);
}
.panel-toggle.both {
  width: 40px;
  color: var(--color-primary);
}

.toggle-content {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 22px;
}

.flip-scene {
  width: 18px;
  height: 20px;
  perspective: 80px;
}

.flip-inner {
  position: relative;
  width: 100%;
  height: 100%;
  transition: transform 0.35s cubic-bezier(0.4, 0, 0.2, 1);
  transform-style: preserve-3d;
}

.flip-scene.flipped .flip-inner {
  transform: rotateX(180deg);
}

.flip-front,
.flip-back {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  backface-visibility: hidden;
}

.flip-back {
  transform: rotateX(180deg);
}

.both-icons {
  display: flex;
  align-items: center;
  gap: 1px;
}

.long-press-hint {
  animation: pulse-hint 0.3s ease;
}

@keyframes pulse-hint {
  0% { transform: scale(1); }
  50% { transform: scale(1.12); }
  100% { transform: scale(1); }
}

.mode-fade-enter-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.mode-fade-leave-active {
  transition: opacity 0.1s ease, transform 0.1s ease;
}
.mode-fade-enter-from {
  opacity: 0;
  transform: scale(0.9);
}
.mode-fade-leave-to {
  opacity: 0;
  transform: scale(0.9);
}
</style>
