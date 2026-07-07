<template>
  <Teleport to="body">
    <Transition name="corrector">
      <div v-if="show" class="corrector-overlay" @click.self="onOverlayClick">
        <div class="corrector-panel">
          <div class="corrector__header">
            <h2 class="corrector__title">导出校正器</h2>
            <button class="corrector__close" @click="emit('close')">
              <WsIcon name="close" size="xs" />
            </button>
          </div>

          <div class="corrector__body">
            <div class="corrector__left">
              <div class="preview-canvas-wrap" ref="previewWrapRef">
                <canvas ref="previewCanvasRef" />
                <div v-if="isRendering" class="preview-loading">渲染中...</div>
              </div>
              <div class="preview-info">
                <span>{{ previewWidth }} × {{ previewHeight }}px</span>
                <span class="preview-sep">·</span>
                <span class="preview-dpr">{{ devicePixelRatio }}x</span>
                <span v-if="isFixedMode" class="preview-tag">固定尺寸</span>
                <span v-else class="preview-tag">自适应</span>
                <button v-if="gifMode" class="preview-play-btn" @click="playGifPreview">▶ 预览动画</button>
              </div>
            </div>

            <div class="corrector__right">
              <div class="ctrl-section">
                <h4 class="ctrl-title">尺寸</h4>
                <div class="ctrl-mode-toggle">
                  <button :class="['ctrl-btn-sm', { active: !isFixedMode }]" @click="localConfig.dimensionMode = 'auto'">Auto</button>
                  <button :class="['ctrl-btn-sm', { active: isFixedMode }]" @click="localConfig.dimensionMode = 'fixed'">Fixed</button>
                </div>
                <div v-if="isFixedMode" class="ctrl-ratios">
                  <button
                    v-for="r in aspectRatios"
                    :key="r.label"
                    :class="['ctrl-btn-ratio', { active: localConfig.aspectRatio === r.value }]"
                    @click="selectRatio(r.value)"
                  >{{ r.label }}</button>
                </div>
                <div v-if="isFixedMode" class="ctrl-dim-inputs">
                  <label class="ctrl-dim">宽 <input type="number" :value="localConfig.width ?? ''" @input="onWidthInput" min="100" max="2000" /></label>
                  <label class="ctrl-dim">高 <input type="number" :value="localConfig.height ?? ''" @input="onHeightInput" min="100" max="2000" /></label>
                </div>
                <label v-if="isFixedMode" class="ctrl-row">圆角
                  <input type="range" min="0" max="60" :value="localConfig.borderRadius" @input="localConfig.borderRadius = Number(($event.target as HTMLInputElement).value)" />
                  <span class="ctrl-val">{{ localConfig.borderRadius }}px</span>
                </label>
              </div>

              <div class="ctrl-section">
                <h4 class="ctrl-title">布局</h4>
                <label class="ctrl-row">内边距
                  <input type="range" min="0" max="80" :value="localConfig.padding" @input="localConfig.padding = Number(($event.target as HTMLInputElement).value)" />
                  <span class="ctrl-val">{{ localConfig.padding }}px</span>
                </label>
                <label v-if="writingMode === 'horizontal'" class="ctrl-row">最大宽度
                  <input type="range" min="200" max="1200" :value="localConfig.maxWidth" @input="localConfig.maxWidth = Number(($event.target as HTMLInputElement).value)" />
                  <span class="ctrl-val">{{ localConfig.maxWidth }}px</span>
                </label>
                <label v-else class="ctrl-row">列高
                  <input type="range" min="200" max="2000" :value="localConfig.maxWidth" @input="localConfig.maxWidth = Number(($event.target as HTMLInputElement).value)" />
                  <span class="ctrl-val">{{ localConfig.maxWidth }}px</span>
                </label>
              </div>

              <div class="ctrl-section">
                <h4 class="ctrl-title">背景</h4>
                <label class="ctrl-row">适配
                  <select :value="localConfig.backgroundFit" @change="localConfig.backgroundFit = ($event.target as HTMLSelectElement).value as any">
                    <option value="cover">Cover</option>
                    <option value="contain">Contain</option>
                    <option value="stretch">Stretch</option>
                  </select>
                </label>
                <label class="ctrl-row">颜色覆盖
                  <input type="color" :value="localConfig.bgColorOverride || '#000000'" @input="localConfig.bgColorOverride = ($event.target as HTMLInputElement).value" />
                  <button class="ctrl-btn-xs" @click="localConfig.bgColorOverride = null">继承</button>
                </label>
              </div>

              <div class="ctrl-section">
                <h4 class="ctrl-title">文字</h4>
                <label class="ctrl-row">字号
                  <input type="range" min="10" max="72" :value="localConfig.fontSizeOverride ?? baseFontSize" @input="localConfig.fontSizeOverride = Number(($event.target as HTMLInputElement).value)" />
                  <span class="ctrl-val">{{ localConfig.fontSizeOverride ?? baseFontSize }}px</span>
                  <button v-if="localConfig.fontSizeOverride" class="ctrl-btn-xs" @click="localConfig.fontSizeOverride = null">继承</button>
                </label>
                <label class="ctrl-row">行高
                  <input type="range" min="1" max="4" step="0.1" :value="localConfig.lineHeightOverride ?? 2" @input="localConfig.lineHeightOverride = Number(($event.target as HTMLInputElement).value)" />
                  <span class="ctrl-val">{{ localConfig.lineHeightOverride ?? '继承' }}</span>
                  <button v-if="localConfig.lineHeightOverride" class="ctrl-btn-xs" @click="localConfig.lineHeightOverride = null">继承</button>
                </label>
                <div class="ctrl-row">
                  <span>阴影</span>
                  <label class="ctrl-toggle">
                    <input type="checkbox" :checked="!!localConfig.textShadow" @change="toggleShadow" />
                    {{ localConfig.textShadow ? '已启用' : '继承' }}
                  </label>
                </div>
                <div class="ctrl-row">
                  <span>对齐</span>
                  <div class="ctrl-align-toggle">
                    <button :class="['ctrl-btn-xs', { active: localConfig.textAlign === 'left' }]" @click="localConfig.textAlign = 'left'">左</button>
                    <button :class="['ctrl-btn-xs', { active: localConfig.textAlign === 'center' }]" @click="localConfig.textAlign = 'center'">中</button>
                    <button :class="['ctrl-btn-xs', { active: localConfig.textAlign === 'right' }]" @click="localConfig.textAlign = 'right'">右</button>
                  </div>
                </div>
                <label class="ctrl-row">字间距
                  <input type="range" min="0" max="0.5" step="0.01" :value="localConfig.letterSpacingOverride ?? 0" @input="localConfig.letterSpacingOverride = Number(($event.target as HTMLInputElement).value)" />
                  <span class="ctrl-val">{{ localConfig.letterSpacingOverride != null ? localConfig.letterSpacingOverride.toFixed(2) + 'em' : '继承' }}</span>
                  <button v-if="localConfig.letterSpacingOverride != null" class="ctrl-btn-xs" @click="localConfig.letterSpacingOverride = null">继承</button>
                </label>
              </div>

              <div class="ctrl-section">
                <h4 class="ctrl-title">水印</h4>
                <input class="ctrl-input" type="text" placeholder="右下角叠加文字" :value="localConfig.watermark" @input="localConfig.watermark = ($event.target as HTMLInputElement).value" />
              </div>

              <div class="ctrl-section">
                <h4 class="ctrl-title">导出</h4>
                <div class="ctrl-row">
                  <span>格式</span>
                  <select :value="localConfig.outputFormat" @change="localConfig.outputFormat = ($event.target as HTMLSelectElement).value as any">
                    <option value="png">PNG</option>
                    <option value="jpeg">JPEG</option>
                    <option value="webp">WebP</option>
                  </select>
                </div>
                <label v-if="localConfig.outputFormat !== 'png'" class="ctrl-row">质量
                  <input type="range" min="0.1" max="1" step="0.02" :value="localConfig.outputQuality" @input="localConfig.outputQuality = Number(($event.target as HTMLInputElement).value)" />
                  <span class="ctrl-val">{{ Math.round(localConfig.outputQuality * 100) }}%</span>
                </label>
                <div class="ctrl-row">
                  <span>倍率</span>
                  <div class="ctrl-align-toggle">
                    <button :class="['ctrl-btn-xs', { active: localConfig.outputScale === 1 }]" @click="localConfig.outputScale = 1">1×</button>
                    <button :class="['ctrl-btn-xs', { active: localConfig.outputScale === 2 }]" @click="localConfig.outputScale = 2">2×</button>
                    <button :class="['ctrl-btn-xs', { active: localConfig.outputScale === 3 }]" @click="localConfig.outputScale = 3">3×</button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="corrector__footer">
            <button class="ft-btn" @click="manualRender">手动渲染</button>
            <span class="ft-spacer" />
            <button class="ft-btn" @click="resetConfig">重置</button>
            <button class="ft-btn" @click="saveConfig">保存配置</button>
            <button class="ft-btn ft-btn--primary" @click="exportPng">导出 {{ localConfig.outputFormat.toUpperCase() }}</button>
            <button v-if="gifMode" class="ft-btn ft-btn--primary" @click="exportGif">导出 GIF</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onBeforeUnmount } from 'vue'
