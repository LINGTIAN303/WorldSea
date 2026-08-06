/** ExecuteNode（Plan-and-Execute 执行节点：协作/动态调整/事件流见文档），详细见 docs/details/注释/packages/agent-core/orchestrator/nodes/execute-node.md */

import type {
  OrchestratorNode,
  NodeContext,
  NodeResult,
  NodeType,
  PromptCallOptions,
  PlanItem,
  OrchestratorMessage,
} from '../types'

/** 新任务的原始解析结果 */
interface NewTaskRaw {
  title?: unknown
  description?: unknown
}

/** 默认 prompt 模板 — 执行单个计划项 */
const DEFAULT_EXECUTE_PROMPT_TEMPLATE = `请执行以下任务步骤。

原始任务：{{input}}

当前步骤：
- 标题：{{stepTitle}}
- 描述：{{stepDescription}}

已完成步骤：
{{completedSteps}}

剩余步骤：
{{remainingSteps}}

要求：
1. 专注完成当前步骤，不要跳到后续步骤
2. 如果执行过程中发现需要新增步骤，请在回复末尾用以下格式标记：
   <new_tasks>[{"title":"新步骤标题","description":"新步骤描述"}]</new_tasks>
3. 如果不需要新增步骤，无需添加任何标记`

export interface ExecuteNodeConfig {
  /** 节点唯一 ID */
  id: string
  /** 人类可读名称（默认 ExecuteNode:{id}） */
  name?: string
  /** prompt 模板（占位符说明见文档），详细见 docs/details/注释/packages/agent-core/orchestrator/nodes/execute-node.md */
  promptTemplate?: string
  /** LLM 调用选项 */
  promptOptions?: PromptCallOptions
  /**
   * 自定义新任务解析回调
   * 默认：从输出中提取 <new_tasks>[...]</new_tasks>
   * 返回空数组表示无新任务
   */
  parseNewTasks?: (response: string) => NewTaskRaw[]
  /**
   * 是否将 prompt 写入 state.messages
   * 默认 true（保持消息历史完整）
   */
  recordUserMessage?: boolean
  /**
   * 步骤失败时的策略
   * - 'skip'：跳过该步骤，继续执行下一个（默认）
   * - 'abort'：整个计划中止
   * - 'retry'：重试该步骤（需配合 maxRetries）
   */
  onFailure?: 'skip' | 'abort' | 'retry'
  /** 最大重试次数（onFailure='retry' 时生效，默认 2） */
  maxRetries?: number
}

export class ExecuteNode implements OrchestratorNode {
  readonly id: string
  readonly name: string
  readonly type: NodeType = 'execute'
  private config: ExecuteNodeConfig
  /** 当前步骤的重试计数（按 stepId 记录） */
  private retryCount = new Map<string, number>()

  constructor(config: ExecuteNodeConfig) {
    this.id = config.id
    this.name = config.name ?? `ExecuteNode:${config.id}`
    this.config = config
  }

