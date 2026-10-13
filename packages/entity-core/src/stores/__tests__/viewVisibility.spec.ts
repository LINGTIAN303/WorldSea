/**
 * 视图可见性判定：把「清单外 pluginId 视为可见」这条口径钉住。
 * 【为什么单独立这个 spec】此前侧栏/设置各自写 `!pluginId || isActive(pluginId)`——第二棵树的插件 id 不在官方芽清单里，isActive 恒 false → 树插件的视图被误隐藏；
 * 收敛到本模块后，语义由这两个用例守卫（含官方芽启停仍生效的反向断言）。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSettingsStore } from '../settingsStore'
import { hasSprout, isViewVisible } from '../viewVisibility'

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

describe('isViewVisible', () => {
  it('无归属视图显示；清单内按芽启停；清单外（树插件）视为可见', () => {
    const store = useSettingsStore()
    expect(isViewVisible(undefined)).toBe(true)

    // 官方芽：按清单启停（取一条默认未激活的与一条默认激活的）
    const inactive = store.sprouts.find(p => !p.active)!
    const active = store.sprouts.find(p => p.active)!
    expect(hasSprout(inactive.id)).toBe(true)
    expect(isViewVisible(inactive.id)).toBe(false)
    expect(isViewVisible(active.id)).toBe(true)

    // 清单外：第二棵树的插件 id（形状 ws.*，不在官方芽清单）
    expect(hasSprout('ws.spike.panel')).toBe(false)
    expect(isViewVisible('ws.spike.panel')).toBe(true)
  })

  it('反向：清单内 id 的启停仍然生效（收敛不等于放行）', () => {
    const store = useSettingsStore()
    const inactive = store.sprouts.find(p => !p.active)!
    store.toggleSprout(inactive.id)
    expect(isViewVisible(inactive.id)).toBe(true)
    store.toggleSprout(inactive.id)
    expect(isViewVisible(inactive.id)).toBe(false)
  })
})
