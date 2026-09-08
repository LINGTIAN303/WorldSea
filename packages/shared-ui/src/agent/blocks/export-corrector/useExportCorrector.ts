import { ref, reactive, computed, watch, onBeforeUnmount, type Ref } from 'vue'
import { renderText, toBlob, renderAnimatedText, drawImageCover, drawImageContain } from '@worldsea/font-kit'
import type { TextAnimationEffect } from '@worldsea/font-kit'
import { encodeGif } from '@worldsea/motion-kit'
import type { ManuscriptBlock, ExportCorrectorConfig } from '@worldsea/agent-runtime'

// 默认校正配置
export const defaultConfig: ExportCorrectorConfig = {
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

// 可选宽高比预设
export const aspectRatios = [
  { label: '自由', value: null as number | null },
  { label: '1:1', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '16:9', value: 16 / 9 },
  { label: '3:4', value: 3 / 4 },
  { label: '9:16', value: 9 / 16 },
  { label: '2.35:1', value: 2.35 },
]

// GIF 动画效果映射：block.animation -> font-kit 的 TextAnimationEffect
const gifEffectMap: Record<string, TextAnimationEffect> = {
  'ink-drop': 'bounce',
  'brush-stroke': 'slideIn',
  'fade-in': 'fadeIn',
  'float-up': 'wave',
}

export interface UseExportCorrectorProps {
  show: boolean
  block: ManuscriptBlock
  modelValue: ExportCorrectorConfig
  gifMode: boolean
  writingMode: 'horizontal' | 'vertical'
  baseFontSize: number
  textColor: string
  bgColor: string | undefined
  bgImageUrl: string | null
  textShadow: string
}

export interface UseExportCorrectorEmits {
  (e: 'update:modelValue', value: ExportCorrectorConfig): void
  (e: 'close'): void
  (e: 'export:png', config: ExportCorrectorConfig): void
  (e: 'export:gif', config: ExportCorrectorConfig): void
}

/**
 * 导出校正器核心逻辑 composable
 * 负责预览渲染、尺寸控制、导出 PNG/GIF 等全部业务逻辑
 */
export function useExportCorrector(
  props: UseExportCorrectorProps,
  emit: UseExportCorrectorEmits,
  previewCanvasRef: Ref<HTMLCanvasElement | null>,
) {
  const localConfig = reactive<ExportCorrectorConfig>({ ...defaultConfig })
  const isRendering = ref(false)
  const loadedBgImage = ref<HTMLImageElement | null>(null)
  const devicePixelRatio = ref(typeof window !== 'undefined' ? window.devicePixelRatio : 1)
  let renderTimer: ReturnType<typeof setTimeout> | null = null
  let currentGifUrl: string | null = null

  const isFixedMode = computed(() => localConfig.dimensionMode === 'fixed')

  const resultSize = ref<{ width: number; height: number } | null>(null)

  const previewWidth = computed(() => {
    if (isFixedMode.value && localConfig.width && localConfig.height) return localConfig.width
    return resultSize.value?.width ?? 0
  })
  const previewHeight = computed(() => {
    if (isFixedMode.value && localConfig.width && localConfig.height) return localConfig.height
    return resultSize.value?.height ?? 0
  })

  // 构造 font-kit renderText 所需的参数对象
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

  // 渲染预览到 canvas
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

  // 固定尺寸模式下：将文字渲染结果合成到指定尺寸的画框中
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

  // 为渲染结果叠加水印（非固定尺寸模式）
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

  // 在画布右下角绘制水印文字
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

  // 防抖渲染
  function scheduleRender() {
    if (renderTimer) clearTimeout(renderTimer)
    renderTimer = setTimeout(() => renderPreview(), 300)
  }

  // 手动触发一次立即渲染
  function manualRender() {
    if (renderTimer) clearTimeout(renderTimer)
    renderPreview()
  }

  // 选择宽高比预设，自动计算 width/height
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

  // 宽度输入：保持宽高比联动
  function onWidthInput(e: Event) {
    const v = parseInt((e.target as HTMLInputElement).value)
    if (isNaN(v)) return
    localConfig.width = v
    if (localConfig.aspectRatio) {
      localConfig.height = Math.round(v / localConfig.aspectRatio)
    }
  }

  // 高度输入：保持宽高比联动
  function onHeightInput(e: Event) {
    const v = parseInt((e.target as HTMLInputElement).value)
    if (isNaN(v)) return
    localConfig.height = v
    if (localConfig.aspectRatio) {
      localConfig.width = Math.round(v * localConfig.aspectRatio)
    }
  }

  // 文字阴影开关
  function toggleShadow(e: Event) {
    const checked = (e.target as HTMLInputElement).checked
    localConfig.textShadow = checked ? (props.textShadow || '0px 1px 4px rgba(0,0,0,0.15)') : null
  }

  // 重置为默认配置
  function resetConfig() {
    Object.assign(localConfig, defaultConfig)
    scheduleRender()
  }

  // 保存当前配置到父组件
  function saveConfig() {
    emit('update:modelValue', { ...localConfig })
  }

  // 点击遮罩关闭
  function onOverlayClick() {
    emit('close')
  }

  // 加载背景图（带 CORS）
  function loadBgImage() {
    if (!props.bgImageUrl) { loadedBgImage.value = null; return }
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => { loadedBgImage.value = img; scheduleRender() }
    img.onerror = () => { loadedBgImage.value = null }
    img.src = props.bgImageUrl
  }

  // 按倍率放大画布
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

  // 将动画帧统一处理为 {width,height,data,delay} 结构
  function framesToGifInputs(result: any) {
    return result.frames.map((frame: any) => {
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
  }

  // 导出 PNG/JPEG/WebP
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

  // 导出 GIF 动画
  async function exportGif() {
    const includeBg = !isFixedMode.value
    const baseOpts = buildRenderOptions(includeBg)
    try {
      const result = renderAnimatedText({
        text: props.block.content.slice(0, 200),
        effect: gifEffectMap[props.block.animation] || 'typewriter',
        renderOptions: {
          ...baseOpts as any,
          textShadow: localConfig.textShadow ?? props.textShadow,
        },
        duration: 2000,
        fps: 15,
      })
      const gifFrames = framesToGifInputs(result)
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

  // 预览 GIF 动画（新窗口打开）
  function playGifPreview() {
    if (currentGifUrl) URL.revokeObjectURL(currentGifUrl)
    currentGifUrl = null
    const includeBg = !isFixedMode.value
    const baseOpts = buildRenderOptions(includeBg)
    const result = renderAnimatedText({
      text: props.block.content.slice(0, 100),
      effect: gifEffectMap[props.block.animation] || 'typewriter',
      renderOptions: {
        ...baseOpts as any,
        textShadow: localConfig.textShadow ?? props.textShadow,
      },
      duration: 2000,
      fps: 10,
    })
    {
      const gifFrames = framesToGifInputs(result)
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

  // show 切换：打开时载入配置/背景图并渲染，关闭时清理 GIF URL
  watch(() => props.show, (v) => {
    if (v) {
      Object.assign(localConfig, props.modelValue || defaultConfig)
      loadBgImage()
      renderPreview()
    } else {
      if (currentGifUrl) { URL.revokeObjectURL(currentGifUrl); currentGifUrl = null }
    }
  }, { immediate: false })

  // 背景图变化时重新加载
  watch(() => props.bgImageUrl, () => {
    if (props.show) loadBgImage()
  })

  // 监听所有影响渲染的配置字段，变化时防抖渲染
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

  return {
    localConfig,
    isRendering,
    devicePixelRatio,
    isFixedMode,
    previewWidth,
    previewHeight,
    renderPreview,
    manualRender,
    selectRatio,
    onWidthInput,
    onHeightInput,
    toggleShadow,
    resetConfig,
    saveConfig,
    onOverlayClick,
    exportPng,
    exportGif,
    playGifPreview,
  }
}
