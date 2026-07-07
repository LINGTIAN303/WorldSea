<template>
  <div
    class="manuscript-canvas"
    :class="canvasClasses"
    :style="canvasStyles"
    :data-manuscript-id="block.id"
    @mouseenter="isHovered = true"
    @mouseleave="isHovered = false"
  >
    <!-- 背景遮罩层：由 Agent 通过 backgroundOverlay 参数控制 -->
    <div v-if="block.backgroundOverlay" class="ms-bg-overlay" :style="{ background: block.backgroundOverlay }"></div>
    <div class="manuscript-header">
      <span class="manuscript-icon"><WsIcon name="scroll-text" size="xs" /></span>
      <span class="manuscript-title">{{ block.title || '文境' }}</span>
      <div class="manuscript-toolbar" :class="{ visible: isHovered }">
        <button class="ms-tool-btn" @click="toggleLayout" :title="activeLayout === 'vertical' ? '切换横式' : '切换竖式'">
          {{ activeLayout === 'vertical' ? '横' : '竖' }}
        </button>
        <button class="ms-tool-btn" @click="cycleShadow" title="切换阴影">影</button>
        <button class="ms-tool-btn" @click="cycleAnimation" title="切换动画">
          {{ animationLabel }}
        </button>
        <button class="ms-tool-btn" @click="openCorrector(false)" title="导出PNG">PNG</button>
        <button class="ms-tool-btn" @click="openCorrector(true)" title="导出GIF">GIF</button>
      </div>
    </div>

    <div
      class="manuscript-body"
      :class="{ 'vertical-rl': activeLayout === 'vertical' }"
      :style="bodyStyles"
      @wheel="onWheel"
    >
      <template v-for="(char, index) in allChars" :key="index">
        <br v-if="char === '\n' && index < visibleCount" class="ms-br" />
        <span
          v-else-if="char !== '\n'"
          class="ms-char"
          :class="[`anim-${activeAnimation}`, { 'char-visible': index < visibleCount }]"
          :style="charStyle(index)"
        >{{ char }}</span>
      </template>
      <span v-if="isStreaming" class="ms-cursor">|</span>
    </div>

    <div v-if="block.decoration === 'seal'" class="manuscript-seal">印</div>
    <div v-if="block.decoration === 'flourish'" class="manuscript-flourish"></div>
    <div v-if="block.decoration === 'border'" class="manuscript-border-deco"></div>

    <!-- 左下角 resize 手柄 -->
    <div class="ms-resize-handle" @mousedown.left="onResizeStart"></div>

    <ExportCorrectorDialog
      :show="showCorrector"
      :block="props.block"
      :model-value="localExportConfig"
      :gif-mode="gifMode"
      :writing-mode="activeLayout"
      :base-font-size="resolveFontSize()"
      :text-color="canvasStyles.color || '#e0e0e0'"
      :bg-color="canvasStyles.background || '#1a1a2e'"
      :bg-image-url="resolvedBgImageUrl"
      :text-shadow="resolveTextShadow()"
      @update:model-value="onCorrectorConfigUpdate"
      @close="showCorrector = false"
      @export:png="onCorrectorExport"
      @export:gif="onCorrectorExport"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import WsIcon from '../../ui/WsIcon.vue'
import type { ManuscriptBlock } from '@agent/index'
import { useManuscriptAnimation } from '../composables/useManuscriptAnimation'
import { useTheme } from '../../composables/useTheme'
import { usePersonaFont } from '../../space/composables/usePersonaFont'
import { useFileStore, useImageResolver } from '@worldsmith/entity-core'
import { getImage, getByPath, blobToDataUrl, onImagePersisted } from '@agent/stores/image-persistence'
import type { ExportCorrectorConfig } from '@agent/index'
import ExportCorrectorDialog from './ExportCorrectorDialog.vue'

const props = defineProps<{ block: ManuscriptBlock }>()
const emit = defineEmits<{
  action: [event: { blockId: string; action: string; data?: Record<string, unknown> }]
  localAction: [event: { blockId: string; action: string; data?: Record<string, unknown> }]
}>()

const isHovered = ref(false)
const { currentThemeId } = useTheme()
const { profile } = usePersonaFont()
const fileStore = useFileStore()

