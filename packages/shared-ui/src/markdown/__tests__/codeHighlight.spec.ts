/**
 * 代码高亮契约（2026-09-20 帧率修复：内容键 memo）。背景（实测）：Prism.highlight 代价与源码长度成正比（60 行 TS ≈ 1.6ms），
 * 渲染管线在内容未变时也会重复请求（两条热路径：闭合围栏停在活动尾块、整段回退路径）。本文件锁定：
 * memo 输出与直接调 Prism 逐字节一致；同一 (语言, 源码) 重复请求只跑一次 Prism（别名归一同键、失败结果也缓存）；缓存上限 FIFO 淘汰。
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import Prism from 'prismjs'
import { highlightCode, clearHighlightCache } from '../codeHighlight'

let spy: ReturnType<typeof vi.spyOn> | null = null
let prismCalls = 0

/** spy 真实 Prism.highlight（memo 命中不应计数） */
function countPrism(): void {
  const original = Prism.highlight.bind(Prism)
  prismCalls = 0
  spy = vi.spyOn(Prism, 'highlight').mockImplementation(((code: string, grammar: unknown, lang: string) => {
    prismCalls++
    return original(code, grammar as never, lang)
  }) as never)
}

beforeEach(() => {
  clearHighlightCache()
  countPrism()
})

afterEach(() => {
  spy?.mockRestore()
  spy = null
})

const TS_SNIPPET = ['export function step(value: number): number {', '  const part = value * 2', '  return part', '}'].join('\n')
const PY_SNIPPET = 'def step(value: int) -> int:\n    return value * 2'

describe('highlightCode 语义等价', () => {
  it('memo 输出与直接调 Prism 逐字节一致', () => {
    for (const [code, lang] of [
      [TS_SNIPPET, 'typescript'],
      [TS_SNIPPET, 'ts'],
      [PY_SNIPPET, 'python'],
    ] as const) {
      const expected = Prism.highlight(code, Prism.languages[lang === 'ts' ? 'typescript' : lang]!, lang === 'ts' ? 'typescript' : lang)
      expect(highlightCode(code, lang)).toBe(expected)
    }
  })

  it('不支持的语言返回 null 且不调用 Prism', () => {
    expect(highlightCode('x', 'brainfuck-not-registered')).toBeNull()
    expect(highlightCode('x', '')).toBeNull()
    expect(prismCalls).toBe(0)
  })

  it('空语言别名（txt）返回 null', () => {
    expect(highlightCode('plain text', 'txt')).toBeNull()
    expect(prismCalls).toBe(0)
  })
})

describe('highlightCode 内容键 memo', () => {
  it('同一 (语言, 源码) 重复请求只跑一次 Prism，且返回值稳定', () => {
    const first = highlightCode(TS_SNIPPET, 'ts')
    expect(prismCalls).toBe(1)
    for (let i = 0; i < 20; i++) {
      expect(highlightCode(TS_SNIPPET, 'ts')).toBe(first)
    }
    expect(prismCalls).toBe(1)
  })

  it('别名归一后共用同一缓存条目（ts 与 typescript）', () => {
    const a = highlightCode(TS_SNIPPET, 'ts')
    const b = highlightCode(TS_SNIPPET, 'typescript')
    expect(a).toBe(b)
    expect(prismCalls).toBe(1)
  })

  it('不同源码 / 不同语言各自独立计数', () => {
    highlightCode(TS_SNIPPET, 'ts')
    highlightCode(PY_SNIPPET, 'python')
    expect(prismCalls).toBe(2)
    highlightCode(TS_SNIPPET, 'ts') // 命中
    highlightCode(PY_SNIPPET, 'python') // 命中
    expect(prismCalls).toBe(2)
  })

  it('源码增长（流式追加）产生新键 → 重新高亮', () => {
    highlightCode(TS_SNIPPET, 'ts')
    expect(prismCalls).toBe(1)
    highlightCode(TS_SNIPPET + '\n// 追加', 'ts')
    expect(prismCalls).toBe(2)
  })
})

describe('highlightCode 缓存有界', () => {
  it('超过上限触发 FIFO 淘汰：最早的条目被清出，最近的命中', () => {
    const codes = Array.from({ length: 70 }, (_, i) => `const v${i} = ${i}`)
    for (const c of codes) highlightCode(c, 'ts')
    expect(prismCalls).toBe(70)

    // 最近的（第 70 条）应命中
    highlightCode(codes[69], 'ts')
    expect(prismCalls).toBe(70)
    // 最早的（第 1 条）应已被淘汰 → 重新高亮
    highlightCode(codes[0], 'ts')
    expect(prismCalls).toBe(71)
  })
})
