<template>
  <div class="chat-input-area">
      <div class="input-row">
        <div
          class="capsule-input"
          :class="{ expanded: isExpanded, focused: isFocused, 'drag-over': isDragOver }"
          @dragover.prevent="isDragOver = true"
          @dragleave.prevent="isDragOver = false"
          @drop.prevent="onDrop"
        >
          <!-- 性能优化:按钮始终渲染,用 opacity + transform 控制可见性 -->
          <!-- 替代原 v-if mount/unmount,避免 flex 子元素数量变化触发重排 -->
          <button
            class="attach-btn"
            type="button"
            :disabled="isStreaming"
            title="添加文件（图片 / Word / PDF / 文本）"
            @click="triggerFileInput"
          >
            <WsIcon name="paperclip" size="sm" />
          </button>
          <div class="input-stack">
            <div v-if="kbChips.length" class="kb-chips-area">
              <div
                v-for="(chip, i) in kbChips"
                :key="i"
                class="kb-chip"
              >
                <WsIcon name="file" size="xs" />
                <span class="kb-chip-label">{{ chip.label }}</span>
                <button class="kb-chip-remove" type="button" @click.stop="removeKbChip(i)">✕</button>
              </div>
            </div>
            <div v-if="attachments.length" class="attachments-preview">
              <div
                v-for="(att, i) in attachments"
                :key="i"
                class="att-item"
                :class="{ 'att-image': att.type === 'image', 'att-file': att.type === 'file' }"
              >
                <img v-if="att.type === 'image' && att.previewUrl" :src="att.previewUrl" class="att-thumb" />
                <span v-if="att.type === 'file'" class="att-file-icon"><WsIcon name="file" size="xs" /></span>
                <span class="att-name">{{ att.name }}</span>
                <button class="att-remove" type="button" @click.stop="removeAttachment(i)">✕</button>
              </div>
            </div>
            <textarea
              ref="textareaRef"
              v-model="inputText"
              class="chat-textarea"
              :placeholder="placeholder"
              rows="1"
              @focus="onFocus"
              @blur="onBlur"
              @keydown.enter.exact="onEnter"
              @input="autoResize"
              @paste="onPaste"
            ></textarea>
          </div>
          <input
            ref="fileInputRef"
            type="file"
            class="hidden-file-input"
            multiple
            @change="onFileInputChange"
          />
          <button
            class="send-btn"
            :class="{ 'stop-btn': isStreaming }"
            :disabled="!isStreaming && (!inputText.trim() && !attachments.length && !kbChips.length)"
            @click="isStreaming ? onStop() : onSend()"
          >
            <WsIcon v-if="isStreaming" name="square" size="sm" />
            <WsIcon v-else name="send" size="sm" />
          </button>
        </div>
        <ModelSwitcher :is-expanded="isExpanded" @change="onModelChange" />
      </div>
    <Transition name="warning-fade">
      <div v-if="visionWarning" class="vision-warning">{{ visionWarning }}</div>
    </Transition>
  </div>
</template>
<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue'
import WsIcon from '../../ui/WsIcon.vue'
import { useSpaceStore, type InputInjectionChip } from '../stores/space-store'
import { useAgent } from '../../agent/composables/useAgent'
import { modelSupportsVision } from '../../agent/modelRegistry'
import { useSettingsStore } from '../../stores/settingsStore'
import ModelSwitcher from './ModelSwitcher.vue'

interface FileAttachment {
  type: 'image' | 'file'
  name: string
  mimeType: string
  data: string
  previewUrl?: string
  textContent?: string
}

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const TEXT_EXTENSIONS = ['.txt', '.md', '.json', '.csv', '.xml', '.yaml', '.yml', '.toml', '.ini', '.log', '.html', '.css', '.js', '.ts', '.vue', '.py', '.rs', '.go', '.java', '.c', '.cpp', '.h', '.sh', '.sql']
const DOC_EXTENSIONS = ['.docx']
const PDF_EXTENSIONS = ['.pdf']
const MAX_IMAGE_SIZE = 20 * 1024 * 1024
const MAX_IMAGE_COUNT = 10
const MAX_IMAGE_DIMENSION = 2048
const MAX_TEXT_FILE_SIZE = 5 * 1024 * 1024

const emit = defineEmits<{
  send: [text: string, attachments: FileAttachment[]]
}>()

const spaceStore = useSpaceStore()
const settingsStore = useSettingsStore()
const { isStreaming, abort } = useAgent()

function currentModelId(): string {
  return settingsStore.aiProviderMode === 'cloud'
    ? settingsStore.aiCloudModel
    : settingsStore.aiCustomModel
}

