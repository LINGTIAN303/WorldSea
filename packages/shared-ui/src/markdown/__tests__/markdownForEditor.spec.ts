/**
 * renderMarkdownForEditor — 编辑器装载裸渲染契约（2026-10-11 笔记装载网关配套）。
 *
 * 核心不变量：
 * ① 产物无代码块外壳 —— ws-code-block/ws-code-copy 等外壳标签/文字不得出现
 *    （TipTap setContent 按 schema 过滤未知标签会保留其文本，外壳文字会污染正文）
 * ② 与 renderFullMarkdown 同词法 —— 同一 markdown 输入的块级结构（表格/列表/引用/
 *    围栏）两侧渲染语义一致，差异仅在外壳与 mention 注入
 * ③ 未闭合围栏 → 整段转义 + <br>（与 renderFullMarkdown 同降级语义）
 */
import { describe, it, expect } from 'vitest'
import { renderMarkdownForEditor, renderFullMarkdown } from '../markdownStream'

describe('renderMarkdownForEditor · 裸渲染契约', () => {
  it('空输入 → 空串', () => {
    expect(renderMarkdownForEditor('')).toBe('')
  })

  it('代码块渲染为裸 pre>code，不含外壳与复制按钮', () => {
    const html = renderMarkdownForEditor('```ts\nconst a = 1\n```')
    expect(html).toContain('<pre>')
    expect(html).toContain('const a = 1')
    expect(html).not.toContain('ws-code-block')
    expect(html).not.toContain('ws-code-head')
    expect(html).not.toContain('ws-code-copy')
    expect(html).not.toContain('>复制<')
    // 对照：聊天全量渲染带外壳（确认两实例差异真实存在，防裸渲染误改回共享实例）
    expect(renderFullMarkdown('```ts\nconst a = 1\n```', null)).toContain('ws-code-block')
  })

  it('GFM 表格/列表/引用/标题块级结构与全量渲染一致', () => {
    const md = [
      '# 标题',
      '',
      '| 列1 | 列2 |',
      '| --- | --- |',
      '| a | b |',
      '',
      '- 项一',
      '- 项二',
      '',
      '> 引用',
    ].join('\n')
    const raw = renderMarkdownForEditor(md)
    const full = renderFullMarkdown(md, null)
    for (const marker of ['<h1>', '<table>', '<thead>', '<ul>', '<blockquote>']) {
      expect(raw).toContain(marker)
      expect(full).toContain(marker)
    }
  })

  it('未闭合围栏 → 整段转义 + <br>（同 renderFullMarkdown 降级语义）', () => {
    const md = '前文\n\n```ts\nconst a = 1'
    const html = renderMarkdownForEditor(md)
    expect(html).not.toContain('<pre>')
    expect(html).toContain('```')
    expect(html).toContain('const a = 1')
    expect(html).toContain('<br>')
  })

  it('产物已消毒：script 标签被剥离', () => {
    const html = renderMarkdownForEditor('普通段落\n\n<script>alert(1)</script>\n')
    expect(html).not.toContain('<script')
  })
})
