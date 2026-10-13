import { describe, it, expect, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import 'fake-indexeddb/auto'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { useDetailLayoutStore } from '@worldsea/entity-core'
import EntityDetailPanel from '../EntityDetailPanel.vue'

/**
 * 抽屉遮罩行为守卫。背景见 docs/details/注释/packages/plugin-sdk/实体详情内容形态.md §11.4
 * 遮罩原本带 `pointer-events:none` 而模板挂 `@click="close"`——点空白关抽屉以前不存在；
 * 现做成可配置、缺省仍穿透；本守卫同时锁两档差别与「缺省零变化」。
 */

let pinia: Pinia
let wrapper: VueWrapper | undefined

function mountPanel(props: Record<string, unknown> = {}) {
  wrapper = mount(EntityDetailPanel, {
    props: { visible: true, entity: { id: 'c1', name: '夜巡' }, title: '夜巡', ...props },
    global: { plugins: [pinia] },
    slots: { info: '<p>i</p>' },
  })
  return wrapper
}

// 遮罩自 2026-10-04 起是各 overlay 载体共用的 `DetailBackdrop.vue`，类名 `.dp-backdrop`
const backdrop = (w: VueWrapper) => w.find('.dp-backdrop')

beforeEach(() => {
  // 遮罩档落 localStorage：不清的话上一例写的 blocking 会让本例的"缺省穿透"假绿
  localStorage.clear()
  pinia = createPinia()
  setActivePinia(pinia)
})

describe('抽屉遮罩', () => {
  it('缺省＝穿透：没有拦截类，点空白不发 close', async () => {
    const w = mountPanel()
    expect(backdrop(w).exists()).toBe(true)
    expect(backdrop(w).classes()).not.toContain('is-blocking')
    await backdrop(w).trigger('click')
    expect(w.emitted('close'), '穿透档点遮罩不该关抽屉').toBeUndefined()
  })

  it('切到拦截档：类挂上，点空白发 close', async () => {
    const w = mountPanel()
    useDetailLayoutStore().backdropMode = 'blocking'
    await nextTick()
    expect(backdrop(w).classes()).toContain('is-blocking')
    await backdrop(w).trigger('click')
    expect(w.emitted('close')).toBeTruthy()
  })

  it('拦截档落盘，换新 store 后仍是拦截档', async () => {
    useDetailLayoutStore().backdropMode = 'blocking'
    // 持久化挂在 watch 上，要等一次 flush 才写键
    await nextTick()
    expect(localStorage.getItem('worldsea_detail_backdrop')).toBe('blocking')

    const next = createPinia()
    setActivePinia(next)
    expect(useDetailLayoutStore().backdropMode).toBe('blocking')
  })

  it('按类型覆写压过全局默认（两层只有一处解析：backdropFor）', async () => {
    const store = useDetailLayoutStore()
    store.backdropMode = 'blocking'
    store.setBackdropOverride('concept', 'passthrough')
    const w = mountPanel({ entityType: 'concept' })
    await nextTick()
    expect(backdrop(w).classes()).not.toContain('is-blocking')

    // 同一条全局默认下，别的类型仍吃拦截
    const other = mountPanel({ entityType: 'item' })
    await nextTick()
    expect(backdrop(other).classes()).toContain('is-blocking')
  })

  it('清掉类型覆写＝回到全局，不该顺手把全局也改掉', async () => {
    const store = useDetailLayoutStore()
    store.setBackdropOverride('concept', 'blocking')
    const w = mountPanel({ entityType: 'concept' })
    await nextTick()
    expect(backdrop(w).classes()).toContain('is-blocking')

    store.clearBackdropOverride('concept')
    await nextTick()
    expect(backdrop(w).classes()).not.toContain('is-blocking')
    expect(store.backdropMode).toBe('passthrough')
    expect(store.backdropOverrides.concept).toBeUndefined()
    expect(JSON.parse(localStorage.getItem('worldsea_detail_backdrop_types') || '{}')).toEqual({})
  })

  it('抽屉关着时不渲染遮罩（穿透档也不该留一层挡列表）', () => {
    const w = mountPanel({ visible: false, entity: null })
    expect(backdrop(w).exists()).toBe(false)
  })
})
