/**
 * @tiptap/markdown 冒烟测试（块 1 阶段 1，2026-10-15）
 *
 * 目的：验证官方扩展（3.29.1）在本项目环境的最小往返能力——
 * ① 官方扩展对哪些节点自动支持 md 解析/序列化；
 * ② 内嵌 HTML（B 裁决路径）的解析行为；
 * ③ 为「自定义 handler 需要补哪些」提供实证依据。
 *
 * 独立于 buildNotebookExtensions（先验证底座，再接线）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import Image from '@tiptap/extension-image'
import { Markdown } from '@tiptap/markdown'
import { setActivePinia, createPinia, type Pinia } from 'pinia'
import 'fake-indexeddb/auto'
import { useEntityStore, type Entity } from '@worldsea/entity-core'
import { makeFullEditor } from './markdownTestKit'

/** 建一个只挂官方扩展的编辑器（md 直装） */
function makeEditor(md: string): Editor {
  return new Editor({
    extensions: [StarterKit, TaskList, TaskItem, TableKit, Image, Markdown],
    content: md,
    contentType: 'markdown',
  })
}

describe('@tiptap/markdown 冒烟（3.29.1 · 官方扩展底座）', () => {
  it('标题 / 强调 / 列表往返', () => {
    const md = '# 标题\n\n正文 **加粗** 与 *斜体*。\n\n- 项目一\n- 项目二\n'
    const ed = makeEditor(md)
    const out = ed.getMarkdown()
    expect(out).toContain('# 标题')
    expect(out).toContain('**加粗**')
    expect(out).toContain('- 项目一')
    ed.destroy()
  })

  it('任务列表：节点结构 + 往返', () => {
    const md = '- [ ] 待办\n- [x] 完成\n'
    const ed = makeEditor(md)
    const hasTaskList = ed.getJSON().content?.some(n => n.type === 'taskList')
    expect(hasTaskList).toBe(true)
    const out = ed.getMarkdown()
    expect(out).toContain('- [ ] 待办')
    expect(out).toContain('- [x] 完成')
    ed.destroy()
  })

  it('表格：节点结构 + 往返', () => {
    const md = '| 列A | 列B |\n| --- | --- |\n| 1 | 2 |\n'
    const ed = makeEditor(md)
    const hasTable = ed.getJSON().content?.some(n => n.type === 'table')
    expect(hasTable).toBe(true)
    const out = ed.getMarkdown()
    expect(out).toContain('列A')
    ed.destroy()
  })

  it('代码块：围栏 + 语言', () => {
    const md = '```js\nconst a = 1\n```\n'
    const ed = makeEditor(md)
    const out = ed.getMarkdown()
    expect(out).toContain('```js')
    expect(out).toContain('const a = 1')
    ed.destroy()
  })

  it('图片（标准语法）往返', () => {
    const md = '![替代文本](assets/pic.png)\n'
    const ed = makeEditor(md)
    const out = ed.getMarkdown()
    expect(out).toContain('![替代文本](assets/pic.png)')
    ed.destroy()
  })

  it('内嵌 HTML img（B 裁决路径）：观察解析行为', () => {
    const md = '<img src="assets/pic.png" width="300">\n'
    const ed = makeEditor(md)
    const json = ed.getJSON()
    // 诊断输出（首轮观察，不断言具体形态）
    console.log('[冒烟] 内嵌 HTML img → JSON:', JSON.stringify(json.content))
    const out = ed.getMarkdown()
    console.log('[冒烟] 内嵌 HTML img → 序列化:', JSON.stringify(out))
    ed.destroy()
    expect(json).toBeTruthy()
  })

  it('链接 / 引用 / 分割线 / 有序列表', () => {
    const md = '> 引用行\n\n1. 第一\n2. 第二\n\n---\n\n[链接](https://example.com)\n'
    const ed = makeEditor(md)
    const out = ed.getMarkdown()
    expect(out).toContain('> 引用行')
    expect(out).toContain('1.')
    expect(out).toContain('---')
    expect(out).toContain('[链接](https://example.com)')
    ed.destroy()
  })
})

function makeEntity(id: string, type: string, name: string): Entity {
  const now = new Date().toISOString()
  return { id, type, name, description: '', properties: {}, tags: [], createdAt: now, updatedAt: now }
}

describe('全量接线往返（buildNotebookExtensions · 自定义 handler）', () => {
  let pinia: Pinia
  beforeEach(() => {
    localStorage.clear()
    pinia = createPinia()
    setActivePinia(pinia) // 裸调 useEntityStore()（handler 内）依赖 active pinia
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('全量扩展可组装 + 基础往返', () => {
    const md = '# 标题\n\n- [ ] 待办\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n'
    const ed = makeFullEditor(md)
    const out = ed.getMarkdown()
    expect(out).toContain('# 标题')
    expect(out).toContain('- [ ] 待办')
    // 序列化器输出对齐填充的 GFM 表格（列宽自适应；第二次解析起为幂等固定点）
    expect(out).toContain('| A   | B   |')
    expect(out).toContain('| --- | --- |')
    ed.destroy()
  })

  it('图片：无尺寸 / 对齐 → 标准图片语法', () => {
    const ed = makeFullEditor('![图](assets/a.png)\n')
    expect(ed.getMarkdown()).toContain('![图](assets/a.png)')
    ed.destroy()
  })

  it('图片：宽度 / 对齐 → 内嵌 HTML 往返（B 裁决闭环）', () => {
    const md = '<img src="assets/a.png" alt="图" width="300" height="200" data-align="center" style="display:block;margin-left:auto;margin-right:auto">'
    const ed = makeFullEditor(md)
    const img = ed.getJSON().content?.find(n => n.type === 'image')
    expect(img?.attrs?.width).toBe(300)
    expect(img?.attrs?.align).toBe('center')
    const out = ed.getMarkdown()
    expect(out).toContain('width="300"')
    expect(out).toContain('data-align="center"')
    ed.destroy()
  })

  it('双链 [[名]]：命中实体 → noteLink；未命中 → 字面文本（均往返成功）', async () => {
    const es = useEntityStore()
    await es.add(makeEntity('nb-x', 'notebook', '星海编年史'), 'user')

    const ed = makeFullEditor('参见 [[星海编年史]] 与 [[不存在的笔记]]。\n')
    const jsonText = JSON.stringify(ed.getJSON())
    expect(jsonText).toContain('noteLink') // 命中 → mark 还原
    const out = ed.getMarkdown()
    expect(out).toContain('[[星海编年史]]')
    // 未命中 → 字面文本 + 引擎转义（防 re-parse 歧义；渲染显示仍为 [[...]]，\[ 在显示层被消费）
    expect(out).toContain('\\[\\[不存在的笔记\\]\\]')
    ed.destroy()
  })

  it('mention @名：命中实体 → mention 节点；未命中 → 字面文本', async () => {
    const es = useEntityStore()
    await es.add(makeEntity('ch-1', 'character', '灰烬之刃'), 'user')

    const ed = makeFullEditor('主角是 @灰烬之刃，另有 @路人甲。\n')
    const jsonText = JSON.stringify(ed.getJSON())
    expect(jsonText).toContain('mention')
    const out = ed.getMarkdown()
    expect(out).toContain('@灰烬之刃')
    expect(out).toContain('@路人甲')
    ed.destroy()
  })
})
