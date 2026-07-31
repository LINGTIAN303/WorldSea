/**
 * MemoryNode — Memory Pattern 横切节点（阶段 0.6）
 *
 * 设计理念：
 * - 横切节点：可插入任何编排图，为其他节点提供记忆能力
 * - 四种动作：recall（检索）/ inject（注入）/ archive（归档）/ auto（检索+注入）
 * - 优雅降级：ctx.memory 未注入时返回 done，不阻塞编排流
 * - 解耦：通过 MemoryAccessor 接口访问记忆系统，不依赖具体实现
 *
 * 典型用法：
 *
 * 1. 会话开始时自动检索相关记忆（与 ReactNode 配合）：
 *    MemoryNode(auto) → ReactNode
 *
 * 2. 上下文接近阈值时触发归档：
 *    ReactNode → 条件边（检查 token 数）→ MemoryNode(archive) → ReactNode
 *
 * 3. 用户主动询问历史时检索：
 *    RouterNode → MemoryNode(recall) → ReactNode（基于检索结果回答）
 *
 * 占位符支持（queryTemplate 中）：
 * - {{input}}：用户原始输入（state.input）
 * - {{lastUserMessage}}：state.messages 中最后一条 role=user 的消息内容
 * - {{lastMessage}}：state.messages 最后一条消息内容
 */

import type {
  OrchestratorNode,
  NodeContext,
  NodeResult,
  NodeType,
  MemoryAccessor,
  MemoryRecallOptions,
  MemoryRecallResult,
  MemoryInjectOptions,
} from '../types'

/** MemoryNode 支持的动作 */
export type MemoryNodeAction = 'recall' | 'inject' | 'archive' | 'auto'

export interface MemoryNodeConfig {
  /** 节点唯一 ID */
  id: string
  /** 人类可读名称（默认 MemoryNode:{id}） */
  name?: string
  /**
   * 动作类型
   * - recall: 仅检索，结果写入 state.extra.memoryResults
   * - inject: 仅注入，从 state.extra.memoryResults 读取并注入到 system prompt
   * - archive: 触发归档
   * - auto: 先检索再注入（最常用）
   */
  action: MemoryNodeAction
  /**
   * 检索查询模板（recall/auto 动作使用）
   * - 省略：默认用 {{input}}，若 input 为空则用 {{lastUserMessage}}
   * - 自定义：如 '历史讨论：{{input}}'
   */
  queryTemplate?: string
  /** 检索选项（recall/auto 动作使用） */
  recallOptions?: MemoryRecallOptions
  /** 注入选项（inject/auto 动作使用） */
  injectOptions?: MemoryInjectOptions
  /** 归档触发源（archive 动作使用，默认 manual） */
  archiveSource?: 'threshold' | 'session_end' | 'manual'
  /**
   * 注入目标（inject/auto 动作使用）
   * - 'state'：写入 state.extra.injectedMemory（默认，节点可读取拼接）
   * - 'systemPrompt'：通过 promptOptions.systemPromptOverride 注入（需要后续节点配合）
   */
  injectTarget?: 'state' | 'systemPrompt'
  /**
   * 当 ctx.memory 为 undefined 时是否跳过
   * - true：返回 done，不阻塞编排（默认）
   * - false：返回 error
   */
  skipIfNoMemory?: boolean
  /**
   * 注入后是否清除 state.extra.memoryResults
   * 默认 false（保留供其他节点读取）
   */
  clearResultsAfterInject?: boolean
}

interface MemoryNodeState {
  /** 已注入的 hookId 集合（避免重复注入） */
  injectedHookIds: Set<string>
}

export class MemoryNode implements OrchestratorNode {
  readonly id: string
  readonly name: string
  readonly type: NodeType = 'memory'
  private config: MemoryNodeConfig
  private nodeState: MemoryNodeState = { injectedHookIds: new Set() }

  constructor(config: MemoryNodeConfig) {
    this.id = config.id
    this.name = config.name ?? `MemoryNode:${config.id}`
    this.config = config
  }

