/**
 * htmlToDocxBlocks —— TipTap 富文本 HTML → docx 导出中间表示（IR）
 *
 * 用途：`useManuscriptExport.htmlToDocx` 的解析层。旧实现是 `stripHTML` 后逐行成段，
 * 丢失标题层级 / 列表 / 加粗斜体 / 引用 / 代码块 / 表格 —— 本模块把 HTML 解析成
 * 与渲染无关的块级 IR，再由 `blocksToDocx.ts` 映射为 docx 库对象。
 *
 * 拆成纯函数的理由（同 `xlsxToTables.ts` 先例）：DOM 解析逻辑可被 jsdom 直接单测，
 * 不必为了测排版逻辑去启动 Vue 组件。
 *
 * 覆盖面（与两处编辑器的实际配置对齐 —— StarterKit + Mention + TableKit，无图片扩展）：
 * - h1~h6 / p / ul / ol / li（含嵌套）/ blockquote / pre / hr / table(th/td/colspan/rowspan)
 * - 行内：strong/b、em/i、u、s/strike/del、code（行内）、br
 * - mention（`span.nb-mention` / `span.ms-mention`）按普通行内文本保留
 * - `<img>` 跳过：编辑器尚未装 Image 扩展，正文不会出现；若未来装了需在此补映射
 *
 * 输入契约：html 可能来自 `exportMultiple`（各章以 `<h1>章名</h1>` + `<hr/>` 拼接），
 * 也可能为空串 —— 空串 / 纯空白一律返回 `[]`。
 */

/** 行内片段：一段连续的同格式文本 */
export interface DocxRun {
  text: string
  bold?: boolean
  italics?: boolean
  underline?: boolean
  strike?: boolean
  /** 行内代码（渲染为等宽字体 + 底纹） */
  code?: boolean
}

export interface DocxCellIr {
  /** th 或处于 thead → 表头样式（加粗 + 底纹） */
  header: boolean
  runs: DocxRun[]
  columnSpan?: number
  rowSpan?: number
}

export interface DocxRowIr {
  cells: DocxCellIr[]
}

/**
 * 块级 IR。
 * - listItem：每个 `<li>` 产出一条；`listId` 按 `<ol>`/`<ul>` 元素实例分配 ——
 *   有序列表靠它实现「每个 ol 独立从 1 开始编号」（docx 的 numbering 以 reference 为单位续号）。
 * - level：列表嵌套深度，0 起。
 */
export type DocxBlock =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; runs: DocxRun[] }
  | { kind: 'paragraph'; runs: DocxRun[]; quote?: boolean }
  | { kind: 'listItem'; ordered: boolean; listId: number; level: number; runs: DocxRun[] }
  | { kind: 'code'; lines: string[] }
  | { kind: 'hr' }
  | { kind: 'table'; rows: DocxRowIr[] }

interface ParseState {
  /** ul/ol 元素实例计数器（分配 listId） */
  listSeq: number
}

/** 把文本节点里的连续空白折叠为单空格（HTML 排版语义；`<pre>` 不走此路） */
function collapseWs(text: string): string {
  return text.replace(/[\t\n\r\f ]+/g, ' ')
}

const MARK_TAGS: Record<string, keyof Omit<DocxRun, 'text'>> = {
  STRONG: 'bold',
  B: 'bold',
  EM: 'italics',
  I: 'italics',
  U: 'underline',
  S: 'strike',
  STRIKE: 'strike',
  DEL: 'strike',
  CODE: 'code',
}

