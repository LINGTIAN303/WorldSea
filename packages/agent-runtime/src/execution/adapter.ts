export interface ExecOptions {
  cwd?: string
  timeout?: number
  env?: Record<string, string>
}

export interface ExecResult {
  stdout: string
  stderr: string
  exitCode: number | null
  timedOut: boolean
}

export interface PtyOptions {
  shell?: string | null
  cwd?: string | null
  cols?: number
  rows?: number
  env?: Record<string, string> | null
}

/** 检测到的 Shell 信息 */
export interface ShellInfo {
  id: string
  name: string
  path: string
  is_default: boolean
}

/** Shell 会话信息 */
export interface ShellSessionInfo {
  id: string
  shell_id: string
  shell_path: string
  cwd: string
  created_at: number
}

/** Shell 会话执行结果 */
export interface ShellExecResult {
  stdout: string
  stderr: string
  exit_code: number | null
  timed_out: boolean
}

export interface ExecutionAdapter {
  isAvailable(): boolean
  tryConnect(): Promise<boolean>
  executeCommand(cmd: string, opts?: ExecOptions): Promise<ExecResult>
  spawnPty(id: string, opts?: PtyOptions): Promise<void>
  writePty(id: string, data: string): Promise<void>
  resizePty(id: string, cols: number, rows: number): Promise<void>
  killPty(id: string): Promise<void>
  onPtyOutput(id: string, callback: (data: string) => void): Promise<() => void>
  // ─── Shell 检测与会话管理 ────────────────────────────────────
  detectShells(): Promise<ShellInfo[]>
  createSession(id: string, opts?: PtyOptions): Promise<ShellSessionInfo>
  execInSession(id: string, command: string, timeoutMs?: number): Promise<ShellExecResult>
  destroySession(id: string): Promise<void>
  listSessions(): Promise<string[]>
  sendInput(id: string, data: string): Promise<void>
}
