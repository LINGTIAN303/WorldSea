/**
 * backlinkDerive · 派生器测试矩阵（块 2 · 连接派生 · 阶段 1，2026-10-15）
 *
 * 三层覆盖：
 * ① extractNoteRefs 扫描边界（围栏 / 行内反引号 / 转义 / trim / 去重 / 空名）；
 * ② resolveNoteRef 三态解析（hit / miss / ambiguous）；
 * ③ recomputeNoteLinks 派生集成（真实 store + fake-indexeddb）：建 / 删 / 短路 / 幂等 /
 *    自引用跳过 / 歧义不建 / skipUndo 无撤销记录 / 并发串行收敛。
 *
 * 契约来源：docs/plans/2026-10-15-人机共写协议-md真相源转型.md §3.4；
 * 批计划：docs/plans/2026-10-15-块2-连接派生-批计划.md §五（验收判据）。
 */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { clearWorldServiceTable } from '../../../service-registry'
import { installStoreServices } from './storeServices'
import {
  getProjectManager,
  storage,
  useEntityStore,
  useRelationStore,
  useUndoRedo,
} from '@worldsea/entity-core'
import type { Entity } from '@worldsea/entity-core'
import {
  extractNoteRefs,
  resolveNoteRef,
  computeDesiredLinks,
  computeLinkDiff,
  recomputeNoteLinks,
  recomputeAllNoteLinks,
} from '../backlinkDerive'

function makeNote(id: string, name: string, content = '', type = 'notebook'): Entity {
  const now = new Date().toISOString()
  return {
    id,
    type,
    name,
    description: '',
    properties: { content, noteType: 'markdown' },
    tags: [],
    createdAt: now,
    updatedAt: now,
  }
}

beforeEach(async () => {
  setActivePinia(createPinia())
  installStoreServices()
  localStorage.clear()
  const { undoStack } = useUndoRedo()
  undoStack.value = []
  await getProjectManager().initialize()
  for (const e of await storage.getAllEntities()) await storage.deleteEntity(e.id)
  for (const r of await storage.getAllRelations()) await storage.deleteRelation(r.id)
})

afterEach(() => clearWorldServiceTable())

// ────────────────────────────────────────────────
// ① extractNoteRefs · 语法感知扫描
// ────────────────────────────────────────────────
describe('extractNoteRefs · 扫描边界', () => {
  it('基本扫描 + 去重保序', () => {
    expect(extractNoteRefs('前言 [[甲]] 中间 [[乙]] 尾 [[甲]]')).toEqual(['甲', '乙'])
  })

  it('围栏代码块内的 [[ ]] 跳过（块外正常）', () => {
    const md = ['前 [[甲]]', '```ts', 'const x = "[[乙]]"', '```', '后 [[丙]]'].join('\n')
    expect(extractNoteRefs(md)).toEqual(['甲', '丙'])
  })

  it('未闭合围栏：其后全部不扫', () => {
    const md = ['前置 [[甲]]', '```', '[[乙]]', '[[丙]]'].join('\n')
    expect(extractNoteRefs(md)).toEqual(['甲'])
  })

  it('~~~ 围栏同样生效（异字符不闭合）', () => {
    const md = ['~~~', '[[甲]]', '```', '[[乙]]', '~~~', '[[丙]]'].join('\n')
    expect(extractNoteRefs(md)).toEqual(['丙'])
  })

  it('行内反引号段跳过（跨段不拼接出伪匹配）', () => {
    expect(extractNoteRefs('前 `[[甲]]` 后 [[乙]]')).toEqual(['乙'])
    expect(extractNoteRefs('`code`[[丙]]')).toEqual(['丙'])
    // `[[`x`y]]`：`[[` 与内容被反引号切断——渲染上非链接，不得命中
    expect(extractNoteRefs('[[`x`y]]')).toEqual([])
  })

  it('转义形态 \\[\\[甲\\]\\] 不命中（渲染上为字面文本）', () => {
    expect(extractNoteRefs('前 \\[\\[甲\\]\\] 后')).toEqual([])
  })

  it('名字两侧空白 trim；空名跳过', () => {
    expect(extractNoteRefs('[[ 甲 ]]')).toEqual(['甲'])
    expect(extractNoteRefs('[[ ]] [[]]')).toEqual([])
  })
})

