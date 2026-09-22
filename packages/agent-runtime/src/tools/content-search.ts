/** 内容搜索工具：跨实体类型关键词 + 语义混合搜索，详细见 docs/details/注释/packages/agent-runtime/tools-content-search.md */

import type { ToolDefinition } from '../bridge-types'
import type { ToolMeta } from '@worldsea/agent-core'
import { semanticSearchEntities, isEmbeddingReady } from '../embedding/index'
import type { SearchResultV2 } from '../embedding/vector-store-v2'

/** 描述字段预览长度限制 */
const DESCRIPTION_PREVIEW_LENGTH = 120

/** 混合搜索结果 */
interface HybridResult {
  id: string
  name: string
  type: string
  description?: string
  matchedProperties?: Record<string, string>
  score: number
  matchType: 'keyword' | 'semantic' | 'both'
}

/** 关键词搜索：name/description/properties 匹配 + 截断预览，详细见 docs/details/注释/packages/agent-runtime/tools-content-search.md */
function keywordSearch(
  entities: import('./types').EntityLike[],
  kw: string,
  scope: string,
  limit: number,
): HybridResult[] {
  return entities.filter(e => {
    if ((scope === 'name' || scope === 'all') && e.name.toLowerCase().includes(kw)) return true
    if ((scope === 'description' || scope === 'all') && e.description.toLowerCase().includes(kw)) return true
    if ((scope === 'properties' || scope === 'all') && e.properties) {
      for (const val of Object.values(e.properties)) {
        if (String(val).toLowerCase().includes(kw)) return true
      }
    }
    return false
  }).slice(0, limit).map(e => {
    const desc = e.description || ''
    const preview = desc.length > DESCRIPTION_PREVIEW_LENGTH
      ? desc.slice(0, DESCRIPTION_PREVIEW_LENGTH) + '...'
      : desc
    const matchedProps: Record<string, string> = {}
    if (e.properties && (scope === 'properties' || scope === 'all')) {
      for (const [k, v] of Object.entries(e.properties)) {
        if (String(v).toLowerCase().includes(kw)) {
          matchedProps[k] = String(v).length > 80 ? String(v).slice(0, 80) + '...' : String(v)
        }
      }
    }
    return {
      id: e.id,
      name: e.name,
      type: e.type,
      description: preview || undefined,
      matchedProperties: Object.keys(matchedProps).length > 0 ? matchedProps : undefined,
      score: 0.5,
      matchType: 'keyword' as const,
    }
  })
}

/**
 * 执行语义搜索
 * @returns entityId → SearchResultV2 的 Map
 */
async function doSemanticSearch(
  keyword: string,
  limit: number,
): Promise<Map<string, SearchResultV2>> {
  if (!isEmbeddingReady()) return new Map()
  try {
    const results = await semanticSearchEntities(keyword, limit, 0.25)
    const map = new Map<string, SearchResultV2>()
    for (const r of results) {
      const entityId = r.metadata.entityId || r.id.replace('entity_', '')
      map.set(entityId, r)
    }
    return map
  } catch {
    return new Map()
  }
}

/**
 * 合并关键词和语义搜索结果
 *
 * 策略：
 * - 同时出现在两个结果中的条目标记为 "both"，取语义高分
 * - 独立结果保留原分数
 * - 排序优先级: both > 其他，同类型按 score 降序
 */
function mergeResults(
  keywordResults: HybridResult[],
  semanticMap: Map<string, SearchResultV2>,
  limit: number,
): HybridResult[] {
  if (semanticMap.size === 0) {
    return keywordResults.slice(0, limit)
  }

  const merged = new Map<string, HybridResult>()

  for (const r of keywordResults) {
    const sem = semanticMap.get(r.id)
    if (sem) {
      merged.set(r.id, { ...r, score: sem.score, matchType: 'both' })
      semanticMap.delete(r.id)
    } else {
      merged.set(r.id, r)
    }
  }

  for (const [id, sem] of semanticMap) {
    merged.set(id, {
      id,
      name: sem.metadata.name || id,
      type: sem.metadata.type || 'unknown',
      score: sem.score,
      matchType: 'semantic',
    })
  }

  const sorted = [...merged.values()].sort((a, b) => {
    if (a.matchType === 'both' && b.matchType !== 'both') return -1
    if (a.matchType !== 'both' && b.matchType === 'both') return 1
    return b.score - a.score
  })

  return sorted.slice(0, limit)
}

