/** ReactNode（ReAct 模式：设计理念/占位符/工作记忆集成见文档），详细见 docs/details/注释/packages/agent-core/orchestrator/nodes/react-node.md */

import type {
  OrchestratorNode,
  NodeContext,
  NodeResult,
  NodeType,
  PromptCallOptions,
  OrchestratorMessage,
} from '../types'
import {
  WorkingMemoryHelper,
  type WorkingMemoryOptions,
} from '../working-memory'

/**
 * 工作记忆集成配置
 */
export interface ReactNodeWorkingMemoryConfig {
  /** 是否启用工作记忆（默认 false） */
  enabled: boolean
  /**
   * 工作记忆 helper 配置（启用时生效）
   * 若不传入 helper 实例，则使用此配置创建默认 helper
   */
  options?: WorkingMemoryOptions
  /**
   * 是否在 execute 完成后从 messages 中捕获 toolResult 作为工作记忆条目
   * 默认 true（启用工作记忆时）
   *
   * 捕获范围：本次 execute 期间新增的 toolResult 消息
   */
  captureFromMessages?: boolean
  /**
   * 完成时（status=done）是否合并工作记忆到 messages
   * 默认 true（启用工作记忆时）
   *
   * 合并后工作记忆被清空，避免重复注入
   */
  mergeOnComplete?: boolean
  /**
   * 合并格式
   * 默认 'summary'
   */
  mergeFormat?: 'summary' | 'detailed'
  /**
   * 合并到 messages 时的最大 token 数
   * 默认 2000
   */
  mergeMaxTokens?: number
  /**
   * 是否在 prompt 渲染时自动注入工作记忆摘要
   * - true：将工作记忆格式化后拼接到 prompt 末尾（除非 promptTemplate 包含 {{workingMemory}}）
   * - false：仅在 promptTemplate 显式使用 {{workingMemory}} 时注入
   * 默认 false（避免污染 prompt）
   */
  autoInjectToPrompt?: boolean
  /**
   * 自动注入时的最大 token 数
   * 默认 1000
   */
  autoInjectMaxTokens?: number
}

export interface ReactNodeConfig {
  /** 节点唯一 ID */
  id: string
  /** 人类可读名称（默认 ReactNode:{id}） */
  name?: string
  /**
   * prompt 模板，支持占位符替换
   * - 省略或为 '{{input}}'：直接用 state.input
   * - 自定义模板：如 '基于以下信息回答：{{input}}\n上下文：{{lastMessage}}'
   * - 工作记忆占位符：'{{workingMemory}}'（启用 workingMemory 时可用）
   */
  promptTemplate?: string
  /** LLM 调用选项（温度、最大 token、思考级别等） */
  promptOptions?: PromptCallOptions
  /**
   * 是否将用户输入写入 state.messages
   * 默认 true（保持消息历史完整）
   */
  recordUserMessage?: boolean
  /**
   * 自定义完成判断
   * 返回 true 时节点状态为 'done'，否则为 'continue'
   * 默认总是返回 'done'（单轮 ReAct 即完成）
   */
  isComplete?: (ctx: NodeContext, response: string) => boolean
  /**
   * 工作记忆集成配置（阶段 0.7 新增）
   * 默认未启用
   */
  workingMemory?: ReactNodeWorkingMemoryConfig
  /**
   * 注入的 WorkingMemoryHelper 实例（可选）
   * - 未传入时：根据 workingMemory.options 创建默认实例
   * - 传入时：忽略 workingMemory.options，复用外部 helper（适合多节点共享工作记忆）
   */
  workingMemoryHelper?: WorkingMemoryHelper
}

export class ReactNode implements OrchestratorNode {
  readonly id: string
  readonly name: string
  readonly type: NodeType = 'react'
  private config: ReactNodeConfig
  private wmHelper: WorkingMemoryHelper | null = null

  constructor(config: ReactNodeConfig) {
    this.id = config.id
    this.name = config.name ?? `ReactNode:${config.id}`
    this.config = config

    // 初始化工作记忆 helper（若启用）
    if (config.workingMemory?.enabled) {
      this.wmHelper =
        config.workingMemoryHelper ??
        new WorkingMemoryHelper(config.workingMemory.options ?? {})
    }
  }

