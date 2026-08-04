/**
 * # useTerminalRust — Tauri 端终端服务适配器
 *
 * 通过 Tauri `invoke` 调用 Rust 命令层（`apps/tauri/src-tauri/src/commands.rs`
 * 中的 `terminal_*` 命令），把后端终端工具（`crates/agent-commands/src/terminal.rs`
 * 的 `TerminalService`）暴露为前端可直接调用的方法。
 *
 * 与 Agent 工具总线解耦：本服务独立持有 `ShellSessionManager`，
 * 前端直接执行命令 / 管理持久化会话，不经过 AgentLoop。
 *
 * ## 命令参数约定
 * 后端命令取 `serde_json::Value` 参数，键名与工具参数一致（snake_case）：
 * - `executeCommand`: `{ command, cwd?, env?, timeout_ms? }`
 * - `createSession`:  `{ shell?, cwd?, env? }`
 * - `execSession`:    `{ session_id, command, timeout_ms? }`
 * - `inputSession`:   `{ session_id, data }`
 * - `destroySession`: `{ session_id }`
 *
 * ## 状态设计
 * 模块级单例（与 useAgentRust / useLongTaskRust 一致），多次调用返回同一份
 * 响应式状态与方法，避免多组件各自维护 shells / sessions / 输出。
 */

import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'

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
async function createSession(opts: { shell?: string; cwd?: string } = {}): Promise<{ session_id: string }> {
  const res = await invoke<{ session_id: string }>('terminal_create_session', {
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

/** 向持久化会话发送交互输入 */
async function inputSession(sessionId: string, data: string): Promise<{ ok: boolean }> {
  return invoke<{ ok: boolean }>('terminal_input_session', {
    args: { session_id: sessionId, data },
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
    destroySession,
    refreshSessions,
  }
}