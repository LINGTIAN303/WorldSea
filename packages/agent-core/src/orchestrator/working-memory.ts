/** 工作记忆工具类（三类记忆关系/特点/使用示例见文档），详细见 docs/details/注释/packages/agent-core/orchestrator/working-memory.md */

import type {
  OrchestratorState,
  NodeContext,
  WorkingMemoryEntry,
  WorkingMemorySnapshot,
  OrchestratorMessage,
} from './types'

export interface WorkingMemoryOptions {
  /**
   * 最大条目数（超过即触发 trim）
   * 默认 50
   */
  maxEntries?: number
  /**
   * 最大 token 数（超过即触发 trim）
   * 默认 8000（约 6K 英文字符 / 4K 中文字符）
   */
  maxTokens?: number
  /**
   * token 估算系数（每字符的 token 数）
   * 默认 0.25（与 ShortTermMemoryHelper 一致）
   */
  tokensPerChar?: number
  /**
   * trim 时保留 importance >= 此阈值的条目
   * 默认 0.8（高重要性条目不被裁剪）
   */
  importanceThreshold?: number
  /**
   * 单条观察内容最大长度（超出截断，避免单条目占用过多空间）
   * 默认 1000 字符
   */
  maxObservationLength?: number
  /**
   * 默认重要性评分（未指定时使用）
   * 默认 0.5
   */
  defaultImportance?: number
}

export interface WorkingMemoryPushResult {
  /** 推入的条目（含生成的 id 和 timestamp） */
  entry: WorkingMemoryEntry
  /** 是否触发了 trim */
  trimmed: boolean
  /** trim 移除的条目数 */
  trimmedCount: number
}

export interface WorkingMemoryTrimResult {
  /** 移除的条目数 */
  removedCount: number
  /** trim 后剩余的条目数 */
  remainingCount: number
  /** 是否触发了 trim */
  trimmed: boolean
}

export interface WorkingMemoryMergeResult {
  /** 合并的条目总数 */
  mergedCount: number
  /** 合并到 messages 的条目数（toMessages=true 时有效） */
  toMessages: number
  /** 丢弃的条目数（toMessages=false 时所有条目都被丢弃） */
  discarded: number
  /** 合并后生成的消息（若 toMessages=true） */
  mergedMessage?: OrchestratorMessage
}

/**
 * 便捷推入参数（省略 id 和 timestamp，由工具类生成）
 */
export interface WorkingMemoryPushInput {
  /** 关联的工具调用 ID */
  toolCallId?: string
  /** 工具名称 */
  toolName: string
  /** 工具调用参数摘要 */
  argsSummary?: string
  /** 观察结果 */
  observation: string
  /** 来源节点 ID */
  sourceNodeId?: string
  /** 重要性评分（0-1，影响 trim 时的保留优先级） */
  importance?: number
}

export class WorkingMemoryHelper {
  private opts: Required<WorkingMemoryOptions>
  /** ID 序列号（避免同一毫秒内冲突） */
  private idCounter: number = 0

  constructor(options: WorkingMemoryOptions = {}) {
    this.opts = {
      maxEntries: options.maxEntries ?? 50,
      maxTokens: options.maxTokens ?? 8000,
      tokensPerChar: options.tokensPerChar ?? 0.25,
      importanceThreshold: options.importanceThreshold ?? 0.8,
      maxObservationLength: options.maxObservationLength ?? 1000,
      defaultImportance: options.defaultImportance ?? 0.5,
    }
  }