const { allChars, visibleCount, isStreaming } = useManuscriptAnimation(props.block)

const activeLayout = ref(props.block.layout)
const activeAnimation = ref(props.block.animation)
const activeShadow = ref(props.block.shadow)

// 容器尺寸：支持用户拉伸。不指定时使用 undefined，由 CSS min-width 控制
const containerWidth = ref<number | undefined>(props.block.width || undefined)
const containerHeight = ref<number | undefined>(props.block.height || undefined)

// 导出矫正器状态
const showCorrector = ref(false)
const gifMode = ref(false)
const defaultExportConfig: ExportCorrectorConfig = {
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
const localExportConfig = ref<ExportCorrectorConfig>({ ...defaultExportConfig })

// 异步解析的背景图片 URL
const resolvedBgImageUrl = ref<string | null>(null)
let currentBgBlobUrl: string | null = null

// 共享解析循环：onImagePersisted 事件 + 退避重试，覆盖 persistImage 的 fire-and-forget 写入窗口
const bgResolver = useImageResolver({
  subscribe: (l) => onImagePersisted(l),
})

function revokeBgBlobUrl() {
  if (currentBgBlobUrl) {
    URL.revokeObjectURL(currentBgBlobUrl)
    currentBgBlobUrl = null
  }
}

/** 将 base64 字符串转为 Blob */
function base64ToBlob(base64: string, mimeType: string): Blob {
  const byteString = atob(base64)
  const ab = new ArrayBuffer(byteString.length)
  const ia = new Uint8Array(ab)
  for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i)
  return new Blob([ab], { type: mimeType })
}

/** 解析 file: 引用（与 A2UIResolvedImage 相同逻辑） */
function parseFileRef(raw: string): { type: 'fileId'; fileId: string } | { type: 'path'; path: string } | null {
  if (!raw.startsWith('file:')) return null
  const rest = raw.slice(5)
  if (rest.startsWith('//')) return { type: 'path', path: decodeURIComponent(rest.slice(2)) }
  if (rest.startsWith('/')) return { type: 'path', path: decodeURIComponent(rest.slice(1)) }
  return { type: 'fileId', fileId: rest }
}

interface ResolveResult {
  url: string
  isBlob: boolean
}

/** 解析缓存：同源 URL 避免重复解析 */
const bgResolveCache = new Map<string, ResolveResult | null>()

/** 异步解析背景图片 URL，支持 file: 引用、虚拟路径、图片 ID、本地路径、网络 URL */
async function resolveBgImage(src: string): Promise<ResolveResult | null> {
  const cached = bgResolveCache.get(src)
  if (cached !== undefined) return cached

  let result: ResolveResult | null = null

  // 1. 网络 URL / data URI → 直接使用
  if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:')) {
    result = { url: src, isBlob: false }
    bgResolveCache.set(src, result)
    return result
  }

  // 2. file: 引用 → 通过 fileStore 解析
  const fileRef = parseFileRef(src)
  if (fileRef) {
    try {
      let fileId: string | undefined
      if (fileRef.type === 'fileId') {
        fileId = fileRef.fileId
      } else {
        const fileRecord = await fileStore.getByPath(fileRef.path)
        if (fileRecord) {
          fileId = fileRecord.id
        } else {
          const segments = fileRef.path.split('/')
          const maybeId = segments[segments.length - 1]?.replace(/\.[^.]+$/, '')
          if (maybeId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(maybeId)) {
            fileId = maybeId
          }
        }
      }
      if (!fileId) result = null
      else {
        const content = await fileStore.getContent(fileId)
        if (!content?.binaryData) result = null
        else {
          const fileRecord = await fileStore.getById(fileId)
          const mimeType = fileRecord?.mimeType || 'image/png'
          const blob = base64ToBlob(content.binaryData, mimeType)
          result = { url: URL.createObjectURL(blob), isBlob: true }
        }
      }
    } catch {
      result = null
    }
    bgResolveCache.set(src, result)
    return result
  }

  // 3. 虚拟图片路径 (/images/generated/...) → 通过 image-persistence 解析
  if (src.startsWith('/images/generated')) {
    try {
      const persisted = await getByPath(src)
      if (persisted) {
        result = { url: await blobToDataUrl(persisted.blob), isBlob: false }
      }
    } catch {
      result = null
    }
    bgResolveCache.set(src, result)
    return result
  }

  // 4. 图片 ID (img- 前缀或 UUID 格式) → 通过 image-persistence 解析
  const isImgId = src.startsWith('img-') || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(src)
  if (isImgId) {
    try {
      const persisted = await getImage(src)
      if (persisted) {
        result = { url: await blobToDataUrl(persisted.blob), isBlob: false }
      }
    } catch {
      result = null
    }
    bgResolveCache.set(src, result)
    return result
  }

  // 5. 本地路径 → /api/local-file 代理（仅 dev 模式可用），先验证文件存在
  const proxyUrl = `/api/local-file?path=${encodeURIComponent(src)}`
  try {
    const headResp = await fetch(proxyUrl, { method: 'HEAD' })
    if (!headResp.ok) {
      console.warn(`[BlockManuscript] 背景图不存在: ${src} (HTTP ${headResp.status})`)
      result = null
    } else {
      result = { url: proxyUrl, isBlob: false }
    }
  } catch {
    console.warn(`[BlockManuscript] 背景图验证失败: ${src}`)
    result = null
  }
  bgResolveCache.set(src, result)
  return result
}

