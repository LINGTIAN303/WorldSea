/**
 * contentNormalize — 笔记正文的装载归一（2026-10-11 装载网关）。
 *
 * 背景：笔记本正文（properties.content）的写入方不止编辑器 —— Agent 经
 * world_entity_put/update 直写 JSON（自然产物是 markdown 纯文本）、项目导入、
 * 手工放置。历史行为是编辑器加载边界把非 HTML 内容逐行包 `<p>`，markdown 语法
 * 全部沦为字面文本（`# 标题`、`| 表格 |`、``` 代码块都不可读）。
 *
 * 本模块注册进 entity-core 装载网关（IngestNormalizers）：实体进 store 前归一，
 * 此后编辑器/预览/导出/检索只见单一格式。三态判定（按序）：
 *
 * 1. 命中 markdown 块级信号 → 裸渲染为 HTML（renderMarkdownForEditor：同聊天内核
 *    的 marked GFM 词法，但**无代码块外壳** —— 外壳的 div/button 文字会被 TipTap
 *    schema 过滤时混进正文；DOMPurify 已消毒）。**判定先于 HTML 放行**：否则 md 里
 *    混一处 `x < y` 就整篇不渲染；内嵌 HTML 交给 marked 原生透传 + 消毒兜底。
 *    信号分两级：强信号单行即中；列表类弱信号同类 ≥2 行（见下方信号集说明）
 * 2. 含 `<`（无 md 信号）→ 视为已是 HTML，原样放行（幂等关键 + 存量 HTML 零变化，
 *    与 plainTextToEditorHtml 的既有判定线一致）
 * 3. 其余纯文本 → 维持旧行为：转义后按换行拆 `<p>` 段（plainTextToEditorHtml）
 *
 * 信号集刻意保守（只认块级语法，行内 `**bold**`/`` `code` `` 不单独触发）：
 * 归一只对「明显是 markdown」的内容生效，普通文本里的孤立 `*`、`-`、`>` 不受影响。
 * 误伤无法绝对归零（见 contentNormalize.spec.ts 反例集），已按低频场景取舍。
 */

import { renderMarkdownForEditor } from '@worldsea/shared-ui/markdown'
import { plainTextToEditorHtml } from '@/composables/plainTextToEditorHtml'

/**
 * marked GFM 任务列表 → TipTap 任务列表节点形态（批 1 I2，2026-10-12）。
 *
 * marked 18 对 `- [ ] 待办` 的输出是 `<li><input disabled type="checkbox"> 文本</li>`
 * （实证：无 class 无 data-*），而官方 TaskItem 只认 `li[data-type="taskItem"]`。
 * 此处把渲染产物中的任务项规范化为 TipTap 形态（外层 ul 加 data-type=taskList、
 * li 加 data-type/data-checked 并剥掉 input 元素）——编辑器装载即得可勾选待办。
 * 仅含 checkbox 时才动 DOM（快速短路，普通内容零开销）；DOMParser 失败降级原样。
 */
function normalizeTaskListHtml(html: string): string {
  if (!html.includes('checkbox')) return html
  try {
    const doc = new DOMParser().parseFromString(`<div id="__r">${html}</div>`, 'text/html')
    const root = doc.getElementById('__r')
    if (!root) return html
    let touched = false
    root.querySelectorAll('li').forEach((li) => {
      const box = li.querySelector('input[type="checkbox"]')
      if (!box) return
      touched = true
      li.setAttribute('data-type', 'taskItem')
      li.setAttribute('data-checked', box.hasAttribute('checked') ? 'true' : 'false')
      box.remove()
      const parent = li.parentElement
      if (parent && parent.tagName === 'UL') parent.setAttribute('data-type', 'taskList')
    })
    return touched ? root.innerHTML : html
  } catch {
    return html
  }
}
/**
 * markdown 块级信号集，分两级（2026-10-11 收紧误伤）：
 *
 * 【强信号】单行命中即判定为 markdown —— 普通文本里几乎不可能出现：
 * - 标题：行首 1-6 个 `#` + 空格（中文话题标签 `#xx` 无空格不触发）
 * - 围栏：行首 ``` 或 ~~~（未闭合围栏由 renderMarkdownForEditor 整段降级，安全）
 * - 引用：行首 `>` + 空格或紧贴文字
 * - 表格：表头行（含 `|`）下一行是 GFM 分隔行（`| --- | :---: |` 形态）——
 *   要求表头/分隔两行相邻，单行含 `|` 的普通文本（"a | b"）不触发
 *
 * 【弱信号】孤行常见于非 md 文本（随手备注破折号、"1. 5折" 手滑空格），
 * **同类 ≥2 行**才判定（Agent 写的列表天然多行；单行列表在编辑器内由 TipTap
 * 输入规则实时转换，不依赖装载网关）：
 * - 无序列表：行首 `- ` / `* ` / `+ `
 * - 有序列表：行首 `1. ` / `1) `
 *
 * 刻意**不含**：`---` 分割线（中文破折号行/分隔线误伤率高）、行内强调（单行孤立
 * `**` 常见于算式与口语化强调）。
 */

