/**
 * 侧栏可见视图的**唯一顺序口径**（2026-10-01）。
 *
 * 修的病：此前两处各自为政——侧栏渲染用「isViewVisible 过滤 + sidebarOrder 排序」，
 * 而 Ctrl+↑/↓ 的视图切换（`Shell.vue` 的 `switchViewBy`）走的是 `pluginStore.views`
 * 的**注册顺序、且不过滤隐藏芽**。于是按键一次虽只走 1 步，但那一步常落在看不见的芽、
 * 或与侧栏视觉顺序无关的位置——观感即「切得太多 / 乱跳」。
 *
 * 口径收敛：**渲染与切换都从这里取**，两处不再各写一份。
 */
import { isViewVisible, usePluginStore } from '@worldsea/entity-core'
import type { PluginView } from '@worldsea/entity-core/types'

import { useUIStore } from '@/stores/uiStore'

/** 可见视图（已按用户拖拽顺序 `sidebarOrder` 排序；未登记的排最后并保持注册相对序）。 */
export function visibleViewsInSidebarOrder(): PluginView[] {
  const order = useUIStore().sidebarOrder
  const orderMap = new Map<string, number>()
  for (let i = 0; i < order.length; i++) orderMap.set(order[i], i)
  return usePluginStore().views
    .filter(view => isViewVisible(view.pluginId))
    .slice()
    .sort((a, b) => (orderMap.get(a.id) ?? 999) - (orderMap.get(b.id) ?? 999))
}
