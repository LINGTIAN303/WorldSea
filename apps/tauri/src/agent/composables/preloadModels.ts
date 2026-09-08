/** 启动预拉：应用挂载后，对所有支持 /v1/models 动态拉取的供应商后台刷新模型缓存（fire-and-forget，不阻塞首屏） */
import { getAllProviderManifests, refreshModels, loadApiKey } from '@worldsea/agent-runtime'

/**
 * 预拉所有支持模型列表的供应商。仅在已配置 API Key 的供应商上发起请求，
 * 拉取结果写入 localStorage 缓存；失败静默（保留旧缓存），不影响启动。
 */
export function preloadSupportingModels(): void {
  const providers = getAllProviderManifests()
    .filter(m => m.supportsModelListing !== false)
    .map(m => m.id)

  for (const provider of providers) {
    // 逐个后台异步，不 await，避免阻塞启动流程
    void (async () => {
      try {
        const key = await loadApiKey(provider)
        if (!key) return // 未配置 key 的供应商跳过
        await refreshModels(provider, key)
      } catch {
        // 静默失败：网络异常等不影响启动，旧缓存仍被保留
      }
    })()
  }
}