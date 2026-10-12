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

/**
 * 拆分隔行为单元格数组（按竖线；parseTableRow 对分隔行返回 null，不能复用）。
 * 同时服务于「格数核对」与「每格完成度核对」（GFM 形态 :?-+:?）。
 */
function splitDividerCells(line: string): string[] {
  let body = line.trim()
  if (body.startsWith('|')) body = body.slice(1)
  if (body.trimEnd().endsWith('|')) body = body.trimEnd().slice(0, -1)
  return body.split('|').map(c => c.trim())
}

export const tableInputRuleExtension = Extension.create({
  name: 'notebookTableInputRule',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('notebookTableInput'),
        // 事务级兜底（批 3 走查修复）：此前用 handleTextInput，中文输入法（IME）组合输入
        // 期间不触发 → `|` 从 IME 走时手敲表格永远不转。appendTransaction 覆盖一切输入方式
        // （逐字/IME/拖放），且仅当「光标所在段 = 分隔行 + 上一段 = 等列表头」才转换
        // （历史内容不被追溯转换的约束保持）。
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some(tr => tr.docChanged)) return null
          const { $from, empty } = newState.selection
          if (!empty) return null
          // 顶层段落 depth=1（doc>paragraph>text）——此前误写 depth<2 拒掉一切正常手敲
          // （批 1 走查「表格不转」的真根因，图证：字面 | A | B | 三行不转而粘贴路径正常）
          if ($from.parent.type.name !== 'paragraph') return null
          const currentTrimmed = $from.parent.textContent.trimEnd()
          if (!isDividerRow(currentTrimmed)) return null
          // 【走查修复轮 2】「敲完」信号 = 显式闭合（尾 `|`）：
          // 逐字输入 '| --- | -' 时格数已凑够但仍在途中——此前会提前触发（复现实锤，
          // 且替换范围越界抛 Position -1 out of range）；现要求尾 `|` 收尾才判定，
          // 用户敲完最后一个竖线的瞬间转换，符合直觉。
          if (!currentTrimmed.endsWith('|')) return null
          const docLevel = $from.node($from.depth - 1)
          const index = $from.index($from.depth - 1)
          if (index === 0) return null
          const prevNode = docLevel.child(index - 1)
          if (prevNode.type.name !== 'paragraph') return null
          const prevTrimmed = prevNode.textContent.trimEnd()
          if (!isHeaderLikeRow(prevTrimmed)) return null
          const header = parseTableRow(prevTrimmed)
          if (!header || header.length < 2) return null
          // 分隔行：格数核对 + 每格 GFM 形态（:?-+:?）——含未写完格的拒绝
          const dividerCells = splitDividerCells(currentTrimmed)
          if (dividerCells.length !== header.length) return null
          if (!dividerCells.every(c => /^:?-+:?$/.test(c))) return null

          const { schema } = newState
          const tableType = schema.nodes.table
          const rowType = schema.nodes.tableRow
          const headerType = schema.nodes.tableHeader
          const cellType = schema.nodes.tableCell
          const paragraphType = schema.nodes.paragraph
          if (!tableType || !rowType || !headerType || !cellType || !paragraphType) return null

          // 【走查修复轮 2】格内容必须包 paragraph（cell 的 content spec 是 block+）：
          // 直塞 text 会产出 `<th>A</th>` 非法结构——光标定位（Selection.near）找不到
          // 合法文本位而落入降级选区（复现实锤 from=0）。官方 insertTable 同款 <p> 包裹。
          const headerRow = rowType.create(
            null,
            header.map(cell => headerType.create(null, paragraphType.create(null, schema.text(cell || ' ')))),
          )
          // 附带一个空数据行：敲完分隔行后用户下一步就是写数据，光标直接落此行首格
          const bodyRow = rowType.create(
            null,
            header.map(() => cellType.create(null, paragraphType.create())),
          )
          const tableNode = tableType.create(null, [headerRow, bodyRow])

          // 替换范围 = 上一段起点 → 当前段终点。
          // 【走查修复轮 2】原实现 replaceFrom = (段起点 - 1) - 上段 nodeSize，越界为 -1
          // （复现实锤：`Position -1 out of range`，手敲路径从未成功过）；终点也误用段起点。
          const currentBefore = $from.before($from.depth)
          const replaceFrom = currentBefore - prevNode.nodeSize
          const replaceTo = currentBefore + $from.parent.nodeSize
          const tr = newState.tr.replaceWith(replaceFrom, replaceTo, tableNode)
          // 光标进第一个数据行首格（以数据行为锚点，Selection.near 向后吸附到格内段落）
          const dataRowPos = replaceFrom + 1 + headerRow.nodeSize
          tr.setSelection(Selection.near(tr.doc.resolve(dataRowPos), 1))
          return tr
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
