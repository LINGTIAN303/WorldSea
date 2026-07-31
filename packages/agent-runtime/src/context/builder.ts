/**
 * 上下文注入构建器
 *
 * 负责在每次 LLM 请求前构建项目摘要上下文，并注入到系统提示词中。
 * 使用短期缓存（5 秒 TTL）避免频繁的摘要重建——同一批 tool calls 共享同一份摘要。
 */

import type { WorldSmithToolContext } from '../tools/types'
import { buildProjectSummary, formatSummaryForPrompt } from './summary'

/** 上下文缓存有效期：5 秒 */
const CACHE_TTL_MS = 5000

/** 缓存的上次构建结果 */
let cachedResult: string | null = null
/** 缓存的时间戳 */
let cachedAt = 0

/**
 * 构建并获取上下文注入内容
 * 如果缓存未过期（5 秒内），直接返回缓存结果
 *
 * @param ctx 工具上下文，用于访问实体/关系/文件存储
 * @returns 格式化后的项目摘要字符串
 */
export async function buildContextInjection(ctx: WorldSmithToolContext): Promise<string> {
  const now = Date.now()
  if (cachedResult && (now - cachedAt) < CACHE_TTL_MS) {
    return cachedResult
  }
  const summary = await buildProjectSummary(ctx)
  cachedResult = formatSummaryForPrompt(summary)
  cachedAt = now
  return cachedResult
}

/** 强制失效缓存，下一次 buildContextInjection 会重新构建摘要 */
export function invalidateContextCache(): void {
  cachedResult = null
  cachedAt = 0
}
