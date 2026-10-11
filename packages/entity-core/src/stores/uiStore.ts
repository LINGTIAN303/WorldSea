import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import type { Component } from 'vue'
import { watchDebounced } from '@worldsea/perf-kit/render'

const STORAGE_KEY = 'worldsea_sidebar_order'
const LAST_VIEW_KEY = 'worldsea_last_view'

/** 上次查看的视图 id（冷启动恢复用；经 `setView` 落盘，见下）。
 *  空视图是「视图列表未就绪」瞬态（SidebarV2 空列表分支），`setView('')` 不清记忆。 */
export function readLastViewId(): string | null {
  try {
    return localStorage.getItem(LAST_VIEW_KEY)
  } catch {
    return null
  }
}

function loadOrder(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveOrder(order: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(order))
  } catch { /* quota exceeded, 静默 */ }
}

export const useUIStore = defineStore('ui', () => {
  const currentView = ref<string | null>(null)
  /**
   * 导航选中挂起位（2026-10-08 语义复活）：`ws-navigate` 跨视图跳转写入，
   * 目标视图挂载时读回（挂载晚于事件派发，见 Shell.onWsNavigate）；`setView` 会清空。
   */
  const selectedEntityId = ref<string | null>(null)
  const sidebarCollapsed = ref(false)
  const menuOpen = ref(false)
  const viewComponent = shallowRef<Component | null>(null)
  const viewRefreshKey = ref(0)
  const _jumpBackViewId = ref<string | null>(null)

  const sidebarOrder = ref<string[]>(loadOrder())

  // 自动持久化（防抖替代 deep watch）
  watchDebounced(() => sidebarOrder.value, () => saveOrder(sidebarOrder.value), { debounce: 100, deep: true })

  function setView(viewId: string) {
    currentView.value = viewId
    selectedEntityId.value = null
    if (viewId) {
      try {
        localStorage.setItem(LAST_VIEW_KEY, viewId)
      } catch { /* quota exceeded, 静默 */ }
    }
  }

  function selectEntity(id: string | null) {
    selectedEntityId.value = id
  }

  function toggleSidebar() {
    sidebarCollapsed.value = !sidebarCollapsed.value
  }

  function toggleMenu() {
    menuOpen.value = !menuOpen.value
  }

  /**
   * 将新视图 ID 加入排序末尾（如果尚未存在）
   */
  function ensureViewInOrder(viewId: string) {
    if (!sidebarOrder.value.includes(viewId)) {
      sidebarOrder.value.push(viewId)
    }
  }

  /**
   * 拖拽移动：将 fromIndex 位置的项移到 toIndex
   */
  function moveSidebarItemById(fromId: string, toId: string) {
    const order = [...sidebarOrder.value]
    // 确保两个 ID 都在 order 中
    if (!order.includes(fromId)) order.push(fromId)
    const fromIdx = order.indexOf(fromId)
    const toIdx = order.indexOf(toId)
    if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return
    const [moved] = order.splice(fromIdx, 1)
    order.splice(toIdx, 0, moved)
    sidebarOrder.value = order
  }

  /* ── 启动状态（Splash Screen 生命周期）── */
  const bootState = ref<'booting' | 'ready' | 'error'>('booting')
  /** 启动失败时的错误信息（仅 bootState === 'error' 时有值） */
  const bootError = ref<{ failedModules: Array<{ id: string; name: string; error: string }>; skippedModules: Array<{ id: string; reason: string }> } | null>(null)

  function markReady() {
    bootState.value = 'ready'
  }

  /**
   * 标记启动失败，进入错误页状态。
   * @param failedModules 失败的 critical 模块列表
   * @param skippedModules 被跳过的模块列表（可选，用于展示）
   */
  function markBootError(
    failedModules: Array<{ id: string; name: string; error: string }>,
    skippedModules: Array<{ id: string; reason: string }> = [],
  ) {
    bootError.value = { failedModules, skippedModules }
    bootState.value = 'error'
  }

  /** 从错误状态恢复到就绪（用户点击"继续"或"重试"后调用） */
  function recoverFromError() {
    bootError.value = null
    bootState.value = 'ready'
  }

  return {
    currentView,
    selectedEntityId,
    sidebarCollapsed,
    menuOpen,
    viewComponent,
    viewRefreshKey,
    _jumpBackViewId,
    sidebarOrder,
    setView,
    selectEntity,
    toggleSidebar,
    toggleMenu,
    ensureViewInOrder,
    moveSidebarItemById,
    bootState,
    bootError,
    markReady,
    markBootError,
    recoverFromError,
  }
})
