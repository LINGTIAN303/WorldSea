import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

const fixture = vi.hoisted(() => ({
  model: {
    stats: { buds: 1, entities: 1, instances: 1, keys: 1, traits: 1, facets: 0 },
    entities: [{
      type: 'character',
      label: '角色',
      pluginId: 'official.characters',
      traits: ['identifiable'],
      facets: [],
      fields: [{
        key: 'title',
        label: '标题',
        fieldType: 'text',
        required: true,
        sourceKind: 'trait',
        sourceLabel: 'Trait · identifiable',
        notes: [],
        search: 'title 标题 text Trait identifiable',
      }],
    }],
    traits: [],
    facets: [],
    relations: [],
    views: [],
  },
}))

vi.mock('../composables/useFieldMatrixData', async () => {
  const { ref } = await import('vue')
  return { useFieldMatrixData: () => ({ model: ref(fixture.model) }) }
})

import FieldMatrixView from '../FieldMatrixView.vue'

let wrapper: VueWrapper | undefined
let targets: HTMLElement[] = []

function makeTarget(id: string) {
  const el = document.createElement('div')
  el.id = id
  document.body.appendChild(el)
  targets.push(el)
}

beforeEach(() => {
  ;['view-toolbar-search', 'view-toolbar-filter-body', 'view-toolbar-actions'].forEach(makeTarget)
  if (!HTMLElement.prototype.scrollTo) {
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: () => {} })
  }
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  targets.forEach(el => el.remove())
  targets = []
})

describe('字段矩阵面板导航', () => {
  it('总览实体链接切到对应实体面板', async () => {
    wrapper = mount(FieldMatrixView, { attachTo: document.body })
    const link = wrapper.find('.fm-panel-inner a[href="#entity-character"]')
    expect(link.exists()).toBe(true)
    expect(wrapper.find('.entity-head').exists()).toBe(false)

    await link.trigger('click')
    await nextTick()

    expect(wrapper.find('.entity-head').exists()).toBe(true)
    expect(wrapper.find('.entity-name').text()).toBe('角色')
    expect(wrapper.find('.fm-rail-item.active').text()).toContain('角色')
  })
})
