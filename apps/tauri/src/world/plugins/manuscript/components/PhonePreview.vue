<template>
  <!-- dock=真右栏：Teleport disabled 原地渲染进 .ms-body 布局流（编辑区 flex:1 自动让位）；
       popup=Teleport 到 body 居中浮窗 -->
  <Teleport to="body" :disabled="isDock">
    <div v-if="visible" class="pp-layer" :class="isDock ? 'pp-layer--dock' : 'pp-layer--popup'" :style="isDock ? { width: dockWidth + 'px' } : undefined">
      <div
        class="pp-frame"
        :style="frameStyle"
        @mousedown.stop="onFrameMouseDown"
      >
        <div class="pp-titlebar">
          <span class="pp-title"><WsIcon name="item" size="xs" /> 手机预览</span>
          <div class="pp-controls">
            <select v-model="presetSize" class="pp-select-sm" @change="applyPreset">
              <option value="iphone15">iPhone 15 Pro</option>
              <option value="iphonese">iPhone SE</option>
              <option value="android">Android 标准</option>
              <option value="android-lg">Android 大屏</option>
              <option value="custom">自由拉伸</option>
            </select>
            <select v-model="previewMode" class="pp-select-sm">
              <option value="webnovel">网文平台</option>
              <option value="premium">精品阅读</option>
            </select>
            <select v-model="themeMode" class="pp-select-sm">
              <option value="day">日间</option>
              <option value="night">夜间</option>
              <option value="eye">护眼</option>
            </select>
            <button class="pp-close" @click="$emit('close')">✕</button>
          </div>
        </div>

        <div class="pp-settings">
          <label class="pp-setting">
            <span>字体</span>
            <select v-model="localFontFamily" class="pp-select-sm">
              <option value="">跟随设置</option>
              <option v-for="e in libraryEntries" :key="e.id" :value="e.family">{{ e.displayName }}</option>
            </select>
          </label>
          <label class="pp-setting">
            <span>字号</span>
            <input type="range" v-model.number="fontSize" min="14" max="22" step="1" />
            <span class="pp-val">{{ fontSize }}px</span>
          </label>
          <label class="pp-setting">
            <span>行距</span>
            <input type="range" v-model.number="lineHeight" min="1.5" max="2.5" step="0.1" />
            <span class="pp-val">{{ lineHeight.toFixed(1) }}</span>
          </label>
          <label class="pp-setting">
            <span>段距</span>
            <input type="range" v-model.number="paraSpacing" min="0.5" max="2" step="0.25" />
            <span class="pp-val">{{ paraSpacing.toFixed(2) }}em</span>
          </label>
        </div>

        <div class="pp-screen" :style="screenStyle" :class="[themeClass, modeClass]">
          <div class="pp-content" :style="contentStyle">
            <h1 class="pp-chapter-title">{{ title }}</h1>
            <div class="pp-body" v-html="sanitizedHTML"></div>
          </div>
        </div>

        <div v-if="!isDock && presetSize === 'custom'" class="pp-resize-handle" @mousedown.stop="onResizeStart"></div>
      </div>
      <div v-if="isDock" class="pp-dock-handle" title="拖拽调整宽度" @mousedown.stop.prevent="onDockResizeStart"></div>
    </div>
  </Teleport>
</template>
<script setup lang="ts">
import { ref, computed } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import DOMPurify from 'dompurify'
import { fontLibrarySvc, fontSvc } from '../serviceAccess'

const props = defineProps<{
  visible: boolean
  html: string
  title: string
  /** 展示形态（设置「手机预览形态」）：dock=右栏页（默认）｜popup=弹窗 */
  mode?: string
}>()

defineEmits<{ close: [] }>()

// 手机预览字体下拉数据源 = 字体库真实条目（预设死数据已退役，字体系统 v2 批 1）
const libraryEntries = computed(() => fontLibrarySvc().list())

const isDock = computed(() => props.mode !== 'popup')

const presetSize = ref('iphone15')
const previewMode = ref('webnovel')
const themeMode = ref('day')
const fontSize = ref(16)
const lineHeight = ref(1.8)
const paraSpacing = ref(0.75)
const localFontFamily = ref('')
const frameW = ref(393)
const frameH = ref(852)

// ── 真右栏弹性宽度（2026-10-02）：类 DevTools 设备仿真——高度随列撑满，宽度拖拽可调；
//    预设只定宽；持久化到 localStorage（视图级几何，不入 settingsStore）──
const DOCK_WIDTH_KEY = 'worldsea_phone_preview_col_width'
const DOCK_WIDTH_MIN = 280
const DOCK_WIDTH_MAX = 720
const dockWidth = ref(Math.min(DOCK_WIDTH_MAX, Math.max(DOCK_WIDTH_MIN, Number(localStorage.getItem(DOCK_WIDTH_KEY)) || 393)))

function persistDockWidth() {
  try { localStorage.setItem(DOCK_WIDTH_KEY, String(dockWidth.value)) } catch { /* 私有模式等存储不可用则跳过 */ }
}