/** 监听 backgroundImage 变化，异步解析（事件优先 + 退避兜底） */
watch(() => props.block.backgroundImage, async (src) => {
  bgResolver.cancel()
  revokeBgBlobUrl()
  resolvedBgImageUrl.value = null

  if (!src) return

  // 清除旧缓存，确保重新解析
  bgResolveCache.delete(src)

  await bgResolver.run(async (v) => {
    if (v !== bgResolver.getVersion()) return false
    try {
      const resolved = await resolveBgImage(src)
      if (v !== bgResolver.getVersion()) {
        if (resolved?.isBlob) URL.revokeObjectURL(resolved.url)
        return false
      }
      if (resolved) {
        if (resolved.isBlob) currentBgBlobUrl = resolved.url
        resolvedBgImageUrl.value = resolved.url
      } else {
        console.warn(`[BlockManuscript] 背景图解析失败: ${src}`)
        resolvedBgImageUrl.value = null
      }
      return resolved !== null
    } catch (err) {
      if (v !== bgResolver.getVersion()) return false
      console.warn(`[BlockManuscript] 背景图解析异常: ${src}`, err)
      return false
    }
  })
}, { immediate: true })

onUnmounted(() => {
  bgResolver.cancel()
  revokeBgBlobUrl()
})

// 监听 props 变化同步尺寸（如从其他地方更新了 block 数据）
watch(() => props.block.width, (v) => { if (v !== containerWidth.value) containerWidth.value = v })
watch(() => props.block.height, (v) => { if (v !== containerHeight.value) containerHeight.value = v })

const animationLabels: Record<string, string> = {
  'ink-drop': '墨',
  'brush-stroke': '笔',
  'fade-in': '渐',
  'float-up': '浮',
}
const animationLabel = computed(() => animationLabels[activeAnimation.value] || '墨')

const canvasClasses = computed(() => ({
  [`deco-${props.block.decoration || 'none'}`]: true,
  'shadow-sunlight': activeShadow.value === 'sunlight',
  'shadow-soft': activeShadow.value === 'soft',
}))

const fontSizeMap = { sm: 14, md: 18, lg: 24, xl: 32 }

