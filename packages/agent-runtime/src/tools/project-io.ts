/**
 * 项目导入导出工具
 *
 * 提供项目数据的导出（JSON）和导入（merge/overwrite）功能。
 * 导出结果包含版本号、时间戳、实体/关系数组和统计信息。
 * 导入支持合并模式（跳过重复）和覆盖模式（先清空再导入）。
 */

import type { ToolDefinition } from '../bridge-types'
import type { ToolMeta } from '@worldsea/agent-core'

/**
 * project_export — 导出项目数据
 * 导出所有实体和关系的 JSON 快照，包含类型分布统计
 */
export const projectExportTool: ToolDefinition = {
  name: 'project_export',
  description: '导出当前项目的所有实体和关系数据为 JSON 格式。使用场景：备份数据、迁移到其他项目、与外部工具集成。导出前建议先用 daily_report 确认数据完整性。',
  parameters: {
    format: { type: 'string', description: '导出格式，目前仅支持 json', required: false },
  },
  meta: {
    permission: 'safe',
    category: 'project',
    alwaysAvailable: true,
    displayName: '导出项目',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    const format = String(args.format || 'json')
    const entityStore = ctx.stores.entity as any
    const relationStore = ctx.stores.relation as any

    if (!entityStore || !relationStore) {
      return JSON.stringify({ error: '无法访问数据存储' })
    }

    const entities = entityStore.entities || []
    const relations = relationStore.relations || []

    const exportData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      projectInfo: ctx.projectInfo,
      entities: entities.map((e: any) => ({
        id: e.id,
        name: e.name,
        type: e.type,
        description: e.description || '',
        properties: e.properties || {},
      })),
      relations: relations.map((r: any) => ({
        id: r.id,
        sourceId: r.sourceId,
        targetId: r.targetId,
        type: r.type,
        label: r.label || '',
        properties: r.properties || {},
      })),
      stats: {
        entityCount: entities.length,
        relationCount: relations.length,
        entityTypes: [...new Set(entities.map((e: any) => e.type))],
      },
    }

    if (format === 'json') {
      const json = JSON.stringify(exportData, null, 2)
      return JSON.stringify({
        message: `导出成功：${entities.length} 个实体，${relations.length} 条关系`,
        data: json,
        stats: exportData.stats,
      })
    }

    return JSON.stringify({ error: `不支持的导出格式: ${format}` })
  },
}

/**
 * project_import — 导入项目数据
 * 支持两种模式：
 * - merge: 跳过 ID 已存在的实体/关系
 * - overwrite: 先清空所有数据再导入
 */
export const projectImportTool: ToolDefinition = {
  name: 'project_import',
  description: '从 JSON 数据导入实体和关系到当前项目。已有实体不会被覆盖，只会新增。使用场景：恢复备份、合并其他项目的数据。导入后建议用 consistency_check 检查数据一致性。',
  parameters: {
    data: { type: 'string', description: '要导入的 JSON 数据字符串', required: true },
    mode: { type: 'string', description: '导入模式: merge(合并,跳过重复) 或 overwrite(覆盖,先清空)', required: false },
  },
  meta: {
    permission: 'safe',
    category: 'project',
    alwaysAvailable: true,
    displayName: '导入项目',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    const dataStr = String(args.data)
    const mode = String(args.mode || 'merge')

    let importData: any
    try {
      importData = JSON.parse(dataStr)
    } catch {
      return JSON.stringify({ error: '无效的 JSON 数据' })
    }

    if (!importData.entities || !Array.isArray(importData.entities)) {
      return JSON.stringify({ error: '数据格式错误：缺少 entities 数组' })
    }

    const entityStore = ctx.stores.entity as any
    const relationStore = ctx.stores.relation as any

    if (!entityStore || !relationStore) {
      return JSON.stringify({ error: '无法访问数据存储' })
    }

    if (mode === 'overwrite') {
      const existing = entityStore.entities || []
      for (const e of existing) {
        entityStore.remove(e.id)
      }
      const existingRels = relationStore.relations || []
      for (const r of existingRels) {
        relationStore.remove(r.id)
      }
    }

    let importedEntities = 0
    let skippedEntities = 0
    let importedRelations = 0
    let skippedRelations = 0

    for (const entity of importData.entities) {
      if (mode === 'merge' && entityStore.getById?.(entity.id)) {
        skippedEntities++
        continue
      }
      try {
        entityStore.add({
          id: entity.id,
          name: entity.name,
          type: entity.type,
          description: entity.description || '',
          properties: entity.properties || {},
        })
        importedEntities++
      } catch {
        skippedEntities++
      }
    }

    if (importData.relations && Array.isArray(importData.relations)) {
      for (const rel of importData.relations) {
        if (mode === 'merge' && relationStore.relations?.some((r: any) => r.id === rel.id)) {
          skippedRelations++
          continue
        }
        try {
          relationStore.add({
            id: rel.id,
            sourceId: rel.sourceId,
            targetId: rel.targetId,
            type: rel.type,
            label: rel.label || '',
            properties: rel.properties || {},
          })
          importedRelations++
        } catch {
          skippedRelations++
        }
      }
    }

    return JSON.stringify({
      message: `导入完成：${importedEntities} 个实体导入，${skippedEntities} 个跳过；${importedRelations} 条关系导入，${skippedRelations} 条跳过`,
      importedEntities,
      skippedEntities,
      importedRelations,
      skippedRelations,
    })
  },
}

export const projectTools: ToolDefinition[] = [projectExportTool, projectImportTool]
