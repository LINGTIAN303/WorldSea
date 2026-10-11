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

/**
 * 笔记正文装载归一（幂等）：md 信号渲染 → HTML 放行 → 纯文本拆段。
 * 三态顺序与理由见文件头注释。
 */
export function normalizeNoteContent(content: string): string {
  if (!content) return ''
  if (looksLikeMarkdown(content)) return renderMarkdownForEditor(content)
  if (content.includes('<')) return content
  return plainTextToEditorHtml(content)
}
