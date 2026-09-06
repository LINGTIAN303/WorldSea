<template>
  <div v-if="show" class="cp-overlay" @click.self="cancel">
    <div class="cp-dialog" ref="boxRef" role="dialog" aria-modal="true" aria-label="选择颜色" tabindex="-1" :style="{ width: modalResizable.width.value + 'px' }">
      <div class="cp-header">
        <h3><WsIcon name="palette" size="sm" /> 选择颜色</h3>
        <button class="cp-close" @click="cancel">✕</button>
      </div>
      <div class="cp-body">
        <div class="cp-wheel-area" ref="wheelRef" @mousedown="onWheelDown" @touchstart.prevent="onWheelTouchStart">
          <canvas ref="canvasRef" :width="220" :height="220" class="cp-wheel-canvas"></canvas>
          <div class="cp-cursor" :style="cursorStyle"></div>
        </div>
        <div class="cp-slider-area">
          <div class="cp-slider-row">
            <span class="cp-slider-label">H</span>
            <input type="range" min="0" max="360" v-model.number="hue" class="cp-slider cp-slider-hue" />
            <span class="cp-slider-val">{{ hue }}°</span>
          </div>
          <div class="cp-slider-row">
            <span class="cp-slider-label">S</span>
            <input type="range" min="0" max="100" v-model.number="sat" class="cp-slider" />
            <span class="cp-slider-val">{{ sat }}%</span>
          </div>
          <div class="cp-slider-row">
            <span class="cp-slider-label">L</span>
            <input type="range" min="0" max="100" v-model.number="light" class="cp-slider" />
            <span class="cp-slider-val">{{ light }}%</span>
          </div>
        </div>
        <div class="cp-preview-row">
          <div class="cp-swatch" :style="{ background: currentColor }"></div>
          <input v-model="hexInput" class="cp-hex-input" @change="onHexInput" />
        </div>
        <div class="cp-presets">
          <button v-for="c in presetColors" :key="c" class="cp-preset-btn" :style="{ background: c }" @click="applyPreset(c)"></button>
        </div>
      </div>
      <div class="cp-footer">
        <button class="cp-btn cp-btn-secondary" @click="cancel">取消</button>
        <button class="cp-btn cp-btn-primary" @click="confirm">确定</button>
      </div>
      <div class="resize-handle-right" @mousedown="modalResizable.onResizeStart"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick, onBeforeUnmount } from 'vue'
import { useResizable, useModalShortcuts } from '@worldsmith/ui-kit'
import WsIcon from '../WsIcon.vue'

const props = defineProps<{ show: boolean; initialColor?: string }>()
const emit = defineEmits<{ close: []; confirm: [color: string] }>()
const modalResizable = useResizable({ panelId: 'modal-color-picker', defaultWidth: 340, minWidth: 240 })

const boxRef = ref<HTMLElement>()
/** 打开前的焦点元素：关闭后还原 */
let returnFocusEl: HTMLElement | null = null

// Esc 关闭收编 useModalShortcuts（modal 层）
useModalShortcuts(() => props.show, { id: 'color-picker.close', onEscape: () => cancel() })
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

// 焦点陷阱：Tab 仅在弹窗内循环（Esc 已收编注册表）
function onKeydown(e: KeyboardEvent) {
  if (!props.show) return
  if (e.key === 'Tab') {
    const box = boxRef.value
    if (!box) return
    const focusables = box.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )
    if (focusables.length === 0) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const active = document.activeElement
    if (e.shiftKey && (active === first || !box.contains(active))) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && (active === last || !box.contains(active))) {
      e.preventDefault()
      first.focus()
    }
  }
}

const hue = ref(0)
const sat = ref(80)
const light = ref(50)
const hexInput = ref('#4a6cf7')

const canvasRef = ref<HTMLCanvasElement>()
const wheelRef = ref<HTMLDivElement>()

const cursorStyle = computed(() => {
  const angle = (hue.value - 90) * Math.PI / 180
  const r = (sat.value / 100) * 100
  const cx = 110 + r * Math.cos(angle)
  const cy = 110 + r * Math.sin(angle)
  return {
    left: cx + 'px',
    top: cy + 'px',
    background: currentColor.value,
  }
})

const currentColor = computed(() => hslToHex(hue.value, sat.value, light.value))

