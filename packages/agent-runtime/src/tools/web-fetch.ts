/**
 * 网页抓取工具
 *
 * 通过 Jina Reader API (r.jina.ai) 将任意网页转换为干净的 Markdown 文本。
 * 适用于深入阅读搜索结果中的网页内容。
 */

import type { ToolDefinition } from '../bridge-types'
import type { ToolMeta } from '@worldsmith/agent-core'
import { smartFetch } from '../utils/smart-fetch'

/** 支持的 Jina Reader 输出格式 */
export type JinaFormat = 'markdown' | 'text' | 'html'

const JINA_READER_BASE = 'https://r.jina.ai'
const DEFAULT_MAX_LENGTH = 8000
const DEFAULT_TIMEOUT = 30
const DEFAULT_RETRIES = 2

/**
 * 解析用户传入的格式参数为 Jina Reader 支持的格式。
 * 容错处理常见别名（md → markdown, txt → text）。
 */
export function normalizeFormat(format: unknown): JinaFormat {
  const raw = String(format || 'markdown').toLowerCase()
  if (raw === 'md' || raw === 'markdown') return 'markdown'
  if (raw === 'txt' || raw === 'text' || raw === 'plain') return 'text'
  if (raw === 'html') return 'html'
  return 'markdown'
}

/**
 * 使用 Jina Reader 抓取单个 URL。
 * 内置超时、重试和统一的 User-Agent。
 */
export async function fetchWithJina(
  url: string,
  format: JinaFormat,
  timeout: number,
  retries: number,
): Promise<{ content: string; format: JinaFormat; attempts: number }> {
  const jinaUrl = `${JINA_READER_BASE}/${url}`
  const acceptHeader = format === 'html' ? 'text/html' : format === 'text' ? 'text/plain' : 'text/markdown'

  let lastError: Error | undefined
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await smartFetch(jinaUrl, {
        method: 'GET',
        headers: {
          'Accept': acceptHeader,
          'X-Return-Format': format,
          'User-Agent': 'WorldSmith-Agent/1.0 (Jina-Reader-Proxy)',
        },
        timeout,
      })

      if (!resp.ok) {
        const text = await resp.text()
        throw new Error(`Jina Reader API ${resp.status}: ${text.slice(0, 200)}`)
      }

      const content = await resp.text()
      return { content, format, attempts: attempt + 1 }
    } catch (err: any) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt < retries) {
        // 指数退避：1s, 2s
        await new Promise(r => setTimeout(r, (attempt + 1) * 1000))
      }
    }
  }

  throw lastError ?? new Error('Jina Reader 请求失败')
}

/**
 * web_fetch — 抓取网页内容
 * 使用 Jina Reader API，支持 Markdown / 纯文本 / HTML 三种输出格式。
 * 支持 max_length 控制长度、format 控制格式、timeout 控制超时、retries 控制重试次数。
 */
export const webFetchTool: ToolDefinition = {
  name: 'web_fetch',
  description:
    '抓取指定 URL 的网页全文内容并转为干净文本。单页静态内容兜底方案。' +
    '适合 web_search 结果详情等单页快速阅读；如果页面需要 JS 渲染、反检测或批量抓取，请使用 web_crawl；' +
    '如果需要网页搜索、整站爬取或地图扫描，请优先使用 Firecrawl MCP 工具（mcp_firecrawl-keyless_*）。' +
    'URL 必须是完整的 http/https 地址。',
  parameters: {
    url: { type: 'string', description: '要读取的网页 URL', required: true },
    max_length: { type: 'number', description: '返回内容的最大字符数，默认8000', required: false },
    format: { type: 'string', description: '输出格式：markdown(默认)/text/html', required: false },
    timeout: { type: 'number', description: '单次请求超时秒数，默认30', required: false },
    retries: { type: 'number', description: '失败重试次数，默认2', required: false },
  },
  meta: {
    permission: 'safe',
    category: 'search',
    alwaysAvailable: true,
    displayName: '网页抓取',
  } satisfies ToolMeta,
  execute: async (args, _ctx) => {
    const url = String(args.url)
    const maxLength = Number(args.max_length) || DEFAULT_MAX_LENGTH
    const format = normalizeFormat(args.format)
    const timeout = Number(args.timeout) || DEFAULT_TIMEOUT
    const retries = Number(args.retries) ?? DEFAULT_RETRIES

    if (!url.match(/^https?:\/\//i)) {
      return JSON.stringify({ error: 'URL 必须以 http:// 或 https:// 开头', url })
    }

    try {
      const { content, attempts } = await fetchWithJina(url, format, timeout, retries)

      if (!content || content.trim().length === 0) {
        return JSON.stringify({ error: '网页内容为空或无法解析', url })
      }

      const trimmed = content.length > maxLength
        ? content.slice(0, maxLength) + '\n\n...[内容已截断]'
        : content

      return JSON.stringify({
        url,
        content: trimmed,
        length: content.length,
        truncated: content.length > maxLength,
        format,
        attempts,
      })
    } catch (err: any) {
      return JSON.stringify({
        error: `读取网页失败: ${err.message || String(err)}`,
        url,
        hint: '如页面需要 JS 渲染，请改用 web_crawl 工具或 Firecrawl MCP 工具',
      })
    }
  },
}

export const webFetchTools: ToolDefinition[] = [webFetchTool]
