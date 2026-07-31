/**
 * ⚠️ 此文件已废弃（DEPRECATED）— Phase 4 端分离
 *
 * 本服务的能力已迁移到 @worldsmith/cli 的 serve 命令：
 *   worldsmith serve --port 3100 --host 127.0.0.1
 *
 * 迁移说明：docs/端分离/11-backend-consolidation.md
 *
 * 此文件保留仅供历史参考，不再维护。新代码请勿引用。
 * 计划在 Phase 6 端到端验收后删除整个 worldsmith-server/ 目录。
 */

import express, { Router } from 'express'
import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { PtyManager } from './pty-manager.js'
import { v4 as uuid } from 'uuid'
import { PythonBridge, parseServiceConfig } from './python-bridge.js'
import { registerCrawlRoutes } from './routes/crawl.js'
import { registerConvertRoutes } from './routes/convert.js'
import { registerVectorSearchRoutes } from './routes/vector-search.js'

// ── 废弃警告（Phase 4: 能力已迁移至 @worldsmith/cli）──
console.warn('┌─────────────────────────────────────────────────────────────────┐')
console.warn('│  ⚠️  worldsmith-server 已废弃（Phase 4 端分离）                    │')
console.warn('│                                                                 │')
console.warn('│  能力已迁移至 @worldsmith/cli：                                    │')
console.warn('│    worldsmith serve  （替代 worldsmith-server）                   │')
console.warn('│                                                                 │')
console.warn('│  迁移指南：                                                       │')
console.warn('│    1. cd apps/cli && pnpm install                                │')
console.warn('│    2. pnpm start serve --port 3100                               │')
console.warn('│    3. Web 端设置 VITE_CLI_SERVE_URL=ws://localhost:3100          │')
console.warn('│                                                                 │')
console.warn('│  本包将在 Phase 6 删除。                                          │')
console.warn('└─────────────────────────────────────────────────────────────────┘')

const PORT = parseInt(process.env.PORT || '3100', 10)
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'dev'

const app = express()
const server = createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })

app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (_req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }
  next()
})

// JSON 请求体解析中间件
app.use(express.json())

// 初始化 Python 微服务桥接 — 根据环境变量决定各服务是否启用
const pythonConfig = parseServiceConfig({
  crawl4ai: { port: 8101, enabled: process.env.CRAWL4AI_ENABLED === 'true' },
  markitdown: { port: 8102, enabled: process.env.MARKITDOWN_ENABLED === 'true' },
  turbovec: { port: 8103, enabled: process.env.TURBOVEC_ENABLED === 'true' },
})
const bridge = new PythonBridge(pythonConfig)

// 注册 API 路由组
const apiRouter = Router()
registerCrawlRoutes(apiRouter, bridge)
registerConvertRoutes(apiRouter, bridge)
registerVectorSearchRoutes(apiRouter, bridge)
app.use(apiRouter)

// 服务状态查询端点 — 返回各服务的启用状态与健康检查结果
app.get('/api/services/status', async (_req, res) => {
  const services = ['crawl4ai', 'markitdown', 'turbovec'] as const
  const status: Record<string, any> = {}
  for (const s of services) {
    status[s] = {
      enabled: bridge.isServiceEnabled(s),
      healthy: bridge.isServiceEnabled(s) ? await bridge.healthCheck(s) : false,
    }
  }
  res.json(status)
})

const ptyManager = new PtyManager()

interface WsMessage {
  type: string
  id: string
  payload: any
}

interface WsResponse {
  type: string
  id: string
  payload: any
}

function send(ws: WebSocket, msg: WsResponse): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg))
  }
}

function sendError(ws: WebSocket, id: string, message: string): void {
  send(ws, { type: 'error', id, payload: { message } })
}

function validateToken(token: string | null): boolean {
  if (AUTH_TOKEN === 'dev') return true
  return token === AUTH_TOKEN
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const token = url.searchParams.get('token')
  if (!validateToken(token)) {
    ws.close(4001, 'Unauthorized')
    return
  }

  const clientId = uuid()
  console.log(`[WS] Client connected: ${clientId}`)

  const ptyListeners: Map<string, (() => void)[]> = new Map()

  ws.on('message', (raw) => {
    let msg: WsMessage
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      sendError(ws, 'unknown', 'Invalid JSON')
      return
    }

    switch (msg.type) {
      case 'exec': {
        handleExec(ws, msg)
        break
      }
      case 'pty_spawn': {
        handlePtySpawn(ws, msg, ptyListeners)
        break
      }
      case 'pty_write': {
        handlePtyWrite(ws, msg)
        break
      }
      case 'pty_resize': {
        handlePtyResize(ws, msg)
        break
      }
      case 'pty_kill': {
        handlePtyKill(ws, msg, ptyListeners)
        break
      }
      default: {
        sendError(ws, msg.id, `Unknown message type: ${msg.type}`)
      }
    }
  })

  ws.on('close', () => {
    console.log(`[WS] Client disconnected: ${clientId}`)
    for (const [ptyId, listeners] of ptyListeners) {
      listeners.forEach(fn => fn())
      ptyManager.kill(ptyId)
    }
    ptyListeners.clear()
  })
})

