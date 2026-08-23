/** useCustomModelFetch：自定义供应商模型列表拉取（从 AgentSettingsPanel.vue 拆分） */
import { ref, computed, watch, type Ref } from 'vue'
import { useSettingsStore } from '../../stores/settingsStore'

export interface UseCustomModelFetchOptions {
  /** 自定义供应商 API Key（来自 useModelApiKeyConfig） */
  customApiKey: Ref<string>
}

/** 判断是否为 Anthropic 兼容类型（需用 x-api-key 鉴权） */
function isAnthropicLike(type: string): boolean {
  return type === 'anthropic-compatible' || type === 'anthropic'
}

// ── 自定义供应商模型列表路径（可按 API 类型配置，对应计划的「modelsPath 按 type 配置」） ──
const CUSTOM_MODELS_PATHS: Record<string, string> = {
  'openai-compatible': '/models',
  'anthropic-compatible': '/v1/models',
}
const CUSTOM_MODELS_DEFAULT = '/models'

export function useCustomModelFetch(options: UseCustomModelFetchOptions) {
  const { customApiKey } = options
  const settingsStore = useSettingsStore()

  // 拉取状态经 props 透传给 ModelPanel / ProviderPanel 展示
  const fetchedModels = ref<string[]>([])
  const fetchingModels = ref(false)
  const fetchError = ref('')

  // 任何自定义供应商类型：只要 baseUrl 与 key 都填了就允许尝试拉取（无需限定 openai-compatible）
  const canFetchModels = computed(() => {
    return settingsStore.aiCustomBaseUrl.trim() !== ''
      && customApiKey.value.trim() !== ''
  })

  async function onFetchModels(): Promise<void> {
    const baseUrl = settingsStore.aiCustomBaseUrl.replace(/\/+$/, '')
    const apiKey = customApiKey.value
    const apiType = settingsStore.aiCustomType || 'openai-compatible'
    if (!baseUrl || !apiKey) return

    fetchingModels.value = true
    fetchError.value = ''
    fetchedModels.value = []

    try {
      const isRemote = /^https?:\/\//.test(baseUrl)
      // 按 API 类型选择鉴权头与模型路径（Anthropic 兼容走 x-api-key）
      const isAnthropic = isAnthropicLike(apiType)
      let fetchHeaders: Record<string, string>
      if (isAnthropic) {
        fetchHeaders = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }
      } else {
        fetchHeaders = { Authorization: `Bearer ${apiKey}` }
      }
      const modelsPath = CUSTOM_MODELS_PATHS[apiType] || CUSTOM_MODELS_DEFAULT
      let modelsUrl: string

      if (isRemote) {
        try {
          const url = new URL(baseUrl)
          fetchHeaders['X-Target-Base-Url'] = `${url.protocol}//${url.host}`
          let basePath = url.pathname.replace(/\/+$/, '')
          if (!basePath) basePath = '/v1'
          modelsUrl = `/api/custom-proxy${basePath}${modelsPath}`
        } catch {
          fetchError.value = '无效的 Base URL'
          return
        }
      } else {
        modelsUrl = baseUrl.includes('/v1') ? `${baseUrl}${modelsPath}` : `${baseUrl}/v1${modelsPath}`
      }

      const res = await fetch(modelsUrl, {
        headers: fetchHeaders,
        signal: AbortSignal.timeout(15000),
      })
      if (!res.ok) {
        fetchError.value = `拉取失败: HTTP ${res.status}`
        return
      }
      const data = await res.json()
      const models: string[] = (data.data || [])
        .map((m: any) => m.id)
        .filter((id: any) => typeof id === 'string')
        .sort((a: string, b: string) => a.localeCompare(b))
      if (models.length === 0) {
        fetchError.value = '未发现可用模型'
        return
      }
      fetchedModels.value = models
    } catch (e: any) {
      fetchError.value = e.name === 'TimeoutError' ? '拉取超时' : `拉取失败: ${e.message || e}`
    } finally {
      fetchingModels.value = false
    }
  }

  watch(() => [settingsStore.aiCustomBaseUrl, settingsStore.aiCustomType], () => {
    fetchedModels.value = []
    fetchError.value = ''
  })

  return { fetchedModels, fetchingModels, fetchError, canFetchModels, onFetchModels }
}

export type UseCustomModelFetchReturn = ReturnType<typeof useCustomModelFetch>
