import type { ToolDefinition } from '../bridge-types'
import type { IToolContext } from '../toolbus/types'
import { createExecutionAdapter } from '../execution'

// ─── 单次命令执行 ──────────────────────────────────────────────

const executeCommandTool: ToolDefinition = {
  name: 'execute_command',
  description: '在本地终端执行 shell 命令并返回输出。仅在需要系统级操作时使用（如文件系统操作、运行脚本、安装依赖等），项目数据操作请优先使用内驱工具。支持通过 env 参数注入环境变量。',
  parameters: {
    command: { type: 'string', description: '要执行的 shell 命令', required: true },
    cwd: { type: 'string', description: '工作目录（可选，默认项目根目录）' },
    env: { type: 'object', description: '环境变量（可选，如 {"PATH": "/usr/bin", "HOME": "/home/user"}）' },
  },
  execute: async (args: Record<string, unknown>, _ctx: IToolContext): Promise<string> => {
    const adapter = await createExecutionAdapter()
    if (!adapter.isAvailable()) {
      const connected = await adapter.tryConnect()
      if (!connected) {
        return '终端功能当前不可用。Tauri 桌面模式请确认环境正常，Web 模式请启动 worldsea-server 服务。'
      }
    }

    const command = String(args.command)
    const cwd = args.cwd ? String(args.cwd) : undefined
    const env = args.env as Record<string, string> | undefined

    try {
      const result = await adapter.executeCommand(command, { cwd, timeout: 30000, env })
      // 清理 ANSI 转义码和不可打印字符
      const clean = (result.stdout || '')
        .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
        .replace(/\x1b\].*?\x07/g, '')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
      return clean || '(命令已执行，无输出)'
    } catch (err) {
      return `执行失败: ${err instanceof Error ? err.message : String(err)}`
    }
  },
}

// ─── Shell 检测 ────────────────────────────────────────────────

const detectShellsTool: ToolDefinition = {
  name: 'detect_shells',
  description: '检测系统中可用的 Shell 类型。返回可用 Shell 列表（CMD、PowerShell、Bash、Zsh 等），包含路径和默认标识。在创建持久化 Shell 会话前，建议先调用此工具确认可用 Shell。',
  parameters: {},
  execute: async (_args: Record<string, unknown>, _ctx: IToolContext): Promise<string> => {
    const adapter = await createExecutionAdapter()
    try {
      const shells = await adapter.detectShells()
      if (shells.length === 0) {
        return JSON.stringify({ error: '未检测到可用 Shell', hint: '请确认运行环境正常' })
      }
      return JSON.stringify({
        shells: shells.map(s => ({
          id: s.id,
          name: s.name,
          path: s.path,
          is_default: s.is_default,
        })),
        hint: '使用 shell_session_create 创建持久化会话时，shell 参数传入 Shell 的 path 值',
      })
    } catch (err) {
      return JSON.stringify({ error: `Shell 检测失败: ${err instanceof Error ? err.message : String(err)}` })
    }
  },
}

// ─── 持久化 Shell 会话 ─────────────────────────────────────────

const shellSessionCreateTool: ToolDefinition = {
  name: 'shell_session_create',
  description: '创建一个持久化 Shell 会话。会话保持 Shell 进程活跃，支持多轮命令执行，工作目录和环境变量在命令间保持。适用于需要连续执行多条命令、保持上下文状态的场景（如项目构建、环境配置、交互式操作）。',
  parameters: {
    shell: { type: 'string', description: 'Shell 类型路径（可选，默认自动选择。可传入 detect_shells 返回的 path 值，如 "powershell.exe"、"/bin/bash"、"cmd.exe"）' },
    cwd: { type: 'string', description: '初始工作目录（可选）' },
    env: { type: 'object', description: '环境变量（可选，如 {"NODE_ENV": "development", "PATH": "/usr/local/bin:$PATH"}）' },
  },
  execute: async (args: Record<string, unknown>, _ctx: IToolContext): Promise<string> => {
    const adapter = await createExecutionAdapter()
    if (!adapter.isAvailable()) {
      const connected = await adapter.tryConnect()
      if (!connected) {
        return JSON.stringify({ ok: false, error: '终端功能当前不可用' })
      }
    }

    const sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const shell = args.shell ? String(args.shell) : undefined
    const cwd = args.cwd ? String(args.cwd) : undefined
    const env = args.env as Record<string, string> | undefined

    try {
      const info = await adapter.createSession(sessionId, { shell: shell || null, cwd: cwd || null, env: env || null })
      return JSON.stringify({
        ok: true,
        session_id: info.id,
        shell_id: info.shell_id,
        shell_path: info.shell_path,
        cwd: info.cwd,
        hint: `会话已创建。使用 shell_session_exec 在此会话中执行命令，使用 shell_session_destroy 销毁会话。session_id: ${info.id}`,
      })
    } catch (err) {
      return JSON.stringify({ ok: false, error: `会话创建失败: ${err instanceof Error ? err.message : String(err)}` })
    }
  },
}

