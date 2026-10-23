/**
 * uiStore「上次视图」记忆（2026-10-09，工作台首屏缺陷修复）。
 * setView 是全部视图切换的落点（侧栏轮播/快捷键/跨视图跳转都经它）→ 在此落 `worldsea_last_view`，boot.ts 冷启动据此恢复；
 * `setView('')` 是「视图列表未就绪」瞬态（SidebarV2 空列表分支），不得清记忆——否则启动竞态会把记忆洗成空。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
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
