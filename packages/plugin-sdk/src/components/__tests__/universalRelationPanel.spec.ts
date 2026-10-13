/**
 * UniversalRelationPanel 行为测试（2026-10-08 合并改造）。锁三件：① tabDefs 提供分组语义名
 * （芽声明 label 覆盖注册表裸 label）；② 只有被 tabDefs 覆盖的分组才有定向「＋」，点击打开定向添加浮层；
 * ③ 行跳转走 ws-navigate 契约（{ entityType, entityId }）——此前手写 6 类视图映射直调 store 的旧路已归一。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { useEntityStore, useRelationStore, relationSchemaRegistry, type Entity } from '@worldsea/entity-core'
import type { RelationTabDef } from '../types'

import UniversalRelationPanel from '../UniversalRelationPanel.vue'

function ent(id: string, type: string, name: string): Entity {
  return { id, type, name, description: '', properties: {}, tags: [], createdAt: '', updatedAt: '' } as Entity
}

const A = ent('a1', 'concept', '火之理')
const B = ent('b1', 'concept', '水之理')

const DEFS: RelationTabDef[] = [
  // label 故意取「与注册表不同值」的可辨识样本——若覆盖没发生（退回注册表 label），断言必红
  { id: 'references', label: '引用·芽语义', icon: 'link', relationType: 'references', targetLabel: '概念' },
]

let pinia: Pinia
let wrapper: VueWrapper | undefined

async function seed() {
  const es = useEntityStore()
  await es.add(A)
  await es.add(B)
  await useRelationStore().add({
    id: 'r1', type: 'references', sourceId: 'a1', targetId: 'b1',
    properties: {}, createdAt: '', updatedAt: '',
  } as never)
}

async function drain() {
  for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0))
}

function mountPanel(tabDefs?: RelationTabDef[]) {
  wrapper = mount(UniversalRelationPanel, {
    props: { entityId: 'a1', entityType: 'concept', tabDefs },
    global: { plugins: [pinia] },
  })
  return wrapper
}

beforeEach(async () => {
  pinia = createPinia()
  setActivePinia(pinia)
  localStorage.clear()
  await seed()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.querySelectorAll('.fp-panel, .fp-overlay').forEach(el => el.remove())
})

describe('UniversalRelationPanel / 合并批', () => {
  it('tabDefs 提供分组语义名（label 覆盖注册表裸 label）', async () => {
    const w = mountPanel(DEFS)
    await vi.waitFor(() => expect(w.findAll('.urp-group')).toHaveLength(1))
    expect(w.find('.urp-group-label').text()).toBe('引用·芽语义')
  })

  it('无 tabDefs 时分组退回注册表 label（不丢组）', async () => {
    const w = mountPanel()
    await vi.waitFor(() => expect(w.findAll('.urp-group')).toHaveLength(1))
    const registryLabel = relationSchemaRegistry.get('references')?.label || 'references'
    expect(w.find('.urp-group-label').text()).toBe(registryLabel)
  })

  it('只有被 tabDefs 覆盖的分组才有「＋」；点击打开定向添加浮层', async () => {
    const w = mountPanel(DEFS)
    await vi.waitFor(() => expect(w.findAll('.urp-group')).toHaveLength(1))
    const addBtn = w.find('.urp-group-add')
    expect(addBtn.exists()).toBe(true)

    await addBtn.trigger('click')
    await drain()
    // 浮层（Teleport 到 body）：标题带分组语义名
    const panels = [...document.body.querySelectorAll('.fp-panel')]
    expect(panels.some(p => p.textContent?.includes('添加：引用·芽语义'))).toBe(true)
  })

  it('无 tabDefs 时不给「＋」（无可定向类型）', async () => {
    const w = mountPanel()
    await vi.waitFor(() => expect(w.findAll('.urp-group')).toHaveLength(1))
    expect(w.find('.urp-group-add').exists()).toBe(false)
  })

  it('行跳转走 ws-navigate 契约形状（旧 6 类映射归一）', async () => {
    const w = mountPanel(DEFS)
    await vi.waitFor(() => expect(w.findAll('.urp-rel-item')).toHaveLength(1))

    const events: unknown[] = []
    const onNav = (e: Event) => { events.push((e as CustomEvent).detail) }
    window.addEventListener('ws-navigate', onNav)
    try {
      await w.find('.urp-counterpart-name').trigger('click')
      expect(events).toEqual([{ entityType: 'concept', entityId: 'b1' }])
    } finally {
      window.removeEventListener('ws-navigate', onNav)
    }
  })
})
