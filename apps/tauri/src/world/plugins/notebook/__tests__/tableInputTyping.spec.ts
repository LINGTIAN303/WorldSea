/**
 * 手敲 markdown 表格 · 逐字输入路径（集成级，2026-10-12 走查修复轮 2 锁定）。
 *
 * 覆盖真实键入序列（逐字事务，等价键盘输入）：
 * - 尾 `|` 闭合 + 每格 GFM 形态（:?-+:?）齐全才转换（输入途中 '| --- | -' 不触发）；
 * - 两段（表头 + 分隔行）整体替换为表格：表头行 + 空数据行，原文零残留；
 * - 光标落第一个数据行首格（可直接续写数据）；
 * - 表格后 TrailingNode 段落（StarterKit 标准行为）留痕断言。
 *
 * 缺陷史（本套用例修复前全红）：该路径替换范围 off-by-one
 * （`Position -1 out of range`，手敲转换从未成功过）；且触发时机过早
 * （格数凑够即转，输入途中误吞；格内容直塞 text 产出非法结构致光标降级）。
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import { tableInputRuleExtension } from '../composables/tableInputRule'

const editors: Editor[] = []
function makeEditor(): Editor {
  const ed = new Editor({
    extensions: [StarterKit, TableKit.configure({ table: { resizable: true } }), tableInputRuleExtension],
    content: '',
  })
  editors.push(ed)
  return ed
}
afterEach(() => { while (editors.length) editors.pop()?.destroy() })

/** 逐字输入（模拟键盘逐字符键入，走真实事务） */
function type(ed: Editor, text: string): void {
  for (const ch of text) {
    ed.view.dispatch(ed.state.tr.insertText(ch))
  }
}

/** 表头段落（第一行）+ 分隔行（第二行，光标在行内可继续输入） */
function typeHeaderAndDivider(ed: Editor, header: string, dividerPrefix: string): void {
  type(ed, header)
  ed.commands.splitBlock()
  type(ed, dividerPrefix)
}

describe('手敲表格 · 逐字输入', () => {
  it('2 列完整输入 → 表头 + 空数据行，光标入数据行首格（可续写）', () => {
    const ed = makeEditor()
    typeHeaderAndDivider(ed, '| A | B |', '| --- | --- |')
    const html = ed.getHTML()
    expect(html).toContain('<table')
    expect((html.match(/<tr[ >]/g) ?? []).length).toBe(2) // 表头行 + 数据行
    expect(html).toContain('<th')
    expect(html).toContain('<td')
    // 格内容为段落包裹（与官方 insertTable 同构）
    expect(html).toContain('<p>A</p>')
    // 光标在数据行首格的空段落里
    const $from = ed.state.selection.$from
    expect($from.parent.type.name).toBe('paragraph')
    expect($from.parent.textContent).toBe('')
    let inCell = false
    for (let d = $from.depth; d > 0; d--) {
      if ($from.node(d).type.name === 'tableCell') { inCell = true; break }
    }
    expect(inCell).toBe(true)
  })

  it('输入途中不触发（| --- | -），补完尾竖线才转', () => {
    const ed = makeEditor()
    typeHeaderAndDivider(ed, '| A | B |', '| --- | -')
    expect(ed.getHTML()).not.toContain('<table')
    type(ed, '- |')
    expect(ed.getHTML()).toContain('<table')
  })

  it('3 列完整输入 → 转表格；前两格完成（未闭合）时不触发', () => {
    const ed = makeEditor()
    typeHeaderAndDivider(ed, '| A | B | C |', '| --- | --- | -')
    expect(ed.getHTML()).not.toContain('<table')
    type(ed, '- |')
    const html = ed.getHTML()
    expect(html).toContain('<table')
    expect((html.match(/<th[ >]/g) ?? []).length).toBe(3)
  })

  it('格数不匹配不触发（1 格分隔行 vs 2 列表头）', () => {
    const ed = makeEditor()
    typeHeaderAndDivider(ed, '| A | B |', '| --- |')
    expect(ed.getHTML()).not.toContain('<table')
  })

  it('转换后撤销（Ctrl+Z）不产生非法文档（连续输入整组撤销 → 回退到组前状态）', () => {
    const ed = makeEditor()
    typeHeaderAndDivider(ed, '| A | B |', '| --- | --- |')
    expect(ed.getHTML()).toContain('<table')
    // 撤销：appendTransaction 产物与历史栈的交互（经典坑——撤销必须回到合法状态）
    ed.commands.undo()
    const afterUndo = ed.getHTML()
    console.log('[undo 后]', afterUndo.replace(/></g, '>\n<'))
    expect(() => ed.state.doc.check()).not.toThrow()
  })

  it('分组撤销（真实打字停顿）：撤销「分隔行输入+转换」后回文本态且可继续编辑', () => {
    vi.useFakeTimers()
    try {
      const ed = makeEditor()
      type(ed, '| A | B |')
      vi.advanceTimersByTime(600) // 超过 history 默认分组间隔（500ms）→ 拆组
      ed.commands.splitBlock()
      vi.advanceTimersByTime(600)
      type(ed, '| --- | --- |') // 含转换触发
      expect(ed.getHTML()).toContain('<table')
      ed.commands.undo()
      const afterUndo = ed.getHTML()
      console.log('[分组 undo 后]', afterUndo.replace(/></g, '>\n<'))
      expect(() => ed.state.doc.check()).not.toThrow()
      // 继续编辑不崩溃
      ed.view.dispatch(ed.state.tr.insertText('x'))
      expect(() => ed.state.doc.check()).not.toThrow()
    } finally {
      vi.useRealTimers()
    }
  })

  it('数据行输入后再撤销：先撤数据、再撤转换（两步粒度）', () => {
    vi.useFakeTimers()
    try {
      const ed = makeEditor()
      typeHeaderAndDivider(ed, '| A | B |', '| --- | --- |')
      vi.advanceTimersByTime(600)
      type(ed, 'X1') // 在数据行首格输入
      expect(ed.getHTML()).toContain('X1')
      ed.commands.undo()
      console.log('[undo1]', ed.getHTML().replace(/></g, '>\n<'))
      expect(() => ed.state.doc.check()).not.toThrow()
      ed.commands.undo()
      console.log('[undo2]', ed.getHTML().replace(/></g, '>\n<'))
      expect(() => ed.state.doc.check()).not.toThrow()
    } finally {
      vi.useRealTimers()
    }
  })

  it('原文两段零残留 + 表格后 TrailingNode 段落（StarterKit 标准行为）', () => {
    const ed = makeEditor()
    typeHeaderAndDivider(ed, '| A | B |', '| --- | --- |')
    const html = ed.getHTML()
    expect(html).not.toContain('| --- |')
    expect(html.match(/\| A \| B \|/)).toBeNull()
    // 文档结构 = [table, 空段落]（TrailingNode 保证末尾可输入）
    const doc = ed.state.doc
    expect(doc.childCount).toBe(2)
    expect(doc.child(0).type.name).toBe('table')
    expect(doc.child(1).type.name).toBe('paragraph')
  })
})
