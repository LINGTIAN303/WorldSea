/**
 * Git 操作工具集
 *
 * 通过终端执行 git 命令，提供版本控制操作。
 * 所有命令依赖 createExecutionAdapter() 的终端适配器。
 *
 * 工具: git_status / git_log / git_diff / git_commit / git_branch
 */

import type { ToolDefinition } from '../bridge-types'
import { createExecutionAdapter } from '../execution'

/** 通用命令执行器：创建终端适配器 → 执行命令 → 返回 stdout 或错误 */
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

/** git_status — 查看仓库状态 */
const gitStatusTool: ToolDefinition = {
  name: 'git_status',
  description: '查看 Git 仓库状态。显示工作区变更、暂存区文件、当前分支等信息。',
  parameters: {
    path: { type: 'string', description: '仓库路径，默认当前目录' },
  },
  execute: async (args, _ctx) => runCommand('git status', String(args.path || '.')),
}

/** git_log — 查看提交历史，支持按数量和作者筛选 */
const gitLogTool: ToolDefinition = {
  name: 'git_log',
  description: '查看 Git 提交历史。',
  parameters: {
    path: { type: 'string', description: '仓库路径' },
    count: { type: 'number', description: '显示条数，默认 10' },
    author: { type: 'string', description: '按作者筛选' },
    branch: { type: 'string', description: '按分支筛选' },
  },
  execute: async (args, _ctx) => {
    const n = Number(args.count || 10)
    const author = args.author ? ` --author="${String(args.author).replace(/"/g, '\\"')}"` : ''
    const branch = args.branch ? ` ${String(args.branch).replace(/"/g, '\\"')}` : ''
    return runCommand(`git log --oneline -${n}${author}${branch}`, String(args.path || '.'))
  },
}

/** git_diff — 查看变更差异，支持 staged 和指定文件 */
const gitDiffTool: ToolDefinition = {
  name: 'git_diff',
  description: '查看 Git 变更差异。',
  parameters: {
    path: { type: 'string', description: '仓库路径' },
    staged: { type: 'boolean', description: '查看暂存区差异（--staged）' },
    file: { type: 'string', description: '指定文件路径' },
  },
  execute: async (args, _ctx) => {
    const staged = args.staged ? ' --staged' : ''
    const file = args.file ? ` -- "${String(args.file).replace(/"/g, '\\"')}"` : ''
    return runCommand(`git diff${staged}${file}`, String(args.path || '.'))
  },
}

/** git_commit — 提交变更，可选 add all */
const gitCommitTool: ToolDefinition = {
  name: 'git_commit',
  description: '提交 Git 变更。会自动 add 指定文件或全部变更。',
  parameters: {
    message: { type: 'string', description: '提交信息', required: true },
    path: { type: 'string', description: '仓库路径' },
    addAll: { type: 'boolean', description: '是否添加所有变更（git add -A）' },
  },
  execute: async (args, _ctx) => {
    const msg = String(args.message).replace(/"/g, '\\"')
    const addCmd = args.addAll ? 'git add -A; ' : ''
    return runCommand(`${addCmd}git commit -m "${msg}"`, String(args.path || '.'))
  },
}

/** git_branch — 分支操作：list/create/switch/merge */
const gitBranchTool: ToolDefinition = {
  name: 'git_branch',
  description: 'Git 分支操作：列出、创建、切换、合并分支。',
  parameters: {
    action: { type: 'string', description: '操作类型：list/create/switch/merge', required: true },
    name: { type: 'string', description: '分支名称（create/switch/merge 时必填）' },
    path: { type: 'string', description: '仓库路径' },
  },
  execute: async (args, _ctx) => {
    const action = String(args.action)
    const name = args.name ? String(args.name).replace(/"/g, '\\"') : ''
    const cwd = String(args.path || '.')
    switch (action) {
      case 'create': return runCommand(`git checkout -b "${name}"`, cwd)
      case 'switch': return runCommand(`git checkout "${name}"`, cwd)
      case 'merge': return runCommand(`git merge "${name}"`, cwd)
      default: return runCommand('git branch -a', cwd)
    }
  },
}

export const gitTools = [gitStatusTool, gitLogTool, gitDiffTool, gitCommitTool, gitBranchTool]
