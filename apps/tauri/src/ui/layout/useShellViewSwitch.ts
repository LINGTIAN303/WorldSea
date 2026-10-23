/**
 * 工作台视图顺序切换（Ctrl+↑/↓）的唯一入口（2026-10-23 产品域首页，抽自 Shell 便于直测）。
 *
 * 两条既有口径原样保留：
 * - 顺序取 `visibleViewsInSidebarOrder()`（与侧栏同一份），本文件不重排；
 * - 只在 `surface === 'workspace'` 时生效——首页（默认表面）按键返回 false 且不改
 *   currentView / viewComponent（设计 §3.4：首页下快捷键不得静默改底层视图/数据）。
 */
import { useUIStore } from '@worldsea/entity-core'
import { visibleViewsInSidebarOrder } from './sidebar/viewOrder'

export function useShellViewSwitch() {
  const ui = useUIStore()

  /** 按侧栏顺序移动 delta 步并切换视图；非工作台或无可见视图时不动作并返回 false。 */
  return function switchViewBy(delta: number): boolean {
    if (ui.surface !== 'workspace') return false
    const views = visibleViewsInSidebarOrder()
    if (views.length === 0) return false
    const idx = views.findIndex(v => v.id === ui.currentView)
    const next = ((idx === -1 ? 0 : idx + delta) + views.length) % views.length
    const v = views[next]
    if (!v) return false
    ui.setView(v.id)
    ui.viewComponent = v.component
    return true
  }
}