  /** 推入一条观察记录（5 步内部流程见文档），详细见 docs/details/注释/packages/agent-core/orchestrator/working-memory.md */
  push(
    state: OrchestratorState,
    ctx: NodeContext,
    input: WorkingMemoryPushInput,
  ): WorkingMemoryPushResult {
    const observation = this.truncateObservation(input.observation)
    const entry: WorkingMemoryEntry = {
      id: this.generateId(),
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      argsSummary: input.argsSummary,
      observation,
      timestamp: Date.now(),
      sourceNodeId: input.sourceNodeId,
      importance: input.importance ?? this.opts.defaultImportance,
    }

    const entries = this.getOrCreateEntries(state)
    entries.push(entry)

    // 容量检查
    const trimResult = this.trim(state)

    ctx.emit({
      type: 'working_memory_push',
      entry,
      trimmedCount: trimResult.removedCount,
    })

    if (trimResult.trimmed) {
      ctx.log('debug', `WorkingMemory pushed (trimmed ${trimResult.removedCount})`, {
        toolName: entry.toolName,
        importance: entry.importance,
      })
    } else {
      ctx.log('debug', `WorkingMemory pushed`, {
        toolName: entry.toolName,
        importance: entry.importance,
      })
    }

    return {
      entry,
      trimmed: trimResult.trimmed,
      trimmedCount: trimResult.removedCount,
    }
  }

  /**
   * 便捷推入方法（与 push 等价，参数更直观）
   */
  pushObservation(
    state: OrchestratorState,
    ctx: NodeContext,
    toolName: string,
    observation: string,
    extras?: Omit<WorkingMemoryPushInput, 'toolName' | 'observation'>,
  ): WorkingMemoryPushResult {
    return this.push(state, ctx, {
      toolName,
      observation,
      ...extras,
    })
  }

  /**
   * 获取工作记忆快照（只读视图）
   */
  getSnapshot(state: OrchestratorState): WorkingMemorySnapshot {
    const entries = this.getEntries(state)
    const frozen = Object.freeze([...entries]) as ReadonlyArray<WorkingMemoryEntry>
    return {
      entries: frozen,
      count: entries.length,
      estimatedTokens: this.estimateTokens(entries),
    }
  }

  /** 执行容量控制 trim（5 步策略见文档），详细见 docs/details/注释/packages/agent-core/orchestrator/working-memory.md */
  trim(state: OrchestratorState, ctx?: NodeContext): WorkingMemoryTrimResult {
    const entries = this.getEntries(state)
    const tokens = this.estimateTokens(entries)

    const overByCount = entries.length > this.opts.maxEntries
    const overByTokens = tokens > this.opts.maxTokens

    if (!overByCount && !overByTokens) {
      return {
        removedCount: 0,
        remainingCount: entries.length,
        trimmed: false,
      }
    }

    // 构建索引+条目对，便于排序后重建
    const indexed = entries.map((entry, idx) => ({ entry, idx }))

    // 按 importance 升序排列（低的优先移除）
    // importance 相同时，timestamp 早的优先移除
    indexed.sort((a, b) => {
      const impA = a.entry.importance ?? this.opts.defaultImportance
      const impB = b.entry.importance ?? this.opts.defaultImportance
      if (impA !== impB) return impA - impB
      return a.entry.timestamp - b.entry.timestamp
    })

    // 标记待移除的索引
    const removeIndices = new Set<number>()
    let currentTokens = tokens
    let currentCount = entries.length

    for (const { entry, idx } of indexed) {
      // 已达容量要求，停止
      if (currentCount <= this.opts.maxEntries && currentTokens <= this.opts.maxTokens) {
        break
      }

      // 重要性高于阈值的条目不裁剪
      const importance = entry.importance ?? this.opts.defaultImportance
      if (importance >= this.opts.importanceThreshold) {
        continue
      }

      removeIndices.add(idx)
      currentCount--
      currentTokens -= this.estimateEntryTokens(entry)
    }

    if (removeIndices.size === 0) {
      // 没有可移除的条目（都是高重要性）
      return {
        removedCount: 0,
        remainingCount: entries.length,
        trimmed: false,
      }
    }

    // 构建新数组（保持原顺序）
    const newEntries: WorkingMemoryEntry[] = []
    for (let i = 0; i < entries.length; i++) {
      if (!removeIndices.has(i)) {
        newEntries.push(entries[i])
      }
    }

    // 写回 state
    this.setEntries(state, newEntries)

    const removedCount = removeIndices.size

    if (ctx) {
      ctx.emit({
        type: 'working_memory_trim',
        removedCount,
        remainingCount: newEntries.length,
      })
      ctx.log('info', `WorkingMemory trimmed ${removedCount} entries`, {
        tokensBefore: tokens,
        tokensAfter: this.estimateTokens(newEntries),
      })
    }

    return {
      removedCount,
      remainingCount: newEntries.length,
      trimmed: true,
    }
  }