// ────────────────────────────────────────────────
// ② resolveNoteRef · 三态解析
// ────────────────────────────────────────────────
describe('resolveNoteRef · 三态解析', () => {
  const notes = [
    makeNote('n1', '唯一'),
    makeNote('n2', '同名'),
    makeNote('n3', '同名'),
    makeNote('c1', '唯一', '', 'character'), // 非 notebook 不参与
  ]

  it('唯一命中 → hit', () => {
    expect(resolveNoteRef('唯一', notes)).toEqual({ kind: 'hit', id: 'n1' })
  })

  it('无匹配 → miss', () => {
    expect(resolveNoteRef('不存在', notes)).toEqual({ kind: 'miss' })
  })

  it('多匹配 → ambiguous（列出全部 id，不取首个）', () => {
    expect(resolveNoteRef('同名', notes)).toEqual({ kind: 'ambiguous', ids: ['n2', 'n3'] })
  })
})

// ────────────────────────────────────────────────
// ③ recomputeNoteLinks · 派生集成
// ────────────────────────────────────────────────
describe('recomputeNoteLinks · 派生集成（真实 store + fake-indexeddb）', () => {
  it('内容含 [[B]] → 重算建立关系（双记录：forward + note_linked_from，pairId 配对）', async () => {
    const es = useEntityStore()
    const rs = useRelationStore()
    await es.add(makeNote('nb-A', '笔记A', '内容引用 [[笔记B]]'))
    await es.add(makeNote('nb-B', '笔记B', ''))

    const changed = await recomputeNoteLinks('nb-A')
    expect(changed).toBe(true)

    const fwd = rs.relations.find((r) => r.type === 'note_link' && r.sourceId === 'nb-A' && r.targetId === 'nb-B')
    expect(fwd).toBeDefined()
    // 2026-10-15 修复：inverseRegistry 已补 V2 注册（syncToLegacyRegistry 扩展）——
    // note_link 建双记录（forward + note_linked_from，pairId 配对）；消费方（BacklinkPanel /
    // Graph / 派生器）仍按 forward 维度查询，不受影响。
    const rev = rs.relations.find((r) => r.type === 'note_linked_from' && r.sourceId === 'nb-B' && r.targetId === 'nb-A')
    expect(rev).toBeDefined()
    expect(fwd!.pairId).toBe(rev!.pairId)
    // 该源笔记的派生 forward 恰好 1 条（幂等基线）
    expect(rs.relations.filter((r) => r.type === 'note_link' && r.sourceId === 'nb-A')).toHaveLength(1)
  })

  it('幂等短路：无变化重跑 → 零写入（返回 false，关系数不变）', async () => {
    const es = useEntityStore()
    const rs = useRelationStore()
    await es.add(makeNote('nb-A', '笔记A', '[[笔记B]]'))
    await es.add(makeNote('nb-B', '笔记B', ''))

    await recomputeNoteLinks('nb-A')
    const countAfterFirst = rs.relations.length
    const changed = await recomputeNoteLinks('nb-A')
    expect(changed).toBe(false)
    expect(rs.relations.length).toBe(countAfterFirst)
  })

  it('删除引用文本（保存语义）→ 重算清除关系（成对删除）', async () => {
    const es = useEntityStore()
    const rs = useRelationStore()
    await es.add(makeNote('nb-A', '笔记A', '[[笔记B]]'))
    await es.add(makeNote('nb-B', '笔记B', ''))
    await recomputeNoteLinks('nb-A')

    const noteA = es.entityMap.get('nb-A')!
    await es.update('nb-A', { properties: { ...noteA.properties, content: '引用已删除' } }, 'user', { skipUndo: true })
    const changed = await recomputeNoteLinks('nb-A')
    expect(changed).toBe(true)
    expect(rs.relations.filter((r) => r.sourceId === 'nb-A' || r.targetId === 'nb-A')).toHaveLength(0)
  })

  it('目标改名断链 → 重算（解析 miss）清除关系', async () => {
    const es = useEntityStore()
    const rs = useRelationStore()
    await es.add(makeNote('nb-A', '笔记A', '[[笔记B]]'))
    await es.add(makeNote('nb-B', '笔记B', ''))
    await recomputeNoteLinks('nb-A')

    await es.update('nb-B', { name: '笔记B改名' }, 'user')
    await recomputeNoteLinks('nb-A')
    expect(rs.relations.filter((r) => r.type === 'note_link' && r.sourceId === 'nb-A')).toHaveLength(0)
  })

  it('歧义（同名两篇）→ 不建关系（裁决 E：不自动猜）', async () => {
    const es = useEntityStore()
    const rs = useRelationStore()
    await es.add(makeNote('nb-A', '笔记A', '[[同名]]'))
    await es.add(makeNote('nb-B1', '同名', ''))
    await es.add(makeNote('nb-B2', '同名', ''))

    const changed = await recomputeNoteLinks('nb-A')
    expect(changed).toBe(false)
    expect(rs.relations.filter((r) => r.type === 'note_link' && r.sourceId === 'nb-A')).toHaveLength(0)
  })

  it('自引用跳过（[[自己名]] 不建关系）', async () => {
    const es = useEntityStore()
    const rs = useRelationStore()
    await es.add(makeNote('nb-A', '笔记A', '[[笔记A]]'))

    const changed = await recomputeNoteLinks('nb-A')
    expect(changed).toBe(false)
    expect(rs.relations.filter((r) => r.sourceId === 'nb-A')).toHaveLength(0)
  })

  it('skipUndo：重算的增删不进全局撤销栈', async () => {
    const es = useEntityStore()
    const { undoStack } = useUndoRedo()
    await es.add(makeNote('nb-A', '笔记A', '[[笔记B]]'))
    await es.add(makeNote('nb-B', '笔记B', ''))
    undoStack.value = [] // 清掉前置写入的记录

    await recomputeNoteLinks('nb-A') // 建关系（有变更）
    expect(undoStack.value).toHaveLength(0)

    const noteA = es.entityMap.get('nb-A')!
    await es.update('nb-A', { properties: { ...noteA.properties, content: '' } }, 'user', { skipUndo: true })
    await recomputeNoteLinks('nb-A') // 删关系（有变更）
    expect(undoStack.value).toHaveLength(0)
  })

  it('并发调用同笔记：串行队列收敛，不重复建关系', async () => {
    const es = useEntityStore()
    const rs = useRelationStore()
    await es.add(makeNote('nb-A', '笔记A', '[[笔记B]]'))
    await es.add(makeNote('nb-B', '笔记B', ''))

    await Promise.all([recomputeNoteLinks('nb-A'), recomputeNoteLinks('nb-A')])
    expect(rs.relations.filter((r) => r.type === 'note_link' && r.sourceId === 'nb-A')).toHaveLength(1)
  })

  it('实体不存在 → 安全返回 false（不炸）', async () => {
    expect(await recomputeNoteLinks('不存在的id')).toBe(false)
  })
})