const inputText = ref('')
const textareaRef = ref<HTMLTextAreaElement>()
const fileInputRef = ref<HTMLInputElement>()
const isExpanded = ref(false)
const isFocused = ref(false)
const isDragOver = ref(false)
const attachments = ref<FileAttachment[]>([])
const visionWarning = ref('')
const kbChips = ref<InputInjectionChip[]>([])

function removeKbChip(index: number): void {
  kbChips.value.splice(index, 1)
  if (!inputText.value.trim() && !attachments.value.length && !kbChips.value.length) {
    isExpanded.value = false
  }
}

const placeholder = computed(() => {
  const modeHint = (() => {
    switch (spaceStore.chatMode) {
      case 'normal': return '快问快答'
      case 'deep': return '深度思考'
      case 'explore': return '知识探索'
      default: return '消息'
    }
  })()
  return `${modeHint} — 拖拽文件或图片，点击📎上传…`
})

function visionSupported(): boolean {
  const model = currentModelId()
  return !!model && modelSupportsVision(model)
}

function onFocus() {
  isFocused.value = true
  isExpanded.value = true
}

function onBlur() {
  isFocused.value = false
  if (!inputText.value.trim() && !attachments.value.length && !kbChips.value.length) {
    isExpanded.value = false
  }
}

function autoResize() {
  nextTick(() => {
    const el = textareaRef.value
    if (el) {
      el.style.height = 'auto'
      el.style.height = Math.min(el.scrollHeight, 160) + 'px'
    }
  })
}

function showVisionWarning(msg: string): void {
  visionWarning.value = msg
  setTimeout(() => { visionWarning.value = '' }, 4000)
}

async function compressImage(dataUrl: string, mimeType: string): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      let { width, height } = img
      if (width <= MAX_IMAGE_DIMENSION && height <= MAX_IMAGE_DIMENSION) {
        const base64 = dataUrl.split(',')[1]
        resolve({ base64, mimeType })
        return
      }
      const scale = MAX_IMAGE_DIMENSION / Math.max(width, height)
      width = Math.round(width * scale)
      height = Math.round(height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        const base64 = dataUrl.split(',')[1]
        resolve({ base64, mimeType })
        return
      }
      ctx.drawImage(img, 0, 0, width, height)
      const compressed = canvas.toDataURL(mimeType, 0.9)
      resolve({ base64: compressed.split(',')[1], mimeType })
    }
    img.onerror = () => {
      const base64 = dataUrl.split(',')[1]
      resolve({ base64, mimeType })
    }
    img.src = dataUrl
  })
}

function processFile(file: File): void {
  if (IMAGE_TYPES.includes(file.type)) {
    if (!visionSupported()) {
      showVisionWarning('当前模型不支持图片理解，请切换到支持视觉的模型')
      return
    }
    const currentImageCount = attachments.value.filter(a => a.type === 'image').length
    if (currentImageCount >= MAX_IMAGE_COUNT) {
      showVisionWarning(`最多同时发送 ${MAX_IMAGE_COUNT} 张图片`)
      return
    }
    if (file.size > MAX_IMAGE_SIZE) {
      showVisionWarning(`图片大小不能超过 ${MAX_IMAGE_SIZE / 1024 / 1024}MB`)
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      compressImage(dataUrl, file.type).then(compressed => {
        attachments.value.push({
          type: 'image',
          name: file.name,
          mimeType: compressed.mimeType,
          data: compressed.base64,
          previewUrl: dataUrl,
        })
      })
    }
    reader.readAsDataURL(file)
    return
  }

  const dotIdx = file.name.lastIndexOf('.')
  const ext = dotIdx >= 0 ? '.' + file.name.slice(dotIdx + 1).toLowerCase() : ''

  if (DOC_EXTENSIONS.includes(ext)) {
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const mammoth = await import('mammoth')
        const result = await mammoth.extractRawText({ arrayBuffer: reader.result as ArrayBuffer })
        attachments.value.push({
          type: 'file',
          name: file.name,
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          data: '',
          textContent: result.value || '[Word 文件内容为空]',
        })
      } catch (err) {
        attachments.value.push({
          type: 'file',
          name: file.name,
          mimeType: file.type,
          data: '',
          textContent: `[Word 文件解析失败: ${(err as Error).message}]`,
        })
      }
    }
    reader.readAsArrayBuffer(file)
    return
  }

  if (PDF_EXTENSIONS.includes(ext)) {
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const pdfjsLib = await import('pdfjs-dist')
        pdfjsLib.GlobalWorkerOptions.workerSrc = ''
        const pdf = await pdfjsLib.getDocument({ data: reader.result as ArrayBuffer }).promise
        const pages: string[] = []
        for (let i = 1; i <= Math.min(pdf.numPages, 50); i++) {
          const page = await pdf.getPage(i)
          const content = await page.getTextContent()
          const text = content.items.map((item: any) => item.str).join(' ')
          if (text.trim()) pages.push(text)
        }
        attachments.value.push({
          type: 'file',
          name: file.name,
          mimeType: 'application/pdf',
          data: '',
          textContent: pages.join('\n\n---\n\n') || '[PDF 文件内容为空或为扫描件]',
        })
      } catch (err) {
        attachments.value.push({
          type: 'file',
          name: file.name,
          mimeType: file.type,
          data: '',
          textContent: `[PDF 文件解析失败: ${(err as Error).message}]`,
        })
      }
    }
    reader.readAsArrayBuffer(file)
    return
  }

  if (TEXT_EXTENSIONS.includes(ext)) {
    if (file.size > MAX_TEXT_FILE_SIZE) {
      showVisionWarning(`文本文件大小不能超过 ${MAX_TEXT_FILE_SIZE / 1024 / 1024}MB`)
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const text = reader.result as string
      attachments.value.push({
        type: 'file',
        name: file.name,
        mimeType: file.type || 'text/plain',
        data: '',
        textContent: text,
      })
    }
    reader.readAsText(file)
    return
  }

  attachments.value.push({
    type: 'file',
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    data: '',
    textContent: `[不支持的文件类型: ${file.type || ext || '未知'}，已作为附件记录]`,
  })
}

