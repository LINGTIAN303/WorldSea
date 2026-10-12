/**
 * 块手柄逻辑回归（批 5 V4，2026-10-12）——锁定纯逻辑契约：
 *
 * - findTopBlock：任意文档位置 → 顶层块（含嵌套：列表/表格内 → 归其顶层容器）；
 * - moveBlockBy：相邻交换（含首/尾边界 no-op）；
 * - duplicateBlock / deleteBlock：文档变换正确；
 * - blockSlice：拖拽 slice 形态（开区间、单节点）。
 *
 * 鼠标追踪 / 手柄定位 / HTML5 拖放手势依赖布局与真实事件（jsdom 不可仿真），
 * 归属真机走查；此处锁「文档变换正确性」。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { findTopBlock, moveBlockBy, duplicateBlock, deleteBlock, blockSlice, indexOfBlock } from '../composables/blockHandle'

function makeEditor(html: string): Editor {
  const ed = new Editor({ extensions: [StarterKit], content: html })
  editors.push(ed)
  return ed
}

const editors: Editor[] = []
afterEach(() => {
  while (editors.length) editors.pop()?.destroy()
})

describe('findTopBlock · 顶层块定位', () => {
  it('段落内任意位置 → 定位到该段块', () => {
    const ed = makeEditor('<p>AAA</p><p>BBB</p>')
    const doc = ed.state.doc
    const block = findTopBlock(doc, 2) // 'AAA' 中间
    expect(block).not.toBeNull()
    expect(block!.node.type.name).toBe('paragraph')
    expect(block!.node.textContent).toBe('AAA')
    expect(block!.pos).toBe(0)
  })

  it('第二个块（起点）→ 位于其区间内', () => {
    const ed = makeEditor('<p>AAA</p><p>BBB</p>')
    const doc = ed.state.doc
    const secondStart = doc.child(0).nodeSize
    const block = findTopBlock(doc, secondStart + 1)
    expect(block!.node.textContent).toBe('BBB')
    expect(block!.pos).toBe(secondStart)
  })

  it('嵌套（列表项内）→ 归顶层容器（bulletList）', () => {
    const ed = makeEditor('<ul><li>A</li></ul><p>X</p>')
    const doc = ed.state.doc
    const block = findTopBlock(doc, 3) // 列表内文本附近
    expect(block).not.toBeNull()
    expect(block!.node.type.name).toBe('bulletList')
    expect(block!.pos).toBe(0)
  })

  it('边界与越界 → null；段内位置 → 非 null', () => {
    const ed = makeEditor('<p>X</p>')
    const doc = ed.state.doc
    // pos 0 = 段落起点（doc 层边界，depth 0）→ null；段内 pos 1 → depth ≥1 → 命中
    expect(findTopBlock(doc, 0)).toBeNull()
    expect(findTopBlock(doc, 1)).not.toBeNull()
    expect(findTopBlock(doc, -1)).toBeNull()
    expect(findTopBlock(doc, doc.content.size + 5)).toBeNull()
  })
})

describe('moveBlockBy · 相邻交换', () => {
  it('首块下移 → 与第二块交换', () => {
    const ed = makeEditor('<p>A</p><p>B</p><p>C</p>')
    expect(moveBlockBy(ed, 0, 1)).toBe(true)
    const texts = ed.state.doc.content.content.map(n => n.textContent)
    expect(texts).toEqual(['B', 'A', 'C'])
  })

  it('尾块上移 → 与前一块交换', () => {
    const ed = makeEditor('<p>A</p><p>B</p><p>C</p>')
    const lastStart = ed.state.doc.child(0).nodeSize + ed.state.doc.child(1).nodeSize
    expect(moveBlockBy(ed, lastStart, -1)).toBe(true)
    const texts = ed.state.doc.content.content.map(n => n.textContent)
    expect(texts).toEqual(['A', 'C', 'B'])
  })

  it('首块上移 / 尾块下移 → no-op false（文档不变）', () => {
    const ed = makeEditor('<p>A</p><p>B</p>')
    const before = ed.getHTML()
    expect(moveBlockBy(ed, 0, -1)).toBe(false)
    const lastStart = ed.state.doc.child(0).nodeSize
    expect(moveBlockBy(ed, lastStart, 1)).toBe(false)
    expect(ed.getHTML()).toBe(before)
  })

  it('跨类型块交换（标题 ⇄ 段落）保留块类型', () => {
    const ed = makeEditor('<h1>T</h1><p>P</p>')
    expect(moveBlockBy(ed, 0, 1)).toBe(true)
    expect(ed.state.doc.child(0).type.name).toBe('paragraph')
    expect(ed.state.doc.child(1).type.name).toBe('heading')
  })
})

describe('duplicateBlock / deleteBlock', () => {
  it('复制块 → 副本紧随其后（原内容不变）', () => {
    const ed = makeEditor('<p>A</p><p>B</p>')
    expect(duplicateBlock(ed, 0)).toBe(true)
    const texts = ed.state.doc.content.content.map(n => n.textContent)
    expect(texts).toEqual(['A', 'A', 'B'])
  })

  it('删除块 → 后续块前移', () => {
    const ed = makeEditor('<p>A</p><p>B</p><p>C</p>')
    const secondStart = ed.state.doc.child(0).nodeSize
    expect(deleteBlock(ed, secondStart)).toBe(true)
    const texts = ed.state.doc.content.content.map(n => n.textContent)
    expect(texts).toEqual(['A', 'C'])
  })

  it('删除唯一块 → 文档空段兜底（TrailingNode 语义：仍可继续输入）', () => {
    const ed = makeEditor('<p>only</p><p></p>')
    expect(deleteBlock(ed, 0)).toBe(true)
    expect(ed.state.doc.childCount).toBeGreaterThanOrEqual(1)
    expect(() => ed.state.doc.check()).not.toThrow()
  })
})

describe('blockSlice / indexOfBlock', () => {
  it('blockSlice → 单节点开区间 slice', () => {
    const ed = makeEditor('<p>AAA</p><p>BBB</p>')
    const doc = ed.state.doc
    const slice = blockSlice(doc, doc.child(0).nodeSize)
    expect(slice).not.toBeNull()
    expect(slice!.content.childCount).toBe(1)
    expect(slice!.content.child(0).textContent).toBe('BBB')
    expect(slice!.openStart).toBe(0)
    expect(slice!.openEnd).toBe(0)
  })

  it('indexOfBlock：块起点命中对应索引；越界 → -1', () => {
    const ed = makeEditor('<p>A</p><p>B</p>')
    const doc = ed.state.doc
    expect(indexOfBlock(doc, 0)).toBe(0)
    expect(indexOfBlock(doc, doc.child(0).nodeSize)).toBe(1)
    expect(indexOfBlock(doc, -1)).toBe(-1)
  })
})
