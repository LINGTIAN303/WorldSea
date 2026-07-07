import type { ToolDefinition } from '../bridge-types'
import type { ToolMeta } from '@worldsmith/agent-core'
import type { IToolContext } from '../toolbus/types'
import { isTauri, createExecutionAdapter, getWsUrl, resetExecutionAdapter } from '../execution'

/**
 * 终端启动器工具集
 *
 * 智能检测运行模式（Tauri 桌面 / Web 应用），按正确模式调用终端能力。
 * 支持自动启动 worldsmith-server（Web 模式下的命令执行后端）。
 *
 * 工具：
 * - detect_terminal_mode: 检测当前运行模式
 * - start_server: 启动/检测 worldsmith-server 服务
 * - launch_terminal: 启动终端并可选执行命令
 * - launch_terminal_script: 启动终端执行脚本文件
 *
 * Web 模式下的命令执行依赖 worldsmith-server，工具链会自动检测并启动服务。
 */

const SERVER_HEALTH_TIMEOUT = 3000
const SERVER_START_WAIT = 5000

async function checkServerHealth(url: string): Promise<boolean> {
  try {
    const httpUrl = url.replace(/^ws/, 'http').replace(/\/ws$/, '')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), SERVER_HEALTH_TIMEOUT)
    const resp = await fetch(`${httpUrl}/health`, { signal: controller.signal })
    clearTimeout(timer)
    return resp.ok
  } catch {
    return false
  }
}

async function pollServerReady(wsUrl: string, maxMs: number): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < maxMs) {
    if (await checkServerHealth(wsUrl)) return true
    await new Promise(r => setTimeout(r, 2000))
  }
  return false
}

