/**
 * 视图可见性判定（B，2026-09-25）。
 *
 * 侧栏/设置此前各处直接写 `!v.pluginId || settingsStore.isActive(v.pluginId)`——这条口径
 * 只对「芽清单内的官方芽」成立；第二棵树（世界语义）的插件 id 不在清单里，
 * `isActive` 会给 false 而把树插件的视图**误隐藏**。本模块把口径收敛为一处：
 * 无归属 → 显示；清单内 → 按芽启停；**清单外 → 显示**（树插件的启停由树自己的装载决定）。
 */
import { useSettingsStore } from './settingsStore'

/** 该 id 是否由官方芽清单管理（只有清单内的 id 才有启停开关）。 */
export function hasSprout(id: string): boolean {
  return useSettingsStore().sprouts.some(p => p.id === id)
}

/** 视图是否应显示（侧栏与设置面板共用）。 */
export function isViewVisible(pluginId?: string): boolean {
  if (!pluginId) return true
  if (!hasSprout(pluginId)) return true
  return useSettingsStore().isActive(pluginId)
}
