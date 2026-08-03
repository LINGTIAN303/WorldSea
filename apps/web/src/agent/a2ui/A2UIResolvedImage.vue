<template>
  <img
    v-if="resolvedSrc"
    :src="resolvedSrc"
    :alt="alt"
    :class="imgClass"
    :style="imgStyle"
    @click="$emit('click', $event)"
  />
  <div v-else-if="loading" :class="imgClass" class="a2ui-img-loading">
    <span class="a2ui-img-spinner" />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'
import { useFileStore, useImageResolver, onFilePersisted } from '@worldsmith/entity-core'

const props = defineProps<{
  src: string | undefined | null
  alt?: string
  imgClass?: string
  imgStyle?: Record<string, string>
}>()

const emit = defineEmits<{
  click: [event: MouseEvent]
}>()

const fileStore = useFileStore()
const resolvedSrc = ref<string | null>(null)
const loading = ref(false)

let currentBlobUrl: string | null = null

// 共享解析循环：onFilePersisted 事件 + 退避重试，覆盖 useFileStore 与 appendBlock 之间的写库时差
const resolver = useImageResolver({
  subscribe: (l) => onFilePersisted(l),
})

function revokeCurrent() {
  if (currentBlobUrl) {
    URL.revokeObjectURL(currentBlobUrl)
    currentBlobUrl = null
  }
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const byteString = atob(base64)
  const ab = new ArrayBuffer(byteString.length)
  const ia = new Uint8Array(ab)
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i)
  }
  return new Blob([ab], { type: mimeType })
}

function parseFileRef(raw: string): { type: 'fileId'; fileId: string } | { type: 'path'; path: string } | null {
  if (!raw.startsWith('file:')) return null
  const rest = raw.slice(5)
  if (rest.startsWith('//')) {
    const path = decodeURIComponent(rest.slice(2))
    return { type: 'path', path }
  }
  if (rest.startsWith('/')) {
    const path = decodeURIComponent(rest.slice(1))
    return { type: 'path', path }
  }
  return { type: 'fileId', fileId: rest }
}

/** 解析 file: 引用为 { mimeType, binaryData }，不创建 blob URL。
 *  返回中间结果而非 blob URL，是为了避免 stale 路径泄漏 blob（外层在版本检查后才会建 URL）。
 *  返回 null 表示 IDB 中暂无记录，调用方应进入重试或放弃。
 *  v 为当前 resolver 版本号，stale 时返回 null。
 */
async function tryResolveFileRef(
  ref: { type: 'fileId'; fileId: string } | { type: 'path'; path: string },
  v: number
): Promise<{ mimeType: string; binaryData: string } | null> {
  let fileId: string | undefined

  if (ref.type === 'fileId') {
    fileId = ref.fileId
  } else {
    const fileRecord = await fileStore.getByPath(ref.path)
    if (v !== resolver.getVersion()) return null
    if (fileRecord) {
      fileId = fileRecord.id
    } else {
      const segments = ref.path.split('/')
      const maybeId = segments[segments.length - 1]?.replace(/\.[^.]+$/, '')
      if (maybeId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(maybeId)) {
        fileId = maybeId
      }
    }
  }

  if (!fileId) return null

  const content = await fileStore.getContent(fileId)
  if (v !== resolver.getVersion()) return null
  if (!content?.binaryData) return null

  // getById 之后不再做 version check：即使 stale，binaryData 不会泄露为 blob URL
  const fileRecord = await fileStore.getById(fileId)
  const mimeType = fileRecord?.mimeType || 'image/png'
  return { mimeType, binaryData: content.binaryData }
}

async function resolve() {
  const raw = props.src

  if (!raw) {
    resolver.cancel()
    revokeCurrent()
    resolvedSrc.value = null
    loading.value = false
    return
  }

  const ref = parseFileRef(raw)

  if (!ref) {
    // 非 file: 引用（http(s) / data:），直接使用
    resolver.cancel()
    revokeCurrent()
    resolvedSrc.value = raw
    loading.value = false
    return
  }

  // file: 引用 → 异步 IDB 解析，事件优先 + 退避兜底
  loading.value = true
  resolvedSrc.value = null

  // 记录本轮 run 的版本起点，用于事后判断本轮是否正常完成（未被后续 run/cancel 抢占）
  const vStart = resolver.getVersion()
  await resolver.run(async (v) => {
    if (v !== resolver.getVersion()) return false
    try {
      const data = await tryResolveFileRef(ref, v)
      if (v !== resolver.getVersion()) return false
      if (data) {
        revokeCurrent()
        const blob = base64ToBlob(data.binaryData, data.mimeType)
        currentBlobUrl = URL.createObjectURL(blob)
        resolvedSrc.value = currentBlobUrl
        loading.value = false
        return true
      }
      // 解析结果为 null（IDB 中暂无），进入下一轮重试
      return false
    } catch {
      if (v !== resolver.getVersion()) return false
      return false
    }
  })

  // 本轮正常完成（非 stale）：成功路径已在 attempt 内清 loading；
  // 全部退避失败的兜底由此处补齐。stale 时让新轮次接管状态。
  if (resolver.getVersion() === vStart + 1) {
    loading.value = false
    resolvedSrc.value = null
  }
}

watch(() => props.src, resolve, { immediate: true })

onUnmounted(() => {
  resolver.cancel()
  revokeCurrent()
})
</script>

<style scoped>
.a2ui-img-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--agent-bg-tertiary, var(--color-bg-elevated));
  border-radius: var(--radius-sm, 4px);
  min-height: 60px;
}
.a2ui-img-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--agent-border, var(--color-border));
  border-top-color: var(--agent-accent, var(--color-primary));
  border-radius: 50%;
  animation: ws-spin 0.6s linear infinite;
}
</style>