watch(() => props.show, (v) => {
  if (v && props.initialColor) {
    const hsl = hexToHsl(props.initialColor)
    if (hsl) {
      hue.value = hsl.h
      sat.value = hsl.s
      light.value = hsl.l
    }
    hexInput.value = props.initialColor
  }
  if (v) {
    nextTick(drawWheel)
    returnFocusEl = document.activeElement as HTMLElement
    window.addEventListener('keydown', onKeydown) // Tab 焦点陷阱（Esc 已收编注册表）
    nextTick(() => {
      const first =
        boxRef.value?.querySelector<HTMLElement>(
          'input, select, textarea, button, [href], [tabindex]:not([tabindex="-1"])',
        ) ?? boxRef.value
      first?.focus({ preventScroll: true })
    })
  } else {
    window.removeEventListener('keydown', onKeydown)
    returnFocusEl?.focus?.({ preventScroll: true })
    returnFocusEl = null
  }
})


onMounted(() => {
  if (props.show) nextTick(drawWheel)
})

function drawWheel() {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const cx = 110, cy = 110, outerR = 100, innerR = 40

  ctx.clearRect(0, 0, 220, 220)

  for (let angle = 0; angle < 360; angle += 1) {
    const startAngle = (angle - 1) * Math.PI / 180
    const endAngle = (angle + 1) * Math.PI / 180
    ctx.beginPath()
    ctx.arc(cx, cy, outerR, startAngle, endAngle)
    ctx.arc(cx, cy, innerR, endAngle, startAngle, true)
    ctx.closePath()
    const grad = ctx.createRadialGradient(cx, cy, innerR, cx, cy, outerR)
    grad.addColorStop(0, `hsl(${angle}, 30%, ${light.value}%)`)
    grad.addColorStop(1, `hsl(${angle}, 100%, ${light.value}%)`)
    ctx.fillStyle = grad
    ctx.fill()
  }
}

watch(light, () => nextTick(drawWheel))

let dragging = false

function onWheelDown(e: MouseEvent) {
  dragging = true
  updateFromWheel(e)
  const onMove = (ev: MouseEvent) => { if (dragging) updateFromWheel(ev) }
  const onUp = () => { dragging = false; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

function onWheelTouchStart(e: TouchEvent) {
  dragging = true
  updateFromWheelTouch(e)
  const onMove = (ev: TouchEvent) => { if (dragging) updateFromWheelTouch(ev) }
  const onUp = () => { dragging = false; document.removeEventListener('touchmove', onMove as any); document.removeEventListener('touchend', onUp) }
  document.addEventListener('touchmove', onMove as any)
  document.addEventListener('touchend', onUp)
}

function updateFromWheel(e: MouseEvent) {
  if (!wheelRef.value) return
  const rect = wheelRef.value.getBoundingClientRect()
  const x = e.clientX - rect.left - 110
  const y = e.clientY - rect.top - 110
  setFromXY(x, y)
}

function updateFromWheelTouch(e: TouchEvent) {
  if (!wheelRef.value || !e.touches[0]) return
  const rect = wheelRef.value.getBoundingClientRect()
  const x = e.touches[0].clientX - rect.left - 110
  const y = e.touches[0].clientY - rect.top - 110
  setFromXY(x, y)
}

function setFromXY(x: number, y: number) {
  const dist = Math.sqrt(x * x + y * y)
  const outerR = 100, innerR = 40
  if (dist < innerR || dist > outerR) return
  let angle = Math.atan2(y, x) * 180 / Math.PI + 90
  if (angle < 0) angle += 360
  hue.value = Math.round(angle)
  sat.value = Math.round((dist / outerR) * 100)
  hexInput.value = currentColor.value
}

function onHexInput() {
  const hsl = hexToHsl(hexInput.value)
  if (hsl) {
    hue.value = hsl.h
    sat.value = hsl.s
    light.value = hsl.l
  }
}

const presetColors = [
  '#4a6cf7', '#27ae60', '#e67e22', '#e74c3c', '#9b59b6', '#f39c12',
  '#1abc9c', '#3498db', '#e91e63', '#00bcd4', '#8bc34a', '#ff5722',
  '#607d8b', '#795548', '#ff9800', '#cddc39', '#2196f3', '#673ab7',
]

function applyPreset(c: string) {
  const hsl = hexToHsl(c)
  if (hsl) {
    hue.value = hsl.h
    sat.value = hsl.s
    light.value = hsl.l
  }
  hexInput.value = c
}

function confirm() {
  emit('confirm', currentColor.value)
  emit('close')
}

function cancel() {
  emit('close')
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
    return Math.round(255 * color).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const m = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i)
  if (!m) return null
  let r = parseInt(m[1], 16) / 255, g = parseInt(m[2], 16) / 255, b = parseInt(m[3], 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let h = 0, s = 0, l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break
      case g: h = ((b - r) / d + 2) / 6; break
      case b: h = ((r - g) / d + 4) / 6; break
    }
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) }
}
</script>

