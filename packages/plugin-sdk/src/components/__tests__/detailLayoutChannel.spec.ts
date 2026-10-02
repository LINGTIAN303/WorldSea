import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import type { EntityTypeSchema } from '@worldsea/core-api-types'

import GenericEntityView from '../GenericEntityView.vue'
import SchemaRenderer from '../SchemaRenderer.vue'
import EntityDetailForm from '../../detail/EntityDetailForm.vue'

/**
 * 芽声明默认详情布局的**通道**守卫（裁定 ⑤：芽声明默认 + 用户按类型覆写）。
 * 详细见 docs/details/注释/packages/plugin-sdk/实体详情内容形态.md §七
 *
 * 锁的是"传到了"而不是"声明了"：GEV 侧看到内容件真的收到该形态，
 * SchemaRenderer 侧看到参数原样下传给 GEV（schema 驱动的芽不直挂 GEV）。
 */

let pinia: Pinia
let wrapper: VueWrapper | undefined
const targets = ['view-toolbar-search', 'view-toolbar-filter-body', 'view-toolbar-actions', 'view-toolbar-create']

/** EntityDetailPanel 换成"如实渲染 info 槽"的替身，否则 shallow 挂载下槽内容根本不出现 */
const PANEL_STUB = { template: '<div><slot name="info" :entity="null" :editing="false" /></div>' }

const MIN_SCHEMA = {
  typeKey: 'plant', idPrefix: 'pl', label: '植物', icon: 'plant', iconMap: {}, fields: [],
} as unknown as EntityTypeSchema

async function drain() {
  await new Promise(r => setTimeout(r, 0))
}

beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
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

describe('芽声明通道的两端', () => {
  it('GEV 直挂：芽声明的 contentForm 真的到了内容件的 layout 上', () => {
    wrapper = mount(GenericEntityView, {
      props: { entityType: 'concept', formFields: [], detailLayout: { contentForm: 'summary' } },
      global: { plugins: [pinia], stubs: { EntityDetailPanel: PANEL_STUB } },
      shallow: true,
    })
    const form = wrapper.findComponent(EntityDetailForm)
    expect(form.exists(), '详情内容件未渲染＝挂载姿势失效，别当成通道通过').toBe(true)
    expect((form.props('layout') as { contentForm: string }).contentForm).toBe('summary')
  })

  it('用户按类型的覆写压过芽声明（三级合并的优先序在通道上同样成立）', async () => {
    localStorage.setItem('worldsea_detail_layouts', JSON.stringify({ concept: { contentForm: 'timeline' } }))
    pinia = createPinia()
    setActivePinia(pinia)
    wrapper = mount(GenericEntityView, {
      props: { entityType: 'concept', formFields: [], detailLayout: { contentForm: 'summary' } },
      global: { plugins: [pinia], stubs: { EntityDetailPanel: PANEL_STUB } },
      shallow: true,
    })
    await drain()
    expect((wrapper.findComponent(EntityDetailForm).props('layout') as { contentForm: string }).contentForm)
      .toBe('timeline')
    localStorage.clear()
  })

  it('SchemaRenderer 把声明位原样下传给 GEV', async () => {
    const loader = vi.fn(async () => MIN_SCHEMA)
    wrapper = mount(SchemaRenderer, {
      props: { typeKey: 'plant', detailLayout: { contentForm: 'table' }, schemaLoader: loader },
      global: { plugins: [pinia] },
      shallow: true,
    })
    await drain()
    const gev = wrapper.findComponent(GenericEntityView)
    expect(gev.exists(), 'schema 未加载或 GEV 未渲染＝本例失效').toBe(true)
    expect(gev.props('detailLayout')).toEqual({ contentForm: 'table' })
  })
})
