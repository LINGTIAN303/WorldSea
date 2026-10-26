/**
 * 一键排版文档级应用测试（批2 共享化后）：applyTypographyToEditor 对真文档的变换与
 * 代码块跳过（notebook 的 CodeBlockEnhanced 经 CodeBlock.extend 同名 'codeBlock'，
 * 既有 parent 判定直接适用——本测试用官方 StarterKit 的 codeBlock 同名锁定）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Editor } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { applyTypographyToEditor } from '../typographyRules'

describe('applyTypographyToEditor（文档级）', () => {
  let editor: Editor

  beforeEach(() => {
    editor = new Editor({
      extensions: [StarterKit],
      content: '<p>正文你好,世界...</p><pre><code>code, here...</code></pre>',
    })
  })

  afterEach(() => {
    editor.destroy()
  })

  it('段落文本被排版且代码块原样跳过', () => {
    const n = applyTypographyToEditor(editor, 'off')
    expect(n).toBeGreaterThan(0)
    expect(editor.getHTML()).toContain('<p>正文你好，世界……</p>')
    expect(editor.getHTML()).toContain('<pre><code>code, here...</code></pre>')
  })

  it('无可排版项返回 0 且不派发事务', () => {
    const clean = new Editor({ extensions: [StarterKit], content: '<p>干净段落。</p>' })
    try {
      expect(applyTypographyToEditor(clean, 'off')).toBe(0)
    } finally {
      clean.destroy()
    }
  })

  it('引号风格经参数传入生效（直角）', () => {
    const q = new Editor({ extensions: [StarterKit], content: '<p>他说"你好"</p>' })
    try {
      applyTypographyToEditor(q, 'corner')
      expect(q.getHTML()).toContain('他说「你好」')
    } finally {
      q.destroy()
    }
  })
})