import { renderText, toBlob, renderAnimatedText, drawImageCover, drawImageContain } from '@worldsmith/font-kit'
import type { TextAnimationEffect } from '@worldsmith/font-kit'
import { encodeGif } from '@worldsmith/motion-kit'
import WsIcon from '../../ui/WsIcon.vue'
import type { ManuscriptBlock, ExportCorrectorConfig } from '@agent/index'

const props = withDefaults(defineProps<{
  show: boolean
  block: ManuscriptBlock
  modelValue: ExportCorrectorConfig
  gifMode?: boolean
  writingMode: 'horizontal' | 'vertical'
  baseFontSize: number
  textColor: string
  bgColor: string | undefined
  bgImageUrl: string | null
  textShadow: string
}>(), {
  gifMode: false,
  bgColor: undefined,
  bgImageUrl: null,
})

const emit = defineEmits<{
  'update:modelValue': [value: ExportCorrectorConfig]
  'close': []
  'export:png': [config: ExportCorrectorConfig]
  'export:gif': [config: ExportCorrectorConfig]
}>()

const defaultConfig: ExportCorrectorConfig = {
  dimensionMode: 'auto',
  aspectRatio: null,
  width: null,
  height: null,
  padding: 32,
  maxWidth: 480,
  backgroundFit: 'cover',
  bgColorOverride: null,
  fontSizeOverride: null,
  lineHeightOverride: null,
  textShadow: null,
  watermark: '',
  borderRadius: 0,
  outputFormat: 'png',
  outputQuality: 0.92,
  outputScale: 1,
  textAlign: 'center',
  letterSpacingOverride: null,
}

