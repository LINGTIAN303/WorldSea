/**
 * chapterLink 单测 —— 「章节 ↔ 大纲节点」关联的唯一写入入口（R6-a 关系版）。
 *
 * 契约：关系唯一真源；forward + inverse 成对；1:1 换绑清旧；幂等；旧字段只作迁移源/兜底。
 */
import { describe, it, expect } from 'vitest'
import { relationshipRegistry, type Entity, type Relation } from '@worldsea/entity-core'
import {
  buildChapterLinkIndex,
  chapterIdOfNode,
  linkChapterToNode,
  migrateLegacyChapterLinks,
  nodeIdOfChapter,
  unlinkChapter,
  unlinkNode,
  CHAPTER_LINK_REL,
  CHAPTER_LINK_INVERSE,
  type ChapterLinkStore,
  type ChapterRelationStore,
} from '../entity/chapterLink'

function chapter(id: string, outlineNodeId = ''): Entity {
  return {
    id,
    type: 'manuscript',
    name: `章节 ${id}`,
    description: '',
    properties: { outlineNodeId, wordCount: 10, status: '草稿' },
    tags: [],
    createdAt: '',
    updatedAt: '',
  }
}

function node(id: string, manuscriptId = ''): Entity {
  return {
    id,
    type: 'outline_node',
    name: `节点 ${id}`,
    description: '',
    properties: { manuscriptId, parentId: '', status: '未写' },
    tags: [],
    createdAt: '',
    updatedAt: '',
  }
}

function makeStore(seed: Entity[]): { store: ChapterLinkStore } {
  const table = new Map(seed.map(e => [e.id, structuredClone(e)]))
  return {
    store: {
      async getAllEntities() {
        return [...table.values()].map(e => structuredClone(e))
      },
    },
  }
}

function makeRelations(seed: Relation[] = []) {
  const rows = seed.map(r => structuredClone(r))
  const store: ChapterRelationStore = {
    relations: rows,
    async add(relation) {
      rows.push(structuredClone(relation))
      return relation.id
    },
    async remove(id) {
      const index = rows.findIndex(r => r.id === id)
      if (index >= 0) rows.splice(index, 1)
    },
  }
  return { store, rows }
}

const forward = (rows: Relation[]) => rows.filter(r => r.type === CHAPTER_LINK_REL)

describe('chapterLink / 关系声明', () => {
  it('outline_chapter 注册为 outline_node → manuscript', () => {
    const schema = relationshipRegistry.get(CHAPTER_LINK_REL)!
    expect(schema.sourceTypes).toEqual(['outline_node'])
    expect(schema.targetTypes).toEqual(['manuscript'])
    expect(schema.inverseType).toBe(CHAPTER_LINK_INVERSE)
  })
})

describe('chapterLink / linkChapterToNode', () => {
  it('创建 forward + inverse，成对且方向正确', async () => {
    const { store } = makeStore([chapter('c1'), node('n1')])
    const { store: rel, rows } = makeRelations()
    const out = await linkChapterToNode(store, rel, 'c1', 'n1')

    expect(out.written.sort()).toEqual(['c1', 'n1'])
    expect(rows).toHaveLength(2)
    const f = rows.find(r => r.type === CHAPTER_LINK_REL)!
    const i = rows.find(r => r.type === CHAPTER_LINK_INVERSE)!
    expect(f).toMatchObject({ sourceId: 'n1', targetId: 'c1' })
    expect(i).toMatchObject({ sourceId: 'c1', targetId: 'n1' })
    expect(f.pairId).toBeTruthy()
    expect(f.pairId).toBe(i.pairId)
  })

  it('1:1 —— 章节改关联新节点时，清旧关系对', async () => {
    const { store } = makeStore([chapter('c1'), node('n1'), node('n2')])
    const { store: rel, rows } = makeRelations()
    await linkChapterToNode(store, rel, 'c1', 'n1')
    const out = await linkChapterToNode(store, rel, 'c1', 'n2')

    expect(forward(rows)).toHaveLength(1)
    expect(forward(rows)[0]).toMatchObject({ sourceId: 'n2', targetId: 'c1' })
    expect(rows).toHaveLength(2)
    expect(out.cleared).toEqual([{ id: 'n1', side: 'node' }])
  })

  it('1:1 —— 节点改关联新章节时，清旧关系对', async () => {
    const { store } = makeStore([chapter('c1'), chapter('c2'), node('n1')])
    const { store: rel, rows } = makeRelations()
    await linkChapterToNode(store, rel, 'c1', 'n1')
    const out = await linkChapterToNode(store, rel, 'c2', 'n1')

    expect(forward(rows)).toHaveLength(1)
    expect(forward(rows)[0]).toMatchObject({ sourceId: 'n1', targetId: 'c2' })
    expect(rows).toHaveLength(2)
    expect(out.cleared).toEqual([{ id: 'c1', side: 'chapter' }])
  })

  it('幂等：已互相关联时不再写关系', async () => {
    const { store } = makeStore([chapter('c1'), node('n1')])
    const { store: rel, rows } = makeRelations()
    await linkChapterToNode(store, rel, 'c1', 'n1')
    const before = rows.length
    const out = await linkChapterToNode(store, rel, 'c1', 'n1')

    expect(out).toEqual({ written: [], cleared: [] })
    expect(rows).toHaveLength(before)
  })

  it('实体不存在 / 空 id → 静默返回空结果', async () => {
    const { store } = makeStore([chapter('c1'), node('n1')])
    const { store: rel, rows } = makeRelations()
    expect(await linkChapterToNode(store, rel, 'missing', 'n1')).toEqual({ written: [], cleared: [] })
    expect(await linkChapterToNode(store, rel, 'c1', 'missing')).toEqual({ written: [], cleared: [] })
    expect(await linkChapterToNode(store, rel, '', 'n1')).toEqual({ written: [], cleared: [] })
    expect(rows).toHaveLength(0)
  })
})

