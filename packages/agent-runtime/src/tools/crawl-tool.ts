/** 深度网页爬取工具：Crawl4AI 优先 + Jina Reader 降级，详细见 docs/details/注释/packages/agent-runtime/tools-crawl-tool.md */

import type { ToolDefinition } from '../bridge-types'
import type { ToolMeta } from '@worldsea/agent-core'
import { fetchWithJina, normalizeFormat } from './web-fetch'
import { smartFetch } from '../utils/smart-fetch'

/** Crawl4AI 后端服务基础地址 */
const CRAWL4AI_BACKEND_BASE = 'http://localhost:3100/api/crawl'

/** 默认值 */
const DEFAULT_MAX_LENGTH = 8000
const DEFAULT_TIMEOUT = 30
const DEFAULT_RETRIES = 1
const DEFAULT_CONCURRENCY = 2

/** 单条抓取结果 */
interface CrawlItemResult {
  url: string
  status: 'success' | 'error'
  content: string
  length: number
  truncated: boolean
  format: string
  error?: string
  fallback?: boolean
  attempts?: number
}

/** 批量抓取结果 */
interface CrawlBatchResult {
  total: number
  successful: number
  failed: number
  results: CrawlItemResult[]
  backendAvailable: boolean
  fallbackCount: number
}

/**
 * 将任意输入归一化为 URL 字符串数组。
 */
function normalizeUrls(args: Record<string, unknown>): string[] {
  const raw: unknown[] = []
  if (args.url) raw.push(args.url)
  if (args.urls && Array.isArray(args.urls)) raw.push(...args.urls)

  const urls = raw
    .map((u) => String(u).trim())
    .filter((u) => /^https?:\/\//i.test(u))

  // 去重并保持顺序
  return Array.from(new Set(urls))
}

/**
 * 使用 AbortController 实现超时的 smartFetch 包装。
 */
async function fetchWithTimeout(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: string; timeout: number },
): Promise<ReturnType<typeof smartFetch>> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), options.timeout * 1000)
  try {
    return await smartFetch(url, {
      method: options.method,
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
      timeout: options.timeout,
    })
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * 重试包装器。
 */
async function withRetries<T>(
  fn: () => Promise<T>,
  retries: number,
): Promise<T> {
  let lastError: Error | undefined
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (err: any) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, (attempt + 1) * 1000))
      }
    }
  }
  throw lastError ?? new Error('请求失败')
}

/**
 * 调用 Crawl4AI 后端抓取单个 URL。
 */
async function crawlWithBackend(
  url: string,
  maxLength: number,
  outputFormat: string,
  timeout: number,
  retries: number,
): Promise<CrawlItemResult> {
  const result = await withRetries(async () => {
    const resp = await fetchWithTimeout(CRAWL4AI_BACKEND_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, max_length: maxLength, output_format: outputFormat, timeout }),
      timeout: timeout + 5, // 给网络层一点缓冲
    })

    if (!resp.ok) {
      const text = await resp.text()
      throw new Error(`Crawl4AI 后端 ${resp.status}: ${text.slice(0, 200)}`)
    }

    return resp.json()
  }, retries)

  const content = String(result.content ?? result.markdown ?? '')
  return {
    url,
    status: result.status === 'success' ? 'success' : 'error',
    content,
    length: result.length ?? content.length,
    truncated: result.truncated ?? false,
    format: result.format ?? outputFormat,
    error: result.error,
    fallback: false,
    attempts: result.attempts ?? retries + 1,
  }
}

/**
 * 调用 Crawl4AI 后端批量抓取。
 */
