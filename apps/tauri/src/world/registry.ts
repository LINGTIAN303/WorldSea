/**
 * 第二棵树（世界语义）的按插件**作用域注册面**（B，2026-09-25）。
 *
 * 修的旧病：`pluginAPI.currentPluginId` 是全局单值——任何注册都会把它覆写成「最后一次 activate
 * 的芽」，树插件若直接注册，视图/类型的 `pluginId` 会指向别人（Sidebar 按芽启停过滤时行为随机）。
 * 本模块把「以某插件身份注册」收敛成两个原语，全部走 `pluginAPI.withPluginScope`（进入备份、退出恢复）。
 */
import { pluginAPI } from '@worldsea/entity-core'
import type { PluginView } from '@worldsea/entity-core'

/** 以插件身份注册视图（`pluginId` 恒为该插件 id，不受全局值污染）。 */
export function registerViewFor(pluginId: string, view: PluginView): string {
  pluginAPI.withPluginScope(pluginId, () => pluginAPI.registerView(view))
  return pluginId
}

/** 反注册视图（真源派发事件，显示侧由 viewSync 镜像）。 */
export function unregisterViewFor(pluginId: string, viewId: string): boolean {
  return pluginAPI.withPluginScope(pluginId, () => pluginAPI.unregisterView(viewId))
}

/** 插件清理函数登记表（拆树时逐个执行；cordis `effect` 在本版本不保证 disposal 触发，故自持）。 */
const cleanups = new Map<string, Array<() => void>>()

export function registerPluginCleanup(pluginId: string, run: () => void): void {
  const list = cleanups.get(pluginId)
  if (list) list.push(run)
  else cleanups.set(pluginId, [run])
}

/** 执行某插件的清理（拆树用；执行后清表）。 */
export function runPluginCleanups(pluginId: string): void {
  const list = cleanups.get(pluginId)
  if (!list) return
  cleanups.delete(pluginId)
  for (const run of list) {
    try {
      run()
    } catch (error) {
      console.error(`[world-tree] 插件清理抛错（${pluginId}）：`, error)
    }
  }
}
