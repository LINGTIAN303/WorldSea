<template>
  <div class="split-panel-renderer" :style="splitStyle">
    <div class="sp-pane" :style="paneStyle('left')">
      <div class="sp-label">左侧面板</div>
    </div>
    <div class="sp-divider" @mousedown="startResize"></div>
    <div class="sp-pane" :style="paneStyle('right')">
      <div class="sp-label">右侧面板</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps<{ config: Record<string, unknown>; componentId: string }>()

const splitRatio = ref(50)
const direction = computed(() => (props.config.direction as string) || 'horizontal')

const splitStyle = computed(() => ({
  flexDirection: (direction.value === 'horizontal' ? 'row' : 'column') as 'row' | 'column',
}))

function paneStyle(side: 'left' | 'right') {
  const sizeKey = direction.value === 'horizontal' ? 'width' : 'height'
  const ratio = side === 'left' ? splitRatio.value : 100 - splitRatio.value
  return { [sizeKey]: `${ratio}%`, overflow: 'auto' }
}

function startResize(e: MouseEvent) {
  const container = (e.currentTarget as HTMLElement).parentElement
  if (!container) return
  const isHorizontal = direction.value === 'horizontal'

    if (!container) return
    function onMove(ev: MouseEvent) {
    if (!container) return
    const containerSize = isHorizontal ? container.clientWidth : container.clientHeight
    const containerRect = container.getBoundingClientRect()
    const offset = ev.clientX !== undefined
      ? (isHorizontal ? ev.clientX : ev.clientY) - containerRect[isHorizontal ? 'left' : 'top']
      : 0
    splitRatio.value = Math.max(10, Math.min(90, (offset / containerSize) * 100))
  }

  function onUp() {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }

  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}
</script>

<style scoped>
.split-panel-renderer { display: flex; width: 100%; height: 100%; min-height: 100px; border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden; background: var(--bg); }
.sp-pane { overflow: auto; min-width: 0; min-height: 0; display: flex; align-items: center; justify-content: center; }
.sp-label { color: var(--text-tertiary); font-size: var(--font-size-sm); }
.sp-divider { width: 4px; background: var(--border-color); cursor: col-resize; flex-shrink: 0; transition: background 0.1s; }
.sp-divider:hover { background: var(--primary); }
</style>
