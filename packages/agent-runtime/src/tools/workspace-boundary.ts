/**
 * workspace-boundary — 工作空间路径边界契约（任务29/M2：kernel 级 resolver）
 *
 * 全工具族共用的路径边界层，消费方：
 * - coding-agent-tools.ts（read/write/edit/search/list/execute_command：workdir 边界全量加固）
 * - fs-tools.ts（fs_write/mkdir/copy/move/delete：E1 受保护目录写守卫）
 *
 * 边界规则（方案见 docs/plans/workspace-unification-plan.md §四E1）：
 * - workdir 边界（Phase B 契约）：有 workdir 时相对路径 join、绝对路径越界拒绝；
 *   无 workdir（未绑定工作区）放行（显式未加固）
 * - E1 混居写保护：workdir 下的 `entities/`、`.worldsmith/` 为项目数据区，
 *   Agent 裸写/删除拒绝，须经实体语义层（FrontendToolBridge 的 entity_* 工具）——
 *   防止裸 fs 误删实体文件经 fs_watch 回流造成数据丢失
 *
 * 已知限制：execute_command/shell 类工具的内容级写入（如 shell 重定向）无法词法拦截，
 * 属接受的风险（记录于方案文档）。
 *
 * 说明：本包独立于 Tauri，不能 import 任何 Tauri / node 路径模块，
 * 因此用轻量字符串实现 Windows/Unix 双兼容的词法归一（对齐 Rust 侧
 * ensure_within_workdir 的词法归一判定，见 plan workspace-entity-boundary-hardening）。
 */

import type { IToolContext } from '../toolbus/types'

/** 判断是否绝对路径（Unix `/` 开头或 Windows 盘符 `C:\`） */
export function isAbsolutePath(p: string): boolean {
  return /^[/\\]/.test(p) || /^[a-zA-Z]:[/\\]/.test(p)
}

/** 词法归一化：分隔符统一为 '/', 去掉尾斜杠（根 '/' 例外） */
export function normalizeFsPath(p: string): string {
  const s = p.replace(/\\/g, '/').replace(/\/+$/, '')
  return s === '' ? '/' : s
}

/** workdir 下的路径拼接（父目录去尾斜杠，子路径去前导斜杠） */
export function joinFsPath(parent: string, child: string): string {
  const p = normalizeFsPath(parent)
  const c = normalizeFsPath(child).replace(/^\/+/, '')
  return `${p}/${c}`
}

/** 判断 child 是否位于 parent 目录内（词法归一后的前缀比较） */
export function isWithinDirectory(parent: string, child: string): boolean {
  const p = normalizeFsPath(parent)
  const c = normalizeFsPath(child)
  return c === p || c.startsWith(p + '/')
}

/** E1 受保护目录名（workdir 一级子目录；实体数据区与平台元数据区） */
export const PROTECTED_DIR_NAMES = ['entities', '.worldsmith'] as const

/** E1 拒绝消息（引导模型走实体语义层） */
export const PROTECTED_WRITE_ERROR =
  '拒绝：该路径位于项目数据区（entities/ 或 .worldsmith/），Agent 不可直接写入、移动或删除。' +
  '实体数据请使用语义工具（entity_create / entity_update / entity_delete / content_search）操作。'

/** E1 判定：path 是否落在 workdir 的受保护目录内（大小写不敏感，兼容 Windows） */
export function isProtectedProjectPath(workdir: string, path: string): boolean {
  const w = normalizeFsPath(workdir)
  const n = normalizeFsPath(path)
  if (!isWithinDirectory(w, n)) return false
  const rel = n === w ? '' : n.slice(w.length + 1)
  const firstSeg = rel.split('/')[0].toLowerCase()
  return (PROTECTED_DIR_NAMES as readonly string[]).includes(firstSeg)
}

/**
 * 把 path 归一到 workdir 内（Phase B 边界契约）：
 * - 无 workdir（未绑定工作区）→ 返回原路径 ok:true（显式未加固，写类由调用方额外拦截）
 * - 相对路径 → join workdir（归一分隔符）
 * - 绝对路径且在 workdir 内 → 原样返回
 * - 绝对路径在 workdir 外但命中 extraWritablePaths 白名单（精确整路径匹配，
 *   2026-08-30 拍板：MCP 配置文件 mcp.json 全局单份、Agent 可编辑）→ 原样返回
 * - 其余绝对路径越出 workdir → ok:false + reason（拒绝：路径在 workspace 之外）
 */
