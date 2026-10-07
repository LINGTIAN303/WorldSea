/**
 * AutoLinkEngine —— ① 活异常修复批护栏（2026-10-07）
 *
 * 覆盖两件事：
 * 1. 陈旧目标：字段名直接目标映射表（race→species；mount→creature 已删，类型不存在）；
 * 2. 决策持久化：忽略/确认后重建索引不复活；两端文本变化 → 决策失效、建议回来；
 *    决策落 localStorage，新实例（模拟重启）仍可读。
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { getProjectManager } from '../ProjectManager'
import { storage } from '../StorageBackend'
import { entitySchemaRegistryV2 } from '../TraitRuntime'
import {
  indexPotentialLinks,
  inferDirectTargetFromKey,
  potentialLinkIndex,
} from '../AutoLinkEngine'
import { AutoLinkDecisionStoreClass, autoLinkDecisionStore } from '../AutoLinkDecisions'
import type { Entity } from '../../types/entity'

const SRC = 'alk_src'
const TGT = 'alk_tgt'

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
  entitySchemaRegistryV2.register({
    type: 'alk_character',
    label: '测试角色',
    traits: [],
    ownFields: [{ key: 'race', label: '种族', fieldType: 'text' }],
    _compiledFields: [{ key: 'race', label: '种族', fieldType: 'text' }],
    _traitIds: [],
  } as never)
}

/** 直接写进 storage（绕过 store），模拟"磁盘上已有这些数据" */
async function seed(entities: Entity[]): Promise<void> {
  for (const e of entities) await storage.putEntity(e)
}

async function readLink() {
  await indexPotentialLinks(SRC, 'alk_character', { race: '精灵' })
  return potentialLinkIndex.getBySource(SRC)[0]
}

beforeEach(async () => {
  localStorage.clear()
  autoLinkDecisionStore.clear()
  potentialLinkIndex.clearBySource(SRC)
  await getProjectManager().initialize()
  const leftover = await storage.getAllEntities()
  for (const e of leftover) await storage.deleteEntity(e.id)
  registerSchemas()
})

describe('字段名启发式 —— 直接目标映射表', () => {
  it('race 键 → species / belongs_to', () => {
    expect(inferDirectTargetFromKey('race')).toEqual({ targetType: 'species', relationType: 'belongs_to' })
  })

  it('mount 键不再给出直接目标（creature 类型不存在，条目已删）', () => {
    expect(inferDirectTargetFromKey('mount')).toBeNull()
  })

  it('faction 键 → organization / belongs_to', () => {
    expect(inferDirectTargetFromKey('faction')).toEqual({ targetType: 'organization', relationType: 'belongs_to' })
  })
})

describe('决策持久化 —— 忽略 / 确认不复活，内容变化则重评', () => {
  it('忽略后重建索引不复活；内容变化（目标改名）→ 决策失效、建议回来', async () => {
    // 目标用生产类型名 'species'（启发式表 race→species 硬编码该类型）
    await seed([makeEntity(TGT, 'species', '精灵'), makeEntity(SRC, 'alk_character', '测试角色')])
    const link = await readLink()
    expect(link).toBeTruthy()
    expect(link.targetFieldValue).toBe('精灵')

    autoLinkDecisionStore.record(link, 'dismissed')
    await indexPotentialLinks(SRC, 'alk_character', { race: '精灵' })
    expect(potentialLinkIndex.getBySource(SRC)).toHaveLength(0)

    // 目标改名 → 指纹失效 → 建议带新值回来
    await storage.putEntity(makeEntity(TGT, 'species', '高等精灵'))
    await indexPotentialLinks(SRC, 'alk_character', { race: '精灵' })
    const revived = potentialLinkIndex.getBySource(SRC)
    expect(revived).toHaveLength(1)
    expect(revived[0].targetFieldValue).toBe('高等精灵')
  })

  it('确认后重建索引不复活', async () => {
    await seed([makeEntity(TGT, 'species', '精灵'), makeEntity(SRC, 'alk_character', '测试角色')])
    const link = await readLink()
    autoLinkDecisionStore.record(link, 'confirmed')

    await indexPotentialLinks(SRC, 'alk_character', { race: '精灵' })
    expect(potentialLinkIndex.getBySource(SRC)).toHaveLength(0)
  })

  it('决策落盘：新实例（模拟重启）仍能读到；指纹不匹配则读不到', async () => {
    await seed([makeEntity(TGT, 'species', '精灵'), makeEntity(SRC, 'alk_character', '测试角色')])
    const link = await readLink()
    autoLinkDecisionStore.record(link, 'dismissed')

    const fresh = new AutoLinkDecisionStoreClass()
    expect(fresh.recall(link)).toBe('dismissed')
    expect(fresh.recall({ ...link, targetFieldValue: '高等精灵' })).toBeUndefined()
  })
})
