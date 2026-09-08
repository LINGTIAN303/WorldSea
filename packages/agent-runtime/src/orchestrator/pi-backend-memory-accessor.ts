/** 将 localStorage KV 记忆系统适配为 MemoryAccessor 接口（阶段 0.7），详细见 docs/details/注释/packages/agent-runtime/orchestrator-pi-backend-memory-accessor.md */

import type {
  MemoryAccessor,
  MemoryRecallOptions,
  MemoryRecallResult,
  MemoryInjectOptions,
  MemoryArchiveResult,
  MemoryChunkContent,
  MemoryOutputType,
} from '@worldsea/agent-core/orchestrator'
import { recallMemory, formatMemoryForPrompt } from '../tools/memory'
import type { MemoryEntry } from '../tools/memory-internal'
import { inferImportance } from '../tools/memory-internal'

/** KV 模型 → MemoryRecallResult 字段映射适配器，详细见 docs/details/注释/packages/agent-runtime/orchestrator-pi-backend-memory-accessor.md */
function entryToRecallResult(entry: MemoryEntry, score?: number): MemoryRecallResult {
  // 估算 score：accessCount 越多越相关（0-1 之间）
  const estimatedScore = score ?? Math.min(1, 0.3 + entry.accessCount * 0.05)

  return {
    hookId: `kv_${entry.key}`,
    summary: entry.value,
    score: estimatedScore,
    matchedFields: ['keyword'],
    createdAt: entry.timestamp,
    accessCount: entry.accessCount,
    keywords: entry.tags,
    tags: entry.tags,
    pinned: false,
  }
}

/**
 * 推断记忆条目的输出类型（用于 outputTypes 过滤）
 */
function inferOutputType(entry: MemoryEntry): MemoryOutputType {
  const tags = entry.tags.map(t => t.toLowerCase())
  const value = entry.value.toLowerCase()

  if (tags.some(t => t.includes('tool') || t.includes('工具'))) return 'tool_call'
  if (tags.some(t => t.includes('entity') || t.includes('实体'))) return 'entity_op'
  if (tags.some(t => t.includes('code') || t.includes('代码'))) return 'code'
  if (tags.some(t => t.includes('analysis') || t.includes('分析'))) return 'analysis'
  if (tags.some(t => t.includes('creative') || t.includes('创意'))) return 'creative'
  if (value.includes('function ') || value.includes('const ') || value.includes('class ')) return 'code'
  return 'text'
}

/**
 * 已注入摘要的状态跟踪
 */
interface InjectState {
  /** 已注入的 key 集合（避免重复注入） */
  injectedKeys: Set<string>
  /** 当前累积的注入文本 */
  currentSummary: string
}

export class PiBackendMemoryAccessor implements MemoryAccessor {
  private injectState: InjectState = {
    injectedKeys: new Set(),
    currentSummary: '',
  }

  /**
   * 检索长期记忆
   *
   * 包装 recallMemory，转换结果为 MemoryRecallResult[]
   */
  async recall(
    query: string,
    options?: MemoryRecallOptions,
  ): Promise<MemoryRecallResult[]> {
    const topK = options?.topK ?? 5
    const minScore = options?.minScore ?? 0

    // 空查询：返回最近的记忆列表
    if (!query.trim()) {
      // 用 recallMemory 的空查询行为（返回最近 topK 条）
      const entries = await recallMemory('', topK)
      let filtered = entries
      // 应用 outputTypes 过滤
      if (options?.outputTypes && options.outputTypes.length > 0) {
        filtered = entries.filter(e =>
          options.outputTypes!.includes(inferOutputType(e)),
        )
      }
      return filtered.map(e => entryToRecallResult(e, 0.5))
    }

    // hybrid 模式（默认）：recallMemory 内部已合并关键词 + 语义搜索
    // 注意：recallMemory 不支持 mode 参数，始终是 hybrid
    // 若需要纯 semantic/keyword，需要直接调用 memory.ts 的工具
    const entries = await recallMemory(query, topK * 2)

    // 应用 outputTypes 过滤（基于原始 entry，比基于 summary 推断更准确）
    let filtered = entries
    if (options?.outputTypes && options.outputTypes.length > 0) {
      filtered = entries.filter(e =>
        options.outputTypes!.includes(inferOutputType(e)),
      )
    }

    // 转换为 MemoryRecallResult
    let results = filtered.map(e => entryToRecallResult(e))

    // 应用 dateRange 过滤
    if (options?.dateRange) {
      const { start, end } = options.dateRange
      results = results.filter(r => r.createdAt >= start && r.createdAt <= end)
    }

    // 应用 minScore 过滤
    results = results.filter(r => r.score >= minScore)

    // 限制 topK
    return results.slice(0, topK)
  }

