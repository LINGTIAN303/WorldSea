import type { LibraryDescriptor, CapabilityDeclaration, FieldDefinition } from '@worldsmith/agent-runtime/toolbus/capability-types'
import type { IToolContext } from '@worldsmith/agent-runtime/toolbus/types'
import type { ToolParameter } from '@worldsmith/agent-runtime/bridge-types'
import { emitEntityCard, emitEntityList } from '@worldsmith/agent-runtime/tools/a2ui-helpers'
import { entitySchemaRegistry } from './core/EntitySchema'
import { fieldRegistry } from './core/FieldRegistry'
import { getValidationApi } from './core/serviceProvider'

function mapFieldType(t: string): FieldDefinition['type'] {
  if (t === 'number') return 'number'
  if (t === 'boolean') return 'boolean'
  if (t === 'textarea') return 'richtext'
  return 'string'
}

function resolveFieldsForType(entityType: string): FieldDefinition[] {
  const registered = fieldRegistry.getFields(entityType)
  if (registered.length > 0) {
    return registered.map(f => ({
      key: f.key,
      label: f.label,
      type: mapFieldType(f.fieldType),
      required: f.required ?? false,
      defaultValue: f.defaultValue,
      description: f.placeholder || f.label,
      enum: f.options?.map(o => o.value),
    }))
  }
  const schema = entitySchemaRegistry.get(entityType)
  if (schema) {
    return [...schema.fields, ...(schema.customFields || [])].map(f => ({
      key: f.key,
      label: f.label,
      type: mapFieldType(f.fieldType),
      required: f.required ?? false,
      defaultValue: f.defaultValue,
      description: f.placeholder || f.label,
      enum: f.options?.map(o => o.value),
    }))
  }
  return []
}

