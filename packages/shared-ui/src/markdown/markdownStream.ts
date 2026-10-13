/**
 * 流式 Markdown 内核（块级增量渲染），详细见 docs/details/注释/packages/shared-ui/markdown/markdownStream.md
 * 与 useMarkdownRender 分工：本模块 = marked 实例 + 代码块外壳 + 高亮注入钩子 + 消毒（DOMPurify）+ mention 注入 + 「稳定前缀/活动尾块」分块（splitMarkdownStream）+ 增量渲染器；useMarkdownRender.ts = Vue composable 接线（rAF 节流/字体段/JSON 剥离/兼容 API）。
 * 增量策略与保守回退（只固化最后一个内容 token 之前；def/html 整段回退；前缀校验失败回退；未闭合围栏仅降级尾块为纯文本）详见上述文档。
 */
import { Marked, type Token } from 'marked'
import DOMPurify from 'dompurify'

// ─── 基础工具 ─────────────────────────────────────────────

/** HTML 转义（代码块内嵌 / 纯文本回退用） */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 是否含未闭合代码围栏（``` 数量为奇数） */
export function hasUnclosedFence(text: string): boolean {
  const fences = text.split('```').length - 1
  return fences % 2 === 1
}

// ─── marked 实例与自定义渲染器 ─────────────────────────────

/**
 * 语法高亮钩子：对语言 lang 的代码返回高亮 HTML；返回 null 表示不高亮。
 * 模块级可写，供外部注入（codeHighlight.ts 加载即注入 Prism 实现），避免强耦合。
 */
let highlightCode: ((code: string, lang: string) => string | null) | null = null
export function setCodeHighlighter(fn: ((code: string, lang: string) => string | null) | null): void {
  highlightCode = fn
}

/** 生成高亮后的 <code> 内容：命中高亮器返回其输出，否则转义原文 */
function renderCodeContent(code: string, lang: string): string {
  if (highlightCode) {
    try {
      const highlighted = highlightCode(code, lang)
      if (highlighted) return highlighted
    } catch {
      // 高亮失败降级为纯文本
    }
  }
  return escapeHtml(code)
}

/** marked 实例（无状态，模块级共享） */
const marked = new Marked({ gfm: true, breaks: true })

/**
 * 自定义 code renderer：为代码块包裹 header（语言标签 + 复制按钮）。
 * 与 Tauri 端 MessageContent 同款外壳，保证跨端代码块体验一致。
 * data-copy 存转义后的代码文本，复制动作由气泡根元素事件委托处理。
 */
marked.use({
  renderer: {
    code({ text, lang }) {
      const language = lang || 'text'
      const safeLang = escapeHtml(language)
      const body = renderCodeContent(String(text), language)
      return [
        '<div class="ws-code-block">',
        '<div class="ws-code-head">',
        `<span class="ws-code-lang">${safeLang}</span>`,
        `<button type="button" class="ws-code-copy" data-copy="${escapeHtml(String(text))}">复制</button>`,
        '</div>',
        `<pre><code class="language-${safeLang}">${body}</code></pre>`,
        '</div>',
      ].join('')
    },
    link({ href, title, text }) {
      const hrefAttr = escapeHtml(String(href))
      const titleAttr = title ? ` title="${escapeHtml(String(title))}"` : ''
      return `<a href="${hrefAttr}" target="_blank" rel="noopener noreferrer"${titleAttr}>${text}</a>`
    },
  },
})

/** 用共享 marked 实例对原文做词法切分 */
export function lexMarkdown(text: string): Token[] {
  return marked.lexer(text) as Token[]
}

/** 将 token 序列渲染为 HTML（未消毒；含代码块外壳与高亮注入） */
export function parseMarkdownTokens(tokens: Token[]): string {
  return marked.parser(tokens) as string
}

// ─── 裸渲染（编辑器装载专用，无代码块外壳）─────────────────

/**
 * 裸 marked 实例：与共享实例同 GFM/breaks 配置，但不带 code/link 自定义渲染器。
 * 不能复用共享实例：其 code renderer 产出的「语言标签 + 复制按钮」外壳喂给 TipTap setContent 会被
 * schema 过滤，外壳文字污染代码块/正文（2026-10-11 笔记装载网关）；lexer 与 renderer 无关，token 可跨实例复用。
 */
const markedRaw = new Marked({ gfm: true, breaks: true })

