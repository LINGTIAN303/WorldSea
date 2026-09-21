/**
 * thinkSummary 等价性契约（2026-09-20，C1 推理流式专项）
 *
 * 定向扫描实现必须与「全文逐行切分」参考实现逐字符等价——
 * 性能优化不得改变摘要语义（参考实现保留在源码内仅供对照）。
 */
import { describe, expect, it } from 'vitest'
import { referenceThinkSummary, thinkSummary } from '../thinkSummary'

/** 固定种子伪随机文本：覆盖换行 / CRLF / 制表 / 空行 / 连续空白等边界形态 */
function randomCases(count: number): Array<[string, boolean]> {
  const cases: Array<[string, boolean]> = []
  let seed = 20260920
  const next = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  const alphabet = ['字', 'a', ' ', '\t', '\n', '\r\n', '\n\n', '  ', '。', 'x']
  for (let i = 0; i < count; i++) {
    let text = ''
    const len = 1 + Math.floor(next() * 120)
    for (let j = 0; j < len; j++) text += alphabet[Math.floor(next() * alphabet.length)]
    cases.push([text, i % 2 === 0])
  }
  return cases
}

describe('thinkSummary 等价性', () => {
  it('固定用例：首行 / 末行 / 空行 / 空白行 / 截断', () => {
    const cases: Array<[string, boolean]> = [
      ['', true],
      ['', false],
      ['单行', true],
      ['单行', false],
      ['首行\n次行', true],
      ['首行\n次行', false],
      ['\n\n  \n', true],
      ['\n\n  \n', false],
      ['\n\n 内容\n\n', true],
      ['\n\n 内容\n\n', false],
      ['第一行\n第二行\n第三行', true],
      ['第一行\n第二行\n第三行', false],
      ['前\n' + 'y'.repeat(200), true],
      ['x'.repeat(200) + '\n后', false],
      ['  缩进首行\n末行', true],
      ['  缩进首行\n末行', false],
      ['a\r\nb\r\n', true],
      ['a\r\nb\r\n', false],
    ]
    for (const [text, streaming] of cases) {
      expect(thinkSummary(text, streaming), JSON.stringify([text, streaming])).toBe(
        referenceThinkSummary(text, streaming),
      )
    }
  })

  it('随机用例：200 组固定种子文本逐字符一致', () => {
    for (const [text, streaming] of randomCases(200)) {
      expect(thinkSummary(text, streaming), JSON.stringify([text, streaming])).toBe(
        referenceThinkSummary(text, streaming),
      )
    }
  })

  it('长文本两种形态一致（多行 / 单行）', () => {
    const multiline = Array.from({ length: 400 }, (_, i) => `第 ${i} 行内容`).join('\n')
    const singleLine = '推'.repeat(20_000)
    for (const text of [multiline, singleLine]) {
      expect(thinkSummary(text, true)).toBe(referenceThinkSummary(text, true))
      expect(thinkSummary(text, false)).toBe(referenceThinkSummary(text, false))
    }
  })
})
