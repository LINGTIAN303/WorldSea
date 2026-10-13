import { renderFullMarkdown, sanitizeMarkdownHtml } from '@worldsea/shared-ui/markdown/stream'
import { normalizeFieldType } from './fieldType'

/**
 * 段落式正文的富文本输出。只读面里**只有段落式**走真渲染，其余走 `fieldValue.toDisplayText`（别复制 v-html）；
 * 复用主窗口内核（`@worldsea/shared-ui/markdown/stream`＝marked+DOMPurify，子路径导入免拖 Prism 进首屏），两分支按**存储形态**分：`richtext` 只消毒直渲、其余长文本走 markdown 渲染，都过 DOMPurify。
 * 详细见 docs/details/注释/packages/plugin-sdk/实体详情内容形态.md §6.2
 */
export function richHtml(fieldType: string, text: string): string {
  if (!text) return ''
  return normalizeFieldType(fieldType) === 'richtext'
    ? sanitizeMarkdownHtml(text)
    : renderFullMarkdown(text, null)
}
