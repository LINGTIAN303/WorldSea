import { describe, it, expect } from 'vitest'
import { richHtml } from '../richText'

/**
 * 段落式富文本渲染守卫。详细见
 * docs/details/注释/packages/plugin-sdk/实体详情内容形态.md §六
 *
 * 这个面的存在理由就一条：**用户数据进 v-html 之前必须过消毒**。
 * 所以最要紧的是最后那例攻击载荷，而不是排版细节。
 */

describe('richHtml —— 两条渲染分支', () => {
  it('空值不产节点', () => {
    expect(richHtml('textarea', '')).toBe('')
    expect(richHtml('richtext', '')).toBe('')
  })

  it('长文本按 markdown 渲：标题/列表/粗体成结构，单换行保留软断行', () => {
    const html = richHtml('textarea', '## 早年\n- 出身**渔村**\n第二行')
    expect(html).toContain('<h2>早年</h2>')
    expect(html).toContain('<li>出身<strong>渔村</strong>')
    expect(html).toContain('<br')
  })

  it('富文本字段按已存 HTML 直渲，不再过一遍 markdown（避免把 <p> 里的字符当语法）', () => {
    const html = richHtml('richText', '<p>第一段<strong>强调</strong></p>')
    expect(html).toContain('<strong>强调</strong>')
    expect(html).toContain('<p>')
  })
})

describe('richHtml —— 消毒（两分支都必须过）', () => {
  const PAYLOADS = [
    '<img src=x onerror="alert(1)">',
    '<script>alert(2)</script>',
    '<a href="javascript:alert(3)">点我</a>',
    '<iframe src="https://evil.test"></iframe>',
  ]

  for (const fieldType of ['textarea', 'richtext', 'text']) {
    it(`${fieldType}：脚本、事件属性、javascript: 链接与 iframe 一律不存活`, () => {
      for (const payload of PAYLOADS) {
        const html = richHtml(fieldType, payload)
        expect(html, payload).not.toMatch(/onerror\s*=/i)
        expect(html, payload).not.toMatch(/<script/i)
        expect(html, payload).not.toMatch(/javascript:/i)
        expect(html, payload).not.toMatch(/<iframe/i)
      }
    })
  }
})
