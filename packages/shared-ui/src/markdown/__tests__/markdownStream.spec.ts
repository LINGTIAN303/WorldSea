/**
 * 流式 Markdown 增量渲染契约测试。核心不变量：① 前缀稳定性——任一前缀切出的「固化 token」必须与全文 token 序列的前缀逐 raw 一致（只固化已定型块）；
 * ② 增量 ≡ 全量——逐帧喂入时每帧 stable+tail 与整段渲染同一文本逐字节一致（未闭合围栏帧除外，该帧按既有语义把尾块降级为纯文本）；
 * ③ 已完成块只渲一次——固化 token 进缓存后不再触发 marked/高亮；④ 保守回退——def / html / 非前缀增长场景回退整段路径，行为与既有实现一致。
 */
import { describe, it, expect, vi } from 'vitest'
import { type Token } from 'marked'
import {
  createMarkdownStreamRenderer,
  escapeHtml,
  hasUnclosedFence,
  lexMarkdown,
  renderFullMarkdown,
  setCodeHighlighter,
  splitMarkdownStream,
  type MentionMatcher,
} from '../markdownStream'

// ─── 语料 ────────────────────────────────────────────────

/** 常规语料（无 def / html / 不闭合围栏） */
const CORPUS: Array<{ name: string; md: string }> = [
  { name: '单段落', md: '你好，世界' },
  {
    name: '标题+段落+分隔线',
    md: '# 标题\n\n第一段。\n\n## 小节\n\n第二段。\n\n---\n\n第三段。\n',
  },
  {
    name: '嵌套列表',
    md: '- 甲\n- 乙\n  - 乙一\n  - 乙二\n\n1. 一\n2. 二\n',
  },
  { name: '松散列表', md: '- 甲\n\n- 乙\n\n段落\n' },
  { name: '围栏代码块', md: '前文\n\n```ts\nconst a = 1\nconsole.log(a)\n```\n\n后文\n' },
  {
    name: '表格',
    md: '| 列1 | 列2 |\n| --- | --- |\n| a | b |\n| c | d |\n\n表后段落\n',
  },
  { name: '引用', md: '> 引用第一行\n> 第二行\n\n普通段落\n' },
  {
    name: '行内样式',
    md: '这是 **粗体**、*斜体*、`code`、[链接](https://example.com) 的段落。\n',
  },
  {
    name: '长混合文档',
    md: [
      '# 概览', '', '这是**第一段**，包含 `行内代码` 与 [链接](https://example.com/a)。', '',
      '- 列表项一', '- 列表项二', '  - 嵌套项', '',
      '> 引用块', '', '```ts', 'function add(a: number, b: number) {', '  return a + b', '}', '```', '',
      '| 名称 | 值 |', '| --- | --- |', '| x | 1 |', '| y | 2 |', '',
      '结尾段落，包含更多文字以拉长流式帧数。', '',
    ].join('\n'),
  },
]

/** 特殊语料（走保守回退） */
const FALLBACK_CORPUS: Array<{ name: string; md: string }> = [
  { name: '引用式链接定义', md: '见 [说明][x] 一节。\n\n[x]: https://example.com\n' },
  { name: '原始 HTML 块', md: '<div class="x">\nhi\n</div>\n\n普通段落\n' },
]

// ─── 工具 ────────────────────────────────────────────────

/** 生成逐前缀序列（step 控制粒度） */
function prefixes(text: string, step = 1): string[] {
  const out: string[] = []
  for (let i = 1; i <= text.length; i += step) out.push(text.slice(0, i))
  if (out[out.length - 1] !== text) out.push(text)
  return out
}

/** step 按长度自适应，避免长文测试过慢 */
function stepFor(text: string): number {
  return text.length > 400 ? 7 : 1
}

const noMention: MentionMatcher | null = null

/** 逐帧喂入辅助：返回最终输出（同时可传 onFrame 观测中间帧） */
function feedAll(
  renderer: ReturnType<typeof createMarkdownStreamRenderer>,
  text: string,
  onFrame?: (prefix: string, out: { stableHtml: string; tailHtml: string }) => void,
): { stableHtml: string; tailHtml: string } {
  let out = { stableHtml: '', tailHtml: '' }
  for (const p of prefixes(text, stepFor(text))) {
    out = renderer.render(p)
    onFrame?.(p, out)
  }
  return out
}

