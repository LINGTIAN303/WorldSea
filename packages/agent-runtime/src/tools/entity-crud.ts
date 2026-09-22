/** 实体 CRUD 工具集：实体全生命周期管理 + Embedding 索引同步（智能填充两件见 ./entity-smart-fill），详细见 docs/details/注释/packages/agent-runtime/tools-entity-crud.md */

import type { ToolDefinition } from '../bridge-types'
import type { ToolMeta } from '@worldsea/agent-core'
import { emitEntityCard, emitEntityList } from './a2ui-helpers'
import { indexEntity, removeEntityIndex } from '../embedding/index'

/** entity_list — 列出实体，支持类型/关键词/数量限制 */
export const entityListTool: ToolDefinition = {
  name: 'entity_list',
  description: '列出实体，可按类型或关键词筛选。返回摘要列表（id/name/type + 前5个属性）。',
  parameters: {
    type: { type: 'string', description: '实体类型筛选（可选）', required: false },
    keyword: { type: 'string', description: '名称/描述关键词筛选（可选）', required: false },
    limit: { type: 'number', description: '返回数量上限，默认20', required: false },
  },
  meta: {
    permission: 'safe',
    readOnly: true,
    sideEffectScope: 'workspace',
    concurrentSafe: true,
    requiresUserInteraction: false,
    alwaysAsk: false,
    category: 'entity',
    alwaysAvailable: true,
    displayName: '列出实体',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    let entities = await ctx.stores.entity.getAllEntities()
    if (args.type) entities = entities.filter(e => e.type === args.type)
    if (args.keyword) {
      const kw = String(args.keyword).toLowerCase()
      entities = entities.filter(e =>
        e.name.toLowerCase().includes(kw) ||
        e.description.toLowerCase().includes(kw)
      )
    }
    const limit = Number(args.limit) || 20
    const results = entities.slice(0, limit).map(e => {
      const props = e.properties ? Object.fromEntries(
        Object.entries(e.properties).slice(0, 5)
      ) : {}
      return { id: e.id, name: e.name, type: e.type, preview: props, description: e.description || '' }
    })
    if (results.length > 0) {
      emitEntityList(ctx, results, args.type ? `${args.type} 列表` : '实体列表')
    }
    return JSON.stringify({ total: entities.length, showing: results.length, entities: results })
  },
}

/** entity_get — 根据 ID 获取实体完整详情并展示 A2UI 卡片 */
export const entityGetTool: ToolDefinition = {
  name: 'entity_get',
  description: '根据 ID 获取实体的完整详情（所有属性和描述）。如果你只知道实体名称而不知道 ID，请先用 entity_list 搜索获取 ID。返回包含 id、name、type、description、properties 的完整对象。',
  parameters: {
    id: { type: 'string', description: '实体 ID', required: true },
  },
  meta: {
    permission: 'safe',
    readOnly: true,
    sideEffectScope: 'workspace',
    concurrentSafe: true,
    requiresUserInteraction: false,
    alwaysAsk: false,
    category: 'entity',
    alwaysAvailable: true,
    displayName: '获取实体',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    const entity = await ctx.stores.entity.getById(String(args.id))
    if (!entity) return JSON.stringify({ error: '实体未找到' })
    emitEntityCard(ctx, entity)
    return JSON.stringify(entity)
  },
}

/**
 * entity_create — 创建新实体
 * 校验：类型是否在允许列表中、同类型同名称不重复
 * 创建后自动发射 A2UI EntityCard 并异步写入 Embedding 索引
 */
