<template>
  <canvas
    ref="canvasRef"
    :width="size * dpr"
    :height="size * dpr"
    :style="{ width: size + 'px', height: size + 'px', borderRadius: '50%' }"
  />
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { renderText } from '@worldsmith/font-kit'

const props = withDefaults(defineProps<{
  character: string
  fontFamily: string
  accentColor: string
  size?: number
}>(), {
  size: 48,
})

const canvasRef = ref<HTMLCanvasElement>()
const dpr = window.devicePixelRatio || 1

function drawAvatar() {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const canvasSize = props.size

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, canvasSize, canvasSize)

  ctx.fillStyle = props.accentColor
  ctx.beginPath()
  ctx.arc(canvasSize / 2, canvasSize / 2, canvasSize / 2, 0, Math.PI * 2)
  ctx.fill()

  const fontSize = canvasSize * 0.5

  try {
    const result = renderText({
      text: props.character,
      fontFamily: props.fontFamily,
      fontSize,
      fontWeight: 'bold',
      color: '#ffffff',
      padding: 0,
      lineHeight: 1,
      baseline: 'top',
      devicePixelRatio: dpr,
    })

    const x = (canvasSize - result.width) / 2
    const y = (canvasSize - result.height) / 2
    ctx.drawImage(result.canvas, x, y, result.width, result.height)
  } catch {
    ctx.fillStyle = '#ffffff'
    ctx.font = `bold ${fontSize}px ${props.fontFamily}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(props.character, canvasSize / 2, canvasSize / 2)
  }
}

onMounted(drawAvatar)
watch(() => [props.character, props.fontFamily, props.accentColor, props.size], drawAvatar)
</script>