/** 将 token 序列渲染为裸 HTML（未消毒；`<pre><code>` 无外壳，链接无 target） */
export function parseMarkdownTokensRaw(tokens: Token[]): string {
  return markedRaw.parser(tokens) as string
}

/**
 * 渲染 Markdown 为编辑器装载用 HTML（已消毒，无代码块外壳、无 mention 注入）。
 * 与 renderFullMarkdown 同一套词法与围栏降级语义（未闭合围栏 → 整段转义 + `<br>`），
 * 差异仅在：不走带外壳的 code renderer —— 产物可直接进 TipTap schema 不产生外壳残渣。
 */
export function renderMarkdownForEditor(text: string): string {
  if (!text) return ''
  if (hasUnclosedFence(text)) {
    return escapeHtml(text).replace(/\n/g, '<br>')
  }
  return sanitizeMarkdownHtml(parseMarkdownTokensRaw(lexMarkdown(text)))
}

// ─── 消毒与 mention 注入 ──────────────────────────────────

/** DOMPurify hook：保留 data-ws-* 自定义属性（实体 mention 依赖）——模块级只注册一次 */
let purifyHookRegistered = false
if (!purifyHookRegistered) {
  DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
    if (data.attrName?.startsWith('data-ws-')) {
      data.forceKeepAttr = true
    }
  })
  purifyHookRegistered = true
}

/** 消毒（保留 data-ws-*） */
export function sanitizeMarkdownHtml(html: string): string {
  return DOMPurify.sanitize(html)
}

/** mention 匹配器（结构兼容 shared-composables 的 MentionMatch，避免反向依赖） */
export type MentionMatcher = (text: string) => Array<{
  start: number
  end: number
  name: string
  entityIds: string[]
  entityType: string
}>

/**
 * 实体名高亮注入缓存：按原始 HTML 缓存注入结果，避免重渲染时重复匹配。
 * 增量渲染后 key 以「单 token HTML」为主（复用率高）；但整段回退路径（def/html）仍会以整段 HTML 为 key。
 * 设上限 FIFO 淘汰，防长会话累积。
 */
const MENTION_CACHE_MAX = 200
const mentionInjectCache = new Map<string, string>()

/** 淘汰最早的 20%：一次删一批而非一条，摊销淘汰开销 */
function evictMentionCache(): void {
  const drop = Math.ceil(MENTION_CACHE_MAX * 0.2)
  let i = 0
  for (const k of mentionInjectCache.keys()) {
    if (i++ >= drop) break
    mentionInjectCache.delete(k)
  }
}

/**
 * 在渲染后的 HTML 中注入实体名高亮
 * 策略：用 DOMParser 解析 HTML，遍历纯文本节点（跳过 code/pre/a 等已格式化元素），
 * 匹配实体名并包裹 <span data-ws-entity-id="..." class="ws-entity-mention">。@param matchInText 为空时跳过注入（无实体索引的轻场景）
 */
export function injectMentions(html: string, matchInText: MentionMatcher | null): string {
  if (!html || !matchInText) return html
  // 缓存命中：避免流式输出时同一段文本反复匹配
  const cached = mentionInjectCache.get(html)
  if (cached !== undefined) return cached

  try {
    const doc = new DOMParser().parseFromString(`<div id="__root">${html}</div>`, 'text/html')
    const root = doc.getElementById('__root')
    if (!root) return html

    let hasMatch = false
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        // 跳过 code/pre/a 标签内的文本（这些不需要实体高亮）
        const parent = node.parentElement
        if (!parent) return NodeFilter.FILTER_REJECT
        const tag = parent.tagName.toLowerCase()
        if (tag === 'code' || tag === 'pre' || tag === 'a' || tag === 'script' || tag === 'style') {
          return NodeFilter.FILTER_REJECT
        }
        // 跳过已是 mention span 内的文本
        if (parent.classList?.contains('ws-entity-mention')) {
          return NodeFilter.FILTER_REJECT
        }
        return node.nodeValue && node.nodeValue.trim().length >= 2
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT
      },
    })

    const textNodes: Text[] = []
    let current: Node | null
    while ((current = walker.nextNode())) {
      textNodes.push(current as Text)
    }

    for (const textNode of textNodes) {
      const text = textNode.nodeValue || ''
      const matches = matchInText(text)
      if (matches.length === 0) continue

      // 将文本节点替换为：普通文本 + mention span 的混合序列
      const fragment = doc.createDocumentFragment()
      let lastEnd = 0
      for (const m of matches) {
        if (m.start > lastEnd) {
          fragment.appendChild(doc.createTextNode(text.slice(lastEnd, m.start)))
        }
        const span = doc.createElement('span')
        span.className = 'ws-entity-mention'
        span.setAttribute('data-ws-entity-id', m.entityIds[0])
        span.setAttribute('data-ws-entity-type', m.entityType)
        span.setAttribute('data-ws-entity-name', m.name)
        span.textContent = m.name
        span.title = `${m.entityType}: ${m.name}（点击查看详情）`
        fragment.appendChild(span)
        lastEnd = m.end
      }
      if (lastEnd < text.length) {
        fragment.appendChild(doc.createTextNode(text.slice(lastEnd)))
      }
      textNode.parentNode?.replaceChild(fragment, textNode)
      hasMatch = true
    }

    const result = hasMatch ? root.innerHTML : html
    if (mentionInjectCache.size >= MENTION_CACHE_MAX) evictMentionCache()
    mentionInjectCache.set(html, result)
    return result
  } catch {
    // DOMParser 不可用或解析失败时降级为原始 HTML
    return html
  }
}

