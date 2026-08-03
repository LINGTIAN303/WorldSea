/**
 * 解析 {font:familyName[,weight[,style]]}...{/font} 内联标记
 * 将标记替换为 <span data-ws-font="..." data-ws-weight="..." data-ws-style="..."> 占位符
 */

export interface FontSpan {
  family: string
  weight: number
  style: string
  content: string
  startIndex: number
  endIndex: number
}

const FONT_OPEN_RE = /\{font:([^}]+)\}/g
const FONT_CLOSE_TAG = '{/font}'

/**
 * 从标记参数中解析 family, weight, style
 * 格式: familyName[,weight[,style]]
 */
function parseFontParams(params: string): { family: string; weight: number; style: string } {
  const parts = params.split(',').map(s => s.trim())
  return {
    family: parts[0] || 'sans-serif',
    weight: parts[1] ? Number(parts[1]) || 400 : 400,
    style: parts[2] || 'normal',
  }
}

/**
 * 提取文本中所有 {font:...}...{/font} 标记
 */
export function extractFontSpans(text: string): FontSpan[] {
  const spans: FontSpan[] = []
  const stack: Array<{ openIndex: number; params: string; matchEnd: number }> = []

  let match: RegExpExecArray | null
  FONT_OPEN_RE.lastIndex = 0

  while ((match = FONT_OPEN_RE.exec(text)) !== null) {
    const openTagEnd = match.index + match[0].length
    // 不支持嵌套，如果栈中已有未闭合标记，先闭合前一个
    if (stack.length > 0) {
      const prev = stack.pop()!
      const closeIdx = text.indexOf(FONT_CLOSE_TAG, prev.matchEnd)
      if (closeIdx !== -1) {
        const content = text.slice(prev.matchEnd, closeIdx)
        const { family, weight, style } = parseFontParams(prev.params)
        spans.push({
          family,
          weight,
          style,
          content,
          startIndex: prev.openIndex,
          endIndex: closeIdx + FONT_CLOSE_TAG.length,
        })
      }
    }
    stack.push({ openIndex: match.index, params: match[1], matchEnd: openTagEnd })
  }

  // 处理栈中剩余的未闭合标记
  if (stack.length > 0) {
    const last = stack.pop()!
    const closeIdx = text.indexOf(FONT_CLOSE_TAG, last.matchEnd)
    if (closeIdx !== -1) {
      const content = text.slice(last.matchEnd, closeIdx)
      const { family, weight, style } = parseFontParams(last.params)
      spans.push({
        family,
        weight,
        style,
        content,
        startIndex: last.openIndex,
        endIndex: closeIdx + FONT_CLOSE_TAG.length,
      })
    } else {
      // 未闭合：取到文本末尾
      const content = text.slice(last.matchEnd)
      const { family, weight, style } = parseFontParams(last.params)
      spans.push({
        family,
        weight,
        style,
        content,
        startIndex: last.openIndex,
        endIndex: text.length,
      })
    }
  }

  return spans
}

/**
 * 将 {font:...}...{/font} 标记替换为 <span data-ws-font="..."> 占位符
 * 保留标记内的文本内容
 */
export function replaceFontSpans(text: string): string {
  const spans = extractFontSpans(text)
  if (spans.length === 0) return text

  // 从后往前替换，避免索引偏移
  let result = text
  for (let i = spans.length - 1; i >= 0; i--) {
    const span = spans[i]
    const replacement = `<span data-ws-font="${span.family}" data-ws-weight="${span.weight}" data-ws-style="${span.style}">${span.content}</span>`
    result = result.slice(0, span.startIndex) + replacement + result.slice(span.endIndex)
  }
  return result
}
