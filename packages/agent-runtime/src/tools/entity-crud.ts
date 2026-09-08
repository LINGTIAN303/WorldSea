/** 实体 CRUD 工具集：实体全生命周期管理 + Embedding 索引同步，详细见 docs/details/注释/packages/agent-runtime/tools-entity-crud.md */

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

/**
 * entity_suggest_field — 字段级智能建议
 *
 * 根据实体上下文为单个字段生成建议值。支持两种模式：
 * - continue: 用户正在输入时，基于 currentText 生成接续文本（ghost text）
 * - suggest: 用户点击 ✨ 按钮时，基于上下文生成独立建议值
 *
 * Agent 应先调用 entity_get_context 获取上下文，再根据上下文生成建议。
 */
export const entitySuggestFieldTool: ToolDefinition = {
  name: 'entity_suggest_field',
  description:
    '为实体的单个字段生成智能建议值。支持两种模式：' +
    'continue（接续预览：基于用户当前输入内容生成续写）和 ' +
    'suggest（独立建议：基于实体上下文生成完整建议值）。' +
    '用于智能填充的 Layer A（字段级建议）。' +
    '请先调用 entity_get_context 获取上下文后再调用此工具。',
  parameters: {
    entityType: { type: 'string', description: '实体类型', required: true },
    fieldKey: { type: 'string', description: '字段键名（如 "personality"、"background"）', required: true },
    fieldLabel: { type: 'string', description: '字段显示名称（如 "性格"、"背景"），帮助理解语义', required: false },
    currentText: { type: 'string', description: '字段当前已输入的文本（用于 continue 模式）', required: false },
    mode: {
      type: 'string',
      description: '建议模式：continue（接续预览）或 suggest（独立建议），默认 suggest',
      required: false,
      enum: ['continue', 'suggest'],
    },
    context: {
      type: 'object',
      description: '实体上下文（来自 entity_get_context 的结果），包含关联实体、同类型实体、Schema 等',
      required: false,
    },
    entityId: { type: 'string', description: '实体ID（编辑已有实体时提供）', required: false },
  },
  meta: {
    permission: 'safe',
    category: 'entity',
    alwaysAvailable: true,
    displayName: '建议字段',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    const entityType = String(args.entityType)
    const fieldKey = String(args.fieldKey)
    const fieldLabel = String(args.fieldLabel || fieldKey)
    const currentText = String(args.currentText || '')
    const mode = String(args.mode || 'suggest')
    const entityId = args.entityId ? String(args.entityId) : undefined
    const context = args.context as Record<string, unknown> | undefined

    // 收集实体已有字段值作为上下文
    let existingFields: Record<string, unknown> = {}
    let entityName = ''
    if (entityId) {
      const entity = await ctx.stores.entity.getById(entityId)
      if (entity) {
        existingFields = { ...entity.properties, description: entity.description }
        entityName = entity.name
      }
    }

    // 构建给 LLM 的提示信息（此工具的返回值是结构化数据，由前端 useSmartFill 消费）
    const suggestion = {
      fieldKey,
      fieldLabel,
      mode: mode as 'continue' | 'suggest',
      currentText,
      entityType,
      entityName,
      entityId,
      existingFields,
      context: context || null,
      // 建议值由 Agent 的文本回复生成，此处返回的是请求确认的结构
      _hint: `请为类型 "${entityType}" 的实体的 "${fieldLabel}"(${fieldKey}) 字段生成${
        mode === 'continue' ? '接续文本' : '建议值'
      }。${
        currentText ? `当前已输入："${currentText}"。` : ''
      }${
        entityName ? `实体名称："${entityName}"。` : ''
      }请只输出建议值本身，不要解释。`,
    }

    return JSON.stringify(suggestion)
  },
}

/**
 * entity_smart_fill — 实体级一键智能填充
 *
 * 为实体的所有空字段批量生成建议值。
 * Agent 应先调用 entity_get_context 获取完整上下文，再根据上下文和 Schema 生成建议。
 * 仅对空字段生成建议，已填字段不覆盖。
 */
export const entitySmartFillTool: ToolDefinition = {
  name: 'entity_smart_fill',
  description:
    '为实体的字段批量生成智能建议值（一键填充）。' +
    '默认仅对空字段生成建议（includeExisting=false）；设置 includeExisting=true 可对所有字段生成建议（含已有内容的优化/改写）。' +
    '用于智能填充的 Layer B（实体级一键填充）。' +
    '请先调用 entity_get_context(scope="full") 获取完整上下文后再调用此工具。',
  parameters: {
    entityId: { type: 'string', description: '实体ID（编辑已有实体时提供）', required: false },
    entityType: { type: 'string', description: '实体类型', required: true },
    currentFields: {
      type: 'object',
      description: '当前已填写的字段键值对（用于判断哪些字段为空）',
      required: false,
    },
    emptyFields: {
      type: 'array',
      description: '空字段键名列表（如 ["personality", "background"]），若不提供则从 currentFields 推断',
      required: false,
      items: { type: 'string', description: '字段键名' },
    },
    context: {
      type: 'object',
      description: '实体上下文（来自 entity_get_context 的结果），包含关联实体、同类型实体、Schema 等',
      required: false,
    },
    includeExisting: {
      type: 'boolean',
      description: '是否对已有内容的字段也生成建议（优化/改写），默认 false 仅对空字段生成',
      required: false,
    },
  },
  meta: {
    permission: 'safe',
    category: 'entity',
    alwaysAvailable: true,
    displayName: '智能填充',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    const entityType = String(args.entityType)
    const entityId = args.entityId ? String(args.entityId) : undefined
    const currentFields = (args.currentFields as Record<string, unknown>) || {}
    const emptyFields = (args.emptyFields as string[]) || []
    const context = args.context as Record<string, unknown> | undefined
    const includeExisting = !!args.includeExisting

    // 如果未提供 emptyFields，从 currentFields 推断
    let fieldsToFill = emptyFields
    if (fieldsToFill.length === 0 && Object.keys(currentFields).length > 0) {
      fieldsToFill = Object.entries(currentFields)
        .filter(([, v]) => v == null || v === '')
        .map(([k]) => k)
    }

    // 获取实体名称
    let entityName = ''
    let description = ''
    if (entityId) {
      const entity = await ctx.stores.entity.getById(entityId)
      if (entity) {
        entityName = entity.name
        description = entity.description || ''
      }
    }

    const result = {
      entityType,
      entityId,
      entityName,
      description,
      currentFields,
      emptyFields: fieldsToFill,
      includeExisting,
      context: context || null,
      _hint: includeExisting
        ? `请为类型 "${entityType}"${
            entityName ? ` 名为 "${entityName}"` : ''
          } 的实体生成所有字段的建议值（包括已有内容的优化/改写）。请以 JSON 对象格式输出，键为字段名，值为建议内容。已有内容的字段也请提供优化建议。`
        : `请为类型 "${entityType}"${
            entityName ? ` 名为 "${entityName}"` : ''
          } 的实体生成以下空字段的建议值：${
            fieldsToFill.length > 0 ? fieldsToFill.join('、') : '所有可选字段'
          }。请以 JSON 对象格式输出，键为字段名，值为建议内容。不要包含已填写的字段。`,
    }

    return JSON.stringify(result)
  },
}

export const entityCrudTools: ToolDefinition[] = [
  entityListTool,
  entityGetTool,
  entityCreateTool,
  entityUpdateTool,
  entityDeleteTool,
  entitySuggestFieldTool,
  entitySmartFillTool,
]