describe('chapterLink / 解除', () => {
  it('从章节侧解除：删关系对，实体不动', async () => {
    const { store } = makeStore([chapter('c1'), node('n1')])
    const { store: rel, rows } = makeRelations()
    await linkChapterToNode(store, rel, 'c1', 'n1')
    const out = await unlinkChapter(store, rel, 'c1')

    expect(rows).toHaveLength(0)
    expect(out.written.sort()).toEqual(['c1', 'n1'])
  })

  it('从节点侧解除：删关系对', async () => {
    const { store } = makeStore([chapter('c1'), node('n1')])
    const { store: rel, rows } = makeRelations()
    await linkChapterToNode(store, rel, 'c1', 'n1')
    await unlinkNode(store, rel, 'n1')

    expect(rows).toHaveLength(0)
  })

  it('未关联 → 空结果，不抛错', async () => {
    const { store } = makeStore([chapter('c1'), node('n1')])
    const { store: rel, rows } = makeRelations()
    expect(await unlinkChapter(store, rel, 'c1')).toEqual({ written: [], cleared: [] })
    expect(await unlinkNode(store, rel, 'n1')).toEqual({ written: [], cleared: [] })
    expect(rows).toHaveLength(0)
  })
})

describe('chapterLink / 索引与迁移', () => {
  it('关系优先；旧字段仅在无关系时兜底', async () => {
    const { store } = makeStore([
      chapter('c1', 'legacy-n'),
      chapter('c2', 'n1'),
      node('n1'),
      node('legacy-n'),
    ])
    const { store: rel, rows } = makeRelations()
    await linkChapterToNode(store, rel, 'c2', 'n1')

    const idx = buildChapterLinkIndex(await store.getAllEntities(), rows)
    expect(idx.nodeByChapter.get('c1')).toBe('legacy-n')
    expect(idx.nodeByChapter.get('c2')).toBe('n1')
    expect(idx.chapterByNode.get('n1')).toBe('c2')
  })

  it('迁移旧字段且幂等；冲突时章节侧优先', async () => {
    const { store } = makeStore([
      chapter('c1', 'n1'),
      chapter('c2'),
      chapter('c3', 'n3'),
      node('n1'),
      node('n2', 'c2'),
      node('n3', 'c9'),
    ])
    const { store: rel, rows } = makeRelations()
    const created = await migrateLegacyChapterLinks(store, rel)

    expect(created).toBe(3)
    expect(forward(rows).map(r => `${r.sourceId}->${r.targetId}`).sort())
      .toEqual(['n1->c1', 'n2->c2', 'n3->c3'])
    const second = await migrateLegacyChapterLinks(store, rel)
    expect(second).toBe(0)
    expect(rows).toHaveLength(6)
  })

  it('legacy field readers 仍可作为迁移源', () => {
    expect(nodeIdOfChapter(chapter('c1', ' n1 '))).toBe('n1')
    expect(chapterIdOfNode(node('n1', ' c1 '))).toBe('c1')
  })
})
