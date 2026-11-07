/**
 * uiStore「上次视图」记忆（2026-10-09，工作台首屏缺陷修复）。
 * setView 是全部视图切换的落点（侧栏轮播/快捷键/跨视图跳转都经它）→ 在此落 `worldsea_last_view`，boot.ts 冷启动据此恢复；
 * `setView('')` 是「视图列表未就绪」瞬态（SidebarV2 空列表分支），不得清记忆——否则启动竞态会把记忆洗成空。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick, reactive } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { normalizeSplitSidebarOrder, readLastViewId, useUIStore } from '../uiStore'

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

describe('uiStore / 上次视图记忆', () => {
  it('setView 落盘；readLastViewId 读回', () => {
    useUIStore().setView('timeline')
    expect(localStorage.getItem('worldsea_last_view')).toBe('timeline')
    expect(readLastViewId()).toBe('timeline')
  })

  it("空白 setView('') 不清记忆（视图未就绪瞬态）", () => {
    const ui = useUIStore()
    ui.setView('characters')
    ui.setView('')
    expect(readLastViewId()).toBe('characters')
  })

  it('无记录时 readLastViewId 为 null', () => {
    expect(readLastViewId()).toBeNull()
  })
})

describe('uiStore / 启动阶段', () => {
  it('阶段推进与 ready 同步；错误/恢复同步 bootStage', () => {
    const ui = useUIStore()
    expect(ui.bootStage).toBe('backend')
    ui.setBootStage('project')
    expect(ui.bootStage).toBe('project')
    ui.markReady()
    expect(ui.bootState).toBe('ready')
    expect(ui.bootStage).toBe('ready')
    ui.markBootError([{ id: 'boot', name: '启动', error: 'x' }])
    expect(ui.bootState).toBe('error')
    expect(ui.bootStage).toBe('error')
    expect(ui.bootError?.failedModules).toHaveLength(1)
    ui.recoverFromError()
    expect(ui.bootState).toBe('ready')
    expect(ui.bootStage).toBe('ready')
    expect(ui.bootError).toBeNull()
  })
})

describe('uiStore / R3-c 侧栏偏好', () => {
  it('默认：域左芽右、独立收起、轮盘与徽章开启', () => {
    const ui = useUIStore()
    expect(ui.splitSidebarOrder).toBe('domain-left')
    expect(ui.splitSyncCollapse).toBe(false)
    expect(ui.sproutWheelEnabled).toBe(true)
    expect(ui.sproutCountEnabled).toBe(true)
    expect(normalizeSplitSidebarOrder('unknown')).toBe('domain-left')
    expect(normalizeSplitSidebarOrder('sprout-left')).toBe('sprout-left')
  })

  it('split + 同步收起开启时，任一侧切换都带动另一侧', () => {
    const ui = useUIStore()
    ui.sproutNavMode = 'split'
    ui.splitSyncCollapse = true
    ui.toggleSidebar()
    expect(ui.sidebarCollapsed).toBe(true)
    expect(ui.domainSidebarCollapsed).toBe(true)
    ui.toggleDomainSidebar()
    expect(ui.domainSidebarCollapsed).toBe(false)
    expect(ui.sidebarCollapsed).toBe(false)
  })

  it('同步关闭时两侧独立', () => {
    const ui = useUIStore()
    ui.sproutNavMode = 'split'
    ui.toggleDomainSidebar()
    expect(ui.domainSidebarCollapsed).toBe(true)
    expect(ui.sidebarCollapsed).toBe(false)
  })

  it('轮盘/徽章开关落盘并读回', async () => {
    const ui = useUIStore()
    ui.sproutWheelEnabled = false
    ui.sproutCountEnabled = false
    await nextTick()
    setActivePinia(createPinia())
    const next = useUIStore()
    expect(next.sproutWheelEnabled).toBe(false)
    expect(next.sproutCountEnabled).toBe(false)
  })
})

describe('uiStore / 产品域表面', () => {
  it('默认 surface=home；setSurface 切换；openHome 不清 currentView', () => {
    const ui = useUIStore()
    expect(ui.surface).toBe('home')
    ui.setView('characters')
    ui.setSurface('workspace')
    expect(ui.surface).toBe('workspace')
    ui.openHome()
    expect(ui.surface).toBe('home')
    expect(ui.currentView).toBe('characters')
  })
})

/**
 * `viewComponent` 此前全靠调用方在 `setView()` 后手动成对赋值（全仓 13 处同一模式），
 * 漏写会落到 `ViewContainer` 的兜底解析——结果虽同，却多一条隐性契约。
 * 收敛为 `showView` / `clearView` 后由 store 保证一致性。
 */
describe('uiStore / showView 与 clearView（组件缓存收敛）', () => {
  const CompA = { name: 'CompA', render: () => null }
  const CompB = { name: 'CompB', render: () => null }

  it('showView 同时设 currentView 与 viewComponent', () => {
    const ui = useUIStore()
    ui.showView({ id: 'timeline', component: CompA })
    expect(ui.currentView).toBe('timeline')
    expect(ui.viewComponent).toBe(CompA)
  })

  it('showView 落盘上次视图（与 setView 同口径）', () => {
    useUIStore().showView({ id: 'codex', component: CompA })
    expect(readLastViewId()).toBe('codex')
  })

  it('showView 清空 selectedEntityId（与 setView 同口径）', () => {
    const ui = useUIStore()
    ui.selectEntity('e1')
    ui.showView({ id: 'codex', component: CompA })
    expect(ui.selectedEntityId).toBeNull()
  })

  it('clearView 同时清 currentView 与 viewComponent', () => {
    const ui = useUIStore()
    ui.showView({ id: 'timeline', component: CompA })
    ui.clearView()
    expect(ui.currentView).toBe('')
    // 关键：不清组件缓存的话，ViewContainer 会优先取到旧组件
    expect(ui.viewComponent).toBeNull()
  })

  it('clearView 不清「上次视图」记忆（视图未就绪瞬态）', () => {
    const ui = useUIStore()
    ui.showView({ id: 'characters', component: CompA })
    ui.clearView()
    expect(readLastViewId()).toBe('characters')
  })

  it('连续 showView 换组件不残留旧值', () => {
    const ui = useUIStore()
    ui.showView({ id: 'a', component: CompA })
    ui.showView({ id: 'b', component: CompB })
    expect(ui.viewComponent).toBe(CompB)
    expect(ui.currentView).toBe('b')
  })

  /**
   * 调用方常从 `pluginStore.views`（pinia 深代理数组）取 view，其上 `.component` 会读出
   * **代理对象**而非原组件。缓存原对象，否则依赖 `is` 比较/引用判等的地方会失真
   * （`boot.spec` 的「并带上组件」用例即靠此严格相等）。
   */
  it('传入代理对象时缓存的是原组件（toRaw）', () => {
    const ui = useUIStore()
    const raw = { name: 'Raw' }
    const proxied = reactive({ id: 'x', component: raw })
    ui.showView(proxied)
    expect(ui.viewComponent).toBe(raw)
    expect(ui.viewComponent).not.toBe(proxied.component)
  })
})