const canvasStyles = computed(() => {
  const theme = currentThemeId.value
  const size = fontSizeMap[props.block.fontSize || 'md']
  const base: Record<string, string> = {
    fontSize: `${size}px`,
  }

  if (props.block.fontFamily) {
    base.fontFamily = props.block.fontFamily
  }

  if (props.block.fontWeight) {
    base.fontWeight = props.block.fontWeight
  }

  if (props.block.fontStyle === 'italic') {
    base.fontStyle = 'italic'
  }

  // 背景：背景图片优先，其次自定义渐变，否则主题默认
  if (resolvedBgImageUrl.value) {
    base.backgroundImage = `url("${resolvedBgImageUrl.value}")`
    base.backgroundSize = 'cover'
    base.backgroundPosition = 'center'
    base.backgroundRepeat = 'no-repeat'
  } else if (props.block.background) {
    base.background = props.block.background
  } else {
    switch (theme) {
      case 'ink-scroll':
        base.background = 'linear-gradient(145deg, #f5f0e8 0%, #ebe3d3 50%, #e2d9c6 100%)'
        break
      case 'forge-ember':
        base.background = 'linear-gradient(145deg, rgba(45,32,22,0.97), rgba(60,42,28,0.95))'
        break
      case 'light':
        base.background = 'linear-gradient(145deg, #fefefe 0%, #f8f6f3 100%)'
        break
      case 'crystal-prism':
        base.background = 'linear-gradient(145deg, rgba(20,25,40,0.97), rgba(30,35,55,0.95))'
        break
      default:
        base.background = 'linear-gradient(145deg, rgba(22,18,35,0.97), rgba(32,26,48,0.95))'
        break
    }
  }

  // 文字颜色：自定义优先，否则主题默认
  if (props.block.textColor) {
    base.color = props.block.textColor
  } else {
    switch (theme) {
      case 'ink-scroll': base.color = '#2c2c2c'; break
      case 'forge-ember': base.color = '#e8d5b0'; break
      case 'light': base.color = '#333'; break
      case 'crystal-prism': base.color = '#d0d8e8'; break
      default: base.color = '#e0e0e0'; break
    }
  }

  // 阴影：预设 + 自定义覆盖
  base.textShadow = resolveTextShadow()

  // 容器尺寸：手动设定宽度时脱离 flex 宽度约束，确保左下角拉伸时左边缘可移动
  if (containerWidth.value !== undefined) {
    base.width = `${containerWidth.value}px`
    base.flex = '0 0 auto'
    base.maxWidth = 'none'
  }
  if (containerHeight.value !== undefined) base.height = `${containerHeight.value}px`

  return base
})

const bodyStyles = computed(() => {
  const styles: Record<string, string> = {}
  if (props.block.letterSpacing) styles.letterSpacing = props.block.letterSpacing
  if (props.block.lineHeight) styles.lineHeight = props.block.lineHeight
  return styles
})

function charStyle(index: number) {
  if (index >= visibleCount.value) return { opacity: '0' }
  return { animationDelay: `${(index - Math.max(0, visibleCount.value - 8)) * 20}ms` }
}

function resolveTextShadow(): string {
  const preset = activeShadow.value

  if (preset === 'none' && !props.block.shadowColor && !props.block.shadowOffset && props.block.shadowBlur === undefined) {
    return 'none'
  }

  const defaults: Record<string, { shadows: { x: number; y: number; blur: number; color: string }[] }> = {
    sunlight: {
      shadows: [
        { x: 0, y: 1, blur: 0, color: 'rgba(0,0,0,0.06)' },
        { x: 0, y: 2, blur: 2, color: 'rgba(0,0,0,0.10)' },
        { x: 0, y: 4, blur: 6, color: 'rgba(0,0,0,0.07)' },
        { x: 0, y: 8, blur: 16, color: 'rgba(0,0,0,0.04)' },
      ],
    },
    soft: {
      shadows: [
        { x: 0, y: 1, blur: 3, color: 'rgba(0,0,0,0.15)' },
      ],
    },
    none: { shadows: [] },
  }

  const presetConfig = defaults[preset]
  if (!presetConfig || presetConfig.shadows.length === 0) {
    if (props.block.shadowColor || props.block.shadowOffset || props.block.shadowBlur !== undefined) {
      return buildShadowString(
        props.block.shadowOffset || '0px 1px',
        props.block.shadowBlur ?? 4,
        props.block.shadowColor || 'rgba(0,0,0,0.15)',
      )
    }
    return 'none'
  }

  const customColor = props.block.shadowColor
  const customOffset = props.block.shadowOffset
  const customBlur = props.block.shadowBlur

  return presetConfig.shadows.map(s => {
    const color = customColor || s.color
    let x = s.x, y = s.y, blur = s.blur

    if (customOffset) {
      const parsed = parseOffset(customOffset)
      x = parsed.x
      y = parsed.y
    }
    if (customBlur !== undefined) {
      blur = customBlur
    }

    return `${x}px ${y}px ${blur}px ${color}`
  }).join(', ')
}

function parseOffset(offset: string): { x: number; y: number } {
  const match = offset.match(/(-?\d+(?:\.\d+)?)\s*px\s+(-?\d+(?:\.\d+)?)\s*px/)
  if (match) return { x: parseFloat(match[1]), y: parseFloat(match[2]) }
  return { x: 0, y: 1 }
}

