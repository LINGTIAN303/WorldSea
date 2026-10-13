/**
 * AutoLinkSuggestions 守卫（2026-10-07）：确认必须走标准双向管线（成对/进 relationStore
 * 即时可见）、带判重；忽略/确认必须落决策（重建索引不复活）。
 * 等待口径：确认链路含 fake-indexeddb 异步写 → 一律用 vi.waitFor 等状态落地，不能用 flushPromises 猜。
 */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import AutoLinkSuggestions from '../AutoLinkSuggestions.vue'
import {
  getProjectManager,
  storage,
  entitySchemaRegistryV2,
  traitRegistry,
  potentialLinkIndex,
  autoLinkDecisionStore,
  autoLinkStrategyRegistry,
  useRelationStore,
  inverseRegistry,
} from '@worldsea/entity-core'
import type { Entity } from '@worldsea/entity-core'

const SRC = 'als_src'
const TGT = 'als_tgt'

let wrapper: VueWrapper | undefined

function makeEntity(id: string, type: string, name: string, properties: Record<string, unknown> = {}): Entity {
  return {
    id,
    type,
    name,
    description: '',
    properties,
    tags: [],
    createdAt: '2026-10-07T00:00:00.000Z',
    updatedAt: '2026-10-07T00:00:00.000Z',
  }
}

function registerSchemas(): void {
  if (!traitRegistry.has('als_hinted')) {
    traitRegistry.register({
      id: 'als_hinted',
      label: '测试语义',
      fields: [{ key: 'origin', label: '来源', fieldType: 'text', semanticHint: 'origin' }],
    } as never)
  }
  const raceField = { key: 'race', label: '种族', fieldType: 'text' as const }
  entitySchemaRegistryV2.register({
    type: 'als_character',
    label: '测试角色',
    traits: [{ traitId: 'als_hinted' }],
    ownFields: [raceField],
    _compiledFields: [raceField],
    _traitIds: ['als_hinted'],
  } as never)
}

async function mountPanel(properties: Record<string, unknown> = { race: '精灵' }): Promise<VueWrapper> {
  wrapper = mount(AutoLinkSuggestions, {
    props: { entityId: SRC, entityType: 'als_character', properties },
  })
  await vi.waitFor(() => expect(wrapper!.findAll('.als-item')).toHaveLength(1))
  return wrapper
}

beforeEach(async () => {
  setActivePinia(createPinia())
  localStorage.clear()
  autoLinkDecisionStore.clear()
  potentialLinkIndex.clearBySource(SRC)
  potentialLinkIndex.clearBySource(TGT)
  await getProjectManager().initialize()
  for (const e of await storage.getAllEntities()) await storage.deleteEntity(e.id)
  for (const r of await storage.getAllRelations()) await storage.deleteRelation(r.id)
  await storage.putEntity(makeEntity(TGT, 'species', '精灵'))
  await storage.putEntity(makeEntity(SRC, 'als_character', '测试角色', { race: '精灵' }))
  registerSchemas()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
})

describe('AutoLinkSuggestions —— 确认 / 忽略管线', () => {
  it('确认：关系经标准管线建立（store 即时可见；若定义反向则成对）', async () => {
    const w = await mountPanel()
    const rs = useRelationStore()
    await w.find('.als-confirm').trigger('click')

    await vi.waitFor(() => {
      expect(rs.relations.find(r => r.type === 'belongs_to' && r.sourceId === SRC && r.targetId === TGT)).toBeTruthy()
    })
    const forward = rs.relations.find(r => r.type === 'belongs_to' && r.sourceId === SRC && r.targetId === TGT)!

    const inverseType = inverseRegistry.getInverse('belongs_to')
    if (inverseType) {
      const pair = rs.relations.filter(r => forward.pairId && r.pairId === forward.pairId)
      expect(pair).toHaveLength(2)
      expect(pair.some(r => r.type === inverseType && r.sourceId === TGT && r.targetId === SRC)).toBe(true)
    }

    await flushPromises()
    const link = potentialLinkIndex.getAllBySource(SRC)[0]
    expect(autoLinkDecisionStore.recall(link)).toBe('confirmed')
    expect(w.findAll('.als-item')).toHaveLength(0)
  })

  it('判重：已存在的关系不重复建立（单向或反向任一命中即跳过）', async () => {
    const rs = useRelationStore()
    await rs.add({
      id: 'rel-pre', type: 'belongs_to', sourceId: SRC, targetId: TGT,
      properties: {}, createdAt: '', updatedAt: '',
    })
    const w = await mountPanel()
    await w.find('.als-confirm').trigger('click')
    await vi.waitFor(() => expect(w.findAll('.als-item')).toHaveLength(0))
    await flushPromises()

    const persisted = await storage.getRelationsByEntity(SRC)
    expect(persisted.filter(r => r.type === 'belongs_to')).toHaveLength(1)
  })

  it('忽略：记决策；重建索引后不复活', async () => {
    const w = await mountPanel()
    const link = potentialLinkIndex.getBySource(SRC)[0]
    await w.find('.als-dismiss').trigger('click')

    await vi.waitFor(() => expect(autoLinkDecisionStore.recall(link)).toBe('dismissed'))

    // 触发重建（properties 换引用 → deep watch 刷新 → 重新索引）
    await w.setProps({ properties: { race: '精灵' } })
    // 先等重建真正发生（索引条目被新对象替换），再断言 UI 不复活——
    // 否则「等待 UI 为空」会在重建前瞬时通过（假绿，2026-10-07 变异轮抓到）
    await vi.waitFor(() => expect(potentialLinkIndex.getAllBySource(SRC)[0]).not.toBe(link))
    await flushPromises()
    expect(w.findAll('.als-item')).toHaveLength(0)
  })

  it('target 方向：确认时关系反着建（候选为源、本实体为目标）', async () => {
    autoLinkStrategyRegistry.register({
      hint: 'origin',
      matchTargets: ['species'],
      matchFields: ['name'],
      confidence: 'fuzzy',
      relationType: 'originates_from',
      relationDirection: 'target',
    })
    const w = await mountPanel({ origin: '精灵' })
    const rs = useRelationStore()
    await w.find('.als-confirm').trigger('click')

    await vi.waitFor(() => {
      const r = rs.relations.find(x => x.type === 'originates_from')
      expect(r).toBeTruthy()
      expect(r!.sourceId).toBe(TGT)
      expect(r!.targetId).toBe(SRC)
    })
  })
})
