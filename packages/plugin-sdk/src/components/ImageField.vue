<template>
  <div class="image-field">
    <div v-if="!editing" class="image-field-preview" @dblclick="$emit('request-edit')">
      <img v-if="resolvedUrl" :src="resolvedUrl" class="image-field-img" :style="previewStyle" @click="openLightbox" />
      <div v-else class="image-field-placeholder">
        <WsIcon name="image" size="md" />
        <span>双击添加图片</span>
      </div>
    </div>
    <div v-else class="image-field-editor">
      <div
        class="image-drop-zone"
        :class="{ 'drop-active': isDragging, 'focal-mode': focalMode }"
        role="button"
        tabindex="0"
        :aria-label="focalMode ? '点击设定封面焦点' : '选择或拖拽图片'"
        @click="onDropZoneClick"
        @keydown="onDropZoneKeydown"
        @wheel.prevent="onWheel"
        @dragover.prevent="isDragging = true"
        @dragleave="isDragging = false"
        @drop.prevent="onDrop"
      >
        <div v-if="resolvedUrl" class="image-preview-clip">
          <img :src="resolvedUrl" class="image-field-img" :style="previewStyle" />
          <div v-if="focalPoint" class="focal-indicator" :style="focalIndicatorStyle">
            <div class="focal-cross-h"></div>
            <div class="focal-cross-v"></div>
          </div>
        </div>
        <div v-if="!resolvedUrl" class="image-drop-hint">
          <WsIcon name="image" size="lg" />
          <p>拖拽图片到此处</p>
          <p>或点击选择文件</p>
        </div>
        <input
          v-show="!focalMode"
          ref="fileInputRef"
          type="file"
          accept="image/*"
          class="image-file-input"
          @click.stop
          @change="onFileSelect"
        />
      </div>
      <div class="image-field-actions">
        <button class="btn-sm" @click="fileInputRef?.click()">选择文件</button>
        <button v-if="resolvedUrl" class="btn-sm btn-danger" @click="removeImage">移除</button>
        <button v-if="resolvedUrl" class="btn-sm btn-focal" @click="toggleFocalMode">
          {{ focalMode ? '完成调整' : '调整封面焦点' }}
        </button>
        <button v-if="resolvedUrl && localCoverPosition !== '50% 50%'" class="btn-sm" @click="resetFocal">重置焦点</button>
        <button v-if="resolvedUrl && localCoverZoom > 1" class="btn-sm" @click="resetZoom">重置缩放</button>
      </div>
      <p v-if="focalMode && resolvedUrl" class="focal-hint">点击设定焦点 · 滚轮缩放裁剪 · 当前 {{ Math.round(localCoverZoom * 100) }}%</p>
      <input
        v-model="urlInput"
        class="image-url-input"
        placeholder="或输入图片 URL..."
        aria-label="图片 URL"
        @keydown.enter="applyUrl"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useEntityImage } from '@worldsea/entity-core/composables'
import { useFileStore } from '@worldsea/entity-core'
import { WsIcon } from '@worldsea/ui-kit'

const props = defineProps<{
  value: unknown
  editing: boolean
  entityId?: string
  coverPosition?: string
  coverZoom?: number
}>()

const emit = defineEmits<{
  'update:value': [val: unknown]
  'update:coverPosition': [val: string]
  'update:coverZoom': [val: number]
  'open-lightbox': [url: string]
  'request-edit': []
}>()

const fileStore = useFileStore()
const fileInputRef = ref<HTMLInputElement>()
const isDragging = ref(false)
const urlInput = ref('')
const focalMode = ref(false)
const pendingValue = ref<unknown>(undefined)

const localCoverPosition = ref(props.coverPosition || '50% 50%')
const localCoverZoom = ref(props.coverZoom || 1)

watch(() => props.coverPosition, (val) => {
  if (val !== undefined) localCoverPosition.value = val
})
watch(() => props.coverZoom, (val) => {
  if (val !== undefined) localCoverZoom.value = val
})

const effectiveValue = computed(() => {
  if (pendingValue.value !== undefined) return pendingValue.value
  return props.value
})

const { imageUrl: resolvedUrl } = useEntityImage(effectiveValue)

watch(() => props.value, () => {
  pendingValue.value = undefined
})

const focalPoint = computed<{ x: number; y: number } | null>(() => {
  const pos = localCoverPosition.value
  const match = pos.match(/^([\d.]+)%\s+([\d.]+)%$/)
  if (!match) return null
  return { x: parseFloat(match[1]), y: parseFloat(match[2]) }
})

const previewStyle = computed(() => ({
  objectPosition: localCoverPosition.value,
  transform: `scale(${localCoverZoom.value})`,
  transformOrigin: localCoverPosition.value,
}))

const focalIndicatorStyle = computed(() => {
  if (!focalPoint.value) return {}
  return {
    left: `${focalPoint.value.x}%`,
    top: `${focalPoint.value.y}%`,
  }
})

function openLightbox() {
  if (resolvedUrl.value) {
    emit('open-lightbox', resolvedUrl.value)
  }
}

function toggleFocalMode() {
  focalMode.value = !focalMode.value
}

function resetFocal() {
  localCoverPosition.value = '50% 50%'
  emit('update:coverPosition', '50% 50%')
}