  async execute(ctx: NodeContext): Promise<NodeResult> {
    // 中断检查
    await ctx.waitIfPaused()
    if (ctx.isAborted()) {
      return { status: 'aborted' }
    }

    // 记录 execute 开始时的 messages 长度（用于后续捕获新增的 toolResult）
    const messagesBefore = ctx.state.messages.length

    // 渲染 prompt（含工作记忆注入）
    const input = this.renderPrompt(ctx)
    if (!input.trim()) {
      return {
        status: 'error',
        error: 'Rendered prompt is empty',
      }
    }

    // 记录用户消息（保持消息历史完整）
    if (this.config.recordUserMessage !== false) {
      const userMsg: OrchestratorMessage = {
        role: 'user',
        content: input,
      }
      ctx.state.messages.push(userMsg)
    }

    ctx.log('info', `ReactNode executing`, {
      inputLength: input.length,
      messageCount: ctx.state.messages.length,
      workingMemoryEnabled: this.wmHelper !== null,
    })

    try {
      // 调用 backend.prompt（内部会发射 message_start/message_update/message_end 等事件）
      const responsePromise = ctx.backend.prompt(input, this.config.promptOptions)
      const response = await responsePromise

      if (ctx.isAborted()) {
        return { status: 'aborted' }
      }

      // 记录 assistant 响应
      const assistantMsg: OrchestratorMessage = {
        role: 'assistant',
        content: response,
      }
      ctx.state.messages.push(assistantMsg)

      // 工作记忆集成：从本次新增的 messages 中捕获 toolResult
      const isComplete = this.config.isComplete
        ? this.config.isComplete(ctx, response)
        : true

      // 捕获工具观察到工作记忆
      if (this.wmHelper && this.config.workingMemory?.captureFromMessages !== false) {
        this.captureToolResults(ctx, messagesBefore)
      }

      // 完成时合并工作记忆到 messages
      if (isComplete && this.wmHelper && this.config.workingMemory?.mergeOnComplete !== false) {
        this.mergeWorkingMemory(ctx)
      }

      ctx.log('info', `ReactNode completed`, {
        responseLength: response.length,
        isComplete,
      })

      return {
        status: isComplete ? 'done' : 'continue',
        summary: `Response length: ${response.length}`,
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      ctx.log('error', `ReactNode failed: ${msg}`)
      return {
        status: 'error',
        error: msg,
      }
    }
  }

  /**
   * 渲染 prompt 模板
   *
   * 支持的占位符：
   * - {{input}}：用户原始输入
   * - {{lastMessage}}：state.messages 最后一条消息内容
   * - {{plan}}：state.plan 的 JSON 摘要
   * - {{workingMemory}}：工作记忆格式化文本（启用时）
   */
  private renderPrompt(ctx: NodeContext): string {
    const template = this.config.promptTemplate ?? '{{input}}'
    const lastMessage = ctx.state.messages[ctx.state.messages.length - 1]?.content ?? ''
    const planSummary = ctx.state.plan
      ? ctx.state.plan.map(p => `- [${p.status}] ${p.title}`).join('\n')
      : ''

    // 工作记忆占位符渲染
    let workingMemoryText = ''
    if (this.wmHelper) {
      const autoInject = this.config.workingMemory?.autoInjectToPrompt ?? false
      const maxTokens = this.config.workingMemory?.autoInjectMaxTokens ?? 1000
      workingMemoryText = this.wmHelper.formatForPrompt(ctx.state, {
        maxTokens,
        format: 'summary',
      })

      // 自动注入模式：若模板未显式包含 {{workingMemory}}，则拼接到末尾
      if (autoInject && workingMemoryText && !template.includes('{{workingMemory}}')) {
        const appended = `${template}\n\n${workingMemoryText}`
        return this.replacePlaceholders(appended, ctx.state.input, lastMessage, planSummary, workingMemoryText)
      }
    }

    return this.replacePlaceholders(template, ctx.state.input, lastMessage, planSummary, workingMemoryText)
  }

  /**
   * 替换占位符
   */
  private replacePlaceholders(
    template: string,
    input: string,
    lastMessage: string,
    planSummary: string,
    workingMemory: string,
  ): string {
    return template
      .replace(/\{\{input\}\}/g, input)
      .replace(/\{\{lastMessage\}\}/g, lastMessage)
      .replace(/\{\{plan\}\}/g, planSummary)
      .replace(/\{\{workingMemory\}\}/g, workingMemory)
  }

  /**
   * 从本次 execute 新增的 messages 中捕获 toolResult 作为工作记忆条目
   *
   * 捕获范围：messagesBefore 之后的所有 toolResult 消息
   * 转换：每条 toolResult 消息 → WorkingMemoryEntry
   */
  private captureToolResults(ctx: NodeContext, messagesBefore: number): void {
    if (!this.wmHelper) return

    const messages = ctx.state.messages
    const newMessages = messages.slice(messagesBefore)
    let capturedCount = 0

    for (const msg of newMessages) {
      if (msg.role !== 'toolResult') continue

      // 从 toolCalls 元数据推断工具名（若 backend 填充了）
      // 否则使用 'unknown_tool'
      const toolName = (msg.meta?.toolName as string) ?? 'unknown_tool'
      const argsSummary = msg.meta?.argsSummary as string | undefined

      this.wmHelper.pushObservation(
        ctx.state,
        ctx,
        toolName,
        msg.content,
        {
          toolCallId: msg.toolCallId,
          argsSummary,
          sourceNodeId: this.id,
          // 工具结果默认重要性 0.5，由后续 Reflection 节点评估时调整
          importance: 0.5,
        },
      )
      capturedCount++
    }

    if (capturedCount > 0) {
      ctx.log('debug', `Captured ${capturedCount} tool results to working memory`, {
        messagesBefore,
        messagesAfter: messages.length,
      })
    }
  }

  /**
   * 合并工作记忆到 messages
   *
   * 在节点完成时调用，将工作记忆聚合为一条 system 消息追加到 messages。
   * 合并后清空工作记忆，避免重复注入。
   */
  private mergeWorkingMemory(ctx: NodeContext): void {
    if (!this.wmHelper) return

    const snapshot = this.wmHelper.getSnapshot(ctx.state)
    if (snapshot.count === 0) return

    const format = this.config.workingMemory?.mergeFormat ?? 'summary'
    const maxTokens = this.config.workingMemory?.mergeMaxTokens ?? 2000

    const result = this.wmHelper.merge(ctx.state, ctx, {
      toMessages: true,
      maxTokens,
      format,
    })

    ctx.log('info', `Working memory merged to messages`, {
      merged: result.toMessages,
      discarded: result.discarded,
      format,
    })
  }

  reset?(): void {
    // ReactNode 无内部状态，但工作记忆 helper 的 idCounter 不重置（避免 ID 冲突）
  }

  /**
   * 获取工作记忆 helper（外部节点可访问，用于 Reflection 评估等场景）
   */
  getWorkingMemoryHelper(): WorkingMemoryHelper | null {
    return this.wmHelper
  }
}
