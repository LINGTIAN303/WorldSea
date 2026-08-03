<template>
  <canvas ref="axisCanvas" class="timeline-axis" :height="axisHeight" />
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import type { Tick, ZoomLevel } from '../composables/useTimelineScale'

const props = defineProps<{
  width: number
  majorTicks: Tick[]
  minorTicks: Tick[]
  zoomLevel: ZoomLevel
  scrollOffset: number
  eraColors: { name: string; color: string; startX: number; endX: number }[]
}>()

const axisCanvas = ref<HTMLCanvasElement>()
const axisHeight = 40

function draw() {
  const canvas = axisCanvas.value
  if (!canvas) return
  canvas.width = props.width * window.devicePixelRatio
  canvas.height = axisHeight * window.devicePixelRatio
  canvas.style.width = props.width + 'px'
  canvas.style.height = axisHeight + 'px'

  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio)
  ctx.clearRect(0, 0, props.width, axisHeight)

  for (const era of props.eraColors) {
    ctx.fillStyle = era.color
    ctx.globalAlpha = 0.08
    ctx.fillRect(era.startX, 0, era.endX - era.startX, axisHeight)
  }
  ctx.globalAlpha = 1

  const cs = getComputedStyle(document.documentElement)
  const textColor = cs.getPropertyValue('--text-secondary').trim() || '#666'
  const borderColor = cs.getPropertyValue('--border-color').trim() || '#ddd'
  const primaryColor = cs.getPropertyValue('--primary').trim() || '#4f46e5'

  ctx.strokeStyle = borderColor
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, axisHeight - 1)
  ctx.lineTo(props.width, axisHeight - 1)
  ctx.stroke()

  for (const tick of props.minorTicks) {
    if (tick.position < -50 || tick.position > props.width + 50) continue
    ctx.strokeStyle = borderColor
    ctx.lineWidth = 0.5
    ctx.beginPath()
    ctx.moveTo(tick.position, axisHeight - 6)
    ctx.lineTo(tick.position, axisHeight - 1)
    ctx.stroke()
  }

  for (const tick of props.majorTicks) {
    if (tick.position < -100 || tick.position > props.width + 100) continue
    ctx.strokeStyle = primaryColor
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(tick.position, axisHeight - 12)
    ctx.lineTo(tick.position, axisHeight - 1)
    ctx.stroke()

    ctx.fillStyle = textColor
    ctx.font = '11px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(tick.label, tick.position, axisHeight - 16)
  }
}

watch(() => [props.width, props.majorTicks, props.minorTicks, props.scrollOffset, props.eraColors], draw, { deep: true })
onMounted(draw)

let resizeObserver: ResizeObserver | null = null
onMounted(() => {
  if (axisCanvas.value?.parentElement) {
    resizeObserver = new ResizeObserver(draw)
    resizeObserver.observe(axisCanvas.value.parentElement)
  }
})
onBeforeUnmount(() => resizeObserver?.disconnect())
</script>

<style scoped>
.timeline-axis {
  display: block;
  width: 100%;
  cursor: grab;
}
.timeline-axis:active {
  cursor: grabbing;
}
</style>