// ─── ① 前缀稳定性 ─────────────────────────────────────────

describe('splitMarkdownStream · 前缀稳定性', () => {
  it('任一前缀切出的固化 token，与全文 token 序列前缀逐 raw 一致', () => {
    for (const { name, md } of CORPUS) {
      const fullRaws = lexMarkdown(md).map((t: Token) => t.raw)
      for (const p of [md, ...prefixes(md, stepFor(md))]) {
        const split = splitMarkdownStream(p)
        expect(split.fallback, `${name} fallback`).toBe(false)
        expect(p.startsWith(split.stableRaw), `${name} 前缀对齐`).toBe(true)
        expect(split.stableRaw + split.tailRaw, `${name} 切分拼接还原`).toBe(p)
        const raws = split.stableTokens.map((t) => t.raw)
        expect(raws, `${name} 固化 token 前缀性`).toEqual(fullRaws.slice(0, raws.length))
      }
    }
  })

  it('def / html 语料 → 整段回退（stable 为空）', () => {
    for (const { md } of FALLBACK_CORPUS) {
      const split = splitMarkdownStream(md)
      expect(split.fallback).toBe(true)
      expect(split.stableRaw).toBe('')
      expect(split.tailRaw).toBe(md)
    }
  })
})

// ─── ② 增量 ≡ 全量 ────────────────────────────────────────

describe('增量渲染器 · 增量 ≡ 全量', () => {
  it('逐帧喂入：每一帧与整段渲染逐字节一致（未闭合围栏帧除外）', () => {
    for (const { name, md } of CORPUS) {
      const renderer = createMarkdownStreamRenderer({ matchInText: noMention })
      feedAll(renderer, md, (prefix, out) => {
        if (hasUnclosedFence(prefix)) return // 该帧按约定降级，另有专项断言
        const reference = renderFullMarkdown(prefix, noMention)
        expect(out.stableHtml + out.tailHtml, `${name} @${prefix.length}`).toBe(reference)
      })
    }
  })

  it('终态（整篇）与整段渲染一致', () => {
    for (const { name, md } of CORPUS) {
      const renderer = createMarkdownStreamRenderer({ matchInText: noMention })
      const out = feedAll(renderer, md)
      expect(out.stableHtml + out.tailHtml, name).toBe(renderFullMarkdown(md, noMention))
    }
  })

  it('逐帧喂入：def / html 语料同样逐帧一致（命中回退帧走整段路径）', () => {
    for (const { name, md } of FALLBACK_CORPUS) {
      const renderer = createMarkdownStreamRenderer({ matchInText: noMention })
      feedAll(renderer, md, (prefix, out) => {
        const split = splitMarkdownStream(prefix)
        if (split.fallback) {
          expect(out.stableHtml, `${name} 回退帧 stable 为空`).toBe('')
          expect(out.tailHtml, `${name} @${prefix.length}（整段）`).toBe(renderFullMarkdown(prefix, noMention))
        } else {
          expect(out.stableHtml + out.tailHtml, `${name} @${prefix.length}`).toBe(renderFullMarkdown(prefix, noMention))
        }
      })
    }
  })

  it('非前缀增长（编辑 / 缩短）→ 重置并按新文本重建', () => {
    const renderer = createMarkdownStreamRenderer({ matchInText: noMention })
    feedAll(renderer, CORPUS[4].md)
    // 换成另一篇（非前缀增长）
    const out = renderer.render('# 完全不同的文档\n\n新段落。\n')
    expect(out.stableHtml + out.tailHtml).toBe(renderFullMarkdown('# 完全不同的文档\n\n新段落。\n', noMention))
    // 缩短（回退到更短的文本）
    const out2 = renderer.render('# 完全不同的文档\n')
    expect(out2.stableHtml + out2.tailHtml).toBe(renderFullMarkdown('# 完全不同的文档\n', noMention))
  })

  it('mention 注入落位（固化段与尾块各自注入）', () => {
    const matcher: MentionMatcher = (text) => {
      const i = text.indexOf('角色甲')
      return i >= 0 ? [{ start: i, end: i + 3, name: '角色甲', entityIds: ['e1'], entityType: 'character' }] : []
    }
    const renderer = createMarkdownStreamRenderer({ matchInText: matcher })
    const out = feedAll(renderer, '角色甲登场\n\n后续段落\n')
    expect(out.stableHtml).toContain('data-ws-entity-id="e1"')
    expect(out.stableHtml + out.tailHtml).toBe(renderFullMarkdown('角色甲登场\n\n后续段落\n', matcher))
  })
})

