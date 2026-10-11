/**
 * outlineHierarchy 单测 —— 右栏层级重排的计算与快照比对（纯函数）。
 */
import { describe, it, expect } from 'vitest'
import {
  captureHierarchy,
  diffHierarchy,
  dropModeFromRatio,
  isDescendantOrSelf,
  planReparent,
  type DropMode,
} from '../board/outlineHierarchy'
import type { NodeLike } from '../board/outlineDerive'

function mk(id: string, parentId = '', order = 1): NodeLike {
  return { id, properties: { parentId, order } } as unknown as NodeLike
}

/** root → a(1) b(2)；a → a1(1) a2(2) */
function fixture(): NodeLike[] {
  return [
    mk('root', '', 1),
    mk('a', 'root', 1),
    mk('b', 'root', 2),
    mk('a1', 'a', 1),
    mk('a2', 'a', 2),
  ]
}

function ordersOf(nodes: NodeLike[], parentId: string): string[] {
  return nodes
    .filter(n => ((n.properties as Record<string, unknown>).parentId as string) === parentId)
    .sort((x, y) => Number((x.properties as Record<string, unknown>).order) - Number((y.properties as Record<string, unknown>).order))
    .map(n => n.id)
}

describe('outlineHierarchy / 落点语义', () => {
  it('按纵向比例三分区', () => {
    expect(dropModeFromRatio(0.1)).toBe<DropMode>('before')
    expect(dropModeFromRatio(0.5)).toBe<DropMode>('child')
    expect(dropModeFromRatio(0.9)).toBe<DropMode>('after')
  })

  it('非法比例回退为 child', () => {
    expect(dropModeFromRatio(Number.NaN)).toBe<DropMode>('child')
  })
})

describe('outlineHierarchy / 防环', () => {
  it('自身与后代都判定为真', () => {
    const nodes = fixture()
    expect(isDescendantOrSelf(nodes, 'a', 'a')).toBe(true)
    expect(isDescendantOrSelf(nodes, 'a', 'a1')).toBe(true)
    expect(isDescendantOrSelf(nodes, 'a1', 'a')).toBe(false)
  })
})

describe('outlineHierarchy / planReparent', () => {
  it('成为目标节点的子节点（追加到末尾）', () => {
    const nodes = fixture()
    const plan = planReparent(nodes, 'b', 'a', 'child')
    expect(plan).not.toBeNull()
    const b = plan?.find(u => u.id === 'b')
    expect(b).toEqual({ id: 'b', parentId: 'a', order: 3 })
    // 旧父下归一化：root 只剩自身
    expect(plan?.some(u => u.id === 'root')).toBe(false)
  })

  it('插到目标之前（同级）', () => {
    const nodes = fixture()
    const plan = planReparent(nodes, 'b', 'a', 'before')
    const b = plan?.find(u => u.id === 'b')
    expect(b).toEqual({ id: 'b', parentId: 'root', order: 1 })
    const a = plan?.find(u => u.id === 'a')
    expect(a).toEqual({ id: 'a', parentId: 'root', order: 2 })
  })

  it('插到目标之后（同级）', () => {
    const nodes = fixture()
    const plan = planReparent(nodes, 'a', 'b', 'after')
    expect(plan?.find(u => u.id === 'a')).toEqual({ id: 'a', parentId: 'root', order: 2 })
    expect(plan?.find(u => u.id === 'b')).toEqual({ id: 'b', parentId: 'root', order: 1 })
  })

  it('把子节点提升为同级（拖到父节点之后）', () => {
    const nodes = fixture()
    const plan = planReparent(nodes, 'a1', 'a', 'after')
    expect(plan?.find(u => u.id === 'a1')).toEqual({ id: 'a1', parentId: 'root', order: 2 })
    // a 下的 a2 归一化为 1
    expect(plan?.find(u => u.id === 'a2')).toEqual({ id: 'a2', parentId: 'a', order: 1 })
  })

  it('拖到自己身上返回 null', () => {
    expect(planReparent(fixture(), 'a', 'a', 'child')).toBeNull()
  })

  it('拖到自己后代下返回 null（防环）', () => {
    expect(planReparent(fixture(), 'a', 'a1', 'child')).toBeNull()
  })

  it('节点不存在返回 null', () => {
    expect(planReparent(fixture(), 'ghost', 'a', 'child')).toBeNull()
    expect(planReparent(fixture(), 'a', 'ghost', 'child')).toBeNull()
  })

  it('无实际变化时返回 null（已在该父下且序号不变）', () => {
    const nodes = [mk('p', '', 1), mk('c', 'p', 1)]
    // 把 c 拖到 p 上（成为子节点，位置不变）
    expect(planReparent(nodes, 'c', 'p', 'child')).toBeNull()
  })

  it('更新集覆盖所有需要写库的节点（含被拖者）', () => {
    const nodes = fixture()
    const plan = planReparent(nodes, 'a2', 'b', 'before') ?? []
    expect(plan.map(u => u.id).sort()).toEqual(['a2', 'b'])
  })

  it('执行更新集后的顺序符合预期（模拟写库回放）', () => {
    const nodes = fixture()
    const plan = planReparent(nodes, 'b', 'a', 'child') ?? []
    const byId = new Map(nodes.map(n => [n.id, { id: n.id, properties: { ...(n.properties as Record<string, unknown>) } }]))
    for (const u of plan) {
      const target = byId.get(u.id)
      if (!target) continue
      target.properties.parentId = u.parentId
      target.properties.order = u.order
    }
    const all = [...byId.values()] as unknown as NodeLike[]
    // b 已挂到 a 下 → root 的直接子节点只剩 a；a 下为 a1、a2、b
    expect(ordersOf(all, '')).toEqual(['root'])
    expect(ordersOf(all, 'root')).toEqual(['a'])
    expect(ordersOf(all, 'a')).toEqual(['a1', 'a2', 'b'])
  })
})

describe('outlineHierarchy / 层级快照', () => {
  it('captureHierarchy 采集全部节点的 parentId 与 order', () => {
    const snap = captureHierarchy(fixture())
    expect(snap.a).toEqual({ parentId: 'root', order: 1 })
    expect(snap.a2).toEqual({ parentId: 'a', order: 2 })
  })

  it('diffHierarchy 只返回差异项', () => {
    const nodes = fixture()
    const snap = captureHierarchy(nodes)
    expect(diffHierarchy(nodes, snap)).toEqual([])

    const moved = fixture()
    const b = moved.find(n => n.id === 'b') as NodeLike
    ;(b.properties as Record<string, unknown>).parentId = 'a'
    ;(b.properties as Record<string, unknown>).order = 3
    const diff = diffHierarchy(moved, snap)
    expect(diff).toEqual([{ id: 'b', parentId: 'root', order: 2 }])
  })

  it('快照之后新建的节点不参与回滚', () => {
    const nodes = fixture()
    const snap = captureHierarchy(nodes)
    nodes.push(mk('new', '', 3))
    expect(diffHierarchy(nodes, snap)).toEqual([])
  })
})
