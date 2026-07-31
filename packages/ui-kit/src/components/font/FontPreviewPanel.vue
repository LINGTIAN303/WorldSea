<template>
  <Teleport to="body">
    <Transition name="fpp-backdrop">
      <div v-if="visible" class="fpp-backdrop" @click="onClose" />
    </Transition>
    <Transition name="fpp-panel">
      <div v-if="visible" class="fpp-panel" role="dialog" aria-label="字体预览与导出">
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
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import WsIcon from '../WsIcon.vue'
import FontSelector from './FontSelector.vue'
import TextRenderPreview from './TextRenderPreview.vue'
import { toBlob, type ImageFormat, type TextRenderOptions } from '@worldsmith/font-kit'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  'close': []
  'exported': [blob: Blob, format: ImageFormat]
}>()

const fontFamily = ref('')
const fontSize = ref(28)
const fontWeight = ref(400)
const textContent = ref('你好世界 Hello World')
const textColor = ref('#ffffff')
const bgColor = ref('#1a1a2e')
const exportFormat = ref<ImageFormat>('png')

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

<style scoped>
.fpp-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-overlay, 200);
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.fpp-panel {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: calc(var(--z-overlay, 200) + 1);
  width: 480px;
  max-height: 85vh;
  background: var(--modal-bg, var(--bg-secondary));
  border: 1px solid var(--border);
  border-radius: var(--radius-lg, 12px);
  box-shadow: var(--shadow-xl);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.fpp-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
  background: var(--gradient-subtle, transparent);
}

.fpp-title {
  flex: 1;
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-semibold);
  color: var(--text);
}

.fpp-close {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: var(--font-size-lg);
  padding: 4px 8px;
  border-radius: var(--radius-sm, 4px);
  transition: background 0.12s, color 0.12s;
}

.fpp-close:hover {
  background: var(--hover-bg);
  color: var(--text-color);
}

.fpp-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.fpp-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.fpp-section--half {
  flex: 1;
}

.fpp-label {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  color: var(--accent);
  text-transform: uppercase;
}

.fpp-row {
  display: flex;
  gap: 12px;
}

.fpp-select {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm, 4px);
  background: var(--input-bg);
  color: var(--text);
  font-size: var(--font-size-sm);
  cursor: pointer;
}

.fpp-select:focus {
  outline: none;
  border-color: var(--accent);
}

.fpp-textarea {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm, 4px);
  background: var(--input-bg);
  color: var(--text);
  font-size: var(--font-size-sm);
  resize: vertical;
  font-family: inherit;
  box-sizing: border-box;
}

.fpp-textarea:focus {
  outline: none;
  border-color: var(--accent);
}

.fpp-color-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.fpp-color {
  width: 32px;
  height: 28px;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm, 4px);
  background: var(--input-bg);
  cursor: pointer;
}

.fpp-color-val {
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  font-family: monospace;
}

.fpp-footer {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 18px;
  border-top: 1px solid var(--border);
  background: var(--bg-tertiary);
}

.fpp-format-select {
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm, 4px);
  background: var(--input-bg);
  color: var(--text);
  font-size: var(--font-size-sm);
  cursor: pointer;
}

.fpp-export-btn {
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

.fpp-export-btn:hover:not(:disabled) {
  background: var(--accent);
  color: #fff;
}

.fpp-export-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.fpp-backdrop-enter-active,
.fpp-backdrop-leave-active {
  transition: opacity 0.2s ease;
}

.fpp-backdrop-enter-from,
.fpp-backdrop-leave-to {
  opacity: 0;
}

.fpp-panel-enter-active,
.fpp-panel-leave-active {
  transition: background 0.25s var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)), border-color 0.25s var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)), color 0.25s var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)), box-shadow 0.25s var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)), transform 0.25s var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)), opacity 0.25s var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)), filter 0.25s var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1));
}

.fpp-panel-enter-from,
.fpp-panel-leave-to {
  opacity: 0;
  transform: translate(-50%, -50%) scale(0.95);
}
</style>