export function resolveWithinWorkspace(ctx: IToolContext, path: string): { path: string; ok: boolean; reason?: string } {
  const workdir = ctx.workspace?.workdir
  if (!workdir) return { path, ok: true }
  if (!isAbsolutePath(path)) {
    return { path: joinFsPath(workdir, path), ok: true }
  }
  if (isWithinDirectory(workdir, path)) {
    return { path, ok: true }
  }
  if (isExtraWritablePath(ctx.workspace?.extraWritablePaths, path)) {
    return { path, ok: true }
  }
  return { path, ok: false, reason: '拒绝：路径在 workspace 之外' }
}

/**
 * extraWritablePaths 判定：path 是否精确命中放行文件（词法归一 + 小写，
 * 兼容 Windows 大小写差异）。仅整路径匹配文件本身，不做目录前缀放行。
 */
export function isExtraWritablePath(extras: readonly string[] | undefined, path: string): boolean {
  if (!extras || extras.length === 0) return false
  const n = normalizeFsPath(path).toLowerCase()
  return extras.some((e) => normalizeFsPath(e).toLowerCase() === n)
}

/**
 * 写类路径守卫（workdir 边界 + E1 受保护目录，写类工具统一入口）：
 * 先做 workdir 归一（越界拒绝），再对归一后的路径做 E1 判定
 * （落在 entities/、.worldsmith/ 内 → 拒绝并引导语义层）。
 * 读类工具请用 resolveWithinWorkspace（E1 只保护写）。
 */
export function resolveWriteWithinWorkspace(ctx: IToolContext, path: string): { path: string; ok: boolean; reason?: string } {
  const resolved = resolveWithinWorkspace(ctx, path)
  if (!resolved.ok) return resolved
  const workdir = ctx.workspace?.workdir
  if (!workdir) return resolved
  if (isProtectedProjectPath(workdir, resolved.path)) {
    return { path: resolved.path, ok: false, reason: PROTECTED_WRITE_ERROR }
  }
  return resolved
}

// ── shell 内容级写入的词法防护（任务29/M4：E1 盲区收敛） ─────────────
//
// execute_command / shell_session exec 的命令串是自由文本，E1 的路径级守卫拦不住
// 重定向/删除类内容写入（如 `rm entities/x.json`、`echo x > .worldsmith/kv`）。
// 本函数做保守词法扫描：命令串**同现**写操作词与受保护目录字样 → 判定触碰。
// 非完备声明：变量间接、别名、子串拼接可绕过——定位是拦截常见误操作 +
// 提示模型走语义层，不能替代用户监督（方案文档 §六 已记录）。

/** 写操作词（覆盖常见 shell/PowerShell 删除/移动/重定向/写入指令） */
const SHELL_WRITE_HINT_RE =
  /(?:^|[\s|;&])(rm|del|erase|rd|rmdir|remove-item|move-item|rename-item|mv|set-content|add-content|out-file|new-item|copy-item|tee-object|echo)\b|\>{1,2}\s|\bcp\b/i

/** 受保护目录的相对/任意位置字样（entities/ 或 .worldsmith/，兼容双分隔符） */
const SHELL_PROTECTED_HINT_RE = /(^|[\s"'`(=\\/:])(entities|\.worldsmith)[\\/]/i

/**
 * 判定 shell 命令串是否可能触碰 workdir 下的受保护目录（E1 盲区词法防护）。
 * 保守策略：写操作词与受保护目录字样同现即判定触碰（宁误拦不错放，
 * 误拦仅损失一次调用并收到引导信息，漏放则实体数据经 fs_watch 真实丢失）。
 */
export function shellCommandTouchesProtectedPath(workdir: string, command: string): boolean {
  if (!command) return false
  // 规则一：写操作词 + 相对保护目录字样（entities/ / .worldsmith/）
  if (SHELL_WRITE_HINT_RE.test(command) && SHELL_PROTECTED_HINT_RE.test(command)) {
    return true
  }
  // 规则二：写操作词 + 绝对保护路径（workdir + /entities|.worldsmith 子串）
  const w = normalizeFsPath(workdir).toLowerCase()
  const n = normalizeFsPath(command).toLowerCase()
  if (SHELL_WRITE_HINT_RE.test(command) &&
      (n.includes(`${w}/entities`) || n.includes(`${w}/.worldsmith`))) {
    return true
  }
  return false
}
