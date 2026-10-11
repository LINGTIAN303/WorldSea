/**
 * 第二棵树（世界语义）的模块入口（B/C2，2026-09-25）。
 * 调用方：工作台入口 `apps/tauri/workspace/main.ts`。
 *
 * 应用侧职责（这三条属「应用级」——树本身不认 pinia/代理面，保持可独立测试）：
 * ① **启停来源** = 芽清单（`settingsStore.isActive`）：起树时过滤 + 订阅变化做**真启停**；
 * ② 开发期热重载：本模块自接受 HMR（更新即拆树→重起）。
 */
export { startWorldTree, disposeWorldTree, worldTreeState, worldTreeContext, availablePlugins, setPluginEnabled, unloadPlugin, WORLD_SERVICES } from './tree'
export type { WorldTreeHandle, WorldTreeState, StartOptions } from './tree'
export { validateManifest } from './manifest'
export type { WorldPlugin, WorldPluginManifest } from './manifest'
export { assemblePlugins, collectWorldPlugins } from './loader'
export type { AssembleResult, LoadReport } from './loader'
export { registerViewFor, unregisterViewFor, registerPluginCleanup, runPluginCleanups } from './registry'
export { createPluginApi } from './api'
export type { WorldPluginApi } from './api'

import { isViewVisible, useSettingsStore } from '@worldsea/entity-core'
import { watch } from 'vue'

import { disposeWorldTree, setPluginEnabled, startWorldTree } from './tree'

/** 起树 + 接线（幂等）。 */
export async function installWorldTree(): Promise<void> {
  const settings = useSettingsStore()
  // 启停来源 = 芽清单；**清单外的树插件视为启用**（现全部插件均在清单内；`ws.spike.panel` 示例插件已于 2026-09-27 退场，git 有档）——
  // 与侧栏可见性共用同一口径（`isViewVisible`），避免两处规则漂移。
  await startWorldTree({ isEnabled: id => isViewVisible(id) })

  // 真启停：芽清单开关变化 → 动态装/卸（`sprouts` 是项目级数据，切换项目会整体重载）
  watch(
    () => settings.sprouts.map(sprout => `${sprout.id}:${sprout.active}`).join('|'),
    () => {
      for (const sprout of settings.sprouts) setPluginEnabled(sprout.id, isViewVisible(sprout.id))
    },
  )
}

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    disposeWorldTree()
    void installWorldTree().then(() => console.log('[world-tree] reload 完成'))
  })
}
