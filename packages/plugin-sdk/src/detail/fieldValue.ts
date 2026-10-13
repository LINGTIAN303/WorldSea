import type { NormalizedFieldType } from './fieldType'
import { isArrayValueField } from './fieldType'

/**
 * 字段值的读写形态（纯函数）。详细见 docs/details/注释/packages/plugin-sdk/实体详情表单.md
 */

/** 剥历史富文本标签（原先在 DetailField 与 InfoPanel 各有一份，现收敛为一） */
export function stripHtml(s: string): string {
  if (!s) return s
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
}

/**
 * 只读展示的 markdown 去语法（**去语法留内容**）。详细见 docs/details/注释/packages/plugin-sdk/实体详情内容形态.md §6.1
 * 分工刻意：段落式走真渲染，编辑态显示源文（回写不能吃掉标记），其余只读面要的是一眼读得清的文本；
 * 规则保守：不动数字标号，不碰词内的 `*` 与 `_`（CommonMark 也不把词内下划线当强调）。
 */
export function stripMarkdownSyntax(s: string): string {
  if (!s) return s
  if (!/[#>*~`_!\[\]]/.test(s)) return s
  return s
    .replace(/^#{1,6}[ \t]+/gm, '')
    .replace(/^>[ \t]?/gm, '')
    .replace(/^([ \t]*)[-*+][ \t]+/gm, '$1· ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    .replace(/\*\*(\S(?:[^*\n]*\S)?)\*\*/g, '$1')
    .replace(/__(\S(?:[^_\n]*\S)?)__/g, '$1')
    .replace(/~~(\S(?:[^~\n]*\S)?)~~/g, '$1')
    .replace(/\*(\S(?:[^*\n]*\S)?)\*/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
}

/** 只读面的纯文本形态：先剥历史富文本标签，再去 markdown 语法 */
export function toPlainText(s: string): string {
  return stripMarkdownSyntax(stripHtml(s))
}

/** 数组型字段的读入形态：兼容历史的逗号串与单值（数据未定型，不能假设一定是数组） */
export function toArrayValue(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(v => String(v)).filter(s => s !== '')
  if (value === null || value === undefined || value === '') return []
  return String(value)
    .split(',')
    .map(s => s.trim())
    .filter(s => s !== '')
}

/** 输入框形态的字符串值（数组按「、」并读，不丢信息） */
export function toInputText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.join('、')
  return String(value)
}

/** 只读态的展示文本：空值统一「—」，布尔统一「是/否」 */
export function toDisplayText(value: unknown, type: NormalizedFieldType): string {
  if (type === 'multiSelect' || type === 'tags') {
    const arr = toArrayValue(value)
    return arr.length ? arr.join('、') : '—'
  }
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? '是' : '否'
  return toPlainText(String(value))
}

/** 新增自定义字段时的落库默认值（裁定 ⑪：数组型字段落数组） */
export function emptyValueFor(type: NormalizedFieldType): unknown {
  if (isArrayValueField(type)) return []
  if (type === 'number') return 0
  if (type === 'boolean') return false
  return ''
}
