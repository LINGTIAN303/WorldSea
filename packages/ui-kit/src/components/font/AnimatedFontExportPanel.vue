<template>
  <Teleport to="body">
    <Transition name="afp-backdrop">
      <div v-if="visible" class="afp-backdrop" @click="onClose" />
    </Transition>
    <Transition name="afp-panel">
      <div v-if="visible" class="afp-panel" role="dialog" aria-label="动画字体导出">
        <div class="afp-header">
          <WsIcon name="motion" size="sm" />
          <span class="afp-title">动画字体导出</span>
          <button class="afp-close" @click="onClose">✕</button>
        </div>

        <div class="afp-body">
          <div class="afp-section">
            <div class="afp-label">字体</div>
            <FontSelector v-model="fontFamily" placeholder="系统默认" />
          </div>

          <div class="afp-row">
            <div class="afp-section afp-section--half">
              <div class="afp-label">字号</div>
              <select v-model.number="fontSize" class="afp-select">
                <option v-for="s in sizeOptions" :key="s" :value="s">{{ s }}px</option>
              </select>
            </div>
            <div class="afp-section afp-section--half">
              <div class="afp-label">字重</div>
              <select v-model.number="fontWeight" class="afp-select">
                <option :value="400">Regular</option>
                <option :value="500">Medium</option>
                <option :value="600">Semibold</option>
                <option :value="700">Bold</option>
              </select>
            </div>
          </div>

          <div class="afp-section">
            <div class="afp-label">文本</div>
            <input v-model="textContent" class="afp-input" placeholder="输入文本..." />
          </div>

          <div class="afp-section">
            <div class="afp-label">动画效果</div>
            <div class="afp-effects">
              <button
                v-for="ef in effects"
                :key="ef"
                class="afp-effect-btn"
                :class="{ active: effect === ef }"
                @click="effect = ef"
              >
                {{ effectLabels[ef] }}
              </button>
            </div>
          </div>

          <div class="afp-row">
            <div class="afp-section afp-section--half">
              <div class="afp-label">时长 (ms)</div>
              <input v-model.number="duration" type="number" class="afp-input" min="100" max="5000" step="50" />
            </div>
            <div class="afp-section afp-section--half">
              <div class="afp-label">帧率</div>
              <select v-model.number="fps" class="afp-select">
                <option :value="10">10 fps</option>
                <option :value="15">15 fps</option>
                <option :value="24">24 fps</option>
                <option :value="30">30 fps</option>
              </select>
            </div>
          </div>

          <div class="afp-row">
            <div class="afp-section afp-section--half">
              <div class="afp-label">文字颜色</div>
              <div class="afp-color-wrap">
                <input type="color" v-model="textColor" class="afp-color" />
                <span class="afp-color-val">{{ textColor }}</span>
              </div>
            </div>
            <div class="afp-section afp-section--half">
              <div class="afp-label">背景颜色</div>
              <div class="afp-color-wrap">
                <input type="color" v-model="bgColor" class="afp-color" />
                <span class="afp-color-val">{{ bgColor }}</span>
              </div>
            </div>
          </div>

          <div v-if="previewUrl" class="afp-section">
            <div class="afp-label">预览</div>
            <div class="afp-preview-wrap">
              <img :src="previewUrl" class="afp-preview-img" alt="动画预览" />
            </div>
          </div>

          <div v-if="generating" class="afp-progress">
            <div class="afp-progress-bar" :style="{ width: progress + '%' }"></div>
            <span class="afp-progress-text">生成中... {{ Math.round(progress) }}%</span>
          </div>
        </div>

        <div class="afp-footer">
          <button class="afp-generate-btn" :disabled="!canGenerate || generating" @click="onGenerate">
            {{ generating ? '生成中...' : '生成预览' }}
          </button>
          <button class="afp-export-btn" :disabled="!previewUrl || generating" @click="onExport">
            导出 GIF
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onBeforeUnmount } from 'vue'
import WsIcon from '../WsIcon.vue'
import FontSelector from './FontSelector.vue'
import {
  renderAnimatedText,
  type TextAnimationEffect,
  type AnimatedTextResult,
} from '@worldsmith/font-kit'
import { encodeGif, gifFrameFromCanvas, type GifFrame } from '@worldsmith/motion-kit'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  'close': []
  'exported': [blob: Blob]
}>()

const fontFamily = ref('')
const fontSize = ref(28)
const fontWeight = ref(400)
const textContent = ref('你好世界')
const effect = ref<TextAnimationEffect>('fadeIn')
const duration = ref(1000)
const fps = ref(15)
const textColor = ref('#ffffff')
const bgColor = ref('#1a1a2e')

const generating = ref(false)
const progress = ref(0)
const previewUrl = ref('')
const lastGifBlob = ref<Blob | null>(null)
const lastResult = ref<AnimatedTextResult | null>(null)

const sizeOptions = [14, 18, 22, 28, 36, 48, 64, 72, 96]

const effects: TextAnimationEffect[] = ['fadeIn', 'slideIn', 'typewriter', 'pulse', 'bounce', 'wave']

const effectLabels: Record<TextAnimationEffect, string> = {
  fadeIn: '淡入',
  slideIn: '滑入',
  typewriter: '打字机',
  pulse: '脉冲',
  bounce: '弹跳',
  wave: '波浪',
}

const canGenerate = computed(() => !!textContent.value.trim())

function onClose() {
  emit('update:visible', false)
  emit('close')
}