const shellSessionExecTool: ToolDefinition = {
  name: 'shell_session_exec',
  description: '在持久化 Shell 会话中执行命令。会话保持工作目录和环境变量状态，支持连续执行多条命令。适用于需要上下文保持的场景。',
  parameters: {
    session_id: { type: 'string', description: '会话 ID（由 shell_session_create 返回）', required: true },
    command: { type: 'string', description: '要执行的命令', required: true },
    timeout_ms: { type: 'number', description: '超时时间（毫秒，默认 30000）' },
  },
  execute: async (args: Record<string, unknown>, _ctx: IToolContext): Promise<string> => {
    const adapter = await createExecutionAdapter()
    const sessionId = String(args.session_id)
    const command = String(args.command)
    const timeoutMs = args.timeout_ms ? Number(args.timeout_ms) : undefined

    try {
      const result = await adapter.execInSession(sessionId, command, timeoutMs)
      return JSON.stringify({
        ok: true,
        session_id: sessionId,
        stdout: result.stdout || '(命令已执行，无输出)',
        stderr: result.stderr,
        exit_code: result.exit_code,
        timed_out: result.timed_out,
      })
    } catch (err) {
      return JSON.stringify({
        ok: false,
        session_id: sessionId,
        error: `执行失败: ${err instanceof Error ? err.message : String(err)}`,
        hint: '会话可能已过期或被销毁，请使用 shell_session_create 创建新会话',
      })
    }
  },
}

const shellSessionInputTool: ToolDefinition = {
  name: 'shell_session_input',
  description: '向持久化 Shell 会话发送交互式输入。用于需要用户输入的命令（如 y/n 确认、密码输入、选择菜单等）。输入会自动追加换行符。',
  parameters: {
    session_id: { type: 'string', description: '会话 ID', required: true },
    data: { type: 'string', description: '要发送的输入内容', required: true },
  },
  execute: async (args: Record<string, unknown>, _ctx: IToolContext): Promise<string> => {
    const adapter = await createExecutionAdapter()
    const sessionId = String(args.session_id)
    const data = String(args.data)

    try {
      await adapter.sendInput(sessionId, data)
      return JSON.stringify({ ok: true, session_id: sessionId, hint: '输入已发送，使用 shell_session_exec 查看后续输出' })
    } catch (err) {
      return JSON.stringify({ ok: false, error: `输入发送失败: ${err instanceof Error ? err.message : String(err)}` })
    }
  },
}

const shellSessionDestroyTool: ToolDefinition = {
  name: 'shell_session_destroy',
  description: '销毁持久化 Shell 会话，释放资源。会话销毁后无法再执行命令。',
  parameters: {
    session_id: { type: 'string', description: '要销毁的会话 ID', required: true },
  },
  execute: async (args: Record<string, unknown>, _ctx: IToolContext): Promise<string> => {
    const adapter = await createExecutionAdapter()
    const sessionId = String(args.session_id)

    try {
      await adapter.destroySession(sessionId)
      return JSON.stringify({ ok: true, session_id: sessionId, message: '会话已销毁' })
    } catch (err) {
      return JSON.stringify({ ok: false, error: `销毁失败: ${err instanceof Error ? err.message : String(err)}` })
    }
  },
}

const shellSessionListTool: ToolDefinition = {
  name: 'shell_session_list',
  description: '列出当前活跃的持久化 Shell 会话。',
  parameters: {},
  execute: async (_args: Record<string, unknown>, _ctx: IToolContext): Promise<string> => {
    const adapter = await createExecutionAdapter()
    try {
      const sessions = await adapter.listSessions()
      return JSON.stringify({
        ok: true,
        sessions,
        count: sessions.length,
        hint: sessions.length === 0
          ? '当前无活跃会话，使用 shell_session_create 创建新会话'
          : `使用 shell_session_exec 在指定会话中执行命令`,
      })
    } catch (err) {
      return JSON.stringify({ ok: false, error: `查询失败: ${err instanceof Error ? err.message : String(err)}` })
    }
  },
}

export const terminalTools = [
  executeCommandTool,
  detectShellsTool,
  shellSessionCreateTool,
  shellSessionExecTool,
  shellSessionInputTool,
  shellSessionDestroyTool,
  shellSessionListTool,
]