function removeAttachment(index: number): void {
  attachments.value.splice(index, 1)
}

function onPaste(e: ClipboardEvent): void {
  if (!e.clipboardData?.items) return
  const imageItems = Array.from(e.clipboardData.items).filter(item => item.type.startsWith('image/'))
  if (imageItems.length === 0) return
  if (!visionSupported()) {
    showVisionWarning('当前模型不支持图片理解，请切换到支持视觉的模型')
    return
  }
  const currentCount = attachments.value.filter(a => a.type === 'image').length
  const remaining = MAX_IMAGE_COUNT - currentCount
  if (remaining <= 0) {
    showVisionWarning(`最多同时发送 ${MAX_IMAGE_COUNT} 张图片`)
    return
  }
  const toProcess = imageItems.slice(0, remaining)
  for (const item of toProcess) {
    const file = item.getAsFile()
    if (file) processFile(file)
  }
  if (imageItems.length > remaining) {
    showVisionWarning(`已添加 ${remaining} 张图片，已达上限 ${MAX_IMAGE_COUNT}`)
  }
}

function onDrop(e: DragEvent): void {
  isDragOver.value = false
  if (!e.dataTransfer?.files.length) return
  for (const file of Array.from(e.dataTransfer.files)) {
    processFile(file)
  }
  isExpanded.value = true
  nextTick(() => textareaRef.value?.focus())
}

function triggerFileInput() {
  fileInputRef.value?.click()
}

function onFileInputChange(e: Event): void {
  const target = e.target as HTMLInputElement
  if (!target.files?.length) return
  for (const file of Array.from(target.files)) {
    processFile(file)
  }
  target.value = ''
  isExpanded.value = true
}

function onEnter(e: KeyboardEvent) {
  if (e.shiftKey) return
  e.preventDefault()
  onSend()
}

function onSend() {
  const text = inputText.value.trim()
  const kbPrefix = kbChips.value.map(c => c.ref).join('')
  const fullText = kbPrefix + text
  if ((!fullText && !attachments.value.length) || isStreaming.value) return
  const hasImages = attachments.value.some(a => a.type === 'image')
  if (hasImages && !visionSupported()) {
    showVisionWarning('当前模型不支持图片理解，请切换到支持视觉的模型')
    return
  }
  const currentAttachments = [...attachments.value]
  inputText.value = ''
  kbChips.value = []
  attachments.value = []
  if (textareaRef.value) textareaRef.value.style.height = 'auto'
  emit('send', fullText, currentAttachments)
}

function onStop() {
  abort()
}

function onModelChange(_provider: string, _modelId: string) {
}

// 监听知识墙挂载注入
watch(() => spaceStore.inputInjection, (injection) => {
  if (injection) {
    kbChips.value.push(injection)
    spaceStore.inputInjection = null
    isExpanded.value = true
    nextTick(() => {
      textareaRef.value?.focus()
      autoResize()
    })
  }
})
</script>

<style scoped>
.chat-input-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 16px 16px;
  background: transparent;
  position: relative;
}

.capsule-input {
  display: flex;
  align-items: flex-end;
  gap: 0;
  width: 200px;
  max-width: 200px;
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-radius: 24px;
  padding: 6px 8px;
  /* 性能优化:只动画 width(0.2s),padding/border-radius 不动画直接快跳,避免 layout 抖动 */
  transition: width 0.2s cubic-bezier(0.4, 0, 0.2, 1),
              max-width 0.2s cubic-bezier(0.4, 0, 0.2, 1),
              border-color 0.15s,
              box-shadow 0.15s,
              background 0.15s;
  overflow: hidden;
  /* 性能优化:隔离内部重排,避免扩散到父级 flex 容器(input-row) */
  contain: layout paint style;
  will-change: width;
}

