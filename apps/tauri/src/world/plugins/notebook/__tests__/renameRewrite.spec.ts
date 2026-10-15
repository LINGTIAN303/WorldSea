/**
 * renameRewrite · 改名重写器测试（块 2 阶段 3，2026-10-15）
 *
 * ① rewriteNoteRefs 纯函数：替换 / trim 规范化 / 围栏与反引号跳过 / 转义不动 / 无命中短路；
 * ② applyNoteRename 集成（真实 store + fake-indexeddb）：
 *    改名 → 引用替换 → 关系一致（关系存 id，不因改名断链）+ **单条撤销整体回退**；
 * ③ 边界：自引用重写 / code 型跳过（content 非 md 不做引用重写）。
 *
 * 契约来源：协议 §3.5（裁决 D：全库重写 S-1）· 批计划 §2.5 / §三阶段 3。
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  getProjectManager,
  storage,
  useEntityStore,
  useRelationStore,
  useUndoRedo,
} from '@worldsea/entity-core'
import type { Entity } from '@worldsea/entity-core'
import { rewriteNoteRefs, applyNoteRename, recomputeNoteLinks } from '../backlinkDerive'

function makeNote(id: string, name: string, content = '', noteType = 'markdown'): Entity {
  const now = new Date().toISOString()
  return {
    id,
    type: 'notebook',
    name,
    description: '',
    properties: { content, noteType },
    tags: [],
    createdAt: now,
    updatedAt: now,
  }
}

beforeEach(async () => {
  setActivePinia(createPinia())
  localStorage.clear()
  const { undoStack } = useUndoRedo()
  undoStack.value = []
  await getProjectManager().initialize()
  for (const e of await storage.getAllEntities()) await storage.deleteEntity(e.id)
  for (const r of await storage.getAllRelations()) await storage.deleteRelation(r.id)
})

// ────────────────────────────────────────────────
// ① rewriteNoteRefs · 纯函数
// ────────────────────────────────────────────────
describe('rewriteNoteRefs · 纯函数', () => {
  it('基本替换 + 计数（非目标引用不动）', () => {
    const r = rewriteNoteRefs('前 [[旧名]] 与 [[其它]] 后', '旧名', '新名')
    expect(r.md).toBe('前 [[新名]] 与 [[其它]] 后')
    expect(r.count).toBe(1)
  })

  it('空格形态规范化：[[ 旧名 ]] → [[新名]]（trim 语义与派生扫描一致）', () => {
    const r = rewriteNoteRefs('[[ 旧名 ]]', '旧名', '新名')
    expect(r.md).toBe('[[新名]]')
    expect(r.count).toBe(1)
  })

  it('围栏代码块内不替换（块外正常）', () => {
    const md = ['[[旧名]]', '```', '[[旧名]]', '```', '[[旧名]]'].join('\n')
    const r = rewriteNoteRefs(md, '旧名', '新名')
    expect(r.md).toBe(['[[新名]]', '```', '[[旧名]]', '```', '[[新名]]'].join('\n'))
    expect(r.count).toBe(2)
  })

  it('行内反引号段不替换', () => {
    const r = rewriteNoteRefs('`[[旧名]]` 与 [[旧名]]', '旧名', '新名')
    expect(r.md).toBe('`[[旧名]]` 与 [[新名]]')
    expect(r.count).toBe(1)
  })

  it('转义形态不动（从来不是链接的文本不重写）', () => {
    const r = rewriteNoteRefs('前 \\[\\[旧名\\]\\] 后', '旧名', '新名')
    expect(r.md).toBe('前 \\[\\[旧名\\]\\] 后')
    expect(r.count).toBe(0)
  })

  it('无命中 / 同名 / 空名短路（原样返回）', () => {
    expect(rewriteNoteRefs('[[别的]]', '旧名', '新名')).toEqual({ md: '[[别的]]', count: 0 })
    expect(rewriteNoteRefs('[[旧名]]', '旧名', '旧名')).toEqual({ md: '[[旧名]]', count: 0 })
    expect(rewriteNoteRefs('[[旧名]]', '', '新名')).toEqual({ md: '[[旧名]]', count: 0 })
  })
})

// ────────────────────────────────────────────────
// ② applyNoteRename · 集成（真实 store + fake-indexeddb）
// ────────────────────────────────────────────────
describe('applyNoteRename · 集成', () => {
  it('改名 → 全库引用替换 + 关系一致 + 单条撤销整体回退', async () => {
    const es = useEntityStore()
    const rs = useRelationStore()
    const { undoStack, undo } = useUndoRedo()
    await es.add(makeNote('nb-A', '笔记A', '引用 [[笔记B]] 与 [[笔记C]]'))
    await es.add(makeNote('nb-B', '笔记B', ''))
    await es.add(makeNote('nb-C', '笔记C', '自 [[笔记B]] 引'))
    await recomputeNoteLinks('nb-A')
    await recomputeNoteLinks('nb-C')
    // 基线：两条关系指向 B（A→B、C→B）
    expect(rs.relations.filter((r) => r.type === 'note_link' && r.targetId === 'nb-B')).toHaveLength(2)

    undoStack.value = [] // 清前置（add / 重算的记录）
    const rewritten = applyNoteRename({
      noteId: 'nb-B',
      oldName: '笔记B',
      newName: '笔记B-新',
      changes: { name: '笔记B-新' },
    })

    // 重写命中 A 与 C 两篇
    expect(rewritten).toBe(2)
    expect(es.entityMap.get('nb-B')!.name).toBe('笔记B-新')
    expect(String(es.entityMap.get('nb-A')!.properties.content)).toContain('[[笔记B-新]]')
    expect(String(es.entityMap.get('nb-C')!.properties.content)).toContain('[[笔记B-新]]')
    // 关系一致：关系存 id 不存名——指向 B 的两条关系仍在（不断链）
    expect(rs.relations.filter((r) => r.type === 'note_link' && r.targetId === 'nb-B')).toHaveLength(2)

    // 单条撤销 → 名字与引用整体回退
    expect(undoStack.value).toHaveLength(1)
    await undo(es, rs)
    expect(es.entityMap.get('nb-B')!.name).toBe('笔记B')
    expect(String(es.entityMap.get('nb-A')!.properties.content)).toContain('[[笔记B]]')
    expect(String(es.entityMap.get('nb-C')!.properties.content)).toContain('[[笔记B]]')
  })

  it('自引用重写：被改名笔记自身正文内的 [[自己名]] 同步更新', async () => {
    const es = useEntityStore()
    await es.add(makeNote('nb-B', '笔记B', '自引用 [[笔记B]] 收'))

    const rewritten = applyNoteRename({
      noteId: 'nb-B',
      oldName: '笔记B',
      newName: '笔记B-改',
      changes: { name: '笔记B-改' },
    })
    expect(rewritten).toBe(1)
    expect(String(es.entityMap.get('nb-B')!.properties.content)).toBe('自引用 [[笔记B-改]] 收')
  })

  it('code 型跳过：重写不触碰 code 笔记 content（其非 md）', async () => {
    const es = useEntityStore()
    await es.add(makeNote('nb-A', '笔记A', '[[笔记B]]'))
    await es.add(makeNote('nb-B', '笔记B', ''))
    await es.add(makeNote('nb-X', '代码笔记', 'x = "[[笔记B]]"', 'code'))

    const rewritten = applyNoteRename({
      noteId: 'nb-B',
      oldName: '笔记B',
      newName: '笔记B-新',
      changes: { name: '笔记B-新' },
    })
    expect(rewritten).toBe(1) // 仅 A 被重写
    expect(String(es.entityMap.get('nb-X')!.properties.content)).toBe('x = "[[笔记B]]"') // 未动
    expect(String(es.entityMap.get('nb-A')!.properties.content)).toContain('[[笔记B-新]]')
  })
})
