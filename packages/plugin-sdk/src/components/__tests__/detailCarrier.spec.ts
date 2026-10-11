import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import 'fake-indexeddb/auto'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { useEntityStore, useDetailLayoutStore, type Entity } from '@worldsea/entity-core'

import GenericEntityView from '../GenericEntityView.vue'
import EntityDetailPanel from '../EntityDetailPanel.vue'
import ColumnDetailView from '../ColumnDetailView.vue'
import ModalDetailView from '../ModalDetailView.vue'
import ImmersiveDetailView from '../ImmersiveDetailView.vue'
import FloatingDetailView from '../FloatingDetailView.vue'

/**
 * L1 载体分发的挂载守卫。详细见
 * docs/details/注释/packages/plugin-sdk/实体详情内容形态.md §十
 *
 * 最要紧的是第一例：**未声明未覆写时必须还是右栏抽屉、根容器不加分栏类**——
 * 「缺省零变化」是这一批对 26 个芽的唯一承诺，写歪了就是全库观感事故。
 */

let pinia: Pinia
let wrapper: VueWrapper | undefined
const targets = ['view-toolbar-search', 'view-toolbar-filter-body', 'view-toolbar-actions', 'view-toolbar-create']

const ENTITY = {
  id: 'c1', type: 'concept', name: '夜巡', description: '', tags: [], properties: {},
} as unknown as Entity

function mountView(extraProps: Record<string, unknown> = {}) {
  wrapper = mount(GenericEntityView, {
    props: { entityType: 'concept', formFields: [], ...extraProps },
    global: { plugins: [pinia] },
    shallow: true,
  })
  return wrapper
}

async function select(w: VueWrapper) {
  ;(w.vm as unknown as { selectEntityById: (id: string) => void }).selectEntityById('c1')
  // 选中后要等一次渲染：根容器的分栏类是响应式派生的，不 flush 就断言不到
  await nextTick()
  return w
}

function rootClass(w: VueWrapper): string {
  return w.find('.gev-root').classes().join(' ')
}

beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
  // 载体与布局覆写都落 localStorage：不清的话前一例写的 'concept' 会左右后一例（变异就是这么溜过去的）
  localStorage.clear()
  useEntityStore().entityMap.set('c1', ENTITY)
  for (const id of targets) {
    const el = document.createElement('div')
    el.id = id
    document.body.appendChild(el)
  }
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  for (const id of targets) document.getElementById(id)?.remove()
})

describe('载体分发', () => {
  it('未声明未覆写＝右栏抽屉，根容器不分栏（缺省零变化）', async () => {
    const w = await select(mountView())
    expect(w.findComponent(EntityDetailPanel).exists()).toBe(true)
    expect(w.findComponent(ColumnDetailView).exists()).toBe(false)
    expect(rootClass(w)).not.toContain('gev-root--split')
  })

  it('芽声明 column → 换成分栏载体，根容器随之 split', async () => {
    const w = await select(mountView({ detailCarrier: 'column' }))
    expect(w.findComponent(ColumnDetailView).exists()).toBe(true)
    expect(w.findComponent(EntityDetailPanel).exists()).toBe(false)
    expect(rootClass(w)).toContain('gev-root--split')
  })

  it('用户按类型的覆写压过芽声明（两边都留了口，优先序只有一处定义）', async () => {
    useDetailLayoutStore().setCarrier('concept', 'drawer')
    const w = await select(mountView({ detailCarrier: 'column' }))
    expect(w.findComponent(EntityDetailPanel).exists()).toBe(true)
    expect(w.findComponent(ColumnDetailView).exists()).toBe(false)
  })

  it('写了不存在的载体 id 也不空屏，回落抽屉', async () => {
    const w = await select(mountView({ detailCarrier: 'no-such-carrier' }))
    expect(w.findComponent(EntityDetailPanel).exists()).toBe(true)
  })

  it('没选中实体时不分栏（分栏只在详情真开着时才改布局）', () => {
    const w = mountView({ detailCarrier: 'column' })
    expect(rootClass(w)).not.toContain('gev-root--split')
  })

  it('设置里清掉覆写后，回到芽声明的那一种', async () => {
    const store = useDetailLayoutStore()
    store.setCarrier('concept', 'drawer')
    const overridden = await select(mountView({ detailCarrier: 'column' }))
    expect(overridden.findComponent(EntityDetailPanel).exists()).toBe(true)

    store.clearCarrier('concept')
    overridden.unmount()
    const w = await select(mountView({ detailCarrier: 'column' }))
    expect(w.findComponent(ColumnDetailView).exists()).toBe(true)
  })

  it('抽屉与栏式的宽度键分开（同键＝拖一个把另一个也改了）', async () => {
    // 走查项「与抽屉宽度各记各的」的实际凭据：宽度存进 `worldsea_panel_width_${panelId}`，
    // 两载体若同键，这个承诺就是假的
    const drawer = await select(mountView())
    expect(drawer.findComponent(EntityDetailPanel).props('panelId')).toBe('detail-concept')
    drawer.unmount()

    const column = await select(mountView({ detailCarrier: 'column' }))
    expect(column.findComponent(ColumnDetailView).props('panelId')).toBe('detail-column-concept')
  })

  it('居中弹层是浮层：换组件但不改列表布局', async () => {
    const w = await select(mountView({ detailCarrier: 'modal' }))
    expect(w.findComponent(ModalDetailView).exists()).toBe(true)
    expect(w.findComponent(EntityDetailPanel).exists()).toBe(false)
    expect(rootClass(w)).not.toContain('gev-root--split')
    expect(rootClass(w)).not.toContain('gev-root--immersive')
    expect(w.findComponent(ModalDetailView).props('panelId')).toBe('detail-modal-concept')
  })

  it('浮层小窗也是浮层，且同样不拦列表（没遮罩档位之外的布局改动）', async () => {
    const w = await select(mountView({ detailCarrier: 'floating' }))
    expect(w.findComponent(FloatingDetailView).exists()).toBe(true)
    expect(rootClass(w)).not.toContain('gev-root--split')
    expect(rootClass(w)).not.toContain('gev-root--immersive')
  })

  it('沉浸页盖住内容区：加 immersive 类、不加 split 类，没选中时也不加', async () => {
    const w = await select(mountView({ detailCarrier: 'immersive' }))
    expect(w.findComponent(ImmersiveDetailView).exists()).toBe(true)
    expect(rootClass(w)).toContain('gev-root--immersive')
    expect(rootClass(w)).not.toContain('gev-root--split')
    w.unmount()

    const idle = mountView({ detailCarrier: 'immersive' })
    expect(rootClass(idle)).not.toContain('gev-root--immersive')
  })
})
