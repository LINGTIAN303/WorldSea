/** 实体上下文聚合工具：七种 scope 粒度一站式上下文获取，详细见 docs/details/注释/packages/agent-runtime/tools-entity-context.md */

import type { ToolDefinition } from '../bridge-types'
import type { ToolMeta } from '@worldsea/agent-core'
import { semanticSearchEntities, isEmbeddingReady } from '../embedding/index'

/** 关系遍历深度上限 */
const MAX_DEPTH = 3
/** 同类型实体预览属性数量 */
const PREVIEW_PROP_COUNT = 5
/** 属性值截断长度 */
const VALUE_TRUNCATE = 200

type EntityContextScope = 'full' | 'relations_only' | 'same_type_entities' | 'schema_detail' | 'semantic_related' | 'field_context' | 'cross_type_relations'

/** 字段定义预览 */
interface FieldDefPreview {
  key: string
  label: string
  type: string
  required: boolean
  description?: string
}

/** 关联实体预览 */
interface RelatedEntityPreview {
  id: string
  name: string
  type: string
  relationType: string
  direction: 'outgoing' | 'incoming'
  preview: Record<string, unknown>
}

/** 同类型实体预览 */
interface SameTypeEntityPreview {
  id: string
  name: string
  preview: Record<string, unknown>
  description?: string
}

/** 语义匹配结果 */
interface SemanticMatchPreview {
  id: string
  name: string
  type: string
  score: number
}

/** entity_get_context 返回结构 */
interface EntityContextResult {
  entity?: {
    id: string
    name: string
    type: string
    description: string
    properties: Record<string, unknown>
    tags: string[]
  }
  relatedEntities?: RelatedEntityPreview[]
  sameTypeEntities?: SameTypeEntityPreview[]
  schema?: {
    typeKey: string
    label: string
    icon: string
    fields: FieldDefPreview[]
  }
  relations?: Array<{
    id: string
    type: string
    sourceId: string
    targetId: string
    label?: string
  }>
  semanticMatches?: SemanticMatchPreview[]
  fieldContext?: {
    fieldKey: string
    sameFieldValues: Array<{ entityId: string; entityName: string; value: unknown }>
    relatedFieldSnippets: Array<{ entityId: string; entityName: string; snippet: string }>
    fieldSchema: { key: string; label: string; type: string; required: boolean; description?: string }
  }
  crossTypeRelations?: {
    targetType: string
    relations: Array<{ id: string; type: string; sourceId: string; targetId: string; label?: string }>
    targetEntities: Array<{ id: string; name: string; type: string; preview: Record<string, unknown> }>
  }
  scope: EntityContextScope
  notes: string[]
}

function truncateValue(val: unknown, maxLen: number = VALUE_TRUNCATE): unknown {
  if (val == null) return val
  const str = String(val)
  return str.length > maxLen ? str.slice(0, maxLen) + '...' : str
}

function extractPreview(entity: any): Record<string, unknown> {
  if (!entity.properties) return {}
  const entries = Object.entries(entity.properties).slice(0, PREVIEW_PROP_COUNT)
  return Object.fromEntries(entries.map(([k, v]) => [k, truncateValue(v)]))
}

/**
 * 获取关联实体
 */
async function getRelatedEntities(
  entityId: string,
  allRelations: any[],
  entityStore: any,
  depth: number,
  visited: Set<string>,
): Promise<RelatedEntityPreview[]> {
  if (depth <= 0 || visited.has(entityId)) return []
  visited.add(entityId)

  const results: RelatedEntityPreview[] = []
  const linkedRelations = allRelations.filter(
    (r: any) => r.sourceId === entityId || r.targetId === entityId,
  )

  for (const rel of linkedRelations) {
    const isOutgoing = rel.sourceId === entityId
    const peerId = isOutgoing ? rel.targetId : rel.sourceId
    if (visited.has(peerId)) continue

    const peerEntity = await entityStore.getById(peerId)
    if (peerEntity) {
      results.push({
        id: peerEntity.id,
        name: peerEntity.name,
        type: peerEntity.type,
        relationType: rel.type,
        direction: isOutgoing ? 'outgoing' : 'incoming',
        preview: extractPreview(peerEntity),
      })
    }
  }

  return results
}

