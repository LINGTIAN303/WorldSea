/**
 * 视图生命周期装配（D，2026-09-25）：把**真源** `pluginAPI` 的视图变更镜像到显示侧。
 *
 * 此前是「单向 + 一次性」：`bootstrap` 给 PluginManager 装 viewHook，只在 activate 时推一次 →
 * deactivate / 反注册 / 清空都不回写 store，侧栏会留幽灵项；各调用点只好各写一套同步
 * （useProjectSwitcher 全量重灌 / 各注册方手动补写 / Spike 过滤数组）。
 *
 * 现在收敛为**一个订阅**：真源派发 → store 增删 + 侧栏顺序补齐。
 * 两条刻意不做的（见批计划 §一）：
 * - **不删 `sidebarOrder` 项**：那是用户排序偏好，视图缺席本就不渲染，删了反丢排序；
 * - **不夺当前选中**：`viewComponent` 是组件引用、面板不会崩；夺选中会破坏项目切换的选中保持，
 *   且属用户可见路径变更（要「删视图即切走」应由删除方显式 `uiStore.setView(...)`）。
 */
import { pluginAPI, usePluginStore, useUIStore } from '@worldsea/entity-core'

let off: (() => void) | null = null

/** 装配视图同步（幂等：多次调用复用同一订阅）。返回退订函数（测试与反证用）。 */
export function installViewSynchronizer(): () => void {
  if (off) return off
  const store = usePluginStore()
  const ui = useUIStore()
  off = pluginAPI.onViewChange(change => {
    if (change.kind === 'registered') {
      store.registerView(change.view)
      ui.ensureViewInOrder(change.view.id)
      return
    }
    store.unregisterView(change.view.id)
  })
  // 装配时**对账一次**：订阅之前已注册的视图（如第二棵树在启动早期注册的）一并补进显示侧。
  reconcileViewMirror()
  return off
}

/** 真源 → 显示侧对账（装配时与脱附后恢复时用）。 */
function reconcileViewMirror(): void {
  const store = usePluginStore()
  const ui = useUIStore()
  const truth = pluginAPI.getViews()
  for (const view of truth) {
    store.registerView(view)
    ui.ensureViewInOrder(view.id)
  }
  for (const view of [...store.views]) {
    if (!truth.some(entry => entry.id === view.id)) store.unregisterView(view.id)
  }
}

/** 退订（仅供测试与反证：退订后真源变更不再镜像）。 */
export function uninstallViewSynchronizer(): void {
  off?.()
  off = null
}
