import { describe, it, expect } from 'vitest'
import { plainTextToEditorHtml } from '../composables/plainTextToEditorHtml'

// 2026-10-02 纯文本加载归一：JSON 外部写入的 \n 不再被编辑器按 HTML 空白折叠成空格
describe('plainTextToEditorHtml', () => {
  it('纯文本按 \\n 拆段', () => {
    expect(plainTextToEditorHtml('第一行\n第二行')).toBe('<p>第一行</p><p>第二行</p>')
  })

  it('\\r\\n 与孤立 \\r 同样按换行拆段', () => {
    expect(plainTextToEditorHtml('a\r\nb\rc')).toBe('<p>a</p><p>b</p><p>c</p>')
  })

  it('空行保留为空段落（编辑器内可见空行）', () => {
    expect(plainTextToEditorHtml('甲\n\n乙')).toBe('<p>甲</p><p></p><p>乙</p>')
  })

  it('纯文本做 HTML 转义（& 与引号），避免外部内容被当标记', () => {
    expect(plainTextToEditorHtml('A & "B"')).toBe('<p>A &amp; &quot;B&quot;</p>')
  })

  it('含 < 的内容原样返回——维持既有 HTML 解析行为零变化', () => {
    const html = '<p>已格式化</p><blockquote>引用</blockquote>'
    expect(plainTextToEditorHtml(html)).toBe(html)
  })

  it('空串返回空串', () => {
    expect(plainTextToEditorHtml('')).toBe('')
  })
})
