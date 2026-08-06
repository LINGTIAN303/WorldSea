/** 长期记忆模块：localStorage + Embedding 双层记忆系统，详细见 docs/details/注释/packages/agent-runtime/tools-memory.md */

import type { ToolDefinition } from '../bridge-types'
import type { ToolMeta } from '@worldsmith/agent-core'
import { semanticSearchMemory, indexMemoryEntry, removeMemoryIndex, isEmbeddingReady } from '../embedding/index'
import { loadMemory, saveMemory, evictIfNeeded, type MemoryEntry } from './memory-internal'

const MAX_VALUE_LENGTH = 2000

/** 关键词检索：key/value/tag 评分加权排序，详细见 docs/details/注释/packages/agent-runtime/tools-memory.md */
function keywordRecall(entries: MemoryEntry[], query: string): { entry: MemoryEntry; score: number }[] {
  const q = query.toLowerCase()
  return entries.map(e => {
    let score = 0
    if (e.key.toLowerCase().includes(q)) score += 3
    if (e.value.toLowerCase().includes(q)) score += 2
    for (const tag of e.tags) {
      if (tag.toLowerCase() === q) score += 4
      else if (tag.toLowerCase().includes(q)) score += 1
    }
    score += e.accessCount * 0.1
    return { entry: e, score }
  }).filter(s => s.score > 0)
}

/** 统一的记忆召回函数（混合模式核心：关键词 + 语义合并），详细见 docs/details/注释/packages/agent-runtime/tools-memory.md */
export async function recallMemory(query: string, limit: number = 5): Promise<MemoryEntry[]> {
  const entries = loadMemory()
  if (!query) return entries.slice(0, limit)

  const kwScored = keywordRecall(entries, query)
  const kwMap = new Map<string, { entry: MemoryEntry; score: number }>()
  for (const s of kwScored) {
    kwMap.set(s.entry.key, s)
  }

  if (isEmbeddingReady()) {
    try {
      const semResults = await semanticSearchMemory(query, limit * 2, 0.25)
      for (const sem of semResults) {
        const key = sem.metadata.key || sem.id.replace('memory_', '')
        const existing = kwMap.get(key)
        if (existing) {
          existing.score = Math.max(existing.score, sem.score * 5)
        } else {
          const entry = entries.find(e => e.key === key)
          if (entry) {
            kwMap.set(key, { entry, score: sem.score * 5 })
          }
        }
      }
    } catch {}
  }

  const allScored = [...kwMap.values()]
  allScored.sort((a, b) => b.score - a.score)
  const results = allScored.slice(0, limit).map(s => s.entry)

  for (const r of results) {
    r.accessCount++
    r.lastAccessedAt = Date.now()
  }
  if (results.length > 0) saveMemory(entries)
  return results
}

/** 将记忆条目格式化为提示词可注入的文本 */
export function formatMemoryForPrompt(entries: MemoryEntry[]): string {
  if (entries.length === 0) return ''
  const lines = entries.map(e => {
    const tagStr = e.tags.length > 0 ? ` [${e.tags.join(',')}]` : ''
    return `- ${e.key}${tagStr}: ${e.value}`
  })
  return `[长期记忆]\n${lines.join('\n')}`
}

/**
 * memory_store 工具
 * 存储一条记忆。key 重复时更新内容，保留原始 timestamp。
 * 存储后会异步写入 Embedding 向量索引。
 */
export const memoryStoreTool: ToolDefinition = {
  name: 'memory_store',
  description: '将重要信息保存到长期记忆中，跨会话持久保存。用于记住用户偏好、项目关键设定、重要决策等。',
  parameters: {
    key: { type: 'string', description: '记忆条目的键名，如 "user_preference_style" 或 "world_rule_magic_system"', required: true },
    value: { type: 'string', description: '要保存的信息内容', required: true },
    tags: { type: 'string', description: '标签，逗号分隔，用于分类检索，如 "设定,规则,魔法"', required: false },
  },
  meta: {
    permission: 'moderate',
    category: 'memory',
    alwaysAvailable: true,
    displayName: '存储记忆',
  } satisfies ToolMeta,
  execute: async (args) => {
    const key = String(args.key).trim()
    let value = String(args.value).trim()
    const tags = String(args.tags || '').split(',').map(t => t.trim()).filter(Boolean)

    if (!key || !value) {
      return JSON.stringify({ error: 'key 和 value 不能为空' })
    }

    if (value.length > MAX_VALUE_LENGTH) {
      value = value.slice(0, MAX_VALUE_LENGTH) + '...[已截断]'
    }

    const entries = loadMemory()
    const existing = entries.findIndex(e => e.key === key)
    const now = Date.now()
    const entry: MemoryEntry = {
      key, value, tags,
      timestamp: existing >= 0 ? entries[existing].timestamp : now,
      accessCount: existing >= 0 ? entries[existing].accessCount : 0,
      lastAccessedAt: now,
    }

    if (existing >= 0) {
      entries[existing] = entry
    } else {
      entries.push(entry)
    }

    const { kept, evictedKeys } = evictIfNeeded(entries)
    saveMemory(kept)

    for (const ek of evictedKeys) {
      removeMemoryIndex(ek).catch(() => {})
    }

    indexMemoryEntry(key, value, tags).catch(() => {})

    return JSON.stringify({
      success: true,
      key,
      action: existing >= 0 ? 'updated' : 'created',
      totalEntries: kept.length,
      ...(evictedKeys.length > 0 ? { evicted: evictedKeys.length } : {}),
    })
  },
}

/**
 * memory_recall 工具
 * 支持三种检索模式：keyword / semantic / hybrid
 */
