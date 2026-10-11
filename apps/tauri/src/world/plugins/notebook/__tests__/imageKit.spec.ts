/**
 * TipTap 图片扩展接线验证（三期前置，与 tableKit.spec 同模式）
 *
 * 覆盖「编辑器配置 + 图片命令」的真实运行时行为：
 * - Image 扩展（同 useNoteEditor / useChapterEditor 的配置）装配；
 * - setImage 产出的文档结构（块级 img + src/alt 属性）；
 * - allowBase64（本地图片 MVP 存储的前提）实际放行 data URL；
 * - 含图片 HTML 的 setContent 回读（笔记内容是 HTML 落库，打开旧笔记必须能还原）。
 *
 * 粘贴 / 拖拽链路（handlePaste/handleDrop → imageInsert util）依赖真实剪贴板，
 * jsdom 无法仿真 FileList 注入 —— 该链路由 fileToImageDataUrl 的纯校验逻辑单测 +
 * 真机走查覆盖。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'

/** 与 useNoteEditor / useChapterEditor 相同的扩展配置（同一份配置，改一处须两处同步） */
function createEditor(): Editor {
  return new Editor({
    extensions: [StarterKit, Image.configure({ inline: false, allowBase64: true })],
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

describe('Image 扩展 · 装配与结构', () => {
  it('setImage 产出块级 img（src + alt），并随光标进入图片节点', () => {
    const ed = makeEditor()
    ed.commands.setImage({ src: 'data:image/png;base64,QUJD', alt: '测试图' })

    const html = ed.getHTML()
    expect(html).toContain('<img')
    expect(html).toContain('src="data:image/png;base64,QUJD"')
    expect(html).toContain('alt="测试图"')
    expect(ed.isActive('image')).toBe(true)
  })

  it('allowBase64：data URL 不被内容过滤剥离', () => {
    const ed = makeEditor()
    ed.commands.setContent('<p>前</p><img src="data:image/gif;base64,R0lGOD" alt="g"><p>后</p>')
    const html = ed.getHTML()
    expect(html).toContain('data:image/gif;base64,R0lGOD')
  })

  it('含图片 HTML 的 setContent 回读（旧笔记还原路径）', () => {
    const ed = makeEditor()
    ed.commands.setContent('<p>正文</p><img src="data:image/png;base64,QUJD" alt="旧图"><p>尾</p>')
    expect(ed.getHTML().match(/<img[ >]/g)?.length).toBe(1)
    expect(ed.getText()).toContain('正文')
  })

  it('图片可被 undo 移除（与文本同一撤销栈）', () => {
    const ed = makeEditor()
    ed.commands.setContent('<p>锚点</p>')
    ed.commands.setImage({ src: 'data:image/png;base64,QUJD' })
    expect(ed.getHTML()).toContain('<img')
    ed.commands.undo()
    expect(ed.getHTML()).not.toContain('<img')
  })
})