async function onGenerate() {
  if (!canGenerate.value || generating.value) return

  generating.value = true
  progress.value = 0

  try {
    const result = renderAnimatedText({
      text: textContent.value,
      effect: effect.value,
      renderOptions: {
        fontFamily: fontFamily.value || undefined,
        fontSize: fontSize.value,
        fontWeight: fontWeight.value,
        color: textColor.value,
        backgroundColor: bgColor.value,
        padding: { top: 24, right: 32, bottom: 24, left: 32 },
      },
      fps: fps.value,
      duration: duration.value,
    })

    lastResult.value = result
    progress.value = 80

    const canvas = document.createElement('canvas')
    canvas.width = result.width
    canvas.height = result.height
    const ctx = canvas.getContext('2d')!

    const gifFrames: GifFrame[] = result.frames.map(f => {
      ctx.clearRect(0, 0, result.width, result.height)
      ctx.putImageData(f.imageData, 0, 0)
      return gifFrameFromCanvas(canvas, f.delay)
    })

    const data = encodeGif({
      width: result.width,
      height: result.height,
      frames: gifFrames,
      loop: 0,
    })

    progress.value = 100

    if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
    const blob = new Blob([Uint8Array.from(data)], { type: 'image/gif' })
    lastGifBlob.value = blob
    previewUrl.value = URL.createObjectURL(blob)
  } finally {
    generating.value = false
  }
}

function onExport() {
  if (!previewUrl.value || !lastGifBlob.value) return
  const a = document.createElement('a')
  a.href = previewUrl.value
  a.download = `animated-font-${effect.value}.gif`
  a.click()
  emit('exported', lastGifBlob.value!)
}

onBeforeUnmount(() => {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
})
</script>

<style scoped>
.afp-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-overlay, 200);
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.afp-panel {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: calc(var(--z-overlay, 200) + 1);
  width: 520px;
  max-height: 90vh;
  background: var(--modal-bg, var(--bg-secondary));
  border: 1px solid var(--border);
  border-radius: var(--radius-lg, 12px);
  box-shadow: var(--shadow-xl);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.afp-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
  background: var(--gradient-subtle, transparent);
}

.afp-title {
  flex: 1;
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-semibold);
  color: var(--text);
}

.afp-close {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: var(--font-size-lg);
  padding: 4px 8px;
  border-radius: var(--radius-sm, 4px);
  transition: background 0.12s, color 0.12s;
}

.afp-close:hover {
  background: var(--hover-bg);
  color: var(--text-color);
}

.afp-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.afp-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.afp-section--half {
  flex: 1;
}

.afp-label {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  color: var(--accent);
  text-transform: uppercase;
}

.afp-row {
  display: flex;
  gap: 12px;
}

.afp-select {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm, 4px);
  background: var(--input-bg);
  color: var(--text);
  font-size: var(--font-size-sm);
  cursor: pointer;
}

.afp-select:focus {
  outline: none;
  border-color: var(--accent);
}

.afp-input {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm, 4px);
  background: var(--input-bg);
  color: var(--text);
  font-size: var(--font-size-sm);
  box-sizing: border-box;
}

.afp-input:focus {
  outline: none;
  border-color: var(--accent);
}

.afp-effects {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.afp-effect-btn {
  padding: 4px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm, 4px);
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  font-size: var(--font-size-xs);
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s, color 0.12s, box-shadow 0.12s, transform 0.12s, opacity 0.12s, filter 0.12s;
}

.afp-effect-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.afp-effect-btn.active {
  background: var(--accent-bg, rgba(167, 139, 250, 0.12));
  color: var(--accent);
  border-color: var(--accent);
}

.afp-color-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.afp-color {
  width: 32px;
  height: 28px;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm, 4px);
  background: var(--input-bg);
  cursor: pointer;
}

.afp-color-val {
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  font-family: monospace;
}

.afp-preview-wrap {
  border: 1px solid var(--border);
  border-radius: var(--radius-md, 8px);
  background: var(--bg-tertiary);
  padding: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.afp-preview-img {
  max-width: 100%;
  max-height: 200px;
  image-rendering: auto;
}

.afp-progress {
  position: relative;
  height: 24px;
  background: var(--bg-tertiary);
  border-radius: var(--radius-sm, 4px);
  overflow: hidden;
}

.afp-progress-bar {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  background: var(--accent-bg, rgba(167, 139, 250, 0.3));
  transition: width 0.15s ease;
}

.afp-progress-text {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
}

.afp-footer {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 18px;
  border-top: 1px solid var(--border);
  background: var(--bg-tertiary);
}

.afp-generate-btn {
  flex: 1;
  padding: 8px 16px;
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm, 4px);
  background: var(--accent-bg, rgba(167, 139, 250, 0.12));
  color: var(--accent);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
}

.afp-generate-btn:hover:not(:disabled) {
  background: var(--accent);
  color: #fff;
}

.afp-generate-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.afp-export-btn {
  flex: 1;
  padding: 8px 16px;
  border: 1px solid var(--teal-500, #00c8b4);
  border-radius: var(--radius-sm, 4px);
  background: var(--teal-100, rgba(0, 200, 180, 0.1));
  color: var(--teal-500, #00c8b4);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
}

.afp-export-btn:hover:not(:disabled) {
  background: var(--teal-500, #00c8b4);
  color: #fff;
}

.afp-export-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.afp-backdrop-enter-active,
.afp-backdrop-leave-active {
  transition: opacity 0.2s ease;
}

.afp-backdrop-enter-from,
.afp-backdrop-leave-to {
  opacity: 0;
}

.afp-panel-enter-active,
.afp-panel-leave-active {
  transition: background 0.25s var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)), border-color 0.25s var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)), color 0.25s var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)), box-shadow 0.25s var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)), transform 0.25s var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)), opacity 0.25s var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)), filter 0.25s var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1));
}

.afp-panel-enter-from,
.afp-panel-leave-to {
  opacity: 0;
  transform: translate(-50%, -50%) scale(0.95);
}
</style>