const aspectRatios = [
  { label: '自由', value: null as number | null },
  { label: '1:1', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '16:9', value: 16 / 9 },
  { label: '3:4', value: 3 / 4 },
  { label: '9:16', value: 9 / 16 },
  { label: '2.35:1', value: 2.35 },
]

const localConfig = reactive<ExportCorrectorConfig>({ ...defaultConfig })
const previewCanvasRef = ref<HTMLCanvasElement | null>(null)
const isRendering = ref(false)
const loadedBgImage = ref<HTMLImageElement | null>(null)
const devicePixelRatio = ref(typeof window !== 'undefined' ? window.devicePixelRatio : 1)
let renderTimer: ReturnType<typeof setTimeout> | null = null
let currentGifUrl: string | null = null

const isFixedMode = computed(() => localConfig.dimensionMode === 'fixed')

const previewWidth = computed(() => {
  if (isFixedMode.value && localConfig.width && localConfig.height) return localConfig.width
  return resultSize.value?.width ?? 0
})
const previewHeight = computed(() => {
  if (isFixedMode.value && localConfig.width && localConfig.height) return localConfig.height
  return resultSize.value?.height ?? 0
})

const resultSize = ref<{ width: number; height: number } | null>(null)

function buildRenderOptions(includeBg = true) {
  const opts: Record<string, any> = {
    text: props.block.content,
    fontFamily: props.block.fontFamily || 'sans-serif',
    fontSize: localConfig.fontSizeOverride ?? props.baseFontSize,
    fontWeight: props.block.fontWeight ? Number(props.block.fontWeight) : undefined,
    letterSpacing: localConfig.letterSpacingOverride != null ? `${localConfig.letterSpacingOverride}em` : (props.block.letterSpacing ?? undefined),
    color: props.textColor,
    textAlign: localConfig.textAlign,
    maxWidth: localConfig.maxWidth ?? (props.writingMode === 'vertical' ? 600 : undefined),
    padding: localConfig.padding,
    writingMode: props.writingMode,
    textShadow: localConfig.textShadow ?? props.textShadow,
    lineHeight: localConfig.lineHeightOverride ?? undefined,
  }
  if (includeBg) {
    opts.backgroundColor = localConfig.bgColorOverride ?? props.bgColor
    if (loadedBgImage.value) opts.backgroundImage = loadedBgImage.value
    opts.backgroundPosition = localConfig.backgroundFit
  }
  Object.keys(opts).forEach(k => { if (opts[k] === undefined || opts[k] === null) delete opts[k] })
  return opts
}

