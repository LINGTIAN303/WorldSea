import { defineStore } from 'pinia'
import { ref, shallowRef, toRaw, watch } from 'vue'
import type { Component } from 'vue'
import { watchDebounced } from '@worldsea/perf-kit/render'
import { isSproutDomain, type SproutDomainId } from '../core/sproutDomains'

const STORAGE_KEY = 'worldsea_sidebar_order'
const LAST_VIEW_KEY = 'worldsea_last_view'
const SPROUT_NAV_MODE_KEY = 'worldsea_sprout_nav_mode'
const SPROUT_DOMAIN_FILTER_KEY = 'worldsea_sprout_domain_filter'
const SPROUT_WHEEL_KEY = 'worldsea_sprout_wheel_enabled'
const SPROUT_COUNT_KEY = 'worldsea_sprout_count_enabled'
const SPLIT_ORDER_KEY = 'worldsea_split_sidebar_order'
const SPLIT_SYNC_COLLAPSE_KEY = 'worldsea_split_sync_collapse'

export type SproutNavMode = 'flat' | 'popover' | 'rail' | 'tabs' | 'dual' | 'split'
export type SproutDomainFilter = 'all' | SproutDomainId
export type SplitSidebarOrder = 'domain-left' | 'sprout-left'
/** 产品域表面：home=项目扉页（壳级），workspace=芽侧栏+工具条+视图。不落盘，冷启动恒 home。 */
export type Surface = 'home' | 'workspace'
export interface SettingsTarget {
  section: string
  card?: number
}

export const SPROUT_NAV_MODES: readonly SproutNavMode[] = ['flat', 'popover', 'rail', 'tabs', 'dual', 'split']

export function normalizeSplitSidebarOrder(value: unknown): SplitSidebarOrder {
  return value === 'sprout-left' ? 'sprout-left' : 'domain-left'
}

export function normalizeSproutNavMode(value: unknown): SproutNavMode {
  return typeof value === 'string' && (SPROUT_NAV_MODES as readonly string[]).includes(value)
    ? value as SproutNavMode
    : 'flat'
}

export function normalizeSproutDomainFilter(value: unknown): SproutDomainFilter {
  if (value === 'all') return 'all'
  return typeof value === 'string' && isSproutDomain(value) ? value as SproutDomainId : 'all'
}

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

function loadSproutNavMode(): SproutNavMode {
  try {
    return normalizeSproutNavMode(localStorage.getItem(SPROUT_NAV_MODE_KEY))
  } catch {
    return 'flat'
  }
}

function saveSproutNavMode(mode: SproutNavMode) {
  try {
    localStorage.setItem(SPROUT_NAV_MODE_KEY, mode)
  } catch { /* quota exceeded, 静默 */ }
}

function loadSproutDomainFilter(): SproutDomainFilter {
  try {
    return normalizeSproutDomainFilter(localStorage.getItem(SPROUT_DOMAIN_FILTER_KEY))
  } catch {
    return 'all'
  }
}

function saveSproutDomainFilter(filter: SproutDomainFilter) {
  try {
    localStorage.setItem(SPROUT_DOMAIN_FILTER_KEY, filter)
  } catch { /* quota exceeded, 静默 */ }
}

function loadBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : raw !== 'false'
  } catch {
    return fallback
  }
}

function saveBool(key: string, value: boolean) {
  try {
    localStorage.setItem(key, String(value))
  } catch { /* quota exceeded, 静默 */ }
}

function loadSplitSidebarOrder(): SplitSidebarOrder {
  try {
    return normalizeSplitSidebarOrder(localStorage.getItem(SPLIT_ORDER_KEY))
  } catch {
    return 'domain-left'
  }
}

function saveSplitSidebarOrder(order: SplitSidebarOrder) {
  try {
    localStorage.setItem(SPLIT_ORDER_KEY, order)
  } catch { /* quota exceeded, 静默 */ }
}

