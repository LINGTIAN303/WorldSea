/**
 * treeRows 单测 —— 树式表现形式的行构建（纯函数）
 *
 * 覆盖：scope='all' / 'this' 两种范围、展开折叠对可见行的影响、层级与状态读取、
 * 断链与成环下不死循环、默认展开集合、高度估算。
 */
import { describe, it, expect } from 'vitest'
import {
  TREE_ROW_HEIGHT,
  buildTreeRows,
  defaultExpandedIds,
  estimateTreeHeight,
  treeNodeName,
  treeNodeStatus,
  type TreeSourceNode,
} from '../board/forms/treeRows'

function mk(id: string, parentId = '', order = 0, extra: Partial<TreeSourceNode> = {}): TreeSourceNode {
  return {
    id,
    name: extra.name ?? id,
    properties: { parentId, order, status: extra.properties?.status ?? '未写' },
  } as unknown as TreeSourceNode
}

/** root → (a → a1), b */
const tree: TreeSourceNode[] = [
  mk('root', '', 1, { name: '第一章' }),
  mk('a', 'root', 1, { name: '场景A', properties: { status: '草稿' } } as never),
  mk('a1', 'a', 1, { name: '镜头1' }),
  mk('b', 'root', 2, { name: '场景B' }),
]

describe('treeRows / 基础读值', () => {
  it('名称与状态回退', () => {
    expect(treeNodeName(mk('x', '', 0, { name: '  ' }))).toBe('未命名节点')
    expect(treeNodeName(mk('x', '', 0, { name: '有名字' }))).toBe('有名字')
    expect(treeNodeStatus(mk('x'))).toBe('未写')
  })
})

describe('treeRows / buildTreeRows', () => {
  it("scope='all' 且全部折叠时只显示根层", () => {
    const rows = buildTreeRows({ nodes: tree, scope: 'all', expanded: new Set() })
    expect(rows.map(r => r.id)).toEqual(['root'])
    expect(rows[0].depth).toBe(0)
    expect(rows[0].hasChildren).toBe(true)
    expect(rows[0].expanded).toBe(false)
  })

  it("scope='all' 展开中间层时逐层下探（深度优先）", () => {
    const rows = buildTreeRows({ nodes: tree, scope: 'all', expanded: new Set(['root']) })
    expect(rows.map(r => r.id)).toEqual(['root', 'a', 'b'])
    expect(rows.map(r => r.depth)).toEqual([0, 1, 1])
    expect(rows.find(r => r.id === 'a')?.status).toBe('草稿')
  })

  it('再展开一层则出现孙节点', () => {
    const rows = buildTreeRows({ nodes: tree, scope: 'all', expanded: new Set(['root', 'a']) })
    expect(rows.map(r => r.id)).toEqual(['root', 'a', 'a1', 'b'])
    expect(rows.find(r => r.id === 'a1')?.depth).toBe(2)
  })

  it("scope='this' 只显示该节点的子树（自身不作行）", () => {
    const rows = buildTreeRows({ nodes: tree, scope: 'this', rootId: 'root', expanded: new Set(['a']) })
    expect(rows.map(r => r.id)).toEqual(['a', 'a1', 'b'])
    expect(rows[0].depth).toBe(0)
  })

  it("scope='this' 但 rootId 缺失时退化为全部根（防御）", () => {
    const rows = buildTreeRows({ nodes: tree, scope: 'this', expanded: new Set() })
    expect(rows.map(r => r.id)).toEqual(['root'])
  })

  it('叶子节点 hasChildren=false 且展开集合包含它也无影响', () => {
    const rows = buildTreeRows({ nodes: tree, scope: 'all', expanded: new Set(['root', 'b']) })
    const b = rows.find(r => r.id === 'b')
    expect(b?.hasChildren).toBe(false)
    expect(rows.map(r => r.id)).toEqual(['root', 'a', 'b'])
  })

  it('成环数据不导致无限递归', () => {
    const cyclic = [mk('x', 'y', 1), mk('y', 'x', 1)]
    const rows = buildTreeRows({ nodes: cyclic, scope: 'all', expanded: new Set(['x', 'y']) })
    expect(rows.length).toBeLessThan(10)
  })

  it('空节点集返回空行', () => {
    expect(buildTreeRows({ nodes: [], scope: 'all', expanded: new Set() })).toEqual([])
  })
})

describe('treeRows / defaultExpandedIds', () => {
  it('展开前 N 层（depth=1 只展开根层）', () => {
    const ids = defaultExpandedIds(tree, 'all', undefined, 1)
    expect([...ids].sort()).toEqual(['root'])
  })

  it('depth=2 连中间层一起展开', () => {
    const ids = defaultExpandedIds(tree, 'all', undefined, 2)
    expect([...ids].sort()).toEqual(['a', 'root'])
  })

  it('depth<=0 返回空集合', () => {
    expect(defaultExpandedIds(tree, 'all', undefined, 0).size).toBe(0)
  })

  it("scope='this' 从 rootId 起算", () => {
    const ids = defaultExpandedIds(tree, 'this', 'root', 1)
    expect([...ids].sort()).toEqual(['a'])
  })
})

describe('treeRows / 高度估算', () => {
  it('按行数估算并受上限钳制', () => {
    expect(estimateTreeHeight(3)).toBe(3 * TREE_ROW_HEIGHT + 8)
    expect(estimateTreeHeight(0)).toBe(TREE_ROW_HEIGHT + 8)
    expect(estimateTreeHeight(50, 10)).toBe(10 * TREE_ROW_HEIGHT + 8)
  })
})
