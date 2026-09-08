/**
 * 日常维护工具集
 *
 * 两个工具：
 * - daily_report: 生成项目的每日状态报告（实体/关系计数、类型分布、最近更新）
 * - consistency_check: 检查数据一致性（孤立关系、重复名称、缺少实体的关系）
 */

import type { ToolDefinition } from '../bridge-types'
import type { ToolMeta } from '@worldsea/agent-core'

/** daily_report — 生成项目每日统计报告 */
export const dailyReportTool: ToolDefinition = {
  name: 'daily_report',
  description: '生成项目每日状态报告：实体数量、关系数量、类型分布、最近更新。',
  parameters: {
    date: { type: 'string', description: '报告日期（YYYY-MM-DD），默认今天', required: false },
  },
  meta: {
    permission: 'safe',
    category: 'persona',
    alwaysAvailable: true,
    displayName: '日报',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    const entities = await ctx.stores.entity.getAllEntities()
    const relations = await ctx.stores.relation.getAllRelations()
    const typeCounts: Record<string, number> = {}
    for (const e of entities) {
      typeCounts[e.type] = (typeCounts[e.type] || 0) + 1
    }
    const recentEntities = [...entities]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 5)
      .map(e => ({ name: e.name, type: e.type, updatedAt: e.updatedAt }))

    return JSON.stringify({
      date: args.date || new Date().toISOString().split('T')[0],
      summary: {
        totalEntities: entities.length,
        totalRelations: relations.length,
        typeDistribution: typeCounts,
      },
      recentUpdates: recentEntities,
    })
  },
}

/**
 * consistency_check — 数据一致性检查
 *
 * 检查三项：
 * 1. 孤立实体：没有任何关系的实体
 * 2. 断裂关系：引用了不存在的 sourceId 或 targetId
 * 3. 重复名称：不同实体类型下存在同名的实体
 */
export const consistencyCheckTool: ToolDefinition = {
  name: 'consistency_check',
  description: '检查项目数据一致性，识别：孤立关系（引用了不存在的实体）、缺失必要属性的实体、同类型下的重复实体名称。使用场景：在大量创建/删除操作后检查数据完整性、定期维护。底层使用 Rust 核心库的验证和引用完整性检查。',
  parameters: {},
  meta: {
    permission: 'safe',
    category: 'persona',
    alwaysAvailable: true,
    displayName: '一致性检查',
  } satisfies ToolMeta,
  execute: async (_args, ctx) => {
    const entities = await ctx.stores.entity.getAllEntities()
    const relations = await ctx.stores.relation.getAllRelations()
    const entityIds = new Set(entities.map(e => e.id))

    const orphanEntities = entities.filter(e =>
      !relations.some(r => r.sourceId === e.id || r.targetId === e.id)
    )

    const brokenRelations = relations.filter(r =>
      !entityIds.has(r.sourceId) || !entityIds.has(r.targetId)
    )

    const duplicateNames: { name: string; types: string[] }[] = []
    const nameMap = new Map<string, string[]>()
    for (const e of entities) {
      const arr = nameMap.get(e.name) || []
      arr.push(e.type)
      nameMap.set(e.name, arr)
    }
    for (const [name, types] of nameMap) {
      if (types.length > 1) duplicateNames.push({ name, types })
    }

    return JSON.stringify({
      orphanEntities: { count: orphanEntities.length, items: orphanEntities.map(e => ({ id: e.id, name: e.name, type: e.type })) },
      brokenRelations: { count: brokenRelations.length, items: brokenRelations.map(r => ({ id: r.id, type: r.type, sourceId: r.sourceId, targetId: r.targetId })) },
      duplicateNames: { count: duplicateNames.length, items: duplicateNames },
      overallHealth: orphanEntities.length === 0 && brokenRelations.length === 0 ? 'good' : 'issues_found',
    })
  },
}

export const dailyTaskTools: ToolDefinition[] = [dailyReportTool, consistencyCheckTool]
