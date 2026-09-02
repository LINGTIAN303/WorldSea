/** useTerminalRust：Tauri 端终端服务适配器（terminal_* 命令封装，模块级单例），详细见 docs/details/注释/tauri/useTerminalRust.md */

import { ref } from 'vue'
import { invoke } from '../../agent/composables/transport'

// ─── 类型 ───────────────────────────────────────────────────

/** 单次命令执行结果（后端 `execute_command` 返回） */
export interface CommandOutput {
  stdout: string
  stderr: string
  exit_code: number | null
}

/** 可用 Shell（`detect_shells` 返回项） */
export interface ShellInfo {
  id: string
  name: string
  path: string
  is_default: boolean
}

/** 持久化会话（`shell_session_list` 返回项） */
export interface ShellSessionInfo {
  session_id: string
  shell: string
  cwd: string
}

// ─── 单例状态 ───────────────────────────────────────────────

const shellList = ref<ShellInfo[]>([])
const sessions = ref<ShellSessionInfo[]>([])
const busy = ref(false)
const error = ref('')

/** 刷新会话列表（幂等，供多处调用） */
async function refreshSessions(): Promise<void> {
  try {
    const res = await invoke<{ sessions?: ShellSessionInfo[] }>('terminal_list_sessions')
    sessions.value = res?.sessions ?? []
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

// ─── 方法 ───────────────────────────────────────────────────

/** 单次命令执行 */
async function executeCommand(
  command: string,
  opts: { cwd?: string; env?: Record<string, string>; timeoutMs?: number } = {},
): Promise<CommandOutput> {
  busy.value = true
  error.value = ''
  try {
    return await invoke<CommandOutput>('terminal_execute_command', {
      args: {
        command,
        ...(opts.cwd ? { cwd: opts.cwd } : {}),
        ...(opts.env ? { env: opts.env } : {}),
        ...(opts.timeoutMs ? { timeout_ms: opts.timeoutMs } : {}),
      },
    })
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    throw err
  } finally {
    busy.value = false
  }
}

/** 检测可用 Shell */
async function detectShells(): Promise<ShellInfo[]> {
  const res = await invoke<{ shells?: ShellInfo[] }>('terminal_detect_shells')
  shellList.value = res?.shells ?? []
  return shellList.value
}

/** 创建持久化 Shell 会话 */
async function createSession(
  opts: { shell?: string; cwd?: string } = {},
): Promise<{ session_id: string; shell_path?: string; cwd?: string; pty?: boolean }> {
  const res = await invoke<{ session_id: string; shell_path?: string; cwd?: string; pty?: boolean }>('terminal_create_session', {
    args: {
      ...(opts.shell ? { shell: opts.shell } : {}),
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
    },
  })
  await refreshSessions()
  return res
}

/** 在持久化会话中执行命令 */
async function execSession(
  sessionId: string,
  command: string,
  timeoutMs?: number,
): Promise<CommandOutput> {
  return invoke<CommandOutput>('terminal_exec_session', {
    args: {
      session_id: sessionId,
      command,
      ...(timeoutMs ? { timeout_ms: timeoutMs } : {}),
    },
  })
}

/** 向持久化会话发送交互输入（appendReturn=false=真终端原始按键流，@xterm onData） */
async function inputSession(
  sessionId: string,
  data: string,
  appendReturn = true,
): Promise<{ ok: boolean }> {
  return invoke<{ ok: boolean }>('terminal_input_session', {
    args: { session_id: sessionId, data, append_return: appendReturn },
  })
}

/**
 * 增量拉取会话输出（真终端轮询，7.1）
 *
 * 客户端携带上次 `offset`，返回其后的新字节流（含 ANSI/VT 序列）。`truncated=true`
 * 表示 offset 已被缓冲裁剪（从最旧重读），调用方应重置偏移。
 */
async function pollOutput(
  sessionId: string,
  offset: number,
): Promise<{ output: string; offset: number; truncated: boolean }> {
  return invoke('terminal_poll_output', {
    args: { session_id: sessionId, offset },
  })
}

/** 调整会话终端尺寸（真终端窗口 resize，7.1）：前端容器尺寸变化时下发 */
async function resizeSession(sessionId: string, cols: number, rows: number): Promise<{ ok: boolean }> {
  return invoke('terminal_resize', {
    args: { session_id: sessionId, cols, rows },
  })
}

/** 销毁持久化会话 */
async function destroySession(sessionId: string): Promise<{ ok: boolean }> {
  const res = await invoke<{ ok: boolean }>('terminal_destroy_session', {
    args: { session_id: sessionId },
  })
  await refreshSessions()
  return res
}

// ─── 导出 ───────────────────────────────────────────────────

export function useTerminalRust() {
  return {
    // 响应式状态（模块级单例，组件内只读使用）
    shells: shellList,
    sessions,
    busy,
    error,
    // 方法
    executeCommand,
    detectShells,
    createSession,
    execSession,
    inputSession,
    pollOutput,
    resizeSession,
    destroySession,
    refreshSessions,
  }
}