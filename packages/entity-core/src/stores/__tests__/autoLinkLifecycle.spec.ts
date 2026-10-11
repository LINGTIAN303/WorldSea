/**
 * entityStore ⇄ AutoLink 生命周期接线护栏（① 批，2026-10-07）
 *
 * 三钩子装配级整链：add → 索引源侧；update → 源侧重索引 + 目标侧刷新；
 * remove → 清索引 + 清相关决策。全部走真实 store + 真实引擎 + fake-indexeddb 存储。
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { getProjectManager } from '../../core/ProjectManager'
import { storage } from '../../core/StorageBackend'
import { entitySchemaRegistryV2 } from '../../core/TraitRuntime'
import { useEntityStore } from '../entityStore'
import { potentialLinkIndex } from '../../core/AutoLinkEngine'
import { autoLinkDecisionStore } from '../../core/AutoLinkDecisions'
import type { Entity } from '../../types/entity'

const SRC = 'alc_src'
const TGT = 'alc_tgt'

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
  const raceField = { key: 'race', label: '种族', fieldType: 'text' as const }
  entitySchemaRegistryV2.register({
    type: 'alc_character',
    label: '测试角色',
    traits: [],
    ownFields: [raceField],
    _compiledFields: [raceField],
    _traitIds: [],
  } as never)
}

beforeEach(async () => {
  setActivePinia(createPinia())
  localStorage.clear()
  autoLinkDecisionStore.clear()
  potentialLinkIndex.clearBySource(SRC)
  potentialLinkIndex.clearBySource(TGT)
  await getProjectManager().initialize()
  const leftover = await storage.getAllEntities()
  for (const e of leftover) await storage.deleteEntity(e.id)
  registerSchemas()
})

describe('entityStore ⇄ AutoLink 生命周期', () => {
  it('store.add 后实体已进潜在链接索引（源侧接线）', async () => {
    const es = useEntityStore()
    await es.add(makeEntity(TGT, 'species', '精灵'))
    await es.add(makeEntity(SRC, 'alc_character', '测试角色', { race: '精灵' }))

    const links = potentialLinkIndex.getBySource(SRC)
    expect(links).toHaveLength(1)
    expect(links[0].targetEntityId).toBe(TGT)
  })

  it('目标实体改名 → 源实体的建议刷新为新值（目标侧接线）', async () => {
    const es = useEntityStore()
    await es.add(makeEntity(TGT, 'species', '精灵'))
    await es.add(makeEntity(SRC, 'alc_character', '测试角色', { race: '精灵' }))
    expect(potentialLinkIndex.getBySource(SRC)[0]?.targetFieldValue).toBe('精灵')

    await es.update(TGT, { name: '高等精灵' })

    const links = potentialLinkIndex.getBySource(SRC)
    expect(links).toHaveLength(1)
    expect(links[0].targetFieldValue).toBe('高等精灵')
  })

  it('实体删除 → 索引清除 + 相关决策清理', async () => {
    const es = useEntityStore()
    await es.add(makeEntity(TGT, 'species', '精灵'))
    await es.add(makeEntity(SRC, 'alc_character', '测试角色', { race: '精灵' }))
    const link = potentialLinkIndex.getBySource(SRC)[0]
    expect(link).toBeTruthy()
    autoLinkDecisionStore.record(link, 'dismissed')
    expect(autoLinkDecisionStore.recall(link)).toBe('dismissed')

    await es.remove(SRC)

    expect(potentialLinkIndex.getAllBySource(SRC)).toHaveLength(0)
    expect(autoLinkDecisionStore.recall(link)).toBeUndefined()
  })
})
