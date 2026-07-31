/**
 * 本地文件系统工具集
 *
 * 双模式实现：
 * - Tauri 桌面模式：优先使用 Tauri 原生命令（cmd_fs_*），无需 PowerShell 中间层
 * - Web 模式：降级到 PowerShell/Shell 命令通过终端适配器执行
 *
 * 工具: fs_read / fs_write / fs_list / fs_move / fs_delete / fs_search / fs_stat / fs_mkdir / fs_copy
 */

import type { ToolDefinition } from '../bridge-types'
import { createExecutionAdapter, isTauri } from '../execution'

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
  if (!adapter.isAvailable()) return JSON.stringify({ ok: false, error: 'CLI 工具当前不可用。Tauri 桌面模式请确认环境正常，Web 模式请启动 worldsmith-server 服务。' })
  try {
    const result = await adapter.executeCommand(command, { cwd, timeout })
    return result.stdout
  } catch (err) {
    return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}

// ── fs_read ──────────────────────────────────────────────

const fsReadTool: ToolDefinition = {
  name: 'fs_read',
  description: '读取本地文件内容。支持文本和二进制文件（encoding=base64 时返回 base64）。仅用于读取项目工作区外的文件，项目内文件请使用 file_read 工具。',
  parameters: {
    path: { type: 'string', description: '文件绝对路径', required: true },
    encoding: { type: 'string', description: '编码方式：utf-8（默认）/ base64（二进制文件）' },
  },
  execute: async (args, _ctx) => {
    const path = String(args.path)
    const encoding = String(args.encoding || 'utf-8')

    // Tauri 原生路径
    const invoke = await getTauriInvoke()
    if (invoke) {
      try {
        const content = await invoke('cmd_fs_read', { path, encoding }) as string
        return content
      } catch (err) {
        return JSON.stringify({ ok: false, error: `Tauri 原生读取失败: ${err instanceof Error ? err.message : String(err)}`, fallback: true })
      }
    }

    // Web 降级：PowerShell
    const p = path.replace(/"/g, '\\"')
    const enc = encoding === 'base64' ? '' : (encoding !== 'utf-8' ? ` -Encoding ${encoding}` : '')
    return runCommand(`Get-Content -Path "${p}"${enc} -Raw`, path.replace(/[/\\][^/\\]*$/, ''))
  },
}

// ── fs_write ─────────────────────────────────────────────

const fsWriteTool: ToolDefinition = {
  name: 'fs_write',
  description: '写入或创建本地文件。仅用于项目工作区外的文件操作，项目内文件请使用内驱工具。',
  parameters: {
    path: { type: 'string', description: '文件绝对路径', required: true },
    content: { type: 'string', description: '文件内容', required: true },
    createDirs: { type: 'boolean', description: '是否自动创建父目录' },
  },
  execute: async (args, _ctx) => {
    const path = String(args.path)
    const content = String(args.content)
    const createDirs = !!args.createDirs

    // Tauri 原生路径
    const invoke = await getTauriInvoke()
    if (invoke) {
      try {
        await invoke('cmd_fs_write', { path, content, createDirs })
        return JSON.stringify({ ok: true, path, size: content.length })
      } catch (err) {
        return JSON.stringify({ ok: false, error: `Tauri 原生写入失败: ${err instanceof Error ? err.message : String(err)}`, fallback: true })
      }
    }

    // Web 降级：PowerShell
    const p = path.replace(/"/g, '\\"')
    const dir = path.replace(/[/\\][^/\\]*$/, '')
    const cmds: string[] = []
    if (createDirs) cmds.push(`New-Item -ItemType Directory -Path "${dir.replace(/"/g, '\\"')}" -Force | Out-Null`)
    const escaped = content.replace(/'/g, "''")
    cmds.push(`Set-Content -Path "${p}" -Value '${escaped}' -Encoding UTF8`)
    return runCommand(cmds.join('; '), dir)
  },
}

// ── fs_list ──────────────────────────────────────────────

const fsListTool: ToolDefinition = {
  name: 'fs_list',
  description: '列出本地目录内容。返回文件和子目录列表，含大小和修改时间。',
  parameters: {
    path: { type: 'string', description: '目录绝对路径', required: true },
    recursive: { type: 'boolean', description: '是否递归列出子目录' },
  },
  execute: async (args, _ctx) => {
    const path = String(args.path)
    const recursive = !!args.recursive

    // Tauri 原生路径
    const invoke = await getTauriInvoke()
    if (invoke) {
      try {
        const entries = await invoke('cmd_fs_list', { path, recursive }) as Array<{
          name: string; path: string; isDir: boolean; size: number; modified: string | null
        }>
        return JSON.stringify({ ok: true, entries, total: entries.length })
      } catch (err) {
        return JSON.stringify({ ok: false, error: `Tauri 原生列表失败: ${err instanceof Error ? err.message : String(err)}`, fallback: true })
      }
    }

    // Web 降级：PowerShell
    const p = path.replace(/"/g, '\\"')
    const rec = recursive ? ' -Recurse' : ''
    return runCommand(`Get-ChildItem -Path "${p}"${rec} | Select-Object Mode, LastWriteTime, Length, Name | Format-Table -AutoSize`, path)
  },
}

// ── fs_stat ──────────────────────────────────────────────

const fsStatTool: ToolDefinition = {
  name: 'fs_stat',
  description: '获取文件或目录的元数据（大小、修改时间、权限等）。',
  parameters: {
    path: { type: 'string', description: '文件/目录绝对路径', required: true },
  },
  execute: async (args, _ctx) => {
    const path = String(args.path)

    // Tauri 原生路径
    const invoke = await getTauriInvoke()
    if (invoke) {
      try {
        const stat = await invoke('cmd_fs_stat', { path }) as {
          exists: boolean; isDir: boolean; isFile: boolean; size: number;
          modified: string | null; created: string | null; readonly: boolean
        }
        return JSON.stringify({ ok: true, ...stat })
      } catch (err) {
        return JSON.stringify({ ok: false, error: `Tauri 原生 stat 失败: ${err instanceof Error ? err.message : String(err)}` })
      }
    }

    // Web 降级：PowerShell
    const p = path.replace(/"/g, '\\"')
    return runCommand(`Get-Item -Path "${p}" | Select-Object FullName, Length, LastWriteTime, CreationTime, Attributes | Format-List`, path.replace(/[/\\][^/\\]*$/, ''))
  },
}

// ── fs_mkdir ─────────────────────────────────────────────

const fsMkdirTool: ToolDefinition = {
  name: 'fs_mkdir',
  description: '创建目录。支持递归创建父目录。',
  parameters: {
    path: { type: 'string', description: '目录绝对路径', required: true },
    recursive: { type: 'boolean', description: '是否递归创建父目录（默认 true）' },
  },
  execute: async (args, _ctx) => {
    const path = String(args.path)
    const recursive = args.recursive !== false

    // Tauri 原生路径
    const invoke = await getTauriInvoke()
    if (invoke) {
      try {
        await invoke('cmd_fs_mkdir', { path, recursive })
        return JSON.stringify({ ok: true, path })
      } catch (err) {
        return JSON.stringify({ ok: false, error: `Tauri 原生 mkdir 失败: ${err instanceof Error ? err.message : String(err)}` })
      }
    }

    // Web 降级：PowerShell
    const p = path.replace(/"/g, '\\"')
    return runCommand(`New-Item -ItemType Directory -Path "${p}" -Force | Out-Null`, path)
  },
}

// ── fs_copy ──────────────────────────────────────────────

const fsCopyTool: ToolDefinition = {
  name: 'fs_copy',
  description: '复制文件或目录。目录将递归复制。',
  parameters: {
    source: { type: 'string', description: '源路径', required: true },
    destination: { type: 'string', description: '目标路径', required: true },
  },
  execute: async (args, _ctx) => {
    const source = String(args.source)
    const destination = String(args.destination)

    // Tauri 原生路径
    const invoke = await getTauriInvoke()
    if (invoke) {
      try {
        await invoke('cmd_fs_copy', { source, destination })
        return JSON.stringify({ ok: true, source, destination })
      } catch (err) {
        return JSON.stringify({ ok: false, error: `Tauri 原生复制失败: ${err instanceof Error ? err.message : String(err)}` })
      }
    }

    // Web 降级：PowerShell
    const s = source.replace(/"/g, '\\"')
    const d = destination.replace(/"/g, '\\"')
    return runCommand(`Copy-Item -Path "${s}" -Destination "${d}" -Recurse -Force`, source.replace(/[/\\][^/\\]*$/, ''))
  },
}

// ── fs_move ──────────────────────────────────────────────

const fsMoveTool: ToolDefinition = {
  name: 'fs_move',
  description: '移动或重命名文件/目录。',
  parameters: {
    source: { type: 'string', description: '源路径', required: true },
    destination: { type: 'string', description: '目标路径', required: true },
  },
  execute: async (args, _ctx) => {
    const source = String(args.source)
    const destination = String(args.destination)

    // Tauri 原生路径
    const invoke = await getTauriInvoke()
    if (invoke) {
      try {
        await invoke('cmd_fs_rename', { source, destination })
        return JSON.stringify({ ok: true, source, destination })
      } catch (err) {
        return JSON.stringify({ ok: false, error: `Tauri 原生移动失败: ${err instanceof Error ? err.message : String(err)}` })
      }
    }

    // Web 降级：PowerShell
    const s = source.replace(/"/g, '\\"')
    const d = destination.replace(/"/g, '\\"')
    return runCommand(`Move-Item -Path "${s}" -Destination "${d}"`, source.replace(/[/\\][^/\\]*$/, ''))
  },
}

// ── fs_delete ────────────────────────────────────────────

const fsDeleteTool: ToolDefinition = {
  name: 'fs_delete',
  description: '删除本地文件或目录。此操作不可逆，请谨慎使用。',
  parameters: {
    path: { type: 'string', description: '要删除的文件/目录路径', required: true },
    recursive: { type: 'boolean', description: '是否递归删除目录' },
  },
  execute: async (args, _ctx) => {
    const path = String(args.path)
    const recursive = !!args.recursive

    // Tauri 原生路径
    const invoke = await getTauriInvoke()
    if (invoke) {
      try {
        await invoke('cmd_fs_delete', { path, recursive })
        return JSON.stringify({ ok: true, path })
      } catch (err) {
        return JSON.stringify({ ok: false, error: `Tauri 原生删除失败: ${err instanceof Error ? err.message : String(err)}` })
      }
    }

    // Web 降级：PowerShell
    const p = path.replace(/"/g, '\\"')
    const rec = recursive ? ' -Recurse -Force' : ''
    return runCommand(`Remove-Item -Path "${p}"${rec}`, path.replace(/[/\\][^/\\]*$/, ''))
  },
}

// ── fs_search ────────────────────────────────────────────

const fsSearchTool: ToolDefinition = {
  name: 'fs_search',
  description: '搜索本地文件。支持按文件名模式（glob）或文件内容（content）搜索。',
  parameters: {
    path: { type: 'string', description: '搜索根目录', required: true },
    pattern: { type: 'string', description: '搜索模式', required: true },
    type: { type: 'string', description: '搜索类型：glob（按文件名）或 content（按内容）' },
  },
  execute: async (args, _ctx) => {
    const path = String(args.path)
    const pattern = String(args.pattern)
    const searchType = String(args.type || 'glob')

    // Tauri 原生路径
    const invoke = await getTauriInvoke()
    if (invoke) {
      try {
        const entries = await invoke('cmd_fs_search', { path, pattern, searchType }) as Array<{
          name: string; path: string; isDir: boolean; size: number; modified: string | null
        }>
        return JSON.stringify({ ok: true, entries, total: entries.length, searchType })
      } catch (err) {
        return JSON.stringify({ ok: false, error: `Tauri 原生搜索失败: ${err instanceof Error ? err.message : String(err)}`, fallback: true })
      }
    }

    // Web 降级：PowerShell
    const p = path.replace(/"/g, '\\"')
    const pat = pattern.replace(/"/g, '\\"')
    if (searchType === 'content') {
      return runCommand(`Get-ChildItem -Path "${p}" -Recurse -File | Select-String -Pattern "${pat}" | Select-Object -First 20 Path, LineNumber, Line`, path)
    }
    return runCommand(`Get-ChildItem -Path "${p}" -Recurse -Filter "${pat}" | Select-Object -First 30 FullName, Length, LastWriteTime`, path)
  },
}

export const fsTools = [
  fsReadTool, fsWriteTool, fsListTool, fsStatTool, fsMkdirTool,
  fsCopyTool, fsMoveTool, fsDeleteTool, fsSearchTool,
]
