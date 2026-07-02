/**
 * Node.js 原生执行适配器
 *
 * 用于 serve.ts（Node.js 后端）环境，直接用 child_process 执行命令，
 * 不依赖 WebSocket 客户端（避免"连自己"的死循环）。
 *
 * 核心方法：
 *   - executeCommand: 一次性命令执行（child_process.exec）
 *   - createSession / execInSession / destroySession: 持久 shell 会话（spawn）
 *
 * PTY 能力为简化实现（不依赖 node-pty 原生模块）：
 *   - spawn 交互式 shell，通过 stdin/stdout 通信
 *   - 不支持真正 PTY 的终端控制（resize/颜色等），但满足工具执行需求
 */
import { exec, spawn, type ChildProcess } from 'child_process'
import type {
  ExecutionAdapter,
  ExecOptions,
  ExecResult,
  PtyOptions,
  ShellInfo,
  ShellSessionInfo,
  ShellExecResult,
} from './adapter'

interface ShellSession {
  process: ChildProcess
  shell: string
  cwd: string
  createdAt: number
  outputCallbacks: Set<(data: string) => void>
  buffer: string[] // 待读取的输出
}

/** 检测当前是否在 Node.js 环境中（非浏览器） */
export function isNodeEnv(): boolean {
  return (
    typeof process !== 'undefined' &&
    !!process.versions?.node &&
    typeof (globalThis as any).window === 'undefined'
  )
}

/** 获取默认 shell */
export function getDefaultShell(): string {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'powershell.exe'
  }
  return process.env.SHELL || '/bin/bash'
}

export class NodeExecutionAdapter implements ExecutionAdapter {
  private sessions: Map<string, ShellSession> = new Map()

  isAvailable(): boolean {
    return isNodeEnv()
  }

  async tryConnect(): Promise<boolean> {
    return this.isAvailable()
  }

  /**
   * 一次性命令执行
   * Windows: 用 PowerShell 执行，通过 Set-Location 切换目录（避免 exec cwd 中文路径问题）
   * Unix: 通过 sh -c 执行，直接传 cwd
   */
  async executeCommand(cmd: string, opts?: ExecOptions): Promise<ExecResult> {
    return new Promise((resolve) => {
      const timeout = opts?.timeout || 15000
      const env = { ...process.env, ...(opts?.env || {}) }
      const isWin = process.platform === 'win32'

      // Windows: 不传 cwd 给 exec（中文路径会导致子进程启动失败），
      // 改在命令内部用 Set-Location 切换目录
      let finalCmd = cmd
      let execCwd: string | undefined
      if (isWin) {
        if (opts?.cwd) {
          // PowerShell 用单引号包裹路径，避免转义问题
          finalCmd = `Set-Location -LiteralPath '${opts.cwd}'; ${cmd}`
        }
        execCwd = undefined // 不传 cwd，让 PowerShell 在默认目录启动
      } else {
        execCwd = opts?.cwd || process.cwd()
      }

      const execOpts: Parameters<typeof exec>[1] = {
        cwd: execCwd,
        timeout,
        env,
        maxBuffer: 10 * 1024 * 1024, // 10MB
        windowsHide: true,
        // Windows 用 PowerShell（支持中文路径 + UTF-8 输出 + PowerShell cmdlet）
        shell: isWin ? 'powershell.exe' : undefined,
      }

      const child = exec(finalCmd, execOpts, (err, stdout, stderr) => {
        const out = stdout ? stdout.toString('utf-8') : ''
        const errOut = stderr ? stderr.toString('utf-8') : ''
        const timedOut = !!err && (err as NodeJS.ErrnoException & { killed?: boolean }).killed === true
        const exitCode = err ? (err as NodeJS.ErrnoException & { code?: number }).code ?? 1 : 0
        resolve({ stdout: out, stderr: errOut, exitCode, timedOut })
      })

      child.on('error', (err) => {
        resolve({
          stdout: '',
          stderr: `执行失败: ${err.message}`,
          exitCode: 1,
          timedOut: false,
        })
      })
    })
  }

  // ─── Shell 检测 ────────────────────────────────────────────

  async detectShells(): Promise<ShellInfo[]> {
    if (process.platform === 'win32') {
      return [
        { id: 'powershell', name: 'PowerShell', path: 'powershell.exe', is_default: true },
        { id: 'cmd', name: 'CMD', path: 'cmd.exe', is_default: false },
      ]
    }
    const shells: ShellInfo[] = [
      { id: 'bash', name: 'Bash', path: '/bin/bash', is_default: true },
      { id: 'sh', name: 'POSIX Shell', path: '/bin/sh', is_default: false },
    ]
    // 检测 zsh
    if (process.env.SHELL?.includes('zsh')) {
      shells.unshift({ id: 'zsh', name: 'Zsh', path: process.env.SHELL, is_default: true })
      shells[1].is_default = false
    }
    return shells
  }

  // ─── Shell 会话管理（spawn 交互式 shell） ──────────────────

  async spawnPty(id: string, opts?: PtyOptions): Promise<void> {
    await this.createSession(id, opts)
  }

  async createSession(id: string, opts?: PtyOptions): Promise<ShellSessionInfo> {
    // 若已存在同 id 会话，先销毁
    const existing = this.sessions.get(id)
    if (existing) {
      await this.destroySession(id)
    }

    const shell = opts?.shell || getDefaultShell()
    const cwd = opts?.cwd || process.cwd()
    const shellArgs = this.getShellArgs(shell)

    const child = spawn(shell, shellArgs, {
      cwd,
      env: { ...process.env, TERM: 'dumb' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })

    const session: ShellSession = {
      process: child,
      shell,
      cwd,
      createdAt: Math.floor(Date.now() / 1000),
      outputCallbacks: new Set(),
      buffer: [],
    }
    this.sessions.set(id, session)

    // 收集 stdout
    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString('utf-8')
      session.buffer.push(text)
      for (const cb of session.outputCallbacks) cb(text)
    })

