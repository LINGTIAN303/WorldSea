/**
 * CLI Agent Server 模式（HTTP API + WS 事件 + Python 微服务桥接），详细见 docs/details/注释/cli/serve.md
 */
import { createServer } from 'http'
import type { IncomingMessage, ServerResponse, Server } from 'http'
import { WebSocketServer } from 'ws'
import type { WebSocket as WsSocket, RawData } from 'ws'
import { createCliAgent, CLI_TOOLS } from '../cli/cli-agent'
import { createCliToolContext } from '../cli/cli-context'
import { createCLISafetyGuard } from '../cli/cli-safety-guard'
import { initToolMetaRegistry, type ProviderConfig, type ToolDefinition } from '@worldsmith/agent-runtime'
import { createExecutionAdapter, registerCliExecutionAdapter } from '../cli/execution'
import { PythonBridge, parseServiceConfig } from '../python/bridge'
import { handlePythonRoute } from '../serve/python-routes'
import * as crypto from 'crypto'
import * as path from 'path'
import * as fs from 'fs'
/* ════════════════════════════════════════
   类型定义
   ════════════════════════════════════════ */

export interface ServeOptions {
  port: number
  host: string
  provider: string
  model: string
  apiKey: string
  baseUrl?: string
  data: string
  guard: boolean
  /** 鉴权 token（默认 'dev' 免鉴权） */
  authToken?: string
}

interface ToolCallRequest {
  tool: string
  args: Record<string, unknown>
  requestId?: string
}

interface WsMessage {
  type: 'tool_call' | 'ping' | 'subscribe' | 'unsubscribe'
    | 'exec' | 'pty_spawn' | 'pty_write' | 'pty_resize' | 'pty_kill'
  payload: unknown
  id?: string
}
/* ════════════════════════════════════════
   工具注册表
   ════════════════════════════════════════ */

const toolMap = new Map<string, ToolDefinition>()

function registerTools(): void {
  for (const tool of CLI_TOOLS) {
    toolMap.set(tool.name, tool)
    if (tool.meta?.aliases) {
      for (const alias of tool.meta.aliases) {
        if (!toolMap.has(alias)) toolMap.set(alias, tool)
      }
    }
  }
}

registerTools()

/* ════════════════════════════════════════
   工具分类（供 Web 端路由决策）
   ════════════════════════════════════════ */

const LOCAL_CAPABILITY_CATEGORIES = {
  shell: ['shell_session', 'execute_command', 'launch_terminal', 'launch_terminal_script',
           'shell_session_create', 'shell_session_exec', 'shell_session_input',
           'shell_session_destroy', 'shell_session_list', 'detect_shells', 'detect_terminal_mode'],
  git: ['git_status', 'git_log', 'git_diff', 'git_add', 'git_commit', 'git_checkout',
        'git_branch', 'git_stash', 'git_push', 'git_pull', 'git_init'],
  file: ['read_file', 'write_file', 'search_files', 'list_directory', 'create_directory',
         'delete_file', 'move_file', 'copy_file'],
  project: ['run_lint', 'run_test', 'run_build', 'detect_project_commands'],
  system: ['sys_info', 'env_get', 'env_set'],
}

function getCapabilities() {
  const available: string[] = []
  for (const [name] of toolMap) {
    available.push(name)
  }
  return {
    tools: available,
    categories: LOCAL_CAPABILITY_CATEGORIES,
    toolCount: available.length,
  }
}
/* ════════════════════════════════════════
   HTTP 请求处理工具
   ════════════════════════════════════════ */

function parseBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  })
  res.end(body)
}