async function trySpawnServer(projectRoot: string | undefined): Promise<boolean> {
  try {
    const { spawn } = await import('child_process')
    const serverCmd = projectRoot
      ? `cd "${projectRoot}/worldsmith-server" && npm run start`
      : 'cd worldsmith-server && npm run start'
    const child = spawn(serverCmd, [], {
      shell: true,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.unref()
    await new Promise(r => setTimeout(r, SERVER_START_WAIT))
    return true
  } catch {
    return false
  }
}

const detectTerminalModeTool: ToolDefinition = {
  name: 'detect_terminal_mode',
  description: '检测当前终端运行模式。返回当前是 Tauri 桌面模式还是 Web 应用模式，以及终端是否可用。在调用 launch_terminal 之前，建议先调用此工具确认模式和环境可用性。',
  parameters: {},
  meta: {
    permission: 'safe',
    category: 'dev',
    alwaysAvailable: true,
    displayName: '检测终端模式',
  } satisfies ToolMeta,
  execute: async (_args: Record<string, unknown>, _ctx: IToolContext): Promise<string> => {
    const tauriMode = isTauri()
    const adapter = await createExecutionAdapter()
    const wsUrl = getWsUrl()
    const serverHealthy = tauriMode ? true : await checkServerHealth(wsUrl)

    let available = adapter.isAvailable()
    if (!available && !tauriMode && serverHealthy) {
      available = await adapter.tryConnect()
    }

    let hint: string
    if (available) {
      hint = '终端可用，可以执行命令'
    } else if (tauriMode) {
      hint = '终端不可用，请检查 Tauri 桌面环境配置'
    } else if (serverHealthy) {
      hint = 'WebSocket 连接未建立，但 server 健康检查通过。请调用 start_server 重建连接'
    } else {
      hint = '终端不可用，worldsmith-server 未运行。请调用 start_server 启动服务'
    }

    return JSON.stringify({
      mode: tauriMode ? 'tauri' : 'web',
      modeLabel: tauriMode ? 'Tauri 桌面模式' : 'Web 应用模式',
      available,
      serverHealthy,
      wsUrl,
      description: tauriMode
        ? '当前运行在 Tauri 桌面环境，终端通过本地 PTY 直接调用'
        : '当前运行在 Web 浏览器环境，终端通过 WebSocket 连接 worldsmith-server 代理调用',
      hint,
    })
  },
}

const startServerTool: ToolDefinition = {
  name: 'start_server',
  description: '启动 worldsmith-server 服务。Web 应用模式下会自动检测并安装依赖（npm install），然后通过 Vite 开发服务器拉起进程。启动后自动重建 WebSocket 连接。如果服务已在运行则跳过启动。首次启动可能需要较长时间（安装依赖 + 编译 node-pty）。',
  parameters: {
    project_root: {
      type: 'string',
      description: '项目根目录路径（worldsmith-server 所在目录的父目录），用于定位 server 启动脚本',
    },
  },
  meta: {
    permission: 'moderate',
    category: 'dev',
    displayName: '启动服务',
  } satisfies ToolMeta,
  execute: async (args: Record<string, unknown>, _ctx: IToolContext): Promise<string> => {
    const wsUrl = getWsUrl()

    if (await checkServerHealth(wsUrl)) {
      resetExecutionAdapter()
      const adapter = await createExecutionAdapter()
      const connected = adapter.isAvailable()
      if (!connected) {
        const tried = await adapter.tryConnect()
        return JSON.stringify({
          ok: true,
          mode: isTauri() ? 'tauri' : 'web',
          message: 'worldsmith-server 已在运行中',
          wsUrl,
          connected: tried,
          hint: tried
            ? '服务正常且 WebSocket 已连接，可以直接调用 launch_terminal'
            : '服务运行中但 WebSocket 连接失败，请检查网络或重启服务',
        })
      }
      return JSON.stringify({
        ok: true,
        mode: isTauri() ? 'tauri' : 'web',
        message: 'worldsmith-server 已在运行中',
        wsUrl,
        connected: true,
        hint: '服务正常且 WebSocket 已连接，可以直接调用 launch_terminal',
      })
    }

    if (isTauri()) {
      const projectRoot = args.project_root ? String(args.project_root) : undefined
      const spawned = await trySpawnServer(projectRoot)

      if (spawned && await checkServerHealth(wsUrl)) {
        resetExecutionAdapter()
        const adapter = await createExecutionAdapter()
        return JSON.stringify({
          ok: true,
          mode: 'tauri',
          message: 'worldsmith-server 已通过本地进程启动',
          wsUrl,
          connected: adapter.isAvailable(),
        })
      }

      return JSON.stringify({
        ok: false,
        mode: 'tauri',
        error: '无法启动 worldsmith-server',
        hint: '请手动执行: cd worldsmith-server && npm run dev',
      })
    }

    try {
      const resp = await fetch('/api/launch-server', { method: 'POST' })
      const data = await resp.json() as {
        ok: boolean
        status?: string
        error?: string
        hint?: string
        logs?: string[]
        healthUrl?: string
      }

      if (data.ok) {
        if (data.status === 'installing' || data.status === 'starting') {
          const waited = await pollServerReady(wsUrl, 60000)
          if (!waited) {
            return JSON.stringify({
              ok: false,
              mode: 'web',
              status: data.status,
              message: data.status === 'installing'
                ? '正在安装依赖中，请稍后再次调用 start_server 检查状态'
                : '服务正在启动中，请稍后再次调用 start_server 检查状态',
              wsUrl,
              hint: '首次启动需要安装依赖和编译 node-pty，可能需要 1-3 分钟',
            })
          }
        }

        await new Promise(r => setTimeout(r, 1000))
        resetExecutionAdapter()
        const adapter = await createExecutionAdapter()
        const connected = await adapter.tryConnect()

        return JSON.stringify({
          ok: true,
          mode: 'web',
          message: data.status === 'already_running'
            ? 'worldsmith-server 已在运行中'
            : 'worldsmith-server 已启动',
          wsUrl,
          connected,
          hint: connected
            ? '服务已启动且 WebSocket 已连接，可以直接调用 launch_terminal'
            : '服务已启动但 WebSocket 连接未建立，请稍后调用 detect_terminal_mode 检查',
        })
      }

      const logsStr = data.logs?.length
        ? `\n\n最近日志:\n${data.logs.join('\n')}`
        : ''

      return JSON.stringify({
        ok: false,
        mode: 'web',
        error: data.error || 'Vite 代理启动失败',
        status: data.status,
        hint: data.hint || 'Vite 开发服务器无法启动 worldsmith-server，请手动启动',
        logs: data.logs,
        manualSteps: {
          step1: '打开一个新的终端窗口',
          step2: `cd ${args.project_root || '<项目根目录>'}\\worldsmith-server`,
          step3: 'npm install',
          step4: 'npm run dev',
        },
        _debug: logsStr,
      })
    } catch (err) {
      return JSON.stringify({
        ok: false,
        mode: 'web',
        error: `Vite 代理调用失败: ${err instanceof Error ? err.message : String(err)}`,
        hint: 'Vite 开发服务器可能未运行，或 /api/launch-server 端点不可用。请手动启动 worldsmith-server',
        manualSteps: {
          step1: '打开一个新的终端窗口',
          step2: `cd ${args.project_root || '<项目根目录>'}\\worldsmith-server`,
          step3: 'npm install',
          step4: 'npm run dev',
        },
      })
    }
  },
}

const launchTerminalTool: ToolDefinition = {
  name: 'launch_terminal',
  description: '启动一个终端会话并执行命令。自动识别当前运行模式：Tauri 桌面模式使用本地 PTY，Web 应用模式通过 WebSocket 连接远程 PTY。支持指定 Shell 类型和注入环境变量。返回命令执行结果。',
  meta: {
    permission: 'moderate',
    category: 'dev',
    displayName: '启动终端',
  } satisfies ToolMeta,
  parameters: {
    command: {
      type: 'string',
      description: '要执行的 shell 命令',
      required: true,
    },
    cwd: {
      type: 'string',
      description: '工作目录（可选，默认项目根目录）',
    },
    shell: {
      type: 'string',
      description: 'Shell 类型路径（可选，默认自动选择。可传入 detect_shells 返回的 path 值，如 "powershell.exe"、"/bin/bash"、"cmd.exe"）',
    },
    env: {
      type: 'object',
      description: '环境变量（可选，如 {"NODE_ENV": "development"}）',
    },
    mode_hint: {
      type: 'string',
      description: '模式提示，用于确认你了解当前模式。可选值：tauri（桌面模式）、web（Web模式）。调用 detect_terminal_mode 获取当前模式后填入此参数，避免模式混淆。',
      enum: ['tauri', 'web'],
    },
  },
  execute: async (args: Record<string, unknown>, _ctx: IToolContext): Promise<string> => {
    const actualMode = isTauri() ? 'tauri' : 'web'
    const modeHint = args.mode_hint as string | undefined

    if (modeHint && modeHint !== actualMode) {
      return JSON.stringify({
        ok: false,
        error: `模式不匹配：你指定的模式是 "${modeHint}"，但当前实际运行模式是 "${actualMode}"。请先调用 detect_terminal_mode 确认当前模式后再操作。`,
        actualMode,
      })
    }

    const adapter = await createExecutionAdapter()
    if (!adapter.isAvailable()) {
      const connected = await adapter.tryConnect()
      if (!connected) {
        return JSON.stringify({
          ok: false,
          error: actualMode === 'tauri'
            ? 'Tauri 桌面模式终端不可用，请检查桌面环境配置'
            : 'Web 模式终端不可用，请先调用 start_server 启动 worldsmith-server',
          mode: actualMode,
        })
      }
    }

    const command = String(args.command)
    const cwd = args.cwd ? String(args.cwd) : undefined
    const env = args.env as Record<string, string> | undefined

    try {
      const result = await adapter.executeCommand(command, { cwd, timeout: 30000, env })
      return JSON.stringify({
        ok: true,
        mode: actualMode,
        modeLabel: actualMode === 'tauri' ? 'Tauri 桌面模式' : 'Web 应用模式',
        stdout: result.stdout || '(命令已执行，无输出)',
        stderr: result.stderr || '',
        exitCode: result.exitCode,
        timedOut: result.timedOut,
      })
    } catch (err) {
      return JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        mode: actualMode,
      })
    }
  },
}

