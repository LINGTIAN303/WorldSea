/**
 * CLI Agent Server 模式
 *
 * `worldsmith serve` 启动 HTTP + WebSocket 服务器，
 * 将 CLI 的本地能力（shell、git、文件、lint/test/build 等）暴露给 Web 端。
 *
 * HTTP API:
 *   GET  /health              健康检查
 *   GET  /api/capabilities    查询可用工具列表
 *   POST /api/tools/:name     调用指定工具
 *
 * WebSocket:
 *   /ws  流式事件推送（工具执行进度、输出、状态变更）
 */
import { createServer } from 'http'
import type { IncomingMessage, ServerResponse, Server } from 'http'
import { WebSocketServer } from 'ws'
import type { WebSocket as WsSocket, RawData } from 'ws'
import { createCliAgent, CLI_TOOLS } from './cli-agent'
import { createCliToolContext } from './cli-context'
import { createCLISafetyGuard } from './cli-safety-guard'
import { initToolMetaRegistry } from '../tools/tool-meta-registry'
import { createExecutionAdapter } from '../execution'
import type { ProviderConfig } from '../providers/config'
import type { ToolDefinition } from '../bridge-types'
import * as crypto from 'crypto'
import * as path from 'path'
import * as fs from 'fs'

/* ════════════════════════════════════════
   类型定义
   ════════════════════════════════════════ */

interface ServeOptions {
  port: number
  host: string
  provider: string
  model: string
  apiKey: string
  baseUrl?: string
  data: string
  guard: boolean
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
  id?: string // exec/pty 消息携带的请求 ID
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
   HTTP 请求处理
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

/* ════════════════════════════════════════
   Server 主逻辑
   ════════════════════════════════════════ */

export async function startServer(opts: ServeOptions): Promise<Server> {
  const apiKey = opts.apiKey || loadApiKeyFromEnv(opts.provider)
  // API key 可选：Web 前端聊天直接在浏览器调 LLM，后端只提供工具执行能力
  // 仅当用户通过 /api/prompt 端点使用后端聊天时才需要 key
  const hasApiKey = !!apiKey

  const config: ProviderConfig = opts.baseUrl
    ? { mode: 'custom', baseUrl: opts.baseUrl, apiType: 'openai-compatible', modelId: opts.model, apiKey: apiKey || '' }
    : { mode: 'cloud', provider: opts.provider, modelId: opts.model, apiKey: apiKey || '' }

  const dataPath = path.resolve(opts.data)
  if (!fs.existsSync(dataPath)) fs.mkdirSync(dataPath, { recursive: true })

  const toolContext = createCliToolContext(dataPath, config)

  // 初始化工具元数据注册中心
  initToolMetaRegistry(CLI_TOOLS)

  // 安全守卫（独立于 agent，工具执行时使用，无 key 时也能工作）
  // serve 模式为非交互（HTTP 服务器无法通过 stdin 确认），守卫自动通过并记录日志
  // 安全责任转移给前端（前端可在调用前做 UI 确认）
  const beforeToolCall = opts.guard ? createCLISafetyGuard(toolContext.stores.ui, false) : undefined

  // 创建 Agent 实例（仅在配置了 API key 时创建，用于 /api/prompt 聊天能力）
  // Web 前端聊天直接在浏览器调 LLM，不需要后端 agent；后端主要提供工具执行能力
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

  // WebSocket 客户端管理
  const wsClients = new Set<WsSocket>()

  // 向所有 WS 客户端广播事件
  function broadcast(event: { type: string; [key: string]: unknown }): void {
    const msg = JSON.stringify(event)
    for (const ws of wsClients) {
      if (ws.readyState === 1) { // WebSocket.OPEN = 1
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
        version: '0.1.0',
        toolCount: toolMap.size,
        uptime: process.uptime(),
      })
      return
    }

    // GET /api/capabilities
    if (url.pathname === '/api/capabilities' && req.method === 'GET') {
      sendJson(res, 200, getCapabilities())
      return
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

      // 广播工具开始执行
      broadcast({ type: 'tool_execution_start', toolName, args, requestId })

      try {
        // 安全守卫检查（独立于 agent，无 key 时也能工作）
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

      // 无 agent 实例时拒绝（未配置 API key）
      if (!agent) {
        sendJson(res, 503, { ok: false, error: '后端未配置 API key，/api/prompt 聊天不可用。请在 Web 前端使用聊天功能，或通过 WORLDSMITH_API_KEY 环境变量配置 key 后重启服务' })
        return
      }

      // SSE 响应头
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      })

      // 订阅 Agent 事件
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
    sendJson(res, 404, { ok: false, error: 'Not found', endpoints: ['/health', '/api/capabilities', '/api/tools/:name', '/api/prompt'] })
  })

  // ── WebSocket 服务器 ──
  const wss = new WebSocketServer({ server, path: '/ws' })

  wss.on('connection', (ws: WsSocket) => {
    wsClients.add(ws)
    console.log(`[WS] Client connected (total: ${wsClients.size})`)

    // 每个连接维护自己的 PTY 会话回调（断开时清理）
    const ptyUnsubscribers: Map<string, () => void> = new Map()
    const adapter = createExecutionAdapter()

    // 发送欢迎消息
    ws.send(JSON.stringify({
      type: 'connected',
      capabilities: getCapabilities(),
      serverVersion: '0.1.0',
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

        // ── 一次性命令执行（前端 WebSocketExecutionAdapter 协议） ──
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

        // ── PTY 会话管理（前端终端协议） ──────────────────────────
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
            // 创建会话（复用 adapter 的会话管理）
            await adapter.createSession(id, {
              shell: payload.shell,
              cwd: payload.cwd,
              cols: payload.cols,
              rows: payload.rows,
            })
            // 注册 output 回调，持续推送给前端
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
      // 清理该连接的所有 PTY 会话
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
      console.log('WorldSmith Agent Server')
      console.log(`  HTTP:  http://${opts.host}:${opts.port}`)
      console.log(`  WS:    ws://${opts.host}:${opts.port}/ws`)
      console.log(`  Tools: ${toolMap.size} available`)
      console.log(`  Model: ${opts.provider}/${opts.model}`)
      console.log(`  Guard: ${opts.guard ? 'ON' : 'OFF'}`)
      console.log(`  Agent: ${agent ? 'ready' : 'disabled (no API key, /api/prompt unavailable)'}`)
      console.log(`  Data:  ${dataPath}`)
      console.log('')
      console.log('Endpoints:')
      console.log('  GET  /health              Health check')
      console.log('  GET  /api/capabilities    List available tools')
      console.log('  POST /api/tools/:name     Execute a tool')
      console.log('  POST /api/prompt          Send prompt (SSE)')
      console.log('  WS   /ws                  WebSocket (tool_call + events)')
      resolve(server)
    })
  })
}

/* ════════════════════════════════════════
   API Key 加载（与 index.ts 共享逻辑）
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