  /**
   * 清空工作记忆
   */
  clear(state: OrchestratorState, ctx?: NodeContext): void {
    const entries = this.getEntries(state)
    const removedCount = entries.length
    this.setEntries(state, [])

    if (ctx && removedCount > 0) {
      ctx.emit({
        type: 'working_memory_clear',
        removedCount,
      })
      ctx.log('info', `WorkingMemory cleared (${removedCount} entries)`)
    }
  }

  /** 合并工作记忆到 messages（选项语义与使用场景见文档），详细见 docs/details/注释/packages/agent-core/orchestrator/working-memory.md */
  merge(
    state: OrchestratorState,
    ctx: NodeContext,
    options: {
      toMessages?: boolean
      maxTokens?: number
      format?: 'summary' | 'detailed'
    } = {},
  ): WorkingMemoryMergeResult {
    const entries = this.getEntries(state)
    if (entries.length === 0) {
      return {
        mergedCount: 0,
        toMessages: 0,
        discarded: 0,
      }
    }

    const { toMessages = false, maxTokens, format = 'summary' } = options

    let mergedMessage: OrchestratorMessage | undefined
    let toMessagesCount = 0

    if (toMessages) {
      // 按 importance 降序选择，限制 token
      const sorted = [...entries].sort((a, b) => {
        const impA = a.importance ?? this.opts.defaultImportance
        const impB = b.importance ?? this.opts.defaultImportance
        if (impA !== impB) return impB - impA
        return b.timestamp - a.timestamp
      })

      const maxToks = maxTokens ?? this.opts.maxTokens
      const selected: WorkingMemoryEntry[] = []
      let usedTokens = 0

      for (const entry of sorted) {
        const entryTokens = this.estimateEntryTokens(entry)
        if (usedTokens + entryTokens > maxToks && selected.length > 0) {
          break
        }
        selected.push(entry)
        usedTokens += entryTokens
      }

      // 按 timestamp 升序恢复时间顺序
      selected.sort((a, b) => a.timestamp - b.timestamp)

      const content = this.formatEntries(selected, format)
      mergedMessage = {
        role: 'system',
        content,
      }
      state.messages.push(mergedMessage)
      toMessagesCount = selected.length
    }

    const discarded = entries.length - toMessagesCount

    // 清空工作记忆
    this.setEntries(state, [])

    ctx.emit({
      type: 'working_memory_merge',
      mergedCount: entries.length,
      toMessages: toMessagesCount,
      discarded,
    })

    ctx.log('info', `WorkingMemory merged: ${toMessagesCount} to messages, ${discarded} discarded`, {
      toMessages,
      format,
    })

    return {
      mergedCount: entries.length,
      toMessages: toMessagesCount,
      discarded,
      mergedMessage,
    }
  }

  /**
   * 格式化工作记忆为可注入 prompt 的文本
   *
   * 不修改 state，仅生成文本。供节点拼接到 systemPrompt 或自定义 prompt 时使用。
   *
   * @param options.maxTokens 最大 token 数（默认 2000）
   * @param options.format 格式化方式
   */
  formatForPrompt(
    state: OrchestratorState,
    options: { maxTokens?: number; format?: 'summary' | 'detailed' } = {},
  ): string {
    const entries = this.getEntries(state)
    if (entries.length === 0) return ''

    const { maxTokens = 2000, format = 'summary' } = options

    // 按 importance 降序选择
    const sorted = [...entries].sort((a, b) => {
      const impA = a.importance ?? this.opts.defaultImportance
      const impB = b.importance ?? this.opts.defaultImportance
      if (impA !== impB) return impB - impA
      return b.timestamp - a.timestamp
    })

    const selected: WorkingMemoryEntry[] = []
    let usedTokens = 0

    for (const entry of sorted) {
      const entryTokens = this.estimateEntryTokens(entry)
      if (usedTokens + entryTokens > maxTokens && selected.length > 0) {
        break
      }
      selected.push(entry)
      usedTokens += entryTokens
    }

    // 按 timestamp 升序
    selected.sort((a, b) => a.timestamp - b.timestamp)

    return this.formatEntries(selected, format)
  }

