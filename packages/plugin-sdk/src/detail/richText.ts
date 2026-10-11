import { renderFullMarkdown, sanitizeMarkdownHtml } from '@worldsea/shared-ui/markdown/stream'
import { normalizeFieldType } from './fieldType'

/**
 * 段落式正文的富文本输出。详细见 docs/details/注释/packages/plugin-sdk/实体详情内容形态.md §6.2
 *
 * 只读面里**只有段落式**走真渲染；分组/表格/摘要/时间轴走 `fieldValue.toDisplayText` 的
 * 「去语法留内容」（§6.1）——别把 v-html 复制到那些面上。
 *
 * 复用主窗口同一内核（`@worldsea/shared-ui/markdown/stream`：marked + **DOMPurify**），
 * 不再在详情面造第二套 markdown 实现；导入走 `/markdown/stream` 子路径而不是包根，
 * 免得把 Prism 的十三个语言组件一起拖进工作台首屏。
 *
 * 两条分支的差别是**存储形态**而不是字段类型：
 * - `richtext` 存的是编辑器写出的 HTML → 只消毒直渲（再过一遍 markdown 会把 `<p>` 里的
 *   `*` 之类字符当语法误解析）；
 * - 其余长文本存的是纯文本/markdown 源 → 走 markdown 渲染。
 * 两条都过 DOMPurify，**不存在裸 `v-html` 用户数据的路径**。
 */
export function richHtml(fieldType: string, text: string): string {
  if (!text) return ''
  return normalizeFieldType(fieldType) === 'richtext'
    ? sanitizeMarkdownHtml(text)
    : renderFullMarkdown(text, null)
}