function buildShadowString(offset: string, blur: number, color: string): string {
  const { x, y } = parseOffset(offset)
  return `${x}px ${y}px ${blur}px ${color}`
}

/** 滚轮方向适配 */
function onWheel(e: WheelEvent) {
  const el = e.currentTarget as HTMLElement
  if (activeLayout.value !== 'vertical') return

  // 竖式：将纵向滚轮量映射到横向滚动
  if (e.deltaY === 0) return

  // 先阻止默认行为（防止页面滚动）
  e.preventDefault()

  // 记录滚动前位置
  const before = el.scrollLeft
  el.scrollBy({ left: e.deltaY })

  // 容器未滚动（到达边界）→ 手动触发页面滚动
  if (el.scrollLeft === before) {
    window.scrollBy({ top: e.deltaY })
  }
}

function toggleLayout() {
  activeLayout.value = activeLayout.value === 'vertical' ? 'horizontal' : 'vertical'
  emit('localAction', { blockId: props.block.id, action: 'layout_change', data: { layout: activeLayout.value } })
}

function cycleShadow() {
  const modes: ManuscriptBlock['shadow'][] = ['sunlight', 'soft', 'none']
  const idx = modes.indexOf(activeShadow.value)
  activeShadow.value = modes[(idx + 1) % modes.length]
  emit('localAction', { blockId: props.block.id, action: 'shadow_cycle', data: { shadow: activeShadow.value } })
}

function cycleAnimation() {
  const anims: ManuscriptBlock['animation'][] = ['ink-drop', 'brush-stroke', 'fade-in', 'float-up']
  const idx = anims.indexOf(activeAnimation.value)
  activeAnimation.value = anims[(idx + 1) % anims.length]
  emit('localAction', { blockId: props.block.id, action: 'animation_cycle', data: { animation: activeAnimation.value } })
}

