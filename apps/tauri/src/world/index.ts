/**
 * 第二棵树（世界语义）的模块入口（B/C2，2026-09-25）。
 * 调用方：工作台入口 `apps/tauri/workspace/main.ts`。
 *
 * 应用侧职责（这三条属「应用级」——树本身不认 pinia/代理面，保持可独立测试）：
 * ① **启停来源** = 芽清单（`settingsStore.isActive`）：起树时过滤 + 订阅变化做**真启停**；
 * ② 开发期热重载：本模块自接受 HMR（更新即拆树→重起）。
 */
export { startWorldTree, disposeWorldTree, worldTreeState, worldTreeContext, availablePlugins, setPluginEnabled, unloadPlugin, WORLD_SERVICES, reloadExternalPlugins, externalPluginStates, setExternalProjectDirProvider } from './tree'
export type { WorldTreeHandle, WorldTreeState, StartOptions, ExternalReloadReport, ExternalPluginState } from './tree'
export { validateManifest } from './manifest'
export type { WorldPlugin, WorldPluginManifest } from './manifest'
export { assemblePlugins, collectWorldPlugins } from './loader'
export type { AssembleResult, LoadReport } from './loader'
export { registerViewFor, unregisterViewFor, registerPluginCleanup, runPluginCleanups } from './registry'
export { createPluginApi } from './api'
export type { WorldPluginApi } from './api'
export { registerModule, unregisterModule, createRequire, registeredModuleNames } from './modules'
export { evaluateExternalPlugin, collectExternalPlugins, externalPluginsDir, EXTERNAL_ID_PREFIX, EXTERNAL_PLUGIN_DIR } from './external'
export type { ExternalEvalResult, ExternalCollectReport, ExternalIo } from './external'

import { isViewVisible, onPluginDirChange, useEntityStore, useSettingsStore } from '@worldsea/entity-core'
import { watch } from 'vue'

import { disposeWorldTree, externalPluginStates, reloadExternalPlugins, setPluginEnabled, startWorldTree, worldTreeState } from './tree'

/** 外部插件装载结果 → sprouts 对账条目（manifest 真值 + 持久化 active）。
 *  utility 身份的外部插件不进清单（常驻装载，无启停——批5 对齐内置口径）。 */
function externalSproutEntries(): Array<{ id: string; label: string; icon: string; active: boolean }> {
  const settings = useSettingsStore()
  return externalPluginStates()
    .filter(state => state.status !== 'rejected' && state.kind !== 'utility')
    .map(state => ({
      id: state.id,
      label: state.name,
      icon: 'puzzle',
      // 用户开关以 sprouts 持久化为准；新插件缺省 true
      active: settings.sprouts.find(sprout => sprout.id === state.id)?.active ?? true,
    }))
}

/** 起树 + 接线（幂等）。 */
export async function installWorldTree(): Promise<void> {
  const settings = useSettingsStore()
  // 启停来源 = 芽清单；**清单外的树插件视为启用**（现全部插件均在清单内；`ws.spike.panel` 示例插件已于 2026-09-27 退场，git 有档）——
  // 与侧栏可见性共用同一口径（`isViewVisible`），避免两处规则漂移。
  await startWorldTree({ isEnabled: id => isViewVisible(id) })

  // 【装载对账 · 2026-10-12】首次 loadAll（App onMounted → projectSwitcher.initialize）与本树
  // 的插件 apply 是竞态，且 loadAll 几乎必赢（插件经动态 import 装配）——per-type 装载归一器
  // （IngestNormalizers，芽 apply 时注册）注册晚于装载时，已入 store 的实体保持原始形态
  // （实测：notebook 的 md 正文不渲染，2026-10-11 走查）。树就绪后补一次全量对账：
  // loadAll 幂等且统一走装载网关（sanitize → normalizeIngestEntity），此处重读仅替换引用，
  // 编辑器内容不受影响（by-id watch 不重载，自动保存回流契约保持）。
  try {
    await useEntityStore().loadAll()
  } catch (err) {
    console.warn('[world-tree] 装载对账失败（下次 watcher/能力桥 reload 会再归一）:', err)
  }

  // 外部插件对账进芽清单（label/icon = manifest 真值；独立键持久化跨启动留存）
  settings.syncExternalSprouts(externalSproutEntries())

  // 真启停：芽清单开关变化 → 动态装/卸（`sprouts` 是项目级数据，切换项目会整体重载）
  watch(
    () => settings.sprouts.map(sprout => `${sprout.id}:${sprout.active}`).join('|'),
    () => {
      for (const sprout of settings.sprouts) setPluginEnabled(sprout.id, isViewVisible(sprout.id))
    },
  )

  // 外部插件热装载：watcher 感知 `.worldsea/plugins/` 变化（防抖 1s）→ 重对账 → 清单对账
  onPluginDirChange(() => {
    if (!worldTreeState().started) return
    void reloadExternalPlugins()
      .then(report => {
        if (report.added.length + report.updated.length + report.removed.length > 0 || report.rejected.length > 0) {
          settings.syncExternalSprouts(externalSproutEntries())
        }
      })
      .catch(err => console.warn('[world-tree] 外部重对账失败:', err))
  })
}

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    disposeWorldTree()
    void installWorldTree().then(() => console.log('[world-tree] reload 完成'))
  })
}