/**
 * 尝试获取 Schema 定义（Tauri 模式下可用，Web 模式回退）
 */
async function tryGetSchema(typeKey: string): Promise<EntityContextResult['schema'] | undefined> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const result = await invoke('cmd_schema_get_entity_type', { typeKey }) as any
    if (result && result.fields) {
      const fields: FieldDefPreview[] = (result.fields as any[]).map((f: any) => ({
        key: f.key || f.name || '',
        label: f.label || f.key || '',
        type: f.type || 'text',
        required: !!f.required,
        description: f.description || f.placeholder || undefined,
      }))
      return {
        typeKey: result.typeKey || typeKey,
        label: result.label || typeKey,
        icon: result.icon || '',
        fields,
      }
    }
  } catch {
    // Tauri 不可用时静默回退
  }
  return undefined
}

/**
 * 语义搜索相关实体
 */
async function getSemanticMatches(
  query: string,
  excludeId: string | undefined,
  topK: number,
): Promise<SemanticMatchPreview[]> {
  if (!isEmbeddingReady()) return []
  try {
    const results = await semanticSearchEntities(query, topK, 0.3)
    return results
      .filter(r => {
        const eid = r.metadata.entityId || r.id.replace('entity_', '')
        return eid !== excludeId
      })
      .map(r => ({
        id: r.metadata.entityId || r.id.replace('entity_', ''),
        name: r.metadata.name || '',
        type: r.metadata.type || 'unknown',
        score: r.score,
      }))
  } catch {
    return []
  }
}

