/**
 * 系统信息工具集
 *
 * 通过 PowerShell 命令查看系统信息。
 * 所有命令依赖 createExecutionAdapter() 的终端适配器。
 *
 * 工具: sys_info / sys_processes / sys_disk
 */

import type { ToolDefinition } from '../bridge-types'
import type { ToolMeta } from '@worldsmith/agent-core'
import { createExecutionAdapter } from '../execution'

/** 通用命令执行器 */
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

/** sys_info — 查看系统信息：os（硬件/系统）/ env（环境变量）/ runtime（运行时版本） */
const sysInfoTool: ToolDefinition = {
  name: 'sys_info',
  description: '查看系统信息。支持操作系统信息、环境变量、运行时版本。',
  parameters: {
    category: { type: 'string', description: '信息类别：os/env/runtime，默认 os' },
  },
  meta: {
    permission: 'safe',
    category: 'dev',
    alwaysAvailable: true,
    displayName: '系统信息',
  } satisfies ToolMeta,
  execute: async (args, _ctx) => {
    const cat = String(args.category || 'os')
    switch (cat) {
      case 'env': return runCommand('Get-ChildItem Env: | Format-Table Name, Value -AutoSize')
      case 'runtime': return runCommand('$PSVersionTable; node --version; npm --version; python --version 2>&1; rustc --version 2>&1; cargo --version 2>&1')
      default: return runCommand('Get-ComputerInfo | Select-Object OsName, OsVersion, OsArchitecture, CsTotalPhysicalMemory, CsNumberOfProcessors | Format-List')
    }
  },
}

/** sys_processes — 查看进程列表，支持按进程名筛选 */
const sysProcessesTool: ToolDefinition = {
  name: 'sys_processes',
  description: '查看运行中的进程列表。',
  parameters: {
    filter: { type: 'string', description: '进程名筛选关键词' },
  },
  meta: {
    permission: 'safe',
    category: 'dev',
    alwaysAvailable: true,
    displayName: '进程列表',
  } satisfies ToolMeta,
  execute: async (args, _ctx) => {
    const filter = args.filter ? ` | Where-Object { $_.ProcessName -like "*${String(args.filter).replace(/"/g, '')}*" }` : ''
    return runCommand(`Get-Process${filter} | Select-Object -First 30 Id, ProcessName, CPU, WorkingSet64, StartTime | Format-Table -AutoSize`)
  },
}

/** sys_disk — 查看磁盘使用情况，支持指定盘符 */
const sysDiskTool: ToolDefinition = {
  name: 'sys_disk',
  description: '查看磁盘使用情况。',
  parameters: {
    path: { type: 'string', description: '指定路径的磁盘，默认所有磁盘' },
  },
  meta: {
    permission: 'safe',
    category: 'dev',
    alwaysAvailable: true,
    displayName: '磁盘信息',
  } satisfies ToolMeta,
  execute: async (args, _ctx) => {
    if (args.path) {
      const p = String(args.path).replace(/"/g, '\\"')
      return runCommand(`Get-PSDrive -Name "${p.substring(0,1)}" | Format-Table Name, Used, Free, @{N="Total";E={$_.Used+$_.Free}} -AutoSize`)
    }
    return runCommand('Get-PSDrive -PSProvider FileSystem | Format-Table Name, Used, Free, @{N="Total";E={$_.Used+$_.Free}} -AutoSize')
  },
}

export const sysTools = [sysInfoTool, sysProcessesTool, sysDiskTool]
