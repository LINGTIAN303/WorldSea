/**
 * boardUndo 单测 —— 白板撤销栈（纯逻辑，不接 store）。
 * 覆盖两类条目（snapshot / field）的 undo-redo 序列、混用顺序、栈深上限与入栈去噪。
 */
import { describe, it, expect } from 'vitest'
import {
  BOARD_UNDO_LIMIT,
  useBoardUndo,
  type BoardSnapshot,
} from '../board/composables/useBoardUndo'
import type { OutlineBoardLayout } from '../board/layoutSchema'

function layoutWith(count: number): OutlineBoardLayout {
  return {
    version: 1,
    sections: [],
    containers: Array.from({ length: count }, (_, i) => ({
      id: `c${i}`,
      nodeId: `n${i}`,
      pos: { x: i * 10, y: i * 10 },
      components: [],
    })),
  }
}

/** 搭一个受控环境：记录每次快照回放与字段回放，便于断言顺序 */
function setup() {
  let layout = layoutWith(0)
  const snapshotApplies: number[] = []
  const fieldApplies: Array<{ nodeId: string; values: Record<string, unknown> }> = []
  const entityOps: Array<{ op: 'restore' | 'remove'; ids: string[] }> = []

  const api = useBoardUndo({
    getSnapshot: (): BoardSnapshot => ({ layout: JSON.parse(JSON.stringify(layout)) as OutlineBoardLayout }),
    applySnapshot: (snap: BoardSnapshot): void => {
      layout = snap.layout
      snapshotApplies.push(snap.layout.containers.length)
    },
    applyField: (nodeId: string, values: Record<string, unknown>): void => {
      fieldApplies.push({ nodeId, values })
    },
    restoreEntities: async (p) => { entityOps.push({ op: 'restore', ids: p.nodes.map(n => n.id) }) },
    removeEntities: async (p) => { entityOps.push({ op: 'remove', ids: p.nodes.map(n => n.id) }) },
  })

  return {
    api,
    setLayout: (n: number) => { layout = layoutWith(n) },
    currentCount: () => layout.containers.length,
    snapshotApplies,
    fieldApplies,
    entityOps,
  }
}

describe('useBoardUndo / 快照条目', () => {
  it('record 后 undo 回到变更前，redo 回到变更后', async () => {
    const t = setup()
    t.setLayout(1)
    t.api.record() // 变更前：1 个容器
    t.setLayout(3) // 变更后：3 个容器

    expect(t.api.canUndo.value).toBe(true)
    expect(await t.api.undo()).toBe(true)
    expect(t.currentCount()).toBe(1)
    expect(t.api.canRedo.value).toBe(true)
    expect(await t.api.redo()).toBe(true)
    expect(t.currentCount()).toBe(3)
  })

  it('空栈 undo / redo 返回 false 且不改状态', async () => {
    const t = setup()
    expect(await t.api.undo()).toBe(false)
    expect(await t.api.redo()).toBe(false)
    expect(t.snapshotApplies).toEqual([])
  })

  it('新操作清空重做栈（标准撤销语义）', async () => {
    const t = setup()
    t.api.record()
    t.setLayout(2)
    await t.api.undo()
    expect(t.api.canRedo.value).toBe(true)
    t.api.record() // 新的变更
    t.setLayout(5)
    expect(t.api.canRedo.value).toBe(false)
  })
})

describe('useBoardUndo / 字段条目（内容就地编辑）', () => {
  it('undo 写回旧值，redo 写回新值', async () => {
    const t = setup()
    t.api.recordContentEdit('n1', { name: '旧标题' }, { name: '新标题' })
    expect(t.api.canUndo.value).toBe(true)

    await t.api.undo()
    expect(t.fieldApplies).toEqual([{ nodeId: 'n1', values: { name: '旧标题' } }])

    await t.api.redo()
    expect(t.fieldApplies).toEqual([
      { nodeId: 'n1', values: { name: '旧标题' } },
      { nodeId: 'n1', values: { name: '新标题' } },
    ])
  })

  it('前后值相同不入栈（点开编辑又关掉不占步数）', async () => {
    const t = setup()
    t.api.recordContentEdit('n1', { name: '一样' }, { name: '一样' })
    expect(t.api.canUndo.value).toBe(false)
    expect(t.api.depth.value).toBe(0)
  })

  it('nodeId 为空时忽略（防御）', async () => {
    const t = setup()
    t.api.recordContentEdit('', { name: 'a' }, { name: 'b' })
    expect(t.api.depth.value).toBe(0)
  })

  it('多字段条目按整体比较（描述与标题同时变仍算一步）', async () => {
    const t = setup()
    t.api.recordContentEdit('n9', { name: 'a', description: 'x' }, { name: 'a', description: 'y' })
    expect(t.api.depth.value).toBe(1)
    await t.api.undo()
    expect(t.fieldApplies[0]).toEqual({ nodeId: 'n9', values: { name: 'a', description: 'x' } })
  })
})