export const entityCreateTool: ToolDefinition = {
  name: 'entity_create',
  description: '创建新实体。需要 type 和 name，可选 description 和 properties。',
  parameters: {
    type: { type: 'string', description: '实体类型', required: true },
    name: { type: 'string', description: '实体名称', required: true },
    description: { type: 'string', description: '实体描述', required: false },
    properties: { type: 'object', description: '实体属性（键值对）', required: false },
  },
  meta: {
    permission: 'moderate',
    readOnly: false,
    sideEffectScope: 'workspace',
    concurrentSafe: false,
    requiresUserInteraction: false,
    alwaysAsk: false,
    category: 'entity',
    displayName: '创建实体',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    const entityType = String(args.type)
    const entityName = String(args.name)
    if (ctx.projectInfo?.entityTypes?.length && !ctx.projectInfo.entityTypes.includes(entityType)) {
      return JSON.stringify({
        error: `实体类型 "${entityType}" 不在允许列表中`,
        allowedTypes: ctx.projectInfo.entityTypes,
        hint: '请使用 entity_list 查看现有类型，或使用允许列表中的类型',
      })
    }
    const entities = await ctx.stores.entity.getAllEntities()
    const duplicate = entities.some((e: any) => e.type === entityType && e.name === entityName)
    if (duplicate) {
      return JSON.stringify({ error: `类型 "${entityType}" 下已存在同名实体 "${entityName}"`, hint: '请使用不同的名称或先查看 entity_list' })
    }
    const entity = {
      id: crypto.randomUUID(),
      type: entityType,
      name: entityName,
      description: String(args.description || ''),
      properties: (args.properties as Record<string, unknown>) || {},
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    const id = await ctx.stores.entity.add(entity, 'agent')
    emitEntityCard(ctx, { ...entity, id })
    indexEntity({ ...entity, id }).catch(() => {})
    return JSON.stringify({ success: true, id, name: entity.name, type: entityType })
  },
}

/** entity_update — 更新实体属性，采用合并策略（不覆盖未提及的键） */
export const entityUpdateTool: ToolDefinition = {
  name: 'entity_update',
  description: '更新实体属性。只能更新 name、description、properties 中的字段。',
  parameters: {
    id: { type: 'string', description: '实体 ID', required: true },
    name: { type: 'string', description: '新名称（可选）', required: false },
    description: { type: 'string', description: '新描述（可选）', required: false },
    properties: { type: 'object', description: '要更新的属性键值对（合并，不覆盖未提及的键）', required: false },
  },
  meta: {
    permission: 'moderate',
    readOnly: false,
    sideEffectScope: 'workspace',
    concurrentSafe: false,
    requiresUserInteraction: false,
    alwaysAsk: false,
    category: 'entity',
    displayName: '更新实体',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    const entityId = String(args.id)
    const existing = await ctx.stores.entity.getById(entityId)
    if (!existing) return JSON.stringify({ error: `实体 ${entityId} 不存在`, hint: '请使用 entity_list 查看现有实体' })
    const changes: Record<string, unknown> = {}
    if (args.name) changes.name = String(args.name)
    if (args.description) changes.description = String(args.description)
    if (args.properties && typeof args.properties === 'object') {
      changes.properties = { ...(existing.properties || {}), ...(args.properties as Record<string, unknown>) }
    }
    await ctx.stores.entity.update(entityId, changes, 'agent')
    const updated = await ctx.stores.entity.getById(entityId)
    if (updated) {
      emitEntityCard(ctx, updated)
      indexEntity(updated).catch(() => {})
    }
    // type 供 WORLD.md 节奏型注入计数（H5，2026-08-30）
    return JSON.stringify({ success: true, id: entityId, type: existing.type })
  },
}

/**
 * entity_delete — 删除实体及关联关系
 * 级联删除所有关联关系、清理 Embedding 索引、关闭 A2UI 画布
 */
export const entityDeleteTool: ToolDefinition = {
  name: 'entity_delete',
  description: '删除指定实体及其所有关联关系。此操作不可逆。需要实体 ID（可通过 entity_list 获取）。执行前请向用户确认删除意图。',
  parameters: {
    id: { type: 'string', description: '实体 ID', required: true },
  },
  meta: {
    permission: 'dangerous',
    readOnly: false,
    sideEffectScope: 'workspace',
    concurrentSafe: false,
    requiresUserInteraction: false,
    alwaysAsk: true,
    category: 'entity',
    displayName: '删除实体',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    const entityId = String(args.id)
    const entity = await ctx.stores.entity.getById(entityId)
    const entityName = entity?.name || entityId.slice(0, 8)
    const relations = await ctx.stores.relation.getAllRelations()
    const linkedRelations = relations.filter(
      (r: any) => r.sourceId === entityId || r.targetId === entityId
    )
    for (const r of linkedRelations) {
      await ctx.stores.relation.remove(r.id, 'agent')
    }
    await ctx.stores.entity.remove(entityId, 'agent')
    removeEntityIndex(entityId).catch(() => {})
    ctx.emitA2UI?.(`entity-${entityId}`, { version: 'v0.9', deleteSurface: { surfaceId: `entity-${entityId}` } })
    return JSON.stringify({ success: true, id: args.id, name: entityName, type: entity?.type, deletedRelations: linkedRelations.length })
  },
}

export const entityCrudTools: ToolDefinition[] = [
  entityListTool,
  entityGetTool,
  entityCreateTool,
  entityUpdateTool,
  entityDeleteTool,
]
