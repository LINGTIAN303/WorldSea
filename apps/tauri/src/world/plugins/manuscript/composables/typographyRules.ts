import type { Editor } from '@tiptap/vue-3'
import type { Mark } from '@tiptap/pm/model'

/**
 * 一键排版规则：全部为纯函数（输入段文本 → 输出新文本 + 处理处数），在文本层面变换、
 * 不改段落结构。以「单个文本节点」为单位执行——跨文本节点的引号配对（如同一段里粗体
 * 拆开的半句）不处理，属 v1 已知限制。
 */

export type QuoteStyle = 'off' | 'curly' | 'corner'

export interface TypographyResult {
  text: string
  changes: number
}

export interface TypographyOptions {
  quoteStyle: QuoteStyle
}

/** 邻字守卫用的「中文语境」字符集：汉字 + 中文标点（含全角、弯引号、省略号、破折号） */
const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef\u2018-\u201d\u2026\u2014]/

const HALF_TO_FULL: Record<string, string> = { ',': '，', ':': '：', ';': '；', '!': '！', '?': '？', '.': '。' }

function isCjk(ch: string | undefined): boolean {
  return !!ch && CJK_RE.test(ch)
}

/** 半角标点 → 全角：仅当前后至少一侧邻中文语境字符（保护 3.5 / 1,000 / a,b） */
function normalizePunctuation(text: string): TypographyResult {
  let changes = 0
  const out = text.replace(/[,:;!?.]/g, (m, offset: number) => {
    if (!isCjk(text[offset - 1]) && !isCjk(text[offset + 1])) return m
    changes++
    return HALF_TO_FULL[m]
  })
  return { text: out, changes }
}

/** 省略号规范化：.../.... 等 → ……；不成对的 … 补齐成偶数（2/4 个不动） */
function normalizeEllipsis(text: string): TypographyResult {
  let changes = 0
  let out = text.replace(/\.{3,}/g, () => {
    changes++
    return '……'
  })
  out = out.replace(/…+/g, (m) => {
    if (m.length % 2 === 0) return m
    changes++
    return m + '…'
  })
  return { text: out, changes }
}

/** 破折号规范化：-- / --- / -— / 单个 — 等混排归一为 ——；单个连字符（1-2）不动 */
function normalizeDash(text: string): TypographyResult {
  let changes = 0
  const out = text.replace(/[-—]+/g, (m) => {
    if (m === '-' || m === '——') return m
    changes++
    return '——'
  })
  return { text: out, changes }
}

/** 引号统一（仅双引号）：段内配对状态机，把 " “ ” 按开合交替转为目标风格；直角引号嵌套（『』）不处理 */
function normalizeQuotes(text: string, style: QuoteStyle): TypographyResult {
  if (style === 'off') return { text, changes: 0 }
  const openCh = style === 'curly' ? '“' : '「'
  const closeCh = style === 'curly' ? '”' : '」'
  let changes = 0
  let expectingOpen = true
  const out = Array.from(text).map((ch) => {
    if (ch !== '"' && ch !== '“' && ch !== '”') return ch
    const target = expectingOpen ? openCh : closeCh
    expectingOpen = !expectingOpen
    if (ch !== target) changes++
    return target
  }).join('')
  return { text: out, changes }
}

/** 段首空白清除：缩进改由呈现层 text-indent 负责，内容里不留全角/半角空格 */
function trimLeadingWhitespace(text: string): TypographyResult {
  const out = text.replace(/^\s+/, '')
  return { text: out, changes: out === text ? 0 : 1 }
}

/** 对一段文本依序执行全部规则，返回新文本与累计处理处数 */
export function applyTypography(text: string, options: TypographyOptions): TypographyResult {
  let changes = 0
  let out = text
  for (const step of [
    (s: string) => trimLeadingWhitespace(s),
    (s: string) => normalizeQuotes(s, options.quoteStyle),
    (s: string) => normalizeEllipsis(s),
    (s: string) => normalizeDash(s),
    (s: string) => normalizePunctuation(s),
  ]) {
    const r = step(out)
    out = r.text
    changes += r.changes
  }
  return { text: out, changes }
}

/**
 * 对整篇文档执行排版：逐文本节点跑规则（marks 保留），倒序替换防位移；
 * 代码块内不动。单事务提交 = 单个撤销步（Ctrl+Z 一次全退）。
 * @returns 处理处数（0 = 无可排版项）
 */
export function applyTypographyToEditor(editor: Editor, quoteStyle: QuoteStyle): number {
  const { state } = editor
  const replacements: Array<{ from: number; to: number; text: string; marks: readonly Mark[] }> = []
  let total = 0
  state.doc.descendants((node, pos, parent) => {
    if (!node.isText || !node.text) return
    if (parent?.type.name === 'codeBlock') return
    const res = applyTypography(node.text, { quoteStyle })
    if (res.changes > 0 && res.text !== node.text) {
      replacements.push({ from: pos, to: pos + node.text.length, text: res.text, marks: node.marks })
      total += res.changes
    }
  })
  if (!replacements.length) return 0
  const { tr, schema } = state
  for (let i = replacements.length - 1; i >= 0; i--) {
    const r = replacements[i]
    if (r.text) tr.replaceWith(r.from, r.to, schema.text(r.text, r.marks))
    else tr.delete(r.from, r.to)
  }
  editor.view.dispatch(tr)
  return total
}
