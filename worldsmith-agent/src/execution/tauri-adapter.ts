import type { ExecutionAdapter, ExecOptions, ExecResult, PtyOptions, ShellInfo, ShellSessionInfo, ShellExecResult } from '@worldsmith/agent-runtime'

function isTauri(): boolean {
  return typeof window !== 'undefined' && (!!(window as any).__TAURI_INTERNALS__ || !!(window as any).__TAURI__)
}

export class TauriExecutionAdapter implements ExecutionAdapter {
  isAvailable(): boolean {
    return isTauri()
  }

  async tryConnect(): Promise<boolean> {
    return isTauri()
  }

  async executeCommand(cmd: string, opts?: ExecOptions): Promise<ExecResult> {
    if (!isTauri()) {
      return { stdout: '', stderr: 'CLI 工具仅在 Tauri 桌面环境中可用', exitCode: 1, timedOut: false }
    }

    const { invoke } = await import('@tauri-apps/api/core')
    const { listen } = await import('@tauri-apps/api/event')
    const ptyId = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const timeout = opts?.timeout || 15000

    try {
      const isWindows = navigator.userAgent.includes('Windows') || navigator.platform.startsWith('Win')
      if (isWindows) {
        await invoke('cmd_pty_spawn', {
          id: ptyId,
          shell: 'powershell.exe',
          args: ['-NoLogo', '-NoProfile', '-Command', cmd],
          cwd: opts?.cwd || null,
          cols: 200,
          rows: 50,
        })
      } else {
        await invoke('cmd_pty_spawn', {
          id: ptyId,
          shell: '/bin/sh',
          args: ['-c', cmd],
          cwd: opts?.cwd || null,
          cols: 200,
          rows: 50,
        })
      }

      const chunks: string[] = []
      const unlistenData = await listen<string>(`pty-output-${ptyId}`, (e) => {
        chunks.push(e.payload)
      })

      let exitResolved = false
      let exitCode: number | null = null
      let unlistenExitFn: unknown = null

      const exitPromise = new Promise<void>((resolve) => {
        listen<number>(`pty-exit-${ptyId}`, (e) => {
          exitCode = e.payload
          exitResolved = true
          resolve()
        }).then((fn) => { unlistenExitFn = fn }).catch(() => resolve())
      })

      const startTime = Date.now()
      const timeoutPromise = new Promise<void>((resolve) => {
        setTimeout(() => resolve(), timeout)
      })

      await Promise.race([exitPromise, timeoutPromise])

      if (!exitResolved) {
        await new Promise<void>((resolve) => setTimeout(resolve, 500))
      }

      await invoke('cmd_pty_kill', { id: ptyId }).catch(() => {})
      unlistenData()
      if (unlistenExitFn && typeof unlistenExitFn === 'function') (unlistenExitFn as () => void)()

      const stdout = chunks.join('')
        .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
        .replace(/\x1b\].*?\x07/g, '')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
      const timedOut = !exitResolved && (Date.now() - startTime >= timeout - 100)
      return { stdout, stderr: '', exitCode: exitResolved ? exitCode : (timedOut ? null : 0), timedOut }
    } catch (err) {
      return { stdout: '', stderr: err instanceof Error ? err.message : String(err), exitCode: 1, timedOut: false }
    }
  }

  async spawnPty(id: string, opts?: PtyOptions): Promise<void> {
    if (!isTauri()) throw new Error('PTY 仅在 Tauri 桌面环境中可用')
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('cmd_pty_spawn', {
      id,
      shell: opts?.shell || null,
      cwd: opts?.cwd || null,
      cols: opts?.cols || 200,
      rows: opts?.rows || 50,
    })
  }

  async writePty(id: string, data: string): Promise<void> {
    if (!isTauri()) throw new Error('PTY 仅在 Tauri 桌面环境中可用')
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('cmd_pty_write', { id, data })
  }

  async resizePty(id: string, cols: number, rows: number): Promise<void> {
    if (!isTauri()) return
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('cmd_pty_resize', { id, cols, rows })
  }

  async killPty(id: string): Promise<void> {
    if (!isTauri()) return
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('cmd_pty_kill', { id }).catch(() => {})
  }

  async onPtyOutput(id: string, callback: (data: string) => void): Promise<() => void> {
    if (!isTauri()) return () => {}
    const { listen } = await import('@tauri-apps/api/event')
    const unlisten = await listen<string>(`pty-output-${id}`, (e) => callback(e.payload))
    return unlisten
  }

  // ─── Shell 检测与会话管理 ────────────────────────────────────

  async detectShells(): Promise<ShellInfo[]> {
    if (!isTauri()) return []
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<ShellInfo[]>('cmd_detect_shells')
  }

  async createSession(id: string, opts?: PtyOptions): Promise<ShellSessionInfo> {
    if (!isTauri()) throw new Error('Shell 会话仅在 Tauri 桌面环境中可用')
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<ShellSessionInfo>('cmd_shell_session_create', {
      id,
      shell: opts?.shell || null,
      cwd: opts?.cwd || null,
      env: opts?.env || null,
      cols: opts?.cols || 200,
      rows: opts?.rows || 50,
    })
  }

  async execInSession(id: string, command: string, timeoutMs?: number): Promise<ShellExecResult> {
    if (!isTauri()) throw new Error('Shell 会话仅在 Tauri 桌面环境中可用')
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<ShellExecResult>('cmd_shell_session_exec', {
      id,
      command,
      timeout_ms: timeoutMs || null,
    })
  }

  async destroySession(id: string): Promise<void> {
    if (!isTauri()) return
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('cmd_shell_session_destroy', { id })
  }

  async listSessions(): Promise<string[]> {
    if (!isTauri()) return []
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<string[]>('cmd_shell_session_list')
  }

  async sendInput(id: string, data: string): Promise<void> {
    if (!isTauri()) throw new Error('Shell 会话仅在 Tauri 桌面环境中可用')
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('cmd_shell_session_input', { id, data })
  }
}
