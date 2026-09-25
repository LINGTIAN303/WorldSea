/**
 * 第二棵树（世界语义）的模块入口（B，2026-09-25）。
 * 调用方：工作台入口 `apps/tauri/workspace/main.ts`（`startWorldTree()`）。
 * 开发期热重载：本模块自接受 HMR——更新即「拆树 → 重起」（不做单插件热替换，留后续）。
 */
export { startWorldTree, disposeWorldTree, worldTreeState, worldTreeContext, WORLD_SERVICES } from './tree'
export type { WorldTreeHandle, WorldTreeState } from './tree'
export { validateManifest } from './manifest'
export type { WorldPlugin, WorldPluginManifest } from './manifest'
export { assemblePlugins, collectWorldPlugins } from './loader'
export type { AssembleResult, LoadReport } from './loader'
export { registerViewFor, unregisterViewFor, registerPluginCleanup, runPluginCleanups } from './registry'

import { disposeWorldTree, startWorldTree } from './tree'

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    disposeWorldTree()
    void startWorldTree().then(handle => {
      console.log(`[world-tree] reload 完成：${handle.plugins.length} 个插件`)
    })
  })
}
