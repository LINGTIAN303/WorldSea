<template>
  <canvas ref="minimapCanvas" class="timeline-minimap" :height="minimapHeight" @mousedown="onMouseDown" />
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'

const props = defineProps<{
  width: number
  totalWidth: number
  scrollOffset: number
  viewportWidth: number
  eventPositions: { x: number; width: number }[]
}>()

const emit = defineEmits<{
  panTo: [scrollOffset: number]
}>()

const minimapCanvas = ref<HTMLCanvasElement>()
const minimapHeight = 24

function draw() {
  const canvas = minimapCanvas.value
  if (!canvas) return
  canvas.width = props.width * window.devicePixelRatio
  canvas.height = minimapHeight * window.devicePixelRatio
  canvas.style.width = props.width + 'px'
  canvas.style.height = minimapHeight + 'px'

  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio)
  ctx.clearRect(0, 0, props.width, minimapHeight)

  const cs = getComputedStyle(document.documentElement)
  const bgColor = cs.getPropertyValue('--hover-bg').trim() || '#f5f5f5'
  ctx.fillStyle = bgColor
  ctx.fillRect(0, 0, props.width, minimapHeight)

  const scale = props.totalWidth > 0 ? props.width / props.totalWidth : 1
  const primaryColor = cs.getPropertyValue('--primary').trim() || '#4f46e5'
  ctx.fillStyle = primaryColor
  ctx.globalAlpha = 0.4
  for (const ev of props.eventPositions) {
    const x = ev.x * scale
    const w = Math.max(2, ev.width * scale)
    ctx.fillRect(x, 4, w, minimapHeight - 8)
  }
  ctx.globalAlpha = 1

  const vpStart = props.scrollOffset * scale
  const vpWidth = props.viewportWidth * scale
  ctx.strokeStyle = primaryColor
  ctx.lineWidth = 1.5
  ctx.strokeRect(vpStart, 1, vpWidth, minimapHeight - 2)
  ctx.fillStyle = primaryColor
  ctx.globalAlpha = 0.1
  ctx.fillRect(vpStart, 1, vpWidth, minimapHeight - 2)
  ctx.globalAlpha = 1
}

function onMouseDown(e: MouseEvent) {
  if (e.button !== 0) return
  e.preventDefault()
  panToClientX(e.clientX)
  const move = (event: MouseEvent) => panToClientX(event.clientX)
  const up = () => {
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
    document.body.style.removeProperty('cursor')
  }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
  document.body.style.cursor = 'grabbing'
}

/** 点击/拖拽：把该横坐标对应的时段中心移到视口（连续拖动可扫动缩略图） */
function panToClientX(clientX: number) {
  const canvas = minimapCanvas.value
  if (!canvas || props.totalWidth === 0) return
  const rect = canvas.getBoundingClientRect()
  const clickX = clientX - rect.left
  const scale = props.width / props.totalWidth
  const targetScroll = clickX / scale - props.viewportWidth / 2
  emit('panTo', Math.max(0, Math.min(props.totalWidth - props.viewportWidth, targetScroll)))
}

// getter 每次返回新数组引用，浅监听即可捕获变化，deep 冗余
watch(() => [props.width, props.totalWidth, props.scrollOffset, props.viewportWidth, props.eventPositions], draw)
onMounted(draw)
</script>

<style scoped>
.timeline-minimap {
  display: block;
  width: 100%;
  cursor: pointer;
  border-top: 1px solid var(--border-color);
}
</style>