// ─── 全量渲染（既有语义；围栏降级 + 整段消毒 + 可选 mention）───

/**
 * 渲染单段 Markdown 为已消毒（可选注入 mention）的 HTML——整段路径。
 * 未闭合围栏 → 整段纯文本（换行转 <br>），避免误吞噬后续内容。
 */
export function renderFullMarkdown(text: string, matchInText: MentionMatcher | null): string {
  if (!text) return ''
  if (hasUnclosedFence(text)) {
    return escapeHtml(text).replace(/\n/g, '<br>')
  }
  return injectMentions(sanitizeMarkdownHtml(parseMarkdownTokens(lexMarkdown(text))), matchInText)
}

// ─── 流式分块 ─────────────────────────────────────────────

export interface MarkdownStreamSplit {
  /** 已固化原文前缀（必为 text 的前缀；空串表示全部仍在尾块） */
  stableRaw: string
  /** 固化区 token（来自全量词法切分，供调用方增量追加渲染） */
  stableTokens: Token[]
  /** 活动尾块原文（text.slice(stableRaw.length)） */
  tailRaw: string
  /** 尾块 token（全量词法切分的尾部） */
  tailTokens: Token[]
  /** 是否走「整段回退」路径（def/html 存在 / 前缀校验失败；此时 stable 必为空） */
  fallback: boolean
}

/**
 * 计算「稳定前缀 / 活动尾块」的原文切分（纯函数）。
 * 规则：尾 token（最后一个非 space token）是唯一可能随后续文本增长的 token——其之前的 token
 * 一旦不再位于尾部即已定型，可安全固化；含 def/html token 的文本因跨 token 语义 / 片段消毒不安全，整段回退。
 */
export function splitMarkdownStream(text: string, lex: (src: string) => Token[] = lexMarkdown): MarkdownStreamSplit {
  const empty: MarkdownStreamSplit = { stableRaw: '', stableTokens: [], tailRaw: text, tailTokens: [], fallback: false }
  if (!text) return empty

  let tokens: Token[]
  try {
    tokens = lex(text)
  } catch {
    return { ...empty, fallback: true }
  }

  // 保守回退：引用式链接定义 / 原始 HTML 块（调用方走整段渲染，tailTokens 仅作信息）
  if (tokens.some((t) => t.type === 'def' || t.type === 'html')) {
    return { ...empty, tailTokens: tokens, fallback: true }
  }

  // 最后一个内容 token 下标（space 不计）
  let lastContent = -1
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (tokens[i].type !== 'space') {
      lastContent = i
      break
    }
  }
  // 无内容 token 或唯一内容 token 即尾块（全部未定型）→ 整段作尾块
  if (lastContent <= 0) return { ...empty, tailTokens: tokens }

  const stableTokens = tokens.slice(0, lastContent)
  const stableRaw = stableTokens.map((t) => t.raw).join('')
  // 防御：token.raw 拼不回原文前缀（未知语法差异）→ 整段回退
  if (!text.startsWith(stableRaw)) {
    return { ...empty, fallback: true }
  }
  return {
    stableRaw,
    stableTokens,
    tailRaw: text.slice(stableRaw.length),
    tailTokens: tokens.slice(lastContent),
    fallback: false,
  }
}

