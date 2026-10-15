/**
 * markdownText · md → 纯文本（块 1 阶段 3 单源，2026-10-15）
 * 消费方：笔记本检索（调用侧压平）/ 导出 txt（保留段落结构）。
 */
import { describe, it, expect } from 'vitest'
import { markdownToPlainText } from '../markdownText'

describe('markdownToPlainText · md 标记剥除', () => {
  it('标题 / 强调 / 行内码：剥符号、留文字', () => {
    const t = markdownToPlainText('# 标题\n\n**粗**与*斜*与`码`\n')
    expect(t).toContain('标题')
    expect(t).toContain('粗与斜与码')
    expect(t).not.toContain('#')
    expect(t).not.toContain('*')
  })

  it('列表 / 引用 / 分隔线：剥行首符号', () => {
    const t = markdownToPlainText('- 甲\n- 乙\n\n> 引用\n\n---\n')
    expect(t).toContain('甲')
    expect(t).toContain('引用')
    expect(t).not.toContain('- 甲')
    expect(t).not.toContain('---')
  })

  it('围栏代码块：去围栏、保留内部文本', () => {
    const t = markdownToPlainText('```js\nconst a = 1\n```\n')
    expect(t).toContain('const a = 1')
    expect(t).not.toContain('```')
  })

  it('链接 / 图片 / 双链：留显示文字（图片留 alt）', () => {
    const t = markdownToPlainText('[站](https://a.b) ![图](x.png) [[笔记名]]')
    expect(t).toContain('站')
    expect(t).toContain('图')
    expect(t).toContain('笔记名')
  })

  it('表格：竖线与分隔行剥除、保留单元格文字', () => {
    const t = markdownToPlainText('| A | B |\n| --- | --- |\n| 1 | 2 |\n')
    expect(t).toContain('A')
    expect(t).toContain('2')
    expect(t).not.toContain('|')
    expect(t).not.toContain('---')
  })

  it('保留段落结构（空行）且三连空行压缩为单空行', () => {
    const t = markdownToPlainText('甲\n\n\n\n乙\n')
    expect(t).toBe('甲\n\n乙')
  })

  it('空输入 → 空输出', () => {
    expect(markdownToPlainText()).toBe('')
    expect(markdownToPlainText('')).toBe('')
  })
})