.capsule-input.expanded {
  width: calc(80% - 120px);
  max-width: calc(80% - 120px);
  border-radius: 16px;
  padding: 8px 12px;
  align-items: flex-end;
}

.capsule-input.focused {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px var(--color-primary-muted);
}

.capsule-input.drag-over {
  border-color: var(--color-primary);
  background: var(--color-primary-muted);
  box-shadow: 0 0 0 2px var(--color-primary);
}

.input-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
}

.input-stack {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.attachments-preview {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 4px 0 6px;
}

.kb-chips-area {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 4px 0 2px;
}

.kb-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px 2px 8px;
  background: var(--color-primary-muted, rgba(59, 130, 246, 0.1));
  border: 1px solid var(--color-primary, rgba(59, 130, 246, 0.3));
  border-radius: 10px;
  font-size: var(--font-size-xs);
  color: var(--color-primary);
  max-width: 180px;
  line-height: 1.4;
}

.kb-chip-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}

.kb-chip-remove {
  width: 16px;
  height: 16px;
  border: none;
  background: transparent;
  color: var(--color-primary);
  cursor: pointer;
  font-size: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  flex-shrink: 0;
  padding: 0;
  opacity: 0.6;
}

.kb-chip-remove:hover {
  opacity: 1;
  background: var(--color-primary, rgba(59, 130, 246, 0.15));
}

.att-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  font-size: var(--font-size-xs);
  color: var(--color-text);
  max-width: 220px;
}

.att-image {
  background: transparent;
  border: 1px dashed var(--color-border);
  padding: 2px;
}

.att-thumb {
  width: 32px;
  height: 32px;
  object-fit: cover;
  border-radius: 8px;
  flex-shrink: 0;
}

.att-file-icon {
  font-size: 18px;
  line-height: 1;
  flex-shrink: 0;
}

.att-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}

.att-remove {
  width: 18px;
  height: 18px;
  border: none;
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  flex-shrink: 0;
  padding: 0;
}

.att-remove:hover {
  background: var(--color-surface);
  color: var(--color-text);
}

.attach-btn {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  border-radius: 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  /* 性能优化:opacity + transform 控制可见性(合成层),替代 v-if mount/unmount */
  transition: background 0.15s, color 0.15s, opacity 0.2s, transform 0.2s;
  margin-right: 4px;
}

/* 性能优化:未展开时按钮不可见(但仍渲染,避免 mount/unmount 触发 flex 重排) */
.capsule-input:not(.expanded) .attach-btn {
  opacity: 0;
  transform: scale(0.8);
  pointer-events: none;
}

.attach-btn:hover:not(:disabled) {
  background: var(--color-surface);
  color: var(--color-primary);
}

.attach-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.hidden-file-input {
  display: none;
}

.chat-textarea {
  flex: 1;
  resize: none;
  border: none;
  border-radius: 12px;
  padding: 4px 8px;
  font-size: var(--font-size-sm);
  font-family: inherit;
  background: transparent;
  color: var(--color-text);
  line-height: 1.5;
  max-height: 120px;
  overflow-y: auto;
  outline: none;
  width: 100%;
}

.chat-textarea::placeholder {
  color: var(--color-text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.send-btn {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border: none;
  background: var(--color-primary);
  color: var(--color-text-inverse);
  border-radius: 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  /* 性能优化:opacity + transform 控制可见性(合成层),替代 v-if mount/unmount */
  transition: background 0.15s, opacity 0.2s, transform 0.2s;
  margin-left: 8px;
}

/* 性能优化:未展开时按钮不可见(但仍渲染,避免 mount/unmount 触发 flex 重排) */
.capsule-input:not(.expanded) .send-btn {
  opacity: 0;
  transform: scale(0.8);
  pointer-events: none;
}

.send-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.send-btn:not(:disabled):hover {
  opacity: 0.85;
}

.send-btn.stop-btn {
  background: var(--color-danger, #e74c3c);
  animation: stop-pulse 1.5s ease-in-out infinite;
}

@keyframes stop-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}

.vision-warning {
  margin-top: 8px;
  padding: 6px 12px;
  background: var(--color-warning-bg, rgba(255, 200, 0, 0.1));
  border: 1px solid var(--color-warning-border, rgba(255, 200, 0, 0.3));
  border-radius: 8px;
  font-size: var(--font-size-xs);
  color: var(--color-warning-text, #d4a000);
  text-align: center;
  max-width: 80%;
}

.warning-fade-enter-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.warning-fade-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}
.warning-fade-enter-from {
  opacity: 0;
  transform: translateY(-4px);
}
.warning-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
