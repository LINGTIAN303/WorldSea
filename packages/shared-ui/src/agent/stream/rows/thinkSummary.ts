/**
 * 推理行摘要纯函数（性能：定向扫描行边界，不做全文逐行切分）
 * 详细见 docs/details/注释/packages/shared-ui/agent/stream/rows/thinkSummary.md
 *
 * 语义等价于 `text.split('\n').map(s => s.trim()).filter(Boolean)` 取「流式态末行 /
 * 完成态首行」后截断 80 字符；但把每次推理增量的 O(全文) JS 级分配（全行数组 + 每行 trim）
 * 降为「一次原生扫描 + ≤80 字符分配」。
 */

/** 摘要字符上限（与既有实现一致） */
const SUMMARY_MAX_CHARS = 80
/** 行首空白匹配（sticky：`\s` 覆盖 `String.prototype.trim` 的空白集） */
const LEADING_WS = /[\s\uFEFF]*/y

/**
 * 取一行「去首尾空白后」的前 SUMMARY_MAX_CHARS 字符。
 *
 * 只在需要时分配：内容长于上限时仅切 ≤80 字符；短于上限时才切整行并去尾部空白。
 * 结果与 `text.slice(start, end).trim().slice(0, SUMMARY_MAX_CHARS)` 完全一致。
 */
function lineHead(text: string, start: number, end: number): string {
  LEADING_WS.lastIndex = start
  const matched = LEADING_WS.exec(text)
  // 行首空白可能越过行尾（\s 含 \n）→ 以行尾为上界
  const contentStart = start + Math.min(matched ? matched[0].length : 0, end - start)
  if (contentStart >= end) return ''
  if (end - contentStart > SUMMARY_MAX_CHARS) return text.slice(contentStart, contentStart + SUMMARY_MAX_CHARS)
  return text.slice(contentStart, end).trimEnd()
}

/**
 * 推理段摘要：`streaming` 取末个非空行、否则取首个非空行，截断 80 字符。
 *
 * @param text 推理段全文（随流式增量增长）
 * @param streaming 该段是否仍在流式（决定取末行还是首行）
 */
export function thinkSummary(text: string, streaming: boolean): string {
  if (!text) return ''
  if (streaming) {
    let end = text.length
    while (end > 0) {
      const start = text.lastIndexOf('\n', end - 1) + 1
      const head = lineHead(text, start, end)
      if (head) return head
      end = start - 1
    }
    return ''
  }
  let start = 0
  while (start < text.length) {
    const nl = text.indexOf('\n', start)
    const end = nl === -1 ? text.length : nl
    const head = lineHead(text, start, end)
    if (head) return head
    if (nl === -1) break
    start = nl + 1
  }
  return ''
}

/**
 * 参考实现（门禁对照用）：全文逐行切分 —— 与 thinkSummary 结果必须一致。
 * 保留在源码内是为了让门禁能断言「预算确实能捕获该实现」这一回归形态。
 */
export function referenceThinkSummary(text: string, streaming: boolean): string {
  const lines = text.split('\n').map((s) => s.trim()).filter(Boolean)
  const src = streaming ? lines[lines.length - 1] : lines[0]
  return (src || '').slice(0, SUMMARY_MAX_CHARS)
}