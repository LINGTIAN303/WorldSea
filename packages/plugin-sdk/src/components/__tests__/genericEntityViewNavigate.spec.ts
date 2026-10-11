/**
 * GEV 跨视图跳转选中的行为面（ws-navigate 接缝修复，2026-10-08）。
 *
 * 两条通道：
 * 1. 即时事件通道——`ws-select-entity` 派发时视图已挂载（同视图跳转）；
 * 2. 挂起位兜底——`uiStore.selectedEntityId` 在挂载时读回（跨视图跳转时新视图挂载
 *    晚于事件派发，事件收不到，见 Shell.onWsNavigate）。
 * 类型不符必须 no-op（`selectById` 内置 `props.entityType` 判定）。
 *
 * 挂载样板抄 genericEntityViewConditionalSlot.spec（fake-indexeddb + es.add 真写库，
 * 让 onMounted 的 loadAll 能读回；entityMap.set 直接种会在 loadAll 时被清掉）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import { nextTick } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { useEntityStore, useUIStore, type Entity } from '@worldsea/entity-core'

import GenericEntityView from '../GenericEntityView.vue'
import EntityDetailPanel from '../EntityDetailPanel.vue'

const targets = ['view-toolbar-search', 'view-toolbar-filter-body', 'view-toolbar-actions', 'view-toolbar-create']

const CONCEPT = { id: 'c1', type: 'concept', name: '夜巡', description: '', tags: [], properties: {}, createdAt: '', updatedAt: '' } as unknown as Entity
const ITEM = { id: 'i1', type: 'item', name: '旧剑', description: '', tags: [], properties: {}, createdAt: '', updatedAt: '' } as unknown as Entity

let pinia: Pinia
let wrapper: VueWrapper | undefined

/** onMounted 里 await loadAll（IndexedDB 链）不保证在一轮宏任务内跑完——连续放行多轮 */
async function drain() {
  for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0))
}

function mountView(entityType = 'concept') {
  wrapper = mount(GenericEntityView, {
    props: { entityType, formFields: [] },
    global: { plugins: [pinia] },
    shallow: true,
  })
  return wrapper
}

function detailVisible(w: VueWrapper): boolean {
  return w.findComponent(EntityDetailPanel).props('visible') === true
}

beforeEach(async () => {
  pinia = createPinia()
  setActivePinia(pinia)
  localStorage.clear()
  const es = useEntityStore()
  await es.add(CONCEPT)
  await es.add(ITEM)
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

describe('GEV 跨视图跳转选中', () => {
  it('[sanity] 直调 selectEntityById（与 detailCarrier.spec 同法）→ 详情开', async () => {
    const w = mountView('concept')
    await drain()
    ;(w.vm as unknown as { selectEntityById: (id: string) => void }).selectEntityById('c1')
    await nextTick()
    expect(detailVisible(w)).toBe(true)
  })

  it('即时事件通道：ws-select-entity → 打开发起实体详情（类型匹配）', async () => {
    const w = mountView('concept')
    await drain()
    window.dispatchEvent(new CustomEvent('ws-select-entity', { detail: { entityId: 'c1' } }))
    await nextTick()
    expect(detailVisible(w)).toBe(true)
    expect(w.findComponent(EntityDetailPanel).props('title')).toBe('夜巡')
  })

  it('目标类型不匹配 → no-op（不开详情）', async () => {
    const w = mountView('concept')
    await drain()
    window.dispatchEvent(new CustomEvent('ws-select-entity', { detail: { entityId: 'i1' } }))
    await nextTick()
    expect(detailVisible(w)).toBe(false)
  })

  it('挂起位兜底：挂载时读 uiStore.selectedEntityId → 打开详情', async () => {
    useUIStore().selectEntity('c1')
    const w = mountView('concept')
    await drain()
    await nextTick()
    expect(detailVisible(w)).toBe(true)
    expect(w.findComponent(EntityDetailPanel).props('title')).toBe('夜巡')
  })

  it('挂起位类型不符 → no-op', async () => {
    useUIStore().selectEntity('i1')
    const w = mountView('concept')
    await drain()
    await nextTick()
    expect(detailVisible(w)).toBe(false)
  })

  it('注销后事件不再响应（监听在 onBeforeUnmount 移除）', async () => {
    const w = mountView('concept')
    await drain()
    w.unmount()
    window.dispatchEvent(new CustomEvent('ws-select-entity', { detail: { entityId: 'c1' } }))
    await nextTick()
    expect(w.findComponent(EntityDetailPanel).exists()).toBe(false)
  })
})
