/**
 * tableInputRule — 手敲 markdown 表格 → 真表格（批 1 I3，2026-10-12）。
 *
 * 背景：TipTap 官方 TableKit 无任何 markdown 表格输入规则，手敲 `| a | b |` 换行
 * `|---|---|` 永远是纯文本（Agent 写的表格走装载网关解决，人手敲这条腿一直缺）。
 *
 * 三条路径：
 * ① 纯函数解析器（本文件，可单测）：md 表格行/整表文本 → 结构化行列；
 * ② 输入拦截：光标所在段输入分隔行（`|---|---|`）且**上一段落**是表头形态、列数一致 →
 *    两段转真表格（仅光标所在段参与，历史内容不被追溯转换）；
 * ③ 粘贴拦截：整段 md 表格文本（表头+分隔+数据行）粘贴时转表格插入，走同一解析器。
 *
 * 边界（测试锁定）：列数不等不转 / 代码块等非段落内不触发 / 单元格内 `\|` 转义 /
 * 分隔行只含 `| - : 空格` / 表头+分隔即可转（数据行 0 行允许）。
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, Selection } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'

/** 单元格内转义的 `\|` 占位符（解析期间替换，防切列） */
const ESCAPED_PIPE = '\u0000'

/** 解析一行 md 表格行 → 单元格数组；非表格行（无竖线/全空白/分隔线形态）返回 null */
export function parseTableRow(line: string): string[] | null {
  const trimmed = line.trim()
  if (!trimmed.includes('|')) return null
  let body = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed
  if (body.trimEnd().endsWith('|')) body = body.trimEnd().slice(0, -1)
  if (!body.trim()) return null
  const cells = body
    .replace(/\\\|/g, ESCAPED_PIPE)
    .split('|')
    .map(cell => cell.trim().replace(new RegExp(ESCAPED_PIPE, 'g'), '|'))
  // 分隔线形态（全部单元格仅含 - : 空格且至少一个 -）不是数据行 —— GFM 语义，
  // 输入规则靠它区分「表头行」（数据）与「分隔行」（丢弃）
  if (cells.every(c => /^[-:\s]*$/.test(c)) && cells.some(c => c.includes('-'))) return null
  return cells
}

/** 是否为 GFM 分隔行（只含 | - : 空格，且至少一个 -） */
export function isDividerRow(line: string): boolean {
  const t = line.trim()
  if (!t.includes('|') && !t.includes('-')) return false
  if (!/^[\s|:\-]+$/.test(t)) return false
  return t.includes('-')
}

export interface MdTable {
  header: string[]
  rows: string[][]
}

/**
 * 解析多行文本为 md 表格；不构成表格（表头缺失/分隔行缺失/列数不一致）返回 null。
 * 空行忽略；分隔行必须在表头下一行；数据行列数必须与表头一致。
 */
export function parseMdTable(text: string): MdTable | null {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '')
  if (lines.length < 2) return null
  const header = parseTableRow(lines[0])
  if (!header) return null
  if (!isDividerRow(lines[1])) return null
  const colCount = header.length
  if (colCount < 2) return null
  // 分隔行列数：parseTableRow 对分隔行返回 null（GFM 语义），此处直接按竖线计数
  let dividerBody = lines[1].trim()
  if (dividerBody.startsWith('|')) dividerBody = dividerBody.slice(1)
  if (dividerBody.trimEnd().endsWith('|')) dividerBody = dividerBody.trimEnd().slice(0, -1)
  const dividerCols = dividerBody.split('|').length
  if (dividerCols !== colCount) return null
  const rows: string[][] = []
  for (const line of lines.slice(2)) {
    const row = parseTableRow(line)
    if (!row || row.length !== colCount) return null
    rows.push(row)
  }
  return { header, rows }
}

/** 表头形态行：可解析为单元格且不是分隔行 */
function isHeaderLikeRow(line: string): boolean {
  return parseTableRow(line) !== null && !isDividerRow(line)
}

interface RowContext {
  /** 上一段落节点文本 */
  prevText: string
  /** 上一段落整节点（拿 nodeSize 定替换起点） */
  prevNodeSize: number
  /** 上一段落替换起点（全局 pos） */
  replaceFrom: number
  /** 当前段落内，输入点之前 + 本次输入的行文本 */
  currentLine: string
}

