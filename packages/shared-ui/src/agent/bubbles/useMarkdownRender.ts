/** Markdown 渲染 composable（marked 解析 → DOMPurify 消毒 → mention 注入 + rAF 节流），详细见 docs/details/注释/packages/shared-ui/agent/bubbles/useMarkdownRender.md */
import { computed } from 'vue'
import { Marked } from 'marked'
import DOMPurify from 'dompurify'
import { useStreamingRenderer } from '@worldsmith/perf-kit/render'
import { useEntityMentionIndex } from '@worldsmith/shared-composables/agent/useEntityMentionIndex'
import { useAgentUiDeps } from '@worldsmith/shared-composables/agent/deps'

/** HTML 转义（代码块内嵌 / 纯文本回退用） */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 是否含未闭合代码围栏（``` 数量为奇数） */
function hasUnclosedFence(text: string): boolean {
  const fences = text.split('```').length - 1
  return fences % 2 === 1
}

/**
 * 语法高亮钩子（C 阶段接入）：对语言 lang 的代码返回高亮 HTML；返回 null 表示不高亮。
 * 默认不启用（B 阶段先落地代码块外壳），C 阶段注入 Prism 轻量实现。
 * 模块级可写，供外部注入，避免 shared-ui 与高亮库强耦合。
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

/** DOMPurify hook：保留 data-ws-* 自定义属性（实体 mention 依赖）—— 模块级只注册一次 */
let purifyHookRegistered = false
if (!purifyHookRegistered) {
  DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
    if (data.attrName?.startsWith('data-ws-')) {
      data.forceKeepAttr = true
    }
  })
  purifyHookRegistered = true
}

/**
 * 实体名高亮注入缓存：按原始文本缓存注入结果，避免流式输出时重复匹配
 * 注：原 WeakMap 在 TS5.7+ 要求 key 为 object，改用 Map；文本量有限，无需 GC 回收
 */
const mentionInjectCache = new Map<string, string>()

/**
 * 从 Markdown 文本中剥离顶层 JSON 对象块
 * 用于过滤 Agent 输出中混入的结构化 JSON（如 Block 指令），只保留 Markdown 文本
 */
export function stripJsonBlocks(text: string): string {
  const mdParts: string[] = []
  let lastEnd = 0
  let i = 0
  while (i < text.length) {
    if (text[i] === '{') {
      const jsonStr = tryExtractJson(text, i)
      if (jsonStr) {
        if (i > lastEnd) mdParts.push(text.slice(lastEnd, i))
        lastEnd = i + jsonStr.length
        i = lastEnd
        continue
      }
    }
    i++
  }
  if (lastEnd < text.length) mdParts.push(text.slice(lastEnd))
  return mdParts.map(s => s.trim()).filter(Boolean).join('\n')
}

/** 尝试从 start 位置提取一个完整 JSON 对象字符串，失败返回 null */
function tryExtractJson(text: string, start: number): string | null {
  if (text[start] !== '{') return null
  let depth = 0
  let j = start
  let inStr = false
  let esc = false
  while (j < text.length) {
    const ch = text[j]
    if (esc) { esc = false; j++; continue }
    if (ch === '\\' && inStr) { esc = true; j++; continue }
    if (ch === '"') { inStr = !inStr; j++; continue }
    if (!inStr) {
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          const str = text.slice(start, j + 1)
          try {
            const obj = JSON.parse(str)
            if (obj && typeof obj === 'object' && !Array.isArray(obj)) return str
          } catch {}
          return null
        }
      }
    }
    j++
  }
  return null
}

/**
 * 在 marked 渲染后的 HTML 中注入实体名高亮
 * 策略：用 DOMParser 解析 HTML，遍历纯文本节点（跳过 code/pre/a 等已格式化元素），
 * 匹配实体名并包裹 <span data-ws-entity-id="..." class="ws-entity-mention">
 */
function injectMentions(html: string, matchInText: (text: string) => Array<{ start: number; end: number; name: string; entityIds: string[]; entityType: string }>): string {
  if (!html) return ''
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
    mentionInjectCache.set(html, result)
    return result
  } catch {
    // DOMParser 不可用或解析失败时降级为原始 HTML
    return html
  }
}

/**
 * Markdown 渲染 composable
 *
 * @param getContent 返回当前消息的原始 content（调用方负责 role 过滤）
 * @returns rawMarkdown / throttledRaw / renderedMarkdown / renderMd
 */
export function useMarkdownRender(getContent: () => string) {
  const { matchInText } = useEntityMentionIndex()
  const { replaceFontSpans } = useAgentUiDeps()

  // 流式输出时 content 高频变化，用 rAF 节流渲染
  const rawMarkdown = computed(() => {
    const content = getContent()
    if (!content) return ''
    const withFontSpans = replaceFontSpans(content.trim())
    if (!withFontSpans) return ''
    return stripJsonBlocks(withFontSpans)
  })

  const throttledRaw = useStreamingRenderer(() => rawMarkdown.value, { initialValue: '' })

  /** 渲染单段 Markdown 为已消毒+注入 mention 的 HTML（含流式降级） */
  function renderMd(text: string): string {
    if (!text) return ''
    // 流式中代码围栏未闭合 → 纯文本（换行转 <br>），避免误吞噬后续内容
    if (hasUnclosedFence(text)) {
      return escapeHtml(text).replace(/\n/g, '<br>')
    }
    const raw = DOMPurify.sanitize(marked.parse(text) as string)
    return injectMentions(raw, matchInText)
  }

  const renderedMarkdown = computed(() => {
    const filtered = throttledRaw.value
    return filtered ? renderMd(filtered) : ''
  })

  return { rawMarkdown, throttledRaw, renderedMarkdown, renderMd }
}

/** 代码块复制按钮事件处理器（v-html 内按钮无法直接绑定，由气泡根元素事件委托调用）。
 *  命中 .ws-code-copy 时读取 data-copy 写入剪贴板，按钮短暂显示「已复制」。
 *  @returns 是否处理了代码复制（true 时调用方可不再走 mention 分支） */
export function handleCodeCopyClick(e: MouseEvent): boolean {
  const btn = (e.target as HTMLElement).closest?.('.ws-code-copy') as HTMLElement | null
  if (!btn) return false
  const text = btn.dataset.copy ?? ''
  navigator.clipboard.writeText(text).catch(() => {})
  btn.textContent = '已复制'
  setTimeout(() => {
    btn.textContent = '复制'
  }, 1600)
  return true
}

/**
 * 模块级纯函数：渲染单段 Markdown 为已消毒 HTML（无 mention 注入，无 rAF 节流）。
 *
 * 供无实体索引的轻场景复用（如群聊/私聊气泡），与 `useMarkdownRender.renderMd` 共用同一
 * marked 实例 + 代码块外壳 + 流式降级，保证跨入口代码块体验一致。
 * 调用方需要复制按钮时，在 v-html 容器根元素上绑定 `@click` 并调用 `handleCodeCopyClick`。
 */
export function renderMarkdownHtml(text: string): string {
  if (!text) return ''
  // 流式中代码围栏未闭合 → 纯文本（换行转 <br>），避免误吞噬后续内容
  if (hasUnclosedFence(text)) {
    return escapeHtml(text).replace(/\n/g, '<br>')
  }
  return DOMPurify.sanitize(marked.parse(text) as string)
}