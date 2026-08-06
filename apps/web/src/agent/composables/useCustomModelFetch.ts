/** useCustomModelFetch：自定义供应商（openai-compatible）模型列表拉取（从 AgentSettingsPanel.vue 拆分） */
import { ref, computed, watch, type Ref } from 'vue'
import { useSettingsStore } from '../../stores/settingsStore'

export interface UseCustomModelFetchOptions {
  /** 自定义供应商 API Key（来自 useModelApiKeyConfig） */
  customApiKey: Ref<string>
}

export function useCustomModelFetch(options: UseCustomModelFetchOptions) {
  const { customApiKey } = options
  const settingsStore = useSettingsStore()

  // 拉取状态经 props 透传给 ModelPanel / ProviderPanel 展示
  const fetchedModels = ref<string[]>([])
  const fetchingModels = ref(false)
  const fetchError = ref('')

  const canFetchModels = computed(() => {
    return settingsStore.aiCustomBaseUrl.trim() !== ''
      && settingsStore.aiCustomType === 'openai-compatible'
      && customApiKey.value.trim() !== ''
  })

  async function onFetchModels(): Promise<void> {
    const baseUrl = settingsStore.aiCustomBaseUrl.replace(/\/+$/, '')
    const apiKey = customApiKey.value
    if (!baseUrl || !apiKey) return

    fetchingModels.value = true
    fetchError.value = ''
    fetchedModels.value = []

    try {
      const isRemote = /^https?:\/\//.test(baseUrl)
      let modelsUrl: string
      const fetchHeaders: Record<string, string> = { Authorization: `Bearer ${apiKey}` }

      if (isRemote) {
        try {
          const url = new URL(baseUrl)
          fetchHeaders['X-Target-Base-Url'] = `${url.protocol}//${url.host}`
          let basePath = url.pathname.replace(/\/+$/, '')
          if (!basePath) basePath = '/v1'
          modelsUrl = `/api/custom-proxy${basePath}/models`
        } catch {
          fetchError.value = '无效的 Base URL'
          return
        }
      } else {
        modelsUrl = baseUrl.includes('/v1') ? `${baseUrl}/models` : `${baseUrl}/v1/models`
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
