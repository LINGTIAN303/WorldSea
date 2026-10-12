/**
 * notebook 大文档性能基准（批 5 F5）——「先量化再优化」。
 *
 * 覆盖五条关键链路：
 * ① normalizeNoteContent —— 装载网关（打开笔记 / 外部写入归一时）
 * ② editor.setContent —— 装载进编辑器的解析 + NodeView/DOM 构建
 * ③ 单键输入（插入+撤除对）—— 输入路径的 transaction + view 更新管线
 * ④ editor.getHTML —— 保存链路（300ms 防抖落库前）/ 预览链路都会取
 * ⑤ sanitizeMarkdownHtml(getHTML()) —— 分栏预览的 250ms 防抖刷新
 *
 * 规模双档：10k 字符（200 段 × 50 字）与 50k 字符（1000 段），观察线性度。
 *
 * 跑法：
 *   node_modules/.bin/vitest bench apps/tauri/src/world/plugins/notebook/__tests__/notebookPerf.bench.ts --reporter=basic
 */
import { bench, describe } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { sanitizeMarkdownHtml } from '@worldsea/shared-ui/markdown'
import { normalizeNoteContent } from '../contentNormalize'

const SENTENCE = '星海之内，航路以烛火标记，守夜人沿光而行。'

function buildDocHtml(paragraphs: number, charsPer: number): string {
  const lines: string[] = []
  for (let i = 0; i < paragraphs; i++) {
    let text = ''
    while (text.length < charsPer) text += SENTENCE
    lines.push(`<p>${text.slice(0, charsPer)}</p>`)
  }
  return lines.join('')
}

/** 同规模 md 文本（段落以空行分隔——markdown 常见形态） */
function buildMd(paragraphs: number, charsPer: number): string {
  return buildDocHtml(paragraphs, charsPer).replace(/<\/p><p>/g, '\n\n').replace(/<\/?p>/g, '')
}

const HTML_10K = buildDocHtml(200, 50)
const HTML_50K = buildDocHtml(1000, 50)
const MD_10K = buildMd(200, 50)
const MD_50K = buildMd(1000, 50)

// 独立 editor 实例（10k / 50k 互不干扰；editor 链路共用同一实例由各 bench 自行重置/净零）
const ed10 = new Editor({ extensions: [StarterKit], content: HTML_10K, editorProps: { attributes: { class: 'prose' } } })
const ed50 = new Editor({ extensions: [StarterKit], content: HTML_50K, editorProps: { attributes: { class: 'prose' } } })

describe('装载/归一链路', () => {
  bench('normalizeNoteContent · 10k 字符', () => {
    normalizeNoteContent(MD_10K)
  })
  bench('normalizeNoteContent · 50k 字符', () => {
    normalizeNoteContent(MD_50K)
  })
})

describe('编辑器装载链路', () => {
  bench('setContent · 10k 字符', () => {
    ed10.commands.setContent(HTML_10K, { emitUpdate: false })
  })
  bench('setContent · 50k 字符', () => {
    ed50.commands.setContent(HTML_50K, { emitUpdate: false })
  })
})

describe('输入链路（transaction + view 更新）', () => {
  bench('单键输入对（插入+撤除）· 10k', () => {
    ed10.chain().insertContentAt(1, 'x').run()
    ed10.chain().deleteRange({ from: 1, to: 2 }).run()
  })
  bench('单键输入对（插入+撤除）· 50k', () => {
    ed50.chain().insertContentAt(1, 'x').run()
    ed50.chain().deleteRange({ from: 1, to: 2 }).run()
  })
})

describe('序列化/预览链路', () => {
  bench('getHTML · 10k 字符', () => {
    ed10.getHTML()
  })
  bench('getHTML · 50k 字符', () => {
    ed50.getHTML()
  })
  bench('getText（字数统计）· 10k 字符', () => {
    ed10.getText()
  })
  bench('getText（字数统计）· 50k 字符', () => {
    ed50.getText()
  })
  bench('sanitize(getHTML) · 10k 字符（预览刷新）', () => {
    sanitizeMarkdownHtml(ed10.getHTML())
  })
  bench('sanitize(getHTML) · 50k 字符（预览刷新）', () => {
    sanitizeMarkdownHtml(ed50.getHTML())
  })
})

describe('onUpdate 端到端对比（F5 优化验证）', () => {
  bench('单键 + 旧 onUpdate（getText + getHTML）· 10k', () => {
    ed10.chain().insertContentAt(1, 'x').run()
    ed10.getText()
    ed10.getHTML()
    ed10.chain().deleteRange({ from: 1, to: 2 }).run()
  })
  bench('单键 + 新 onUpdate（仅 getText）· 10k', () => {
    ed10.chain().insertContentAt(1, 'x').run()
    ed10.getText()
    ed10.chain().deleteRange({ from: 1, to: 2 }).run()
  })
  bench('单键 + 旧 onUpdate（getText + getHTML）· 50k', () => {
    ed50.chain().insertContentAt(1, 'x').run()
    ed50.getText()
    ed50.getHTML()
    ed50.chain().deleteRange({ from: 1, to: 2 }).run()
  })
  bench('单键 + 新 onUpdate（仅 getText）· 50k', () => {
    ed50.chain().insertContentAt(1, 'x').run()
    ed50.getText()
    ed50.chain().deleteRange({ from: 1, to: 2 }).run()
  })
})