    // 收集 stderr
    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString('utf-8')
      session.buffer.push(text)
      for (const cb of session.outputCallbacks) cb(text)
    })

    // 进程退出
    child.on('exit', (code, signal) => {
      const exitMsg = `\r\n\x1b[90m[进程退出] exitCode=${code ?? 'null'}${signal ? ` signal=${signal}` : ''}\x1b[0m\r\n`
      for (const cb of session.outputCallbacks) cb(exitMsg)
    })

    child.on('error', (err) => {
      const errMsg = `\r\n\x1b[31m[会话错误] ${err.message}\x1b[0m\r\n`
      for (const cb of session.outputCallbacks) cb(errMsg)
    })

    const shellId = this.extractShellId(shell)
    return {
      id,
      shell_id: shellId,
      shell_path: shell,
      cwd,
      created_at: session.createdAt,
    }
  }

  /**
   * 在会话中执行命令（write 到 stdin，等待输出）
   * 简化实现：发送命令 + echo 标记，收集输出直到看到标记
   */
  async execInSession(id: string, command: string, timeoutMs?: number): Promise<ShellExecResult> {
    const session = this.sessions.get(id)
    if (!session) {
      return { stdout: '', stderr: `会话不存在: ${id}`, exit_code: 1, timed_out: false }
    }

    const timeout = Math.min(timeoutMs || 30000, 60000)
    // 使用唯一标记检测命令结束
    const marker = `__WS_EXEC_END_${Date.now()}_${Math.random().toString(36).slice(2, 8)}__`
    const echoCmd = `${command}\necho "${marker}"\n`

    const chunks: string[] = []
    const cb = (data: string) => chunks.push(data)
    session.outputCallbacks.add(cb)

    try {
      session.process.stdin?.write(echoCmd)
    } catch {
      session.outputCallbacks.delete(cb)
      return { stdout: '', stderr: '写入 stdin 失败', exit_code: 1, timed_out: false }
    }

    // 等待标记出现或超时
    const startTime = Date.now()
    while (Date.now() - startTime < timeout) {
      const combined = chunks.join('')
      if (combined.includes(marker)) break
      await new Promise((r) => setTimeout(r, 50))
    }

    session.outputCallbacks.delete(cb)

    const combined = chunks.join('')
    // 截取标记之前的内容，去掉命令回显行
    const markerIdx = combined.indexOf(marker)
    const output = markerIdx >= 0 ? combined.slice(0, markerIdx) : combined
    // 去掉第一行（命令回显）
    const lines = output.split('\n')
    if (lines.length > 1 && lines[0].trim().startsWith(command.trim().slice(0, 20))) {
      lines.shift()
    }
    const stdout = lines.join('\n')
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '') // 去掉 ANSI 颜色码
      .replace(/\x1b\].*?\x07/g, '') // 去掉 OSC 序列
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '') // 去掉控制字符

    const timedOut = !combined.includes(marker)
    return { stdout, stderr: '', exit_code: timedOut ? null : 0, timed_out: timedOut }
  }

  async writePty(id: string, data: string): Promise<void> {
    const session = this.sessions.get(id)
    if (!session) return
    try {
      session.process.stdin?.write(data)
    } catch {}
  }

  async resizePty(_id: string, _cols: number, _rows: number): Promise<void> {
    // 简化实现：spawn 不支持真正 PTY resize，忽略
  }

  async killPty(id: string): Promise<void> {
    await this.destroySession(id)
  }

  async destroySession(id: string): Promise<void> {
    const session = this.sessions.get(id)
    if (!session) return
    try {
      session.process.stdin?.end()
    } catch {}
    try {
      session.process.kill('SIGTERM')
    } catch {}
    // 给进程 500ms 退出，强制 kill
    setTimeout(() => {
      try {
        session.process.kill('SIGKILL')
      } catch {}
    }, 500)
    session.outputCallbacks.clear()
    this.sessions.delete(id)
  }

  async listSessions(): Promise<string[]> {
    return [...this.sessions.keys()]
  }

  async sendInput(id: string, data: string): Promise<void> {
    await this.writePty(id, data)
  }

  async onPtyOutput(id: string, callback: (data: string) => void): Promise<() => void> {
    const session = this.sessions.get(id)
    if (!session) return () => {}
    session.outputCallbacks.add(callback)
    // 发送缓冲区中已有的输出
    for (const buf of session.buffer) {
      try {
        callback(buf)
      } catch {}
    }
    session.buffer = [] // 清空缓冲（已推送）
    return () => {
      session.outputCallbacks.delete(callback)
    }
  }

  // ─── 内部辅助 ──────────────────────────────────────────────

  private getShellArgs(shell: string): string[] {
    if (process.platform === 'win32') {
      if (shell.toLowerCase().includes('powershell')) {
        return ['-NoLogo', '-NoProfile', '-NoExit', '-Command', '-']
      }
      return ['/Q', '/K'] // cmd.exe
    }
    // Unix shell：交互模式
    if (shell.includes('bash') || shell.includes('zsh')) {
      return ['-i']
    }
    return ['-i']
  }

  private extractShellId(shell: string): string {
    const lower = shell.toLowerCase()
    if (lower.includes('powershell')) return 'powershell'
    if (lower.includes('cmd')) return 'cmd'
    if (lower.includes('zsh')) return 'zsh'
    if (lower.includes('bash')) return 'bash'
    if (lower.includes('sh')) return 'sh'
    return 'unknown'
  }
}
