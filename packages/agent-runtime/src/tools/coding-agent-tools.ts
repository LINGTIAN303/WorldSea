/** 编码 Agent 标准工具集：对齐主流编码 Agent 工具接口，详细见 docs/details/注释/packages/agent-runtime/tools-coding-agent-tools.md */

import type { ToolDefinition } from '../bridge-types'
import type { ToolMeta } from '@worldsmith/agent-core'
import type { IToolContext } from '../toolbus/types'
import { createExecutionAdapter, isTauri } from '../execution'
// 任务29/M2：路径边界契约收敛到共享模块（kernel 级 resolver + E1 写保护），本文件不再本地实现
import { resolveWithinWorkspace, resolveWriteWithinWorkspace, shellCommandTouchesProtectedPath, PROTECTED_WRITE_ERROR } from './workspace-boundary'

/** Tauri invoke 缓存 */
let _invoke: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null
async function getTauriInvoke() {
  if (_invoke) return _invoke
  if (!isTauri()) return null
  try {
    const api = await import('@tauri-apps/api/core')
    _invoke = api.invoke
    return _invoke
  } catch {
    return null
  }
}

/** 通用 Shell 命令执行器（Web 模式降级路径） */
async function runCommand(command: string, cwd?: string, timeout = 15000): Promise<string> {
  const adapter = await createExecutionAdapter()
  if (!adapter.isAvailable()) return JSON.stringify({ ok: false, error: 'CLI 工具当前不可用。' })
  try {
    const result = await adapter.executeCommand(command, { cwd, timeout })
    return result.stdout
  } catch (err) {
    return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}

// ── 路径边界（任务29/M2：契约已收敛至 ./workspace-boundary，含 workdir 词法边界 + E1 受保护目录写守卫） ──

// ── read_file ──────────────────────────────────────────────

const readFileTool: ToolDefinition = {
  name: 'read_file',
  description: '读取文件内容。支持通过 offset 和 limit 参数读取文件的指定行范围，适用于大文件分段读取。返回文件内容和行号信息。',
  parameters: {
    path: { type: 'string', description: '文件绝对路径', required: true },
    offset: { type: 'number', description: '起始行号（从1开始，默认1）' },
    limit: { type: 'number', description: '读取行数（默认读取全部，最大500行）' },
    encoding: { type: 'string', description: '编码方式：utf-8（默认）/ base64（二进制文件）' },
  },
  meta: {
    permission: 'safe',
    category: 'coding',
    alwaysAvailable: true,
    aliases: ['fs_read', 'fs_stat', 'file_read'],
    displayName: '读取文件',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    // Phase B 边界：path 归一到工作区内，越界路径拒绝（读类无 workdir 时放行）
    const resolved = resolveWithinWorkspace(ctx, String(args.path))
    if (!resolved.ok) return JSON.stringify({ ok: false, error: resolved.reason, path: String(args.path) })
    const path = resolved.path
    const offset = args.offset ? Number(args.offset) : 1
    const limit = args.limit ? Math.min(Number(args.limit), 500) : 500
    const encoding = String(args.encoding || 'utf-8')

    // Tauri 原生路径
    const invoke = await getTauriInvoke()
    if (invoke) {
      try {
        const content = await invoke('cmd_fs_read', { path, encoding }) as string
        if (encoding === 'base64') return content
        // 按行切片
        const lines = content.split('\n')
        const start = Math.max(offset - 1, 0)
        const end = Math.min(start + limit, lines.length)
        const sliced = lines.slice(start, end)
          .map((line, i) => `${start + i + 1}→${line}`)
          .join('\n')
        return sliced + `\n\n(行 ${start + 1}-${end} / 共 ${lines.length} 行)`
      } catch (err) {
        return JSON.stringify({ ok: false, error: `读取失败: ${err instanceof Error ? err.message : String(err)}` })
      }
    }

    // Web 降级
    const p = path.replace(/"/g, '\\"')
    const enc = encoding === 'base64' ? '' : ''
    return runCommand(`Get-Content -Path "${p}"${enc} -TotalCount ${offset + limit - 1} | Select-Object -Skip ${offset - 1}`, path.replace(/[/\\][^/\\]*$/, ''))
  },
}

// ── write_file ─────────────────────────────────────────────

const writeFileTool: ToolDefinition = {
  name: 'write_file',
  description: '写入或创建文件。将内容完整写入指定路径，若文件已存在则覆盖。需要自动创建父目录时设置 createDirs 为 true。',
  parameters: {
    path: { type: 'string', description: '文件绝对路径', required: true },
    content: { type: 'string', description: '文件内容', required: true },
    createDirs: { type: 'boolean', description: '是否自动创建父目录（默认 true）' },
  },
  meta: {
    permission: 'moderate',
    category: 'coding',
    alwaysAvailable: true,
    aliases: ['fs_write', 'fs_mkdir', 'file_write'],
    displayName: '写入文件',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    // 任务29/M2 边界：写类。无 workdir（旧会话/未绑定）→ 未加固，按计划放行（行为不变）；
    //               有 workdir 时越界 + E1 受保护目录（entities/.worldsmith）由 resolveWriteWithinWorkspace 拒绝
    const resolved = resolveWriteWithinWorkspace(ctx, String(args.path))
    if (!resolved.ok) return JSON.stringify({ ok: false, error: resolved.reason, path: String(args.path) })
    const path = resolved.path
    const content = String(args.content)
    const createDirs = args.createDirs !== false

    const invoke = await getTauriInvoke()
    if (invoke) {
      try {
        await invoke('cmd_fs_write', { path, content, createDirs })
        return JSON.stringify({ ok: true, path, size: content.length, lines: content.split('\n').length })
      } catch (err) {
        return JSON.stringify({ ok: false, error: `写入失败: ${err instanceof Error ? err.message : String(err)}` })
      }
    }

    // Web 降级
    const p = path.replace(/"/g, '\\"')
    const dir = path.replace(/[/\\][^/\\]*$/, '')
    const cmds: string[] = []
    if (createDirs) cmds.push(`New-Item -ItemType Directory -Path "${dir.replace(/"/g, '\\"')}" -Force | Out-Null`)
    const escaped = content.replace(/'/g, "''")
    cmds.push(`Set-Content -Path "${p}" -Value '${escaped}' -Encoding UTF8`)
    return runCommand(cmds.join('; '), dir)
  },
}

// ── edit_file ──────────────────────────────────────────────

const editFileTool: ToolDefinition = {
  name: 'edit_file',
  description: '精确编辑文件：将文件中匹配 old_string 的文本替换为 new_string。这是编辑文件的首选方式，比 write_file 更安全，只修改需要变更的部分。如果 old_string 在文件中出现多次，设置 replace_all 为 true 替换所有匹配，否则只替换第一个匹配。old_string 必须与文件中的文本精确匹配（包括缩进和空行）。',
  parameters: {
    path: { type: 'string', description: '文件绝对路径', required: true },
    old_string: { type: 'string', description: '要替换的原始文本（必须精确匹配文件中的内容）', required: true },
    new_string: { type: 'string', description: '替换后的文本', required: true },
    replace_all: { type: 'boolean', description: '是否替换所有匹配（默认 false，仅替换第一个匹配）' },
  },
  meta: {
    permission: 'moderate',
    category: 'coding',
    alwaysAvailable: true,
    displayName: '编辑文件',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    // 任务29/M2 边界：写类。无 workdir（旧会话/未绑定）→ 未加固，按计划放行；越界 + E1 受保护目录拒绝
    const resolved = resolveWriteWithinWorkspace(ctx, String(args.path))
    if (!resolved.ok) return JSON.stringify({ ok: false, error: resolved.reason, path: String(args.path) })
    const path = resolved.path
    const oldString = String(args.old_string)
    const newString = String(args.new_string)
    const replaceAll = !!args.replace_all

    if (!oldString) {
      return JSON.stringify({ ok: false, error: 'old_string 不能为空' })
    }

    // 读取文件内容
    const invoke = await getTauriInvoke()
    let content: string
    try {
      if (invoke) {
        content = await invoke('cmd_fs_read', { path, encoding: 'utf-8' }) as string
      } else {
        const p = path.replace(/"/g, '\\"')
        const result = await runCommand(`Get-Content -Path "${p}" -Raw`, path.replace(/[/\\][^/\\]*$/, ''))
        content = result
      }
    } catch (err) {
      return JSON.stringify({ ok: false, error: `读取文件失败: ${err instanceof Error ? err.message : String(err)}` })
    }

    // 检查匹配
    if (!content.includes(oldString)) {
      // 提供上下文帮助定位
      const lines = content.split('\n')
      const firstLine = oldString.split('\n')[0]
      const matchIdx = lines.findIndex(l => l.trim() === firstLine.trim())
      let hint = ''
      if (matchIdx >= 0) {
        hint = `\n提示：第 ${matchIdx + 1} 行有相似内容但缩进/空格不匹配：\n  ${lines[matchIdx]}`
      }
      return JSON.stringify({
        ok: false,
        error: `未找到匹配的文本。请确保 old_string 与文件内容精确匹配（包括缩进和空行）。${hint}`,
        path,
      })
    }

    // 检查多重匹配
    if (!replaceAll) {
      const firstIdx = content.indexOf(oldString)
      const secondIdx = content.indexOf(oldString, firstIdx + 1)
      if (secondIdx !== -1) {
        return JSON.stringify({
          ok: false,
          error: `old_string 在文件中出现多次。请提供更多上下文使匹配唯一，或设置 replace_all 为 true。`,
          path,
          match_count: content.split(oldString).length - 1,
        })
      }
    }

    // 执行替换
    const newContent = replaceAll
      ? content.split(oldString).join(newString)
      : content.replace(oldString, newString)

    // 写回文件
    try {
      if (invoke) {
        await invoke('cmd_fs_write', { path, content: newContent, createDirs: false })
      } else {
        const p = path.replace(/"/g, '\\"')
        const dir = path.replace(/[/\\][^/\\]*$/, '')
        const escaped = newContent.replace(/'/g, "''")
        await runCommand(`Set-Content -Path "${p}" -Value '${escaped}' -Encoding UTF8`, dir)
      }
    } catch (err) {
      return JSON.stringify({ ok: false, error: `写入文件失败: ${err instanceof Error ? err.message : String(err)}` })
    }

    // 计算变更统计
    const oldLines = oldString.split('\n').length
    const newLines = newString.split('\n').length
    return JSON.stringify({
      ok: true,
      path,
      replaced: replaceAll ? (content.split(oldString).length - 1) : 1,
      old_lines: oldLines,
      new_lines: newLines,
    })
  },
}

// ── search_files ───────────────────────────────────────────

const searchFilesTool: ToolDefinition = {
  name: 'search_files',
  description: '搜索文件。支持两种模式：按文件名模式搜索（glob）和按文件内容搜索（content）。按文件名搜索时 pattern 为 glob 模式（如 "*.ts"、"src/**/*.vue"），按内容搜索时 pattern 为搜索关键词或正则表达式。',
  parameters: {
    path: { type: 'string', description: '搜索根目录', required: true },
    pattern: { type: 'string', description: '搜索模式：glob 模式或搜索关键词', required: true },
    type: { type: 'string', description: '搜索类型：glob（按文件名，默认）或 content（按内容）' },
    max_results: { type: 'number', description: '最大结果数（默认30）' },
  },
  meta: {
    permission: 'safe',
    category: 'coding',
    alwaysAvailable: true,
    aliases: ['fs_search', 'content_search'],
    displayName: '搜索文件',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    // Phase B 边界：搜索类。path 归一到工作区内，越界拒绝（无 workdir 时放行）
    const resolved = resolveWithinWorkspace(ctx, String(args.path))
    if (!resolved.ok) return JSON.stringify({ ok: false, error: resolved.reason, path: String(args.path) })
    const path = resolved.path
    const pattern = String(args.pattern)
    const searchType = String(args.type || 'glob')
    const maxResults = args.max_results ? Number(args.max_results) : 30

    const invoke = await getTauriInvoke()
    if (invoke) {
      try {
        const entries = await invoke('cmd_fs_search', { path, pattern, searchType }) as Array<{
          name: string; path: string; isDir: boolean; size: number; modified: string | null
        }>
        const limited = entries.slice(0, maxResults)
        return JSON.stringify({ ok: true, results: limited, total: entries.length, showing: limited.length, search_type: searchType })
      } catch (err) {
        return JSON.stringify({ ok: false, error: `搜索失败: ${err instanceof Error ? err.message : String(err)}` })
      }
    }

    // Web 降级
    const p = path.replace(/"/g, '\\"')
    const pat = pattern.replace(/"/g, '\\"')
    if (searchType === 'content') {
      return runCommand(`Get-ChildItem -Path "${p}" -Recurse -File | Select-String -Pattern "${pat}" | Select-Object -First ${maxResults} Path, LineNumber, Line`, path)
    }
    return runCommand(`Get-ChildItem -Path "${p}" -Recurse -Filter "${pat}" | Select-Object -First ${maxResults} FullName, Length, LastWriteTime`, path)
  },
}

// ── list_directory ─────────────────────────────────────────

const listDirectoryTool: ToolDefinition = {
  name: 'list_directory',
  description: '列出目录内容。返回文件和子目录列表，含大小和修改时间。设置 recursive 为 true 可递归列出子目录内容。',
  parameters: {
    path: { type: 'string', description: '目录绝对路径', required: true },
    recursive: { type: 'boolean', description: '是否递归列出子目录（默认 false）' },
  },
  meta: {
    permission: 'safe',
    category: 'coding',
    alwaysAvailable: true,
    aliases: ['fs_list', 'file_list'],
    displayName: '列出目录',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    // Phase B 边界：path 归一到工作区内，越界拒绝（读类无 workdir 时放行）
    const resolved = resolveWithinWorkspace(ctx, String(args.path))
    if (!resolved.ok) return JSON.stringify({ ok: false, error: resolved.reason, path: String(args.path) })
    const path = resolved.path
    const recursive = !!args.recursive

    const invoke = await getTauriInvoke()
    if (invoke) {
      try {
        const entries = await invoke('cmd_fs_list', { path, recursive }) as Array<{
          name: string; path: string; isDir: boolean; size: number; modified: string | null
        }>
        return JSON.stringify({ ok: true, entries, total: entries.length })
      } catch (err) {
        return JSON.stringify({ ok: false, error: `列出目录失败: ${err instanceof Error ? err.message : String(err)}` })
      }
    }

    // Web 降级
    const p = path.replace(/"/g, '\\"')
    const rec = recursive ? ' -Recurse' : ''
    return runCommand(`Get-ChildItem -Path "${p}"${rec} | Select-Object Mode, LastWriteTime, Length, Name | Format-Table -AutoSize`, path)
  },
}

// ── execute_command ────────────────────────────────────────

const executeCommandTool: ToolDefinition = {
  name: 'execute_command',
  description: '在本地终端执行 shell 命令并返回输出。支持通过 env 参数注入环境变量。适用于一次性命令执行，如需保持上下文状态请使用 shell_session 工具。',
  parameters: {
    command: { type: 'string', description: '要执行的 shell 命令', required: true },
    cwd: { type: 'string', description: '工作目录（可选，默认项目根目录）' },
    env: { type: 'object', description: '环境变量（可选，如 {"PATH": "/usr/bin", "HOME": "/home/user"}）' },
  },
  meta: {
    permission: 'dangerous',
    category: 'coding',
    alwaysAvailable: true,
    aliases: ['fs_copy', 'fs_move', 'fs_delete', 'file_delete'],
    dangerousPatterns: [
      /rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+|.*--no-preserve-root)/,
      /sudo\s+/,
      /format\s+[a-zA-Z]:/i,
      /dd\s+if=/,
      /:\(\)\{\s*:\|:\&\s*\}\s*;/,
      /shutdown|reboot/i,
      /chmod\s+(-R\s+)?777/,
      /curl\s+.*\|\s*(ba)?sh/,
      /reg\s+delete\s+/i,
      /bcdedit\s+/i,
      /net\s+user\s+/i,
      /netsh\s+advfirewall\s+/i,
      /rd\s+\/[sS]\s+[a-zA-Z]:\\/i,
      /del\s+\/[fFqQsS]+\s+/i,
      /powershell.*(?:Remove-Item|Delete-File)/i,
    ],
    displayName: '执行命令',
  } satisfies ToolMeta,
  execute: async (args: Record<string, unknown>, ctx: IToolContext): Promise<string> => {
    const adapter = await createExecutionAdapter()
    if (!adapter.isAvailable()) {
      const connected = await adapter.tryConnect()
      if (!connected) {
        return '终端功能当前不可用。Tauri 桌面模式请确认环境正常，Web 模式请启动 worldsmith-server 服务。'
      }
    }

    const command = String(args.command)
    // 任务29/M4 E1 盲区词法防护：命令串同现写操作词与受保护目录字样 → 拒绝并引导语义层
    //（非完备：变量间接/别名可绕过，定位=拦常见误操作，见 workspace-boundary 模块注释）
    if (ctx.workspace?.workdir && shellCommandTouchesProtectedPath(ctx.workspace.workdir, command)) {
      return JSON.stringify({ ok: false, error: PROTECTED_WRITE_ERROR, command })
    }
    // cwd 缺省 = 工作区 workdir（有 workdir 时）；无 workdir 用 args.cwd 或 undefined（未加固，放行）。
    // 显式传入 cwd 且 workdir 存在时做边界校验，越界拒绝。
    let cwd: string | undefined = ctx.workspace?.workdir ?? (args.cwd ? String(args.cwd) : undefined)
    if (args.cwd && ctx.workspace?.workdir) {
      const resolvedCwd = resolveWithinWorkspace(ctx, String(args.cwd))
      if (!resolvedCwd.ok) {
        return JSON.stringify({ ok: false, error: resolvedCwd.reason, cwd: String(args.cwd), command })
      }
      cwd = resolvedCwd.path
    }
    const env = args.env as Record<string, string> | undefined

    try {
      const result = await adapter.executeCommand(command, { cwd, timeout: 30000, env })
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

// ── shell_session ──────────────────────────────────────────

const shellSessionTool: ToolDefinition = {
  name: 'shell_session',
  description: '持久化 Shell 会话管理。支持子命令：detect（检测可用Shell）、create（创建会话）、exec（在会话中执行命令）、input（发送交互式输入）、destroy（销毁会话）、list（列出活跃会话）。会话保持 Shell 进程活跃，工作目录和环境变量在命令间保持，适用于需要连续执行多条命令的场景。',
  parameters: {
    action: { type: 'string', description: '子命令：detect / create / exec / input / destroy / list', required: true },
    session_id: { type: 'string', description: '会话 ID（exec/input/destroy 时必填）' },
    command: { type: 'string', description: '要执行的命令（exec 时必填）' },
    data: { type: 'string', description: '交互式输入内容（input 时必填）' },
    shell: { type: 'string', description: 'Shell 类型路径（create 时可选，默认自动选择）' },
    cwd: { type: 'string', description: '初始工作目录（create 时可选）' },
    env: { type: 'object', description: '环境变量（create 时可选）' },
    timeout_ms: { type: 'number', description: '超时时间毫秒（exec 时可选，默认30000）' },
  },
  meta: {
    permission: 'moderate',
    category: 'coding',
    alwaysAvailable: true,
    aliases: ['detect_shells', 'shell_session_create', 'shell_session_exec', 'shell_session_input', 'shell_session_destroy', 'shell_session_list'],
    subCommandPermissions: {
      detect: 'safe',
      list: 'safe',
      create: 'moderate',
      exec: 'moderate',
      input: 'moderate',
      destroy: 'dangerous',
    },
    dangerousPatterns: [
      /rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+|.*--no-preserve-root)/,
      /sudo\s+/,
      /format\s+[a-zA-Z]:/i,
      /dd\s+if=/,
      /shutdown|reboot/i,
      /chmod\s+(-R\s+)?777/,
      /curl\s+.*\|\s*(ba)?sh/,
      /reg\s+delete\s+/i,
      /bcdedit\s+/i,
      /net\s+user\s+/i,
      /powershell.*(?:Remove-Item|Delete-File)/i,
    ],
    displayName: 'Shell 会话',
  } satisfies ToolMeta,
  execute: async (args: Record<string, unknown>, ctx: IToolContext): Promise<string> => {
    const action = String(args.action || '')
    const adapter = await createExecutionAdapter()

    switch (action) {
      case 'detect': {
        try {
          const shells = await adapter.detectShells()
          if (shells.length === 0) {
            return JSON.stringify({ error: '未检测到可用 Shell' })
          }
          return JSON.stringify({
            shells: shells.map(s => ({ id: s.id, name: s.name, path: s.path, is_default: s.is_default })),
            hint: '使用 shell_session(action="create") 创建会话时，shell 参数传入 path 值',
          })
        } catch (err) {
          return JSON.stringify({ error: `Shell 检测失败: ${err instanceof Error ? err.message : String(err)}` })
        }
      }

      case 'create': {
        if (!adapter.isAvailable()) {
          const connected = await adapter.tryConnect()
          if (!connected) return JSON.stringify({ ok: false, error: '终端功能当前不可用' })
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
            hint: `会话已创建。使用 shell_session(action="exec", session_id="${info.id}", command="...") 执行命令。`,
          })
        } catch (err) {
          return JSON.stringify({ ok: false, error: `会话创建失败: ${err instanceof Error ? err.message : String(err)}` })
        }
      }

      case 'exec': {
        const sessionId = String(args.session_id || '')
        const command = String(args.command || '')
        const timeoutMs = args.timeout_ms ? Number(args.timeout_ms) : undefined
        if (!sessionId || !command) {
          return JSON.stringify({ ok: false, error: 'session_id 和 command 为必填参数' })
        }
        // 任务29/M4 E1 盲区词法防护：与 execute_command 同规则（写操作词 × 受保护目录字样）
        if (ctx.workspace?.workdir && shellCommandTouchesProtectedPath(ctx.workspace.workdir, command)) {
          return JSON.stringify({ ok: false, error: PROTECTED_WRITE_ERROR, command })
        }
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
            hint: '会话可能已过期，请使用 shell_session(action="create") 创建新会话',
          })
        }
      }

      case 'input': {
        const sessionId = String(args.session_id || '')
        const data = String(args.data || '')
        if (!sessionId || !data) {
          return JSON.stringify({ ok: false, error: 'session_id 和 data 为必填参数' })
        }
        try {
          await adapter.sendInput(sessionId, data)
          return JSON.stringify({ ok: true, session_id: sessionId, hint: '输入已发送，使用 exec 查看后续输出' })
        } catch (err) {
          return JSON.stringify({ ok: false, error: `输入发送失败: ${err instanceof Error ? err.message : String(err)}` })
        }
      }

      case 'destroy': {
        const sessionId = String(args.session_id || '')
        if (!sessionId) {
          return JSON.stringify({ ok: false, error: 'session_id 为必填参数' })
        }
        try {
          await adapter.destroySession(sessionId)
          return JSON.stringify({ ok: true, session_id: sessionId, message: '会话已销毁' })
        } catch (err) {
          return JSON.stringify({ ok: false, error: `销毁失败: ${err instanceof Error ? err.message : String(err)}` })
        }
      }

      case 'list': {
        try {
          const sessions = await adapter.listSessions()
          return JSON.stringify({ ok: true, sessions, count: sessions.length })
        } catch (err) {
          return JSON.stringify({ ok: false, error: `查询失败: ${err instanceof Error ? err.message : String(err)}` })
        }
      }

      default:
        return JSON.stringify({ ok: false, error: `未知子命令: "${action}"。可用: detect / create / exec / input / destroy / list` })
    }
  },
}

// ── web_search / web_fetch ─────────────────────────────────
// 直接复用现有实现，不重新包装
import { webSearchTool } from './web-search'
import { webFetchTool } from './web-fetch'

// ── 导出 ───────────────────────────────────────────────────

export const codingAgentTools: ToolDefinition[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  searchFilesTool,
  listDirectoryTool,
  executeCommandTool,
  shellSessionTool,
  webSearchTool,
  webFetchTool,
]

/**
 * 编码 Agent 标准工具名列表
 *
 * 这些工具名用于技能注册表的 allowedTools 和 ALWAYS_AVAILABLE_TOOLS，
 * 替代旧的 fs_read/fs_write/... 等碎片化工具名。
 */
export const CODING_AGENT_TOOL_NAMES = codingAgentTools.map(t => t.name)

/**
 * 旧工具名 → 编码 Agent 标准工具名的映射
 *
 * 用于在技能注册表中自动迁移旧工具引用。
 */
export const LEGACY_TO_CODING_MAP: Record<string, string> = {
  fs_read: 'read_file',
  fs_write: 'write_file',
  fs_list: 'list_directory',
  fs_search: 'search_files',
  fs_stat: 'read_file',   // stat 信息通过 read_file 获取
  fs_mkdir: 'write_file',  // 创建目录通过 write_file(createDirs=true) 实现
  fs_copy: 'execute_command', // 复制通过命令实现
  fs_move: 'execute_command', // 移动通过命令实现
  fs_delete: 'execute_command', // 删除通过命令实现
  detect_shells: 'shell_session',
  shell_session_create: 'shell_session',
  shell_session_exec: 'shell_session',
  shell_session_input: 'shell_session',
  shell_session_destroy: 'shell_session',
  shell_session_list: 'shell_session',
  content_search: 'search_files',
  file_read: 'read_file',
  file_write: 'write_file',
  file_list: 'list_directory',
  file_delete: 'execute_command',
}