/** content_search 工具：混合/关键词/语义三种搜索模式，详细见 docs/details/注释/packages/agent-runtime/tools-content-search.md */
export const contentSearchTool: ToolDefinition = {
  name: 'content_search',
  description: '在项目的所有实体中搜索内容。支持语义搜索（理解含义）和关键词搜索（精确匹配）的混合模式。语义搜索能找到意思相近但不包含关键词的内容；关键词搜索能精确匹配文本。使用场景：模糊查找、概念搜索、精确匹配。',
  parameters: {
    keyword: { type: 'string', description: '搜索关键词或描述', required: true },
    scope: { type: 'string', description: '关键词搜索范围: name/description/properties/all，默认 all', required: false, enum: ['name', 'description', 'properties', 'all'] },
    limit: { type: 'number', description: '返回数量上限，默认20', required: false },
    mode: { type: 'string', description: '搜索模式: hybrid(语义+关键词混合)/keyword(纯关键词)/semantic(纯语义)，默认 hybrid', required: false, enum: ['hybrid', 'keyword', 'semantic'] },
  },
  meta: {
    permission: 'safe',
    readOnly: true,
    sideEffectScope: 'workspace',
    concurrentSafe: true,
    requiresUserInteraction: false,
    alwaysAsk: false,
    category: 'search',
    alwaysAvailable: true,
    displayName: '内容搜索',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    const kw = String(args.keyword).toLowerCase()
    const scope = String(args.scope || 'all')
    const limit = Number(args.limit) || 20
    const mode = String(args.mode || 'hybrid')
    const keywordStr = String(args.keyword)

    if (mode === 'semantic') {
      if (!isEmbeddingReady()) {
        return JSON.stringify({ keyword: keywordStr, mode, total: 0, results: [], note: '语义搜索需要配置 Embedding API' })
      }
      const semMap = await doSemanticSearch(keywordStr, limit)
      const results: HybridResult[] = []
      for (const [id, sem] of semMap) {
        const entity = await ctx.stores.entity.getById(id)
        const desc = entity?.description || ''
        const preview = desc.length > DESCRIPTION_PREVIEW_LENGTH
          ? desc.slice(0, DESCRIPTION_PREVIEW_LENGTH) + '...'
          : desc
        results.push({
          id,
          name: entity?.name || sem.metadata.name || id,
          type: entity?.type || sem.metadata.type || 'unknown',
          description: preview || undefined,
          score: sem.score,
          matchType: 'semantic',
        })
      }
      return JSON.stringify({ keyword: keywordStr, mode, total: results.length, results })
    }

    if (mode === 'keyword') {
      const entities = await ctx.stores.entity.getAllEntities()
      const results = keywordSearch(entities, kw, scope, limit)
      return JSON.stringify({ keyword: keywordStr, mode, scope, total: results.length, results })
    }

    // hybrid 模式：两路搜索并合并
    const entities = await ctx.stores.entity.getAllEntities()
    const kwResults = keywordSearch(entities, kw, scope, limit * 2)
    const semMap = await doSemanticSearch(keywordStr, limit * 2)
    const results = mergeResults(kwResults, semMap, limit)

    // 补全语义搜索结果中缺失的 name/type/description
    const enriched = await Promise.all(results.map(async r => {
      if (r.matchType === 'semantic' && !r.description) {
        const entity = await ctx.stores.entity.getById(r.id)
        if (entity) {
          const desc = entity.description || ''
          const preview = desc.length > DESCRIPTION_PREVIEW_LENGTH
            ? desc.slice(0, DESCRIPTION_PREVIEW_LENGTH) + '...'
            : desc
          r.name = entity.name
          r.type = entity.type
          r.description = preview || undefined
        }
      }
      return r
    }))

    return JSON.stringify({ keyword: keywordStr, mode, scope, total: enriched.length, results: enriched })
  },
}

export const contentSearchTools: ToolDefinition[] = [contentSearchTool]
