/**
 * ShortTermMemoryHelper — 短期记忆 trim 策略工具（阶段 0.6）
 *
 * 设计理念：
 * - 工具类（非节点）：供 Orchestrator 或其他节点按需调用
 * - 操作短期记忆：state.messages 数组（当前会话的消息历史）
 * - 与 MemoryNode 互补：MemoryNode 操作长期记忆，本类操作短期记忆
 *
 * 三类记忆的关系：
 * - 短期记忆：state.messages（本类管理 trim 策略）
 * - 工作记忆：state.extra.workingMemory（节点自定义，本类不涉及）
 * - 长期记忆：通过 MemoryAccessor 检索/注入（MemoryNode 管理）
 *
 * trim 策略：
 * 1. 估算 state.messages 总 token 数
 * 2. 超过 maxTokens 时，移除最早的非 system 消息
 * 3. 保留策略：
 *    - 保留所有 system 消息（系统提示词等）
 *    - 保留最近 keepRecentCount 条消息（维持上下文连贯）
 *    - 可选保留首条 user 消息（任务原始输入）
 *
 * 使用示例：
 *
 * ```ts
 * // 在 Orchestrator 每轮结束后调用
 * const helper = new ShortTermMemoryHelper({ maxTokens: 100000, keepRecentCount: 20 })
 * const removed = helper.trim(state, ctx)
 * if (removed > 0) {
 *   ctx.log('info', `Trimmed ${removed} messages to free context`)
 * }
 * ```
 */

import type { OrchestratorState, OrchestratorMessage, NodeContext } from './types'

export interface ShortTermMemoryOptions {
  /**
   * 最大 token 数（超过即触发 trim）
   * 默认 100000（约 75K 英文字符 / 50K 中文字符）
   */
  maxTokens?: number
  /**
   * 保留最近 N 条消息（含 system）
   * 默认 20
   */
  keepRecentCount?: number
  /**
   * 是否保留首条 user 消息（任务原始输入）
   * 默认 true
   */
  keepFirstUserMessage?: boolean
  /**
   * 是否保留所有 system 消息
   * 默认 true
   */
  keepSystemMessages?: boolean
  /**
   * token 估算系数（每字符的 token 数）
   * 默认 0.25（4 字符 ≈ 1 token，适用于英文为主的混合文本）
   * 中文为主时建议 0.5（2 字符 ≈ 1 token）
   */
  tokensPerChar?: number
}

export interface TrimResult {
  /** 移除的消息数 */
  removedCount: number
  /** trim 后剩余的消息数 */
  remainingCount: number
  /** trim 前的 token 估算 */
  tokensBefore: number
  /** trim 后的 token 估算 */
  tokensAfter: number
  /** 是否触发了 trim */
  trimmed: boolean
}

export class ShortTermMemoryHelper {
  private opts: Required<ShortTermMemoryOptions>

  constructor(options: ShortTermMemoryOptions = {}) {
    this.opts = {
      maxTokens: options.maxTokens ?? 100000,
      keepRecentCount: options.keepRecentCount ?? 20,
      keepFirstUserMessage: options.keepFirstUserMessage ?? true,
      keepSystemMessages: options.keepSystemMessages ?? true,
      tokensPerChar: options.tokensPerChar ?? 0.25,
    }
  }

  /**
   * 估算消息数组的 token 数
   *
   * 粗略估算：content 长度 × tokensPerChar
   * 精确估算应由实现层注入 TokenizerAdapter，本类仅提供降级方案。
   */
  estimateTokens(messages: OrchestratorMessage[]): number {
    let totalChars = 0
    for (const msg of messages) {
      totalChars += msg.content.length
      // toolCalls 的参数也算入
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          totalChars += JSON.stringify(tc.args).length
        }
      }
    }
    return Math.ceil(totalChars * this.opts.tokensPerChar)
  }

  /**
   * 判断是否需要 trim
   */
  shouldTrim(state: OrchestratorState): boolean {
    const tokens = this.estimateTokens(state.messages)
    return tokens > this.opts.maxTokens
  }

  /**
   * 执行 trim
   *
   * @param state 编排状态
   * @param ctx 节点上下文（可选，传入则发射 memory_trim 事件）
   * @returns trim 结果
   */
  trim(state: OrchestratorState, ctx?: NodeContext): TrimResult {
    const messages = state.messages
    const tokensBefore = this.estimateTokens(messages)

    // 不需要 trim
    if (tokensBefore <= this.opts.maxTokens) {
      return {
        removedCount: 0,
        remainingCount: messages.length,
        tokensBefore,
        tokensAfter: tokensBefore,
        trimmed: false,
      }
    }

    // 构建保留索引集合
    const keepIndices = new Set<number>()
    const keepSystem = this.opts.keepSystemMessages
    const keepFirstUser = this.opts.keepFirstUserMessage
    const keepRecent = this.opts.keepRecentCount

    // 1. 保留 system 消息
    if (keepSystem) {
      for (let i = 0; i < messages.length; i++) {
        if (messages[i].role === 'system') {
          keepIndices.add(i)
        }
      }
    }

    // 2. 保留首条 user 消息
    if (keepFirstUser) {
      for (let i = 0; i < messages.length; i++) {
        if (messages[i].role === 'user') {
          keepIndices.add(i)
          break
        }
      }
    }

    // 3. 保留最近 N 条消息
    const recentStart = Math.max(0, messages.length - keepRecent)
    for (let i = recentStart; i < messages.length; i++) {
      keepIndices.add(i)
    }

    // 4. 构建新消息数组（保持原顺序）
    const newMessages: OrchestratorMessage[] = []
    const removedIndices: number[] = []
    for (let i = 0; i < messages.length; i++) {
      if (keepIndices.has(i)) {
        newMessages.push(messages[i])
      } else {
        removedIndices.push(i)
      }
    }

    const removedCount = removedIndices.length
    const tokensAfter = this.estimateTokens(newMessages)

    // 替换 state.messages
    state.messages = newMessages

    // 发射事件
    if (ctx && removedCount > 0) {
      ctx.emit({
        type: 'memory_trim',
        removedCount,
        remainingCount: newMessages.length,
      })
      ctx.log('info', `Trimmed ${removedCount} messages (${tokensBefore} → ${tokensAfter} tokens)`, {
        removedIndices,
      })
    }

    return {
      removedCount,
      remainingCount: newMessages.length,
      tokensBefore,
      tokensAfter,
      trimmed: true,
    }
  }

  /**
   * 更新配置（运行时调整）
   */
  updateOptions(options: Partial<ShortTermMemoryOptions>): void {
    this.opts = { ...this.opts, ...options }
  }

  /**
   * 获取当前配置
   */
  getOptions(): Readonly<Required<ShortTermMemoryOptions>> {
    return { ...this.opts }
  }
}