/**
 * 从文档状态提取输入规则的上下文：仅当光标在段落内、且存在相邻的前一个段落。
 * 代码块/标题/引用/表格内一律返回 null（不触发转换）。
 */
function inputRuleContext(state: EditorState, from: number, text: string): RowContext | null {
  const { $from } = state.selection
  if ($from.parent.type.name !== 'paragraph') return null
  if ($from.depth < 2) return null
  const docLevel = $from.node($from.depth - 1)
  const index = $from.index($from.depth - 1)
  if (index === 0) return null
  const prevNode = docLevel.child(index - 1)
  if (prevNode.type.name !== 'paragraph') return null

  const paragraphStart = $from.start()
  const currentLine = state.doc.textBetween(paragraphStart, from, '\n') + text
  // 上一段落与当前段落同层相邻：prevEnd = 当前段 before - 1，prevStart = prevEnd - nodeSize
  const currentBefore = $from.before($from.depth)
  const prevEnd = currentBefore - 1
  const replaceFrom = prevEnd - prevNode.nodeSize

  return { prevText: prevNode.textContent, prevNodeSize: prevNode.nodeSize, replaceFrom, currentLine }
}

export const tableInputRuleExtension = Extension.create({
  name: 'notebookTableInputRule',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('notebookTableInput'),
        props: {
          handleTextInput: (view, from, _to, text) => {
            const { state } = view
            const ctx = inputRuleContext(state, from, text)
            if (!ctx) return false
            const currentTrimmed = ctx.currentLine.trimEnd()
            if (!isDividerRow(currentTrimmed)) return false
            const prevTrimmed = ctx.prevText.trimEnd()
            if (!isHeaderLikeRow(prevTrimmed)) return false
            const header = parseTableRow(prevTrimmed)
            const divider = parseTableRow(currentTrimmed)
            if (!header || !divider || header.length !== divider.length || header.length < 2) return false

            const { schema } = state
            const tableType = schema.nodes.table
            const rowType = schema.nodes.tableRow
            const headerType = schema.nodes.tableHeader
            if (!tableType || !rowType || !headerType) return false

            const headerRow = rowType.create(
              null,
              header.map(cell => headerType.create(null, schema.text(cell || ' '))),
            )
            const tableNode = tableType.create(null, [headerRow])

            const replaceTo = from + text.length
            const tr = state.tr.replaceWith(ctx.replaceFrom, replaceTo, tableNode)
            // 光标进表头首格（Selection.near 自动吸附到最近合法文本位）
            tr.setSelection(Selection.near(tr.doc.resolve(ctx.replaceFrom + 1)))
            view.dispatch(tr)
            return true
          },
        },
      }),
    ]
  },
})

/**
 * 粘贴拦截：整段 md 表格（表头+分隔+数据行）→ 真表格。
 * 仅当剪贴板是「纯表格文本」（非空行数 = 行数 + 2）才转换，混排长文交默认粘贴。
 */
export const tablePasteExtension = Extension.create({
  name: 'notebookTablePaste',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('notebookTablePaste'),
        props: {
          handlePaste: (view, event) => {
            const text = event.clipboardData?.getData('text/plain')
            if (!text || !text.includes('|')) return false
            const table = parseMdTable(text)
            if (!table) return false
            const lineCount = text.split(/\r?\n/).filter(l => l.trim() !== '').length
            if (lineCount !== table.rows.length + 2) return false

            const { schema } = view.state
            const tableType = schema.nodes.table
            const rowType = schema.nodes.tableRow
            const headerType = schema.nodes.tableHeader
            const cellType = schema.nodes.tableCell
            if (!tableType || !rowType || !headerType || !cellType) return false

            const makeRow = (cells: string[], type: typeof headerType) =>
              rowType.create(null, cells.map(cell => type.create(null, schema.text(cell || ' '))))
            const tableNode = tableType.create(null, [
              makeRow(table.header, headerType),
              ...table.rows.map(r => makeRow(r, cellType)),
            ])

            const tr = view.state.tr.replaceSelectionWith(tableNode)
            view.dispatch(tr)
            return true
          },
        },
      }),
    ]
  },
})