function renderPreview() {
  if (!previewCanvasRef.value || !props.block.content) return
  isRendering.value = true
  try {
    const includeBg = !isFixedMode.value
    const opts = buildRenderOptions(includeBg) as any
    const result = renderText(opts as any)
    resultSize.value = { width: result.width, height: result.height }

    let canvas = result.canvas
    if (isFixedMode.value && localConfig.width && localConfig.height) {
      canvas = applyFrame(canvas)
    } else if (localConfig.watermark) {
      canvas = applyWatermark(canvas)
    }

    const ctx = previewCanvasRef.value.getContext('2d')
    if (!ctx) return
    previewCanvasRef.value.width = canvas.width
    previewCanvasRef.value.height = canvas.height
    previewCanvasRef.value.style.maxWidth = '100%'
    previewCanvasRef.value.style.maxHeight = '100%'
    ctx.drawImage(canvas, 0, 0)
  } catch (err) {
    console.warn('[ExportCorrector] 预览渲染失败', err)
  } finally {
    isRendering.value = false
  }
}

function applyFrame(source: HTMLCanvasElement): HTMLCanvasElement {
  const tw = localConfig.width!
  const th = localConfig.height!
  const frame = document.createElement('canvas')
  frame.width = tw
  frame.height = th
  const fctx = frame.getContext('2d')!
  const r = localConfig.borderRadius

  if (r) { fctx.beginPath(); fctx.roundRect(0, 0, tw, th, r); fctx.clip() }

  if (loadedBgImage.value) {
    const fit = localConfig.backgroundFit
    if (fit === 'cover') drawImageCover(fctx, loadedBgImage.value, tw, th)
    else if (fit === 'contain') drawImageContain(fctx, loadedBgImage.value, tw, th)
    else fctx.drawImage(loadedBgImage.value, 0, 0, tw, th)
  } else if (localConfig.bgColorOverride ?? props.bgColor) {
    fctx.fillStyle = localConfig.bgColorOverride ?? props.bgColor!
    fctx.fillRect(0, 0, tw, th)
  }
  const align = localConfig.textAlign
  const isVert = props.writingMode === 'vertical'
  let dx: number, dy: number
  if (isVert) {
    dx = Math.max(0, (tw - source.width) / 2)
    if (align === 'left') {
      dy = localConfig.padding
    } else if (align === 'right') {
      dy = th - source.height - localConfig.padding
    } else {
      dy = Math.max(0, (th - source.height) / 2)
    }
  } else {
    if (align === 'left') {
      dx = localConfig.padding
    } else if (align === 'right') {
      dx = tw - source.width - localConfig.padding
    } else {
      dx = Math.max(0, (tw - source.width) / 2)
    }
    dy = Math.max(0, (th - source.height) / 2)
  }
  fctx.drawImage(source, dx, dy)
  if (localConfig.watermark) drawWatermark(fctx, tw, th)
  return frame
}

function applyWatermark(source: HTMLCanvasElement): HTMLCanvasElement {
  if (!localConfig.watermark) return source
  const canvas = document.createElement('canvas')
  canvas.width = source.width
  canvas.height = source.height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(source, 0, 0)
  drawWatermark(ctx, source.width, source.height)
  return canvas
}

function drawWatermark(ctx: CanvasRenderingContext2D, w: number, h: number) {
  if (!localConfig.watermark) return
  ctx.save()
  ctx.font = '12px sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.35)'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'bottom'
  ctx.fillText(localConfig.watermark, w - 10, h - 8)
  ctx.restore()
}

function scheduleRender() {
  if (renderTimer) clearTimeout(renderTimer)
  renderTimer = setTimeout(() => renderPreview(), 300)
}

function manualRender() {
  if (renderTimer) clearTimeout(renderTimer)
  renderPreview()
}

