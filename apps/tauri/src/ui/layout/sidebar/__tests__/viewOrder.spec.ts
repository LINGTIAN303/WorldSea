/**
 * 侧栏顺序口径 + 首屏默认挑选（2026-10-09，工作台首屏「总是服饰/装备」缺陷反证落库）。
 *
 * 病：boot.ts 默认视图用 `pluginStore.views[0]`（注册序＝装载器 `files.sort()` 字典序，
 * `apparel` 目录恰排第一 → 每次冷启动都落「服饰/装备」，且绕开本文件的侧栏单一口径）；
 * currentView 不落盘 → 每次启动重演。修复＝默认挑选收进本文件：优先恢复上次视图
 * （须仍在可见列表），否则侧栏首项。纯函数直测：不碰 store。
 */
import { describe, expect, it } from 'vitest'
import type { PluginView } from '@worldsea/entity-core'
import { resolveDefaultViewId } from '../viewOrder'

function view(id: string): PluginView {
  return { id, label: id, icon: 'bulb', component: {} as never }
}

const VIEWS = [view('characters'), view('timeline'), view('apparel')]

describe('resolveDefaultViewId', () => {
  it('空列表返回 null（视图未就绪，调用方不得设视图）', () => {
    expect(resolveDefaultViewId([], 'characters')).toBeNull()
  })

  it('有上次视图且仍在可见列表 → 恢复它（哪怕不是首项）', () => {
    expect(resolveDefaultViewId(VIEWS, 'apparel')).toBe('apparel')
  })

  it('无上次视图 → 侧栏首项', () => {
    expect(resolveDefaultViewId(VIEWS, null)).toBe('characters')
  })

  it('上次视图已失效（不在可见列表：被隐藏/删除）→ 侧栏首项', () => {
    expect(resolveDefaultViewId(VIEWS, 'ghost')).toBe('characters')
  })
})