function resetZoom() {
  localCoverZoom.value = 1
  emit('update:coverZoom', 1)
}

function onDropZoneClick(e: MouseEvent) {
  if (!focalMode.value) return
  const zone = e.currentTarget as HTMLElement
  const clip = zone.querySelector('.image-preview-clip') as HTMLElement
  const target = clip || zone
  const rect = target.getBoundingClientRect()
  const x = Math.round(((e.clientX - rect.left) / rect.width) * 100)
  const y = Math.round(((e.clientY - rect.top) / rect.height) * 100)
  const clampedX = Math.max(0, Math.min(100, x))
  const clampedY = Math.max(0, Math.min(100, y))
  const pos = `${clampedX}% ${clampedY}%`
  localCoverPosition.value = pos
  emit('update:coverPosition', pos)
}

/** 键盘可达性：Enter/Space 触发文件选择（指针坐标的焦点设定仅支持鼠标/触控） */
function onDropZoneKeydown(e: KeyboardEvent) {
  if (e.key !== 'Enter' && e.key !== ' ') return
  e.preventDefault()
  if (!focalMode.value) {
    fileInputRef.value?.click()
  }
}

function onWheel(e: WheelEvent) {
  if (!focalMode.value) return
  const delta = e.deltaY > 0 ? -0.1 : 0.1
  const next = Math.round(Math.max(1, Math.min(3, localCoverZoom.value + delta)) * 10) / 10
  if (next !== localCoverZoom.value) {
    localCoverZoom.value = next
    emit('update:coverZoom', next)
  }
}

async function uploadFile(file: File) {
  if (!file.type.startsWith('image/')) return

  const reader = new FileReader()
  reader.onload = async () => {
    const base64 = (reader.result as string).split(',')[1]
    const fileId = await fileStore.add(
      file.name,
      `images/${props.entityId || 'unknown'}/${file.name}`,
      file.type,
      file.size,
      base64,
      props.entityId,
    )
    pendingValue.value = `file:${fileId}`
    emit('update:value', `file:${fileId}`)
  }
  reader.readAsDataURL(file)
}

function onDrop(e: DragEvent) {
  isDragging.value = false
  const file = e.dataTransfer?.files[0]
  if (file) uploadFile(file)
}

function onDocumentPaste(e: ClipboardEvent) {
  if (!props.editing) return
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault()
      const file = item.getAsFile()
      if (file) uploadFile(file)
      break
    }
  }
}

function onFileSelect(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) uploadFile(file)
  input.value = ''
}

function applyUrl() {
  const url = urlInput.value.trim()
  if (url) {
    pendingValue.value = url
    emit('update:value', url)
    urlInput.value = ''
  }
}

function removeImage() {
  pendingValue.value = null
  emit('update:value', null)
}

onMounted(() => document.addEventListener('paste', onDocumentPaste))
onUnmounted(() => document.removeEventListener('paste', onDocumentPaste))
</script>

<style scoped>
.image-field-preview {
  border-radius: var(--radius-md);
  overflow: hidden;
  cursor: pointer;
}
.image-field-img {
  width: 100%;
  max-height: 200px;
  object-fit: cover;
  border-radius: var(--radius-md);
}
.image-field-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 80px;
  border: 2px dashed var(--border-color);
  border-radius: var(--radius-md);
  color: var(--text-tertiary);
  font-size: var(--font-size-xs);
}
.image-field-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.image-drop-zone {
  position: relative;
  border: 2px dashed var(--border-color);
  border-radius: var(--radius-md);
  min-height: 100px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color var(--transition), background var(--transition);
  cursor: pointer;
  overflow: hidden;
}
.image-drop-zone.drop-active {
  border-color: var(--primary);
  background: var(--primary-light);
}
.image-drop-zone.focal-mode {
  cursor: crosshair;
  border-color: var(--primary);
}
.image-preview-clip {
  position: relative;
  width: 100%;
  overflow: hidden;
  border-radius: var(--radius-md);
}
.image-drop-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
  padding: 20px;
}
.image-drop-hint p {
  margin: 0;
}
.image-file-input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}
.image-field-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.btn-sm {
  padding: 4px 10px;
  font-size: var(--font-size-xs);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--card-bg);
  color: var(--text-color);
  cursor: pointer;
}
.btn-sm:hover {
  background: var(--hover-bg);
}
.btn-danger {
  color: var(--danger);
  border-color: var(--danger);
}
.btn-danger:hover {
  background: var(--danger-light);
}
.btn-focal {
  color: var(--primary);
  border-color: var(--primary);
}
.btn-focal:hover {
  background: var(--primary-light);
}
.focal-hint {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--primary);
}
.focal-indicator {
  position: absolute;
  width: 24px;
  height: 24px;
  transform: translate(-50%, -50%);
  pointer-events: none;
  z-index: 3;
}
.focal-cross-h,
.focal-cross-v {
  position: absolute;
  background: #fff;
  box-shadow: 0 0 4px rgba(0,0,0,0.5);
}
.focal-cross-h {
  width: 24px;
  height: 2px;
  top: 11px;
  left: 0;
}
.focal-cross-v {
  width: 2px;
  height: 24px;
  left: 11px;
  top: 0;
}
.image-url-input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  background: var(--input-bg);
  color: var(--text-color);
}
</style>