async function crawlBatchWithBackend(
  urls: string[],
  maxLength: number,
  outputFormat: string,
  timeout: number,
  retries: number,
  concurrency: number,
): Promise<CrawlBatchResult> {
  const result = await withRetries(async () => {
    const resp = await fetchWithTimeout(`${CRAWL4AI_BACKEND_BASE}/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        urls,
        max_length: maxLength,
        output_format: outputFormat,
        timeout,
        concurrency,
      }),
      timeout: Math.min(300, timeout * Math.ceil(urls.length / concurrency) + 10), // 批量给足够缓冲，最多 5 分钟
    })

    if (!resp.ok) {
      const text = await resp.text()
      throw new Error(`Crawl4AI 批量后端 ${resp.status}: ${text.slice(0, 200)}`)
    }

    return resp.json()
  }, retries)

  const results: CrawlItemResult[] = (result.results || []).map((r: any) => ({
    url: r.url,
    status: r.status === 'success' ? 'success' : 'error',
    content: String(r.content ?? ''),
    length: r.length ?? 0,
    truncated: r.truncated ?? false,
    format: r.format ?? outputFormat,
    error: r.error,
    fallback: false,
    attempts: r.attempts ?? 1,
  }))

  return {
    total: result.total ?? results.length,
    successful: result.successful ?? results.filter((r) => r.status === 'success').length,
    failed: result.failed ?? results.filter((r) => r.status === 'error').length,
    results,
    backendAvailable: true,
    fallbackCount: 0,
  }
}

/**
 * 使用 Jina Reader 作为单条兜底抓取。
 */
async function crawlWithJinaFallback(
  url: string,
  maxLength: number,
  format: 'markdown' | 'text' | 'html',
  timeout: number,
  retries: number,
): Promise<CrawlItemResult> {
  try {
    const { content, attempts } = await fetchWithJina(url, format, timeout, retries)
    const trimmed = content.length > maxLength
      ? content.slice(0, maxLength) + '\n\n...[内容已截断]'
      : content

    return {
      url,
      status: 'success',
      content: trimmed,
      length: content.length,
      truncated: content.length > maxLength,
      format,
      fallback: true,
      attempts,
    }
  } catch (err: any) {
    return {
      url,
      status: 'error',
      content: '',
      length: 0,
      truncated: false,
      format,
      error: `Crawl4AI 后端不可用，Jina Reader 也失败: ${err.message || String(err)}`,
      fallback: true,
      attempts: retries + 1,
    }
  }
}

/**
 * 处理单 URL 抓取，失败时走 Jina 兜底。
 */
async function crawlOne(
  url: string,
  maxLength: number,
  outputFormat: string,
  jinaFormat: 'markdown' | 'text' | 'html',
  timeout: number,
  retries: number,
): Promise<CrawlItemResult> {
  try {
    const result = await crawlWithBackend(url, maxLength, outputFormat, timeout, retries)
    if (result.status === 'success') return result
    // 后端返回 error，也尝试 Jina 兜底
    return await crawlWithJinaFallback(url, maxLength, jinaFormat, timeout, retries)
  } catch {
    return await crawlWithJinaFallback(url, maxLength, jinaFormat, timeout, retries)
  }
}

/**
 * 处理批量抓取，失败条目走 Jina 兜底。
 */
async function crawlBatch(
  urls: string[],
  maxLength: number,
  outputFormat: string,
  jinaFormat: 'markdown' | 'text' | 'html',
  timeout: number,
  retries: number,
  concurrency: number,
): Promise<CrawlBatchResult> {
  let backendResult: CrawlBatchResult | null = null

  try {
    backendResult = await crawlBatchWithBackend(
      urls,
      maxLength,
      outputFormat,
      timeout,
      retries,
      concurrency,
    )
  } catch {
    // 后端完全不可用，稍后全部走 Jina 兜底
  }

  // 如果后端完全不可用，全部走 Jina 兜底
  if (!backendResult) {
    const results = await Promise.all(
      urls.map((url) => crawlWithJinaFallback(url, maxLength, jinaFormat, timeout, retries)),
    )
    const successful = results.filter((r) => r.status === 'success').length
    return {
      total: urls.length,
      successful,
      failed: urls.length - successful,
      results,
      backendAvailable: false,
      fallbackCount: urls.length,
    }
  }

  // 对失败条目尝试 Jina 兜底
  const failedUrls = backendResult.results.filter((r) => r.status === 'error').map((r) => r.url)
  const fallbackMap = new Map<string, CrawlItemResult>()
  if (failedUrls.length > 0) {
    const fallbackResults = await Promise.all(
      failedUrls.map((url) => crawlWithJinaFallback(url, maxLength, jinaFormat, timeout, retries)),
    )
    for (const r of fallbackResults) fallbackMap.set(r.url, r)
  }

  const finalResults = backendResult.results.map((r) => {
    if (r.status === 'error' && fallbackMap.has(r.url)) {
      return fallbackMap.get(r.url)!
    }
    return r
  })

  const successful = finalResults.filter((r) => r.status === 'success').length
  return {
    total: backendResult.total,
    successful,
    failed: backendResult.total - successful,
    results: finalResults,
    backendAvailable: true,
    fallbackCount: failedUrls.filter((url) => fallbackMap.get(url)?.status === 'success').length,
  }
}

/**
 * web_crawl — 深度爬取网页内容
 * 比 web_fetch 更强大：支持 JS 渲染页面、反检测、批量抓取、结构化数据提取。
 * 优先调用本地 Crawl4AI 后端，失败后降级到 Jina Reader。
 */
export const crawlTool: ToolDefinition = {
  name: 'web_crawl',
  description:
    '深度爬取网页内容。优先用于 JS 渲染页面、反检测、批量抓取或需要结构化数据的场景。' +
    '本地 Crawl4AI 服务可用时走本地后端；不可用时自动降级到 Jina Reader。' +
    '如需网页搜索或整站爬取，请优先使用 Firecrawl MCP 工具（mcp_firecrawl-keyless_*）；' +
    '如需单页静态内容兜底，请使用 web_fetch。',
  parameters: {
    url: {
      type: 'string',
      description: '要爬取的网页 URL（与 urls 二选一或同时提供）',
      required: false,
    },
    urls: {
      type: 'array',
      description: '要批量爬取的网页 URL 列表（与 url 二选一或同时提供）',
      required: false,
      items: { type: 'string', description: '网页 URL' },
    },
    max_length: {
      type: 'number',
      description: '返回内容的最大字符数，默认8000',
      required: false,
    },
    output_format: {
      type: 'string',
      description: '输出格式: markdown(默认)/fit_markdown(去噪)/cleaned_html',
      required: false,
    },
    timeout: {
      type: 'number',
      description: '单个 URL 抓取超时秒数，默认30',
      required: false,
    },
    retries: {
      type: 'number',
      description: '失败重试次数，默认1',
      required: false,
    },
    concurrency: {
      type: 'number',
      description: '批量抓取最大并发数（1-5），默认2',
      required: false,
    },
  },
  meta: {
    permission: 'moderate',
    category: 'search',
    displayName: '网页爬虫',
  } satisfies ToolMeta,
  execute: async (args, _ctx) => {
    const urls = normalizeUrls(args)
    if (urls.length === 0) {
      return JSON.stringify({ error: '必须提供至少一个有效的 http/https URL（url 或 urls）' })
    }

    const maxLength = Number(args.max_length) || DEFAULT_MAX_LENGTH
    const outputFormat = String(args.output_format || 'markdown')
    const timeout = Number(args.timeout) || DEFAULT_TIMEOUT
    const retries = Number(args.retries) ?? DEFAULT_RETRIES
    const concurrency = Math.min(5, Math.max(1, Number(args.concurrency) || DEFAULT_CONCURRENCY))

    // Jina 兜底只支持 markdown/text/html，fit_markdown/cleaned_html 回退到 markdown
    const jinaFormat = normalizeFormat(outputFormat)

    if (urls.length === 1) {
      const result = await crawlOne(urls[0], maxLength, outputFormat, jinaFormat, timeout, retries)
      return JSON.stringify(result)
    }

    const batchResult = await crawlBatch(
      urls,
      maxLength,
      outputFormat,
      jinaFormat,
      timeout,
      retries,
      concurrency,
    )
    return JSON.stringify(batchResult)
  },
}

export const crawlTools: ToolDefinition[] = [crawlTool]
