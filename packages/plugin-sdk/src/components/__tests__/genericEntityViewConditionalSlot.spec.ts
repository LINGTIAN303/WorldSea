/**
 * GEV 条件 #list 槽行为验证：OrganizationView 用 `<template v-if="viewMode === 'tree'" #list>` 做卡片/树切换
 * （无槽→默认 EntityCard 网格，有槽→自绘树接管）。锁：①槽的条件提供能实时切换默认卡片 ↔ 自绘内容（Vue 动态槽机制）；
 * ②hasListSlot 在槽增删后保持新鲜（context.slots 非响应式，computed 缓存过期会丢 has-custom-list 类、分页判定用旧值）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { defineComponent, h, ref } from 'vue'

import GenericEntityView from '../GenericEntityView.vue'
import { useEntityStore } from '@worldsea/entity-core'

async function seedEntities() {
  const es = useEntityStore()
  // entities 是 useShallowArray（浅响应）——直接 push 不触发，必须走 store 的 add
  await es.add({ id: 'e1', type: 'concept', name: '甲', description: '', properties: {}, tags: [], createdAt: '', updatedAt: '' } as any)
  await es.add({ id: 'e2', type: 'concept', name: '乙', description: '', properties: {}, tags: [], createdAt: '', updatedAt: '' } as any)
}

let pinia: Pinia
let wrapper: VueWrapper | undefined
const targets = ['view-toolbar-search', 'view-toolbar-filter-body', 'view-toolbar-actions', 'view-toolbar-create']

async function drain() {
  await new Promise(r => setTimeout(r, 0))
}

beforeEach(async () => {
  pinia = createPinia()
  setActivePinia(pinia)
  await seedEntities()
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

/** 模拟 OrganizationView：外部 ref 驱动的条件 #list 槽（render function 形态的条件槽） */
function mountWithConditionalSlot() {
  const viewMode = ref<'cards' | 'tree'>('cards')
  const Parent = defineComponent({
    setup(_, { expose }) {
      expose({ setMode: (m: 'cards' | 'tree') => { viewMode.value = m } })
      return () => h(
        GenericEntityView,
        { entityType: 'concept', formFields: [], entityLabel: '概念' },
        viewMode.value === 'tree'
          ? { list: ({ entities }: { entities: { id: string; name: string }[] }) =>
              h('div', { class: 'tree-slot' }, entities.map(e => h('div', { key: e.id, class: 'tree-item' }, e.name))) }
          : {},
      )
    },
  })
  wrapper = mount(Parent, { global: { plugins: [pinia] } })
  return wrapper.vm as unknown as { setMode(m: 'cards' | 'tree'): void }
}

describe('GEV 条件 #list 槽', () => {
  it('卡片模式（不提供槽）：默认 EntityCard 网格渲染，无 has-custom-list', async () => {
    mountWithConditionalSlot()
    await drain()
    // 调试：dump 实际渲染产物与实体数
    expect(wrapper!.findAll('.entity-card').length).toBe(2)
    expect(wrapper!.find('.tree-slot').exists()).toBe(false)
    expect(wrapper!.find('.entity-grid').classes()).not.toContain('has-custom-list')
  })

  it('切到树模式：槽内容接管，entity-grid 获得 has-custom-list（hasListSlot 保持新鲜）', async () => {
    const vm = mountWithConditionalSlot()
    await drain()
    vm.setMode('tree')
    await drain()
    expect(wrapper!.find('.tree-slot').exists()).toBe(true)
    expect(wrapper!.findAll('.tree-item').length).toBe(2)
    expect(wrapper!.find('.entity-card').exists()).toBe(false)
    expect(wrapper!.find('.entity-grid').classes()).toContain('has-custom-list')
  })

  it('切回卡片模式：默认网格回归', async () => {
    const vm = mountWithConditionalSlot()
    await drain()
    vm.setMode('tree')
    await drain()
    vm.setMode('cards')
    await drain()
    expect(wrapper!.findAll('.entity-card').length).toBe(2)
    expect(wrapper!.find('.tree-slot').exists()).toBe(false)
  })
})