describe('useBoardUndo / 混用与栈深', () => {
  it('快照与字段条目混用时，撤销顺序严格后进先出', async () => {
    const t = setup()
    // ① 改名（字段）
    t.api.recordContentEdit('n1', { name: 'A' }, { name: 'B' })
    // ② 移动容器（快照）
    t.setLayout(1)
    t.api.record()
    t.setLayout(4)

    await t.api.undo() // 先撤快照
    expect(t.currentCount()).toBe(1)
    expect(t.fieldApplies).toHaveLength(0)

    await t.api.undo() // 再撤字段
    expect(t.fieldApplies).toEqual([{ nodeId: 'n1', values: { name: 'A' } }])
  })

  it('栈深超过上限时丢弃最旧的一条', async () => {
    const t = setup()
    for (let i = 0; i < BOARD_UNDO_LIMIT + 5; i++) {
      t.api.recordContentEdit(`n${i}`, { name: 'x' }, { name: 'y' })
    }
    expect(t.api.depth.value).toBe(BOARD_UNDO_LIMIT)
    // 全部弹出后栈空
    let undone = 0
    while (await t.api.undo()) undone++
    expect(undone).toBe(BOARD_UNDO_LIMIT)
  })

  it('clear 清空两个栈（切白板时不跨板撤销）', async () => {
    const t = setup()
    t.api.record()
    t.setLayout(2)
    await t.api.undo()
    expect(t.api.canRedo.value).toBe(true)
    t.api.clear()
    expect(t.api.canUndo.value).toBe(false)
    expect(t.api.canRedo.value).toBe(false)
  })

  it('快照写入隔离：回放的是克隆体（外部改动不影响栈内数据）', async () => {
    const t = setup()
    t.setLayout(2)
    t.api.record()
    t.setLayout(7)
    // 篡改当前布局不应影响已入栈的快照
    t.setLayout(9)
    await t.api.undo()
    expect(t.currentCount()).toBe(2)
  })
})

describe('useBoardUndo / 实体删除条目（2026-10-19）', () => {
  const node = (id: string) => ({ id, type: 'outline_node', properties: {} }) as never

  function record(t: ReturnType<typeof setup>, ids: string[]) {
    t.api.recordEntityDelete({
      nodes: ids.map(node),
      relations: [],
      chapterLinks: [],
      before: { layout: layoutWith(ids.length) },
      after: { layout: layoutWith(0) },
    })
  }

  it('undo 回到删除前布局并重建实体；redo 回到删除后并再删一次', async () => {
    const t = setup()
    t.setLayout(0)
    record(t, ['n1', 'n2'])
    expect(t.api.depth.value).toBe(1)

    await t.api.undo()
    expect(t.currentCount()).toBe(2)
    expect(t.entityOps).toEqual([{ op: 'restore', ids: ['n1', 'n2'] }])

    await t.api.redo()
    expect(t.currentCount()).toBe(0)
    expect(t.entityOps).toEqual([
      { op: 'restore', ids: ['n1', 'n2'] },
      { op: 'remove', ids: ['n1', 'n2'] },
    ])
  })

  it('空节点集合不入栈（避免 Ctrl+Z 空转一步）', () => {
    const t = setup()
    t.api.recordEntityDelete({ nodes: [], relations: [], chapterLinks: [], before: { layout: layoutWith(0) }, after: { layout: layoutWith(0) } })
    expect(t.api.depth.value).toBe(0)
  })

  it('实体条目与布局条目混用：按后进先出，不互相污染', async () => {
    const t = setup()
    t.setLayout(3)
    t.api.record() // 布局条目
    t.setLayout(1)
    record(t, ['n9']) // 实体条目

    await t.api.undo() // 先撤实体
    expect(t.entityOps).toHaveLength(1)
    expect(t.snapshotApplies).toEqual([1])

    await t.api.undo() // 再撤布局
    expect(t.currentCount()).toBe(3)
  })
})
