/**
 * outlineExport 单测 —— 导出规则逐条对齐表现形式规格的「导出形态」。
 *
 * 覆盖：标题式（depth→H1–H6 / 无编号与超层降级为列表项 / 编号前缀四种样式经由既有纯函数）、
 * 句子式（有标题式→斜体摘要；仅有句子式→普通段落）、表格式（表头恒含 + md 管道表 + 竖线转义）、
 * 树式（子树嵌套列表 + 编号前缀 + **一次性展开不再递归**）、
 * 以及两条实现期确立的语义：未入板节点按默认标题式导出（无布局也能导出完整大纲）、
 * 序列化两格式同源（HTML/MD 由同一 IR 产出）。
 */
import { describe, it, expect } from 'vitest'
import {
  blocksToHtml,
  blocksToMarkdown,
  buildOutlineExport,
  buildOutlineExportBlocks,
  type ExportSourceNode,
} from '../board/export/outlineExport'
import type { BoardComponent, OutlineBoardLayout } from '../board/layoutSchema'

function node(
  id: string,
  parentId: string,
  order: number,
  extra: { name?: string; description?: string } = {},
): ExportSourceNode {
  return {
    id,
    name: extra.name ?? id,
    description: extra.description,
    properties: { parentId, order },
  }
}

function comp(form: string, order: number, config: Record<string, unknown> = {}): BoardComponent {
  return { id: `c-${form}-${order}`, form, order, config }
}

function layoutWith(entries: Array<{ nodeId: string; components: BoardComponent[] }>): OutlineBoardLayout {
  return {
    version: 1,
    sections: [],
    containers: entries.map((e, i) => ({
      id: `ct-${i}`,
      nodeId: e.nodeId,
      pos: { x: 0, y: 0 },
      components: e.components,
    })),
  }
}

/** 三章 + 第二章下两个场景 */
const TREE: ExportSourceNode[] = [
  node('c1', '', 1, { name: '第一章' }),
  node('c2', '', 2, { name: '第二章', description: '主角夜访旧宅' }),
  node('s1', 'c2', 1, { name: '场景A' }),
  node('s2', 'c2', 2, { name: '场景B' }),
]

describe('outlineExport / 标题式', () => {
  it('depth → H1–H6，带默认数字编号', () => {
    const blocks = buildOutlineExportBlocks({ nodes: TREE })
    // 每个节点产出恰好一个主干块，顺序即语义顺序（根按 order，子随父）
    // 注意 level 由**深度**决定：两章同为根（depth 0）→ 都是 H1；场景 depth 1 → H2
    expect(blocks[0]).toEqual({ kind: 'heading', level: 1, text: '1 第一章' })
    expect(blocks[1]).toEqual({ kind: 'heading', level: 1, text: '2 第二章' })
    // 子树继续递归（未入板节点）
    expect(blocks[2]).toEqual({ kind: 'heading', level: 2, text: '2.1 场景A' })
    expect(blocks[3]).toEqual({ kind: 'heading', level: 2, text: '2.2 场景B' })
  })

  it('超 6 层降级为列表项（与 MAX_INDENT_DEPTH 同源）', () => {
    const deep: ExportSourceNode[] = []
    for (let i = 0; i < 9; i++) {
      deep.push(node(`d${i}`, i === 0 ? '' : `d${i - 1}`, 1, { name: `层${i}` }))
    }
    const blocks = buildOutlineExportBlocks({ nodes: deep })
    const headings = blocks.filter(b => b.kind === 'heading')
    const lists = blocks.filter(b => b.kind === 'list')
    expect(headings).toHaveLength(6) // H1–H6
    expect(lists.length).toBeGreaterThan(0) // 第 6 层起降级
    const firstList = lists[0] as Extract<typeof lists[0], { kind: 'list' }>
    expect(firstList.items[0].depth).toBe(6)
  })

  it('numbering=none → 全部降级为列表项且不带编号前缀', () => {
    const layout = layoutWith([{ nodeId: 'c1', components: [comp('title', 1, { numbering: 'none' })] }])
    const blocks = buildOutlineExportBlocks({ nodes: TREE, layout })
    expect(blocks[0].kind).toBe('list')
    const first = blocks[0] as { kind: 'list'; items: Array<{ text: string; depth: number }> }
    expect(first.items[0]).toEqual({ text: '第一章', depth: 0 })
  })

  it('中文编号样式经既有纯函数生效', () => {
    const layout = layoutWith([{ nodeId: 'c1', components: [comp('title', 1, { numbering: 'chinese' })] }])
    const blocks = buildOutlineExportBlocks({ nodes: TREE, layout })
    expect((blocks[0] as { text: string }).text).toBe('一、 第一章')
  })

  it('空名节点回落占位（与画布一致）', () => {
    const nodes = [node('x', '', 1, { name: '   ' })]
    const blocks = buildOutlineExportBlocks({ nodes })
    expect((blocks[0] as { text: string }).text).toContain('未命名节点')
  })
})