  /**
   * 更新配置（运行时调整）
   */
  updateOptions(options: Partial<WorkingMemoryOptions>): void {
    this.opts = { ...this.opts, ...options }
  }

  /**
   * 获取当前配置
   */
  getOptions(): Readonly<Required<WorkingMemoryOptions>> {
    return { ...this.opts }
  }

  // ─── 内部方法 ────────────────────────────────────────

  /**
   * 从 state.extra 读取工作记忆数组（不存在时初始化）
   */
  private getOrCreateEntries(state: OrchestratorState): WorkingMemoryEntry[] {
    if (!Array.isArray(state.extra.workingMemory)) {
      state.extra.workingMemory = []
    }
    return state.extra.workingMemory as WorkingMemoryEntry[]
  }

  /**
   * 从 state.extra 读取工作记忆数组（不初始化，返回空数组）
   */
  private getEntries(state: OrchestratorState): WorkingMemoryEntry[] {
    const entries = state.extra.workingMemory
    return Array.isArray(entries) ? (entries as WorkingMemoryEntry[]) : []
  }

  /**
   * 写回工作记忆数组
   */
  private setEntries(state: OrchestratorState, entries: WorkingMemoryEntry[]): void {
    state.extra.workingMemory = entries
  }

  /**
   * 生成唯一 ID
   *
   * 格式：wm_{timestamp}_{counter}
   * counter 在同一毫秒内递增，避免冲突
   */
  private generateId(): string {
    const now = Date.now()
    this.idCounter = (this.idCounter + 1) % Number.MAX_SAFE_INTEGER
    return `wm_${now}_${this.idCounter}`
  }

  /**
   * 截断过长的观察内容
   */
  private truncateObservation(observation: string): string {
    if (observation.length <= this.opts.maxObservationLength) {
      return observation
    }
    return (
      observation.slice(0, this.opts.maxObservationLength) +
      `...[已截断，原长 ${observation.length}]`
    )
  }

  /**
   * 估算单条条目的 token 数
   */
  private estimateEntryTokens(entry: WorkingMemoryEntry): number {
    let chars = entry.observation.length
    if (entry.toolName) chars += entry.toolName.length
    if (entry.argsSummary) chars += entry.argsSummary.length
    return Math.ceil(chars * this.opts.tokensPerChar)
  }

  /**
   * 估算条目数组的总 token 数
   */
  private estimateTokens(entries: WorkingMemoryEntry[]): number {
    let total = 0
    for (const entry of entries) {
      total += this.estimateEntryTokens(entry)
    }
    return total
  }

  /**
   * 格式化条目列表为文本
   */
  private formatEntries(
    entries: WorkingMemoryEntry[],
    format: 'summary' | 'detailed',
  ): string {
    if (entries.length === 0) return ''

    if (format === 'detailed') {
      const lines = entries.map((e, i) => {
        const imp = e.importance ?? this.opts.defaultImportance
        const parts = [
          `[${i + 1}] ${e.toolName}`,
          e.argsSummary ? `(args: ${e.argsSummary})` : '',
          `→ ${e.observation}`,
          `[importance: ${imp.toFixed(2)}]`,
        ].filter(Boolean)
        return parts.join(' ')
      })
      return `[工作记忆·详细]\n${lines.join('\n')}`
    }

    // summary 格式：紧凑
    const lines = entries.map((e) => {
      const obs = e.observation.length > 100
        ? e.observation.slice(0, 100) + '...'
        : e.observation
      return `- ${e.toolName}: ${obs}`
    })
    return `[工作记忆·摘要]\n${lines.join('\n')}`
  }
}
