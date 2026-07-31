<template>
  <div class="trp-wrap" ref="wrapRef">
    <div class="trp-canvas-wrap" :style="{ minHeight: minHeight + 'px' }">
      <canvas ref="canvasRef" class="trp-canvas" />
      <div v-if="!result" class="trp-placeholder">
        <span>输入文本后预览渲染效果</span>
      </div>
    </div>
    <div v-if="result" class="trp-info">
      <span class="trp-info-item">{{ result.width }} × {{ result.height }}px</span>
      <span class="trp-info-sep">·</span>
      <span class="trp-info-item">{{ dpr }}x</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue'
import { renderText, type TextRenderOptions, type RenderResult } from '@worldsmith/font-kit'

const props = withDefaults(defineProps<{
  options: TextRenderOptions
  minHeight?: number
}>(), {
  minHeight: 120,
})

const canvasRef = ref<HTMLCanvasElement>()
const result = ref<RenderResult | null>(null)
const dpr = ref(typeof window !== 'undefined' ? window.devicePixelRatio : 1)

let rafId = 0

function render() {
  if (!canvasRef.value || !props.options.text) {
    result.value = null
    return
  }
  try {
    const r = renderText(props.options)
    if (canvasRef.value) {
      const ctx = canvasRef.value.getContext('2d')
      if (ctx) {
        canvasRef.value.width = r.canvas.width
        canvasRef.value.height = r.canvas.height
        canvasRef.value.style.width = r.width + 'px'
        canvasRef.value.style.height = r.height + 'px'
        ctx.drawImage(r.canvas, 0, 0)
      }
    }
    result.value = r
  } catch {
    result.value = null
  }
}

watch(
  () => props.options,
  () => {
    cancelAnimationFrame(rafId)
    rafId = requestAnimationFrame(render)
  },
  { deep: true },
)

onBeforeUnmount(() => {
  cancelAnimationFrame(rafId)
})

defineExpose({ result, render })
</script>

<style scoped>
.trp-wrap {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.trp-canvas-wrap {
  position: relative;
  border: 1px solid var(--border);
  border-radius: var(--radius-md, 8px);
  background: var(--bg-tertiary);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.trp-canvas {
  display: block;
  max-width: 100%;
}

.trp-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
  pointer-events: none;
}

.trp-info {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-2xs, 9px);
  color: var(--text-tertiary);
}

.trp-info-sep {
  opacity: 0.4;
}
</style>