/** useModelApiKeyConfig：模型/供应商 API Key 的加载、持久化与迁移（从 AgentSettingsPanel.vue 拆分） */
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import { useSettingsStore } from '../../stores/settingsStore'
import { loadApiKey, storeApiKey, removeApiKey } from '@agent/index'

export interface UseModelApiKeyConfigOptions {
  /** api-key-change 事件转发（由组件 emit 提供） */
  onApiKeyChange: (provider: string, apiKey: string) => void
}

export function useModelApiKeyConfig(options: UseModelApiKeyConfigOptions) {
  const { onApiKeyChange } = options
  const settingsStore = useSettingsStore()

  // cloudApiKey / customApiKey 共享状态：通过 v-model 传给 ModelPanel / ProviderPanel
  // 持久化副作用（storeApiKey/removeApiKey）与 api-key-change 冒泡集中在本 composable
  const cloudApiKey = ref('')
  const customApiKey = ref('')
  // 初始加载 / storeId 切换期间跳过 custom 冒泡，避免与外部逻辑重复触发
  let skipCustomKeyEmit = false

  const customKeyStoreId = computed(() => settingsStore.getCustomKeyStoreId(settingsStore.aiCustomBaseUrl))

  onMounted(async () => {
    cloudApiKey.value = await loadApiKey(settingsStore.aiCloudProvider)
    skipCustomKeyEmit = true
    customApiKey.value = await loadApiKey(customKeyStoreId.value)
    await nextTick()
    skipCustomKeyEmit = false
  })

  watch(cloudApiKey, async (v) => {
    if (v) {
      await storeApiKey(settingsStore.aiCloudProvider, v)
    } else {
      await removeApiKey(settingsStore.aiCloudProvider)
    }
    onApiKeyChange(settingsStore.aiCloudProvider, v)
  })

  watch(customApiKey, async (v) => {
    if (v) {
      await storeApiKey(customKeyStoreId.value, v)
    } else {
      await removeApiKey(customKeyStoreId.value)
    }
    if (!skipCustomKeyEmit) {
      onApiKeyChange('custom', v)
    }
  })

  watch(() => settingsStore.aiCloudProvider, async (provider) => {
    cloudApiKey.value = await loadApiKey(provider)
  })

  watch(customKeyStoreId, async (newId, oldId) => {
    if (newId === oldId) return
    const currentKey = customApiKey.value
    if (currentKey && oldId) {
      await storeApiKey(oldId, currentKey)
    }
    skipCustomKeyEmit = true
    customApiKey.value = await loadApiKey(newId)
    await nextTick()
    skipCustomKeyEmit = false
  })

  return { cloudApiKey, customApiKey }
}

export type UseModelApiKeyConfigReturn = ReturnType<typeof useModelApiKeyConfig>