// ────────────────────────────────────────────────
// ③b recomputeAllNoteLinks · 全量重算（进视图时机，阶段 2）
// ────────────────────────────────────────────────
describe('recomputeAllNoteLinks · 全量重算（进视图时机）', () => {
  it('全量：多篇笔记引用统一重建', async () => {
    const es = useEntityStore()
    const rs = useRelationStore()
    await es.add(makeNote('nb-A', '笔记A', '[[笔记B]]'))
    await es.add(makeNote('nb-B', '笔记B', '[[笔记A]]'))
    await es.add(makeNote('nb-C', '笔记C', ''))

    const count = await recomputeAllNoteLinks()
    expect(count).toBe(3)
    const links = rs.relations.filter((r) => r.type === 'note_link')
    expect(links.map((r) => `${r.sourceId}->${r.targetId}`).sort()).toEqual(['nb-A->nb-B', 'nb-B->nb-A'])
  })

  it('幂等：无变化全量重跑 → 关系数不变（短路零写入）', async () => {
    const es = useEntityStore()
    const rs = useRelationStore()
    await es.add(makeNote('nb-A', '笔记A', '[[笔记B]]'))
    await es.add(makeNote('nb-B', '笔记B', ''))
    await recomputeAllNoteLinks()
    const snapshot = rs.relations.length
    await recomputeAllNoteLinks()
    expect(rs.relations.length).toBe(snapshot)
    expect(snapshot).toBe(2) // A→B forward + B→A 反记录（note_linked_from，pairId 配对）
  })

  it('孤儿清理：源/目标实体已不存在的 note_link 被清除（无状态自愈）', async () => {
    const es = useEntityStore()
    const rs = useRelationStore()
    await es.add(makeNote('nb-B', '笔记B', ''))
    // 模拟残留（崩溃窗口 / 外部直改存储）：
    await rs.add({
      id: 'rel-orphan-src', type: 'note_link', sourceId: 'ghost-1', targetId: 'nb-B',
      properties: {}, createdAt: '', updatedAt: '',
    }, 'user', { skipUndo: true })
    await rs.add({
      id: 'rel-orphan-tgt', type: 'note_link', sourceId: 'nb-B', targetId: 'ghost-2',
      properties: {}, createdAt: '', updatedAt: '',
    }, 'user', { skipUndo: true })

    await recomputeAllNoteLinks()
    // 前者（source 不存在）任何笔记的重算都覆盖不到——只能由孤儿清理删除；
    // 后者（source=nb-B 但 target 不存在）同时会被 nb-B 的重算自然收敛——最终态一致即可。
    expect(rs.relations.find((r) => r.id === 'rel-orphan-src')).toBeUndefined()
    expect(rs.relations.find((r) => r.id === 'rel-orphan-tgt')).toBeUndefined()
  })
})