describe('outlineExport / 句子式', () => {
  it('容器内同时有标题式 → 斜体摘要（位于标题之后）', () => {
    const layout = layoutWith([{
      nodeId: 'c2',
      components: [comp('title', 1), comp('sentence', 2)],
    }])
    const blocks = buildOutlineExportBlocks({ nodes: TREE, layout })
    const idx = blocks.findIndex(b => b.kind === 'heading' && (b as { text: string }).text.includes('第二章'))
    expect(blocks[idx + 1]).toEqual({ kind: 'paragraph', text: '主角夜访旧宅', italic: true })
  })

  it('容器内仅有句子式 → 普通段落（非斜体）', () => {
    const layout = layoutWith([{ nodeId: 'c2', components: [comp('sentence', 1)] }])
    const blocks = buildOutlineExportBlocks({ nodes: TREE, layout })
    const idx = blocks.findIndex(b => b.kind === 'heading' && (b as { text: string }).text.includes('第二章'))
    expect(blocks[idx + 1]).toEqual({ kind: 'paragraph', text: '主角夜访旧宅' })
  })

  it('description 为空时不产出段落（即使配了句子式组件）', () => {
    // c1 无 description；c2 有但未配句子式组件 → 整篇不应出现任何段落块
    const layout = layoutWith([{ nodeId: 'c1', components: [comp('title', 1), comp('sentence', 2)] }])
    const blocks = buildOutlineExportBlocks({ nodes: TREE, layout })
    expect(blocks.filter(b => b.kind === 'paragraph')).toHaveLength(0)
  })

  it('两个节点都配句子式时各产出一条（不串行合并）', () => {
    const nodes = [
      node('a', '', 1, { name: 'A', description: '甲' }),
      node('b', '', 2, { name: 'B', description: '乙' }),
    ]
    const layout = layoutWith([
      { nodeId: 'a', components: [comp('title', 1), comp('sentence', 2)] },
      { nodeId: 'b', components: [comp('title', 1), comp('sentence', 2)] },
    ])
    const paras = buildOutlineExportBlocks({ nodes, layout }).filter(b => b.kind === 'paragraph')
    expect(paras.map(p => (p as { text: string }).text)).toEqual(['甲', '乙'])
    expect(paras.every(p => (p as { italic?: boolean }).italic === true)).toBe(true)
  })
})

describe('outlineExport / 表格式', () => {
  it('表头恒含，行 = 直接子节点（不递归）', () => {
    const layout = layoutWith([{ nodeId: 'c2', components: [comp('table', 1)] }])
    const blocks = buildOutlineExportBlocks({ nodes: TREE, layout })
    const table = blocks.find(b => b.kind === 'table')
    expect(table).toBeTruthy()
    expect(table).toMatchObject({
      header: ['标题', '状态', '字数'],
      rows: [['场景A', '未写', '—'], ['场景B', '未写', '—']],
    })
  })

  it('无子节点时不产出空表', () => {
    const layout = layoutWith([{ nodeId: 'c1', components: [comp('table', 1)] }])
    const blocks = buildOutlineExportBlocks({ nodes: TREE, layout })
    expect(blocks.some(b => b.kind === 'table')).toBe(false)
  })

  it('markdown 管道表含分隔行，且单元格竖线被转义', () => {
    const nodes = [
      node('p', '', 1, { name: '父' }),
      node('a', 'p', 1, { name: '含|竖线' }),
    ]
    const layout = layoutWith([{ nodeId: 'p', components: [comp('table', 1)] }])
    const md = buildOutlineExport({ nodes, layout }).markdown
    expect(md).toContain('| 标题 | 状态 | 字数 |')
    expect(md).toContain('| --- | --- | --- |')
    expect(md).toContain('含\\|竖线')
  })
})

