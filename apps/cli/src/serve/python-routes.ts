/**
 * Python 微服务路由（原生 http 实现，7 个端点），详细见 docs/details/注释/cli/python-routes.md
 */
import type { IncomingMessage, ServerResponse } from 'http'
import type { PythonBridge } from '../python/bridge.js'

/** 解析请求体为 JSON */
function parseBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf-8')
        resolve(body ? JSON.parse(body) : {})
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

/** 发送 JSON 响应 */
function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}
/**
 * 处理 Python 服务相关路由
 * @returns true 表示已处理该请求，false 表示不匹配任何路由
 */
export async function handlePythonRoute(
  req: IncomingMessage,
  res: ServerResponse,
  bridge: PythonBridge,
): Promise<boolean> {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const pathname = url.pathname
  const method = req.method || 'GET'

  // GET /api/services/status — 查询各 Python 服务状态
  if (pathname === '/api/services/status' && method === 'GET') {
    const services = ['crawl4ai', 'markitdown', 'turbovec'] as const
    const status: Record<string, { enabled: boolean; healthy: boolean }> = {}
    for (const s of services) {
      status[s] = {
        enabled: bridge.isServiceEnabled(s),
        healthy: bridge.isServiceEnabled(s) ? await bridge.healthCheck(s) : false,
      }
    }
    sendJson(res, 200, status)
    return true
  }

  // 以下都是 POST 路由
  if (method !== 'POST') return false

  // 解析请求体
  let body: any
  try {
    body = await parseBody(req)
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' })
    return true
  }
  // POST /api/crawl — 单 URL 抓取
  if (pathname === '/api/crawl') {
    if (!bridge.isServiceEnabled('crawl4ai')) {
      sendJson(res, 503, { error: 'Crawl4AI 服务未启用' })
      return true
    }
    try {
      const result = await bridge.request('crawl4ai', '/crawl', body)
      sendJson(res, 200, result)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      sendJson(res, 502, { error: `Crawl4AI 服务请求失败: ${message}` })
    }
    return true
  }

  // POST /api/crawl/batch — 批量抓取
  if (pathname === '/api/crawl/batch') {
    if (!bridge.isServiceEnabled('crawl4ai')) {
      sendJson(res, 503, { error: 'Crawl4AI 服务未启用' })
      return true
    }
    if (!Array.isArray(body.urls) || body.urls.length === 0) {
      sendJson(res, 400, { error: '请求体必须包含非空 urls 数组' })
      return true
    }
    try {
      const result = await bridge.request('crawl4ai', '/crawl/batch', body)
      sendJson(res, 200, result)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      sendJson(res, 502, { error: `Crawl4AI 批量服务请求失败: ${message}` })
    }
    return true
  }
  // POST /api/convert — 文件转 Markdown
  if (pathname === '/api/convert') {
    if (!bridge.isServiceEnabled('markitdown')) {
      sendJson(res, 503, { error: 'markitdown 服务未启用' })
      return true
    }
    const { filename, content_base64 } = body ?? {}
    if (!filename || typeof filename !== 'string') {
      sendJson(res, 400, { error: '缺少 filename 字段' })
      return true
    }
    if (!content_base64 || typeof content_base64 !== 'string') {
      sendJson(res, 400, { error: '缺少 content_base64 字段' })
      return true
    }
    try {
      const result = await bridge.request('markitdown', '/convert', {
        filename,
        content_base64,
      })
      sendJson(res, 200, result)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      sendJson(res, 502, { error: `markitdown 服务调用失败: ${message}` })
    }
    return true
  }
  // POST /api/vector/add — 添加向量
  if (pathname === '/api/vector/add') {
    if (!bridge.isServiceEnabled('turbovec')) {
      sendJson(res, 503, { error: '向量检索服务未启用' })
      return true
    }
    try {
      const result = await bridge.request('turbovec', '/add', body)
      sendJson(res, 200, result)
    } catch (err) {
      sendJson(res, 502, {
        error: '向量检索服务请求失败',
        detail: err instanceof Error ? err.message : String(err),
      })
    }
    return true
  }

  // POST /api/vector/search — 搜索向量
  if (pathname === '/api/vector/search') {
    if (!bridge.isServiceEnabled('turbovec')) {
      sendJson(res, 503, { error: '向量检索服务未启用' })
      return true
    }
    try {
      const result = await bridge.request('turbovec', '/search', body)
      sendJson(res, 200, result)
    } catch (err) {
      sendJson(res, 502, {
        error: '向量检索服务请求失败',
        detail: err instanceof Error ? err.message : String(err),
      })
    }
    return true
  }

  // POST /api/vector/delete — 删除向量
  if (pathname === '/api/vector/delete') {
    if (!bridge.isServiceEnabled('turbovec')) {
      sendJson(res, 503, { error: '向量检索服务未启用' })
      return true
    }
    try {
      const result = await bridge.request('turbovec', '/delete', body)
      sendJson(res, 200, result)
    } catch (err) {
      sendJson(res, 502, {
        error: '向量检索服务请求失败',
        detail: err instanceof Error ? err.message : String(err),
      })
    }
    return true
  }

  return false
}