function selectRatio(value: number | null) {
  localConfig.aspectRatio = value
  if (value) {
    if (!localConfig.width && !localConfig.height) {
      localConfig.width = 800
    }
    if (localConfig.width) {
      localConfig.height = Math.round(localConfig.width / value)
    } else {
      localConfig.width = Math.round((localConfig.height || 600) * value)
    }
  } else if (!localConfig.width && !localConfig.height) {
    localConfig.width = 800
    localConfig.height = 600
  }
}

function onWidthInput(e: Event) {
  const v = parseInt((e.target as HTMLInputElement).value)
  if (isNaN(v)) return
  localConfig.width = v
  if (localConfig.aspectRatio) {
    localConfig.height = Math.round(v / localConfig.aspectRatio)
  }
}

function onHeightInput(e: Event) {
  const v = parseInt((e.target as HTMLInputElement).value)
  if (isNaN(v)) return
  localConfig.height = v
  if (localConfig.aspectRatio) {
    localConfig.width = Math.round(v * localConfig.aspectRatio)
  }
}

function toggleShadow(e: Event) {
  const checked = (e.target as HTMLInputElement).checked
  localConfig.textShadow = checked ? (props.textShadow || '0px 1px 4px rgba(0,0,0,0.15)') : null
}

function resetConfig() {
  Object.assign(localConfig, defaultConfig)
  scheduleRender()
}

function saveConfig() {
  emit('update:modelValue', { ...localConfig })
}

function onOverlayClick() {
  emit('close')
}

function loadBgImage() {
  if (!props.bgImageUrl) { loadedBgImage.value = null; return }
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.onload = () => { loadedBgImage.value = img; scheduleRender() }
  img.onerror = () => { loadedBgImage.value = null }
  img.src = props.bgImageUrl
}

function scaleCanvas(source: HTMLCanvasElement, scale: number): HTMLCanvasElement {
  if (scale <= 1) return source
  const out = document.createElement('canvas')
  out.width = source.width * scale
  out.height = source.height * scale
  const ctx = out.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.scale(scale, scale)
  ctx.drawImage(source, 0, 0)
  return out
}

async function exportPng() {
  const includeBg = !isFixedMode.value
  const opts = buildRenderOptions(includeBg) as any
  let canvas: HTMLCanvasElement
  try {
    const result = renderText(opts as any)
    canvas = result.canvas
    if (isFixedMode.value && localConfig.width && localConfig.height) {
      canvas = applyFrame(canvas)
    } else if (localConfig.watermark) {
      canvas = applyWatermark(canvas)
    }
  } catch (err) {
    console.error('导出PNG失败:', err)
    return
  }
  canvas = scaleCanvas(canvas, localConfig.outputScale)
  const fmt = localConfig.outputFormat
  const blob = await toBlob(canvas, fmt, fmt !== 'png' ? localConfig.outputQuality : undefined)
  if (!blob) return
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `manuscript-${props.block.id}.${fmt === 'jpeg' ? 'jpg' : fmt}`
  a.click()
  URL.revokeObjectURL(url)
  emit('export:png', { ...localConfig })
}

async function exportGif() {
  const effectMap: Record<string, TextAnimationEffect> = {
    'ink-drop': 'bounce',
    'brush-stroke': 'slideIn',
    'fade-in': 'fadeIn',
    'float-up': 'wave',
  }
  const includeBg = !isFixedMode.value
  const baseOpts = buildRenderOptions(includeBg)
  try {
    const result = renderAnimatedText({
      text: props.block.content.slice(0, 200),
      effect: effectMap[props.block.animation] || 'typewriter',
      renderOptions: {
        ...baseOpts as any,
        textShadow: localConfig.textShadow ?? props.textShadow,
      },
      duration: 2000,
      fps: 15,
    })
    const gifFrames = result.frames.map((frame: any) => {
      let canvas = document.createElement('canvas')
      canvas.width = frame.width
      canvas.height = frame.height
      const ctx = canvas.getContext('2d')!
      ctx.putImageData(frame.imageData, 0, 0)
      if (isFixedMode.value && localConfig.width && localConfig.height) {
        canvas = applyFrame(canvas)
      } else if (localConfig.watermark) {
        canvas = applyWatermark(canvas)
      }
      canvas = scaleCanvas(canvas, localConfig.outputScale)
      const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
      return { width: canvas.width, height: canvas.height, data, delay: frame.delay }
    })
    const gifData = encodeGif({
      width: gifFrames[0].width,
      height: gifFrames[0].height,
      frames: gifFrames,
      loop: 0,
    })
    const gifBlob = new Blob([Uint8Array.from(gifData)], { type: 'image/gif' })
    const url = URL.createObjectURL(gifBlob)
    const a = document.createElement('a')
    a.href = url
    a.download = `manuscript-${props.block.id}.gif`
    a.click()
    URL.revokeObjectURL(url)
  } catch (err) {
    console.error('导出GIF失败:', err)
  }
  emit('export:gif', { ...localConfig })
}