describe('outlineExport / 树式', () => {
  it('子树输出为嵌套列表，且**不再逐节点递归**（避免重复）', () => {
    const layout = layoutWith([{ nodeId: 'c2', components: [comp('tree', 1)] }])
    const blocks = buildOutlineExportBlocks({ nodes: TREE, layout })
    const lists = blocks.filter(b => b.kind === 'list')
    expect(lists).toHaveLength(1)
    const items = (lists[0] as { items: Array<{ text: string; depth: number }> }).items
    expect(items).toEqual([
      { text: '场景A', depth: 0 },
      { text: '场景B', depth: 0 },
    ])
    // 关键：树式已覆盖子树 → 场景 A/B 不应再各自出现在 heading 里
    const headings = blocks.filter(b => b.kind === 'heading').map(b => (b as { text: string }).text)
    expect(headings.some(t => t.includes('场景A'))).toBe(false)
  })

  it('numbering≠none 时列表项带编号前缀', () => {
    const layout = layoutWith([{ nodeId: 'c2', components: [comp('tree', 1, { numbering: 'numeric' })] }])
    const blocks = buildOutlineExportBlocks({ nodes: TREE, layout })
    const items = (blocks.find(b => b.kind === 'list') as { items: Array<{ text: string }> }).items
    expect(items[0].text).toBe('2.1 场景A')
  })
})

describe('outlineExport / 语义：不依赖白板布局', () => {
  it('完全不传 layout（没有任何容器）→ 依然导出完整大纲', () => {
    const blocks = buildOutlineExportBlocks({ nodes: TREE })
    expect(blocks.filter(b => b.kind === 'heading')).toHaveLength(4)
  })

  it('布局里的位置/尺寸/区一概不影响产物（只读表现形式配置）', () => {
    const base = buildOutlineExportBlocks({ nodes: TREE })
    const moved = buildOutlineExportBlocks({
      nodes: TREE,
      layout: {
        ...layoutWith([]),
        sections: [{ id: 's1', rect: { x: 999, y: -50, w: 400, h: 300 }, arrange: 'free', order: 1 }],
        containers: [{
          id: 'x', nodeId: 'c2', pos: { x: 12345, y: -999 }, size: { w: 500, h: 300 },
          components: [comp('title', 1)],
        }],
      },
    })
    expect(moved).toEqual(base)
  })

  it('同一节点有多个容器时取第一个（一板一节点一容器契约）', () => {
    const layout = layoutWith([
      { nodeId: 'c1', components: [comp('title', 1, { numbering: 'none' })] },
      { nodeId: 'c1', components: [comp('title', 1, { numbering: 'numeric' })] },
    ])
    const blocks = buildOutlineExportBlocks({ nodes: TREE, layout })
    expect(blocks[0].kind).toBe('list') // 采用第一个容器（none）
  })
})

describe('outlineExport / 序列化', () => {
  it('HTML 转义特殊字符', () => {
    const nodes = [node('a', '', 1, { name: '<script>&"x"' })]
    const html = buildOutlineExport({ nodes }).html
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('HTML 的嵌套列表是真实嵌套（连击 ul/li）', () => {
    const nodes = [
      node('p', '', 1, { name: '父' }),
      node('a', 'p', 1, { name: '子' }),
      node('b', 'a', 1, { name: '孙' }),
    ]
    const layout = layoutWith([{ nodeId: 'p', components: [comp('tree', 1)] }])
    const html = buildOutlineExport({ nodes, layout }).html
    expect(html).toContain('<ul><li>子<ul><li>孙</li></ul></li></ul>')
  })

  it('markdown 用两级空格缩进表达嵌套；不带编号时仍是列表项', () => {
    const nodes = [
      node('p', '', 1, { name: '父' }),
      node('a', 'p', 1, { name: '子' }),
    ]
    const layout = layoutWith([{ nodeId: 'p', components: [comp('tree', 1)] }])
    const md = buildOutlineExport({ nodes, layout }).markdown
    expect(md).toContain('- 子')
  })

  it('两格式由同一 IR 产出（块数量一致）', () => {
    const r = buildOutlineExport({ nodes: TREE })
    expect(r.blocks).toEqual(buildOutlineExportBlocks({ nodes: TREE }))
    expect(blocksToHtml(r.blocks)).toBe(r.html)
    expect(blocksToMarkdown(r.blocks)).toBe(r.markdown)
  })

  it('markdown 产物折叠连续空行并保证结尾换行', () => {
    const md = buildOutlineExport({ nodes: TREE }).markdown
    expect(md.endsWith('\n')).toBe(true)
    expect(md.includes('\n\n\n')).toBe(false)
  })

  it('空节点集合 → 空产物不抛错', () => {
    const r = buildOutlineExport({ nodes: [] })
    expect(r.blocks).toEqual([])
    expect(r.html).toBe('')
    expect(r.markdown).toBe('\n')
  })
})
