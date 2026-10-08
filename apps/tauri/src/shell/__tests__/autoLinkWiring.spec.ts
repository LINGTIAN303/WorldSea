/**
 * AutoLink ② 批装配级护栏（2026-10-07）
 *
 * 全链：installAutoLinkWiring() → ①策略注册 ②设置桥活读 ③确认桥真解析 ④撤销上限跟随
 * ⑤写面整链（保存智能链 / 自动建实体）⑥删对确认。全部走真实模块单例 + fake-indexeddb 存储。
 */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  getProjectManager,
  storage,
  getSettingsApi,
  getConfirmApi,
  autoLinkStrategyRegistry,
  useSettingsStore,
  useUndoRedo,
  useRelationStore,
  useEntityStore,
  useSmartFieldLink,
  useAutoCreateEntity,
  useBidirectional,
} from '@worldsea/entity-core'
import { useConfirm } from '@worldsea/ui-kit'
import { installAutoLinkWiring } from '../autoLinkWiring'
import type { Entity } from '@worldsea/entity-core'

const SRC = 'aw_src'
const TGT = 'aw_tgt'

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

beforeEach(async () => {
  setActivePinia(createPinia())
  localStorage.clear()
  const ui = useConfirm()
  if (ui.state.value.show) ui.doCancel()
  const { undoStack } = useUndoRedo()
  undoStack.value = []
  await getProjectManager().initialize()
  for (const e of await storage.getAllEntities()) await storage.deleteEntity(e.id)
  for (const r of await storage.getAllRelations()) await storage.deleteRelation(r.id)
})

afterEach(() => {
  const ui = useConfirm()
  if (ui.state.value.show) ui.doCancel()
})

describe('installAutoLinkWiring —— 装配级全链（② 批）', () => {
  it('装配前：策略空、设置桥为 noop（对照组）', () => {
    expect(autoLinkStrategyRegistry.getRegisteredHints()).toHaveLength(0)
    expect(getSettingsApi().autoCreateEntityEnabled).toBe(false)
  })

  it('装配后：策略注册（9 个 hint 可查）', () => {
    installAutoLinkWiring()
    expect(autoLinkStrategyRegistry.getByHint('origin')).toHaveLength(1)
    expect(autoLinkStrategyRegistry.getRegisteredHints().length).toBeGreaterThanOrEqual(9)
  })

  it('装配后：设置桥活读 store（改 store 即时反映）', () => {
    installAutoLinkWiring()
    const settings = useSettingsStore()
    expect(getSettingsApi().autoCreateEntityEnabled).toBe(true)
    expect(getSettingsApi().autoCreateSelectorEnabled).toBe(true)

    settings.autoCreateEntityEnabled = false
    expect(getSettingsApi().autoCreateEntityEnabled).toBe(false)
    settings.autoCreateEntityEnabled = true
  })

  it('装配后：确认桥真解析（驱动全局确认弹窗）', async () => {
    installAutoLinkWiring()
    const ui = useConfirm()
    const p = getConfirmApi().confirm({ title: '装配自检', type: 'warning' })
    expect(ui.state.value.show).toBe(true)
    expect(ui.state.value.title).toBe('装配自检')
    ui.doConfirm()
    await expect(p).resolves.toBe(true)
  })

  it('装配后：撤销上限跟随设置（限 2 → 栈内只留 2 条）', () => {
    installAutoLinkWiring()
    const settings = useSettingsStore()
    const { record, undoStack } = useUndoRedo()
    settings.undoHistoryLimit = 2
    record('entity', 'add', 'u1', null, null)
    record('entity', 'add', 'u2', null, null)
    record('entity', 'add', 'u3', null, null)
    expect(undoStack.value).toHaveLength(2)
    settings.undoHistoryLimit = 20
    undoStack.value = []
  })

  it('装配后：写面整链——保存智能链自动建关系（store 即时可见）', async () => {
    installAutoLinkWiring()
    const es = useEntityStore()
    await es.add(makeEntity(TGT, 'species', '精灵'))
    await es.add(makeEntity(SRC, 'character', '测试角色', { race: '精灵' }))

    const { processAutoLinks } = useSmartFieldLink()
    const result = await processAutoLinks(SRC, { race: '精灵' }, [
      { key: 'race', label: '种族', autoLink: { targetType: 'species', relationType: 'belongs_to' } },
    ] as never)

    expect(result.linked).toBe(1)
    const rs = useRelationStore()
    expect(rs.relations.find(r => r.type === 'belongs_to' && r.sourceId === SRC && r.targetId === TGT)).toBeTruthy()
  })

  it('装配后：写面整链——自动建实体（弹窗确认 → 实体落库）', async () => {
    installAutoLinkWiring()
    const ui = useConfirm()
    const { promptAndCreate } = useAutoCreateEntity()

    const pending = promptAndCreate({ name: '装配测试物种', entityType: 'species' })
    expect(ui.state.value.show).toBe(true)
    ui.doConfirm()
    const created = await pending

    expect(created?.name).toBe('装配测试物种')
    const persisted = await storage.getEntitiesByType('species')
    expect(persisted.some(e => e.name === '装配测试物种')).toBe(true)
  })

  it('装配后：删对确认接线——确认时成对删除', async () => {
    installAutoLinkWiring()
    const ui = useConfirm()
    const rs = useRelationStore()
    const { createBidirectional, deleteWithConfirm } = useBidirectional()

    const { forward, reverse } = await createBidirectional({ type: 'belongs_to', sourceId: 'w1', targetId: 'w2' })
    expect(reverse).toBeTruthy()

    const pending = deleteWithConfirm(forward.id)
    expect(ui.state.value.show).toBe(true)
    ui.doConfirm()
    await pending

    expect(rs.relations.find(r => r.id === forward.id)).toBeUndefined()
    expect(rs.relations.find(r => r.id === reverse!.id)).toBeUndefined()
  })
})
