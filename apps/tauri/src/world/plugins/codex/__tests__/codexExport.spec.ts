import { describe, expect, it } from 'vitest'
import {
  buildCodexHtml,
  buildCodexMarkdown,
  formatFieldValue,
  type CodexSectionData,
} from '../codexExport'

const selectField = { key: 'dangerLevel', label: '危险度', fieldType: 'select' as const, options: [{ value: '高危', label: '高危' }, { value: '灾厄', label: '灾厄' }] }
const multiField = { key: 'usage', label: '用途', fieldType: 'multi-select' as const, options: [{ value: '坐骑', label: '坐骑' }, { value: '药材', label: '药材' }] }
const textField = { key: 'habitat', label: '栖息环境', fieldType: 'text' as const }

const sampleSections: CodexSectionData[] = [
  {
    domainLabel: '生命与族群',
    groups: [{
      typeLabel: '生物',
      entries: [{
        name: '霜狼',
        typeLabel: '生物',
        description: '雪原群居猎手',
        tags: ['寒带'],
        fields: [
          { label: '危险度', value: '高危' },
          { label: '用途', value: '坐骑、药材' },
        ],
      }],
    }],
  },
]

describe('formatFieldValue', () => {
  it('select 匹配选项 label；未命中回落原值', () => {
    expect(formatFieldValue(selectField, '高危')).toBe('高危')
    expect(formatFieldValue(selectField, '未知值')).toBe('未知值')
  })

  it('multi-select 数组顿号连接；兼容单值字符串与空值', () => {
    expect(formatFieldValue(multiField, ['坐骑', '药材'])).toBe('坐骑、药材')
    expect(formatFieldValue(multiField, '坐骑')).toBe('坐骑')
    expect(formatFieldValue(multiField, [])).toBe('')
    expect(formatFieldValue(multiField, null)).toBe('')
  })

  it('文本字段空值返回空串', () => {
    expect(formatFieldValue(textField, '')).toBe('')
    expect(formatFieldValue(textField, '  ')).toBe('')
    expect(formatFieldValue(textField, '火山口')).toBe('火山口')
  })
})

describe('buildCodexMarkdown', () => {
  it('按 域→类型→条目 三级标题组织，字段清单带标签', () => {
    const md = buildCodexMarkdown('WorldSea 设定集', sampleSections)
    expect(md).toContain('# WorldSea 设定集')
    expect(md).toContain('## 生命与族群')
    expect(md).toContain('### 生物（1）')
    expect(md).toContain('#### 霜狼')
    expect(md).toContain('- **危险度**：高危')
    expect(md).toContain('- **标签**：寒带')
  })

  it('空描述条目不产出空段', () => {
    const md = buildCodexMarkdown('T', [{
      domainLabel: 'D',
      groups: [{ typeLabel: 'T', entries: [{ name: 'N', typeLabel: 'T', description: '', tags: [], fields: [] }] }],
    }])
    expect(md).toContain('#### N')
    expect(md).not.toContain('**标签**')
  })
})

describe('buildCodexHtml', () => {
  it('自包含 HTML 且转义用户内容', () => {
    const html = buildCodexHtml('设定集', sampleSections)
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('霜狼')
    expect(html).toContain('雪原群居猎手')
    const xss = buildCodexHtml('T', [{
      domainLabel: 'D',
      groups: [{ typeLabel: 'G', entries: [{ name: '<img src=x>', typeLabel: 'G', description: '<script>', tags: [], fields: [{ label: 'L', value: '<b>' }] }] }],
    }])
    expect(xss).not.toContain('<img src=x>')
    expect(xss).not.toContain('<script>')
    expect(xss).toContain('&lt;script&gt;')
  })
})
