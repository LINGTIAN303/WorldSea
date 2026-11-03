<template>
  <Teleport to="body">
    <Transition name="fpp-backdrop">
      <div v-if="visible" class="fpp-backdrop" @click="onClose" />
    </Transition>
    <Transition name="fpp-panel">
      <div v-if="visible" ref="boxRef" class="fpp-panel" role="dialog" aria-modal="true" aria-label="字体预览与导出" tabindex="-1">
        <div class="fpp-header">
          <WsIcon name="type" size="sm" />
          <span class="fpp-title">字体预览与导出</span>
          <button class="fpp-close" @click="onClose">✕</button>
        </div>

        <div class="fpp-body">
          <div class="fpp-section">
            <div class="fpp-label">字体</div>
            <FontSelector v-model="fontFamily" placeholder="系统默认" />
          </div>

          <div class="fpp-row">
            <div class="fpp-section fpp-section--half">
              <div class="fpp-label">字号</div>
              <select v-model.number="fontSize" class="fpp-select">
                <option v-for="s in sizeOptions" :key="s" :value="s">{{ s }}px</option>
              </select>
            </div>
            <div class="fpp-section fpp-section--half">
              <div class="fpp-label">字重</div>
              <select v-model.number="fontWeight" class="fpp-select">
                <option :value="400">Regular 400</option>
                <option :value="500">Medium 500</option>
                <option :value="600">Semibold 600</option>
                <option :value="700">Bold 700</option>
              </select>
            </div>
          </div>

          <div class="fpp-section">
            <div class="fpp-label">文本内容</div>
            <textarea
              v-model="textContent"
              class="fpp-textarea"
              rows="3"
              placeholder="输入要渲染的文本..."
            />
          </div>

          <div class="fpp-row">
            <div class="fpp-section fpp-section--half">
              <div class="fpp-label">文字颜色</div>
              <div class="fpp-color-wrap">
                <input type="color" v-model="textColor" class="fpp-color" />
                <span class="fpp-color-val">{{ textColor }}</span>
              </div>
            </div>
            <div class="fpp-section fpp-section--half">
              <div class="fpp-label">背景颜色</div>
              <div class="fpp-color-wrap">
                <input type="color" v-model="bgColor" class="fpp-color" />
                <span class="fpp-color-val">{{ bgColor }}</span>
              </div>
            </div>
          </div>

          <div class="fpp-section">
            <div class="fpp-label">预览</div>
            <TextRenderPreview :options="renderOptions" :min-height="100" ref="previewRef" />
          </div>
        </div>

        <div class="fpp-footer">
          <select v-model="exportFormat" class="fpp-format-select">
            <option value="png">PNG</option>
            <option value="jpeg">JPEG</option>
            <option value="webp">WebP</option>
          </select>
          <button class="fpp-export-btn" :disabled="!canExport" @click="onExport">
            导出图片
          </button>
          <button class="fpp-export-btn fpp-apply-canvas" :disabled="!fontFamily" :title="fontFamily ? `把「${fontFamily}」设为画布字体（canvas 渲染导出链）` : '先在上方选择字体'" @click="onApplyCanvas">
            设为画布字体
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { useModalShortcuts } from '@worldsea/ui-kit'
import WsIcon from '../WsIcon.vue'
import FontSelector from './FontSelector.vue'
import TextRenderPreview from './TextRenderPreview.vue'
import { toBlob, type ImageFormat, type TextRenderOptions } from '@worldsea/font-kit'
import { useFontStore } from '@worldsea/entity-core'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  'close': []
  'exported': [blob: Blob, format: ImageFormat]
}>()

const boxRef = ref<HTMLElement>()
/** 打开前的焦点元素：关闭后还原 */
let returnFocusEl: HTMLElement | null = null

// Esc 关闭收编 useModalShortcuts（modal 层）
useModalShortcuts(() => props.visible, { id: 'font-preview.close', onEscape: () => onClose() })
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

// 焦点陷阱：Tab 仅在面板内循环（Esc 已收编注册表）
function onKeydown(e: KeyboardEvent) {
  if (!props.visible) return
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

watch(() => props.visible, (v) => {
  if (v) {
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


const fontFamily = ref('')
const fontSize = ref(28)
const fontWeight = ref(400)
const textContent = ref('你好世界 Hello World')
const textColor = ref('#ffffff')
const bgColor = ref('#1a1a2e')
const exportFormat = ref<ImageFormat>('png')

// 画布层联动（字体系统 v2 收尾批）：打开时以「画布字体」为默认；可一键把当前字体设回画布层
const fontStore = useFontStore()
watch(() => props.visible, (v) => {
  if (v) fontFamily.value = fontStore.prefs.canvas.family
})

function onApplyCanvas() {
  if (!fontFamily.value) return
  fontStore.setLayerFont('canvas', fontFamily.value)
}

const previewRef = ref<InstanceType<typeof TextRenderPreview>>()

const sizeOptions = [9, 11, 12, 14, 15, 16, 18, 22, 28, 36, 48, 64, 72, 96]

const renderOptions = computed<TextRenderOptions>(() => ({
  text: textContent.value,
  fontFamily: fontFamily.value || undefined,
  fontSize: fontSize.value,
  fontWeight: fontWeight.value,
  color: textColor.value,
  backgroundColor: bgColor.value,
  padding: { top: 24, right: 32, bottom: 24, left: 32 },
}))

const canExport = computed(() => !!textContent.value.trim())

function onClose() {
  emit('update:visible', false)
  emit('close')
}

async function onExport() {
  const preview = previewRef.value
  if (!preview?.result) return

  try {
    const blob = await toBlob(preview.result.canvas, exportFormat.value)
    emit('exported', blob, exportFormat.value)

    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `font-render.${exportFormat.value}`
    a.click()
    URL.revokeObjectURL(url)
  } catch {}
}
</script>

<style scoped src="./font-preview-panel.css"></style>