/** 强信号（按单行测） */
const MD_LINE_SIGNALS: RegExp[] = [
  /^ {0,3}#{1,6} \S/,
  /^[ \t]*(?:```|~~~)/,
  /^ {0,3}> ?\S/,
]

/** GFM 表格（跨行结构：表头行 + 相邻分隔行） */
const MD_TABLE_RE =
  /^[^\n]*\|[^\n]*\n[ \t]*\|?[ \t]*:?-{1,}:?[ \t]*(?:\|[ \t]*:?-{1,}:?[ \t]*)+\|?/m

/** 弱信号（按单行测，计数） */
const MD_BULLET_RE = /^[ \t]*[-*+] \S/
const MD_ORDERED_RE = /^[ \t]*\d{1,9}[.)] \S/

/** 同类弱信号达到该行数才判定为 markdown */
const LIST_SIGNAL_MIN_LINES = 2

function looksLikeMarkdown(content: string): boolean {
  if (MD_TABLE_RE.test(content)) return true
  let bullet = 0
  let ordered = 0
  for (const line of content.split(/\r\n|\r|\n/)) {
    if (MD_LINE_SIGNALS.some(re => re.test(line))) return true
    if (MD_BULLET_RE.test(line)) bullet++
    else if (MD_ORDERED_RE.test(line)) ordered++
  }
  return bullet >= LIST_SIGNAL_MIN_LINES || ordered >= LIST_SIGNAL_MIN_LINES
}

// ── 文本表格修复（2026-10-12 走查修复） ──────────────────────────

/** 行段：`<p>| … |</p>`（行首竖线 + 行尾竖线；段内不允许 HTML 标签，保守） */
const TT_ROW = '<p>[ \\t]*\\|[^<]*\\|[ \\t]*</p>'
/** 行间间隙：空白 +（至多一个）空段——覆盖 plainTextToEditorHtml 对空行的 `<p></p>` 产物 */
const TT_GAP = '[ \\t\\r\\n]*(?:<p></p>[ \\t\\r\\n]*)?'

function isDividerCell(c: string): boolean {
  return /^:?-+:?$/.test(c)
}

function parseRowCells(text: string): string[] {
  let t = text.trim()
  if (t.startsWith('|')) t = t.slice(1)
  if (t.endsWith('|')) t = t.slice(0, -1)
  return t.split('|').map(s => s.trim())
}

/** 全空数据行（td 内无内容）：TipTap 保存态 `<td …><p></p></td>` 与裸 `<td></td>` 两态 */
const TT_EMPTY_ROW = '<tr>(?:<td[^>]*>(?:\\s*<p>\\s*</p>\\s*)?</td>)+</tr>'

/**
 * 文本表格修复：把「被降级/截断为连续文本段」的表格重排回真 `<table>`。
 *
 * 背景（2026-10-12 走查实锤）：Agent 写入的 md 表格若**行间带空行**（LLM 输出常见格式
 * 漂移），GFM 不识别或**在空行处截断** → 渲染产物为逐行 `<p>| … |</p>` 文本段；
 * 此后「含 `<` 幂等放行」使它永不再尝试转换（实例：「星海衍化」笔记多处表格为文本态，
 * 编辑/预览双侧同显源码文本）。本修复在装载归一三个出口统一收口（marked 产物 /
 * 存量 HTML 放行 / 纯文本拆段），存量与未来写入双覆盖。两条规则：
 *
 * 规则一（独立降级组）：连续 ≥3 行段，第 1 段表头、第 2 段分隔行（`:?-+:?` ≥2 格）、
 *   第 3 段起数据行；各行**列数一致**、数据行中无整体呈分隔形态者 → 转完整 `<table>`。
 * 规则二（空表 + 残留行）：表格**无任何内容 td**（表头 + 至多一个全空行；含 marked 的
 *   `thead + 空 tbody` 与 TipTap 保存态两形态）+ 紧邻 ≥1 行段（无分隔行、列数 = 表头列数）
 *   → 行段并入该表（替换/去除空行）。
 * 任一不满足 → 原样保留。产物（`<table>`）不再匹配本模式（幂等）。
 */
export function repairTextTables(html: string): string {
  if (!html || !/<p>[ \t]*\|/.test(html)) return html // 快速短路：无「段落行首竖线」直接返回
  return repairEmptyTableTail(repairStandaloneGroups(html))
}

/** 规则一：独立降级组 → `<table>` */
function repairStandaloneGroups(html: string): string {
  const groupRe = new RegExp(`${TT_ROW}(?:${TT_GAP}${TT_ROW}){2,}`, 'g')
  const rowRe = new RegExp(TT_ROW, 'g')
  return html.replace(groupRe, (group) => {
    const rows = group.match(rowRe) ?? []
    const cells = rows.map(r => parseRowCells(r.slice(3, -4)))
    const header = cells[0]
    const divider = cells[1]
    if (!divider || divider.length < 2 || !divider.every(isDividerCell)) return group
    const cols = divider.length
    if (header.length !== cols) return group
    const body = cells.slice(2)
    if (body.some(r => r.length !== cols)) return group
    if (body.some(r => r.every(isDividerCell))) return group // 数据行整体呈分隔形态 → 组内多分隔行，保守不修
    const th = header.map(c => `<th>${c}</th>`).join('')
    const trs = body.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')
    return `<table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`
  })
}

/** 规则二：无内容表格 + 紧邻行段组 → 行段并入表格（替换空行 / 插入空 tbody） */
function repairEmptyTableTail(html: string): string {
  const rowRe = new RegExp(TT_ROW, 'g')
  const emptyRowRe = new RegExp(TT_EMPTY_ROW)
  // 捕获：1=完整表格 HTML ｜2=紧邻行段组（≥1 行；行间与组前允许空白与至多一个空段）
  const mergeRe = new RegExp(
    `(<table[^>]*>(?:(?!<\\/table>)[\\s\\S])*?<\\/table>)[ \\t\\r\\n]*(?:<p></p>[ \\t\\r\\n]*)?` +
    `(${TT_ROW}(?:[ \\t\\r\\n]*(?:<p></p>[ \\t\\r\\n]*)?${TT_ROW})*)`,
    'g',
  )
  return html.replace(mergeRe, (m, table: string, group: string) => {
    if (!/<tbody[\s>]/i.test(table)) return m
    // 表内不得有内容 td（td 全空）；无 td = 仅表头，同属目标形态
    const tdAll = table.match(/<td[^>]*>[\s\S]*?<\/td>/g) ?? []
    const tdEmpty = table.match(/<td[^>]*>(?:\s*<p>\s*<\/p>\s*)?<\/td>/g) ?? []
    if (tdAll.length !== tdEmpty.length) return m
    const cols = (table.match(/<th[\s>]/g) ?? []).length
    if (cols < 2) return m
    const rows = group.match(rowRe) ?? []
    const cells = rows.map(r => parseRowCells(r.slice(3, -4)))
    if (cells.some(r => r.length !== cols)) return m
    if (cells.some(r => r.every(isDividerCell))) return m // 行组自带分隔形态 → 交由规则一，勿并入
    const dataTrs = cells.map(r => `<tr>${r.map(c => `<td><p>${c}</p></td>`).join('')}</tr>`).join('')
    // 有空行 tr（TipTap 保存态）→ 由数据行替换；否则（marked 空 tbody / 仅表头）→ 插到 </tbody> 前
    return emptyRowRe.test(table)
      ? table.replace(emptyRowRe, dataTrs)
      : table.replace(/<\/tbody>/i, `${dataTrs}</tbody>`)
  })
}

/**
 * 笔记正文装载归一（幂等）：md 信号渲染 → HTML 放行 → 纯文本拆段，出口统一过文本表格修复。
 * 三态顺序与理由见文件头注释。
 */
export function normalizeNoteContent(content: string): string {
  if (!content) return ''
  if (looksLikeMarkdown(content)) return repairTextTables(normalizeTaskListHtml(renderMarkdownForEditor(content)))
  if (content.includes('<')) return repairTextTables(content)
  return repairTextTables(plainTextToEditorHtml(content))
}