function onResizeStart(e: MouseEvent) {
  e.preventDefault()
  const startX = e.clientX
  const startY = e.clientY
  const canvas = (e.currentTarget as HTMLElement).parentElement
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  const startW = rect.width
  const startH = rect.height

  function onMove(ev: MouseEvent) {
    const newW = Math.max(280, Math.round(startW - (ev.clientX - startX)))
    const newH = Math.max(120, Math.round(startH + ev.clientY - startY))
    containerWidth.value = newW
    containerHeight.value = newH
  }

  function onUp() {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
    // 持久化尺寸到 block
    emit('localAction', {
      blockId: props.block.id,
      action: 'resize',
      data: {
        width: containerWidth.value,
        height: containerHeight.value,
      },
    })
  }

  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'sw-resize'
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

function resolveFontSize() {
  const scale = profile.value?.sizeScale ?? 1
  return fontSizeMap[props.block.fontSize || 'md'] * scale
}

function openCorrector(isGif: boolean) {
  localExportConfig.value = { ...(props.block.exportConfig || defaultExportConfig) }
  gifMode.value = isGif
  showCorrector.value = true
}

function onCorrectorConfigUpdate(config: ExportCorrectorConfig) {
  localExportConfig.value = config
  props.block.exportConfig = config
  emit('localAction', {
    blockId: props.block.id,
    action: 'export_config_update',
    data: { exportConfig: config },
  })
}

function onCorrectorExport(_config: ExportCorrectorConfig) {
  showCorrector.value = false
}
</script>

<style scoped>
.manuscript-canvas {
  position: relative;
  margin: 8px -8px;
  padding: 16px 20px 20px;
  border-radius: 10px;
  min-height: 60px;
  min-width: 280px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.18), 0 1px 4px rgba(0, 0, 0, 0.12);
  animation: ms-canvas-in 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ms-bg-overlay {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  z-index: 0;
}

.manuscript-canvas:has(.ms-bg-overlay) > *:not(.ms-bg-overlay) {
  position: relative;
  z-index: 1;
}

@keyframes ms-canvas-in {
  0% { opacity: 0; transform: translateY(12px) scale(0.98); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}

.manuscript-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(128, 128, 128, 0.15);
}

.manuscript-icon {
  opacity: 0.6;
}

.manuscript-title {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.05em;
  opacity: 0.7;
  flex: 1;
}

.manuscript-toolbar {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s ease;
}
.manuscript-toolbar.visible {
  opacity: 1;
}

.ms-tool-btn {
  padding: 2px 6px;
  font-size: 11px;
  border: 1px solid rgba(128, 128, 128, 0.2);
  border-radius: 4px;
  background: rgba(128, 128, 128, 0.08);
  color: inherit;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease, opacity 0.15s ease, filter 0.15s ease;
  font-family: inherit;
}
.ms-tool-btn:hover {
  background: rgba(128, 128, 128, 0.18);
  border-color: rgba(128, 128, 128, 0.35);
}

.manuscript-body {
  line-height: 2;
  letter-spacing: 0.08em;
  white-space: pre-wrap;
  word-break: break-word;
  flex: 1;
  overflow: auto;
  min-height: 0;
  overscroll-behavior-y: contain;
}

.manuscript-body.vertical-rl {
  writing-mode: vertical-rl;
  text-orientation: mixed;
  text-combine-upright: digits;
  max-height: 440px;
  overflow: auto;
  line-height: 2.4;
  letter-spacing: 0.15em;
  white-space: pre-wrap;
  overscroll-behavior: contain;
}

.ms-char {
  display: inline;
  opacity: 0;
}
.ms-char.char-visible {
  opacity: 1;
}

.manuscript-body.vertical-rl .ms-char {
  display: inline;
}

.ms-char.anim-ink-drop.char-visible {
  animation: ms-ink-drop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}
.ms-char.anim-brush-stroke.char-visible {
  animation: ms-brush-stroke 0.35s ease-out both;
}
.ms-char.anim-fade-in.char-visible {
  animation: ms-fade-char 0.3s ease-out both;
}
.ms-char.anim-float-up.char-visible {
  animation: ms-float-up 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes ms-ink-drop {
  0% { opacity: 0; transform: translateY(-8px) scale(1.15); filter: blur(2px); }
  60% { opacity: 1; transform: translateY(1px) scale(0.98); filter: blur(0); }
  100% { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
}

@keyframes ms-brush-stroke {
  0% { opacity: 0; clip-path: inset(0 100% 0 0); }
  100% { opacity: 1; clip-path: inset(0 0 0 0); }
}

@keyframes ms-fade-char {
  0% { opacity: 0; }
  100% { opacity: 1; }
}

@keyframes ms-float-up {
  0% { opacity: 0; transform: translateY(6px); }
  100% { opacity: 1; transform: translateY(0); }
}

.ms-cursor {
  display: inline-block;
  animation: ms-blink 0.8s step-end infinite;
  opacity: 0.6;
  font-weight: 300;
}

@keyframes ms-blink {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 0; }
}

.manuscript-seal {
  position: absolute;
  bottom: 14px;
  right: 18px;
  width: 38px;
  height: 38px;
  border: 2px solid #c41e3a;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #c41e3a;
  font-size: 16px;
  font-weight: bold;
  opacity: 0.55;
  transform: rotate(-5deg);
  font-family: 'Noto Serif SC', 'SimSun', serif;
}

.manuscript-flourish {
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 50%;
  height: 1px;
  background: linear-gradient(90deg, transparent, currentColor, transparent);
  opacity: 0.2;
}

.manuscript-border-deco {
  position: absolute;
  inset: 6px;
  border: 1px solid currentColor;
  border-radius: 6px;
  opacity: 0.1;
  pointer-events: none;
}

.ms-resize-handle {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 18px;
  height: 18px;
  cursor: sw-resize;
  opacity: 0;
  transition: opacity 0.2s ease;
}
.manuscript-canvas:hover .ms-resize-handle {
  opacity: 0.4;
}
.ms-resize-handle::before,
.ms-resize-handle::after {
  content: '';
  position: absolute;
  background: currentColor;
  border-radius: 1px;
}
.ms-resize-handle::before {
  bottom: 4px;
  left: 4px;
  width: 8px;
  height: 1px;
  transform: rotate(45deg);
}
.ms-resize-handle::after {
  bottom: 4px;
  left: 4px;
  width: 4px;
  height: 1px;
  transform: rotate(45deg);
  transform-origin: left center;
}
</style>