async function handleExec(ws: WebSocket, msg: WsMessage): Promise<void> {
  const { cmd, cwd, env, timeout } = msg.payload || {}
  if (!cmd) {
    sendError(ws, msg.id, 'Missing "cmd" in payload')
    return
  }

  const isWindows = process.platform === 'win32'
  const ptyId = `exec-${msg.id}`
  let settled = false
  try {
    const shellArgs = isWindows
      ? { shell: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-Command', cmd] }
      : { shell: '/bin/sh', args: ['-c', cmd] }

    ptyManager.spawnWithArgs(ptyId, {
      shell: shellArgs.shell,
      args: shellArgs.args,
      cwd: cwd || null,
      cols: 200,
      rows: 50,
      env: env || undefined,
    })

    const chunks: string[] = []
    const dataListener = ptyManager.onData(ptyId, (data) => chunks.push(data))
    const exitListener = ptyManager.onExit(ptyId, (exitCode) => {
      if (settled) return
      settled = true
      if (dataListener) dataListener()
      if (exitListener) exitListener()
      ptyManager.kill(ptyId)
      send(ws, {
        type: 'exec_result',
        id: msg.id,
        payload: {
          stdout: chunks.join(''),
          stderr: '',
          exitCode,
          timedOut: false,
        },
      })
    })

    const maxWait = timeout || 15000
    setTimeout(() => {
      if (settled) return
      settled = true
      if (dataListener) dataListener()
      if (exitListener) exitListener()
      ptyManager.kill(ptyId)
      send(ws, {
        type: 'exec_result',
        id: msg.id,
        payload: {
          stdout: chunks.join(''),
          stderr: '',
          exitCode: null,
          timedOut: true,
        },
      })
    }, maxWait)
  } catch (err) {
    if (!settled) {
      settled = true
      sendError(ws, msg.id, err instanceof Error ? err.message : String(err))
    }
  }
}

function handlePtySpawn(ws: WebSocket, msg: WsMessage, listeners: Map<string, (() => void)[]>): void {
  const { shell, cwd, cols, rows, env } = msg.payload || {}
  const ptyId = msg.id

  try {
    ptyManager.spawn(ptyId, { shell, cwd, cols, rows, env })

    const cleanup: (() => void)[] = []

    const dataListener = ptyManager.onData(ptyId, (data) => {
      send(ws, { type: 'pty_output', id: ptyId, payload: { data } })
    })
    if (dataListener) cleanup.push(dataListener)

    const exitListener = ptyManager.onExit(ptyId, (exitCode, signal) => {
      send(ws, { type: 'pty_exit', id: ptyId, payload: { exitCode, signal } })
      cleanup.forEach(fn => fn())
      listeners.delete(ptyId)
    })
    if (exitListener) cleanup.push(exitListener)

    listeners.set(ptyId, cleanup)
  } catch (err) {
    sendError(ws, ptyId, err instanceof Error ? err.message : String(err))
  }
}

function handlePtyWrite(ws: WebSocket, msg: WsMessage): void {
  const { data } = msg.payload || {}
  if (!data) {
    sendError(ws, msg.id, 'Missing "data" in payload')
    return
  }
  try {
    ptyManager.write(msg.id, data)
  } catch (err) {
    sendError(ws, msg.id, err instanceof Error ? err.message : String(err))
  }
}

function handlePtyResize(ws: WebSocket, msg: WsMessage): void {
  const { cols, rows } = msg.payload || {}
  if (!cols || !rows) return
  ptyManager.resize(msg.id, cols, rows)
}

function handlePtyKill(ws: WebSocket, msg: WsMessage, listeners: Map<string, (() => void)[]>): void {
  const cleanup = listeners.get(msg.id)
  if (cleanup) {
    cleanup.forEach(fn => fn())
    listeners.delete(msg.id)
  }
  ptyManager.kill(msg.id)
}

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    ptys: ptyManager.list().length,
    uptime: process.uptime(),
  })
})

process.on('SIGINT', () => {
  console.log('\n[Server] Shutting down...')
  ptyManager.killAll()
  server.close()
  process.exit(0)
})

process.on('SIGTERM', () => {
  ptyManager.killAll()
  server.close()
  process.exit(0)
})

server.listen(PORT, () => {
  console.log(`[WorldSmith Server] Running on http://localhost:${PORT}`)
  console.log(`[WorldSmith Server] WebSocket: ws://localhost:${PORT}/ws`)
  console.log(`[WorldSmith Server] Auth token: ${AUTH_TOKEN === 'dev' ? 'dev (开发模式)' : '***'}`)
})
