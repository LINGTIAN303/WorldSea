/**
 * 自动记忆提取器
 *
 * 在对话结束后自动分析对话内容，识别值得持久化的知识，
 * 并写入知识库或 localStorage 记忆。
 *
 * 提取策略：
 * 1. 基于规则的快速提取（关键词匹配、模式识别）
 * 2. 提取结果分类（preference/decision/convention/insight/rule/pattern）
 * 3. 去重检查（避免重复写入已有知识）
 * 4. 写入知识库（长文档）或 localStorage 记忆（短片段）
 */

import { kbWrite, kbSearchKeyword, type KBScope } from './kb-store'
import { indexKBEntry } from './kb-indexer'
import { loadMemory, saveMemory, evictIfNeeded } from '../tools/memory-internal'

export interface ExtractionResult {
  extracted: number
  entries: Array<{
    category: string
    title: string
    path: string
    scope: KBScope
    action: 'created' | 'skipped_duplicate'
  }>
}

const EXTRACTION_PATTERNS: Array<{
  pattern: RegExp
  category: 'preference' | 'decision' | 'convention' | 'insight' | 'rule' | 'pattern'
  scope: KBScope
  dir: string
}> = [
  {
    pattern: /(?:我喜欢|我偏好|我习惯|请用|请始终|以后都|默认用|我喜欢|我更倾向|不要用|避免)/,
    category: 'preference',
    scope: 'global',
    dir: 'profile',
  },
  {
    pattern: /(?:决定|确定了|就定为|选择|采用|方案是|最终决定|敲定了)/,
    category: 'decision',
    scope: 'project',
    dir: 'project',
  },
  {
    pattern: /(?:约定|惯例|规则是|按照|标准是|规范|格式为|命名规则|统一用)/,
    category: 'convention',
    scope: 'project',
    dir: 'project',
  },
  {
    pattern: /(?:发现|注意到|原来|实际上|揭示了|隐藏的|暗示|意味着|本质上是)/,
    category: 'insight',
    scope: 'project',
    dir: 'entities',
  },
  {
    pattern: /(?:规则|法则|定律|原理|机制|体系|约束|限制|条件是)/,
    category: 'rule',
    scope: 'project',
    dir: 'entities',
  },
  {
    pattern: /(?:总是|每次都|一贯|模式|规律|趋势|习惯于|反复)/,
    category: 'pattern',
    scope: 'project',
    dir: 'reflections',
  },
]

export async function extractFromConversation(
  userMessage: string,
  assistantMessage: string,
): Promise<ExtractionResult> {
  const result: ExtractionResult = {
    extracted: 0,
    entries: [],
  }

  const fullText = `${userMessage}\n${assistantMessage}`

  for (const { pattern, category, scope, dir } of EXTRACTION_PATTERNS) {
    const matches = fullText.match(new RegExp(pattern.source, 'gi'))
    if (!matches || matches.length === 0) continue

    for (const match of matches) {
      const contextStart = fullText.indexOf(match)
      const start = Math.max(0, contextStart - 50)
      const end = Math.min(fullText.length, contextStart + match.length + 200)
      const snippet = fullText.slice(start, end).trim()

      if (snippet.length < 20) continue

      const title = generateTitle(category, snippet)
      const safeName = title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
      const path = `${dir}/${safeName}.md`

      const existing = await kbSearchKeyword(title, scope, 3)
      const isDuplicate = existing.some(e =>
        e.path === path ||
        (e.summary && similarity(e.summary, snippet) > 0.7)
      )

      if (isDuplicate) {
        result.entries.push({ category, title, path, scope, action: 'skipped_duplicate' })
        continue
      }

      const content = formatKBContent(category, snippet, userMessage)
      const summary = snippet.length > 200 ? snippet.slice(0, 200) + '...' : snippet

      const entry = await kbWrite({
        path,
        scope,
        content,
        tags: [category, 'auto-extracted'],
        summary,
      })

      indexKBEntry(entry).catch(() => {})

      result.entries.push({ category, title, path, scope, action: 'created' })
      result.extracted++
    }
  }

  return result
}

export async function extractShortMemory(
  userMessage: string,
  _assistantMessage: string,
): Promise<number> {
  const shortPatterns = [
    /(?:记住|别忘了|记下来|保存|记录)(.{5,50})/gi,
    /(?:我的名字是|我叫|我是)(.{2,20})/gi,
    /(?:我(?:的|之)(?:项目|世界|故事)(?:名叫|名为|叫|名称是?))(.{2,30})/gi,
  ]

  let stored = 0
  const entries = loadMemory()

  for (const pattern of shortPatterns) {
    const matches = userMessage.matchAll(pattern)
    for (const match of matches) {
      const value = match[1]?.trim()
      if (!value || value.length < 2) continue

      const key = `auto:${match[0].slice(0, 20).replace(/\s/g, '_')}`
      const existing = entries.find(e => e.key === key)
      if (existing) continue

      entries.push({
        key,
        value: value.slice(0, 2000),
        tags: ['auto-extracted'],
        timestamp: Date.now(),
        accessCount: 0,
        lastAccessedAt: Date.now(),
      })
      stored++
    }
  }

  if (stored > 0) {
    const { kept, evictedKeys } = evictIfNeeded(entries)
    saveMemory(kept)
    for (const ek of evictedKeys) {
      const { removeMemoryIndex } = await import('../embedding/index')
      removeMemoryIndex(ek).catch(() => {})
    }
  }
  return stored
}

function generateTitle(category: string, snippet: string): string {
  const cleanSnippet = snippet.replace(/\n/g, ' ').slice(0, 60)
  const categoryNames: Record<string, string> = {
    preference: '偏好',
    decision: '决策',
    convention: '约定',
    insight: '洞察',
    rule: '规则',
    pattern: '模式',
  }
  return `${categoryNames[category] || category}-${cleanSnippet.slice(0, 20)}`
}

function formatKBContent(category: string, snippet: string, source: string): string {
  const categoryNames: Record<string, string> = {
    preference: '用户偏好',
    decision: '重要决策',
    convention: '约定惯例',
    insight: '洞察发现',
    rule: '世界规则',
    pattern: '模式规律',
  }

  return `# ${categoryNames[category] || category}

> 自动提取于对话

## 内容

${snippet}

## 来源

\`\`\`
${source.slice(0, 200)}
\`\`\`

## 提取时间

${new Date().toISOString()}
`
}

function similarity(a: string, b: string): number {
  const setA = new Set(a.toLowerCase().split(''))
  const setB = new Set(b.toLowerCase().split(''))
  const intersection = new Set([...setA].filter(x => setB.has(x)))
  const union = new Set([...setA, ...setB])
  return union.size === 0 ? 0 : intersection.size / union.size
}
