/**
 * 包管理工具集
 *
 * 通过终端命令管理项目依赖包。
 * 支持三种包管理器：npm / pip / cargo（默认自动检测为 npm）。
 *
 * 工具: pkg_install / pkg_run / pkg_info
 */

import type { ToolDefinition } from '../bridge-types'
import { createExecutionAdapter } from '../execution'

/** 通用命令执行器 */
async function runCommand(command: string, cwd?: string, timeout = 15000): Promise<string> {
  const adapter = await createExecutionAdapter()
  if (!adapter.isAvailable()) return JSON.stringify({ ok: false, error: 'CLI 工具当前不可用。Tauri 桌面模式请确认环境正常，Web 模式请启动 worldsmith-server 服务。' })
  try {
    const result = await adapter.executeCommand(command, { cwd, timeout })
    // 清理 ANSI 转义码和不可打印字符，避免输出被误解析为二进制/图片
    const clean = (result.stdout || '')
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
      .replace(/\x1b\].*?\x07/g, '')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    return clean || '(命令已执行，无输出)'
  } catch (err) {
    return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}

/** 检测包管理器，优先使用用户指定的，否则默认 npm */
function detectManager(_cwd: string, preferred?: string): string {
  if (preferred) return preferred
  return 'npm'
}

/** pkg_install — 安装依赖包，支持 npm/pip/cargo，可指定开发依赖 */
const pkgInstallTool: ToolDefinition = {
  name: 'pkg_install',
  description: '安装依赖包。自动检测项目类型（npm/pip/cargo）或手动指定包管理器。',
  parameters: {
    packages: { type: 'string', description: '要安装的包名，多个用空格分隔', required: true },
    dev: { type: 'boolean', description: '是否作为开发依赖安装（npm/pip）' },
    manager: { type: 'string', description: '包管理器：npm/pip/cargo，默认自动检测' },
  },
  execute: async (args, _ctx) => {
    const pkgs = String(args.packages).replace(/"/g, '\\"')
    const mgr = detectManager('.', String(args.manager || ''))
    let cmd: string
    switch (mgr) {
      case 'pip': cmd = `pip install ${pkgs}`; break
      case 'cargo': cmd = `cargo add ${pkgs}`; break
      default:
        cmd = args.dev ? `npm install --save-dev ${pkgs}` : `npm install ${pkgs}`
    }
    return runCommand(cmd)
  },
}

/** pkg_run — 运行包管理器脚本 */
const pkgRunTool: ToolDefinition = {
  name: 'pkg_run',
  description: '运行项目脚本或包管理器命令。如 npm run build、cargo run 等。',
  parameters: {
    script: { type: 'string', description: '要运行的脚本名或命令', required: true },
    manager: { type: 'string', description: '包管理器：npm/cargo/pip，默认自动检测' },
  },
  execute: async (args, _ctx) => {
    const script = String(args.script).replace(/"/g, '\\"')
    const mgr = detectManager('.', String(args.manager || ''))
    let cmd: string
    switch (mgr) {
      case 'cargo': cmd = `cargo ${script}`; break
      case 'pip': cmd = `pip ${script}`; break
      default: cmd = `npm run ${script}`
    }
    return runCommand(cmd)
  },
}

/** pkg_info — 查看包信息和版本 */
const pkgInfoTool: ToolDefinition = {
  name: 'pkg_info',
  description: '查看包信息或版本。如 npm list、pip show、cargo tree 等。',
  parameters: {
    package: { type: 'string', description: '包名', required: true },
    manager: { type: 'string', description: '包管理器：npm/pip/cargo，默认自动检测' },
  },
  execute: async (args, _ctx) => {
    const pkg = String(args.package).replace(/"/g, '\\"')
    const mgr = detectManager('.', String(args.manager || ''))
    let cmd: string
    switch (mgr) {
      case 'pip': cmd = `pip show ${pkg}`; break
      case 'cargo': cmd = `cargo tree -i ${pkg}`; break
      default: cmd = `npm list ${pkg}`
    }
    return runCommand(cmd)
  },
}

export const pkgTools = [pkgInstallTool, pkgRunTool, pkgInfoTool]
