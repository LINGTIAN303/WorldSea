/**
 * 第二棵树（世界语义）的模块入口（B/C2，2026-09-25）。
 * 调用方：工作台入口 `apps/tauri/workspace/main.ts`。
 *
 * 应用侧职责（这三条属「应用级」——树本身不认 pinia/代理面，保持可独立测试）：
 * ① **启停来源** = 芽清单（`settingsStore.isActive`）：起树时过滤 + 订阅变化做**真启停**；
 * ② **代理面登记**：把通过校验的插件清单（id/name/description）登记进 worldview 芽表
 *    （旧 bootstrap 的 `registerWorldviewSprout` 职责迁到这里）；
 * ③ 开发期热重载：本模块自接受 HMR（更新即拆树→重起）。
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

import { registerWorldviewSprout } from '@agent/index'
import { isViewVisible, useSettingsStore } from '@worldsea/entity-core'
import { watch } from 'vue'

import { availablePlugins, disposeWorldTree, setPluginEnabled, startWorldTree } from './tree'

/** 起树 + 接线（幂等）。 */
export async function installWorldTree(): Promise<void> {
  const settings = useSettingsStore()
  // 启停来源 = 芽清单；**清单外的树插件（如 ws.spike.panel；思维导图已于 C2 走查修正归回 `official.mindmap` 进启停清单）视为启用**——
  // 与侧栏可见性共用同一口径（`isViewVisible`），避免两处规则漂移。
  await startWorldTree({ isEnabled: id => isViewVisible(id) })

  // 代理面：worldview 芽表（id 为稳定键；name/description 随清单）
  for (const plugin of availablePlugins()) {
    registerWorldviewSprout({
      id: plugin.manifest.id,
      name: plugin.manifest.name,
      description: plugin.manifest.description,
    })
  }

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
