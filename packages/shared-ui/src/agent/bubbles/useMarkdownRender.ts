/** Markdown 渲染 composable（增量渲染内核见 markdownStream.ts；rAF 节流 + 字体段 + JSON 剥离），详细见 docs/details/注释/packages/shared-ui/agent/bubbles/useMarkdownRender.md */
import { computed } from 'vue'
import { useStreamingRenderer } from '@worldsea/perf-kit/render'
import { useEntityMentionIndex } from '@worldsea/shared-composables/agent/useEntityMentionIndex'
import { useAgentUiDeps } from '@worldsea/shared-composables/agent/deps'
// 渲染内核已抽到产品级 `../../markdown`（2026-09-27 E7）
import {
  createMarkdownStreamRenderer,
  renderFullMarkdown,
  type StreamRenderedHtml,
} from '../../markdown'

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
 * Markdown 渲染 composable
 *
 * 渲染链路：原始 content →（字体段 / JSON 剥离）→ rAF 节流 → **增量渲染器**
 * （已完成块只渲一次并缓存，活动尾块每帧重渲；见 markdownStream.ts）
 *
 * @param getContent 返回当前消息的原始 content（调用方负责 role 过滤）
 * @returns rawMarkdown / throttledRaw / renderedMarkdown（兼容整串）/ renderMd（整段路径）
 *          / stableHtml + tailHtml（增量双段，供视图层分容器消费）
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

  /** 增量渲染器（组件实例级状态：固化段缓存 + 尾块独立重渲） */
  const streamRenderer = createMarkdownStreamRenderer({ matchInText })

  /** 整段路径（兼容 API；整段消毒 + mention 注入 + 围栏降级） */
  function renderMd(text: string): string {
    if (!text) return ''
    return renderFullMarkdown(text, matchInText)
  }

  const streamRendered = computed<StreamRenderedHtml>(() => {
    const filtered = throttledRaw.value
    if (!filtered) return { stableHtml: '', tailHtml: '' }
    return streamRenderer.render(filtered)
  })

  /** 固化段 HTML（跨帧仅追加） */
  const stableHtml = computed(() => streamRendered.value.stableHtml)
  /** 活动尾块 HTML（每帧重渲） */
  const tailHtml = computed(() => streamRendered.value.tailHtml)
  /** 整串兼容（stable + tail；无 mention 索引需求以外的调用方沿用此值） */
  const renderedMarkdown = computed(() => streamRendered.value.stableHtml + streamRendered.value.tailHtml)

  return { rawMarkdown, throttledRaw, renderedMarkdown, renderMd, stableHtml, tailHtml }
}