// ────────────────────────────────────────────────
// ④ 纯函数：computeDesiredLinks / computeLinkDiff
// ────────────────────────────────────────────────
describe('computeDesiredLinks / computeLinkDiff · 纯函数', () => {
  it('desired 集合：过滤 miss / 歧义 / 自引用', () => {
    const self = makeNote('nb-A', '笔记A', '[[笔记B]] [[不存在]] [[笔记A]]')
    const others = [makeNote('nb-B', '笔记B'), makeNote('nb-A', '笔记A')]
    const desired = computeDesiredLinks(self, others)
    expect([...desired]).toEqual(['nb-B'])
  })

  it('code 型笔记：desired 恒为空集（content 非 md，不参与派生）', () => {
    const codeNote: Entity = {
      ...makeNote('nb-X', '代码笔记'),
      properties: { content: 'x = "[[笔记B]]"', noteType: 'code' },
    }
    const others = [makeNote('nb-B', '笔记B')]
    expect(computeDesiredLinks(codeNote, others).size).toBe(0)
  })

  it('diff：增删集合正确、互不相交', () => {
    const rel = (id: string, targetId: string) => ({
      id, type: 'note_link', sourceId: 'nb-A', targetId,
      properties: {}, createdAt: '', updatedAt: '',
    })
    const current = [rel('r1', 'B'), rel('r2', 'C')]
    const desired = new Set(['B', 'D'])
    const { toAdd, toRemove } = computeLinkDiff(desired, current)
    expect(toAdd).toEqual(['D'])
    expect(toRemove.map((r) => r.id)).toEqual(['r2'])
  })
})
