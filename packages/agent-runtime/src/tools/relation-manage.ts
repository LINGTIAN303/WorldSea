/**
 * 关系管理工具集
 *
 * 提供关系的 CRUD 操作：列出、创建、删除、更新。
 * 包含安全校验：实体存在性检查、自引用禁止、重复关系检测。
 */

import type { ToolDefinition } from '../bridge-types'
import type { ToolMeta } from '@worldsmith/agent-core'
import { unwrap } from './types'

/** relation_list — 列出与指定实体相关的所有关系 */
export const relationListTool: ToolDefinition = {
  name: 'relation_list',
  description: '列出与指定实体相关的关系。返回关系列表（id/type/sourceId/targetId/label）。',
  parameters: {
    entityId: { type: 'string', description: '实体 ID', required: true },
  },
  meta: {
    permission: 'safe',
    category: 'relation',
    alwaysAvailable: true,
    displayName: '列出关系',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    const entityId = String(args.entityId)
    const relations = (await ctx.stores.relation.getAllRelations()).filter(
      r => r.sourceId === entityId || r.targetId === entityId
    )
    const results = relations.map(r => ({
      id: r.id,
      type: r.type,
      sourceId: r.sourceId,
      targetId: r.targetId,
      label: r.label,
    }))
    return JSON.stringify({ total: results.length, relations: results })
  },
}

/**
 * relation_create — 创建两个实体之间的关系
 * 校验：双方实体存在、非自引用、同类型同方向不重复
 */
export const relationCreateTool: ToolDefinition = {
  name: 'relation_create',
  description: '在两个实体之间创建关系。',
  parameters: {
    type: { type: 'string', description: '关系类型', required: true },
    sourceId: { type: 'string', description: '源实体 ID', required: true },
    targetId: { type: 'string', description: '目标实体 ID', required: true },
    label: { type: 'string', description: '关系标签（可选）', required: false },
    properties: { type: 'object', description: '关系属性（可选）', required: false },
  },
  meta: {
    permission: 'moderate',
    category: 'relation',
    displayName: '创建关系',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    const sourceId = String(args.sourceId)
    const targetId = String(args.targetId)
    const entities = await ctx.stores.entity.getAllEntities()
    const sourceExists = entities.some((e: any) => e.id === sourceId)
    const targetExists = entities.some((e: any) => e.id === targetId)
    if (!sourceExists || !targetExists) {
      return JSON.stringify({
        error: '实体不存在',
        missing: !sourceExists ? sourceId : targetId,
        hint: '请先使用 entity_list 或 entity_get 确认实体 ID',
      })
    }
    if (sourceId === targetId) {
      return JSON.stringify({ error: '不能创建自引用关系（sourceId 和 targetId 相同）' })
    }
    const relations = await ctx.stores.relation.getAllRelations()
    const duplicate = relations.some(
      (r: any) => r.type === String(args.type) && r.sourceId === sourceId && r.targetId === targetId
    )
    if (duplicate) {
      return JSON.stringify({ error: '相同类型和方向的关系已存在', type: String(args.type), sourceId, targetId })
    }
    const relation = {
      id: crypto.randomUUID(),
      type: String(args.type),
      sourceId,
      targetId,
      label: args.label ? String(args.label) : undefined,
      properties: (args.properties as Record<string, unknown>) || {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    await ctx.stores.relation.add(relation, 'agent')
    return JSON.stringify({ success: true, id: relation.id, type: relation.type })
  },
}

/** relation_delete — 删除关系（不可逆） */
export const relationDeleteTool: ToolDefinition = {
  name: 'relation_delete',
  description: '删除关系。此操作不可逆，需用户确认。',
  parameters: {
    id: { type: 'string', description: '关系 ID', required: true },
  },
  meta: {
    permission: 'dangerous',
    category: 'relation',
    displayName: '删除关系',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    await ctx.stores.relation.remove(String(args.id), 'agent')
    return JSON.stringify({ success: true, id: args.id })
  },
}

export const relationManageTools: ToolDefinition[] = [
  relationListTool,
  relationCreateTool,
  relationDeleteTool,
  {
    name: 'relation_update',
    description: '更新已有关系的属性。需要关系 ID。可更新 type 和 properties，properties 为合并更新。关系 ID 可通过 relation_list 获取。',
    parameters: {
      id: { type: 'string', description: '关系 ID', required: true },
      label: { type: 'string', description: '新标签（可选）', required: false },
      properties: { type: 'object', description: '要更新的属性键值对（合并，不覆盖未提及的键）', required: false },
    },
    meta: {
      permission: 'moderate',
      category: 'relation',
      displayName: '更新关系',
    } satisfies ToolMeta,
    execute: async (args, ctx) => {
      const id = String(args.id)
      let unwrapped: any = null
      const existing = await (ctx.stores.relation as any).getById?.(id)
      if (existing) {
        unwrapped = unwrap<any>(existing, null)
      }
      if (!unwrapped) {
        const relations = await ctx.stores.relation.getAllRelations()
        unwrapped = relations.find((r: any) => r.id === id) || null
      }
      if (!unwrapped) {
        return JSON.stringify({ error: `关系 ${id} 不存在` })
      }
      const updated = { ...unwrapped }
      if (args.label !== undefined) updated.label = String(args.label)
      if (args.properties && typeof args.properties === 'object') {
        updated.properties = { ...(updated.properties || {}), ...(args.properties as Record<string, unknown>) }
      }
      updated.updatedAt = new Date().toISOString()
      await ctx.stores.relation.update(id, updated)
      return JSON.stringify({ success: true, id })
    },
  },
]
