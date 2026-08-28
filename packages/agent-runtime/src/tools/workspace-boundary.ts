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
 * - 绝对路径且越出 workdir → ok:false + reason（拒绝：路径在 workspace 之外）
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
  return { path, ok: false, reason: '拒绝：路径在 workspace 之外' }
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
