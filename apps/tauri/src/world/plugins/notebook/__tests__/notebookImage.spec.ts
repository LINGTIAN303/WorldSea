/**
 * 图片增强扩展回归（批 5 I7，2026-10-12）——锁定「宽度/对齐」的落库与解析契约：
 *
 * - align 属性：data-align 优先、历史 align 属性兼容；
 * - renderHTML 合成对齐 style（落库自带样式，预览端无 CSS 也可正确显示）；
 * - width/height 数字属性（官方 resize 引擎 onCommit 的落库形态）往返保留；
 * - 官方 resize NodeView 装配（[data-resize-container] 结构出现在编辑器 DOM）。
 *
 * 拖拽手势本身（pointer 序列）依赖布局度量（jsdom 全 0），归属真机走查；
 * 此处锁「数据契约 + 结构装配」。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { NotebookImage } from '../composables/notebookImage'

/** 与 editorExtensions 相同配置（改一处须同步） */
function createEditor(): Editor {
  return new Editor({
    extensions: [
      StarterKit,
      NotebookImage.configure({
        inline: false,
        allowBase64: true,
        resize: { enabled: true, minWidth: 60, minHeight: 40, alwaysPreserveAspectRatio: true },
      }),
    ],
    content: '',
  })
}

const editors: Editor[] = []
function makeEditor(): Editor {
  const ed = createEditor()
  editors.push(ed)
  return ed
}
afterEach(() => {
  while (editors.length) editors.pop()?.destroy()
})

describe('NotebookImage · 对齐属性', () => {
  it('data-align 读入 → getHTML 输出 data-align + 对齐 style', () => {
    const ed = makeEditor()
    ed.commands.setContent('<img src="x.png" data-align="center">')
    const html = ed.getHTML()
    expect(html).toContain('data-align="center"')
    // DOM 序列化会把 style 规范化（冒号后空格、0→0px）——去空格后比对
    expect(html.replace(/\s/g, '')).toContain('style="display:block;margin-left:auto;margin-right:auto;"')
  })

  it('历史 align 属性兼容（读入并归一为 data-align）', () => {
    const ed = makeEditor()
    ed.commands.setContent('<img src="x.png" align="right">')
    const html = ed.getHTML()
    expect(html).toContain('data-align="right"')
    expect(html.replace(/\s/g, '')).toContain('margin-left:auto;margin-right:0px')
    expect(html).not.toMatch(/[^a-z-]align="right"/) // 旧属性不再输出（排除 data-align 子串误报）
  })

  it('无对齐 → 不输出 data-align 与 style（原样形态）', () => {
    const ed = makeEditor()
    ed.commands.setContent('<img src="x.png" alt="a">')
    const html = ed.getHTML()
    expect(html).not.toContain('data-align')
    expect(html).not.toContain('style=')
  })

  it('非法 align 值被拒（解析守卫）', () => {
    const ed = makeEditor()
    ed.commands.setContent('<img src="x.png" data-align="justify">')
    expect(ed.getHTML()).not.toContain('data-align')
  })

  it('updateAttributes 切换对齐（左/中/右/取消）', () => {
    const ed = makeEditor()
    ed.commands.setContent('<img src="x.png">')
    ed.chain().setNodeSelection(0).updateAttributes('image', { align: 'center' }).run()
    expect(ed.getHTML()).toContain('data-align="center"')
    ed.chain().setNodeSelection(0).updateAttributes('image', { align: 'left' }).run()
    expect(ed.getHTML()).toContain('data-align="left"')
    ed.chain().setNodeSelection(0).updateAttributes('image', { align: null }).run()
    expect(ed.getHTML()).not.toContain('data-align')
  })
})

describe('NotebookImage · width/height 与结构', () => {
  it('width/height 数字属性往返保留', () => {
    const ed = makeEditor()
    ed.commands.setContent('<img src="x.png" width="300" height="200">')
    const html = ed.getHTML()
    expect(html).toContain('width="300"')
    expect(html).toContain('height="200"')
  })

  it('对齐 + 宽度共存（落库形态 = 属性 + style）', () => {
    const ed = makeEditor()
    ed.commands.setContent('<img src="x.png" width="300" data-align="center">')
    const html = ed.getHTML()
    expect(html).toContain('width="300"')
    expect(html).toContain('data-align="center"')
    expect(html.replace(/\s/g, '')).toContain('margin-left:auto')
  })

  it('round-trip 幂等（getHTML → setContent → getHTML 稳定）', () => {
    const ed = makeEditor()
    ed.commands.setContent('<img src="x.png" width="300" data-align="center" alt="图">')
    const first = ed.getHTML()
    ed.commands.setContent(first)
    expect(ed.getHTML()).toBe(first)
  })

  it('resize NodeView 装配（[data-resize-container] 结构出现）', () => {
    const ed = makeEditor()
    ed.commands.setContent('<img src="data:image/png;base64,QUJD">')
    expect(ed.view.dom.querySelector('[data-resize-container]')).not.toBeNull()
    expect(ed.view.dom.querySelector('[data-resize-wrapper] img')).not.toBeNull()
    expect(ed.view.dom.querySelectorAll('[data-resize-handle]').length).toBeGreaterThan(0)
  })

  it('setImage 命令仍可用（插入路径未破坏）', () => {
    const ed = makeEditor()
    ed.commands.setImage({ src: 'data:image/png;base64,QUJD', alt: '测试' })
    expect(ed.getHTML()).toContain('<img')
    expect(ed.isActive('image')).toBe(true)
  })
})