function onDockResizeStart(e: MouseEvent) {
  const startX = e.clientX
  const startW = dockWidth.value
  const onMove = (ev: MouseEvent) => {
    dockWidth.value = Math.min(DOCK_WIDTH_MAX, Math.max(DOCK_WIDTH_MIN, startW + (startX - ev.clientX)))
  }
  const onUp = () => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    presetSize.value = 'custom'
    persistDockWidth()
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

const PRESETS: Record<string, { w: number; h: number }> = {
  iphone15: { w: 393, h: 852 },
  iphonese: { w: 375, h: 667 },
  android: { w: 360, h: 800 },
  'android-lg': { w: 412, h: 915 },
}

function applyPreset() {
  const p = PRESETS[presetSize.value]
  if (!p) return
  if (isDock.value) {
    // 真右栏高度随列撑满（设备 H 无意义），预设只定宽
    dockWidth.value = p.w
    persistDockWidth()
  } else {
    frameW.value = p.w
    frameH.value = p.h
  }
}

const frameStyle = computed(() => isDock.value
  ? { width: '100%', height: '100%' }
  : { width: frameW.value + 'px', height: frameH.value + 'px', maxHeight: '90vh' })

const themeClass = computed(() => `pp-theme-${themeMode.value}`)
const modeClass = computed(() => `pp-mode-${previewMode.value}`)

const screenStyle = computed(() => ({}))

const contentStyle = computed(() => ({
  fontSize: fontSize.value + 'px',
  lineHeight: lineHeight.value,
  '--para-spacing': paraSpacing.value + 'em',
  // 回落链与导出同源（preview → content），但末段是本预览特有的 'inherit'
  fontFamily: localFontFamily.value || fontSvc().exportFamily('inherit'),
}))

const sanitizedHTML = computed(() => {
  // 二期后正文可含表格与图片：白名单须放行对应标签与属性，
  // 否则 DOMPurify 会直接剥掉 <table>/<img>（表格只剩散落文本、图片整体消失）。
  // TipTap resizable 表格带 style="min-width" 与 <colgroup><col style="width:...">
  return DOMPurify.sanitize(props.html, {
    ALLOWED_TAGS: ['p', 'br', 'b', 'i', 's', 'em', 'strong', 'u', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote', 'hr', 'span',
      'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'colgroup', 'col', 'pre', 'code'],
    ALLOWED_ATTR: ['class', 'data-id', 'data-label', 'src', 'alt', 'colspan', 'rowspan', 'style'],
  })
})

let dragStart = { x: 0, y: 0, fx: 0, fy: 0 }
function onFrameMouseDown(e: MouseEvent) {
  // 右栏页为停靠态，不提供拖拽（弹窗模式保留）
  if (isDock.value) return
  const target = e.target as HTMLElement
  if (target.closest('.pp-titlebar') && !target.closest('select') && !target.closest('button')) {
    dragStart = { x: e.clientX, y: e.clientY, fx: 0, fy: 0 }
    const frame = (e.currentTarget as HTMLElement)
    const rect = frame.getBoundingClientRect()
    dragStart.fx = rect.left
    dragStart.fy = rect.top
    const onMove = (ev: MouseEvent) => {
      frame.style.left = (dragStart.fx + ev.clientX - dragStart.x) + 'px'
      frame.style.top = (dragStart.fy + ev.clientY - dragStart.y) + 'px'
      frame.style.position = 'fixed'
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }
}

function onResizeStart(e: MouseEvent) {
  const startX = e.clientX
  const startY = e.clientY
  const startW = frameW.value
  const startH = frameH.value
  const onMove = (ev: MouseEvent) => {
    frameW.value = Math.max(280, startW + ev.clientX - startX)
    frameH.value = Math.max(400, startH + ev.clientY - startY)
  }
  const onUp = () => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}
</script>

<style scoped>
/* dock=真右栏：布局流内整列（Teleport disabled 原地渲染进 .ms-body），编辑区 flex:1 自动让位 */
.pp-layer--dock {
  position: relative; height: 100%;
  display: flex; flex-direction: column;
  flex-shrink: 0; background: var(--card-bg);
  border-left: 1px solid var(--border-light);
}
.pp-layer--dock .pp-frame { flex: 1; min-height: 0; border-radius: 0; box-shadow: none; }
/* 左缘拖拽手柄：弹性宽度（类 DevTools 设备仿真），宽度持久化到 localStorage */
.pp-dock-handle {
  position: absolute; left: -3px; top: 0; bottom: 0; width: 6px;
  cursor: col-resize; z-index: 1;
}
.pp-dock-handle:hover { background: var(--primary-soft, rgba(79, 70, 229, 0.12)); }
/* popup=居中浮窗（无遮罩，Teleport 到 body） */
.pp-layer--popup {
  position: fixed; inset: 0;
  display: flex; align-items: center; justify-content: center;
  pointer-events: none; z-index: 300;
}
.pp-layer--popup .pp-frame { pointer-events: auto; }
.pp-frame {
  background: var(--modal-bg); border-radius: var(--radius-xl);
  box-shadow: 0 8px 32px rgba(0,0,0,0.25); display: flex;
  flex-direction: column; overflow: hidden; position: relative;
}
.pp-titlebar {
  flex-shrink: 0;
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px; background: var(--menubar-bg);
  border-bottom: 1px solid var(--border-light); user-select: none;
}
.pp-layer--popup .pp-titlebar { cursor: move; }
.pp-title { font-weight: var(--font-weight-semibold); font-size: var(--font-size-sm); }
.pp-controls { display: flex; align-items: center; gap: 6px; }
.pp-select-sm {
  padding: 2px 6px; font-size: var(--font-size-xs); border: 1px solid var(--border-color);
  border-radius: var(--radius-xs); background: var(--input-bg); color: var(--text-color);
}
.pp-close {
  width: 24px; height: 24px; border: none; background: transparent;
  cursor: pointer; font-size: var(--font-size-base); color: var(--text-secondary);
  border-radius: var(--radius-xs); display: flex; align-items: center; justify-content: center;
}
.pp-close:hover { background: var(--hover-bg); }

.pp-settings {
  flex-shrink: 0;
  display: flex; gap: 12px; padding: 6px 12px;
  border-bottom: 1px solid var(--border-light); background: var(--menubar-bg);
}
.pp-setting { display: flex; align-items: center; gap: 4px; font-size: var(--font-size-xs); color: var(--text-secondary); }
.pp-setting input[type="range"] { width: 60px; }
.pp-val { min-width: 32px; text-align: right; font-variant-numeric: tabular-nums; }

.pp-screen {
  flex: 1; min-height: 0; overflow-y: auto;
  border-radius: var(--radius-2xl); border: 1px solid rgba(128,128,128,0.15);
  margin: 6px; transition: background 0.2s, color 0.2s;
}
/* 设备模拟器主题色 - 有意设计的硬编码值，用于真实还原手机外观 */
.pp-theme-day { background: #FFFFFF; color: #1A1A1A; }
.pp-theme-night { background: #1A1A2E; color: #E0E0E0; }
.pp-theme-eye { background: #F5F0E8; color: #3D3225; }

.pp-content {
  max-width: 100%;
  padding: 20px 16px;
}
.pp-mode-premium .pp-content {
  padding: 24px 24px;
}

.pp-chapter-title {
  font-size: 1.4em; font-weight: var(--font-weight-bold); text-align: center;
  margin-bottom: 20px; padding-bottom: 12px;
  border-bottom: 1px solid rgba(128,128,128,0.2);
}

.pp-body :deep(p) {
  margin: 0 0 var(--para-spacing);
}

.pp-mode-webnovel .pp-body :deep(p) {
  text-indent: 0;
}
.pp-mode-premium .pp-body :deep(p) {
  text-indent: 2em;
}

.pp-body :deep(blockquote) {
  border-left: 3px solid rgba(128,128,128,0.3);
  padding-left: 12px; margin: 0.5em 0;
  color: inherit; opacity: 0.8;
}
.pp-body :deep(h1), .pp-body :deep(h2), .pp-body :deep(h3) {
  text-indent: 0; margin: 1em 0 0.5em;
}
.pp-body :deep(hr) {
  border: none; border-top: 1px solid var(--color-border-subtle); margin: 1em 0;
}
/* 表格 / 图片 / 代码（二期富内容在手机预览的承载；手机主题为有意设计的硬编码三态，
   故此处用主题无关的灰色 alpha 而非令牌，与上方 blockquote/hr 做法一致） */
.pp-body :deep(img) {
  max-width: 100%; height: auto; display: block; margin: 0.5em auto;
  border-radius: 4px;
}
.pp-body :deep(table) {
  border-collapse: collapse; width: 100%; margin: 0.75em 0; font-size: 0.92em;
}
.pp-body :deep(th), .pp-body :deep(td) {
  border: 1px solid rgba(128,128,128,0.35); padding: 4px 8px; text-align: left; vertical-align: top;
}
.pp-body :deep(th) {
  background: rgba(128,128,128,0.12); font-weight: var(--font-weight-semibold);
}
.pp-body :deep(pre) {
  background: rgba(128,128,128,0.12); padding: 8px 10px; border-radius: 6px;
  overflow-x: auto; font-size: 0.9em; white-space: pre-wrap; word-break: break-word;
}
.pp-body :deep(code) {
  background: rgba(128,128,128,0.12); padding: 1px 4px; border-radius: 3px; font-size: 0.9em;
}
.pp-body :deep(pre code) { background: transparent; padding: 0; }

.pp-resize-handle {
  position: absolute; right: 0; bottom: 0; width: 16px; height: 16px;
  cursor: nwse-resize; background: linear-gradient(135deg, transparent 50%, var(--text-tertiary) 50%);
  border-radius: 0 0 16px 0;
}
</style>