/** entity_get_context — 聚合获取实体上下文 */
export const entityGetContextTool: ToolDefinition = {
  name: 'entity_get_context',
  description:
    '获取实体的完整上下文信息，用于智能填充和内容生成。支持7种粒度：' +
    'full(全量：当前实体+关联实体+同类型实体+Schema+语义相关)、' +
    'relations_only(仅关联实体与关系)、' +
    'same_type_entities(仅同类型已有实体)、' +
    'schema_detail(仅Schema字段定义)、' +
    'semantic_related(仅语义相关实体)、' +
    'field_context(仅指定字段的上下文，需传fieldKey)、' +
    'cross_type_relations(仅与指定目标类型的跨类型关系，需传targetType)。' +
    'Agent可按需选择scope，避免一次加载过多数据。',
  parameters: {
    entityId: {
      type: 'string',
      description: '实体ID（可选，编辑已有实体时提供；新建实体时可不传）',
      required: false,
    },
    entityType: {
      type: 'string',
      description: '实体类型（必须提供，如 "character"、"region"、"building" 等）',
      required: true,
    },
    scope: {
      type: 'string',
      description: '获取粒度：full/relations_only/same_type_entities/schema_detail/semantic_related/field_context/cross_type_relations，默认 full',
      required: false,
      enum: ['full', 'relations_only', 'same_type_entities', 'schema_detail', 'semantic_related', 'field_context', 'cross_type_relations'],
    },
    depth: {
      type: 'number',
      description: '关系遍历深度（1-3），默认1。仅在 scope 包含关联实体时生效',
      required: false,
    },
    limit: {
      type: 'number',
      description: '各部分返回数量上限，默认10',
      required: false,
    },
    query: {
      type: 'string',
      description: '语义搜索查询文本（可选，默认用实体名称+描述作为查询）',
      required: false,
    },
    fieldKey: {
      type: 'string',
      description: '字段键名（scope=field_context 时必填，仅返回与该字段语义相关的上下文）',
      required: false,
    },
    targetType: {
      type: 'string',
      description: '目标实体类型（scope=cross_type_relations 时必填，返回与该类型实体的跨类型关系）',
      required: false,
    },
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
    displayName: '获取实体上下文',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    const scope = String(args.scope || 'full') as EntityContextScope
    const depth = Math.min(Math.max(Number(args.depth) || 1, 1), MAX_DEPTH)
    const limit = Number(args.limit) || 10
    const entityId = args.entityId ? String(args.entityId) : undefined
    const entityType = String(args.entityType)

    const result: EntityContextResult = { scope, notes: [] }

    // 1. 获取当前实体
    let entity: any = undefined
    if (entityId) {
      entity = await ctx.stores.entity.getById(entityId)
      if (!entity) {
        return JSON.stringify({ error: `实体 ${entityId} 不存在`, hint: '请确认 ID 是否正确' })
      }
      result.entity = {
        id: entity.id,
        name: entity.name,
        type: entity.type,
        description: entity.description || '',
        properties: entity.properties || {},
        tags: entity.tags || [],
      }
    }

    // 2. 根据 scope 收集上下文
    const needRelated = scope === 'full' || scope === 'relations_only'
    const needSameType = scope === 'full' || scope === 'same_type_entities'
    const needSchema = scope === 'full' || scope === 'schema_detail'
    const needSemantic = scope === 'full' || scope === 'semantic_related'

    // 并行获取各部分
    const [allEntities, allRelations] = await Promise.all([
      ctx.stores.entity.getAllEntities(),
      ctx.stores.relation.getAllRelations(),
    ])

    // 2a. 关联实体
    if (needRelated && entityId) {
      const visited = new Set<string>()
      const related = await getRelatedEntities(entityId, allRelations, ctx.stores.entity, depth, visited)
      result.relatedEntities = related.slice(0, limit)

      // 也返回原始关系
      const linkedRels = allRelations.filter(
        (r: any) => r.sourceId === entityId || r.targetId === entityId,
      )
      result.relations = linkedRels.slice(0, limit).map((r: any) => ({
        id: r.id,
        type: r.type,
        sourceId: r.sourceId,
        targetId: r.targetId,
        label: r.label || undefined,
      }))

      if (related.length === 0) {
        result.notes.push('该实体暂无关联实体')
      }
    } else if (needRelated && !entityId) {
      result.notes.push('新建实体无关联数据')
    }

    // 2b. 同类型实体
    if (needSameType) {
      const sameType = allEntities
        .filter((e: any) => e.type === entityType && e.id !== entityId)
        .slice(0, limit)
      result.sameTypeEntities = sameType.map((e: any) => ({
        id: e.id,
        name: e.name,
        preview: extractPreview(e),
        description: (e.description || '').length > VALUE_TRUNCATE
          ? e.description.slice(0, VALUE_TRUNCATE) + '...'
          : e.description || undefined,
      }))

      if (sameType.length === 0) {
        result.notes.push(`尚无类型为 "${entityType}" 的其他实体`)
      }
    }

    // 2c. Schema 定义
    if (needSchema) {
      const schema = await tryGetSchema(entityType)
      if (schema) {
        result.schema = schema
      } else {
        result.notes.push(`类型 "${entityType}" 的 Schema 定义不可用（可能为 Web 模式或类型未注册）`)
      }
    }

    // 2d. 语义相关实体
    if (needSemantic) {
      const queryText = String(args.query || '')
        || (entity ? `${entity.name} ${entity.description || ''}` : entityType)
      const semanticMatches = await getSemanticMatches(queryText, entityId, limit)

      if (semanticMatches.length > 0) {
        result.semanticMatches = semanticMatches
      } else if (isEmbeddingReady()) {
        result.notes.push('语义搜索未找到相关实体')
      } else {
        result.notes.push('语义搜索不可用（未配置 Embedding API），仅关键词上下文可用')
      }
    }

    // 2e. 字段上下文（field_context）
    if (scope === 'field_context') {
      const fieldKey = args.fieldKey ? String(args.fieldKey) : undefined
      if (!fieldKey) {
        result.notes.push('scope=field_context 但未提供 fieldKey，跳过字段上下文获取')
      } else {
        // 同类型实体中该字段的值
        const sameFieldValues: Array<{ entityId: string; entityName: string; value: unknown }> = []
        for (const e of allEntities) {
          if (e.type === entityType && e.id !== entityId && e.properties && fieldKey in e.properties) {
            sameFieldValues.push({
              entityId: e.id,
              entityName: e.name,
              value: truncateValue(e.properties[fieldKey]),
            })
            if (sameFieldValues.length >= limit) break
          }
        }

        // 关联实体中搜索描述片段和匹配字段值
        const relatedFieldSnippets: Array<{ entityId: string; entityName: string; snippet: string }> = []
        if (entityId) {
          const visited = new Set<string>()
          const relatedEntities = await getRelatedEntities(entityId, allRelations, ctx.stores.entity, depth, visited)
          for (const re of relatedEntities) {
            const reEntity = await ctx.stores.entity.getById(re.id)
            if (!reEntity) continue
            // 搜索描述中的相关片段
            const desc = reEntity.description || ''
            if (desc && (desc.includes(fieldKey) || (entity && desc.includes(entity.name)))) {
              const snippet = desc.length > VALUE_TRUNCATE
                ? desc.slice(0, VALUE_TRUNCATE) + '...'
                : desc
              relatedFieldSnippets.push({
                entityId: re.id,
                entityName: re.name,
                snippet,
              })
            }
            // 搜索匹配字段值
            if (reEntity.properties && fieldKey in reEntity.properties) {
              const val = String(reEntity.properties[fieldKey])
              const snippet = val.length > VALUE_TRUNCATE
                ? val.slice(0, VALUE_TRUNCATE) + '...'
                : val
              relatedFieldSnippets.push({
                entityId: re.id,
                entityName: re.name,
                snippet: `[${fieldKey}]: ${snippet}`,
              })
            }
            if (relatedFieldSnippets.length >= limit) break
          }
        }

        // 获取字段 Schema 定义
        let fieldSchema: { key: string; label: string; type: string; required: boolean; description?: string } | undefined
        const schema = await tryGetSchema(entityType)
        if (schema) {
          const matched = schema.fields.find(f => f.key === fieldKey)
          if (matched) {
            fieldSchema = matched
          }
        }

        result.fieldContext = {
          fieldKey,
          sameFieldValues,
          relatedFieldSnippets,
          fieldSchema: fieldSchema || { key: fieldKey, label: fieldKey, type: 'unknown', required: false },
        }

        if (sameFieldValues.length === 0 && relatedFieldSnippets.length === 0) {
          result.notes.push(`字段 "${fieldKey}" 暂无同类型值或关联片段`)
        }
      }
    }

    // 2f. 跨类型关系（cross_type_relations）
    if (scope === 'cross_type_relations') {
      const targetType = args.targetType ? String(args.targetType) : undefined
      if (!targetType) {
        result.notes.push('scope=cross_type_relations 但未提供 targetType，跳过跨类型关系获取')
      } else if (!entityId) {
        result.notes.push('scope=cross_type_relations 需要 entityId，当前未提供')
      } else {
        // 筛选涉及当前实体的关系
        const linkedRels = allRelations.filter(
          (r: any) => r.sourceId === entityId || r.targetId === entityId,
        )

        const matchedRelations: Array<{ id: string; type: string; sourceId: string; targetId: string; label?: string }> = []
        const targetEntities: Array<{ id: string; name: string; type: string; preview: Record<string, unknown> }> = []
        const seenPeerIds = new Set<string>()

        for (const rel of linkedRels) {
          const peerId = rel.sourceId === entityId ? rel.targetId : rel.sourceId
          if (seenPeerIds.has(peerId)) continue
          seenPeerIds.add(peerId)

          const peerEntity = await ctx.stores.entity.getById(peerId)
          if (peerEntity && peerEntity.type === targetType) {
            matchedRelations.push({
              id: rel.id,
              type: rel.type,
              sourceId: rel.sourceId,
              targetId: rel.targetId,
              label: rel.label || undefined,
            })
            targetEntities.push({
              id: peerEntity.id,
              name: peerEntity.name,
              type: peerEntity.type,
              preview: extractPreview(peerEntity),
            })
          }
        }

        result.crossTypeRelations = {
          targetType,
          relations: matchedRelations.slice(0, limit),
          targetEntities: targetEntities.slice(0, limit),
        }

        if (matchedRelations.length === 0) {
          result.notes.push(`未找到与类型 "${targetType}" 的跨类型关系`)
        }
      }
    }

    return JSON.stringify(result)
  },
}

export const entityContextTools: ToolDefinition[] = [entityGetContextTool]
