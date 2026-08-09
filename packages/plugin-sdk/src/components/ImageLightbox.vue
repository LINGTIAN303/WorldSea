<template>
  <Teleport to="body">
    <Transition name="lightbox">
      <div v-if="visible" ref="overlayRef" class="lightbox-overlay" role="dialog" aria-modal="true" aria-label="图片预览" tabindex="-1" @click.self="close" @keydown.escape="close">
        <div class="lightbox-toolbar">
          <button class="lb-btn" @click="zoomIn" title="放大" aria-label="放大">🔍+</button>
          <button class="lb-btn" @click="zoomOut" title="缩小" aria-label="缩小">🔍-</button>
          <button class="lb-btn" @click="resetZoom" title="重置" aria-label="重置缩放">↺</button>
          <button class="lb-btn lb-close" @click="close" title="关闭" aria-label="关闭预览">✕</button>
        </div>
        <div
          class="lightbox-content"
          @wheel.prevent="onWheel"
          @mousedown="onDragStart"
          @mousemove="onDragMove"
          @mouseup="onDragEnd"
          @mouseleave="onDragEnd"
        >
          <img
            :src="src"
            :style="imgStyle"
            class="lightbox-img"
            @load="onImageLoad"
            draggable="false"
          />
        </div>
        <div v-if="caption" class="lightbox-caption">{{ caption }}</div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'

const props = defineProps<{
  visible: boolean
  src: string
  caption?: string
}>()

const emit = defineEmits<{
  close: []
}>()

const overlayRef = ref<HTMLElement>()
/** 打开前的焦点元素：关闭后还原 */
let returnFocusEl: HTMLElement | null = null

const scale = ref(1)
const translateX = ref(0)
const translateY = ref(0)
const isDragging = ref(false)
const dragStart = ref({ x: 0, y: 0 })
const dragTranslateStart = ref({ x: 0, y: 0 })

const imgStyle = computed(() => ({
  transform: `translate(${translateX.value}px, ${translateY.value}px) scale(${scale.value})`,
  transition: isDragging.value ? 'none' : 'transform 0.2s ease',
}))

function close() {
  emit('close')
}

function zoomIn() {
  scale.value = Math.min(scale.value * 1.3, 10)
}

function zoomOut() {
  scale.value = Math.max(scale.value / 1.3, 0.1)
}

function resetZoom() {
  scale.value = 1
  translateX.value = 0
  translateY.value = 0
}

function onWheel(e: WheelEvent) {
  if (e.deltaY < 0) zoomIn()
  else zoomOut()
}

function onDragStart(e: MouseEvent) {
  isDragging.value = true
  dragStart.value = { x: e.clientX, y: e.clientY }
  dragTranslateStart.value = { x: translateX.value, y: translateY.value }
}

function onDragMove(e: MouseEvent) {
  if (!isDragging.value) return
  translateX.value = dragTranslateStart.value.x + (e.clientX - dragStart.value.x)
  translateY.value = dragTranslateStart.value.y + (e.clientY - dragStart.value.y)
}

function onDragEnd() {
  isDragging.value = false
}

function onImageLoad() {
  resetZoom()
}

function onKeydown(e: KeyboardEvent) {
  if (!props.visible) return
  if (e.key === 'Escape') close()
  if (e.key === '+' || e.key === '=') zoomIn()
  if (e.key === '-') zoomOut()
  if (e.key === '0') resetZoom()
  // 焦点陷阱：Tab 仅在 lightbox 内循环
  if (e.key === 'Tab') {
    const overlay = overlayRef.value
    if (!overlay) return
    const focusables = overlay.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )
    if (focusables.length === 0) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const active = document.activeElement
    if (e.shiftKey && (active === first || !overlay.contains(active))) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && (active === last || !overlay.contains(active))) {
      e.preventDefault()
      first.focus()
    }
  }
}

watch(() => props.visible, (v) => {
  if (v) {
    resetZoom()
    returnFocusEl = document.activeElement as HTMLElement
    nextTick(() => {
      const first =
        overlayRef.value?.querySelector<HTMLElement>(
          'input, select, textarea, button, [href], [tabindex]:not([tabindex="-1"])',
        ) ?? overlayRef.value
      first?.focus({ preventScroll: true })
    })
  } else {
    returnFocusEl?.focus?.({ preventScroll: true })
    returnFocusEl = null
  }
})

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.lightbox-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: rgba(0, 0, 0, 0.9);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.lightbox-toolbar {
  position: absolute;
  top: 16px;
  right: 16px;
  display: flex;
  gap: 8px;
  z-index: 1;
}
.lb-btn {
  width: 36px;
  height: 36px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(8px);
}
.lb-btn:hover {
  background: rgba(255, 255, 255, 0.2);
}
.lb-close {
  font-size: 18px;
}
.lightbox-content {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  cursor: grab;
  width: 100%;
}
.lightbox-content:active {
  cursor: grabbing;
}
.lightbox-img {
  max-width: 90vw;
  max-height: 85vh;
  object-fit: contain;
  user-select: none;
  pointer-events: none;
}
.lightbox-caption {
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  color: rgba(255, 255, 255, 0.7);
  font-size: var(--font-size-sm);
  background: rgba(0, 0, 0, 0.5);
  padding: 6px 16px;
  border-radius: 20px;
  backdrop-filter: blur(4px);
}
.lightbox-enter-active,
.lightbox-leave-active {
  transition: opacity 0.25s ease;
}
.lightbox-enter-from,
.lightbox-leave-to {
  opacity: 0;
}
</style>
