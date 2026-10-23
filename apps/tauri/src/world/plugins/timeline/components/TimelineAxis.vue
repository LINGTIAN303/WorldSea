<template>
  <canvas ref="axisCanvas" class="timeline-axis" :height="axisHeight" @mousedown="$emit('panStart', $event)" />
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import type { ScaleBand, Tick } from '../composables/useTimelineScale'

const props = defineProps<{
  width: number
  majorTicks: Tick[]
  minorTicks: Tick[]
  bands: ScaleBand[]
}>()

defineEmits<{
  panStart: [event: MouseEvent]
}>()

const axisCanvas = ref<HTMLCanvasElement>()
const axisHeight = 40

function cssColor(token: string, fallback: string): string {
  const value = token.trim()
  return value || fallback
}

function draw() {
  const canvas = axisCanvas.value
  if (!canvas) return
  const ratio = window.devicePixelRatio || 1
  canvas.width = Math.max(1, props.width * ratio)
  canvas.height = axisHeight * ratio
  canvas.style.width = props.width + 'px'
  canvas.style.height = axisHeight + 'px'

  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  ctx.clearRect(0, 0, props.width, axisHeight)

  const styles = getComputedStyle(document.documentElement)
  const textColor = cssColor(styles.getPropertyValue('--text-secondary'), '#666')
  const borderColor = cssColor(styles.getPropertyValue('--border-color'), '#ddd')
  const primaryColor = cssColor(styles.getPropertyValue('--primary'), '#4f46e5')
  const bandColor = cssColor(styles.getPropertyValue('--primary-light'), '#e0e7ff')

  // 色带：顶层命名区间（浅）+ 期段（深，按嵌套加深）
  for (const band of props.bands) {
    const start = Math.max(-2000, band.startX)
    const end = Math.min(props.width + 2000, band.endX)
    if (end <= start) continue
    ctx.fillStyle = band.color && !band.color.startsWith('var(') ? band.color : bandColor
    ctx.globalAlpha = band.tone === 'period' ? Math.min(0.28, 0.14 + band.depth * 0.04) : 0.06
    ctx.fillRect(start, 0, end - start, axisHeight)
  }
  ctx.globalAlpha = 1

  // 顶层单位名（纪元/劫等）贴在色带左上：刻度切到更细层级时仍能读到纪元
  ctx.font = '11px system-ui, sans-serif'
  ctx.textAlign = 'left'
  for (const band of props.bands) {
    if (band.tone !== 'base' || !band.label) continue
    const start = Math.max(0, band.startX)
    const end = Math.min(props.width, band.endX)
    if (end - start < 56) continue
    ctx.save()
    ctx.beginPath()
    ctx.rect(start, 0, end - start, axisHeight - 14)
    ctx.clip()
    ctx.fillStyle = primaryColor
    ctx.globalAlpha = 0.75
    ctx.fillText(band.label, start + 6, 13)
    ctx.restore()
  }
  ctx.globalAlpha = 1

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

  ctx.font = '11px system-ui, sans-serif'
  ctx.textAlign = 'center'
  for (const tick of props.majorTicks) {
    if (tick.position < -100 || tick.position > props.width + 100) continue
    ctx.strokeStyle = primaryColor
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(tick.position, axisHeight - 12)
    ctx.lineTo(tick.position, axisHeight - 1)
    ctx.stroke()
    if (!tick.label) continue
    ctx.fillStyle = textColor
    ctx.fillText(tick.label, tick.position, axisHeight - 16)
  }
}

// 监听源均为基本类型或 computed 新数组引用，浅监听即可捕获变化
watch(() => [props.width, props.majorTicks, props.minorTicks, props.bands], draw)
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
  flex: 1;
  width: 100%;
  cursor: grab;
}
.timeline-axis:active { cursor: grabbing; }
</style>