// ─── 增量渲染器 ───────────────────────────────────────────

export interface MarkdownStreamRendererOptions {
  /** mention 匹配器（空 = 不注入） */
  matchInText?: MentionMatcher | null
  /** 词法切分函数（默认共享 marked 实例；测试可注入） */
  lex?: (src: string) => Token[]
  /** 固化 token HTML 缓存上限（默认 512） */
  cacheMax?: number
}

export interface StreamRenderedHtml {
  /** 固化段 HTML（跨帧仅追加，稳定字符串可让视图层跳过该容器更新） */
  stableHtml: string
  /** 活动尾块 HTML（每帧重渲） */
  tailHtml: string
}

export interface MarkdownStreamRenderer {
  /** 渲染一帧（文本只增不减时序下，稳定段走 token 缓存，尾块独立重渲） */
  render(text: string): StreamRenderedHtml
  /** 丢弃全部状态（清缓存） */
  reset(): void
}

/**
 * 创建增量渲染器：把「已完成块只渲一次、活动尾块每帧重渲」的状态机收在一处。契约（由单测锁定）：
 * stableHtml + tailHtml 与整段渲染等价（未闭合围栏帧除外，该帧尾块按既有语义降级为纯文本）；固化块的 token HTML 只渲染一次；非前缀增长 → 自动重置重建。
 */
export function createMarkdownStreamRenderer(opts: MarkdownStreamRendererOptions = {}): MarkdownStreamRenderer {
  const matchInText = opts.matchInText ?? null
  const lex = opts.lex ?? lexMarkdown
  const cacheMax = opts.cacheMax ?? 512

  let stableRaw = ''
  let stableHtml = ''
  let stableCount = 0
  let lastText: string | null = null
  let last: StreamRenderedHtml = { stableHtml: '', tailHtml: '' }
  const tokenCache = new Map<string, string>()

  function reset(): void {
    stableRaw = ''
    stableHtml = ''
    stableCount = 0
    lastText = null
    last = { stableHtml: '', tailHtml: '' }
    tokenCache.clear()
  }

  /** 渲染一组 token 为「已消毒 + mention 注入」片段 */
  function renderTokens(tokens: Token[]): string {
    if (tokens.length === 0) return ''
    return injectMentions(sanitizeMarkdownHtml(parseMarkdownTokens(tokens)), matchInText)
  }

  return {
    reset,
    render(text: string): StreamRenderedHtml {
      if (text === lastText) return last

      // 非前缀增长（编辑 / 修正 / 重放）→ 重置后重建
      if (stableRaw && !text.startsWith(stableRaw)) reset()

      const split = splitMarkdownStream(text, lex)

      // 整段回退（def/html / 前缀校验失败）：行为与既有整段渲染一致
      if (split.fallback) {
        reset()
        lastText = text
        last = { stableHtml: '', tailHtml: renderFullMarkdown(text, matchInText) }
        return last
      }

      // 防御：切分未见增长却与已固化状态不一致 → 重置后按本次切分重建
      if (split.stableTokens.length < stableCount || !split.stableRaw.startsWith(stableRaw)) {
        stableRaw = ''
        stableHtml = ''
        stableCount = 0
      }

      // 固化新增 token（每个 token 只渲染一次，进缓存）
      if (split.stableTokens.length > stableCount) {
        const parts: string[] = [stableHtml]
        for (let i = stableCount; i < split.stableTokens.length; i++) {
          const token = split.stableTokens[i]
          let html = tokenCache.get(token.raw)
          if (html === undefined) {
            html = renderTokens([token])
            tokenCache.set(token.raw, html)
            if (tokenCache.size > cacheMax) {
              // FIFO 淘汰最早 20%
              const drop = Math.ceil(cacheMax * 0.2)
              let n = 0
              for (const k of tokenCache.keys()) {
                if (n++ >= drop) break
                tokenCache.delete(k)
              }
            }
          }
          parts.push(html)
        }
        stableHtml = parts.join('')
        stableCount = split.stableTokens.length
      }
      stableRaw = split.stableRaw

      // 尾块：未闭合围栏按既有语义降级为纯文本；否则独立重渲
      const tailHtml = hasUnclosedFence(split.tailRaw)
        ? escapeHtml(split.tailRaw).replace(/\n/g, '<br>')
        : renderTokens(split.tailTokens)

      lastText = text
      last = { stableHtml, tailHtml }
      return last
    },
  }
}