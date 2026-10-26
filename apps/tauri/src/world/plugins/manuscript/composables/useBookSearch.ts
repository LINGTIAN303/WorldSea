import type { Entity } from '@worldsea/entity-core'

/**
 * 全书跨章搜索（批3）：对书内章节的存储 HTML 做纯文本提取后扫描。
 * 提取按块级元素（p/h1-3/li/blockquote/td/th）切行、嵌套去重——跨块的假命中
 * 被换行天然阻断（编辑器内 find 也按 textblock 扫描，两端口径一致）。
 * 大小写不敏感与 findReplaceExtension 同口径（小写化不改长度才启用，防个别字符错位）。
 */

export interface BookSearchHit {
  chapterId: string
  chapterName: string
  count: number
  /** 展示片段：首处命中前后各 ~24 字，块边界以空格呈现 */
  snippet: string
  /** 命中在片段内的起点/长度（结果项高亮用） */
  matchStart: number
  matchLen: number
}

const BLOCK_SEL = 'p, h1, h2, h3, li, blockquote, td, th, pre'
const SNIPPET_CONTEXT = 24

/** 存储_HTML → 按块切行的纯文本（块级提取 + 嵌套去重；供跨章搜索，导出链勿用） */
export function chapterText(html: string): string {
  if (!html) return ''
  const div = document.createElement('div')
  div.innerHTML = html
  const out: string[] = []
  div.querySelectorAll(BLOCK_SEL).forEach((el) => {
    // 嵌套去重：blockquote>p / td>p 等只在最外层块计一次
    if (el.parentElement?.closest(BLOCK_SEL)) return
    const t = el.textContent || ''
    if (t.trim()) out.push(t)
  })
  // 无块级结构（Agent 直写的裸文本/纯文本内容）→ 整体作为一段
  return out.length ? out.join('\n') : (div.textContent || '')
}

/** 在单章文本里找全部命中（返回首处下标与总数；无命中 null） */
function scan(text: string, needle: string): { first: number; count: number } | null {
  let count = 0
  let first = -1
  let idx = text.indexOf(needle)
  while (idx !== -1) {
    if (first === -1) first = idx
    count++
    idx = text.indexOf(needle, idx + needle.length)
  }
  return count ? { first, count } : null
}

export function searchBookChapters(chapters: Entity[], term: string): BookSearchHit[] {
  const t = term.trim()
  if (!t) return []
  const lower = t.toLowerCase()
  const caseInsensitive = lower.length === t.length
  const hits: BookSearchHit[] = []
  for (const ch of chapters) {
    const text = chapterText((ch.properties.content as string) || '')
    if (!text) continue
    const found = scan(caseInsensitive ? text.toLowerCase() : text, caseInsensitive ? lower : t)
    if (!found) continue
    // 片段取自原始大小写文本（下标通用：小写化不改长度才有 CI 路径）
    const start = Math.max(0, found.first - SNIPPET_CONTEXT)
    const end = Math.min(text.length, found.first + t.length + SNIPPET_CONTEXT)
    hits.push({
      chapterId: ch.id,
      chapterName: ch.name,
      count: found.count,
      snippet: (start > 0 ? '…' : '') + text.slice(start, end).replace(/\n/g, ' ') + (end < text.length ? '…' : ''),
      matchStart: found.first - start,
      matchLen: t.length,
    })
  }
  return hits
}
