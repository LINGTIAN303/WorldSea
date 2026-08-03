import type { ExecutionAdapter, ExecOptions, ExecResult, PtyOptions, ShellInfo, ShellSessionInfo, ShellExecResult } from '@worldsmith/agent-runtime'
import { getWsToken } from '@worldsmith/agent-runtime/execution'

interface WsAdapterConfig {
  url: string
  reconnect?: boolean
  maxRetries?: number
}

export class WebSocketExecutionAdapter implements ExecutionAdapter {
  private config: WsAdapterConfig
  private ws: WebSocket | null = null
  private connected: boolean = false
  private connecting: boolean = false
  private outputCallbacks: Map<string, Set<(data: string) => void>> = new Map()
  private pendingRequests: Map<string, {
    resolve: (result: ExecResult) => void
    reject: (err: Error) => void
    timeout: ReturnType<typeof setTimeout>
    settled: boolean
  }> = new Map()
  private retryCount: number = 0
  private disposed: boolean = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private connectionWaiters: Array<{ resolve: () => void; reject: (err: Error) => void }> = []

  constructor(config: WsAdapterConfig) {
    this.config = { reconnect: true, maxRetries: 5, ...config }
  }

  isAvailable(): boolean {
    return this.connected && !this.disposed
  }

  async tryConnect(): Promise<boolean> {
    if (this.disposed) return false
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) return true
    try {
      await this.ensureConnection()
      return this.connected
    } catch {
      return false
    }
  }

  private async ensureConnection(): Promise<void> {
    if (this.disposed) throw new Error('Adapter has been disposed')
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) return
    if (this.connecting) {
      await new Promise<void>((resolve, reject) => {
        this.connectionWaiters.push({ resolve, reject })
      })
      if (!this.connected) throw new Error('连接失败')
      return
    }

    this.connecting = true
    try {
      await this.connect()
      this.notifyWaiters(true)
    } catch (err) {
      this.notifyWaiters(false)
      throw err
    } finally {
      this.connecting = false
    }
  }

  private notifyWaiters(success: boolean): void {
    for (const w of this.connectionWaiters) {
      if (success) w.resolve()
      else w.reject(new Error('连接失败'))
    }
    this.connectionWaiters = []
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.disposed) { reject(new Error('Adapter disposed')); return }

      // 优先使用 getWsToken（支持环境变量 + localStorage 双重配置）
      const token = getWsToken()
      const url = `${this.config.url}?token=${token}`

      this.ws = new WebSocket(url)

      this.ws.onopen = () => {
        this.connected = true
        const wasReconnect = this.retryCount > 0
        this.retryCount = 0
        resolve()
        if (wasReconnect) {
          for (const [_ptyId, callbacks] of this.outputCallbacks) {
            callbacks.forEach(cb => cb('\r\n[WebSocket 重连] 终端会话可能已失效，请重新打开终端\r\n'))
          }
        }
      }

      this.ws.onclose = () => {
        this.connected = false
        this.ws = null
        if (!this.disposed && this.config.reconnect && this.retryCount < (this.config.maxRetries || 5)) {
          this.scheduleReconnect()
        }
      }

      this.ws.onerror = () => {
        if (!this.connected) reject(new Error(`无法连接到 ${this.config.url}`))
      }

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          this.handleMessage(msg)
        } catch {}
      }
    })
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.retryCount++
    const delay = Math.min(1000 * Math.pow(2, this.retryCount - 1), 30000)
    this.reconnectTimer = setTimeout(async () => {
      if (this.disposed) return
      this.connecting = true
      try {
        await this.connect()
        this.connecting = false
        this.notifyWaiters(true)
      } catch {
        this.connecting = false
        this.notifyWaiters(false)
      }
    }, delay)
  }

  private handleMessage(msg: any): void {
    if (msg.type === 'pty_output' && msg.id) {
      const callbacks = this.outputCallbacks.get(msg.id)
      if (callbacks) {
        callbacks.forEach(cb => cb(msg.payload?.data || ''))
      }
    }

    if (msg.type === 'pty_exit' && msg.id) {
      const callbacks = this.outputCallbacks.get(msg.id)
      if (callbacks) {
        const exitCode = msg.payload?.exitCode
        const signal = msg.payload?.signal
        callbacks.forEach(cb => cb(`\r\n\x1b[90m[进程退出] exitCode=${exitCode ?? 'null'}${signal ? ` signal=${signal}` : ''}\x1b[0m\r\n`))
      }
      this.outputCallbacks.delete(msg.id)
    }

    if (msg.type === 'exec_result' && msg.id) {
      const pending = this.pendingRequests.get(msg.id)
      if (pending && !pending.settled) {
        pending.settled = true
        clearTimeout(pending.timeout)
        this.pendingRequests.delete(msg.id)
        pending.resolve({
          stdout: msg.payload?.stdout || '',
          stderr: msg.payload?.stderr || '',
          exitCode: msg.payload?.exitCode ?? null,
          timedOut: msg.payload?.timedOut || false,
        })
      }
    }

    if (msg.type === 'error' && msg.id) {
      const pending = this.pendingRequests.get(msg.id)
      if (pending && !pending.settled) {
        pending.settled = true
        clearTimeout(pending.timeout)
        this.pendingRequests.delete(msg.id)
        pending.reject(new Error(msg.payload?.message || '未知错误'))
      }
    }
  }

  private send(msg: object): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket 未连接')
    }
    this.ws.send(JSON.stringify(msg))
  }

  async executeCommand(cmd: string, opts?: ExecOptions): Promise<ExecResult> {
    await this.ensureConnection()
    const id = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const timeout = opts?.timeout || 15000

    return new Promise<ExecResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.pendingRequests.get(id)
        if (pending && !pending.settled) {
          pending.settled = true
          this.pendingRequests.delete(id)
          resolve({ stdout: '', stderr: '', exitCode: null, timedOut: true })
        }
      }, timeout)

      this.pendingRequests.set(id, { resolve, reject, timeout: timer, settled: false })

      try {
        this.send({
          type: 'exec',
          id,
          payload: { cmd, cwd: opts?.cwd, env: opts?.env, timeout },
        })
      } catch (err) {
        const pending = this.pendingRequests.get(id)
        if (pending && !pending.settled) {
          pending.settled = true
          clearTimeout(timer)
          this.pendingRequests.delete(id)
          reject(err)
        }
      }
    })
  }

  async spawnPty(id: string, opts?: PtyOptions): Promise<void> {
    await this.ensureConnection()
    this.send({
      type: 'pty_spawn',
      id,
      payload: { shell: opts?.shell, cwd: opts?.cwd, cols: opts?.cols || 200, rows: opts?.rows || 50 },
    })
  }

  async writePty(id: string, data: string): Promise<void> {
    await this.ensureConnection()
    this.send({ type: 'pty_write', id, payload: { data } })
  }

  async resizePty(id: string, cols: number, rows: number): Promise<void> {
    await this.ensureConnection()
    this.send({ type: 'pty_resize', id, payload: { cols, rows } })
  }

  async killPty(id: string): Promise<void> {
    if (!this.connected) return
    try {
      this.send({ type: 'pty_kill', id, payload: {} })
    } catch {}
    this.outputCallbacks.delete(id)
  }

  async onPtyOutput(id: string, callback: (data: string) => void): Promise<() => void> {
    if (!this.outputCallbacks.has(id)) {
      this.outputCallbacks.set(id, new Set())
    }
    this.outputCallbacks.get(id)!.add(callback)
    return () => {
      const callbacks = this.outputCallbacks.get(id)
      if (callbacks) {
        callbacks.delete(callback)
        if (callbacks.size === 0) this.outputCallbacks.delete(id)
      }
    }
  }

  disconnect(): void {
    this.disposed = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    for (const w of this.connectionWaiters) {
      w.reject(new Error('Adapter disposed'))
    }
    this.connectionWaiters = []
    for (const [_id, pending] of this.pendingRequests) {
      if (!pending.settled) {
        pending.settled = true
        clearTimeout(pending.timeout)
        pending.reject(new Error('WebSocket disconnected'))
      }
    }
    this.pendingRequests.clear()
    this.outputCallbacks.clear()
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.connected = false
  }

  // ─── Shell 检测与会话管理（Web 模式降级） ──────────────────────

  async detectShells(): Promise<ShellInfo[]> {
    // Web 模式下无法检测本地 Shell，返回默认列表
    const isWin = navigator.userAgent.includes('Windows')
    if (isWin) {
      return [
        { id: 'cmd', name: 'CMD', path: 'cmd.exe', is_default: true },
        { id: 'powershell', name: 'PowerShell', path: 'powershell.exe', is_default: false },
      ]
    }
    return [
      { id: 'sh', name: 'POSIX Shell', path: '/bin/sh', is_default: false },
      { id: 'bash', name: 'Bash', path: '/bin/bash', is_default: true },
    ]
  }

  async createSession(id: string, opts?: PtyOptions): Promise<ShellSessionInfo> {
    await this.ensureConnection()
    const shell = opts?.shell || (navigator.userAgent.includes('Windows') ? 'powershell.exe' : '/bin/bash')
    this.send({
      type: 'pty_spawn',
      id,
      payload: { shell, cwd: opts?.cwd, cols: opts?.cols || 200, rows: opts?.rows || 50 },
    })
    return {
      id,
      shell_id: shell.includes('powershell') ? 'powershell' : shell.includes('cmd') ? 'cmd' : 'bash',
      shell_path: shell,
      cwd: opts?.cwd || process.cwd?.() || '.',
      created_at: Date.now() / 1000 | 0,
    }
  }

  async execInSession(id: string, command: string, timeoutMs?: number): Promise<ShellExecResult> {
    await this.ensureConnection()
    // Web 模式下通过 write 发送命令，然后等待输出
    this.send({ type: 'pty_write', id, payload: { data: command + '\n' } })

    // 收集输出（简化版：等待一段时间后读取）
    const chunks: string[] = []
    const cb = (data: string) => chunks.push(data)
    if (!this.outputCallbacks.has(id)) this.outputCallbacks.set(id, new Set())
    this.outputCallbacks.get(id)!.add(cb)

    await new Promise(r => setTimeout(r, Math.min(timeoutMs || 30000, 5000)))

    this.outputCallbacks.get(id)?.delete(cb)
    const stdout = chunks.join('')
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
      .replace(/\x1b\].*?\x07/g, '')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')

    return { stdout, stderr: '', exit_code: 0, timed_out: false }
  }

  async destroySession(id: string): Promise<void> {
    await this.killPty(id)
  }

  async listSessions(): Promise<string[]> {
    // Web 模式下无法列举服务端会话
    return []
  }

  async sendInput(id: string, data: string): Promise<void> {
    await this.writePty(id, data + '\n')
  }
}