// ─── ③ 已完成块只渲一次 ───────────────────────────────────

describe('增量渲染器 · 固化块缓存', () => {
  it('全部代码块固化后，继续追加文本不再触发高亮（不重渲已完成块）', () => {
    const highlight = vi.fn((_code: string, _lang: string) => null as string | null)
    setCodeHighlighter(highlight)
    try {
      const renderer = createMarkdownStreamRenderer({ matchInText: noMention })
      // 喂到「结尾段落」：三个代码块均已固化
      const frozen = '开头段落。\n\n```js\nconst a = 1\n```\n\n中间段落。\n\n```python\nx = 2\n```\n\n再来一段。\n\n```rust\nlet y = 3;\n```\n\n结尾段落'
      renderer.render(frozen)
      const callsAtFrozen = highlight.mock.calls.length
      expect(callsAtFrozen).toBeGreaterThanOrEqual(3)

      // 继续在结尾段落上追加：固化块不应再进渲染
      const tailTexts = ['。', '，继续', '，再继续', '，最后收尾。']
      let text = frozen
      for (const seg of tailTexts) {
        text += seg
        renderer.render(text)
      }
      expect(highlight.mock.calls.length).toBe(callsAtFrozen)
    } finally {
      setCodeHighlighter(null)
    }
  })

  it('未闭合围栏：尾块降级纯文本，稳定段保持渲染；闭合后固化并高亮', () => {
    const renderer = createMarkdownStreamRenderer({ matchInText: noMention })
    const open = '前言段落\n\n```js\nconst a = 1\n'
    const out = renderer.render(open)
    expect(out.stableHtml).toContain('<p>前言段落</p>')
    expect(out.tailHtml).toBe(escapeHtml('```js\nconst a = 1\n').replace(/\n/g, '<br>'))

    const closed = `${open}\`\`\`\n\n收尾段落\n`
    const out2 = renderer.render(closed)
    expect(out2.stableHtml).toContain('ws-code-block')
    expect(out2.stableHtml + out2.tailHtml).toBe(renderFullMarkdown(closed, noMention))
  })
})

// ─── ④ 既有整段语义不回退 ─────────────────────────────────

describe('renderFullMarkdown · 既有语义', () => {
  it('未闭合围栏 → 整段纯文本（兼容既有实现）', () => {
    const md = '段落\n\n```js\nlet x = 1\n'
    expect(renderFullMarkdown(md, noMention)).toBe(escapeHtml(md).replace(/\n/g, '<br>'))
  })

  it('空文本 → 空串', () => {
    expect(renderFullMarkdown('', noMention)).toBe('')
  })

  it('代码块外壳与语言标签保留', () => {
    const html = renderFullMarkdown('```ts\nconst a = 1\n```\n', noMention)
    expect(html).toContain('ws-code-block')
    expect(html).toContain('ws-code-lang')
    expect(html).toContain('language-ts')
  })
})

// ─── ⑤ 内核 marked 配置 ───────────────────────────────────

describe('内核 marked 配置', () => {
  it('gfm + breaks 生效（换行转 <br>、表格识别）', () => {
    const html = renderFullMarkdown('第一行\n第二行\n\n| a | b |\n| - | - |\n| 1 | 2 |\n', noMention)
    expect(html).toContain('<br>')
    expect(html).toContain('<table>')
  })
})