const launchTerminalScriptTool: ToolDefinition = {
  name: 'launch_terminal_script',
  description: '通过脚本方式启动终端会话，执行多行脚本内容。自动识别当前运行模式：Tauri 桌面模式使用本地 PTY，Web 应用模式通过 WebSocket 连接远程 PTY。适用于需要执行多行脚本或复杂命令序列的场景。',
  meta: {
    permission: 'moderate',
    category: 'dev',
    displayName: '终端脚本',
  } satisfies ToolMeta,
  parameters: {
    script: {
      type: 'string',
      description: '要执行的脚本内容（支持多行）',
      required: true,
    },
    cwd: {
      type: 'string',
      description: '工作目录（可选，默认项目根目录）',
    },
    interpreter: {
      type: 'string',
      description: '脚本解释器（可选，默认根据脚本内容自动推断，如 bash、sh、python3 等）',
    },
    env: {
      type: 'object',
      description: '环境变量（可选，如 {"NODE_ENV": "development"}）',
    },
    mode_hint: {
      type: 'string',
      description: '模式提示，用于确认你了解当前模式。可选值：tauri（桌面模式）、web（Web模式）。调用 detect_terminal_mode 获取当前模式后填入此参数，避免模式混淆。',
      enum: ['tauri', 'web'],
    },
  },
  execute: async (args: Record<string, unknown>, _ctx: IToolContext): Promise<string> => {
    const actualMode = isTauri() ? 'tauri' : 'web'
    const modeHint = args.mode_hint as string | undefined

    if (modeHint && modeHint !== actualMode) {
      return JSON.stringify({
        ok: false,
        error: `模式不匹配：你指定的模式是 "${modeHint}"，但当前实际运行模式是 "${actualMode}"。请先调用 detect_terminal_mode 确认当前模式后再操作。`,
        actualMode,
      })
    }

    const adapter = await createExecutionAdapter()
    if (!adapter.isAvailable()) {
      const connected = await adapter.tryConnect()
      if (!connected) {
        return JSON.stringify({
          ok: false,
          error: actualMode === 'tauri'
            ? 'Tauri 桌面模式终端不可用，请检查桌面环境配置'
            : 'Web 模式终端不可用，请先调用 start_server 启动 worldsmith-server',
          mode: actualMode,
        })
      }
    }

    const script = String(args.script)
    const cwd = args.cwd ? String(args.cwd) : undefined
    const interpreter = args.interpreter ? String(args.interpreter) : undefined
    const env = args.env as Record<string, string> | undefined

    const isWindows = navigator.userAgent.includes('Windows') || navigator.platform.startsWith('Win')
    let command: string
    if (interpreter) {
      command = isWindows
        ? `${interpreter} -Command ${JSON.stringify(script)}`
        : `${interpreter} -c ${JSON.stringify(script)}`
    } else {
      command = isWindows
        ? `powershell.exe -NoLogo -NoProfile -Command ${JSON.stringify(script)}`
        : `bash -c ${JSON.stringify(script)}`
    }

    try {
      const result = await adapter.executeCommand(command, { cwd, timeout: 60000, env })
      return JSON.stringify({
        ok: true,
        mode: actualMode,
        modeLabel: actualMode === 'tauri' ? 'Tauri 桌面模式' : 'Web 应用模式',
        interpreter: interpreter || 'bash',
        stdout: result.stdout || '(脚本已执行，无输出)',
        stderr: result.stderr || '',
        exitCode: result.exitCode,
        timedOut: result.timedOut,
      })
    } catch (err) {
      return JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        mode: actualMode,
      })
    }
  },
}

export const terminalLauncherTools = [detectTerminalModeTool, startServerTool, launchTerminalTool, launchTerminalScriptTool]