function sendSSE(res: ServerResponse, data: unknown): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`)
}

/** Token 鉴权校验 */
function validateToken(token: string | null, authToken: string): boolean {
  if (authToken === 'dev') return true
  return token === authToken
}
/* ════════════════════════════════════════
   Server 主逻辑
   ════════════════════════════════════════ */

export async function startServer(opts: ServeOptions): Promise<Server> {
  // 注册 CLI 端 NodeExecutionAdapter（幂等，供 WS /ws 的 exec/pty 消息使用）
  registerCliExecutionAdapter()

  const apiKey = opts.apiKey || loadApiKeyFromEnv(opts.provider)
  const hasApiKey = !!apiKey
  const authToken = opts.authToken || process.env.AUTH_TOKEN || 'dev'

  const config: ProviderConfig = opts.baseUrl
    ? { mode: 'custom', baseUrl: opts.baseUrl, apiType: 'openai-compatible', modelId: opts.model, apiKey: apiKey || '' }
    : { mode: 'cloud', provider: opts.provider, modelId: opts.model, apiKey: apiKey || '' }

  const dataPath = path.resolve(opts.data)
  if (!fs.existsSync(dataPath)) fs.mkdirSync(dataPath, { recursive: true })

  const toolContext = createCliToolContext(dataPath, config)

  // 初始化工具元数据注册中心
  initToolMetaRegistry(CLI_TOOLS)

  // 安全守卫（serve 模式非交互，自动通过并记录日志）
  const beforeToolCall = opts.guard ? createCLISafetyGuard(toolContext.stores.ui, false) : undefined

  // 创建 Agent 实例（仅在配置了 API key 时创建）
  let agent: Awaited<ReturnType<typeof createCliAgent>> | null = null
  if (hasApiKey) {
    try {
      agent = await createCliAgent({
        providerConfig: config,
        toolContext,
        projectName: 'WorldSmith-Server',
        beforeToolCall,
      })
    } catch (err) {
      console.warn(`[Agent] 创建 Agent 实例失败（工具执行仍可用）: ${err instanceof Error ? err.message : err}`)
    }
  } else {
    console.warn('[Agent] 未配置 API key，/api/prompt 聊天不可用（工具执行正常）')
  }
  // 初始化 Python 微服务桥接（可选，根据环境变量决定各服务是否启用）
  const pythonConfig = parseServiceConfig({
    crawl4ai: { port: 8101, enabled: process.env.CRAWL4AI_ENABLED === 'true' },
    markitdown: { port: 8102, enabled: process.env.MARKITDOWN_ENABLED === 'true' },
    turbovec: { port: 8103, enabled: process.env.TURBOVEC_ENABLED === 'true' },
  })
  const bridge = new PythonBridge(pythonConfig)
  const pythonEnabled = pythonConfig.crawl4ai.enabled || pythonConfig.markitdown.enabled || pythonConfig.turbovec.enabled
  if (pythonEnabled) {
    console.log('[Python] 微服务桥接已启用：' +
      [
        pythonConfig.crawl4ai.enabled && 'crawl4ai',
        pythonConfig.markitdown.enabled && 'markitdown',
        pythonConfig.turbovec.enabled && 'turbovec',
      ].filter(Boolean).join(', '))
  }

  // WebSocket 客户端管理
  const wsClients = new Set<WsSocket>()

  function broadcast(event: { type: string; [key: string]: unknown }): void {
    const msg = JSON.stringify(event)
    for (const ws of wsClients) {
      if (ws.readyState === 1) {
        ws.send(msg)
      }
    }
  }
  // ── HTTP 服务器 ──
  const server = createServer(async (req, res) => {
    // CORS preflight
    if (req.method === 'OPTIONS') {
      sendJson(res, 204, null)
      return
    }

    const url = new URL(req.url || '/', `http://${req.headers.host}`)

    // GET /health
    if (url.pathname === '/health' && req.method === 'GET') {
      sendJson(res, 200, {
        status: 'ok',
        version: '0.2.0',
        toolCount: toolMap.size,
        uptime: process.uptime(),
        python: pythonEnabled
          ? {
              crawl4ai: pythonConfig.crawl4ai.enabled,
              markitdown: pythonConfig.markitdown.enabled,
              turbovec: pythonConfig.turbovec.enabled,
            }
          : null,
      })
      return
    }

    // GET /api/capabilities
    if (url.pathname === '/api/capabilities' && req.method === 'GET') {
      sendJson(res, 200, getCapabilities())
      return
    }

    // Python 微服务路由（crawl/convert/vector/services-status）
    if (pythonEnabled) {
      const handled = await handlePythonRoute(req, res, bridge)
      if (handled) return
    } else {
      // 未启用 PythonBridge 时，对 Python 路由返回 503
      if (url.pathname.startsWith('/api/crawl') ||
          url.pathname === '/api/convert' ||
          url.pathname.startsWith('/api/vector/') ||
          url.pathname === '/api/services/status') {
        sendJson(res, 503, { error: 'Python 微服务未启用（需配置 CRAWL4AI_ENABLED / MARKITDOWN_ENABLED / TURBOVEC_ENABLED 环境变量）' })
        return
      }
    }
    // POST /api/tools/:name
    const toolMatch = url.pathname.match(/^\/api\/tools\/(.+)$/)
    if (toolMatch && req.method === 'POST') {
      const toolName = decodeURIComponent(toolMatch[1])
      const tool = toolMap.get(toolName)

      if (!tool) {
        sendJson(res, 404, { ok: false, error: `Tool not found: ${toolName}`, available: [...toolMap.keys()] })
        return
      }

      let body: string
      try {
        body = await parseBody(req)
      } catch {
        sendJson(res, 400, { ok: false, error: 'Failed to parse request body' })
        return
      }

      let args: Record<string, unknown>
      try {
        const parsed = JSON.parse(body)
        args = parsed.args ?? parsed.arguments ?? parsed
        if (typeof args !== 'object' || args === null || Array.isArray(args)) {
          args = {}
        }
      } catch {
        sendJson(res, 400, { ok: false, error: 'Invalid JSON body' })
        return
      }

      const requestId = crypto.randomUUID().slice(0, 8)
      broadcast({ type: 'tool_execution_start', toolName, args, requestId })
      try {
        if (beforeToolCall) {
          const guardResult = await beforeToolCall({ toolCall: { name: toolName, args } })
          if (guardResult?.block) {
            broadcast({ type: 'tool_execution_end', requestId, success: false, result: guardResult.reason })
            sendJson(res, 403, { ok: false, error: `Blocked by safety guard: ${guardResult.reason}`, requestId })
            return
          }
        }

        const result = await tool.execute(args, toolContext)

        broadcast({ type: 'tool_execution_end', requestId, success: true, result })
        sendJson(res, 200, { ok: true, result, requestId })
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        broadcast({ type: 'tool_execution_end', requestId, success: false, result: errorMsg })
        sendJson(res, 500, { ok: false, error: errorMsg, requestId })
      }
      return
    }
    // POST /api/prompt (SSE 流式响应)
    if (url.pathname === '/api/prompt' && req.method === 'POST') {
      let body: string
      try {
        body = await parseBody(req)
      } catch {
        sendJson(res, 400, { ok: false, error: 'Failed to parse request body' })
        return
      }

      let promptText: string
      let contextOverride: string | undefined
      try {
        const parsed = JSON.parse(body)
        promptText = parsed.text || parsed.prompt || ''
        contextOverride = parsed.contextOverride
      } catch {
        sendJson(res, 400, { ok: false, error: 'Invalid JSON body' })
        return
      }

      if (!promptText) {
        sendJson(res, 400, { ok: false, error: 'Missing prompt text' })
        return
      }

      if (!agent) {
        sendJson(res, 503, { ok: false, error: '后端未配置 API key，/api/prompt 聊天不可用。请在 Web 前端使用聊天功能，或通过 WORLDSMITH_API_KEY 环境变量配置 key 后重启服务' })
        return
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      })

      const unsub = agent.subscribe((event) => {
        sendSSE(res, event)
        if (event.type === 'agent_end' || event.type === 'error') {
          unsub()
          res.end()
        }
      })

      try {
        await agent.prompt(promptText, { contextOverride })
      } catch (err) {
        sendSSE(res, { type: 'error', error: err instanceof Error ? err.message : String(err) })
        unsub()
        res.end()
      }
      return
    }

    // 404
    sendJson(res, 404, {
      ok: false,
      error: 'Not found',
      endpoints: [
        '/health',
        '/api/capabilities',
        '/api/tools/:name',
        '/api/prompt',
        '/api/services/status (optional)',
        '/api/crawl (optional)',
        '/api/convert (optional)',
        '/api/vector/{add,search,delete} (optional)',
      ],
    })
  })
  // ── WebSocket 服务器 ──
  const wss = new WebSocketServer({ server, path: '/ws' })

  wss.on('connection', async (ws: WsSocket, req: IncomingMessage) => {
    // Token 鉴权（URL query 参数）
    const wsUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    const token = wsUrl.searchParams.get('token')
    if (!validateToken(token, authToken)) {
      ws.close(4001, 'Unauthorized')
      return
    }

    wsClients.add(ws)
    console.log(`[WS] Client connected (total: ${wsClients.size})`)

    const ptyUnsubscribers: Map<string, () => void> = new Map()
    const adapter = await createExecutionAdapter()

    ws.send(JSON.stringify({
      type: 'connected',
      capabilities: getCapabilities(),
      serverVersion: '0.2.0',
    }))

    ws.on('message', async (raw: RawData) => {
      let msg: WsMessage
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        ws.send(JSON.stringify({ type: 'error', error: 'Invalid JSON' }))
        return
      }

      switch (msg.type) {
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }))
          break

        case 'tool_call': {
          const { tool: toolName, args = {}, requestId } = msg.payload as ToolCallRequest
          const tool = toolMap.get(toolName)

          if (!tool) {
            ws.send(JSON.stringify({ type: 'tool_result', ok: false, error: `Tool not found: ${toolName}`, requestId }))
            return
          }

          try {
            const result = await tool.execute(args, toolContext)
            ws.send(JSON.stringify({ type: 'tool_result', ok: true, result, requestId }))
          } catch (err) {
            ws.send(JSON.stringify({ type: 'tool_result', ok: false, error: err instanceof Error ? err.message : String(err), requestId }))
          }
          break
        }
        case 'exec': {
          const { id, payload } = msg as { id: string; payload: { cmd: string; cwd?: string; env?: Record<string, string>; timeout?: number } }
          if (!id) {
            ws.send(JSON.stringify({ type: 'error', error: 'exec 消息缺少 id' }))
            break
          }
          try {
            const result = await adapter.executeCommand(payload.cmd, {
              cwd: payload.cwd,
              env: payload.env,
              timeout: payload.timeout,
            })
            ws.send(JSON.stringify({ type: 'exec_result', id, payload: result }))
          } catch (err) {
            ws.send(JSON.stringify({
              type: 'error',
              id,
              payload: { message: err instanceof Error ? err.message : String(err) },
            }))
          }
          break
        }

        case 'pty_spawn': {
          const { id, payload } = msg as {
            id: string
            payload: { shell?: string; cwd?: string; cols?: number; rows?: number }
          }
          if (!id) {
            ws.send(JSON.stringify({ type: 'error', error: 'pty_spawn 消息缺少 id' }))
            break
          }
          try {
            await adapter.createSession(id, {
              shell: payload.shell,
              cwd: payload.cwd,
              cols: payload.cols,
              rows: payload.rows,
            })
            const unsub = await adapter.onPtyOutput(id, (data: string) => {
              if (ws.readyState === 1) {
                ws.send(JSON.stringify({ type: 'pty_output', id, payload: { data } }))
              }
            })
            ptyUnsubscribers.set(id, unsub)
          } catch (err) {
            ws.send(JSON.stringify({
              type: 'error',
              id,
              payload: { message: err instanceof Error ? err.message : String(err) },
            }))
          }
          break
        }
        case 'pty_write': {
          const { id, payload } = msg as { id: string; payload: { data: string } }
          if (id) {
            try {
              await adapter.writePty(id, payload.data)
            } catch (err) {
              ws.send(JSON.stringify({
                type: 'error',
                id,
                payload: { message: err instanceof Error ? err.message : String(err) },
              }))
            }
          }
          break
        }

        case 'pty_resize': {
          const { id, payload } = msg as { id: string; payload: { cols: number; rows: number } }
          if (id) {
            try {
              await adapter.resizePty(id, payload.cols, payload.rows)
            } catch {}
          }
          break
        }

        case 'pty_kill': {
          const { id } = msg as { id: string }
          if (id) {
            const unsub = ptyUnsubscribers.get(id)
            if (unsub) {
              unsub()
              ptyUnsubscribers.delete(id)
            }
            try {
              await adapter.killPty(id)
            } catch {}
          }
          break
        }

        default:
          ws.send(JSON.stringify({ type: 'error', error: `Unknown message type: ${(msg as any).type}` }))
      }
    })
    ws.on('close', () => {
      wsClients.delete(ws)
      for (const [id, unsub] of ptyUnsubscribers) {
        unsub()
        try {
          adapter.killPty(id)
        } catch {}
      }
      ptyUnsubscribers.clear()
      console.log(`[WS] Client disconnected (total: ${wsClients.size})`)
    })
  })

  // ── 启动 ──
  return new Promise((resolve) => {
    server.listen(opts.port, opts.host, () => {
      console.log('WorldSmith CLI Server (Phase 4 整合版)')
      console.log(`  HTTP:  http://${opts.host}:${opts.port}`)
      console.log(`  WS:    ws://${opts.host}:${opts.port}/ws`)
      console.log(`  Tools: ${toolMap.size} available`)
      console.log(`  Model: ${opts.provider}/${opts.model}`)
      console.log(`  Guard: ${opts.guard ? 'ON' : 'OFF'}`)
      console.log(`  Agent: ${agent ? 'ready' : 'disabled (no API key, /api/prompt unavailable)'}`)
      console.log(`  Python: ${pythonEnabled ? 'enabled' : 'disabled'}`)
      console.log(`  Auth:  ${authToken === 'dev' ? 'dev (开发模式免鉴权)' : '***'}`)
      console.log(`  Data:  ${dataPath}`)
      console.log('')
      console.log('Endpoints:')
      console.log('  GET  /health              Health check')
      console.log('  GET  /api/capabilities    List available tools')
      console.log('  POST /api/tools/:name     Execute a tool')
      console.log('  POST /api/prompt          Send prompt (SSE)')
      if (pythonEnabled) {
        console.log('  GET  /api/services/status Python services status')
        console.log('  POST /api/crawl           Crawl URL (crawl4ai)')
        console.log('  POST /api/crawl/batch     Batch crawl (crawl4ai)')
        console.log('  POST /api/convert         Convert file (markitdown)')
        console.log('  POST /api/vector/add      Add vector (turbovec)')
        console.log('  POST /api/vector/search   Search vector (turbovec)')
        console.log('  POST /api/vector/delete   Delete vector (turbovec)')
      }
      console.log('  WS   /ws                  WebSocket (tool_call + events + PTY)')
      resolve(server)
    })
  })
}

/* ════════════════════════════════════════
   API Key 加载
   ════════════════════════════════════════ */

function loadApiKeyFromEnv(provider: string): string {
  const envKey = `WORLDSMITH_API_KEY_${provider.toUpperCase().replace(/-/g, '_')}`
  if (process.env[envKey]) return process.env[envKey]!
  if (process.env.WORLDSMITH_API_KEY) return process.env.WORLDSMITH_API_KEY
  const cfgPath = path.join(process.cwd(), '.worldsmith-keys.json')
  if (fs.existsSync(cfgPath)) {
    try {
      const keys = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'))
      return keys[provider] || keys.default || ''
    } catch { return '' }
  }
  return ''
}