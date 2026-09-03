<template>
  <div class="fpv">
    <!-- 头部：文件名 + 大小 + 返回 -->
    <div class="fpv-header">
      <span class="fpv-name" :title="path">{{ name }}</span>
      <span class="fpv-size">{{ formatSize(size) }}</span>
      <button class="fpv-close" title="返回目录" @click="emit('close')"><WsIcon name="arrow-left" size="xs" /></button>
    </div>

    <!-- 大文件守卫：先提示 + 仍要预览 -->
    <div v-if="guard" class="fpv-guard">
      <WsIcon name="warning" size="sm" class="fpv-guard-icon" />
      <p class="fpv-guard-text">文件较大（{{ formatSize(size) }}），预览可能会卡顿。</p>
      <button class="fpv-guard-btn" @click="forcePreview">仍要预览</button>
      <button class="fpv-guard-cancel" @click="emit('close')">返回</button>
    </div>

    <!-- 二进制提示 -->
    <div v-else-if="binary" class="fpv-binary">
      <WsIcon name="file" size="lg" class="fpv-binary-icon" />
      <p class="fpv-binary-text">非文本二进制文件，暂不支持预览。</p>
    </div>

    <!-- 图片预览 -->
    <div v-else-if="kind === 'image'" class="fpv-image-wrap">
      <img v-if="imgSrc" :src="imgSrc" class="fpv-image" alt="预览" @error="binary = true; imgSrc = null" />
      <div v-else class="fpv-loading">加载中…</div>
    </div>

    <!-- 文本预览 -->
    <pre v-else class="fpv-text">{{ text ?? '加载中…' }}</pre>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import { invoke } from '@/agent/composables/transport'

const props = defineProps<{ path: string; name: string; size: number }>()
const emit = defineEmits<{ close: [] }>()

/** 大文件阈值（2026-09-03 用户建议）：文本与图片统一 >10MB 才守卫 */
const TEXT_GUARD = 10 * 1024 * 1024
const IMAGE_GUARD = 10 * 1024 * 1024

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'])
const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
}
/** 已知不可预览二进制扩展名：直接提示，不走大文件守卫 */
const BINARY_EXT = new Set([
  'exe', 'dll', 'so', 'dylib', 'bin', 'dat', 'db', 'sqlite', 'sqlite3', 'lock',
  'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso', 'img',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'ico', 'woff', 'woff2', 'ttf', 'otf',
])

/** 预览类别：image / text / binary（判定后） */
const kind = ref<'image' | 'text'>('text')
const guard = ref(false)
const forced = ref(false)
const binary = ref(false)
const text = ref<string | null>(null)
const imgSrc = ref<string | null>(null)

function ext(): string {
  const i = props.name.lastIndexOf('.')
  return i >= 0 ? props.name.slice(i + 1).toLowerCase() : ''
}

/** 是否图片（按扩展名） */
function isImage(): boolean {
  return IMAGE_EXT.has(ext())
}

/** 是否需要大文件守卫（已知二进制不守卫——直接提示不可预览） */
function needsGuard(): boolean {
  if (isKnownBinary()) return false
  return props.size > (isImage() ? IMAGE_GUARD : TEXT_GUARD)
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function forcePreview(): void {
  forced.value = true
  guard.value = false // 关闭守卫，才会真正进入读取分支
  void load()
}

/** 已知二进制扩展名 → 直接标记不可预览（不再走文本读取/大文件守卫） */
function isKnownBinary(): boolean {
  return BINARY_EXT.has(ext())
}

async function load(): Promise<void> {
  binary.value = false
  text.value = null
  imgSrc.value = null
  // 已知二进制（exe/压缩包/office 等）：直接提示不可预览（T11）
  if (isKnownBinary()) {
    kind.value = 'text'
    binary.value = true
    return
  }
  if (isImage()) {
    kind.value = 'image'
    try {
      const b64 = await invoke<string>('cmd_fs_read', { path: props.path, encoding: 'base64' })
      imgSrc.value = `data:${MIME[ext()] ?? 'image/png'};base64,${b64}`
    } catch (err) {
      console.warn('[FilePreview] 读取图片失败:', err)
      binary.value = true
    }
    return
  }
  kind.value = 'text'
  try {
    text.value = await invoke<string>('cmd_fs_read', { path: props.path, encoding: 'utf-8' })
  } catch (err) {
    console.warn('[FilePreview] 文本读取失败（可能为二进制）:', err)
    binary.value = true
  }
}

onMounted(() => {
  // 大文件守卫：每次打开先提示（除非本次已强制）
  guard.value = needsGuard() && !forced.value
  if (!guard.value) void load()
})

// 路径变化时重置状态并重新判定
watch(
  () => props.path,
  () => {
    forced.value = false
    binary.value = false
    guard.value = needsGuard() && !forced.value
    if (!guard.value) void load()
  },
)
</script>

<style scoped>
.fpv {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--color-surface-elevated);
}
.fpv-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}
.fpv-name {
  flex: 1;
  min-width: 0;
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.fpv-size {
  flex-shrink: 0;
  font-size: var(--font-size-2xs);
  color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums;
}
.fpv-close {
  width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  color: var(--color-text-tertiary);
  border-radius: var(--radius-xs);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.fpv-close:hover {
  color: var(--color-text);
  background: var(--color-surface);
}

.fpv-guard {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 20px;
}
.fpv-guard-icon {
  color: #e8a33d;
}
.fpv-guard-text {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  text-align: center;
}
.fpv-guard-btn {
  padding: 6px 16px;
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-primary);
  font-size: var(--font-size-xs);
  cursor: pointer;
}
.fpv-guard-btn:hover {
  background: var(--color-primary-muted);
}
.fpv-guard-cancel {
  padding: 6px 16px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  cursor: pointer;
}
.fpv-guard-cancel:hover {
  color: var(--color-text);
}

.fpv-binary {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 20px;
}
.fpv-binary-icon {
  color: var(--color-text-tertiary);
  opacity: 0.5;
}
.fpv-binary-text {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}

.fpv-image-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
}
.fpv-image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: var(--radius-sm);
}
.fpv-loading {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}

.fpv-text {
  flex: 1;
  min-height: 0;
  overflow: auto;
  margin: 0;
  padding: 10px 12px;
  font-family: var(--font-mono, ui-monospace, 'Cascadia Mono', Consolas, monospace);
  font-size: var(--font-size-xs);
  line-height: 1.55;
  color: var(--color-text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
  user-select: text;
}
</style>