/** 深度优先收集行内片段；`out` 就地追加 */
function collectInline(node: Node, marks: Omit<DocxRun, 'text'>, out: DocxRun[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = collapseWs(node.textContent ?? '')
    if (text) out.push({ ...marks, text })
    return
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return
  const el = node as Element
  const tag = el.tagName
  if (tag === 'BR') {
    out.push({ ...marks, text: '\n' })
    return
  }
  if (tag === 'IMG') {
    // 编辑器未装 Image 扩展（2026-09-14 实测），正文不应出现 img；出现则丢弃占位
    return
  }
  const mark = MARK_TAGS[tag]
  const next = mark ? { ...marks, [mark]: true } : marks
  for (const child of Array.from(el.childNodes)) collectInline(child, next, out)
}

/** 收集并规范化一段行内内容：修剪首尾空白、丢弃空片段（保留 '\n' 换行标记） */
function inlineRunsOf(el: Element): DocxRun[] {
  const raw: DocxRun[] = []
  for (const child of Array.from(el.childNodes)) collectInline(child, {}, raw)
  return normalizeRuns(raw)
}

/** 修剪首尾空白、合并相邻同格式、丢弃空片段 */
export function normalizeRuns(raw: DocxRun[]): DocxRun[] {
  // 先合并相邻且标记完全相同的片段（跨元素边界的同格式文本拼回一段）。
  // 注意：'\n'（br 产生的换行标记）是合并边界 —— 跨它合并会把换行符嵌进
  // 普通文本片段，破坏「换行标记独立成段」的契约。
  const merged: DocxRun[] = []
  for (const run of raw) {
    const prev = merged[merged.length - 1]
    if (prev && prev.text !== '\n' && run.text !== '\n' && sameMarks(prev, run)) {
      prev.text += run.text
    } else {
      merged.push({ ...run })
    }
  }
  // 修剪整块首尾（跳过 '\n' 换行标记）
  const first = merged.findIndex(r => r.text !== '\n')
  if (first !== -1) merged[first] = { ...merged[first], text: merged[first].text.replace(/^\s+/, '') }
  const lastIdx = merged.length - 1 - [...merged].reverse().findIndex(r => r.text !== '\n')
  if (lastIdx !== -1 && merged[lastIdx]) {
    merged[lastIdx] = { ...merged[lastIdx], text: merged[lastIdx].text.replace(/\s+$/, '') }
  }
  return merged.filter(r => r.text !== '')
}

function sameMarks(a: DocxRun, b: DocxRun): boolean {
  return !!a.bold === !!b.bold && !!a.italics === !!b.italics &&
    !!a.underline === !!b.underline && !!a.strike === !!b.strike && !!a.code === !!b.code
}

const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6'])

/** 解析表格：`:scope` 限定直接行，防止嵌套表的行被外层吞走 */
function parseTable(table: Element): DocxBlock {
  const rows: DocxRowIr[] = []
  const trs = table.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr, :scope > tr')
  for (const tr of Array.from(trs)) {
    const cells: DocxCellIr[] = []
    for (const cell of Array.from(tr.children)) {
      if (cell.tagName !== 'TH' && cell.tagName !== 'TD') continue
      const colSpan = parseInt(cell.getAttribute('colspan') ?? '', 10)
      const rowSpan = parseInt(cell.getAttribute('rowspan') ?? '', 10)
      cells.push({
        header: cell.tagName === 'TH',
        runs: inlineRunsOf(cell),
        ...(Number.isFinite(colSpan) && colSpan > 1 ? { columnSpan: colSpan } : {}),
        ...(Number.isFinite(rowSpan) && rowSpan > 1 ? { rowSpan } : {}),
      })
    }
    if (cells.length) rows.push({ cells })
  }
  return { kind: 'table', rows }
}

/** 解析 ul/ol：li 的行内内容先产出，随后递归嵌套列表（层级 +1）；每个列表元素分配独立 listId */
function parseList(listEl: Element, ordered: boolean, level: number, state: ParseState, out: DocxBlock[]): void {
  const listId = ++state.listSeq
  for (const li of Array.from(listEl.children)) {
    if (li.tagName !== 'LI') continue
    // li 的行内内容：跳过嵌套的 ul/ol（它们单独递归）
    const raw: DocxRun[] = []
    for (const child of Array.from(li.childNodes)) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = (child as Element).tagName
        if (tag === 'UL' || tag === 'OL') continue
      }
      collectInline(child, {}, raw)
    }
    const runs = normalizeRuns(raw)
    if (runs.length) out.push({ kind: 'listItem', ordered, listId, level, runs })
    for (const child of Array.from(li.children)) {
      if (child.tagName === 'UL') parseList(child, false, level + 1, state, out)
      else if (child.tagName === 'OL') parseList(child, true, level + 1, state, out)
    }
  }
}

/** 块级遍历：只识别块级元素；blockquote 的子块带 quote 标记 */
function walkBlocks(parent: Element, quote: boolean, state: ParseState, out: DocxBlock[]): void {
  for (const node of Array.from(parent.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = collapseWs(node.textContent ?? '')
      if (text.trim()) out.push({ kind: 'paragraph', runs: normalizeRuns([{ text }]), ...(quote ? { quote: true } : {}) })
      continue
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue
    const el = node as Element
    const tag = el.tagName

    if (HEADING_TAGS.has(tag)) {
      const runs = inlineRunsOf(el)
      if (runs.length) out.push({ kind: 'heading', level: Number(tag[1]) as 1 | 2 | 3 | 4 | 5 | 6, runs })
    } else if (tag === 'P') {
      const runs = inlineRunsOf(el)
      if (runs.length) out.push({ kind: 'paragraph', runs, ...(quote ? { quote: true } : {}) })
    } else if (tag === 'UL') {
      parseList(el, false, 0, state, out)
    } else if (tag === 'OL') {
      parseList(el, true, 0, state, out)
    } else if (tag === 'BLOCKQUOTE') {
      walkBlocks(el, true, state, out)
    } else if (tag === 'PRE') {
      out.push({ kind: 'code', lines: (el.textContent ?? '').replace(/\n$/, '').split('\n') })
    } else if (tag === 'HR') {
      out.push({ kind: 'hr' })
    } else if (tag === 'TABLE') {
      out.push(parseTable(el))
    } else {
      // div / section 等容器：递归展开；无块级子元素时按行内内容兜底成段落
      const before = out.length
      walkBlocks(el, quote, state, out)
      if (out.length === before) {
        const runs = inlineRunsOf(el)
        if (runs.length) out.push({ kind: 'paragraph', runs, ...(quote ? { quote: true } : {}) })
      }
    }
  }
}

/** HTML → 块级 IR。空串 / 纯空白 → [] */
export function htmlToBlocks(html: string): DocxBlock[] {
  if (!html || !html.trim()) return []
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  const out: DocxBlock[] = []
  walkBlocks(parsed.body, false, { listSeq: 0 }, out)
  return out
}