export const memoryRecallTool: ToolDefinition = {
  name: 'memory_recall',
  description: '从长期记忆中检索信息。支持语义搜索（理解含义）和关键词搜索。使用场景：回忆之前的设定、查找用户偏好、恢复上下文。返回匹配的记忆列表。',
  parameters: {
    query: { type: 'string', description: '搜索关键词或描述，为空则列出所有记忆', required: false },
    tags: { type: 'string', description: '按标签筛选，逗号分隔', required: false },
    limit: { type: 'number', description: '返回数量上限，默认10', required: false },
    mode: { type: 'string', description: '搜索模式: hybrid(语义+关键词混合)/keyword(纯关键词)/semantic(纯语义)，默认 hybrid', required: false, enum: ['hybrid', 'keyword', 'semantic'] },
  },
  meta: {
    permission: 'safe',
    category: 'memory',
    alwaysAvailable: true,
    displayName: '回忆记忆',
  } satisfies ToolMeta,
  execute: async (args) => {
    const query = String(args.query || '').trim()
    const tags = String(args.tags || '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
    const limit = Number(args.limit) || 10
    const mode = String(args.mode || 'hybrid')

    const entries = loadMemory()

    if (mode === 'semantic') {
      if (!isEmbeddingReady()) {
        return JSON.stringify({ message: '语义搜索需要配置 Embedding API', totalEntries: entries.length })
      }
      if (!query) {
        return JSON.stringify({ message: '语义搜索需要提供查询内容', totalEntries: entries.length })
      }
      try {
        const semResults = await semanticSearchMemory(query, limit, 0.25)
        const results: MemoryEntry[] = []
        for (const sem of semResults) {
          const key = sem.metadata.key || sem.id.replace('memory_', '')
          const entry = entries.find(e => e.key === key)
          if (entry) results.push(entry)
        }
        for (const r of results) {
          r.accessCount++
          r.lastAccessedAt = Date.now()
        }
        if (results.length > 0) saveMemory(entries)
        if (results.length === 0) {
          return JSON.stringify({ message: `未找到与 "${query}" 语义相关的记忆`, totalEntries: entries.length })
        }
        return JSON.stringify({
          results: results.map(e => ({ key: e.key, value: e.value, tags: e.tags, savedAt: new Date(e.timestamp).toISOString(), accessCount: e.accessCount, semanticScore: semResults.find(s => (s.metadata.key || s.id.replace('memory_', '')) === e.key)?.score })),
          count: results.length,
          totalEntries: entries.length,
          mode: 'semantic',
        })
      } catch {
        return JSON.stringify({ message: '语义搜索失败', totalEntries: entries.length })
      }
    }

    if (query && mode === 'hybrid') {
      const recalled = await recallMemory(query, limit * 2)
      let results = recalled
      if (tags.length) {
        results = results.filter(e =>
          tags.some(t => e.tags.some(et => et.toLowerCase() === t))
        )
      }
      results.sort((a, b) => b.lastAccessedAt - a.lastAccessedAt)
      results = results.slice(0, limit)

      if (results.length === 0) {
        return JSON.stringify({ message: `未找到与 "${query}" 相关的记忆`, totalEntries: entries.length })
      }

      return JSON.stringify({
        results: results.map(e => ({ key: e.key, value: e.value, tags: e.tags, savedAt: new Date(e.timestamp).toISOString(), accessCount: e.accessCount })),
        count: results.length,
        totalEntries: entries.length,
        mode,
      })
    }

    let results = entries
    if (query && mode === 'keyword') {
      const q = query.toLowerCase()
      results = results.filter(e =>
        e.key.toLowerCase().includes(q) ||
        e.value.toLowerCase().includes(q)
      )
    }

    if (!query) {
      if (tags.length) {
        results = results.filter(e =>
          tags.some(t => e.tags.some(et => et.toLowerCase() === t))
        )
      }
    }

    results.sort((a, b) => b.lastAccessedAt - a.lastAccessedAt)
    results = results.slice(0, limit)

    for (const r of results) {
      r.accessCount++
      r.lastAccessedAt = Date.now()
    }
    if (results.length > 0) saveMemory(entries)

    if (results.length === 0) {
      return JSON.stringify({ message: query ? `未找到与 "${query}" 相关的记忆` : '暂无记忆条目', totalEntries: entries.length })
    }

    return JSON.stringify({
      results: results.map(e => ({ key: e.key, value: e.value, tags: e.tags, savedAt: new Date(e.timestamp).toISOString(), accessCount: e.accessCount })),
      count: results.length,
      totalEntries: entries.length,
      mode,
    })
  },
}

/**
 * memory_delete 工具
 * 删除指定 key 的记忆，同步清理 Embedding 索引
 */
export const memoryDeleteTool: ToolDefinition = {
  name: 'memory_delete',
  description: '从长期记忆中删除指定条目。',
  parameters: {
    key: { type: 'string', description: '要删除的记忆条目键名', required: true },
  },
  meta: {
    permission: 'dangerous',
    category: 'memory',
    alwaysAvailable: true,
    displayName: '删除记忆',
  } satisfies ToolMeta,
  execute: async (args) => {
    const key = String(args.key).trim()
    const entries = loadMemory()
    const idx = entries.findIndex(e => e.key === key)
    if (idx < 0) {
      return JSON.stringify({ error: `未找到键名为 "${key}" 的记忆` })
    }
    entries.splice(idx, 1)
    saveMemory(entries)

    removeMemoryIndex(key).catch(() => {})

    return JSON.stringify({ success: true, deleted: key, totalEntries: entries.length })
  },
}

export const memoryTools: ToolDefinition[] = [memoryStoreTool, memoryRecallTool, memoryDeleteTool]
