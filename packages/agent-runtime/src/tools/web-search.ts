/**
 * 联网搜索工具
 *
 * 支持三种搜索引擎：Tavily、SerpAPI、Bing。
 * API Key 通过设置存储获取。搜索结果包含标题、URL 和最多 300 字符的摘要。
 * 无 API Key 时自动降级到 DuckDuckGo HTML 搜索（无需 Key，通过 smartFetch 绕过 CORS）。
 */

import type { ToolDefinition } from '../bridge-types'
import type { ToolMeta } from '@worldsmith/agent-core'
import { smartFetch } from '../utils/smart-fetch'

/**
 * web_search — 联网搜索
 * 自动根据设置中的 search engine 配置选择对应的 API 调用。
 * 支持的搜索引擎：tavily（默认）、serpapi、bing、duckduckgo（无需 Key 的降级选项）。
 * 未配置 API Key 时自动降级到 DuckDuckGo HTML 搜索。
 */
export const webSearchTool: ToolDefinition = {
  name: 'web_search',
  description: '搜索互联网获取最新信息。返回搜索结果摘要列表（标题+摘要+URL）。使用场景：查找参考资料、历史事实、文化背景、灵感素材。如需深入了解某条结果，用 web_fetch 阅读全文。',
  parameters: {
    query: { type: 'string', description: '搜索查询关键词', required: true },
    max_results: { type: 'number', description: '返回结果数量上限，默认5', required: false },
  },
  meta: {
    permission: 'safe',
    category: 'search',
    alwaysAvailable: true,
    displayName: '网络搜索',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    const query = String(args.query)
    const maxResults = Number(args.max_results) || 5

    const settings = ctx.stores.settings as any
    const searchConfig = settings?.getSearchConfig?.() || {}
    const engine = searchConfig.engine || 'tavily'
    const apiKey = searchConfig.apiKey || ''

    // 无 API Key 时自动降级到 DuckDuckGo
    if (!apiKey) {
      try {
        return await searchDuckDuckGo(query, maxResults)
      } catch (err: any) {
        return JSON.stringify({
          error: `搜索失败（未配置 API Key，DuckDuckGo 降级也失败）: ${err.message || String(err)}`,
          hint: '请在 AI 助手设置中配置搜索 API Key（支持 Tavily / SerpAPI / Bing），或确保网络可访问 DuckDuckGo',
          query,
        })
      }
    }

    try {
      if (engine === 'tavily') {
        return await searchTavily(query, maxResults, apiKey)
      }
      if (engine === 'serpapi') {
        return await searchSerpApi(query, maxResults, apiKey)
      }
      if (engine === 'bing') {
        return await searchBing(query, maxResults, apiKey)
      }
      return JSON.stringify({ error: `不支持的搜索引擎: ${engine}`, query })
    } catch (err: any) {
      return JSON.stringify({
        error: `搜索失败: ${err.message || String(err)}`,
        query,
      })
    }
  },
}

/** Tavily 搜索 API（POST 请求，支持 include_answer 额外结果） */
async function searchTavily(query: string, maxResults: number, apiKey: string): Promise<string> {
  const resp = await smartFetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: maxResults,
      include_answer: true,
      search_depth: 'basic',
    }),
  })
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`Tavily API ${resp.status}: ${text}`)
  }
  const data = await resp.json()
  const results = (data.results || []).map((r: any) => ({
    title: r.title,
    url: r.url,
    snippet: r.content?.slice(0, 300),
  }))
  return JSON.stringify({
    query,
    answer: data.answer || '',
    results,
  })
}

/** SerpAPI 搜索（GET 请求，api_key 为查询参数） */
async function searchSerpApi(query: string, maxResults: number, apiKey: string): Promise<string> {
  const url = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${apiKey}&num=${maxResults}`
  const resp = await smartFetch(url)
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`SerpAPI ${resp.status}: ${text}`)
  }
  const data = await resp.json()
  const results = (data.organic_results || []).map((r: any) => ({
    title: r.title,
    url: r.link,
    snippet: r.snippet?.slice(0, 300),
  }))
  return JSON.stringify({ query, answer: data.answer_box?.snippet || '', results })
}

/** Bing 搜索 API（GET 请求，Ocp-Apim-Subscription-Key 头鉴权） */
async function searchBing(query: string, maxResults: number, apiKey: string): Promise<string> {
  const url = `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}&count=${maxResults}`
  const resp = await smartFetch(url, {
    headers: { 'Ocp-Apim-Subscription-Key': apiKey },
  })
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`Bing API ${resp.status}: ${text}`)
  }
  const data = await resp.json()
  const results = (data.webPages?.value || []).map((r: any) => ({
    title: r.name,
    url: r.url,
    snippet: r.snippet?.slice(0, 300),
  }))
  return JSON.stringify({ query, answer: '', results })
}

/** DuckDuckGo HTML 搜索（无需 API Key，降级方案） */
async function searchDuckDuckGo(query: string, maxResults: number): Promise<string> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  const resp = await smartFetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
    timeout: 15,
  })
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`DuckDuckGo ${resp.status}: ${text}`)
  }
  const html = await resp.text()

  // 解析 DuckDuckGo HTML 搜索结果
  const results: Array<{ title: string; url: string; snippet: string }> = []
  const resultRegex = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null

  while ((match = resultRegex.exec(html)) !== null && results.length < maxResults) {
    const rawUrl = match[1]
    const title = match[2].replace(/<[^>]+>/g, '').trim()
    const snippet = match[3].replace(/<[^>]+>/g, '').trim()

    // DuckDuckGo 使用重定向 URL，提取实际目标
    let actualUrl = rawUrl
    try {
      const u = new URL(rawUrl, 'https://duckduckgo.com')
      if (u.searchParams.has('uddg')) {
        actualUrl = decodeURIComponent(u.searchParams.get('uddg') || rawUrl)
      }
    } catch {
      // URL 解析失败，使用原始 URL
    }

    results.push({
      title,
      url: actualUrl,
      snippet: snippet.slice(0, 300),
    })
  }

  // 备用解析：如果主正则未匹配到结果，尝试更宽松的匹配
  if (results.length === 0) {
    const linkRegex = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi
    while ((match = linkRegex.exec(html)) !== null && results.length < maxResults) {
      const rawUrl = match[1]
      const title = match[2].replace(/<[^>]+>/g, '').trim()
      let actualUrl = rawUrl
      try {
        const u = new URL(rawUrl, 'https://duckduckgo.com')
        if (u.searchParams.has('uddg')) {
          actualUrl = decodeURIComponent(u.searchParams.get('uddg') || rawUrl)
        }
      } catch { /* keep raw */ }
      results.push({ title, url: actualUrl, snippet: '' })
    }
  }

  return JSON.stringify({
    query,
    answer: '',
    results,
    engine: 'duckduckgo',
    note: 'DuckDuckGo 降级搜索（无需 API Key），结果可能不如专用搜索 API 精确',
  })
}

export const webSearchTools: ToolDefinition[] = [webSearchTool]