const entityList: CapabilityDeclaration = {
  id: 'entity.list',
  name: 'entity.list',
  description: '列出实体，可按类型或关键词筛选。返回摘要列表（id/name/type + 前5个属性）。',
  category: 'crud',
  parameters: {
    type: { type: 'string', description: '实体类型筛选（可选）', required: false } satisfies ToolParameter,
    keyword: { type: 'string', description: '名称/描述关键词筛选（可选）', required: false } satisfies ToolParameter,
    limit: { type: 'number', description: '返回数量上限，默认20', required: false } satisfies ToolParameter,
  },
  availability: {
    platforms: ['web', 'tauri', 'cli'],
    chain: ['internal', 'cli', 'mcp'],
  },
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

const entityGet: CapabilityDeclaration = {
  id: 'entity.get',
  name: 'entity.get',
  description: '根据 ID 获取实体的完整详情（所有属性和描述）。',
  category: 'crud',
  parameters: {
    id: { type: 'string', description: '实体 ID', required: true } satisfies ToolParameter,
  },
  availability: {
    platforms: ['web', 'tauri', 'cli'],
    chain: ['internal', 'cli', 'mcp'],
  },
  execute: async (args, ctx) => {
    const entity = await ctx.stores.entity.getById(String(args.id))
    if (!entity) return JSON.stringify({ error: '实体未找到' })
    emitEntityCard(ctx, entity)
    return JSON.stringify(entity)
  },
}

const entityCreate: CapabilityDeclaration = {
  id: 'entity.create',
  name: 'entity.create',
  description: '创建新实体。需要 type 和 name，可选 description 和 properties。',
  category: 'crud',
  parameters: {
    type: { type: 'string', description: '实体类型', required: true } satisfies ToolParameter,
    name: { type: 'string', description: '实体名称', required: true } satisfies ToolParameter,
    description: { type: 'string', description: '实体描述', required: false } satisfies ToolParameter,
    properties: { type: 'object', description: '实体属性（键值对）', required: false } satisfies ToolParameter,
  },
  availability: {
    platforms: ['web', 'tauri', 'cli'],
    chain: ['internal', 'cli', 'mcp'],
  },
  schemaContext: {
    fieldPolicy: 'prefer-defined',
    resolveFields: (_ctx: IToolContext) => {
      const types = entitySchemaRegistry.getAll()
      const allFields: FieldDefinition[] = []
      for (const t of types) {
        allFields.push(...resolveFieldsForType(t.typeKey))
      }
      return allFields
    },
  },
  execute: async (args, ctx) => {
    const entityType = String(args.type)
    const entityName = String(args.name)
    if (ctx.projectInfo?.entityTypes?.length && !ctx.projectInfo.entityTypes.includes(entityType)) {
      return JSON.stringify({
        error: `实体类型 "${entityType}" 不在允许列表中`,
        allowedTypes: ctx.projectInfo.entityTypes,
        hint: '请使用 entity.list 查看现有类型，或使用允许列表中的类型',
      })
    }
    const entities = await ctx.stores.entity.getAllEntities()
    const duplicate = entities.some((e: any) => e.type === entityType && e.name === entityName)
    if (duplicate) {
      return JSON.stringify({ error: `类型 "${entityType}" 下已存在同名实体 "${entityName}"`, hint: '请使用不同的名称或先查看 entity.list' })
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
    return JSON.stringify({ success: true, id, name: entity.name })
  },
}

const entityUpdate: CapabilityDeclaration = {
  id: 'entity.update',
  name: 'entity.update',
  description: '更新实体属性。只能更新 name、description、properties 中的字段。',
  category: 'crud',
  parameters: {
    id: { type: 'string', description: '实体 ID', required: true } satisfies ToolParameter,
    name: { type: 'string', description: '新名称（可选）', required: false } satisfies ToolParameter,
    description: { type: 'string', description: '新描述（可选）', required: false } satisfies ToolParameter,
    properties: { type: 'object', description: '要更新的属性键值对（合并，不覆盖未提及的键）', required: false } satisfies ToolParameter,
  },
  availability: {
    platforms: ['web', 'tauri', 'cli'],
    chain: ['internal', 'cli', 'mcp'],
  },
  schemaContext: {
    fieldPolicy: 'prefer-defined',
    resolveFields: (_ctx: IToolContext) => {
      const types = entitySchemaRegistry.getAll()
      const allFields: FieldDefinition[] = []
      for (const t of types) {
        allFields.push(...resolveFieldsForType(t.typeKey))
      }
      return allFields
    },
  },
  execute: async (args, ctx) => {
    const changes: Record<string, unknown> = {}
    if (args.name) changes.name = String(args.name)
    if (args.description) changes.description = String(args.description)
    if (args.properties && typeof args.properties === 'object') {
      const existing = await ctx.stores.entity.getById(String(args.id))
      changes.properties = { ...(existing?.properties || {}), ...(args.properties as Record<string, unknown>) }
    }
    await ctx.stores.entity.update(String(args.id), changes, 'agent')
    const updated = await ctx.stores.entity.getById(String(args.id))
    if (updated) emitEntityCard(ctx, updated)
    return JSON.stringify({ success: true, id: args.id })
  },
}

const entityDelete: CapabilityDeclaration = {
  id: 'entity.delete',
  name: 'entity.delete',
  description: '删除指定实体及其所有关联关系。此操作不可逆。',
  category: 'crud',
  parameters: {
    id: { type: 'string', description: '实体 ID', required: true } satisfies ToolParameter,
  },
  availability: {
    platforms: ['web', 'tauri', 'cli'],
    chain: ['internal', 'cli', 'mcp'],
  },
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
    ctx.emitA2UI?.(`entity-${entityId}`, { version: 'v0.9', deleteSurface: { surfaceId: `entity-${entityId}` } })
    return JSON.stringify({ success: true, id: args.id, name: entityName, deletedRelations: linkedRelations.length })
  },
}

const entitySchemaGetFields: CapabilityDeclaration = {
  id: 'entity.schema.getFields',
  name: 'entity.schema.getFields',
  description: '获取指定实体类型的字段定义列表，包含字段名、类型、是否必填、默认值等信息。',
  category: 'query',
  parameters: {
    entityType: { type: 'string', description: '实体类型', required: true } satisfies ToolParameter,
  },
  availability: {
    platforms: ['web', 'tauri', 'cli'],
    chain: ['internal', 'cli', 'mcp'],
  },
  execute: async (args, _ctx) => {
    const entityType = String(args.entityType)
    const fields = resolveFieldsForType(entityType)
    if (fields.length === 0) {
      return JSON.stringify({ error: `未找到实体类型 "${entityType}" 的字段定义`, availableTypes: entitySchemaRegistry.getAll().map(s => s.typeKey) })
    }
    return JSON.stringify({ entityType, fields })
  },
}

const entitySchemaValidate: CapabilityDeclaration = {
  id: 'entity.schema.validate',
  name: 'entity.schema.validate',
  description: '根据实体类型的 schema 验证实体数据。在支持完整验证的平台上使用 schema 验证，否则回退到基础验证。',
  category: 'query',
  parameters: {
    entityType: { type: 'string', description: '实体类型', required: true } satisfies ToolParameter,
    data: { type: 'object', description: '要验证的实体数据', required: true } satisfies ToolParameter,
  },
  availability: {
    platforms: ['web', 'tauri', 'cli'],
    chain: ['internal', 'cli', 'mcp'],
    fallback: 'entity.schema.validate.basic',
  },
  execute: async (args, _ctx) => {
    const entityType = String(args.entityType)
    const data = args.data as Record<string, unknown>
    const validation = getValidationApi()
    if (validation.validateEntity) {
      const report = await validation.validateEntity(entityType, data)
      return JSON.stringify(report)
    }
    return basicValidate(entityType, data)
  },
}

const entitySchemaValidateBasic: CapabilityDeclaration = {
  id: 'entity.schema.validate.basic',
  name: 'entity.schema.validate.basic',
  description: '基础验证：检查必填字段是否存在，字段类型是否匹配。适用于 CLI 等不支持完整验证的平台。',
  category: 'query',
  parameters: {
    entityType: { type: 'string', description: '实体类型', required: true } satisfies ToolParameter,
    data: { type: 'object', description: '要验证的实体数据', required: true } satisfies ToolParameter,
  },
  availability: {
    platforms: ['web', 'tauri', 'cli'],
    chain: ['internal', 'cli', 'mcp'],
  },
  execute: async (args, _ctx) => {
    const entityType = String(args.entityType)
    const data = args.data as Record<string, unknown>
    return basicValidate(entityType, data)
  },
}

function basicValidate(entityType: string, data: Record<string, unknown>): string {
  const fields = resolveFieldsForType(entityType)
  if (fields.length === 0) {
    return JSON.stringify({ valid: false, errors: [{ path: 'entityType', message: `未找到实体类型 "${entityType}" 的字段定义` }] })
  }
  const errors: { path: string; message: string }[] = []
  for (const field of fields) {
    if (field.required && (data[field.key] === undefined || data[field.key] === null || data[field.key] === '')) {
      errors.push({ path: field.key, message: `必填字段 "${field.label}" 缺失` })
    }
    const value = data[field.key]
    if (value !== undefined && value !== null) {
      if (field.type === 'number' && typeof value !== 'number') {
        errors.push({ path: field.key, message: `字段 "${field.label}" 应为数字类型` })
      }
      if (field.type === 'boolean' && typeof value !== 'boolean') {
        errors.push({ path: field.key, message: `字段 "${field.label}" 应为布尔类型` })
      }
      if (field.enum && field.enum.length > 0 && typeof value === 'string' && !field.enum.includes(value)) {
        errors.push({ path: field.key, message: `字段 "${field.label}" 的值 "${value}" 不在允许的枚举范围内: ${field.enum.join(', ')}` })
      }
    }
  }
  return JSON.stringify({ valid: errors.length === 0, errors })
}

export const entityCoreDescriptor: LibraryDescriptor = {
  id: '@worldsmith/entity-core',
  name: 'Entity Core',
  version: '0.1.0',
  capabilities: [
    entityList,
    entityGet,
    entityCreate,
    entityUpdate,
    entityDelete,
    entitySchemaGetFields,
    entitySchemaValidate,
    entitySchemaValidateBasic,
  ],
}