<style scoped>
.cp-overlay { position: fixed; inset: 0; z-index: calc(var(--z-overlay) + 2); background: var(--color-overlay); display: flex; align-items: center; justify-content: center; }
.cp-dialog { position: relative; background: var(--bg-secondary, var(--color-bg-surface)); border-radius: 12px; box-shadow: 0 8px 40px rgba(0,0,0,0.2); display: flex; flex-direction: column; overflow: hidden; }
.cp-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid var(--border, var(--color-border)); }
.cp-header h3 { margin: 0; font-size: var(--font-size-base); }
.cp-close { background: none; border: none; font-size: var(--font-size-lg); cursor: pointer; padding: 2px 6px; border-radius: 4px; color: var(--text-secondary); }
.cp-close:hover { background: var(--hover-bg, var(--color-bg-hover)); }
.cp-body { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.cp-wheel-area { position: relative; width: 220px; height: 220px; margin: 0 auto; cursor: crosshair; }
.cp-wheel-canvas { width: 220px; height: 220px; border-radius: 50%; }
.cp-cursor { position: absolute; width: 16px; height: 16px; border: 2px solid #fff; border-radius: 50%; transform: translate(-8px, -8px); box-shadow: 0 0 4px rgba(0,0,0,0.4); pointer-events: none; }
.cp-slider-area { display: flex; flex-direction: column; gap: 6px; }
.cp-slider-row { display: flex; align-items: center; gap: 8px; }
.cp-slider-label { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--text-secondary); width: 16px; text-align: center; }
.cp-slider { flex: 1; height: 6px; -webkit-appearance: none; appearance: none; background: var(--bg-tertiary, var(--color-bg-elevated)); border-radius: 3px; outline: none; }
.cp-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; border-radius: 50%; background: var(--accent, var(--color-primary)); cursor: pointer; border: 2px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.2); }
.cp-slider-hue { background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00); }
.cp-slider-val { font-size: var(--font-size-xs); color: var(--text-tertiary); width: 36px; text-align: right; }
.cp-preview-row { display: flex; align-items: center; gap: 10px; }
.cp-swatch { width: 36px; height: 36px; border-radius: var(--radius-sm); border: 2px solid var(--border, var(--color-border)); flex-shrink: 0; }
.cp-hex-input { flex: 1; padding: 6px 10px; border: 1px solid var(--border, var(--color-border)); border-radius: 4px; background: var(--bg-tertiary, var(--color-bg-elevated)); color: var(--text); font-size: var(--font-size-sm); font-family: monospace; outline: none; }
.cp-hex-input:focus { border-color: var(--accent, var(--color-primary)); }
.cp-presets { display: flex; flex-wrap: wrap; gap: 4px; }
.cp-preset-btn { width: 22px; height: 22px; border-radius: 4px; border: 1px solid var(--color-border); cursor: pointer; transition: transform 0.1s; }
.cp-preset-btn:hover { transform: scale(1.2); }
.cp-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 10px 16px; border-top: 1px solid var(--border, var(--color-border)); }
.cp-btn { padding: 6px 16px; border-radius: var(--radius-sm); font-size: var(--font-size-sm); cursor: pointer; border: 1px solid var(--border, var(--color-border)); }
.cp-btn-primary { background: var(--accent, var(--color-primary)); color: var(--color-text-inverse); border-color: var(--accent, var(--color-primary)); }
.cp-btn-primary:hover { opacity: 0.85; }
.cp-btn-secondary { background: var(--bg-tertiary, var(--color-bg-elevated)); color: var(--text-secondary); }
.cp-btn-secondary:hover { background: var(--hover-bg, var(--color-bg-hover)); }
.resize-handle-right {
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
.resize-handle-right:hover,
.resize-handle-right:active {
  background: var(--primary);
  opacity: 0.3;
}
</style>