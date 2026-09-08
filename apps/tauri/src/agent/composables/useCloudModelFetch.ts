/** useCloudModelFetch：云端供应商模型列表拉取（响应式 modelVersion + 手动/切供应商刷新 + 新鲜度），
 *  供 ModelPanel / ProviderPanel 复用，对应「切供应商主动拉取」「UI 刷新入口」目标 */
import { ref, computed } from 'vue'
import {
  getModelsByProvider,
  getProviderManifest,
  refreshModels,
  getLastModelFetchInfo,
  loadApiKey,
  type ModelFetchInfo,
} from '@worldsea/agent-runtime'
import { useSettingsStore } from '../../stores/settingsStore'

export function useCloudModelFetch() {
  const settingsStore = useSettingsStore()

  // 模型下拉响应式版本号：刷新成功后自增，使 currentProviderModels 重新读取新缓存
  const modelVersion = ref(0)
  // 云端刷新中的 loading 状态
  const cloudFetching = ref(false)
  // 云端刷新失败提示
  const cloudFetchError = ref('')
  // 当前云端供应商模型下拉（静态合并 + 动态缓存），随 provider/刷新版本变化
  const currentProviderModels = computed(() => {
    void modelVersion.value
    return getModelsByProvider(settingsStore.aiCloudProvider)
  })
  // 缓存新鲜度（含 fetchedAt / isFresh / lastError），供 UI 显示「上次更新 X 前」
  const fetchInfo = computed(() => getLastModelFetchInfo(settingsStore.aiCloudProvider))

  /**
   * 主动刷新当前云端供应商模型列表（UI 手动刷新 / 切供应商时调用）。
   * provider 支持传参，避免异步期间 store 中的 provider 已切换导致拉错对象。
   */
  async function onRefreshCloudModels(provider: string = settingsStore.aiCloudProvider): Promise<ModelFetchInfo> {
    const manifest = getProviderManifest(provider)
    if (!manifest || manifest.supportsModelListing === false) {
      return { isFresh: false }
    }
    cloudFetching.value = true
    cloudFetchError.value = ''
    try {
      const key = await loadApiKey(provider)
      const models = await refreshModels(provider, key || undefined)
      if (models.length > 0) {
        modelVersion.value++
      } else {
        cloudFetchError.value = '拉取失败，已保留上次成功缓存'
      }
    } catch {
      cloudFetchError.value = '拉取失败，已保留上次成功缓存'
    } finally {
      cloudFetching.value = false
    }
    return getLastModelFetchInfo(provider)
  }

  return { currentProviderModels, cloudFetching, cloudFetchError, fetchInfo, onRefreshCloudModels }
}

/** 格式化「上次更新 X 前」新鲜度文案（供 ModelPanel / ProviderPanel 展示 fetchedAt） */
export function formatModelFresh(ms?: number): string {
  if (!ms) return ''
  const mins = Math.floor((Date.now() - ms) / 60000)
  if (mins < 1) return '上次更新：刚刚'
  if (mins < 60) return `上次更新：${mins} 分钟前`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `上次更新：${hrs} 小时前`
  return `上次更新：${Math.floor(hrs / 24)} 天前`
}

export type UseCloudModelFetchReturn = ReturnType<typeof useCloudModelFetch>