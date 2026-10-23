/**
 * 首页 → 工作台的**单点导航**（2026-10-23 产品域首页）。
 *
 * 首页卡片/CTA 只调用本组合器，不各自拼 store 动作：
 * - `openHome`：回项目扉页（保留 currentView，供再次进入时恢复）；
 * - `openWorkspace`：解析目标视图（显式 viewId → 当前可见 currentView → 上次视图/侧栏首项），
 *   有 entityId 时写导航挂起位并派发 `ws-select-entity`，成功后切到 workspace 表面。
 */
import { nextTick } from 'vue'
import { usePluginStore, useUIStore } from '@worldsea/entity-core'
// readLastViewId 只从 stores 子路径导出（entity-core 根入口未聚合），与 boot.ts 同源
import { readLastViewId } from '@worldsea/entity-core/stores/uiStore'
import { toastWarn } from '@worldsea/ui-kit'
import { resolveDefaultViewId, visibleViewsInSidebarOrder } from '@/ui/layout/sidebar/viewOrder'

export function useHomeNavigation() {
  const ui = useUIStore()
  const plugins = usePluginStore()

  function openHome() {
    ui.openHome()
  }

  /**
   * 进入工作台；无可用视图时不切面并返回 false。
   * 目标解析优先级：显式 viewId（须已注册）→ 当前可见视图 → 上次视图/侧栏首项。
   */
  function openWorkspace(viewId?: string, entityId?: string): boolean {
    const visible = visibleViewsInSidebarOrder()
    const preferred = viewId && plugins.getView(viewId)
      ? viewId
      : ui.currentView && visible.some(v => v.id === ui.currentView)
        ? ui.currentView
        : resolveDefaultViewId(visible, readLastViewId())
    const view = preferred ? plugins.getView(preferred) : undefined
    if (!preferred || !view) {
      toastWarn('没有可用视图，请先在设置中启用芽')
      return false
    }
    ui.setView(preferred)
    ui.viewComponent = view.component
    if (entityId) {
      ui.selectEntity(entityId)
      window.dispatchEvent(new CustomEvent('ws-select-entity', { detail: { entityId } }))
    }
    ui.setSurface('workspace')
    // 焦点交接到主内容区（设计 §3.4）：#main-content 由 ShellSurface 承载，等切面渲染完再聚焦
    void nextTick(() => document.getElementById('main-content')?.focus())
    return true
  }

  return { openHome, openWorkspace }
}
