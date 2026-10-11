import { ref, watch, onUnmounted, type Ref } from 'vue'
import { useFileStore, onFilePersisted } from '../stores/fileStore'
import { useImageResolver } from './useImageResolver'

export interface ImageRef {
  fileId?: string
  url?: string
}

function parseImageRef(value: unknown): ImageRef | null {
  if (!value) return null
  if (typeof value === 'string') {
    if (value.startsWith('file://')) {
      return { fileId: undefined, url: undefined }
    }
    if (value.startsWith('file:')) {
      return { fileId: value.slice(5) }
    }
    return { url: value }
  }
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>
    if (obj.fileId && typeof obj.fileId === 'string') {
      return { fileId: obj.fileId, url: obj.thumbnail as string | undefined }
    }
    if (obj.url && typeof obj.url === 'string') {
      return { url: obj.url }
    }
  }
  return null
}

function parseFilePathRef(value: string): { type: 'fileId'; fileId: string } | { type: 'path'; path: string } | null {
  if (!value.startsWith('file:')) return null
  const rest = value.slice(5)
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

function base64ToBlob(base64: string, mimeType: string): Blob {
  const byteString = atob(base64)
  const ab = new ArrayBuffer(byteString.length)
  const ia = new Uint8Array(ab)
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i)
  }
  return new Blob([ab], { type: mimeType })
}

export function useEntityImage(imageValue: Ref<unknown>) {
  const fileStore = useFileStore()
  const imageUrl = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  let currentBlobUrl: string | null = null

  // 共享解析循环：onFilePersisted 事件 + 退避重试，覆盖 useFileStore 与 imageValue 之间的写库时差
  const resolver = useImageResolver({
    subscribe: (l) => onFilePersisted(l),
  })

  function revokeCurrent() {
    if (currentBlobUrl) {
      URL.revokeObjectURL(currentBlobUrl)
      currentBlobUrl = null
    }
  }

  /** 解析 fileId 关联的二进制 → blob URL。返回 true 成功，false 数据未找到，throw 异常。 */
  async function resolveByFileId(fileId: string, v: number): Promise<boolean> {
    const content = await fileStore.getContent(fileId)
    if (v !== resolver.getVersion()) return false
    if (!content?.binaryData) return false
    // getById 之后不再做 version check：即使 stale，binaryData 不会泄露为 blob URL
    const fileRecord = await fileStore.getById(fileId)
    const mimeType = fileRecord?.mimeType || 'image/png'
    revokeCurrent()
    const blob = base64ToBlob(content.binaryData, mimeType)
    currentBlobUrl = URL.createObjectURL(blob)
    imageUrl.value = currentBlobUrl
    return true
  }

  /**
   * 单次解析尝试：扫描 input 形式（对象 / file:fileId / file:path），命中就 set imageUrl 并返回 true。
   * 失败原因分两类：
   * - 输入格式不合法 / 清空 → 直接清空 imageUrl 并返回 true（终态，不再重试）
   * - 解析路径但 IDB 暂无记录 → 返回 false，让 resolver 进入下一轮退避
   */
  async function attempt(v: number): Promise<boolean> {
    if (v !== resolver.getVersion()) return false
    const raw = imageValue.value

    // 非字符串输入：尝试作为对象解析
    if (!raw || typeof raw !== 'string') {
      const ref = parseImageRef(raw)
      if (!ref) {
        revokeCurrent()
        imageUrl.value = null
        return true
      }
      if (ref.url) {
        revokeCurrent()
        imageUrl.value = ref.url
        return true
      }
      if (ref.fileId) {
        try {
          return await resolveByFileId(ref.fileId, v)
        } catch (e: any) {
          if (v !== resolver.getVersion()) return false
          error.value = e?.message || '图片加载失败'
          imageUrl.value = null
          return true
        }
      }
      return true
    }

    const pathRef = parseFilePathRef(raw)

    // 非 file: 引用（http(s) / data: / 裸 url），直接使用
    if (!pathRef) {
      const simpleRef = parseImageRef(raw)
      if (simpleRef?.url) {
        revokeCurrent()
        imageUrl.value = simpleRef.url
        return true
      }
      revokeCurrent()
      imageUrl.value = null
      return true
    }

    if (pathRef.type === 'fileId') {
      try {
        return await resolveByFileId(pathRef.fileId, v)
      } catch (e: any) {
        if (v !== resolver.getVersion()) return false
        error.value = e?.message || '图片加载失败'
        imageUrl.value = null
        return true
      }
    }

    // pathRef.type === 'path'：查 fileStore，再回退到 UUID 末段
    try {
      const fileRecord = await fileStore.getByPath(pathRef.path)
      if (v !== resolver.getVersion()) return false

      if (fileRecord) {
        return await resolveByFileId(fileRecord.id, v)
      }

      const segments = pathRef.path.split('/')
      const maybeId = segments[segments.length - 1]?.replace(/\.[^.]+$/, '')
      if (maybeId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(maybeId)) {
        return await resolveByFileId(maybeId, v)
      }

      return false
    } catch (e: any) {
      if (v !== resolver.getVersion()) return false
      error.value = e?.message || '图片加载失败'
      imageUrl.value = null
      return true
    }
  }

  watch(imageValue, async () => {
    revokeCurrent()
    imageUrl.value = null
    error.value = null
    loading.value = true

    const vStart = resolver.getVersion()
    await resolver.run(attempt)

    // 本轮正常完成（非 stale）：成功路径已在 attempt 内 set imageUrl；
    // 全部退避失败的兜底由此处补齐。stale 时让新轮次接管状态。
    if (resolver.getVersion() === vStart + 1) {
      loading.value = false
      if (!imageUrl.value) {
        error.value = error.value || '图片文件未找到'
      }
    }
  }, { immediate: true })

  onUnmounted(() => {
    resolver.cancel()
    revokeCurrent()
  })

  return { imageUrl, loading, error }
}