export const useUIStore = defineStore('ui', () => {
  const currentView = ref<string | null>(null)
  /* ── 产品域表面（壳级状态，不落盘）── */
  const surface = ref<Surface>('home')

  function setSurface(next: Surface) {
    surface.value = next
  }

  /** 回项目扉页；保留 currentView，供从扉页再次进入工作区时恢复 */
  function openHome() {
    surface.value = 'home'
  }

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
  /** 打开设置后的落点（由快捷区等入口写入；SettingsDialog 消费后清空）。 */
  const settingsTarget = ref<SettingsTarget | null>(null)

  const sidebarOrder = ref<string[]>(loadOrder())

  // 自动持久化（防抖替代 deep watch）
  watchDebounced(() => sidebarOrder.value, () => saveOrder(sidebarOrder.value), { debounce: 100, deep: true })

  /* ── 芽导航形态（R3-a）：单侧栏 1–4 形态 + 域过滤 ── */
  const sproutNavMode = ref<SproutNavMode>(loadSproutNavMode())
  const sproutDomainFilter = ref<SproutDomainFilter>(loadSproutDomainFilter())
  watch(sproutNavMode, mode => saveSproutNavMode(mode))
  watch(sproutDomainFilter, filter => saveSproutDomainFilter(normalizeSproutDomainFilter(filter)))

  /* ── 芽导航偏好（R3-c）：轮盘、实体徽章、左右侧栏顺序与收起 ── */
  const sproutWheelEnabled = ref(loadBool(SPROUT_WHEEL_KEY, true))
  const sproutCountEnabled = ref(loadBool(SPROUT_COUNT_KEY, true))
  const splitSidebarOrder = ref<SplitSidebarOrder>(loadSplitSidebarOrder())
  const splitSyncCollapse = ref(loadBool(SPLIT_SYNC_COLLAPSE_KEY, false))
  /** 左右侧栏的域栏收起态；与芽栏的 sidebarCollapsed 独立，同步开关开启时联动 */
  const domainSidebarCollapsed = ref(false)
  watch(sproutWheelEnabled, value => saveBool(SPROUT_WHEEL_KEY, value))
  watch(sproutCountEnabled, value => saveBool(SPROUT_COUNT_KEY, value))
  watch(splitSidebarOrder, order => saveSplitSidebarOrder(order))
  watch(splitSyncCollapse, value => saveBool(SPLIT_SYNC_COLLAPSE_KEY, value))
  watch([splitSyncCollapse, sproutNavMode], ([sync, mode]) => {
    if (sync && mode === 'split') domainSidebarCollapsed.value = sidebarCollapsed.value
  })

  function setView(viewId: string) {
    currentView.value = viewId
    selectedEntityId.value = null
    if (viewId) {
      try {
        localStorage.setItem(LAST_VIEW_KEY, viewId)
      } catch { /* quota exceeded, 静默 */ }
    }
  }

  /**
   * 切视图并同时指定其组件。
   *
   * 为什么需要它：`viewComponent` 是 `currentView` 的派生缓存，但调用方此前必须在
   * `setView()` 之后手动成对赋值（全仓 13 处同一模式），漏写就会让 `ViewContainer`
   * 落到兜底解析——两边结果虽同，却多出一条隐性契约。收敛在此后调用方只写一次。
   *
   * 参数取 `{ id, component }` 而非 `PluginView`：本 store 不依赖 pluginStore（避免成环），
   * 也不该知道视图还有 label/icon 等无关字段。
   */
  function showView(view: { id: string; component: Component }) {
    // `toRaw`：调用方常从 pinia 的深代理数组（`pluginStore.views`）取 view，其上
    // `.component` 会被读取为代理对象；缓存原对象可避免后续 `is` 比较与 Vue 复用判定失真。
    viewComponent.value = toRaw(view.component)
    setView(view.id)
  }

  /** 清空当前视图（无可用视图时）。同步清组件缓存，避免残留旧视图被 `ViewContainer` 优先取用。 */
  function clearView() {
    viewComponent.value = null
    setView('')
  }

  function selectEntity(id: string | null) {
    selectedEntityId.value = id
  }

  function toggleSidebar() {
    sidebarCollapsed.value = !sidebarCollapsed.value
    if (sproutNavMode.value === 'split' && splitSyncCollapse.value) {
      domainSidebarCollapsed.value = sidebarCollapsed.value
    }
  }

  /** 左右侧栏的域栏收起/展开；同步开关开启时带动芽栏。 */
  function toggleDomainSidebar() {
    domainSidebarCollapsed.value = !domainSidebarCollapsed.value
    if (sproutNavMode.value === 'split' && splitSyncCollapse.value) {
      sidebarCollapsed.value = domainSidebarCollapsed.value
    }
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
  /** 真实启动阶段：Splash 只负责展示，不再自行模拟进度 */
  const bootStage = ref<'backend' | 'project' | 'shell' | 'bridge' | 'agent' | 'ready' | 'error'>('backend')
  /** 启动失败时的错误信息（仅 bootState === 'error' 时有值） */
  const bootError = ref<{ failedModules: Array<{ id: string; name: string; error: string }>; skippedModules: Array<{ id: string; reason: string }> } | null>(null)

  function setBootStage(stage: 'backend' | 'project' | 'shell' | 'bridge' | 'agent' | 'ready' | 'error') {
    bootStage.value = stage
  }

  function markReady() {
    bootStage.value = 'ready'
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
    bootStage.value = 'error'
    bootState.value = 'error'
  }

  /** 从错误状态恢复到就绪（用户点击"继续"或"重试"后调用） */
  function recoverFromError() {
    bootError.value = null
    bootStage.value = 'ready'
    bootState.value = 'ready'
  }

  return {
    currentView,
    surface,
    setSurface,
    openHome,
    selectedEntityId,
    sidebarCollapsed,
    menuOpen,
    viewComponent,
    viewRefreshKey,
    _jumpBackViewId,
    settingsTarget,
    sidebarOrder,
    sproutNavMode,
    sproutDomainFilter,
    sproutWheelEnabled,
    sproutCountEnabled,
    splitSidebarOrder,
    splitSyncCollapse,
    domainSidebarCollapsed,
    setView,
    showView,
    clearView,
    selectEntity,
    toggleSidebar,
    toggleDomainSidebar,
    toggleMenu,
    ensureViewInOrder,
    moveSidebarItemById,
    bootState,
    bootStage,
    bootError,
    setBootStage,
    markReady,
    markBootError,
    recoverFromError,
  }
})
