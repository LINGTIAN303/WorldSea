/**
 * 第二棵树的**开发期探针**（B，2026-09-25；自 Spike 文件迁出）。
 *
 * `globalThis.__WS_VIEWS_PROBE__`：视图生命周期三面快照（真源 / 显示侧镜像 / 侧栏顺序）+
 * 真源级注册/反注册 + 同步器脱附（反证「镜像由事件订阅驱动」）。`attach()` 会做一次双向对账。
 * 装载开关：`localStorage['ws:cordis-spike'] === '1'`（与工作台入口同一开关，默认 inert）。
 */
import { pluginAPI, usePluginStore } from '@worldsea/entity-core'
import type { PluginView } from '@worldsea/entity-core'
import { defineComponent, h, markRaw } from 'vue'

import { useUIStore } from '@/stores/uiStore'
import { installViewSynchronizer, uninstallViewSynchronizer } from '@/plugins/viewSync'

const PROBE_VIEW_ID = 'ws-d-probe'

const ProbeView = defineComponent({
  name: 'WsViewsProbeView',
  setup: () => () => h('div', { style: 'padding:24px' }, 'D 批探针视图（真源级注册/反注册用）'),
})

export interface ViewsProbe {
  snapshot(): { truth: string[]; mirror: string[]; order: string[]; currentView: string | null }
  register(id: string, label?: string): boolean
  unregister(id: string): boolean
  detach(): void
  attach(): void
}

/** 装配探针（幂等）。 */
export function installViewsProbe(): ViewsProbe {
  const existing = (globalThis as { __WS_VIEWS_PROBE__?: ViewsProbe }).__WS_VIEWS_PROBE__
  if (existing) return existing

  const probe: ViewsProbe = {
    snapshot() {
      return {
        truth: pluginAPI.getViews().map(view => view.id),
        mirror: usePluginStore().views.map(view => view.id),
        order: [...useUIStore().sidebarOrder],
        currentView: useUIStore().currentView,
      }
    },
    register(id: string, label?: string) {
      pluginAPI.withPluginScope('ws.dev.probe', () => {
        pluginAPI.registerView({ id, label: label ?? id, icon: 'bulb', component: markRaw(ProbeView) } as PluginView)
      })
      // 探针视图不归任何芽管：pluginId 留在 `ws.dev.probe` 上（settingsStore.isViewVisible 视为可见）
      return pluginAPI.getViews().some(entry => entry.id === id)
    },
    unregister(id: string) {
      return pluginAPI.unregisterView(id)
    },
    detach: () => {
      uninstallViewSynchronizer()
    },
    attach: () => {
      // 装配本身会对账一次（真源 → 显示侧），故脱附后恢复用同一入口即可
      installViewSynchronizer()
    },
  }
  ;(globalThis as { __WS_VIEWS_PROBE__?: ViewsProbe }).__WS_VIEWS_PROBE__ = probe
  console.log('[world-tree] 视图探针已装配（__WS_VIEWS_PROBE__）')
  return probe
}

export { PROBE_VIEW_ID }
