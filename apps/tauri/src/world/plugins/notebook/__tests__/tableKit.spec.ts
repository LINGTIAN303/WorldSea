/**
 * TipTap 表格扩展接线验证（二期）
 *
 * 覆盖的是「编辑器配置 + 表格命令」这一层的真实运行时行为 —— 类型检查验不出这些：
 * - TableKit（v3 四件套合集，同 useNoteEditor / useChapterEditor 的配置）能否正常装配；
 * - insertTable 产出的文档结构（表头行 + 数据行 + 列数）；
 * - 工具栏依赖的结构命令（行/列增删、表头切换、删除表格）；
 * - 含表格 HTML 的 setContent 回读（笔记内容是 HTML 落库，打开旧笔记必须能还原）。
 *
 * 直接用 @tiptap/core 的 Editor（jsdom 环境），不经过 Vue 组合式 —— 那层的接线只有
 * 三行（extensions 数组加一项），由 vue-tsc 保证；这里锁住的是行为契约。
 *
 * 实测锁定的两个 v3 行为契约（断言依据，改配置前先读）：
 * 1. `resizable: true` 时表格渲染为 `<table style="min-width: …">` + `<colgroup>`（列宽拖拽的载体）；
 * 2. `insertTable({ rows })` 的 rows 是**含表头在内的总行数**（rows:3 = 表头 1 + 数据 2）；
 * 3. 单元格渲染为 `<th|td colspan="1" rowspan="1"><p>…</p></th|td>`。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'

/** 与 useNoteEditor / useChapterEditor 相同的扩展配置（同一份配置，改一处须两处同步） */
function createEditor(): Editor {
  return new Editor({
    extensions: [StarterKit, TableKit.configure({ table: { resizable: true } })],
    content: '',
  })
}

const editors: Editor[] = []
function makeEditor(): Editor {
  const ed = createEditor()
  editors.push(ed)
  return ed
}
afterEach(() => {
  while (editors.length) editors.pop()?.destroy()
})

/** 数表格里的单元格数（th + td） */
function countCells(html: string): number {
  return html.match(/<(th|td)[ >]/g)?.length ?? 0
}

/** 数表格行数（tr） */
function countRows(html: string): number {
  return html.match(/<tr[ >]/g)?.length ?? 0
}

describe('TableKit · 装配', () => {
  it('insertTable 产出 rows×cols（含表头行），且光标在表格内', () => {
    const ed = makeEditor()
    // rows:3 = 表头 1 行 + 数据 2 行（v3 语义：总行数）
    ed.commands.insertTable({ rows: 3, cols: 3, withHeaderRow: true })

    expect(ed.isActive('table')).toBe(true)
    const html = ed.getHTML()
    expect(html).toContain('<table')
    // resizable 的载体：列宽 colgroup
    expect(html).toContain('<colgroup')
    // 表头行用 th，数据行用 td：1 行 × 3 列 th + 2 行 × 3 列 td
    expect(html.match(/<th[ >]/g)?.length).toBe(3)
    expect(html.match(/<td[ >]/g)?.length).toBe(6)
    expect(countRows(html)).toBe(3)
  })

  it('isActive 状态随光标离开表格而消失', () => {
    const ed = makeEditor()
    ed.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: false })
    expect(ed.isActive('table')).toBe(true)
    // 光标移到文档末尾（表格之后）
    ed.commands.focus('end')
    expect(ed.isActive('table')).toBe(false)
  })

  it('含表格的 HTML 经 setContent 回读后结构与内容保持', () => {
    const ed = makeEditor()
    const tableHtml =
      '<table><tr><th>名称</th><th>类别</th></tr><tr><td>灰烬之刃</td><td>武器</td></tr></table>'
    ed.commands.setContent(`<p>设定如下</p>${tableHtml}`)

    const html = ed.getHTML()
    expect(html).toContain('<table')
    expect(html).toContain('灰烬之刃')
    expect(html).toContain('名称')
    expect(countRows(html)).toBe(2)
    expect(countCells(html)).toBe(4)
  })
})

describe('TableKit · 结构命令（工具栏依赖的六个操作）', () => {
  it('addRowAfter / deleteRow 增删行', () => {
    const ed = makeEditor()
    ed.commands.insertTable({ rows: 3, cols: 2, withHeaderRow: true })
    const before = countRows(ed.getHTML())

    ed.commands.addRowAfter()
    expect(countRows(ed.getHTML())).toBe(before + 1)

    ed.commands.deleteRow()
    expect(countRows(ed.getHTML())).toBe(before)
  })

  it('addColumnAfter / deleteColumn 增删列（每行各增一格）', () => {
    const ed = makeEditor()
    ed.commands.insertTable({ rows: 2, cols: 3, withHeaderRow: true })
    const rowCount = countRows(ed.getHTML())
    const before = countCells(ed.getHTML())
    expect(before).toBe(rowCount * 3)

    ed.commands.addColumnAfter()
    expect(countCells(ed.getHTML())).toBe(before + rowCount)

    ed.commands.deleteColumn()
    expect(countCells(ed.getHTML())).toBe(before)
  })

  it('toggleHeaderRow 切换首行 th/td', () => {
    const ed = makeEditor()
    ed.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true })
    expect(ed.getHTML()).toContain('<th')

    ed.commands.toggleHeaderRow()
    expect(ed.getHTML()).not.toContain('<th')

    ed.commands.toggleHeaderRow()
    expect(ed.getHTML()).toContain('<th')
  })

  it('deleteTable 移除整表且状态退出', () => {
    const ed = makeEditor()
    ed.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true })
    expect(ed.getHTML()).toContain('<table')

    ed.commands.deleteTable()
    expect(ed.getHTML()).not.toContain('<table')
    expect(ed.isActive('table')).toBe(false)
  })

  it('光标不在表格内时结构命令不生效（can() 为 false，支撑工具栏禁用态）', () => {
    const ed = makeEditor()
    ed.commands.setContent('<p>正文段落</p>')
    ed.commands.focus('end')

    expect(ed.can().deleteRow()).toBe(false)
    expect(ed.can().deleteColumn()).toBe(false)
    expect(ed.can().addRowAfter()).toBe(false)
  })
})
