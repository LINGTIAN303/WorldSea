/** useModelFetchWatcher：settingsStore 全局 watch —— 切换供应商 / Provider 模式时自动拉取云端模型列表。
 *
 *  背景：之前切供应商触发的模型拉取只存在于设置面板内部（ProviderPanel / ModelPanel 的 useCloudModelFetch），
 *  面板未挂载时（如 ModelSwitcher 切供应商）无法触发。本模块在应用入口安装一次模块级 watch，
 *  无论从哪个 UI 切换供应商，只要配置了对应 API Key 就自动后台刷新模型缓存。
 *
 *  注意：settingsStore 位于 entity-core 共享抽象层，不导入 agent-runtime（避免跨层耦合），
 *  故本 watch 落在 tauri 应用层（跟随 preloadSupportingModels 在 main.ts 安装）。
 */
import { watch } from 'vue'
import { useSettingsStore } from '../../stores/settingsStore'
import { getProviderManifest, refreshModels, loadApiKey } from '@worldsea/agent-runtime'

/** 模块级安装标记：全局 watch 只允许安装一次，防止 HMR 或重复调用产生多份 watcher */
let installed = false

export function installModelFetchWatcher(): void {
  if (installed) return
  installed = true

  const settingsStore = useSettingsStore()

  watch(
    () => [settingsStore.aiProviderMode, settingsStore.aiCloudProvider] as const,
    async ([mode, provider]) => {
      // 仅云端模式下需要动态拉取；本地/自定义走各自面板逻辑
      if (mode !== 'cloud') return
      const manifest = getProviderManifest(provider)
      if (!manifest || manifest.supportsModelListing === false) return
      const key = await loadApiKey(provider).catch(() => '' as string)
      if (!key) return // 未配置 key：跳过，避免无谓请求（后续填 key 由面板内部逻辑触发）
      // 后台刷新，失败由 refreshModels 内部保留旧缓存，静默
      try {
        await refreshModels(provider, key)
      } catch {
        // fire-and-forget：失败不影响切换流程
      }
    },
    { flush: 'post' },
  )
}