  async execute(ctx: NodeContext): Promise<NodeResult> {
    await ctx.waitIfPaused()
    if (ctx.isAborted()) {
      return { status: 'aborted' }
    }

    const plan = ctx.state.plan
    if (!plan || plan.length === 0) {
      return { status: 'error', error: 'No plan found in state. Run PlanNode first.' }
    }

    // 找下一个 pending 项
    const currentItem = plan.find(p => p.status === 'pending')
    if (!currentItem) {
      // 没有 pending 项，计划完成
      ctx.log('info', 'ExecuteNode: all plan items completed')
      return {
        status: 'done',
        summary: `All ${plan.length} items completed`,
      }
    }

    // 标记为进行中
    currentItem.status = 'in_progress'
    ctx.emit({
      type: 'plan_step_update',
      stepId: currentItem.id,
      status: 'in_progress',
    })

    // 渲染 prompt
    const input = this.renderPrompt(ctx, currentItem)
    if (!input.trim()) {
      return { status: 'error', error: 'Rendered prompt is empty' }
    }

    if (this.config.recordUserMessage !== false) {
      const userMsg: OrchestratorMessage = { role: 'user', content: input }
      ctx.state.messages.push(userMsg)
    }

    ctx.log('info', `ExecuteNode: executing step "${currentItem.title}"`, {
      stepId: currentItem.id,
      order: currentItem.order,
    })

    try {
      const response = await ctx.backend.prompt(input, this.config.promptOptions)

      if (ctx.isAborted()) {
        currentItem.status = 'pending' // 回滚状态
        return { status: 'aborted' }
      }

      // 记录 assistant 响应
      ctx.state.messages.push({ role: 'assistant', content: response })

      // 标记完成
      currentItem.status = 'completed'
      currentItem.output = response
      ctx.emit({
        type: 'plan_step_update',
        stepId: currentItem.id,
        status: 'completed',
        output: response,
      })

      // 解析新任务（动态调整）
      const newTasks = this.config.parseNewTasks
        ? this.config.parseNewTasks(response)
        : this.defaultParseNewTasks(response)

      if (newTasks.length > 0) {
        const baseOrder = plan.length
        const newItems: PlanItem[] = newTasks.map((raw, idx) => ({
          id: `plan-${Date.now()}-new-${idx}`,
          title: typeof raw.title === 'string' ? raw.title : `新步骤 ${idx + 1}`,
          description: typeof raw.description === 'string' ? raw.description : undefined,
          status: 'pending' as const,
          order: baseOrder + idx,
        }))
        plan.push(...newItems)
        ctx.log('info', `ExecuteNode: added ${newItems.length} new tasks dynamically`, {
          newTitles: newItems.map(p => p.title),
        })
      }

      // 重置该步骤的重试计数
      this.retryCount.delete(currentItem.id)

      ctx.log('info', `ExecuteNode: step "${currentItem.title}" completed`, {
        responseLength: response.length,
      })

      // 还有 pending 项 → continue（图边循环回自身）
      const hasMore = plan.some(p => p.status === 'pending')
      return {
        status: hasMore ? 'continue' : 'done',
        nextNodeId: hasMore ? this.id : undefined, // 显式回到自身
        summary: `Step "${currentItem.title}" done, ${plan.filter(p => p.status === 'pending').length} remaining`,
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      ctx.log('error', `ExecuteNode: step "${currentItem.title}" failed: ${msg}`)

      return this.handleFailure(ctx, currentItem, msg)
    }
  }

  /**
   * 失败处理策略
   */
  private handleFailure(
    ctx: NodeContext,
    item: PlanItem,
    errorMsg: string,
  ): NodeResult {
    const strategy = this.config.onFailure ?? 'skip'

    if (strategy === 'abort') {
      item.status = 'failed'
      ctx.emit({
        type: 'plan_step_update',
        stepId: item.id,
        status: 'failed',
        output: errorMsg,
      })
      return {
        status: 'error',
        error: `Step "${item.title}" failed: ${errorMsg}`,
      }
    }

    if (strategy === 'retry') {
      const maxRetries = this.config.maxRetries ?? 2
      const current = this.retryCount.get(item.id) ?? 0
      if (current < maxRetries) {
        this.retryCount.set(item.id, current + 1)
        item.status = 'pending' // 回滚等待重试
        ctx.log('warn', `ExecuteNode: retrying step "${item.title}" (${current + 1}/${maxRetries})`)
        return {
          status: 'continue',
          nextNodeId: this.id,
          summary: `Retrying step "${item.title}" (attempt ${current + 1}/${maxRetries})`,
        }
      }
      // 重试耗尽，转为 skip
      ctx.log('error', `ExecuteNode: step "${item.title}" exhausted retries`)
    }

    // skip 策略（默认）
    item.status = 'skipped'
    ctx.emit({
      type: 'plan_step_update',
      stepId: item.id,
      status: 'skipped',
      output: errorMsg,
    })

    const plan = ctx.state.plan!
    const hasMore = plan.some(p => p.status === 'pending')
    return {
      status: hasMore ? 'continue' : 'done',
      nextNodeId: hasMore ? this.id : undefined,
      summary: `Step "${item.title}" skipped due to error`,
    }
  }

  /**
   * 默认新任务解析 — 从 <new_tasks>[...]</new_tasks> 标记提取
   */
  private defaultParseNewTasks(response: string): NewTaskRaw[] {
    const match = response.match(/<new_tasks>\s*([\s\S]*?)<\/new_tasks>/)
    if (!match) return []

    try {
      const parsed = JSON.parse(match[1].trim())
      if (!Array.isArray(parsed)) return []
      return parsed.filter(
        (item): item is NewTaskRaw =>
          typeof item === 'object' && item !== null && 'title' in item,
      )
    } catch {
      // 解析失败视为无新任务（调用方按空数组处理）
      return []
    }
  }

  private renderPrompt(ctx: NodeContext, item: PlanItem): string {
    const template = this.config.promptTemplate ?? DEFAULT_EXECUTE_PROMPT_TEMPLATE
    const plan = ctx.state.plan ?? []
    const lastMessage = ctx.state.messages[ctx.state.messages.length - 1]?.content ?? ''

    const completedSteps = plan
      .filter(p => p.status === 'completed')
      .map(p => `- [✓] ${p.title}${p.output ? `：${p.output.slice(0, 100)}...` : ''}`)
      .join('\n') || '（无）'

    const remainingSteps = plan
      .filter(p => p.status === 'pending' || p.status === 'in_progress')
      .map(p => `- [${p.status === 'in_progress' ? '→' : ' '}] ${p.title}`)
      .join('\n') || '（无）'

    return template
      .replace(/\{\{input\}\}/g, ctx.state.input)
      .replace(/\{\{stepTitle\}\}/g, item.title)
      .replace(/\{\{stepDescription\}\}/g, item.description ?? '（无描述）')
      .replace(/\{\{completedSteps\}\}/g, completedSteps)
      .replace(/\{\{remainingSteps\}\}/g, remainingSteps)
      .replace(/\{\{lastMessage\}\}/g, lastMessage)
  }

  reset?(): void {
    this.retryCount.clear()
  }
}
