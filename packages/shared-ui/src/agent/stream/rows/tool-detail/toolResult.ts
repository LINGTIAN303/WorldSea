/**
 * 工具结果解析与详情分派（R 批 R-a）
 *
 * 纯函数、零 UI 依赖：把 `tc.result`（JSON 文本）解析成 `{json, meta}`，
 * 并按「能力类 + 结果形状」决定展开体（终端卡 / 文件读视图 / 文件列表 / 通用详情）。
 *
 * 分派原则（草案 §三之二）：**类由客户端判、结构由服务端给**——
 * 这里的判定只读服务端已写入的 `__meta` / 结果字段，不在前端复算语义。
 */
import type { ToolClass } from '../toolClassify'
import type { ToolItem } from './types'

/** 解析后的工具结果 */
export interface ParsedToolResult {
  /** 结果对象（非对象 / 解析失败 → null） */
  json: Record<string, unknown> | null
  /** 结果内嵌 `__meta`（无 → null） */
  meta: Record<string, unknown> | null
}

export function parseToolResult(result?: string | null): ParsedToolResult {
  if (!result) return { json: null, meta: null }
  let parsed: unknown = null
  try {
    parsed = JSON.parse(result)
  } catch {
    return { json: null, meta: null }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { json: null, meta: null }
  const json = parsed as Record<string, unknown>
  const rawMeta = json.__meta
  const meta = rawMeta && typeof rawMeta === 'object' && !Array.isArray(rawMeta)
    ? (rawMeta as Record<string, unknown>)
    : null
  return { json, meta }
}

/** 字符串字段取值（非字符串 / 空串 → ''） */
export function str(v: unknown): string {
  return typeof v === 'string' && v ? v : ''
}

/** 数字字段取值（非数字 → undefined） */
export function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/** 展开体种类（R-a：终端 / 文件读 / 文件列表 / 通用） */
export type DetailKind = 'terminal' | 'file-read' | 'file-list' | 'generic'

/**
 * 能力类 + 结果形状 → 展开体种类。
 *
 * - `terminal` 恒走终端卡（结果形状由卡内自洽处理：live stream / stdout / 无输出）；
 * - 文件类：`read` 且结果带 `content` 字符串 → 代码视图；结果带 `entries` 数组 → 目录树；
 *   其余（写 / 改 / 外置 artifact / 无结果）回落通用详情（参数 + 结果 JSON）。
 */
export function detailKindFor(cls: ToolClass, item: ToolItem): DetailKind {
  if (cls === 'terminal') return 'terminal'
  if (cls === 'file-read' || cls === 'file-edit' || cls === 'file-write' || cls === 'file-list') {
    const { json } = parseToolResult(item.tc.result)
    if (json && typeof json.content === 'string') return 'file-read'
    if (json && Array.isArray(json.entries)) return 'file-list'
  }
  return 'generic'
}
