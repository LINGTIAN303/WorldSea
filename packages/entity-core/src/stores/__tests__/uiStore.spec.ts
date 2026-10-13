/**
 * uiStore「上次视图」记忆（2026-10-09，工作台首屏缺陷修复）。
 * setView 是全部视图切换的落点（侧栏轮播/快捷键/跨视图跳转都经它）→ 在此落 `worldsea_last_view`，boot.ts 冷启动据此恢复；
 * `setView('')` 是「视图列表未就绪」瞬态（SidebarV2 空列表分支），不得清记忆——否则启动竞态会把记忆洗成空。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { readLastViewId, useUIStore } from '../uiStore'

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
