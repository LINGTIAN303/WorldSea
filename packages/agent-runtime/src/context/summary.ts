/**
 * 项目摘要构建与消息截断
 *
 * 提供两个核心功能：
 * 1. buildProjectSummary: 分析项目状态，生成结构化的统计摘要
 * 2. truncateMessages: 当消息数超过阈值时截断历史消息
 */

import type { WorldSmithToolContext } from '../tools/types'

/** 项目摘要数据结构 */
export interface ProjectSummary {
  totalEntities: number
  totalRelations: number
  totalFiles: number
  typeDistribution: Record<string, number>
  files: { id: string; name: string; path: string; entityId?: string }[]
  recentActivity: string
}

/**
 * 从工具上下文中读取项目数据并构建摘要
 * 统计实体总数、关系总数、文件总数、实体类型分布
 */
export async function buildProjectSummary(ctx: WorldSmithToolContext): Promise<ProjectSummary> {
  const entities = await ctx.stores.entity.getAllEntities()
  const relations = await ctx.stores.relation.getAllRelations()
  const files = await ctx.stores.file.getAllFiles()

  const typeDistribution: Record<string, number> = {}
  for (const e of entities) {
    typeDistribution[e.type] = (typeDistribution[e.type] || 0) + 1
  }

  return {
    totalEntities: entities.length,
    totalRelations: relations.length,
    totalFiles: files.length,
    typeDistribution,
    files: files.map(f => ({ id: f.id, name: f.name, path: f.path, entityId: f.entityId })),
    recentActivity: `共 ${entities.length} 个实体，${relations.length} 条关系，${files.length} 个文件`,
  }
}

/**
 * 将摘要对象格式化为适合注入提示词的文本
 * 包含实体/关系/文件统计和实体类型分布
 */
export function formatSummaryForPrompt(summary: ProjectSummary): string {
  const dist = Object.entries(summary.typeDistribution)
    .map(([type, count]) => `${type}(${count})`)
    .join(', ')
  let result = `[项目摘要] 实体: ${summary.totalEntities} | 关系: ${summary.totalRelations} | 文件: ${summary.totalFiles} | 分布: ${dist}`
  if (summary.files.length > 0) {
    result += '\n[工作区文件]\n' + summary.files.map(f => {
      const entityInfo = f.entityId ? ` → 实体:${f.entityId.slice(0, 8)}` : ''
      return `  ${f.path} (${f.name})${entityInfo}`
    }).join('\n')
  }
  return result
}

/**
 * 截断消息列表以控制上下文长度
 *
 * 策略：保留所有 system 消息，只截断 user/assistant/tool 消息。
 * 截断时保留最近的 maxCount 条非系统消息，并在中间插入截断提示。
 *
 * @param messages 完整消息列表
 * @param maxCount 保留的最大非系统消息数，默认 40
 * @returns 截断后的消息列表
 */
export function truncateMessages(messages: any[], maxCount: number = 40): any[] {
  if (messages.length <= maxCount) return messages
  const systemMsgs = messages.filter((m: any) => m.role === 'system')
  const nonSystemMsgs = messages.filter((m: any) => m.role !== 'system')
  if (nonSystemMsgs.length <= maxCount) return messages
  const kept = nonSystemMsgs.slice(-maxCount)
  const summary = `[上下文已截断，保留了最近 ${maxCount} 条消息，共 ${nonSystemMsgs.length} 条]`
  return [
    ...systemMsgs,
    { role: 'system' as const, content: summary },
    ...kept,
  ]
}
