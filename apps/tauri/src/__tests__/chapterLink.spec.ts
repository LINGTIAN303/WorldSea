/**
 * chapterLink 单测 —— 「章节 ↔ 大纲节点」关联的唯一写入入口。
 *
 * 这层是在修一个**实际缺陷**：此前两侧各写一个字段（`manuscript.outlineNodeId` /
 * `outline_node.manuscriptId`）且无人同步，造成双向断裂。故测试重点不在「能写」，
 * 而在**一致性**：双侧都写、1:1 清旧值、解绑清两侧、幂等、脏数据不炸。
 */
import { describe, it, expect } from 'vitest'
import type { Entity } from '@worldsea/entity-core'
import {
  buildChapterLinkIndex,
  chapterIdOfNode,
  isChapterLinkedToNode,
  linkChapterToNode,
  nodeIdOfChapter,
  unlinkChapter,
  unlinkNode,
  type ChapterLinkStore,
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

/** 最小 store 替身：内存实体表 + 记录 update 调用；**properties 整体替换**语义与真实 store 一致 */
function makeStore(seed: Entity[]) {
  const table = new Map(seed.map(e => [e.id, structuredClone(e)]))
  const calls: Array<{ id: string; patch: Record<string, unknown> }> = []
  const store: ChapterLinkStore = {
    async getAllEntities() {
      return [...table.values()].map(e => structuredClone(e))
    },
    async update(id, patch) {
      calls.push({ id, patch })
      const cur = table.get(id)
      if (!cur) return
      // 顶层浅合并 + properties 整体替换（与 entityStore 一致，避免替身语义比实现宽松）
      if (patch.properties) cur.properties = { ...patch.properties }
      if (patch.updatedAt) cur.updatedAt = patch.updatedAt
    },
  }
  return { store, table, calls }
}

describe('chapterLink / 纯判定', () => {
  it('nodeIdOfChapter / chapterIdOfNode 读字段并 trim', () => {
    expect(nodeIdOfChapter(chapter('c1', ' n1 '))).toBe('n1')
    expect(chapterIdOfNode(node('n1', ' c1 '))).toBe('c1')
    expect(nodeIdOfChapter(chapter('c1'))).toBe('')
    expect(chapterIdOfNode(undefined)).toBe('')
  })

  it('缺字段 / 空实体不抛错（脏数据容错）', () => {
    expect(nodeIdOfChapter({ id: 'x', type: 'manuscript' } as Entity)).toBe('')
    expect(chapterIdOfNode({ id: 'y', type: 'outline_node' } as Entity)).toBe('')
    expect(chapterIdOfNode(null)).toBe('')
  })

  it('isChapterLinkedToNode 只看章节侧指向', () => {
    expect(isChapterLinkedToNode(chapter('c1', 'n1'), 'n1')).toBe(true)
    expect(isChapterLinkedToNode(chapter('c1', 'n1'), 'n2')).toBe(false)
    expect(isChapterLinkedToNode(chapter('c1'), '')).toBe(false)
  })
})

describe('chapterLink / linkChapterToNode', () => {
  it('双侧都写，且返回被写的两个实体', async () => {
    const { store, table } = makeStore([chapter('c1'), node('n1')])
    const out = await linkChapterToNode(store, 'c1', 'n1')

    expect(out.written.sort()).toEqual(['c1', 'n1'])
    expect(out.cleared).toEqual([])
    expect(table.get('c1')!.properties.outlineNodeId).toBe('n1')
    expect(table.get('n1')!.properties.manuscriptId).toBe('c1')
  })

  it('1:1 —— 章节改关联到新节点时，清掉旧节点的反向字段', async () => {
    const { store, table } = makeStore([
      chapter('c1', 'n1'),
      node('n1', 'c1'),
      node('n2'),
    ])
    const out = await linkChapterToNode(store, 'c1', 'n2')

    expect(table.get('c1')!.properties.outlineNodeId).toBe('n2')
    expect(table.get('n2')!.properties.manuscriptId).toBe('c1')
    expect(table.get('n1')!.properties.manuscriptId).toBe('')
    expect(out.cleared).toEqual([{ id: 'n1', side: 'node' }])
  })

  it('1:1 —— 节点改关联到新章节时，清掉旧章节的反向字段', async () => {
    const { store, table } = makeStore([
      chapter('c1', 'n1'),
      chapter('c2'),
      node('n1', 'c1'),
    ])
    const out = await linkChapterToNode(store, 'c2', 'n1')

    expect(table.get('n1')!.properties.manuscriptId).toBe('c2')
    expect(table.get('c2')!.properties.outlineNodeId).toBe('n1')
    expect(table.get('c1')!.properties.outlineNodeId).toBe('')
    expect(out.cleared).toEqual([{ id: 'c1', side: 'chapter' }])
  })

  it('换关联：两侧各有旧值 → 两条旧关联都被清（避免出现「A 指向 B 而 B 指向 C」）', async () => {
    const { store, table } = makeStore([
      chapter('c1', 'n1'),
      chapter('c2', 'n2'),
      node('n1', 'c1'),
      node('n2', 'c2'),
    ])
    const out = await linkChapterToNode(store, 'c2', 'n1')

    // 新关联成立
    expect(table.get('c2')!.properties.outlineNodeId).toBe('n1')
    expect(table.get('n1')!.properties.manuscriptId).toBe('c2')
    // 两条旧关联都被清
    expect(table.get('c1')!.properties.outlineNodeId).toBe('')
    expect(table.get('n2')!.properties.manuscriptId).toBe('')
    expect(out.cleared.map(c => c.id).sort()).toEqual(['c1', 'n2'])
  })

  it('幂等：已互相关联时不再写入（避免无谓 store 变更与渲染）', async () => {
    const { store, calls } = makeStore([chapter('c1', 'n1'), node('n1', 'c1')])
    const out = await linkChapterToNode(store, 'c1', 'n1')
    expect(out).toEqual({ written: [], cleared: [] })
    expect(calls).toHaveLength(0)
  })

  it('只写当前 properties 的合并结果，不抹掉其它字段', async () => {
    const { store, table } = makeStore([
      { ...chapter('c1'), properties: { outlineNodeId: '', wordCount: 999, status: '终稿' } },
      node('n1'),
    ])
    await linkChapterToNode(store, 'c1', 'n1')
    expect(table.get('c1')!.properties).toMatchObject({ wordCount: 999, status: '终稿' })
  })

  it('实体不存在 / 空 id → 静默返回空结果（不抛错、不写脏数据）', async () => {
    const { store, calls } = makeStore([chapter('c1'), node('n1')])
    expect(await linkChapterToNode(store, 'missing', 'n1')).toEqual({ written: [], cleared: [] })
    expect(await linkChapterToNode(store, 'c1', 'missing')).toEqual({ written: [], cleared: [] })
    expect(await linkChapterToNode(store, '', 'n1')).toEqual({ written: [], cleared: [] })
    expect(calls).toHaveLength(0)
  })

  it('更新走顶层 updatedAt（不是写进 properties）', async () => {
    const { store, calls } = makeStore([chapter('c1'), node('n1')])
    await linkChapterToNode(store, 'c1', 'n1')
    expect(calls.every(c => typeof c.patch.updatedAt === 'string')).toBe(true)
    expect(calls.some(c => 'updatedAt' in (c.patch.properties as object))).toBe(false)
  })
})

describe('chapterLink / 解除关联', () => {
  it('从章节侧解除：两侧字段都清，实体都不删', async () => {
    const { store, table } = makeStore([chapter('c1', 'n1'), node('n1', 'c1')])
    const out = await unlinkChapter(store, 'c1')

    expect(table.get('c1')!.properties.outlineNodeId).toBe('')
    expect(table.get('n1')!.properties.manuscriptId).toBe('')
    expect(table.has('c1')).toBe(true)
    expect(table.has('n1')).toBe(true)
    expect(out.written.sort()).toEqual(['c1', 'n1'])
  })

  it('从节点侧解除：两侧字段都清', async () => {
    const { store, table } = makeStore([chapter('c1', 'n1'), node('n1', 'c1')])
    await unlinkNode(store, 'n1')
    expect(table.get('n1')!.properties.manuscriptId).toBe('')
    expect(table.get('c1')!.properties.outlineNodeId).toBe('')
  })

  it('不误伤：节点已改关联别的章节时，解除旧章节不动该节点', async () => {
    // 制造不一致历史数据：c1 指向 n1，但 n1 指向 c2
    const { store, table } = makeStore([chapter('c1', 'n1'), chapter('c2'), node('n1', 'c2')])
    await unlinkChapter(store, 'c1')
    expect(table.get('c1')!.properties.outlineNodeId).toBe('')
    expect(table.get('n1')!.properties.manuscriptId).toBe('c2')
  })

  it('本来就未关联 → 只清自己的空值，不报错', async () => {
    const { store, table } = makeStore([chapter('c1'), node('n1')])
    const out = await unlinkChapter(store, 'c1')
    expect(out.written).toEqual(['c1'])
    expect(table.get('n1')!.properties.manuscriptId).toBe('')
  })
})

describe('chapterLink / 索引与只读列表', () => {
  it('双侧汇总：只有一侧有值的「双轨历史数据」两个方向都能查到（归一化）', () => {
    const idx = buildChapterLinkIndex([
      chapter('c1', 'n1'), // 只有章节侧有值
      chapter('c2'), // 两侧都无
      node('n1'), // 节点侧被上面补上
      node('n2', 'c9'), // 只有节点侧有值
    ])
    // 章节侧声明 → 两个方向都可查
    expect(idx.nodeByChapter.get('c1')).toBe('n1')
    expect(idx.chapterByNode.get('n1')).toBe('c1')
    // 节点侧声明 → 两个方向都可查（归一化的关键：消费方不必自己写回退）
    expect(idx.chapterByNode.get('n2')).toBe('c9')
    expect(idx.nodeByChapter.get('c9')).toBe('n2')
    // 未关联的不入索引
    expect(idx.nodeByChapter.has('c2')).toBe(false)
  })

  it('空数组 → 空索引，不抛错', () => {
    const idx = buildChapterLinkIndex([])
    expect(idx.nodeByChapter.size).toBe(0)
    expect(idx.chapterByNode.size).toBe(0)
  })
})