function playGifPreview() {
  if (currentGifUrl) URL.revokeObjectURL(currentGifUrl)
  currentGifUrl = null
  const effectMap: Record<string, TextAnimationEffect> = {
    'ink-drop': 'bounce',
    'brush-stroke': 'slideIn',
    'fade-in': 'fadeIn',
    'float-up': 'wave',
  }
  const includeBg = !isFixedMode.value
  const baseOpts = buildRenderOptions(includeBg)
  const result = renderAnimatedText({
    text: props.block.content.slice(0, 100),
    effect: effectMap[props.block.animation] || 'typewriter',
    renderOptions: {
      ...baseOpts as any,
      textShadow: localConfig.textShadow ?? props.textShadow,
    },
    duration: 2000,
    fps: 10,
  })
  {
    const gifFrames = result.frames.map((frame: any) => {
      let canvas = document.createElement('canvas')
      canvas.width = frame.width
      canvas.height = frame.height
      const ctx = canvas.getContext('2d')!
      ctx.putImageData(frame.imageData, 0, 0)
      if (isFixedMode.value && localConfig.width && localConfig.height) {
        canvas = applyFrame(canvas)
      } else if (localConfig.watermark) {
        canvas = applyWatermark(canvas)
      }
      canvas = scaleCanvas(canvas, localConfig.outputScale)
      const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
      return { width: canvas.width, height: canvas.height, data, delay: frame.delay }
    })
    const gifData = encodeGif({
      width: gifFrames[0].width,
      height: gifFrames[0].height,
      frames: gifFrames,
      loop: 0,
    })
    const blob = new Blob([Uint8Array.from(gifData)], { type: 'image/gif' })
    currentGifUrl = URL.createObjectURL(blob)
    window.open(currentGifUrl, '_blank')
  }
}

watch(() => props.show, (v) => {
  if (v) {
    Object.assign(localConfig, props.modelValue || defaultConfig)
    loadBgImage()
    renderPreview()
  } else {
    if (currentGifUrl) { URL.revokeObjectURL(currentGifUrl); currentGifUrl = null }
  }
}, { immediate: false })

watch(() => props.bgImageUrl, () => {
  if (props.show) loadBgImage()
})

const watchedFields = computed(() => [
  localConfig.padding,
  localConfig.maxWidth,
  localConfig.backgroundFit,
  localConfig.fontSizeOverride,
  localConfig.lineHeightOverride,
  localConfig.textShadow,
  localConfig.watermark,
  localConfig.dimensionMode,
  localConfig.width,
  localConfig.height,
  localConfig.aspectRatio,
  localConfig.bgColorOverride,
  localConfig.borderRadius,
  localConfig.textAlign,
  localConfig.letterSpacingOverride,
])

watch(watchedFields, () => {
  if (props.show) scheduleRender()
})

onBeforeUnmount(() => {
  if (renderTimer) clearTimeout(renderTimer)
  if (currentGifUrl) URL.revokeObjectURL(currentGifUrl)
})
</script>

