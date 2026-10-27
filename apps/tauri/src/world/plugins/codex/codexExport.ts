/**
 * 设定集导出纯函数（md / HTML）：输入已聚合的分章结构，输出整本文档字符串。
 * 与视图解耦，便于单测；下载走 Blob（与 DocExport 同机制，在视图层做）。
 */
import type { FieldSchema } from '@worldsea/entity-core'

export interface CodexFieldData { label: string; value: string }
export interface CodexEntryData {
  name: string
  typeLabel: string
  description: string
  tags: string[]
  fields: CodexFieldData[]
}
export interface CodexGroupData { typeLabel: string; entries: CodexEntryData[] }
export interface CodexSectionData { domainLabel: string; groups: CodexGroupData[] }

/** 单字段值 → 展示文本：select 匹配选项 label、multi-select 数组顿号连接、其余 String 化 */
export function formatFieldValue(field: Pick<FieldSchema, 'fieldType' | 'options'>, value: unknown): string {
  if (field.fieldType === 'multi-select') {
    if (!Array.isArray(value)) return typeof value === 'string' && value ? value : ''
    return value.map(v => {
      const opt = (field.options ?? []).find(o => o.value === v)
      return opt?.label ?? String(v)
    }).join('、')
  }
  if (value == null || typeof value === 'object') return ''
  const text = String(value)
  if (!text.trim()) return ''
  if (field.fieldType === 'select') {
    const opt = (field.options ?? []).find(o => o.value === text)
    return opt?.label ?? text
  }
  return text
}

/** 条目 → md 片段（#### 名称 + 字段清单 + 标签） */
function entryToMarkdown(entry: CodexEntryData): string {
  const lines = [`#### ${entry.name}`]
  if (entry.description.trim()) lines.push('', entry.description.trim())
  for (const field of entry.fields) lines.push(`- **${field.label}**：${field.value}`)
  if (entry.tags.length > 0) lines.push(`- **标签**：${entry.tags.join('、')}`)
  return lines.join('\n')
}

/** 整本设定集 → Markdown（# 标题 / ## 域 / ### 类型 / #### 条目） */
export function buildCodexMarkdown(title: string, sections: CodexSectionData[]): string {
  const parts = [`# ${title}`]
  for (const section of sections) {
    parts.push('', `## ${section.domainLabel}`)
    for (const group of section.groups) {
      parts.push('', `### ${group.typeLabel}（${group.entries.length}）`)
      for (const entry of group.entries) parts.push('', entryToMarkdown(entry))
    }
  }
  return parts.join('\n')
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** 整本设定集 → 自包含 HTML（内联样式，无外部依赖） */
export function buildCodexHtml(title: string, sections: CodexSectionData[]): string {
  const body = sections.map(section => {
    const groups = section.groups.map(group => {
      const entries = group.entries.map(entry => {
        const fields = entry.fields
          .map(f => `<li><b>${escapeHtml(f.label)}</b>：${escapeHtml(f.value)}</li>`)
          .join('')
        const tags = entry.tags.length > 0 ? `<li><b>标签</b>：${escapeHtml(entry.tags.join('、'))}</li>` : ''
        const desc = entry.description.trim() ? `<p class="cx-desc">${escapeHtml(entry.description.trim())}</p>` : ''
        return `<article class="cx-entry"><h4>${escapeHtml(entry.name)}</h4>${desc}<ul>${fields}${tags}</ul></article>`
      }).join('')
      return `<section class="cx-group"><h3>${escapeHtml(group.typeLabel)}（${group.entries.length}）</h3>${entries}</section>`
    }).join('')
    return `<section class="cx-domain"><h2>${escapeHtml(section.domainLabel)}</h2>${groups}</section>`
  }).join('')
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(title)}</title>
<style>
body { font-family: system-ui, sans-serif; max-width: 860px; margin: 0 auto; padding: 24px; color: #1f2328; line-height: 1.6; }
h1 { border-bottom: 2px solid #d0d7de; padding-bottom: 8px; }
h2 { margin-top: 32px; color: #24292f; }
h3 { margin: 20px 0 8px; color: #57606a; }
h4 { margin: 14px 0 4px; }
.cx-entry { border-left: 3px solid #d0d7de; padding-left: 12px; margin: 12px 0; }
.cx-entry ul { margin: 4px 0; padding-left: 20px; }
.cx-desc { margin: 4px 0; color: #424a53; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${body}
</body>
</html>
`
}