  async execute(ctx: NodeContext): Promise<NodeResult> {
    // 中断检查
    await ctx.waitIfPaused()
    if (ctx.isAborted()) {
      return { status: 'aborted' }
    }

    // 优雅降级：ctx.memory 未注入时跳过
    if (!ctx.memory) {
      if (this.config.skipIfNoMemory === false) {
        return {
          status: 'error',
          error: 'MemoryAccessor not injected in NodeContext',
        }
      }
      ctx.log('warn', `MemoryNode skipped: no MemoryAccessor injected`)
      return { status: 'done', summary: 'Skipped (no memory accessor)' }
    }

    const action = this.config.action
    ctx.log('info', `MemoryNode executing: action=${action}`)

    try {
      switch (action) {
        case 'recall':
          return await this.doRecall(ctx)
        case 'inject':
          return await this.doInject(ctx)
        case 'archive':
          return await this.doArchive(ctx)
        case 'auto':
          return await this.doAuto(ctx)
        default:
          return {
            status: 'error',
            error: `Unknown action: ${action as string}`,
          }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      ctx.log('error', `MemoryNode failed: ${msg}`)
      return { status: 'error', error: msg }
    }
  }

  /**
   * 检索记忆
   */
  private async doRecall(ctx: NodeContext): Promise<NodeResult> {
    const memory = ctx.memory as MemoryAccessor
    const query = this.renderQuery(ctx)
    if (!query.trim()) {
      return { status: 'done', summary: 'Empty query, skipped recall' }
    }

    const startTime = Date.now()
    const options = this.config.recallOptions
    const results = await memory.recall(query, options)
    const durationMs = Date.now() - startTime

    // 写入 state.extra 供其他节点读取
    ctx.state.extra.memoryResults = results
    ctx.state.extra.lastRecallQuery = query

    ctx.emit({ type: 'memory_recall', query, results, durationMs })
    ctx.log('info', `Recalled ${results.length} memories in ${durationMs}ms`, {
      topScore: results[0]?.score,
    })

    return {
      status: 'done',
      summary: `Recalled ${results.length} memories (top score: ${results[0]?.score ?? 'N/A'})`,
    }
  }

  /**
   * 注入记忆
   */
  private async doInject(ctx: NodeContext): Promise<NodeResult> {
    const memory = ctx.memory as MemoryAccessor
    const results = this.getResultsFromState(ctx)
    if (results.length === 0) {
      return { status: 'done', summary: 'No memory results to inject' }
    }

    // 过滤已注入的（除非 force）
    const injectOpts = this.config.injectOptions ?? {}
    const toInject = injectOpts.force
      ? results
      : results.filter(r => !this.nodeState.injectedHookIds.has(r.hookId))

    if (toInject.length === 0) {
      return { status: 'done', summary: 'All memories already injected' }
    }

    const summary = await memory.inject(toInject, injectOpts)
    // 标记已注入
    for (const r of toInject) {
      this.nodeState.injectedHookIds.add(r.hookId)
    }

    // 根据注入目标写入
    const target = this.config.injectTarget ?? 'state'
    if (target === 'state') {
      ctx.state.extra.injectedMemory = summary
    }
    // 'systemPrompt' 模式由实现层在 inject() 内部处理（通过 AgentBridge.injectHookSummary）

    ctx.emit({ type: 'memory_inject', summary, hookCount: toInject.length })
    ctx.log('info', `Injected ${toInject.length} memories (${summary.length} chars)`)

    // 清除 state.extra.memoryResults（可选）
    if (this.config.clearResultsAfterInject) {
      delete ctx.state.extra.memoryResults
    }

    return {
      status: 'done',
      summary: `Injected ${toInject.length} memories`,
    }
  }

  /**
   * 归档记忆
   */
  private async doArchive(ctx: NodeContext): Promise<NodeResult> {
    const memory = ctx.memory as MemoryAccessor
    const source = this.config.archiveSource ?? 'manual'

    const result = await memory.archive(source)
    if (!result) {
      ctx.log('info', `Archive not triggered (source=${source})`)
      return { status: 'done', summary: 'Archive not triggered' }
    }

    ctx.emit({ type: 'memory_archive', result })
    ctx.log('info', `Archived ${result.tokenCount} tokens (hookId=${result.hookId})`, {
      chunkCount: result.chunkCount,
      newBoundaryIndex: result.newBoundaryIndex,
    })

    return {
      status: 'done',
      summary: `Archived ${result.tokenCount} tokens, ${result.chunkCount} chunks`,
    }
  }

  /**
   * 自动模式：先检索再注入
   */
  private async doAuto(ctx: NodeContext): Promise<NodeResult> {
    // Step 1: 检索
    const recallResult = await this.doRecall(ctx)
    if (recallResult.status !== 'done') {
      return recallResult
    }

    // Step 2: 注入（如果检索到结果）
    const results = this.getResultsFromState(ctx)
    if (results.length === 0) {
      return {
        status: 'done',
        summary: 'Auto: recall returned 0 results, skip inject',
      }
    }

    return await this.doInject(ctx)
  }

  /**
   * 渲染检索查询
   */
  private renderQuery(ctx: NodeContext): string {
    const template = this.config.queryTemplate
    if (!template) {
      // 默认：input → lastUserMessage → 空字符串
      if (ctx.state.input.trim()) return ctx.state.input
      const lastUser = this.findLastUserMessage(ctx)
      return lastUser?.content ?? ''
    }

    const lastUser = this.findLastUserMessage(ctx)
    const lastMessage = ctx.state.messages[ctx.state.messages.length - 1]?.content ?? ''

    return template
      .replace(/\{\{input\}\}/g, ctx.state.input)
      .replace(/\{\{lastUserMessage\}\}/g, lastUser?.content ?? '')
      .replace(/\{\{lastMessage\}\}/g, lastMessage)
  }

  /**
   * 从 state 读取检索结果
   */
  private getResultsFromState(ctx: NodeContext): MemoryRecallResult[] {
    const results = ctx.state.extra.memoryResults
    return Array.isArray(results) ? results : []
  }

  /**
   * 查找最后一条 user 消息
   */
  private findLastUserMessage(ctx: NodeContext): { content: string } | null {
    for (let i = ctx.state.messages.length - 1; i >= 0; i--) {
      const msg = ctx.state.messages[i]
      if (msg.role === 'user') {
        return { content: msg.content }
      }
    }
    return null
  }

  reset?(): void {
    this.nodeState.injectedHookIds.clear()
  }
}