<style scoped>
.corrector-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(4px);
}
.corrector-panel {
  background: var(--modal-bg, #1a1a2e);
  border: 1px solid var(--modal-border, rgba(255,255,255,0.1));
  border-radius: 12px;
  width: 95vw;
  max-width: 1200px;
  height: 88vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 16px 64px rgba(0,0,0,0.5);
}
.corrector__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  border-bottom: 1px solid rgba(255,255,255,0.08);
}
.corrector__title {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
}
.corrector__close {
  width: 28px; height: 28px;
  border: none; background: transparent;
  border-radius: 6px;
  cursor: pointer;
  color: var(--text-tertiary, #888);
  display: flex; align-items: center; justify-content: center;
}
.corrector__close:hover {
  background: rgba(255,255,255,0.1);
  color: var(--text-primary, #fff);
}
.corrector__body {
  flex: 1;
  display: flex;
  gap: 0;
  overflow: hidden;
}
.corrector__left {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px;
  min-width: 0;
}
.preview-canvas-wrap {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  min-height: 200px;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 8px;
  background: var(--bg-tertiary, #12121e);
  overflow: hidden;
}
.preview-canvas-wrap canvas {
  display: block;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.preview-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--text-tertiary, #888);
  background: rgba(0,0,0,0.4);
}
.preview-info {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-tertiary, #888);
  display: flex;
  align-items: center;
  gap: 6px;
}
.preview-sep { opacity: 0.4; }
.preview-tag {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(255,255,255,0.06);
}
.preview-play-btn {
  font-size: 11px;
  padding: 2px 10px;
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 4px;
  background: rgba(255,255,255,0.06);
  cursor: pointer;
  color: inherit;
}
.preview-play-btn:hover {
  background: rgba(255,255,255,0.12);
}
.corrector__right {
  width: 320px;
  flex-shrink: 0;
  overflow-y: auto;
  padding: 16px 20px;
  border-left: 1px solid rgba(255,255,255,0.08);
}
.ctrl-section {
  margin-bottom: 20px;
}
.ctrl-title {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  opacity: 0.5;
  margin: 0 0 10px;
}
.ctrl-mode-toggle {
  display: flex;
  gap: 4px;
  margin-bottom: 8px;
}
.ctrl-btn-sm {
  flex: 1;
  padding: 4px 8px;
  font-size: 11px;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  color: inherit;
  font-family: inherit;
}
.ctrl-btn-sm.active {
  background: rgba(255,255,255,0.12);
  border-color: rgba(255,255,255,0.3);
}
.ctrl-ratios {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 8px;
}
.ctrl-btn-ratio {
  padding: 3px 8px;
  font-size: 11px;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  color: inherit;
  font-family: inherit;
}
.ctrl-btn-ratio.active {
  background: rgba(255,255,255,0.15);
  border-color: rgba(255,255,255,0.3);
}
.ctrl-dim-inputs {
  display: flex;
  gap: 8px;
}
.ctrl-dim {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
}
.ctrl-dim input {
  width: 70px;
  padding: 3px 6px;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 4px;
  background: rgba(255,255,255,0.04);
  color: inherit;
  font-size: 12px;
  font-family: inherit;
}
.ctrl-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  margin-bottom: 6px;
}
.ctrl-row input[type="range"] {
  flex: 1;
  max-width: 120px;
  height: 4px;
  accent-color: var(--color-accent, #6c8cff);
}
.ctrl-row select {
  padding: 2px 6px;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 4px;
  background: rgba(255,255,255,0.04);
  color: inherit;
  font-size: 12px;
  font-family: inherit;
}
.ctrl-row input[type="color"] {
  width: 28px;
  height: 22px;
  padding: 0;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
}
.ctrl-val {
  font-size: 11px;
  opacity: 0.6;
  min-width: 30px;
}
.ctrl-btn-xs {
  font-size: 10px;
  padding: 1px 6px;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 3px;
  background: transparent;
  cursor: pointer;
  color: inherit;
  font-family: inherit;
}
.ctrl-btn-xs:hover {
  background: rgba(255,255,255,0.08);
}
.ctrl-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
}
.ctrl-align-toggle {
  display: flex;
  gap: 2px;
}
.ctrl-align-toggle .ctrl-btn-xs.active {
  background: rgba(255,255,255,0.15);
  border-color: rgba(255,255,255,0.3);
}
.ctrl-input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 4px;
  background: rgba(255,255,255,0.04);
  color: inherit;
  font-size: 12px;
  font-family: inherit;
  box-sizing: border-box;
}
.corrector__footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 24px;
  border-top: 1px solid rgba(255,255,255,0.08);
}
.ft-spacer {
  flex: 1;
}
.ft-btn {
  padding: 6px 16px;
  font-size: 12px;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  color: inherit;
  font-family: inherit;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
}
.ft-btn:hover {
  background: rgba(255,255,255,0.08);
}
.ft-btn--primary {
  background: var(--color-accent, #6c8cff);
  border-color: var(--color-accent, #6c8cff);
  color: #fff;
}
.ft-btn--primary:hover {
  opacity: 0.9;
}

.corrector-enter-active, .corrector-leave-active {
  transition: opacity 0.2s ease;
}
.corrector-enter-from, .corrector-leave-to {
  opacity: 0;
}
</style>