  /**
   * 注入记忆摘要到 system prompt
   *
   * 包装 formatMemoryForPrompt，并跟踪已注入状态避免重复注入
   */
  async inject(
    results: MemoryRecallResult[],
    options?: MemoryInjectOptions,
  ): Promise<string> {
    if (results.length === 0) return ''

    // force=false 时过滤已注入的
    const force = options?.force ?? false
    const toInject = force
      ? results
      : results.filter(r => !this.injectState.injectedKeys.has(r.hookId))

    if (toInject.length === 0) {
      return this.injectState.currentSummary
    }

    // 标记已注入
    for (const r of toInject) {
      this.injectState.injectedKeys.add(r.hookId)
    }

    // 转换为 MemoryEntry 格式（formatMemoryForPrompt 需要）
    const entries: MemoryEntry[] = toInject.map(r => ({
      key: r.hookId.replace(/^kv_/, ''),
      value: r.summary,
      tags: r.tags,
      timestamp: r.createdAt,
      accessCount: r.accessCount,
      lastAccessedAt: Date.now(),
      importance: inferImportance(r.hookId.replace(/^kv_/, '')),
    }))

    // 应用 maxTokens 限制
    const maxTokens = options?.maxTokens ?? 2000
    const tokensPerChar = 0.25
    const maxChars = Math.floor(maxTokens / tokensPerChar)

    let summary = formatMemoryForPrompt(entries)
    if (summary.length > maxChars) {
      summary = summary.slice(0, maxChars) + '\n...[已截断]'
    }

    // 累积到 currentSummary（如果之前有注入）
    if (this.injectState.currentSummary && !force) {
      this.injectState.currentSummary = `${this.injectState.currentSummary}\n\n${summary}`
    } else {
      this.injectState.currentSummary = summary
    }

    return this.injectState.currentSummary
  }

  /**
   * 触发归档
   *
   * localStorage KV 模型没有归档概念，始终返回 null
   *
   * 阶段 1 迁移到 memory-archive 后，此方法应：
   * 1. 调用 ArchiveManager.archive(messages, source)
   * 2. 返回归档结果（含 hookId、fileId、tokenCount 等）
   */
  async archive(
    _source?: 'threshold' | 'session_end' | 'manual',
  ): Promise<MemoryArchiveResult | null> {
    // KV 模型不支持归档
    return null
  }

  /**
   * 获取当前归档边界
   *
   * KV 模型没有归档，所有消息都是"新消息"，返回 0
   */
  getArchiveBoundary(): number {
    return 0
  }

  /**
   * 加载记忆块完整内容
   *
   * KV 模型没有分块，不支持此操作
   */
  async loadChunk?(
    _hookId: string,
    _chunkId: string,
  ): Promise<MemoryChunkContent | null> {
    return null
  }

  /**
   * 重置注入状态（新一轮会话时调用）
   */
  resetInjectState(): void {
    this.injectState.injectedKeys.clear()
    this.injectState.currentSummary = ''
  }

  /**
   * 获取已注入的 key 列表（调试用）
   */
  getInjectedKeys(): string[] {
    return Array.from(this.injectState.injectedKeys)
  }
}
